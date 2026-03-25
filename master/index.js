const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { splitIntoChunks, assembleResults, encrypt, decrypt } = require('../shared/chunk');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());

app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

app.use(express.static('dashboard'));

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
        workers.push({ id: socket.id, type });
        emitDashboardUpdate();
    }

    socket.on('chunk-result', (data) => {
        let jobId, result;

        if (typeof data === 'string' && data.startsWith('PLAIN:')) {
            const parsed = JSON.parse(data.replace('PLAIN:', ''));
            jobId = parsed.jobId;
            result = parsed.result;
        } else {
            const decrypted = decrypt(data);
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
        workers = workers.filter(w => w.id !== socket.id);
        emitDashboardUpdate();
        console.log(`Worker disconnected: ${socket.id}`);

        Object.keys(jobs).forEach(jobId => {
            const job = jobs[jobId];

            if (job.workerChunkMap[socket.id]) {
                const lostChunk = job.workerChunkMap[socket.id];
                delete job.workerChunkMap[socket.id];

                console.log(`Chunk lost from job ${jobId}! Reassigning...`);

                if (workers.length > 0) {
                    const newWorker = workers[0];
                    job.workerChunkMap[newWorker.id] = lostChunk;
                    io.to(newWorker.id).emit('task-chunk', { chunk: lostChunk });
                    console.log(`Chunk reassigned to: ${newWorker.id}`);
                } else {
                    console.log('No workers available to reassign chunk!');
                }
            }
        });
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
            payload = encrypt({ jobId, chunk });
        }

        jobs[jobId].workerChunkMap[worker.id] = payload;
        io.to(worker.id).emit('task-chunk', { chunk: payload });
    });
});

server.listen(3000, () => {
    console.log('Nebula Master Node running on port 3000');
});