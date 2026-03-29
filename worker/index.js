const { io } = require('socket.io-client');
const { encrypt, decrypt } = require('../shared/chunk');

const socket = io('https://nebula-mk65.onrender.com', {
    query: { type: 'worker' }
});

let sessionKey = null;

socket.on('connect', () => {
    console.log('Connected to Nebula master as worker:', socket.id);
});

socket.on('session-key', (keyHex) => {
    sessionKey = Buffer.from(keyHex, 'hex');
    console.log('Session key received — ready to process chunks');
});

socket.on('task-chunk', async (data) => {
    if (!sessionKey) {
        console.log('No session key yet — ignoring chunk');
        return;
    }

    if (typeof data.chunk === 'string' && data.chunk.startsWith('PLAIN:')) {
        console.log('Received wrong format — skipping');
        return;
    }

    const { jobId, chunk } = decrypt(data.chunk, sessionKey);
    console.log(`Received chunk of ${chunk.length} tasks for job ${jobId}`);

    const result = await Promise.all(chunk.map(task => processTask(task)));

    socket.emit('chunk-result', encrypt({ jobId, result }, sessionKey));
    console.log(`Results sent back for job ${jobId}`);
});

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
    sessionKey = null;
    console.log('Disconnected from master — session key cleared');
});