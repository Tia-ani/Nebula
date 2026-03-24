const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { splitIntoChunks, assembleResults, encrypt, decrypt } = require('../shared/chunk');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(express.static('dashboard'));

const server = http.createServer(app);
const io = new Server(server);

let workers = [];

// Each job lives in its own isolated object
let jobs = {};

// Track global stats
let jobsCompleted = 0;
let tasksProcessed = 0;
let recentJobs = [];

function emitDashboardUpdate() {
    io.emit('dashboard-update', {
        workerCount: workers.length,
        workers: workers,
        jobsRunning: Object.keys(jobs).length,
        jobsCompleted,
        tasksProcessed,
        jobs: recentJobs.slice(-10) // last 10 jobs
    });
}

io.on('connection', (socket) => {
    console.log(`Worker connected: ${socket.id}`);
    workers.push(socket.id);
    emitDashboardUpdate()

    socket.on('chunk-result', (data) => {
        const { jobId, result } = decrypt(data);
        
        // Find the right job
        const job = jobs[jobId];
        if (!job) return;

        job.pendingResults.push(result);
        delete job.workerChunkMap[socket.id];

        console.log(`Job ${jobId} progress: ${job.pendingResults.length}/${job.totalChunks}`);

        // If all chunks for THIS job are done
        if (job.pendingResults.length === job.totalChunks) {
            const finalResult = assembleResults(job.pendingResults);
            console.log(`Job ${jobId} complete!`);

            jobsCompleted++;
            tasksProcessed += finalResult.length;
            const jobIndex = recentJobs.findIndex(j => j.id === jobId);
            if (jobIndex !== -1) recentJobs[jobIndex].status = 'complete';
            emitDashboardUpdate();
            
            // Send result back to the right customer
            job.res.json({ jobId, result: finalResult });
            
            // Clean up
            delete jobs[jobId];
        }
    });

    socket.on('disconnect', () => {
        workers = workers.filter(id => id !== socket.id);
        emitDashboardUpdate()
        console.log(`Worker disconnected: ${socket.id}`);

        // Check all jobs for lost chunks
        Object.keys(jobs).forEach(jobId => {
            const job = jobs[jobId];
            
            if (job.workerChunkMap[socket.id]) {
                const lostChunk = job.workerChunkMap[socket.id];
                delete job.workerChunkMap[socket.id];

                console.log(`Chunk lost from job ${jobId}! Reassigning...`);

                if (workers.length > 0) {
                    const newWorker = workers[0];
                    job.workerChunkMap[newWorker] = lostChunk;
                    io.to(newWorker).emit('task-chunk', { chunk: lostChunk });
                    console.log(`Chunk reassigned to: ${newWorker}`);
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

    // Give this job a unique ID
    const jobId = uuidv4();

    // Create isolated job object
    jobs[jobId] = {
        totalChunks: 0,
        pendingResults: [],
        workerChunkMap: {},
        res // Save the response object to reply to THIS customer later
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
        const workerId = workers[index];
        const encryptedChunk = encrypt({ jobId, chunk });

        jobs[jobId].workerChunkMap[workerId] = encryptedChunk;
        io.to(workerId).emit('task-chunk', { chunk: encryptedChunk });
    });
});

server.listen(3000, () => {
    console.log('Nebula Master Node running on port 3000');
});