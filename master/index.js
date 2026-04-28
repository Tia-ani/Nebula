const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { splitIntoChunks, assembleResults, encrypt, decrypt } = require('./chunk');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const auth = require('./auth');
const { initialize: initializeDB } = require('./database');
const { redis } = require('./redis');
const { workerRegistry, chunkTracker, jobManager, submitJob, deadLetterManager, stragglerDetector } = require('./queue');
const { injectCanaries, validateCanary } = require('./canary');
const canaryTracker = require('./canary-tracker');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const { parseFile } = require('./file-parser');
const fs = require('fs');
const Groq = require('groq-sdk');

// Initialize Groq client (optional - only if API key is provided)
let groq = null;
if (process.env.GROQ_API_KEY) {
    groq = new Groq({
        apiKey: process.env.GROQ_API_KEY
    });
    console.log('✓ Groq API initialized for browser workers');
} else {
    console.log('⚠️  GROQ_API_KEY not set - browser workers will use fallback mode');
}

// Rate limiting for Groq API (30 req/min free tier)
const groqRateLimiter = {
    requests: [],
    maxPerMinute: 30,
    
    async checkAndWait() {
        const now = Date.now();
        // Remove requests older than 1 minute
        this.requests = this.requests.filter(time => now - time < 60000);
        
        if (this.requests.length >= this.maxPerMinute) {
            // Wait until oldest request expires
            const oldestRequest = this.requests[0];
            const waitTime = 60000 - (now - oldestRequest) + 100; // +100ms buffer
            console.log(`[Groq] Rate limit reached. Waiting ${waitTime}ms...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return this.checkAndWait(); // Recursive check
        }
        
        this.requests.push(now);
        return true;
    }
};

// Ensure upload directory exists
const uploadDir = '/tmp/nebula-uploads/';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log(`Created upload directory: ${uploadDir}`);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
        // Preserve original extension
        const ext = path.extname(file.originalname);
        const uniqueName = crypto.randomBytes(16).toString('hex') + ext;
        console.log(`[Multer] Saving file as: ${uniqueName}`);
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

const app = express();
app.use(express.json());
app.use(cors());

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

// Initialize PostgreSQL database
initializeDB().catch(err => {
    console.error('Failed to initialize database:', err);
    // Continue anyway - database might already be initialized
});

// Serve React build in production
const frontendBuild = path.join(__dirname, '../frontend/build');
app.use(express.static(frontendBuild));

// API routes (defined BEFORE catch-all)
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "http://localhost:3001",
        methods: ["GET", "POST"]
    }
});

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
    const userEmail = socket.handshake.query.userEmail; // Get user email from connection

    if (type === 'worker' || type === 'browser-worker') {
        console.log(`${type} connected: ${socket.id}${userEmail ? ` (${userEmail})` : ''}`);

        const sessionKey = crypto.randomBytes(32);
        
        // Register worker in Redis
        workerRegistry.registerWorker(socket.id, {
            type,
            sessionKey: sessionKey.toString('hex'),
            userEmail,
            socketId: socket.id
        });

        // Legacy in-memory tracking (for backward compatibility)
        workers.push({ id: socket.id, type, sessionKey, userEmail });

        // Send session key to worker immediately on connect
        socket.emit('session-key', sessionKey.toString('hex'));

        // Start heartbeat monitoring
        const heartbeatInterval = setInterval(async () => {
            const success = await workerRegistry.heartbeat(socket.id);
            if (!success) {
                clearInterval(heartbeatInterval);
            }
        }, 10000); // Every 10 seconds

        socket.on('disconnect', () => {
            clearInterval(heartbeatInterval);
        });

        emitDashboardUpdate();
    }

    socket.on('chunk-result', async (data) => {
        let jobId, result, chunkId;

        const worker = workers.find(w => w.id === socket.id);
        if (!worker) return;

        if (typeof data === 'string' && data.startsWith('PLAIN:')) {
            const parsed = JSON.parse(data.replace('PLAIN:', ''));
            jobId = parsed.jobId;
            result = parsed.result;
            chunkId = parsed.chunkId;
        } else {
            const decrypted = decrypt(data, worker.sessionKey);
            jobId = decrypted.jobId;
            result = decrypted.result;
            chunkId = decrypted.chunkId;
        }

        const job = jobs[jobId];
        if (!job) return;

        // Track chunk completion time for straggler detection
        if (chunkId) {
            await stragglerDetector.completeChunk(chunkId);
        }

        job.pendingResults.push(result);
        const chunkSize = job.workerChunkMap[socket.id]?.length || 0;
        const chunk = job.workerChunkMap[socket.id] || [];
        const chunkCanaries = job.chunkCanaryMap[socket.id] || {};
        delete job.workerChunkMap[socket.id];
        delete job.chunkCanaryMap[socket.id];

        // Update Redis job state
        await jobManager.addResult(jobId, result);

        // Validate canaries in this chunk
        let canaryResults = [];
        if (Object.keys(chunkCanaries).length > 0) {
            // Check each result against chunk canary map
            result.forEach((taskResult, taskIndex) => {
                const canary = chunkCanaries[taskIndex];
                
                if (canary) {
                    // Handle different result formats (string or object)
                    let resultText = '';
                    if (typeof taskResult === 'string') {
                        resultText = taskResult;
                    } else if (taskResult && typeof taskResult === 'object') {
                        // Browser worker might return objects - try to extract meaningful text
                        resultText = taskResult.input || taskResult.result || JSON.stringify(taskResult);
                    }
                    
                    const passed = validateCanary(resultText, canary.expected);
                    canaryResults.push({ passed, canary, taskResult: resultText });
                    
                    // Record canary result in database
                    canaryTracker.recordCanaryResult(
                        socket.id,
                        worker.userEmail,
                        canary.canaryId || `canary-${jobId}-${taskIndex}`,
                        canary.expected,
                        resultText,
                        jobId,
                        `${jobId}-${socket.id}`
                    ).catch(err => console.error('Failed to record canary:', err));
                }
            });
            
            console.log(`   Canary validation: ${canaryResults.filter(r => r.passed).length}/${canaryResults.length} passed`);
        }

        // Credit the contributor for completing this chunk
        if (worker.userEmail && chunkSize > 0) {
            const creditsPerTask = worker.type === 'browser-worker' ? 10 : worker.type === 'gpu-worker' ? 100 : 50;
            const creditsEarned = chunkSize * creditsPerTask;
            
            // Check worker reputation before paying (use email, not socket.id)
            const workerPerf = await canaryTracker.getWorkerPerformanceByEmail(worker.userEmail);
            const shouldPay = workerPerf.totalCanaries < 5 || workerPerf.passRate >= 85.0;
            
            if (shouldPay) {
                try {
                    // Verify user exists before crediting
                    const userExists = await auth.getUserByEmail(worker.userEmail);
                    if (!userExists) {
                        console.error(`✗ User not found: ${worker.userEmail} - chunk completed but no credits awarded`);
                        // Don't return - still count the chunk as complete
                    } else {
                        await auth.updateUserCredits(worker.userEmail, creditsEarned, 'add');
                        console.log(`✓ Credited ${creditsEarned} credits to ${worker.userEmail} for ${chunkSize} tasks${canaryResults.length > 0 ? ` (${canaryResults.filter(r => r.passed).length}/${canaryResults.length} canaries passed)` : ''}`);
                        
                        // Notify the worker about credits earned
                        socket.emit('credits-earned', { amount: creditsEarned, tasks: chunkSize });
                    }
                } catch (error) {
                    console.error(`✗ Failed to credit user ${worker.userEmail}:`, error.message);
                    // Don't return - still count the chunk as complete
                }
            } else {
                // Worker is flagged - no payment
                console.log(`✗ PAYMENT BLOCKED for ${worker.userEmail}: Pass rate ${workerPerf.passRate.toFixed(1)}% < 85% (${workerPerf.passed}/${workerPerf.totalCanaries} canaries)`);
                
                // Notify worker they're flagged
                socket.emit('worker-flagged', {
                    reason: 'low_canary_pass_rate',
                    passRate: workerPerf.passRate,
                    threshold: 85.0,
                    canariesPassed: workerPerf.passed,
                    canariesTotal: workerPerf.totalCanaries,
                    message: 'Your work quality is below threshold. Payment blocked.'
                });
            }
        }

        console.log(`Job ${jobId} progress: ${job.pendingResults.length}/${job.totalChunks}`);

        if (job.pendingResults.length === job.totalChunks) {
            const finalResult = assembleResults(job.pendingResults);
            console.log(`Job ${jobId} complete!`);

            // Filter out canary results before returning to developer
            let developerResults = finalResult;
            if (job.canaryMap && Object.keys(job.canaryMap).length > 0) {
                // Remove results at canary positions
                const canaryIndices = Object.keys(job.canaryMap).map(k => parseInt(k)).sort((a, b) => b - a);
                developerResults = [...finalResult];
                
                // Remove from end to start so indices don't shift
                canaryIndices.forEach(index => {
                    developerResults.splice(index, 1);
                });
                
                console.log(`Filtered out ${canaryIndices.length} canary results. Returning ${developerResults.length} real results to developer.`);
            }

            jobsCompleted++;
            tasksProcessed += finalResult.length;
            const jobIndex = recentJobs.findIndex(j => j.id === jobId);
            if (jobIndex !== -1) recentJobs[jobIndex].status = 'complete';
            emitDashboardUpdate();
            
            // Store results in database for later download
            if (job.developerEmail) {
                try {
                    await db.query(
                        `INSERT INTO completed_jobs (job_id, developer_email, results, total_tasks, completed_at, metadata)
                         VALUES ($1, $2, $3, $4, NOW(), $5)
                         ON CONFLICT (job_id) DO UPDATE SET
                         results = EXCLUDED.results,
                         completed_at = EXCLUDED.completed_at`,
                        [jobId, job.developerEmail, JSON.stringify(developerResults), developerResults.length, JSON.stringify({ priority: job.priority || 'normal' })]
                    );
                    console.log(`Stored results for job ${jobId} in database`);
                } catch (error) {
                    console.error(`Failed to store job results in database:`, error);
                }
            }
            
            // Send HTTP response if this is a legacy /job or /api/v1/run request
            if (job.res && !job.res.headersSent) {
                job.res.json({ jobId, result: developerResults });
            }
            
            // Notify developer about job completion via WebSocket
            if (job.developerEmail) {
                io.emit('job-complete', { jobId, result: developerResults, developerEmail: job.developerEmail });
            }
            
            delete jobs[jobId];
        }
    });

    socket.on('disconnect', async () => {
        const disconnectedWorker = workers.find(w => w.id === socket.id);
        workers = workers.filter(w => w.id !== socket.id);
        
        // Remove from Redis and reassign chunks
        if (disconnectedWorker) {
            const reassignedCount = await chunkTracker.reassignWorkerChunks(socket.id);
            await workerRegistry.removeWorker(socket.id);
            
            if (disconnectedWorker.userEmail) {
                console.log(`Worker disconnected: ${disconnectedWorker.userEmail} (${disconnectedWorker.type})`);
                if (reassignedCount > 0) {
                    console.log(`Reassigned ${reassignedCount} chunks from ${disconnectedWorker.userEmail}`);
                }
            }
        }
        
        emitDashboardUpdate();

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

    chunks.forEach((chunkData, index) => {
        // Handle both old format (array) and new format (object with tasks/workerIndex)
        const chunk = Array.isArray(chunkData) ? chunkData : chunkData.tasks;
        const workerIndex = chunkData.workerIndex !== undefined ? chunkData.workerIndex : index % workers.length;
        const worker = workers[workerIndex];
        const chunkId = `${jobId}-chunk-${index}`;
        
        let payload;
        if (worker.type === 'browser-worker') {
            payload = 'PLAIN:' + JSON.stringify({ jobId, chunk, chunkId });
        } else {
            payload = encrypt({ jobId, chunk, chunkId }, worker.sessionKey);
        }
        jobs[jobId].workerChunkMap[worker.id] = chunk;
        
        // Track chunk start time for straggler detection
        stragglerDetector.startChunk(chunkId, worker.id, jobId);
        
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

    chunks.forEach((chunkData, index) => {
        // Handle both old format (array) and new format (object with tasks/workerIndex)
        const chunk = Array.isArray(chunkData) ? chunkData : chunkData.tasks;
        const workerIndex = chunkData.workerIndex !== undefined ? chunkData.workerIndex : index;
        const worker = workers[workerIndex];
        const chunkId = `${jobId}-chunk-${index}`;

        let payload;
        if (worker.type === 'browser-worker') {
            payload = 'PLAIN:' + JSON.stringify({ jobId, chunk, chunkId });
        } else {
            payload = encrypt({ jobId, chunk, chunkId }, worker.sessionKey);
        }

        jobs[jobId].workerChunkMap[worker.id] = chunk;
        
        // Track chunk start time for straggler detection
        stragglerDetector.startChunk(chunkId, worker.id, jobId);
        
        io.to(worker.id).emit('task-chunk', { chunk: payload });
    });
});

app.get('/demo', (req, res) => {
    res.sendFile(require('path').join(__dirname, '../dashboard/demo.html'));
});

// ─── Authentication Routes ───────────────────────────────────────────

app.post('/api/auth/signup', async (req, res) => {
    const { name, email, password } = req.body;
    const result = await auth.signup(name, email, password);
    
    if (result.error) {
        return res.status(400).json({ error: result.error });
    }
    
    res.json(result);
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    const result = await auth.login(email, password);
    
    if (result.error) {
        return res.status(401).json({ error: result.error });
    }
    
    res.json(result);
});

// Middleware to verify authentication
async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        console.log('❌ Auth failed: No authorization header');
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    const token = authHeader.substring(7);
    const user = await auth.verifyToken(token);
    
    if (!user) {
        console.log('❌ Auth failed: Invalid token');
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    console.log(`✓ Auth success: ${user.email} (${user.role})`);
    req.user = user;
    next();
}

// Middleware to require specific role
function requireRole(...roles) {
    return (req, res, next) => {
        console.log(`🔒 Role check: User has "${req.user.role}", needs one of: [${roles.join(', ')}]`);
        if (!roles.includes(req.user.role)) {
            console.log(`❌ Role check failed for ${req.user.email}`);
            return res.status(403).json({ 
                error: 'Insufficient permissions',
                required: roles,
                current: req.user.role
            });
        }
        console.log(`✓ Role check passed for ${req.user.email}`);
        next();
    };
}

app.post('/api/auth/select-role', requireAuth, async (req, res) => {
    const { role } = req.body;
    const result = await auth.selectRole(req.user.email, role);
    
    if (result.error) {
        return res.status(400).json({ error: result.error });
    }
    
    res.json(result);
});

// Allow users to change their role (for testing/flexibility)
app.post('/api/auth/change-role', requireAuth, async (req, res) => {
    const { role } = req.body;
    
    if (!['contributor', 'developer'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
    }
    
    const result = await auth.selectRole(req.user.email, role);
    
    if (result.error) {
        return res.status(400).json({ error: result.error });
    }
    
    // Return updated user info with new token
    const token = localStorage.getItem('nebula-token');
    const user = await auth.getUserByEmail(req.user.email);
    
    res.json({ 
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            credits: user.credits
        },
        message: 'Role changed successfully'
    });
});

app.delete('/api/auth/delete-account', requireAuth, async (req, res) => {
    try {
        const { pool } = require('./database');
        const userId = req.user.id;
        const userEmail = req.user.email;
        
        // Delete in order (foreign key constraints)
        await pool.query('DELETE FROM credit_transactions WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM canary_tracking WHERE user_email = $1', [userEmail]);
        await pool.query('DELETE FROM worker_metrics WHERE user_email = $1', [userEmail]);
        await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
        await pool.query('DELETE FROM users WHERE id = $1', [userId]);
        
        console.log(`Account deleted: ${userEmail}`);
        res.json({ message: 'Account deleted successfully' });
    } catch (error) {
        console.error('Failed to delete account:', error);
        res.status(500).json({ error: 'Failed to delete account' });
    }
});

// ─── Contributor Routes ───────────────────────────────────────────

// Groq API proxy for browser workers (Nebula pays for API)
app.post('/api/contributor/groq-inference', async (req, res) => {
    try {
        const { task, workerEmail } = req.body;
        
        if (!task || typeof task !== 'string') {
            return res.status(400).json({ error: 'Invalid task' });
        }
        
        if (!workerEmail) {
            return res.status(400).json({ error: 'Worker email required' });
        }
        
        // Check if Groq is available
        if (!groq) {
            return res.status(503).json({ 
                error: 'Groq API not configured',
                fallback: true 
            });
        }
        
        // Check rate limit
        await groqRateLimiter.checkAndWait();
        
        console.log(`[Groq] Processing task for ${workerEmail}`);
        
        // Call Groq API
        const completion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'user',
                    content: task
                }
            ],
            model: 'llama3-8b-8192', // Free tier model
            temperature: 0.1,
            max_tokens: 150
        });
        
        const result = completion.choices[0].message.content.trim();
        
        res.json({ result });
        
    } catch (error) {
        console.error('[Groq] API error:', error.message);
        
        if (error.message.includes('rate_limit')) {
            return res.status(429).json({ error: 'Rate limit exceeded. Please wait.' });
        }
        
        res.status(500).json({ 
            error: 'Failed to process task', 
            message: error.message,
            fallback: true 
        });
    }
});

app.get('/api/contributor/check-ollama', async (req, res) => {
    try {
        const http = require('http');
        
        const options = {
            hostname: 'localhost',
            port: 11434,
            path: '/api/tags',
            method: 'GET',
            timeout: 2000
        };

        const request = http.request(options, (response) => {
            if (response.statusCode === 200) {
                let data = '';
                response.on('data', (chunk) => { data += chunk; });
                response.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        res.json({ 
                            installed: true, 
                            running: true,
                            models: parsed.models || []
                        });
                    } catch (e) {
                        res.json({ installed: false, running: false });
                    }
                });
            } else {
                res.json({ installed: false, running: false });
            }
        });

        request.on('error', () => {
            res.json({ installed: false, running: false });
        });

        request.on('timeout', () => {
            request.destroy();
            res.json({ installed: false, running: false });
        });

        request.end();
    } catch (error) {
        res.json({ installed: false, running: false });
    }
});

app.get('/api/contributor/stats', requireAuth, requireRole('contributor'), async (req, res) => {
    const stats = await auth.getUserStats(req.user.email);
    stats.activeWorkers = workers.length;
    res.json(stats);
});

// Start/stop worker endpoints for contributors
app.post('/api/contributor/start-worker', requireAuth, requireRole('contributor'), async (req, res) => {
    const { workerType } = req.body; // 'browser', 'cpu', or 'gpu'
    
    if (!['browser', 'cpu', 'gpu'].includes(workerType)) {
        return res.status(400).json({ error: 'Invalid worker type' });
    }
    
    // For now, return instructions on how to start the worker
    // In the future, this could spawn actual worker processes
    const instructions = {
        browser: 'Browser worker will run in your browser tab',
        cpu: 'Run: npx nebula-worker start --master http://localhost:3000',
        gpu: 'Run: npx nebula-worker start --gpu --master http://localhost:3000'
    };
    
    res.json({ 
        message: 'Worker start initiated',
        instructions: instructions[workerType],
        workerType
    });
});

app.post('/api/contributor/stop-worker', requireAuth, requireRole('contributor'), async (req, res) => {
    const { workerType } = req.body;
    
    res.json({ 
        message: 'Worker stopped',
        workerType
    });
});

// ─── Developer Routes ───────────────────────────────────────────

app.get('/api/developer/stats', requireAuth, requireRole('developer'), async (req, res) => {
    const stats = await auth.getUserStats(req.user.email);
    stats.activeWorkers = workers.length;
    res.json(stats);
});

app.get('/api/developer/jobs', requireAuth, requireRole('developer'), async (req, res) => {
    // Return recent jobs for this developer
    // For now, return all recent jobs (in production, filter by user)
    res.json({ 
        jobs: recentJobs.slice(-10).reverse(),
        activeJobs: Object.keys(jobs).length
    });
});

app.post('/api/developer/submit-job', requireAuth, requireRole('developer'), async (req, res) => {
    const { tasks, priority = 'normal' } = req.body;
    
    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
        return res.status(400).json({ error: 'tasks must be a non-empty array' });
    }
    
    if (workers.length === 0) {
        return res.status(503).json({ error: 'No workers available right now' });
    }
    
    // Calculate cost
    const baseCost = tasks.length * 10;
    const priorityMultiplier = { normal: 1, high: 1.5, urgent: 2 }[priority] || 1;
    const totalCost = Math.ceil(baseCost * priorityMultiplier);
    
    // Check if user has enough credits
    const user = await auth.getUserByEmail(req.user.email);
    if (user.credits < totalCost) {
        return res.status(400).json({ 
            error: 'Insufficient credits',
            required: totalCost,
            available: user.credits
        });
    }
    
    // Deduct credits and increment job count (atomic operation)
    try {
        await auth.updateUserCredits(req.user.email, totalCost, 'subtract');
        await auth.incrementJobCount(req.user.email);
    } catch (error) {
        return res.status(400).json({ 
            error: 'Failed to process payment',
            message: error.message
        });
    }
    
    // Inject canaries into tasks (15% injection rate)
    const { tasks: tasksWithCanaries, canaryMap, canaryCount } = injectCanaries(tasks, 0.15);
    
    // Debug: Check for undefined tasks
    const undefinedTasks = tasksWithCanaries.filter((t, i) => !t).map((t, i) => i);
    if (undefinedTasks.length > 0) {
        console.error(`⚠️  WARNING: ${undefinedTasks.length} undefined tasks after canary injection!`);
        console.error(`Undefined at indices:`, undefinedTasks);
    }
    
    // Submit job (reuse existing job submission logic)
    const jobId = uuidv4();
    jobs[jobId] = {
        totalChunks: 0,
        pendingResults: [],
        workerChunkMap: {},
        chunkCanaryMap: {}, // Map chunk index to canary positions within that chunk
        canaryMap, // Store global canary positions for reference
        developerEmail: req.user.email // Track who submitted the job
    };

    const chunks = splitIntoChunks(tasksWithCanaries, workers.length);
    jobs[jobId].totalChunks = chunks.length;

    console.log(`[Developer Job] ${req.user.email} - Job ${jobId} - ${chunks.length} chunks - ${totalCost} credits - ${canaryCount} canaries injected`);
    console.log(`Tasks with canaries (${tasksWithCanaries.length}):`, tasksWithCanaries.map((t, i) => `${i}:${t ? t.substring(0, 20) : 'UNDEFINED'}`));

    recentJobs.push({ id: jobId, chunks: chunks.length, status: 'running', developerEmail: req.user.email });
    emitDashboardUpdate();

    // Distribute chunks and track canary positions per chunk
    let taskOffset = 0;
    chunks.forEach((chunkData, chunkIndex) => {
        // Handle both old format (array) and new format (object with tasks/workerIndex)
        const chunk = Array.isArray(chunkData) ? chunkData : chunkData.tasks;
        const workerIndex = chunkData.workerIndex !== undefined ? chunkData.workerIndex : chunkIndex % workers.length;
        const worker = workers[workerIndex];
        const chunkId = `${jobId}-chunk-${chunkIndex}`;
        
        console.log(`  Chunk ${chunkIndex} → ${worker.type} (${worker.userEmail || 'no-email'}): ${chunk.length} tasks`);
        
        // Verify no undefined tasks in chunk
        const undefinedCount = chunk.filter(t => !t).length;
        if (undefinedCount > 0) {
            console.error(`  ⚠️  WARNING: ${undefinedCount} undefined tasks in chunk ${chunkIndex}!`);
        }
        
        // Find which tasks in this chunk are canaries
        const chunkCanaries = {};
        chunk.forEach((task, taskIndex) => {
            const globalIndex = taskOffset + taskIndex;
            if (canaryMap[globalIndex]) {
                chunkCanaries[taskIndex] = canaryMap[globalIndex];
            }
        });
        
        // Store canary info for this chunk
        jobs[jobId].chunkCanaryMap[worker.id] = chunkCanaries;
        taskOffset += chunk.length;
        
        let payload;
        if (worker.type === 'browser-worker') {
            payload = 'PLAIN:' + JSON.stringify({ jobId, chunk, chunkId });
        } else {
            payload = encrypt({ jobId, chunk, chunkId }, worker.sessionKey);
        }
        jobs[jobId].workerChunkMap[worker.id] = chunk;
        
        // Track chunk start time for straggler detection
        stragglerDetector.startChunk(chunkId, worker.id, jobId);
        
        io.to(worker.id).emit('task-chunk', { chunk: payload });
    });
    
    // Send immediate response (don't wait for job completion)
    res.json({ 
        jobId, 
        message: 'Job submitted successfully',
        chunks: chunks.length,
        tasks: tasksWithCanaries.length,
        canaries: canaryCount,
        cost: totalCost
    });
});

// ─── File Upload API ───────────────────────────────────────────

app.post('/api/developer/upload-job', requireAuth, requireRole('developer'), upload.single('file'), async (req, res) => {
    console.log('[File Upload] Request received');
    console.log('[File Upload] File:', req.file ? req.file.originalname : 'NO FILE');
    console.log('[File Upload] Body:', req.body);
    
    try {
        if (!req.file) {
            console.log('[File Upload] ERROR: No file uploaded');
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        console.log('[File Upload] File details:', {
            name: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype
        });
        
        if (workers.length === 0) {
            // Clean up uploaded file
            fs.unlinkSync(req.file.path);
            console.log('[File Upload] ERROR: No workers available');
            return res.status(503).json({ error: 'No workers available right now' });
        }
        
        // Parse config from request
        let config;
        try {
            config = req.body.config ? JSON.parse(req.body.config) : {};
            console.log('[File Upload] Config parsed:', config);
        } catch (parseError) {
            fs.unlinkSync(req.file.path);
            console.log('[File Upload] ERROR: Failed to parse config JSON');
            return res.status(400).json({ error: 'Invalid config JSON' });
        }
        
        const { column, key, priority = 'normal', promptTemplate } = config;
        
        if (!promptTemplate || !promptTemplate.trim()) {
            fs.unlinkSync(req.file.path);
            return res.status(400).json({ error: 'Prompt template is required' });
        }
        
        console.log(`[File Upload] Prompt template: "${promptTemplate}"`);
        
        // Validate that prompt template contains a placeholder
        const hasPlaceholder = promptTemplate.includes('{text}') || 
                              promptTemplate.includes('{review_text}') ||
                              /\{[a-zA-Z_]+\}/.test(promptTemplate);
        
        if (!hasPlaceholder) {
            fs.unlinkSync(req.file.path);
            console.log(`[File Upload] ERROR: No placeholder found in prompt template`);
            return res.status(400).json({ 
                error: 'Prompt template must contain a placeholder like {text} or {column_name}',
                example: 'Classify sentiment: {text}',
                yourTemplate: promptTemplate
            });
        }
        
        console.log(`[File Upload] Prompt template validation passed`);
        
        console.log(`[File Upload] ${req.user.email} - File: ${req.file.originalname} (${req.file.size} bytes)`);
        
        // Parse file to extract data
        let data;
        try {
            console.log(`[File Upload] Starting file parsing...`);
            data = await parseFile(req.file.path, { column, key });
            console.log(`[File Upload] File parsed successfully - ${data.length} rows extracted`);
        } catch (parseError) {
            // Clean up uploaded file
            fs.unlinkSync(req.file.path);
            console.log(`[File Upload] ERROR: Failed to parse file -`, parseError.message);
            return res.status(400).json({ 
                error: 'Failed to parse file',
                message: parseError.message
            });
        }
        
        // Clean up uploaded file after parsing
        fs.unlinkSync(req.file.path);
        console.log(`[File Upload] File cleaned up`);
        
        if (data.length === 0) {
            console.log(`[File Upload] ERROR: No valid data found in file`);
            return res.status(400).json({ error: 'No valid data found in file' });
        }
        
        console.log(`[File Upload] Extracted ${data.length} rows from ${req.file.originalname}`);
        
        // Apply prompt template to each data item
        console.log(`[File Upload] Applying prompt template...`);
        // Replace {text} or {column_name} with actual data
        const tasks = data.map(item => {
            // Replace {text} with the data
            let prompt = promptTemplate.replace(/\{text\}/g, item);
            
            // Also support {column_name} format
            const columnName = column || key || 'text';
            const regex = new RegExp(`\\{${columnName}\\}`, 'g');
            prompt = prompt.replace(regex, item);
            
            return prompt;
        });
        
        console.log(`[File Upload] Generated ${tasks.length} tasks with prompt template`);
        console.log(`[File Upload] Sample task: ${tasks[0].substring(0, 100)}...`);
        
        // Calculate cost
        const baseCost = tasks.length * 10;
        const priorityMultiplier = { normal: 1, high: 1.5, urgent: 2 }[priority] || 1;
        const totalCost = Math.ceil(baseCost * priorityMultiplier);
        
        // Check if user has enough credits
        const user = await auth.getUserByEmail(req.user.email);
        if (user.credits < totalCost) {
            return res.status(400).json({ 
                error: 'Insufficient credits',
                required: totalCost,
                available: user.credits
            });
        }
        
        // Deduct credits and increment job count
        try {
            await auth.updateUserCredits(req.user.email, totalCost, 'subtract');
            await auth.incrementJobCount(req.user.email);
        } catch (error) {
            return res.status(400).json({ 
                error: 'Failed to process payment',
                message: error.message
            });
        }
        
        // Inject canaries
        const { tasks: tasksWithCanaries, canaryMap, canaryCount } = injectCanaries(tasks, 0.15);
        
        // Submit job
        const jobId = uuidv4();
        jobs[jobId] = {
            totalChunks: 0,
            pendingResults: [],
            workerChunkMap: {},
            chunkCanaryMap: {},
            canaryMap,
            developerEmail: req.user.email,
            originalFilename: req.file.originalname,
            originalTasks: tasks // Store original tasks for result mapping
        };

        // Smart chunking based on worker types
        const workerTypes = workers.map(w => w.type);
        const chunks = splitIntoChunks(tasksWithCanaries, workers.length, workerTypes);
        jobs[jobId].totalChunks = chunks.length;

        console.log(`[File Job] ${req.user.email} - Job ${jobId} - ${chunks.length} chunks - ${totalCost} credits`);
        console.log(`[File Job] Worker types: ${workerTypes.join(', ')}`);
        console.log(`[File Job] Chunk sizes: ${chunks.map(c => c.tasks.length).join(', ')}`);

        recentJobs.push({ 
            id: jobId, 
            chunks: chunks.length, 
            status: 'running', 
            developerEmail: req.user.email,
            filename: req.file.originalname
        });
        emitDashboardUpdate();

        // Distribute chunks to matching worker types
        let taskOffset = 0;
        
        chunks.forEach((chunkData, chunkIndex) => {
            const chunk = chunkData.tasks;
            const worker = workers[chunkData.workerIndex];
            const chunkId = `${jobId}-chunk-${chunkIndex}`;
            
            console.log(`  Chunk ${chunkIndex}: ${chunk.length} tasks → ${worker.type} (${worker.userEmail || 'no-email'})`);
            
            // Find canaries in this chunk
            const chunkCanaries = {};
            chunk.forEach((task, taskIndex) => {
                const globalIndex = taskOffset + taskIndex;
                if (canaryMap[globalIndex]) {
                    chunkCanaries[taskIndex] = canaryMap[globalIndex];
                }
            });
            
            jobs[jobId].chunkCanaryMap[worker.id] = chunkCanaries;
            taskOffset += chunk.length;
            
            let payload;
            if (worker.type === 'browser-worker') {
                payload = 'PLAIN:' + JSON.stringify({ jobId, chunk, chunkId });
            } else {
                payload = encrypt({ jobId, chunk, chunkId }, worker.sessionKey);
            }
            jobs[jobId].workerChunkMap[worker.id] = chunk;
            
            stragglerDetector.startChunk(chunkId, worker.id, jobId);
            io.to(worker.id).emit('task-chunk', { chunk: payload });
        });
        
        // Send immediate response
        res.json({ 
            jobId, 
            message: 'File uploaded and job submitted successfully',
            filename: req.file.originalname,
            tasks: tasks.length,
            canaries: canaryCount,
            chunks: chunks.length,
            cost: totalCost,
            status: 'processing'
        });
        
    } catch (error) {
        console.error('[File Upload Error]', error);
        
        // Clean up file if it exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
        
        res.status(500).json({ 
            error: 'Internal server error',
            message: error.message
        });
    }
});

// ─── Result Download API ───────────────────────────────────────────

// Get list of completed jobs for download
app.get('/api/developer/completed-jobs', requireAuth, requireRole('developer'), async (req, res) => {
    try {
        const { pool } = require('./database');
        const result = await pool.query(
            `SELECT job_id, total_tasks, completed_at, metadata
             FROM completed_jobs
             WHERE developer_email = $1
             ORDER BY completed_at DESC
             LIMIT 50`,
            [req.user.email]
        );
        
        res.json({ jobs: result.rows });
    } catch (error) {
        console.error('Failed to get completed jobs:', error);
        res.status(500).json({ error: 'Failed to retrieve completed jobs' });
    }
});

// Get job results (JSON format)
app.get('/api/developer/results/:jobId', requireAuth, requireRole('developer'), async (req, res) => {
    try {
        const { jobId } = req.params;
        const { pool } = require('./database');
        
        const result = await pool.query(
            `SELECT results, total_tasks, completed_at, metadata
             FROM completed_jobs
             WHERE job_id = $1 AND developer_email = $2`,
            [jobId, req.user.email]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Job not found or access denied' });
        }
        
        const job = result.rows[0];
        res.json({
            jobId,
            results: job.results,
            totalTasks: job.total_tasks,
            completedAt: job.completed_at,
            metadata: job.metadata
        });
    } catch (error) {
        console.error('Failed to get job results:', error);
        res.status(500).json({ error: 'Failed to retrieve job results' });
    }
});

// Download results as JSON file
app.get('/api/developer/download/:jobId/json', requireAuth, requireRole('developer'), async (req, res) => {
    try {
        const { jobId } = req.params;
        const { pool } = require('./database');
        
        const result = await pool.query(
            `SELECT results, completed_at
             FROM completed_jobs
             WHERE job_id = $1 AND developer_email = $2`,
            [jobId, req.user.email]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Job not found or access denied' });
        }
        
        const job = result.rows[0];
        const filename = `nebula-results-${jobId}-${Date.now()}.json`;
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.json({
            jobId,
            completedAt: job.completed_at,
            totalResults: job.results.length,
            results: job.results
        });
    } catch (error) {
        console.error('Failed to download JSON results:', error);
        res.status(500).json({ error: 'Failed to download results' });
    }
});

// Download results as CSV file
app.get('/api/developer/download/:jobId/csv', requireAuth, requireRole('developer'), async (req, res) => {
    try {
        const { jobId } = req.params;
        const { pool } = require('./database');
        
        const result = await pool.query(
            `SELECT results
             FROM completed_jobs
             WHERE job_id = $1 AND developer_email = $2`,
            [jobId, req.user.email]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Job not found or access denied' });
        }
        
        const results = result.rows[0].results;
        
        // Convert results to CSV
        let csv = 'Index,Result\n';
        results.forEach((result, index) => {
            // Escape quotes and newlines in result
            let resultText = '';
            if (typeof result === 'string') {
                resultText = result;
            } else if (result && typeof result === 'object') {
                resultText = JSON.stringify(result);
            } else {
                resultText = String(result);
            }
            
            // Escape CSV special characters
            resultText = resultText.replace(/"/g, '""'); // Escape quotes
            resultText = `"${resultText}"`; // Wrap in quotes
            
            csv += `${index + 1},${resultText}\n`;
        });
        
        const filename = `nebula-results-${jobId}-${Date.now()}.csv`;
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (error) {
        console.error('Failed to download CSV results:', error);
        res.status(500).json({ error: 'Failed to download results' });
    }
});

// Download results as JSONL file (one JSON object per line)
app.get('/api/developer/download/:jobId/jsonl', requireAuth, requireRole('developer'), async (req, res) => {
    try {
        const { jobId } = req.params;
        const { pool } = require('./database');
        
        const result = await pool.query(
            `SELECT results
             FROM completed_jobs
             WHERE job_id = $1 AND developer_email = $2`,
            [jobId, req.user.email]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Job not found or access denied' });
        }
        
        const results = result.rows[0].results;
        
        // Convert to JSONL format
        const jsonl = results.map((result, index) => 
            JSON.stringify({ index: index + 1, result })
        ).join('\n');
        
        const filename = `nebula-results-${jobId}-${Date.now()}.jsonl`;
        
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(jsonl);
    } catch (error) {
        console.error('Failed to download JSONL results:', error);
        res.status(500).json({ error: 'Failed to download results' });
    }
});

// ─── Superuser Routes ───────────────────────────────────────────

app.get('/api/superuser/stats', requireAuth, requireRole('superuser'), async (req, res) => {
    const stats = await auth.getSuperuserStats();
    stats.activeWorkers = workers.length;
    stats.totalJobs = jobsCompleted;
    res.json(stats);
});

app.get('/api/superuser/flagged-workers', requireAuth, requireRole('superuser'), async (req, res) => {
    try {
        const flaggedWorkers = await canaryTracker.getFlaggedWorkers();
        res.json({ flaggedWorkers });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get flagged workers' });
    }
});

app.get('/api/superuser/worker-reputation', requireAuth, requireRole('superuser'), async (req, res) => {
    try {
        const { pool } = require('./database');
        
        // Get all workers with their reputation data
        const result = await pool.query(`
            SELECT 
                wm.worker_id,
                wm.user_email,
                wm.worker_type,
                wm.canary_pass_rate,
                wm.reputation_score,
                wm.chunks_completed,
                wm.chunks_failed,
                wm.last_active_at,
                COUNT(ct.id) as total_canaries,
                SUM(CASE WHEN ct.passed THEN 1 ELSE 0 END) as canaries_passed
            FROM worker_metrics wm
            LEFT JOIN canary_tracking ct ON wm.worker_id = ct.worker_id
            GROUP BY wm.worker_id, wm.user_email, wm.worker_type, wm.canary_pass_rate, 
                     wm.reputation_score, wm.chunks_completed, wm.chunks_failed, wm.last_active_at
            ORDER BY wm.last_active_at DESC
            LIMIT 100
        `);
        
        res.json({ workers: result.rows });
    } catch (error) {
        console.error('Failed to get worker reputation:', error);
        res.status(500).json({ error: 'Failed to get worker reputation' });
    }
});

app.get('/api/superuser/dead-letter-queue', requireAuth, requireRole('superuser'), async (req, res) => {
    try {
        const stats = await deadLetterManager.getDeadLetterStats();
        res.json(stats);
    } catch (error) {
        console.error('Failed to get DLQ stats:', error);
        res.status(500).json({ error: 'Failed to get dead letter queue stats' });
    }
});

app.get('/api/superuser/dead-letter-jobs', requireAuth, requireRole('superuser'), async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const jobs = await deadLetterManager.getDeadLetterJobs(limit);
        res.json({ jobs });
    } catch (error) {
        console.error('Failed to get DLQ jobs:', error);
        res.status(500).json({ error: 'Failed to get dead letter jobs' });
    }
});

app.post('/api/superuser/retry-dead-letter-job', requireAuth, requireRole('superuser'), async (req, res) => {
    try {
        const { jobId } = req.body;
        
        if (!jobId) {
            return res.status(400).json({ error: 'jobId is required' });
        }
        
        const newJobId = await deadLetterManager.retryDeadLetterJob(jobId);
        res.json({ 
            message: 'Job resubmitted successfully',
            originalJobId: jobId,
            newJobId
        });
    } catch (error) {
        console.error('Failed to retry DLQ job:', error);
        res.status(500).json({ error: error.message });
    }
});

// Admin endpoint to add credits to any user
app.post('/api/superuser/add-credits', requireAuth, requireRole('superuser'), async (req, res) => {
    try {
        const { email, amount } = req.body;
        
        if (!email || !amount) {
            return res.status(400).json({ error: 'email and amount are required' });
        }
        
        const user = await auth.getUserByEmail(email);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        await auth.updateUserCredits(email, parseInt(amount), 'add');
        
        res.json({ 
            message: `Added ${amount} credits to ${email}`,
            newBalance: user.credits + parseInt(amount)
        });
    } catch (error) {
        console.error('Failed to add credits:', error);
        res.status(500).json({ error: error.message });
    }
});

// Catch-all route to serve React app (frontendBuild already declared at top)
app.get('*', (req, res) => {
    res.sendFile(path.join(frontendBuild, 'index.html'));
});

server.listen(3000, () => {
    console.log('Nebula Master Node running on port 3000');
    console.log('\n=== Default Superuser Account ===');
    console.log('Email: founder@nebula.com');
    console.log('Password: nebula2024');
    console.log('================================\n');
});