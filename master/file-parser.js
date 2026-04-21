// File parsing utilities for CSV, JSON, JSONL, XLSX
const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx');

/**
 * Parse CSV file and extract tasks from specified column
 * @param {string} filePath - Path to CSV file
 * @param {string} columnName - Column name to extract (default: first column)
 * @returns {Promise<string[]>} Array of tasks
 */
async function parseCSV(filePath, columnName = null) {
    console.log(`[parseCSV] Starting CSV parse`);
    console.log(`[parseCSV] File path: ${filePath}`);
    console.log(`[parseCSV] Column name: ${columnName || 'auto-detect'}`);
    
    return new Promise((resolve, reject) => {
        const tasks = [];
        const stream = fs.createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
                // If no column specified, use first column
                const column = columnName || Object.keys(row)[0];
                const task = row[column];
                
                if (task && typeof task === 'string' && task.trim()) {
                    tasks.push(task.trim());
                }
            })
            .on('end', () => {
                console.log(`[parseCSV] Parsed ${tasks.length} tasks from CSV`);
                resolve(tasks);
            })
            .on('error', (error) => {
                console.log(`[parseCSV] ERROR:`, error);
                reject(error);
            });
    });
}

/**
 * Parse JSON file (array of objects or array of strings)
 * @param {string} filePath - Path to JSON file
 * @param {string} keyName - Key to extract from objects (if array of objects)
 * @returns {Promise<string[]>} Array of tasks
 */
async function parseJSON(filePath, keyName = null) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) return reject(err);
            
            try {
                const parsed = JSON.parse(data);
                
                if (!Array.isArray(parsed)) {
                    return reject(new Error('JSON must be an array'));
                }
                
                const tasks = [];
                
                for (const item of parsed) {
                    if (typeof item === 'string') {
                        // Array of strings
                        if (item.trim()) tasks.push(item.trim());
                    } else if (typeof item === 'object' && item !== null) {
                        // Array of objects
                        const key = keyName || Object.keys(item)[0];
                        const task = item[key];
                        
                        if (task && typeof task === 'string' && task.trim()) {
                            tasks.push(task.trim());
                        }
                    }
                }
                
                console.log(`Parsed ${tasks.length} tasks from JSON`);
                resolve(tasks);
            } catch (error) {
                reject(error);
            }
        });
    });
}

/**
 * Parse JSONL file (one JSON object per line)
 * @param {string} filePath - Path to JSONL file
 * @param {string} keyName - Key to extract from each object
 * @returns {Promise<string[]>} Array of tasks
 */
async function parseJSONL(filePath, keyName = null) {
    return new Promise((resolve, reject) => {
        fs.readFile(filePath, 'utf8', (err, data) => {
            if (err) return reject(err);
            
            try {
                const lines = data.split('\n').filter(line => line.trim());
                const tasks = [];
                
                for (const line of lines) {
                    const obj = JSON.parse(line);
                    const key = keyName || Object.keys(obj)[0];
                    const task = obj[key];
                    
                    if (task && typeof task === 'string' && task.trim()) {
                        tasks.push(task.trim());
                    }
                }
                
                console.log(`Parsed ${tasks.length} tasks from JSONL`);
                resolve(tasks);
            } catch (error) {
                reject(error);
            }
        });
    });
}

/**
 * Parse XLSX file and extract tasks from specified column
 * @param {string} filePath - Path to XLSX file
 * @param {string} columnName - Column name to extract (default: first column)
 * @returns {Promise<string[]>} Array of tasks
 */
async function parseXLSX(filePath, columnName = null) {
    return new Promise((resolve, reject) => {
        try {
            const workbook = XLSX.readFile(filePath);
            const sheetName = workbook.SheetNames[0]; // First sheet
            const sheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(sheet);
            
            const tasks = [];
            
            for (const row of data) {
                const column = columnName || Object.keys(row)[0];
                const task = row[column];
                
                if (task && typeof task === 'string' && task.trim()) {
                    tasks.push(task.trim());
                } else if (task && typeof task === 'number') {
                    tasks.push(String(task));
                }
            }
            
            console.log(`Parsed ${tasks.length} tasks from XLSX`);
            resolve(tasks);
        } catch (error) {
            reject(error);
        }
    });
}

/**
 * Auto-detect file type and parse accordingly
 * @param {string} filePath - Path to file
 * @param {object} options - Parsing options { column, key }
 * @returns {Promise<string[]>} Array of tasks
 */
async function parseFile(filePath, options = {}) {
    console.log(`[parseFile] Starting parse for: ${filePath}`);
    console.log(`[parseFile] Options:`, options);
    
    // Extract extension from file path
    const pathParts = filePath.split('.');
    if (pathParts.length < 2) {
        throw new Error(`File has no extension: ${filePath}`);
    }
    
    const ext = pathParts[pathParts.length - 1].toLowerCase();
    console.log(`[parseFile] Detected extension: ${ext}`);
    
    switch (ext) {
        case 'csv':
            console.log(`[parseFile] Using CSV parser`);
            return parseCSV(filePath, options.column);
        case 'json':
            console.log(`[parseFile] Using JSON parser`);
            return parseJSON(filePath, options.key);
        case 'jsonl':
            console.log(`[parseFile] Using JSONL parser`);
            return parseJSONL(filePath, options.key);
        case 'xlsx':
        case 'xls':
            console.log(`[parseFile] Using XLSX parser`);
            return parseXLSX(filePath, options.column);
        default:
            throw new Error(`Unsupported file type: ${ext}`);
    }
}

module.exports = {
    parseCSV,
    parseJSON,
    parseJSONL,
    parseXLSX,
    parseFile
};
