const Redis = require('ioredis');

// Redis connection for general use
const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    maxRetriesPerRequest: null, // Required for BullMQ
    retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    }
});

redis.on('connect', () => {
    console.log('✓ Connected to Redis');
});

redis.on('error', (err) => {
    console.error('Redis connection error:', err);
});

// Separate connection for pub/sub (BullMQ requirement)
const subscriber = redis.duplicate();

module.exports = { redis, subscriber };
