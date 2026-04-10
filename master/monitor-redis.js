// Monitor Redis activity in real-time
require('dotenv').config();
const { redis } = require('./redis');
const { workerRegistry } = require('./queue');

async function monitor() {
    console.log('\n=== Redis Activity Monitor ===\n');
    console.log('Watching for worker connections and job activity...\n');
    
    setInterval(async () => {
        try {
            // Get active workers
            const workers = await workerRegistry.getActiveWorkers();
            const workerCount = workers.length;
            
            // Get job keys
            const jobKeys = await redis.keys('job:*');
            const jobCount = jobKeys.filter(k => !k.includes('pending-chunks')).length;
            
            // Get chunk keys
            const chunkKeys = await redis.keys('chunk:*');
            
            // Clear screen and show status
            console.clear();
            console.log('\n=== Redis Activity Monitor ===\n');
            console.log(`Active Workers: ${workerCount}`);
            console.log(`Active Jobs: ${jobCount}`);
            console.log(`Pending Chunks: ${chunkKeys.length}`);
            console.log('\nWorkers:');
            
            if (workers.length === 0) {
                console.log('  (none)');
            } else {
                workers.forEach(w => {
                    const timeSinceHeartbeat = Date.now() - w.lastHeartbeat;
                    console.log(`  - ${w.id.substring(0, 8)}... (${w.type})`);
                    console.log(`    Email: ${w.userEmail || 'anonymous'}`);
                    console.log(`    Last heartbeat: ${Math.floor(timeSinceHeartbeat / 1000)}s ago`);
                });
            }
            
            console.log('\n[Press Ctrl+C to exit]');
            
        } catch (error) {
            console.error('Monitor error:', error.message);
        }
    }, 2000); // Update every 2 seconds
}

monitor();

process.on('SIGINT', () => {
    console.log('\n\nMonitor stopped.\n');
    redis.quit();
    process.exit(0);
});
