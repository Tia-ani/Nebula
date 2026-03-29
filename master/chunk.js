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

function splitIntoChunks(tasks, numWorkers) {
    const chunks = [];
    const chunkSize = Math.ceil(tasks.length / numWorkers);
    for (let i = 0; i < tasks.length; i += chunkSize) {
        chunks.push(tasks.slice(i, i + chunkSize));
    }
    return chunks;
}

function assembleResults(results) {
    return results.flat();
}

module.exports = { splitIntoChunks, assembleResults, encrypt, decrypt };