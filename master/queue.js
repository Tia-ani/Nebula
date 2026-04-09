const { Queue, Worker, QueueEvents } = require('bullmq');
const { redis } = require('./redis');
const { splitIntoChunks, assembleResults } = require('./chunk');
const { injectCanaries, validateCanary, evaluateWorker } = require('./canary');
const auth = require('./auth');

// BullMQ connection config
const connection = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
};

// Job Queue
const jobQueue = new Queue('nebula-jobs', { connection });

// Chunk Queue
const chunkQueue = new Queue('nebula-chunks', { connection });

// Dead Letter Queue for failed jobs
const deadLetterQueue = new Queue('nebula-dead-letter', { connection });

// Queue Events for monitoring
const jobEvents = new QueueEvents('nebula-jobs', { connection });
const chunkEvents = new QueueEvents('nebula-chunks', { connection });
const dlqEvents = new QueueEvents('nebula-dead-letter', { connection });

// Track job state in Redis
class JobManager {
    async createJob(jobId, tasks, developerEmail = null) {
        const jobData = {
            jobId,
            tasks,
            developerEmail,
            totalChunks: 0,
            completedChunks: 0,
            results: [],
            canaryMap: {}, // Track canary positions
            status: 'pending',
            createdAt: Date.now()
        };
        
        await redis.set(`job:${jobId}`, JSON.stringify(jobData));
        await redis.expire(`job:${jobId}`, 3600); // 1 hour TTL
        
        return jobData;
    }
    
    async getJob(jobId) {
        const data = await redis.get(`job:${jobId}`);
        return data ? JSON.parse(data) : null;
    }
    
    async updateJob(jobId, updates) {
        const job = await this.getJob(jobId);
        if (!job) return null;
        
        const updated = { ...job, ...updates };
        await redis.set(`job:${jobId}`, JSON.stringify(updated));
        return updated;
    }
    
    async addResult(jobId, result) {
        const job = await this.getJob(jobId);
        if (!job) return null;
        
        job.results.push(result);
        job.completedChunks++;
        
        if (job.completedChunks === job.totalChunks) {
            job.status = 'completed';
            job.completedAt = Date.now();
        }
        
        await redis.set(`job:${jobId}`, JSON.stringify(job));
        return job;
    }
}

const jobManager = new JobManager();

// Worker heartbeat system
class WorkerRegistry {
    async registerWorker(workerId, workerData) {
        const data = {
            ...workerData,
            registeredAt: Date.now(),
            lastHeartbeat: Date.now()
        };
        
        await redis.set(`worker:${workerId}`, JSON.stringify(data));
        await redis.expire(`worker:${workerId}`, 30); // 30 second TTL
        await redis.sadd('workers:active', workerId);
        
        console.log(`Worker registered: ${workerId} (${workerData.type})`);
    }
    
    async heartbeat(workerId) {
        const workerData = await this.getWorker(workerId);
        if (!workerData) return false;
        
        workerData.lastHeartbeat = Date.now();
        await redis.set(`worker:${workerId}`, JSON.stringify(workerData));
        await redis.expire(`worker:${workerId}`, 30); // Refresh TTL
        
        return true;
    }
    
    async getWorker(workerId) {
        const data = await redis.get(`worker:${workerId}`);
        return data ? JSON.parse(data) : null;
    }
    
    async removeWorker(workerId) {
        await redis.del(`worker:${workerId}`);
        await redis.srem('workers:active', workerId);
        console.log(`Worker removed: ${workerId}`);
    }
    
    async getActiveWorkers() {
        const workerIds = await redis.smembers('workers:active');
        const workers = [];
        
        for (const id of workerIds) {
            const worker = await this.getWorker(id);
            if (worker) {
                workers.push({ id, ...worker });
            } else {
                // Clean up stale worker ID
                await redis.srem('workers:active', id);
            }
        }
        
        return workers;
    }
    
    async getWorkerCount() {
        return await redis.scard('workers:active');
    }
}

const workerRegistry = new WorkerRegistry();

// Chunk assignment tracking
class ChunkTracker {
    async assignChunk(chunkId, workerId, chunkData) {
        const assignment = {
            chunkId,
            workerId,
            jobId: chunkData.jobId,
            assignedAt: Date.now(),
            attempt: (chunkData.attempt || 0) + 1
        };
        
        await redis.set(`chunk:${chunkId}`, JSON.stringify(assignment));
        await redis.expire(`chunk:${chunkId}`, 600); // 10 minute TTL
        await redis.sadd(`worker:${workerId}:chunks`, chunkId);
    }
    
    async completeChunk(chunkId) {
        const assignment = await this.getChunk(chunkId);
        if (!assignment) return;
        
        await redis.del(`chunk:${chunkId}`);
        await redis.srem(`worker:${assignment.workerId}:chunks`, chunkId);
    }
    
    async getChunk(chunkId) {
        const data = await redis.get(`chunk:${chunkId}`);
        return data ? JSON.parse(data) : null;
    }
    
    async getWorkerChunks(workerId) {
        const chunkIds = await redis.smembers(`worker:${workerId}:chunks`);
        const chunks = [];
        
        for (const id of chunkIds) {
            const chunk = await this.getChunk(id);
            if (chunk) chunks.push(chunk);
        }
        
        return chunks;
    }
    
    async reassignWorkerChunks(workerId) {
        const chunks = await this.getWorkerChunks(workerId);
        
        for (const chunk of chunks) {
            // Add chunk back to queue for reassignment
            await chunkQueue.add('process-chunk', {
                ...chunk,
                reassigned: true,
                previousWorker: workerId
            });
            
            await this.completeChunk(chunk.chunkId);
        }
        
        await redis.del(`worker:${workerId}:chunks`);
        return chunks.length;
    }
}

const chunkTracker = new ChunkTracker();

// Dead Letter Queue Manager
class DeadLetterManager {
    async addToDeadLetter(jobId, reason, metadata = {}) {
        const dlqEntry = {
            jobId,
            reason,
            metadata,
            timestamp: Date.now(),
            retriesExhausted: metadata.attempts || 0
        };
        
        // Add to BullMQ dead letter queue
        await deadLetterQueue.add('failed-job', dlqEntry, {
            removeOnComplete: false, // Keep all DLQ entries
            removeOnFail: false
        });
        
        // Also store in Redis for quick lookup
        await redis.lpush('dlq:jobs', JSON.stringify(dlqEntry));
        await redis.ltrim('dlq:jobs', 0, 999); // Keep last 1000 failed jobs
        
        console.log(`Job ${jobId} moved to dead letter queue: ${reason}`);
        
        return dlqEntry;
    }
    
    async getDeadLetterJobs(limit = 50) {
        const jobs = await redis.lrange('dlq:jobs', 0, limit - 1);
        return jobs.map(j => JSON.parse(j));
    }
    
    async getDeadLetterStats() {
        const total = await redis.llen('dlq:jobs');
        const jobs = await this.getDeadLetterJobs(100);
        
        // Group by reason
        const byReason = {};
        jobs.forEach(job => {
            byReason[job.reason] = (byReason[job.reason] || 0) + 1;
        });
        
        return {
            total,
            byReason,
            recent: jobs.slice(0, 10)
        };
    }
    
    async retryDeadLetterJob(jobId) {
        // Find the job in DLQ
        const jobs = await this.getDeadLetterJobs(1000);
        const job = jobs.find(j => j.jobId === jobId);
        
        if (!job) {
            throw new Error(`Job ${jobId} not found in dead letter queue`);
        }
        
        // Resubmit the job
        const jobData = await jobManager.getJob(jobId);
        if (!jobData) {
            throw new Error(`Job data for ${jobId} not found`);
        }
        
        // Create new job with same tasks
        const newJobId = await submitJob(jobData.tasks, jobData.developerEmail);
        
        console.log(`Retrying DLQ job ${jobId} as new job ${newJobId}`);
        
        return newJobId;
    }
}

const deadLetterManager = new DeadLetterManager();

// Submit a job to the queue
async function submitJob(tasks, developerEmail = null) {
    const jobId = require('uuid').v4();
    
    // Create job in Redis
    await jobManager.createJob(jobId, tasks, developerEmail);
    
    // Add to BullMQ queue with retry configuration
    await jobQueue.add('process-job', {
        jobId,
        tasks,
        developerEmail
    }, {
        jobId, // Use jobId as BullMQ job ID for idempotency
        removeOnComplete: 100, // Keep last 100 completed jobs
        removeOnFail: false, // Don't auto-remove failed jobs
        attempts: 3, // Retry up to 3 times
        backoff: {
            type: 'exponential',
            delay: 2000 // Start with 2 second delay, doubles each retry
        }
    });
    
    return jobId;
}

// Process jobs: split into chunks and distribute
const jobWorker = new Worker('nebula-jobs', async (job) => {
    const { jobId, tasks, developerEmail } = job.data;
    
    const workers = await workerRegistry.getActiveWorkers();
    
    if (workers.length === 0) {
        throw new Error('No workers available');
    }
    
    // Split tasks into chunks
    const chunks = splitIntoChunks(tasks, workers.length);
    
    // Update job with chunk count
    await jobManager.updateJob(jobId, {
        totalChunks: chunks.length,
        status: 'processing'
    });
    
    // Add each chunk to chunk queue
    for (let i = 0; i < chunks.length; i++) {
        await chunkQueue.add('process-chunk', {
            jobId,
            chunkId: `${jobId}-${i}`,
            chunk: chunks[i],
            chunkIndex: i,
            attempt: 0
        });
    }
    
    return { jobId, chunks: chunks.length };
}, { connection });

// Process chunks: assign to workers
const chunkWorker = new Worker('nebula-chunks', async (job) => {
    const { jobId, chunkId, chunk, chunkIndex, attempt = 0 } = job.data;
    
    // This will be handled by Socket.io when worker is ready
    // For now, just track that chunk is ready for assignment
    await redis.lpush(`job:${jobId}:pending-chunks`, JSON.stringify({
        chunkId,
        chunk,
        chunkIndex,
        attempt
    }));
    
    return { chunkId, status: 'ready-for-assignment' };
}, { connection });

// Monitor job completion
jobEvents.on('completed', async ({ jobId, returnvalue }) => {
    console.log(`Job ${jobId} completed:`, returnvalue);
});

jobEvents.on('failed', async ({ jobId, failedReason, attemptsMade }) => {
    console.error(`Job ${jobId} failed (attempt ${attemptsMade}):`, failedReason);
    
    // If all retries exhausted, move to dead letter queue
    const job = await jobQueue.getJob(jobId);
    if (job && job.attemptsMade >= (job.opts.attempts || 3)) {
        await deadLetterManager.addToDeadLetter(jobId, failedReason, {
            attempts: job.attemptsMade,
            data: job.data,
            failedAt: Date.now()
        });
    }
});

// Monitor chunk completion
chunkEvents.on('completed', async ({ jobId }) => {
    console.log(`Chunk ${jobId} completed`);
});

chunkEvents.on('failed', async ({ jobId, failedReason, attemptsMade }) => {
    console.error(`Chunk ${jobId} failed (attempt ${attemptsMade}):`, failedReason);
});

// Monitor dead letter queue
dlqEvents.on('completed', async ({ jobId }) => {
    console.log(`DLQ entry ${jobId} processed`);
});

module.exports = {
    jobQueue,
    chunkQueue,
    deadLetterQueue,
    jobManager,
    workerRegistry,
    chunkTracker,
    deadLetterManager,
    submitJob
};
