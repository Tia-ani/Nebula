const { io } = require('socket.io-client');
const { encrypt, decrypt } = require('../shared/chunk');

const socket = io('http://localhost:3000');

socket.on('connect', () => {
    console.log('Connected to Nebula master as worker:', socket.id);
});

socket.on('task-chunk', async (data) => {
    const { jobId, chunk } = decrypt(data.chunk);
    console.log(`Received chunk of ${chunk.length} tasks for job ${jobId}`);

    const result = await Promise.all(chunk.map(task => processTask(task)));

    // Send result back WITH jobId so master knows which job this belongs to
    socket.emit('chunk-result', encrypt({ jobId, result }));
    console.log(`Results sent back for job ${jobId}`);
});

function processTask(task) {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve(`Processed: ${task}`);
        }, 2000);
    });
}

socket.on('disconnect', () => {
    console.log('Disconnected from master');
});