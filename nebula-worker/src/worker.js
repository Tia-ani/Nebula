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

async function pullModel(modelName) {
    console.log(`\n📥 Downloading ${modelName}...`);
    console.log('This may take a few minutes on first run.\n');
    
    try {
        const response = await fetch('http://localhost:11434/api/pull', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: modelName, stream: true })
        });

        if (!response.ok) {
            throw new Error(`Failed to pull model: ${response.statusText}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let lastStatus = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.trim());

            for (const line of lines) {
                try {
                    const data = JSON.parse(line);
                    if (data.status && data.status !== lastStatus) {
                        process.stdout.write(`\r${data.status}...`);
                        lastStatus = data.status;
                    }
                } catch (e) {
                    // Ignore parse errors
                }
            }
        }

        console.log('\n✓ Model downloaded successfully!\n');
        return true;
    } catch (err) {
        console.error(`\n✗ Failed to download model: ${err.message}`);
        return false;
    }
}

async function detectModel(preferredModel) {
    const defaultModel = 'llama3.2';  // Back to llama3.2 - it works reliably
    
    try {
        const res = await fetch('http://localhost:11434/api/tags');
        const data = await res.json();
        const models = data.models || [];

        const targetModel = preferredModel || defaultModel;

        // Check if target model exists
        const match = models.find(m => m.name.includes(targetModel.split(':')[0]));
        
        if (!match) {
            console.log(`\n Model "${targetModel}" not found locally.`);
            console.log(' Auto-installing...\n');
            
            const success = await pullModel(targetModel);
            if (!success) {
                console.log('\n Manual installation:');
                console.log(` Run: ollama pull ${targetModel}`);
                console.log(' Then restart nebula-worker\n');
                process.exit(1);
            }
            
            return targetModel;
        }

        return match.name;

    } catch (err) {
        console.log('\n Ollama not detected on your machine.');
        console.log('');
        console.log(' To contribute compute and earn credits:');
        console.log(' 1. Install Ollama  →  https://ollama.ai');
        console.log(' 2. Restart nebula-worker (model will auto-install)');
        console.log('');
        console.log(' Browser worker available at the dashboard — no install needed.');
        console.log('');
        process.exit(1);
    }
}

async function processTask(task, model, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Handle undefined or null tasks
            if (!task || typeof task !== 'string') {
                console.log(`  ⚠️  Skipping invalid task: ${task}`);
                return `Error: Invalid task input`;
            }
            
            const response = await fetch('http://localhost:11434/api/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, prompt: task, stream: false })
            });
            
            if (!response.ok) {
                console.log(`  ⚠️  Ollama HTTP error: ${response.status} ${response.statusText}`);
                
                if (attempt < maxRetries) {
                    console.log(`  🔄 Retrying (${attempt}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
                    continue;
                }
                return `Error: Ollama returned ${response.status}`;
            }
            
            const data = await response.json();
            
            // Handle undefined response from Ollama
            if (!data.response || typeof data.response !== 'string') {
                return `Error: Invalid response from model`;
            }
            
            return data.response.trim();
        } catch (err) {
            console.log(`  ⚠️  Exception in processTask (attempt ${attempt}/${maxRetries}):`, err.message);
            
            if (err.message.includes('fetch failed') || err.message.includes('ECONNREFUSED')) {
                if (attempt < maxRetries) {
                    console.log(`  🔄 Ollama may have crashed. Waiting 5s before retry...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    continue;
                }
                return `Error: Ollama connection failed after ${maxRetries} attempts`;
            }
            
            return `Error: ${err.message}`;
        }
    }
    
    return `Error: Failed after ${maxRetries} attempts`;
}

async function startWorker(masterUrl, preferredModel, userEmail) {
    console.log('\n⚡ Nebula Worker\n');
    console.log(`Connecting to master: ${masterUrl}`);
    
    if (userEmail) {
        console.log(`Account: ${userEmail}`);
    } else {
        console.log('⚠️  No email provided - credits will not be tracked');
        console.log('   Use: npx nebula-worker start --email your@email.com\n');
    }

    // Check Ollama first
    const model = await detectModel(preferredModel);
    console.log(`Using model: ${model}`);

    let sessionKey = null;
    let tasksProcessed = 0;
    let chunksProcessed = 0;
    
    // Rate limiting
    let requestCount = 0;
    let windowStart = Date.now();
    const MAX_REQUESTS_PER_MINUTE = 30;

    const socket = io(masterUrl, {
        query: { 
            type: 'worker',
            userEmail: userEmail || ''
        },
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

    socket.on('credits-earned', (data) => {
        console.log(`\n💰 Earned ${data.amount} credits for ${data.tasks} tasks!`);
    });
    
    socket.on('take-break', (data) => {
        console.log(`\n⏸️  Server suggests taking a ${data.duration / 1000}s break to prevent overload`);
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
            
            // Debug: Check for undefined in chunk
            const undefinedCount = chunk.filter(t => !t).length;
            if (undefinedCount > 0) {
                console.log(`⚠️  WARNING: Received ${undefinedCount} undefined tasks in chunk!`);
                console.log(`Chunk contents:`, chunk);
            }
        } catch (err) {
            console.error('Failed to decrypt chunk:', err.message);
            return;
        }

        console.log(`\nJob ${jobId.slice(0, 8)}... → ${chunk.length} tasks`);

        const results = await Promise.all(
            chunk.map(async (task, i) => {
                // Handle undefined/null tasks
                if (!task || typeof task !== 'string') {
                    console.log(`  ⚠️  Task ${i + 1} is invalid:`, task);
                    return `Error: Invalid task`;
                }
                
                // Rate limiting check
                const now = Date.now();
                if (now - windowStart >= 60000) {
                    // Reset window
                    windowStart = now;
                    requestCount = 0;
                }
                
                if (requestCount >= MAX_REQUESTS_PER_MINUTE) {
                    const waitTime = 60000 - (now - windowStart);
                    console.log(`  ⏸️  Rate limit reached (${MAX_REQUESTS_PER_MINUTE}/min). Waiting ${Math.ceil(waitTime / 1000)}s...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    windowStart = Date.now();
                    requestCount = 0;
                }
                
                requestCount++;
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