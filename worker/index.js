// worker/index.js
const { io } = require('socket.io-client');
const { encrypt, decrypt } = require('../shared/chunk');

const socket = io('http://localhost:3000');

socket.on('connect', () => {
    console.log('Connected to Nebula master as worker:', socket.id);
});

socket.on('task-chunk', async (data) => {
    // Decrypt the incoming chunk
    const chunk = decrypt(data.chunk);
    console.log(`Received encrypted chunk of ${chunk.length} tasks`);

    const results = await Promise.all(chunk.map(task => processTask(task)));

    // Encrypt results before sending back
    socket.emit('chunk-result', encrypt(results));
    console.log('Encrypted results sent back to master');
});

function processTask(task) {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve(`Processed: ${task}`);
        }, 5000);
    });
}

socket.on('disconnect', () => {
    console.log('Disconnected from master');
});