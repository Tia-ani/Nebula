// Canary Result Tracker
// Tracks canary results per worker for reputation scoring

const { pool } = require('./database');
const { validateCanary, evaluateWorker } = require('./canary');

class CanaryTracker {
    // Record a canary result
    async recordCanaryResult(workerId, userEmail, canaryId, expected, actual, jobId, chunkId) {
        const passed = validateCanary(actual, expected);
        
        try {
            // Insert into canary_tracking table
            await pool.query(`
                INSERT INTO canary_tracking (
                    worker_id,
                    user_email,
                    canary_id,
                    expected_pattern,
                    actual_output,
                    passed,
                    job_id,
                    chunk_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [workerId, userEmail, canaryId, expected.toString(), actual, passed, jobId, chunkId]);
            
            // Update worker metrics
            await this.updateWorkerMetrics(workerId, userEmail, passed);
            
            return { passed, canaryId };
        } catch (error) {
            console.error('Error recording canary result:', error);
            throw error;
        }
    }
    
    // Update worker metrics based on canary performance
    async updateWorkerMetrics(workerId, userEmail, passed) {
        try {
            // Get or create worker metrics (use worker_id as unique identifier)
            const existing = await pool.query(`
                SELECT * FROM worker_metrics WHERE worker_id = $1
            `, [workerId]);
            
            if (existing.rows.length === 0) {
                // Create new metrics
                await pool.query(`
                    INSERT INTO worker_metrics (
                        worker_id,
                        worker_type,
                        user_email,
                        chunks_completed,
                        canary_pass_rate
                    ) VALUES ($1, 'browser-worker', $2, 0, 100.00)
                `, [workerId, userEmail]);
            }
            
            // Recalculate pass rate from canary_tracking
            const stats = await pool.query(`
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN passed THEN 1 ELSE 0 END) as passed
                FROM canary_tracking
                WHERE worker_id = $1
            `, [workerId]);
            
            const total = parseInt(stats.rows[0].total);
            const passedCount = parseInt(stats.rows[0].passed);
            const passRate = total > 0 ? (passedCount / total) * 100 : 100;
            
            // Update metrics
            await pool.query(`
                UPDATE worker_metrics
                SET 
                    canary_pass_rate = $1,
                    reputation_score = $1,
                    updated_at = NOW()
                WHERE worker_id = $2
            `, [passRate.toFixed(2), workerId]);
            
            return { passRate, total, passed: passedCount };
        } catch (error) {
            console.error('Error updating worker metrics:', error);
            throw error;
        }
    }
    
    // Get worker canary performance by email (across all socket connections)
    async getWorkerPerformanceByEmail(userEmail) {
        try {
            const result = await pool.query(`
                SELECT 
                    COUNT(*) as total_canaries,
                    SUM(CASE WHEN passed THEN 1 ELSE 0 END) as passed,
                    SUM(CASE WHEN NOT passed THEN 1 ELSE 0 END) as failed,
                    AVG(CASE WHEN passed THEN 1.0 ELSE 0.0 END) * 100 as pass_rate
                FROM canary_tracking
                WHERE user_email = $1
            `, [userEmail]);
            
            const row = result.rows[0];
            return {
                totalCanaries: parseInt(row.total_canaries) || 0,
                passed: parseInt(row.passed) || 0,
                failed: parseInt(row.failed) || 0,
                passRate: parseFloat(row.pass_rate) || 100.0
            };
        } catch (error) {
            console.error('Error getting worker performance by email:', error);
            return { totalCanaries: 0, passed: 0, failed: 0, passRate: 100.0 };
        }
    }
    
    // Get worker canary performance
    async getWorkerPerformance(workerId) {
        try {
            const result = await pool.query(`
                SELECT 
                    COUNT(*) as total_canaries,
                    SUM(CASE WHEN passed THEN 1 ELSE 0 END) as passed,
                    SUM(CASE WHEN NOT passed THEN 1 ELSE 0 END) as failed,
                    AVG(CASE WHEN passed THEN 1.0 ELSE 0.0 END) * 100 as pass_rate
                FROM canary_tracking
                WHERE worker_id = $1
            `, [workerId]);
            
            const row = result.rows[0];
            return {
                totalCanaries: parseInt(row.total_canaries) || 0,
                passed: parseInt(row.passed) || 0,
                failed: parseInt(row.failed) || 0,
                passRate: parseFloat(row.pass_rate) || 100.0
            };
        } catch (error) {
            console.error('Error getting worker performance:', error);
            return { totalCanaries: 0, passed: 0, failed: 0, passRate: 100.0 };
        }
    }
    
    // Check if worker should be flagged
    async shouldFlagWorker(workerId) {
        const performance = await this.getWorkerPerformance(workerId);
        
        // Need at least 5 canaries to make a judgment
        if (performance.totalCanaries < 5) {
            return { shouldFlag: false, reason: 'insufficient_data', performance };
        }
        
        // Flag if pass rate < 85%
        const threshold = 85.0;
        if (performance.passRate < threshold) {
            return { 
                shouldFlag: true, 
                reason: 'low_pass_rate',
                performance,
                threshold
            };
        }
        
        return { shouldFlag: false, reason: 'pass', performance };
    }
    
    // Get all flagged workers
    async getFlaggedWorkers() {
        try {
            const result = await pool.query(`
                SELECT 
                    wm.worker_id,
                    wm.user_email,
                    wm.canary_pass_rate,
                    wm.reputation_score,
                    COUNT(ct.id) as total_canaries,
                    SUM(CASE WHEN ct.passed THEN 1 ELSE 0 END) as passed,
                    wm.last_active_at
                FROM worker_metrics wm
                LEFT JOIN canary_tracking ct ON wm.worker_id = ct.worker_id
                WHERE wm.canary_pass_rate < 85.0
                GROUP BY wm.worker_id, wm.user_email, wm.canary_pass_rate, 
                         wm.reputation_score, wm.last_active_at
                HAVING COUNT(ct.id) >= 5
                ORDER BY wm.canary_pass_rate ASC
            `);
            
            return result.rows;
        } catch (error) {
            console.error('Error getting flagged workers:', error);
            return [];
        }
    }
}

module.exports = new CanaryTracker();
