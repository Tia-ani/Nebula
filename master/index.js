const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { splitIntoChunks, assembleResults, encrypt, decrypt } = require('../shared/chunk');

const app = express();
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server);

let workers = [];
let pendingResults = [];
let totalChunks = 0;

// NEW: track which worker has which chunk
let workerChunkMap = {};

io.on('connection', (socket) => {
    console.log(`Worker connected: ${socket.id}`);
    workers.push(socket.id);

    socket.on('chunk-result', (data) => {
        pendingResults.push(decrypt(data));
        
        // NEW: remove from tracking once done
        delete workerChunkMap[socket.id];
        
        console.log(`Got result from ${socket.id}`);
        console.log(`Progress: ${pendingResults.length}/${totalChunks}`);

        if (pendingResults.length === totalChunks) {
            const finalResult = assembleResults(pendingResults);
            console.log('Job complete:', finalResult);
            pendingResults = [];
            workerChunkMap = {};
        }
    });

    socket.on('disconnect', () => {
        workers = workers.filter(id => id !== socket.id);
        console.log(`Worker disconnected: ${socket.id}`);

        // NEW: check if this worker had an unfinished chunk
        if (workerChunkMap[socket.id]) {
            const lostChunk = workerChunkMap[socket.id];
            delete workerChunkMap[socket.id];
            
            console.log(`Chunk lost! Reassigning...`);

            // Reassign to another available worker
            if (workers.length > 0) {
                const newWorker = workers[0];
                workerChunkMap[newWorker] = lostChunk;
                io.to(newWorker).emit('task-chunk', { chunk: lostChunk });
                console.log(`Chunk reassigned to: ${newWorker}`);
            } else {
                console.log('No workers available to reassign chunk!');
            }
        }
    });
});

app.post('/job', (req, res) => {
    const { tasks } = req.body;

    if (workers.length === 0) {
        return res.status(400).json({ error: 'No workers available' });
    }

    const chunks = splitIntoChunks(tasks, workers.length);
    totalChunks = chunks.length;
    pendingResults = [];
    workerChunkMap = {};

    chunks.forEach((chunk, index) => {
        const workerId = workers[index];
        const encryptedChunk = encrypt(chunk);
        
        // Store encrypted version so reassignment also sends encrypted
        workerChunkMap[workerId] = encryptedChunk;
        io.to(workerId).emit('task-chunk', { chunk: encryptedChunk });
    });

    res.json({ message: 'Job started', chunks: chunks.length });
});

server.listen(3000, () => {
    console.log('Nebula Master Node running on port 3000');
});