const { io } = require('socket.io-client');
const { encrypt, decrypt } = require('../shared/chunk');

const socket = io('http://localhost:3000', {
    query: { type: 'worker' }
});

socket.on('connect', () => {
    console.log('Connected to Nebula master as worker:', socket.id);
});

socket.on('task-chunk', async (data) => {
    const { jobId, chunk } = decrypt(data.chunk);
    console.log(`Received chunk of ${chunk.length} tasks for job ${jobId}`);

    const result = await Promise.all(chunk.map(task => processTask(task)));

    socket.emit('chunk-result', encrypt({ jobId, result }));
    console.log(`Results sent back for job ${jobId}`);
});

// REAL AI INFERENCE
async function processTask(task) {
    try {
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'llama3.2',
                prompt: task,
                stream: false
            })
        });

        const data = await response.json();
        return data.response.trim();

    } catch (error) {
        console.error('AI inference failed:', error.message);
        return `Error processing task: ${error.message}`;
    }
}

socket.on('disconnect', () => {
    console.log('Disconnected from master');
});