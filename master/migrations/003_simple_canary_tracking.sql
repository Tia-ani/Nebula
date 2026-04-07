-- Migration 003: Simplified canary tracking
-- Drop complex foreign key constraints and create simple tracking

-- Simple canary tracking table (no foreign keys for now)
CREATE TABLE IF NOT EXISTS canary_tracking (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id VARCHAR(255) NOT NULL,
    user_email VARCHAR(255),
    canary_id VARCHAR(255) NOT NULL,
    expected_pattern TEXT NOT NULL,
    actual_output TEXT NOT NULL,
    passed BOOLEAN NOT NULL,
    job_id VARCHAR(255),
    chunk_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canary_tracking_worker ON canary_tracking(worker_id);
CREATE INDEX IF NOT EXISTS idx_canary_tracking_email ON canary_tracking(user_email);
CREATE INDEX IF NOT EXISTS idx_canary_tracking_passed ON canary_tracking(passed);
CREATE INDEX IF NOT EXISTS idx_canary_tracking_created ON canary_tracking(created_at DESC);

COMMENT ON TABLE canary_tracking IS 'Simple canary result tracking without foreign key constraints';
