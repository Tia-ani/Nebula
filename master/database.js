const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

// Database configuration
const config = {
    // Use environment variables in production
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'nebula',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    
    // Connection pool settings
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
};

// Create connection pool
const pool = new Pool(config);

// Handle pool errors
pool.on('error', (err, client) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
});

// Test connection
pool.on('connect', () => {
    console.log('✓ Connected to PostgreSQL database');
});

/**
 * Execute a query
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 * @returns {Promise} Query result
 */
async function query(text, params) {
    const start = Date.now();
    try {
        const res = await pool.query(text, params);
        const duration = Date.now() - start;
        
        if (duration > 1000) {
            console.warn(`Slow query (${duration}ms):`, text.substring(0, 100));
        }
        
        return res;
    } catch (error) {
        console.error('Database query error:', error);
        throw error;
    }
}

/**
 * Execute a transaction
 * @param {Function} callback - Transaction callback
 * @returns {Promise} Transaction result
 */
async function transaction(callback) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Run migrations
 */
async function runMigrations() {
    const migrationsDir = path.join(__dirname, 'migrations');
    
    // Create migrations table if it doesn't exist
    await query(`
        CREATE TABLE IF NOT EXISTS migrations (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) UNIQUE NOT NULL,
            executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);
    
    // Get executed migrations
    const { rows: executed } = await query('SELECT name FROM migrations');
    const executedNames = new Set(executed.map(r => r.name));
    
    // Get migration files
    const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();
    
    // Execute pending migrations
    for (const file of files) {
        if (executedNames.has(file)) {
            console.log(`✓ Migration ${file} already executed`);
            continue;
        }
        
        console.log(`Running migration ${file}...`);
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        
        await transaction(async (client) => {
            await client.query(sql);
            await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
        });
        
        console.log(`✓ Migration ${file} completed`);
    }
    
    console.log('✓ All migrations completed');
}

/**
 * Create default superuser if not exists
 */
async function createDefaultSuperuser() {
    const bcrypt = require('bcrypt');
    const email = 'founder@nebula.com';
    const password = 'nebula2024';
    
    const { rows } = await query('SELECT id FROM users WHERE email = $1', [email]);
    
    if (rows.length === 0) {
        const passwordHash = await bcrypt.hash(password, 10);
        
        await query(`
            INSERT INTO users (email, name, password_hash, role, credits)
            VALUES ($1, $2, $3, $4, $5)
        `, [email, 'Founder', passwordHash, 'superuser', 1000000]);
        
        console.log('✓ Created default superuser account');
        console.log('  Email:', email);
        console.log('  Password:', password);
    }
}

/**
 * Initialize database
 */
async function initialize() {
    try {
        console.log('Initializing database...');
        await runMigrations();
        await createDefaultSuperuser();
        console.log('✓ Database initialized successfully');
    } catch (error) {
        console.error('Database initialization failed:', error);
        throw error;
    }
}

module.exports = {
    query,
    transaction,
    pool,
    initialize
};
