const { io } = require('socket.io-client');
const crypto = require('crypto');

const IV_LENGTH = 16;

function encrypt(data, sessionKey) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', sessionKey, iv);
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + encrypted;
}

function decrypt(encryptedData, sessionKey) {
    const iv = Buffer.from(encryptedData.slice(0, 32), 'hex');
    const encrypted = encryptedData.slice(32);
    const decipher = crypto.createDecipheriv('aes-256-cbc', sessionKey, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
}

async function detectModel(preferredModel) {
    try {
        const res = await fetch('http://localhost:11434/api/tags');
        const data = await res.json();
        const models = data.models || [];

        if (models.length === 0) {
            console.log('\n Ollama is running but no models are installed.');
            console.log(' Run: ollama pull llama3.2');
            console.log(' Then restart nebula-worker\n');
            process.exit(1);
        }

        if (preferredModel) {
            const match = models.find(m => m.name.includes(preferredModel));
            if (!match) {
                console.warn(`Model "${preferredModel}" not found. Using "${models[0].name}" instead.`);
                return models[0].name;
            }
            return match.name;
        }

        const preferred = models.find(m => m.name.includes('llama3.2'));
        return preferred ? preferred.name : models[0].name;

    } catch (err) {
        console.log('\n Ollama not detected on your machine.');
        console.log('');
        console.log(' To contribute compute and earn credits:');
        console.log(' 1. Install Ollama  →  https://ollama.ai');
        console.log(' 2. Run: ollama pull llama3.2');
        console.log(' 3. Restart nebula-worker');
        console.log('');
        console.log(' Browser worker coming soon — no install needed.');
        console.log('');
        process.exit(1);
    }
}

async function processTask(task, model) {
    try {
        const response = await fetch('http://localhost:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt: task, stream: false })
        });
        const data = await response.json();
        return data.response.trim();
    } catch (err) {
        return `Error: ${err.message}`;
    }
}

async function startWorker(masterUrl, preferredModel) {
    console.log('\n⚡ Nebula Worker\n');
    console.log(`Connecting to master: ${masterUrl}`);

    // Check Ollama first
    const model = await detectModel(preferredModel);
    console.log(`Using model: ${model}`);

    let sessionKey = null;
    let tasksProcessed = 0;
    let chunksProcessed = 0;

    const socket = io(masterUrl, {
        query: { type: 'worker' },
        reconnection: true,
        reconnectionDelay: 2000,
    });

    socket.on('connect', () => {
        console.log(`Connected ✓  (id: ${socket.id})`);
        console.log('Waiting for work...\n');
    });

    socket.on('session-key', (keyHex) => {
        sessionKey = Buffer.from(keyHex, 'hex');
        console.log('Session key received ✓');
    });

    socket.on('task-chunk', async (data) => {
        if (!sessionKey) {
            console.log('No session key yet — skipping chunk');
            return;
        }

        let jobId, chunk;

        if (typeof data.chunk === 'string' && data.chunk.startsWith('PLAIN:')) {
            console.log('Received wrong format — skipping');
            return;
        }

        try {
            const decoded = decrypt(data.chunk, sessionKey);
            jobId = decoded.jobId;
            chunk = decoded.chunk;
        } catch (err) {
            console.error('Failed to decrypt chunk:', err.message);
            return;
        }

        console.log(`\nJob ${jobId.slice(0, 8)}... → ${chunk.length} tasks`);

        const results = await Promise.all(
            chunk.map(async (task, i) => {
                console.log(`  Processing task ${i + 1}/${chunk.length}...`);
                const result = await processTask(task, model);
                tasksProcessed++;
                return result;
            })
        );

        chunksProcessed++;
        console.log(`  Done ✓  (${tasksProcessed} tasks total, ${chunksProcessed} chunks)`);

        socket.emit('chunk-result', encrypt({ jobId, result: results }, sessionKey));
    });

    socket.on('disconnect', () => {
        sessionKey = null;
        console.log('\nDisconnected from master. Reconnecting...');
    });

    socket.on('connect_error', (err) => {
        console.error(`Connection failed: ${err.message}`);
        console.log('Retrying in 2 seconds...');
    });
}

module.exports = { startWorker };