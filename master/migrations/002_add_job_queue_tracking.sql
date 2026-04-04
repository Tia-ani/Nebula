-- Migration 002: Add job queue tracking and worker metrics
-- This migration adds tables for tracking BullMQ jobs and worker performance

-- Job queue tracking (mirrors BullMQ state in Postgres for persistence)
CREATE TABLE IF NOT EXISTS job_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id VARCHAR(255) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'pending', -- pending, processing, completed, failed
    tasks JSONB NOT NULL,
    developer_email VARCHAR(255),
    total_chunks INT DEFAULT 0,
    completed_chunks INT DEFAULT 0,
    results JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue(status);
CREATE INDEX IF NOT EXISTS idx_job_queue_developer ON job_queue(developer_email);
CREATE INDEX IF NOT EXISTS idx_job_queue_created ON job_queue(created_at DESC);

-- Worker performance metrics
CREATE TABLE IF NOT EXISTS worker_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id VARCHAR(255) NOT NULL,
    worker_type VARCHAR(50) NOT NULL, -- browser-worker, cpu-worker, gpu-worker
    user_email VARCHAR(255),
    chunks_completed INT DEFAULT 0,
    chunks_failed INT DEFAULT 0,
    total_compute_time_ms BIGINT DEFAULT 0, -- Total time spent computing
    avg_latency_ms INT DEFAULT 0,
    p99_latency_ms INT DEFAULT 0,
    canary_pass_rate DECIMAL(5,2) DEFAULT 100.00, -- Percentage (0-100)
    reputation_score DECIMAL(5,2) DEFAULT 100.00, -- Percentage (0-100)
    last_active_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_worker_metrics_email ON worker_metrics(user_email);
CREATE INDEX IF NOT EXISTS idx_worker_metrics_reputation ON worker_metrics(reputation_score DESC);
CREATE INDEX IF NOT EXISTS idx_worker_metrics_active ON worker_metrics(last_active_at DESC);

-- Chunk execution tracking
CREATE TABLE IF NOT EXISTS chunk_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id VARCHAR(255) UNIQUE NOT NULL,
    job_id VARCHAR(255) NOT NULL,
    worker_id VARCHAR(255) NOT NULL,
    chunk_index INT NOT NULL,
    chunk_size INT NOT NULL, -- Number of tasks in chunk
    status VARCHAR(20) DEFAULT 'assigned', -- assigned, completed, failed, reassigned
    assigned_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    failed_at TIMESTAMPTZ,
    execution_time_ms INT, -- Time taken to complete
    attempt_count INT DEFAULT 1,
    is_canary BOOLEAN DEFAULT FALSE,
    canary_passed BOOLEAN,
    error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_chunk_job ON chunk_executions(job_id);
CREATE INDEX IF NOT EXISTS idx_chunk_worker ON chunk_executions(worker_id);
CREATE INDEX IF NOT EXISTS idx_chunk_status ON chunk_executions(status);
CREATE INDEX IF NOT EXISTS idx_chunk_canary ON chunk_executions(is_canary, canary_passed);

-- Worker heartbeat log (for debugging disconnections)
CREATE TABLE IF NOT EXISTS worker_heartbeats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id VARCHAR(255) NOT NULL,
    user_email VARCHAR(255),
    heartbeat_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_heartbeat_worker ON worker_heartbeats(worker_id);
CREATE INDEX IF NOT EXISTS idx_heartbeat_time ON worker_heartbeats(heartbeat_at DESC);

-- Partition heartbeats table by month (for performance)
-- This will be implemented later when we have more data

COMMENT ON TABLE job_queue IS 'Persistent tracking of BullMQ jobs';
COMMENT ON TABLE worker_metrics IS 'Performance metrics for reputation scoring';
COMMENT ON TABLE chunk_executions IS 'Detailed tracking of chunk assignments and completions';
COMMENT ON TABLE worker_heartbeats IS 'Heartbeat log for debugging worker disconnections';
