-- Migration 004: Add completed_jobs table for result downloads
-- This table stores completed job results for later download

CREATE TABLE IF NOT EXISTS completed_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id VARCHAR(255) UNIQUE NOT NULL,
    developer_email VARCHAR(255) NOT NULL,
    results JSONB NOT NULL,
    total_tasks INTEGER NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Indexes for fast lookups
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_completed_jobs_developer_email ON completed_jobs(developer_email, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_completed_jobs_job_id ON completed_jobs(job_id);
CREATE INDEX IF NOT EXISTS idx_completed_jobs_completed_at ON completed_jobs(completed_at DESC);

-- Add comment
COMMENT ON TABLE completed_jobs IS 'Stores completed job results for developer download (CSV/JSON)';
