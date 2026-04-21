const crypto = require('crypto');
const IV_LENGTH = 16;

function encrypt(data, sessionKey) {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-cbc', sessionKey, iv);
    const jsonData = JSON.stringify(data);
    let encrypted = cipher.update(jsonData, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + encrypted;
}

function decrypt(encryptedData, sessionKey) {
    const ivHex = encryptedData.slice(0, 32);
    const encrypted = encryptedData.slice(32);
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', sessionKey, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
}

function splitIntoChunks(tasks, numWorkers, workerTypes = []) {
    const chunks = [];
    let taskIndex = 0;
    
    // If we have worker type information, use smart chunking
    if (workerTypes.length > 0) {
        // Create worker info with indices
        const workers = workerTypes.map((type, idx) => ({
            index: idx,
            type: type,
            chunkSize: type === 'browser-worker' ? 25 : 
                      type === 'gpu-worker' ? 200 : 100
        }));
        
        // Sort by chunk size (smallest first) to ensure fair distribution
        workers.sort((a, b) => a.chunkSize - b.chunkSize);
        
        // Distribute tasks round-robin across all workers (starting with smallest capacity)
        let workerIdx = 0;
        while (taskIndex < tasks.length) {
            const worker = workers[workerIdx % workers.length];
            
            const chunk = tasks.slice(taskIndex, taskIndex + worker.chunkSize);
            if (chunk.length > 0) {
                chunks.push({
                    tasks: chunk,
                    workerIndex: worker.index // Use original worker index
                });
                taskIndex += chunk.length;
            }
            workerIdx++;
        }
    } else {
        // Fallback: equal distribution
        const chunkSize = Math.ceil(tasks.length / numWorkers);
        for (let i = 0; i < tasks.length; i += chunkSize) {
            chunks.push({
                tasks: tasks.slice(i, i + chunkSize),
                workerIndex: Math.floor(i / chunkSize) % numWorkers
            });
        }
    }
    
    return chunks;
}

function assembleResults(results) {
    return results.flat();
}

module.exports = { splitIntoChunks, assembleResults, encrypt, decrypt };