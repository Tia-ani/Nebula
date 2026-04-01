const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { splitIntoChunks, assembleResults, encrypt, decrypt } = require('./chunk');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const auth = require('./auth');
const connectDB = require('./db');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

// Connect to MongoDB
connectDB();

// Serve React build in production
const frontendBuild = path.join(__dirname, '../frontend/build');
app.use(express.static(frontendBuild));

// API routes (defined before catch-all)
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
        workers.push({ id: socket.id, type, sessionKey, userEmail });

        // Send session key to worker immediately on connect
        socket.emit('session-key', sessionKey.toString('hex'));

        emitDashboardUpdate();
    }

    socket.on('chunk-result', async (data) => {
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
        const chunkSize = job.workerChunkMap[socket.id]?.length || 0;
        delete job.workerChunkMap[socket.id];

        // Credit the contributor for completing this chunk
        if (worker.userEmail && chunkSize > 0) {
            const creditsPerTask = worker.type === 'browser-worker' ? 10 : worker.type === 'gpu-worker' ? 100 : 50;
            const creditsEarned = chunkSize * creditsPerTask;
            
            try {
                await auth.updateUserCredits(worker.userEmail, creditsEarned, 'add');
                console.log(`Credited ${creditsEarned} credits to ${worker.userEmail} for ${chunkSize} tasks`);
                
                // Notify the worker about credits earned
                socket.emit('credits-earned', { amount: creditsEarned, tasks: chunkSize });
            } catch (error) {
                console.error('Failed to credit user:', error);
            }
        }

        console.log(`Job ${jobId} progress: ${job.pendingResults.length}/${job.totalChunks}`);

        if (job.pendingResults.length === job.totalChunks) {
            const finalResult = assembleResults(job.pendingResults);
            console.log(`Job ${jobId} complete!`);

            jobsCompleted++;
            tasksProcessed += finalResult.length;
            const jobIndex = recentJobs.findIndex(j => j.id === jobId);
            if (jobIndex !== -1) recentJobs[jobIndex].status = 'complete';
            emitDashboardUpdate();

            // Send result back to developer
            if (job.res) {
                job.res.json({ jobId, result: finalResult });
            }
            
            // Notify developer about job completion
            if (job.developerEmail) {
                io.emit('job-complete', { jobId, result: finalResult, developerEmail: job.developerEmail });
            }
            
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
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    const token = authHeader.substring(7);
    const user = await auth.verifyToken(token);
    
    if (!user) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    req.user = user;
    next();
}

// Middleware to require specific role
function requireRole(...roles) {
    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }
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

// ─── Contributor Routes ───────────────────────────────────────────

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
    
    // Deduct credits
    await auth.updateUserCredits(req.user.email, totalCost, 'subtract');
    user.creditsSpent = (user.creditsSpent || 0) + totalCost;
    user.jobsSubmitted = (user.jobsSubmitted || 0) + 1;
    await user.save();
    
    // Submit job (reuse existing job submission logic)
    const jobId = uuidv4();
    jobs[jobId] = {
        totalChunks: 0,
        pendingResults: [],
        workerChunkMap: {},
        res,
        developerEmail: req.user.email // Track who submitted the job
    };

    const chunks = splitIntoChunks(tasks, workers.length);
    jobs[jobId].totalChunks = chunks.length;

    console.log(`[Developer Job] ${req.user.email} - Job ${jobId} - ${chunks.length} chunks - ${totalCost} credits`);

    recentJobs.push({ id: jobId, chunks: chunks.length, status: 'running', developerEmail: req.user.email });
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

// ─── Superuser Routes ───────────────────────────────────────────

app.get('/api/superuser/stats', requireAuth, requireRole('superuser'), async (req, res) => {
    const stats = await auth.getSuperuserStats();
    stats.activeWorkers = workers.length;
    stats.totalJobs = jobsCompleted;
    res.json(stats);
});

// Catch-all route to serve React app
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