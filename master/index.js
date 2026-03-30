const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { splitIntoChunks, assembleResults, encrypt, decrypt } = require('./chunk');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

app.use(express.static(require('path').join(__dirname, '../dashboard')));

const server = http.createServer(app);
const io = new Server(server);

let workers = [];
let jobs = {};
let jobsCompleted = 0;
let tasksProcessed = 0;
let recentJobs = [];

function emitDashboardUpdate() {
    io.emit('dashboard-update', {
        workerCount: workers.length,
        workers: workers.map(w => `${w.type}: ${w.id}`),
        jobsRunning: Object.keys(jobs).length,
        jobsCompleted,
        tasksProcessed,
        jobs: recentJobs.slice(-10)
    });
}

io.on('connection', (socket) => {
    const type = socket.handshake.query.type;

    if (type === 'worker' || type === 'browser-worker') {
        console.log(`${type} connected: ${socket.id}`);

        const sessionKey = crypto.randomBytes(32);
        workers.push({ id: socket.id, type, sessionKey });

        // Send session key to worker immediately on connect
        socket.emit('session-key', sessionKey.toString('hex'));

        emitDashboardUpdate();
    }

    socket.on('chunk-result', (data) => {
        let jobId, result;

        const worker = workers.find(w => w.id === socket.id);
        if (!worker) return;

        if (typeof data === 'string' && data.startsWith('PLAIN:')) {
            const parsed = JSON.parse(data.replace('PLAIN:', ''));
            jobId = parsed.jobId;
            result = parsed.result;
        } else {
            const decrypted = decrypt(data, worker.sessionKey);
            jobId = decrypted.jobId;
            result = decrypted.result;
        }

        const job = jobs[jobId];
        if (!job) return;

        job.pendingResults.push(result);
        delete job.workerChunkMap[socket.id];

        console.log(`Job ${jobId} progress: ${job.pendingResults.length}/${job.totalChunks}`);

        if (job.pendingResults.length === job.totalChunks) {
            const finalResult = assembleResults(job.pendingResults);
            console.log(`Job ${jobId} complete!`);

            jobsCompleted++;
            tasksProcessed += finalResult.length;
            const jobIndex = recentJobs.findIndex(j => j.id === jobId);
            if (jobIndex !== -1) recentJobs[jobIndex].status = 'complete';
            emitDashboardUpdate();

            job.res.json({ jobId, result: finalResult });
            delete jobs[jobId];
        }
    });

    socket.on('disconnect', () => {
        const disconnectedWorker = workers.find(w => w.id === socket.id);
        workers = workers.filter(w => w.id !== socket.id);
        emitDashboardUpdate();
        console.log(`Worker disconnected: ${socket.id}`);

        if (!disconnectedWorker) return;

        Object.keys(jobs).forEach(jobId => {
            const job = jobs[jobId];

            if (job.workerChunkMap[socket.id]) {
                const lostChunk = job.workerChunkMap[socket.id];
                delete job.workerChunkMap[socket.id];

                console.log(`Chunk lost from job ${jobId}! Reassigning...`);

                if (workers.length > 0) {
                    const newWorker = workers[0];

                    let newPayload;
                    if (newWorker.type === 'browser-worker') {
                        newPayload = 'PLAIN:' + JSON.stringify({ jobId, chunk: lostChunk });
                    } else {
                        newPayload = encrypt({ jobId, chunk: lostChunk }, newWorker.sessionKey);
                    }

                    job.workerChunkMap[newWorker.id] = lostChunk;
                    io.to(newWorker.id).emit('task-chunk', { chunk: newPayload });
                    console.log(`Chunk reassigned to: ${newWorker.id}`);
                } else {
                    console.log('No workers available to reassign chunk!');
                }
            }
        });
    });
});

// ─── Public API ───────────────────────────────────────────

const VALID_API_KEYS = new Set([
    'nebula-test-key-123',
]);

function requireApiKey(req, res, next) {
    const key = req.headers['x-api-key'];
    if (!key || !VALID_API_KEYS.has(key)) {
        return res.status(401).json({ 
            error: 'Invalid or missing API key',
            hint: 'Pass your key as x-api-key header'
        });
    }
    next();
}

app.get('/api/v1/status', (req, res) => {
    res.json({
        status: 'online',
        workers: workers.length,
        jobsRunning: Object.keys(jobs).length,
        jobsCompleted,
        tasksProcessed,
        ready: workers.length > 0
    });
});

app.post('/api/v1/run', requireApiKey, (req, res) => {
    const { tasks } = req.body;

    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
        return res.status(400).json({ 
            error: 'tasks must be a non-empty array of strings' 
        });
    }

    if (tasks.length > 100) {
        return res.status(400).json({ 
            error: 'Maximum 100 tasks per job' 
        });
    }

    if (workers.length === 0) {
        return res.status(503).json({ 
            error: 'No workers available right now',
            hint: 'Run: npx nebula-worker start --master https://nebula-mk65.onrender.com'
        });
    }

    const jobId = uuidv4();
    jobs[jobId] = {
        totalChunks: 0,
        pendingResults: [],
        workerChunkMap: {},
        res
    };

    const chunks = splitIntoChunks(tasks, workers.length);
    jobs[jobId].totalChunks = chunks.length;

    console.log(`[API] Job ${jobId} started — ${chunks.length} chunks, ${tasks.length} tasks`);

    recentJobs.push({ id: jobId, chunks: chunks.length, status: 'running' });
    emitDashboardUpdate();

    chunks.forEach((chunk, index) => {
        const worker = workers[index % workers.length];
        let payload;
        if (worker.type === 'browser-worker') {
            payload = 'PLAIN:' + JSON.stringify({ jobId, chunk });
        } else {
            payload = encrypt({ jobId, chunk }, worker.sessionKey);
        }
        jobs[jobId].workerChunkMap[worker.id] = chunk;
        io.to(worker.id).emit('task-chunk', { chunk: payload });
    });
});

app.post('/job', (req, res) => {
    const { tasks } = req.body;

    if (workers.length === 0) {
        return res.status(400).json({ error: 'No workers available' });
    }

    const jobId = uuidv4();

    jobs[jobId] = {
        totalChunks: 0,
        pendingResults: [],
        workerChunkMap: {},
        res
    };

    const chunks = splitIntoChunks(tasks, workers.length);
    jobs[jobId].totalChunks = chunks.length;

    console.log(`Job ${jobId} started with ${chunks.length} chunks`);

    recentJobs.push({
        id: jobId,
        chunks: chunks.length,
        status: 'running'
    });
    emitDashboardUpdate();

    chunks.forEach((chunk, index) => {
        const worker = workers[index];

        let payload;
        if (worker.type === 'browser-worker') {
            payload = 'PLAIN:' + JSON.stringify({ jobId, chunk });
        } else {
            payload = encrypt({ jobId, chunk }, worker.sessionKey);
        }

        jobs[jobId].workerChunkMap[worker.id] = chunk;
        io.to(worker.id).emit('task-chunk', { chunk: payload });
    });
});

server.listen(3000, () => {
    console.log('Nebula Master Node running on port 3000');
});