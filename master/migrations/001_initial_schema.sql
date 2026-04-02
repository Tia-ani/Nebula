-- Nebula Production Schema
-- Migration 001: Initial Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- USERS & AUTH
-- ============================================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('contributor', 'developer', 'superuser')),
    
    -- Credits & Stats
    credits BIGINT DEFAULT 0 NOT NULL CHECK (credits >= 0),
    credits_earned BIGINT DEFAULT 0 NOT NULL,
    credits_spent BIGINT DEFAULT 0 NOT NULL,
    tasks_completed INTEGER DEFAULT 0 NOT NULL,
    jobs_submitted INTEGER DEFAULT 0 NOT NULL,
    
    -- Contributor specific
    reputation_score DECIMAL(5,2) DEFAULT 100.00,
    stake_amount INTEGER DEFAULT 0,
    stake_locked BOOLEAN DEFAULT false,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login_at TIMESTAMP WITH TIME ZONE,
    
    -- Soft delete
    deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_role ON users(role) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_reputation ON users(reputation_score DESC) WHERE role = 'contributor' AND deleted_at IS NULL;

-- ============================================================================
-- SESSIONS
-- ============================================================================

CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(500) UNIQUE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address INET,
    user_agent TEXT
);

CREATE INDEX idx_sessions_token ON sessions(token);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);

-- ============================================================================
-- JOBS
-- ============================================================================

CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    developer_id UUID NOT NULL REFERENCES users(id),
    
    -- Job details
    status VARCHAR(50) NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
    priority VARCHAR(50) NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('normal', 'high', 'urgent')),
    
    -- Tasks
    total_tasks INTEGER NOT NULL,
    completed_tasks INTEGER DEFAULT 0,
    failed_tasks INTEGER DEFAULT 0,
    
    -- Chunks
    total_chunks INTEGER NOT NULL,
    completed_chunks INTEGER DEFAULT 0,
    
    -- Credits
    cost_estimate INTEGER NOT NULL,
    actual_cost INTEGER DEFAULT 0,
    
    -- Idempotency
    idempotency_key VARCHAR(255) UNIQUE,
    
    -- Results
    result_data JSONB,
    error_message TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    
    -- Metadata
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_jobs_developer_id ON jobs(developer_id);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX idx_jobs_idempotency_key ON jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ============================================================================
-- CHUNKS
-- ============================================================================

CREATE TABLE chunks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    
    -- Chunk details
    chunk_index INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'assigned', 'processing', 'completed', 'failed', 'reassigned')),
    
    -- Worker assignment
    worker_id UUID REFERENCES users(id),
    assigned_at TIMESTAMP WITH TIME ZONE,
    
    -- Tasks
    task_data JSONB NOT NULL,
    task_count INTEGER NOT NULL,
    
    -- Results
    result_data JSONB,
    error_message TEXT,
    
    -- Retry tracking
    attempt_count INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    
    UNIQUE(job_id, chunk_index)
);

CREATE INDEX idx_chunks_job_id ON chunks(job_id);
CREATE INDEX idx_chunks_worker_id ON chunks(worker_id);
CREATE INDEX idx_chunks_status ON chunks(status);
CREATE INDEX idx_chunks_pending ON chunks(job_id, status) WHERE status IN ('pending', 'assigned');

-- ============================================================================
-- WORKERS
-- ============================================================================

CREATE TABLE workers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Worker details
    worker_type VARCHAR(50) NOT NULL CHECK (worker_type IN ('browser', 'cpu', 'gpu')),
    status VARCHAR(50) NOT NULL DEFAULT 'offline'
        CHECK (status IN ('online', 'offline', 'busy', 'suspended')),
    
    -- Connection
    socket_id VARCHAR(255),
    session_key VARCHAR(255),
    
    -- Performance metrics
    tasks_completed INTEGER DEFAULT 0,
    tasks_failed INTEGER DEFAULT 0,
    avg_task_duration_ms INTEGER,
    
    -- Reputation
    canary_passed INTEGER DEFAULT 0,
    canary_failed INTEGER DEFAULT 0,
    reputation_score DECIMAL(5,2) DEFAULT 100.00,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    connected_at TIMESTAMP WITH TIME ZONE,
    disconnected_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_workers_user_id ON workers(user_id);
CREATE INDEX idx_workers_status ON workers(status);
CREATE INDEX idx_workers_socket_id ON workers(socket_id) WHERE socket_id IS NOT NULL;
CREATE INDEX idx_workers_reputation ON workers(reputation_score DESC) WHERE status = 'online';

-- ============================================================================
-- CREDIT TRANSACTIONS
-- ============================================================================

CREATE TABLE credit_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Transaction details
    type VARCHAR(50) NOT NULL CHECK (type IN ('earn', 'spend', 'refund', 'stake', 'slash', 'bonus')),
    amount INTEGER NOT NULL,
    balance_after BIGINT NOT NULL,
    
    -- Related entities
    job_id UUID REFERENCES jobs(id),
    chunk_id UUID REFERENCES chunks(id),
    
    -- Description
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Timestamp
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_credit_transactions_user_id ON credit_transactions(user_id, created_at DESC);
CREATE INDEX idx_credit_transactions_job_id ON credit_transactions(job_id);
CREATE INDEX idx_credit_transactions_type ON credit_transactions(type);

-- ============================================================================
-- CANARY TASKS
-- ============================================================================

CREATE TABLE canary_tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Task details
    task_type VARCHAR(100) NOT NULL,
    task_input TEXT NOT NULL,
    expected_output JSONB NOT NULL,
    
    -- Validation
    validation_rules JSONB NOT NULL,
    difficulty VARCHAR(50) DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
    
    -- Stats
    times_used INTEGER DEFAULT 0,
    times_passed INTEGER DEFAULT 0,
    times_failed INTEGER DEFAULT 0,
    
    -- Status
    active BOOLEAN DEFAULT true,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_canary_tasks_active ON canary_tasks(active, difficulty);

-- ============================================================================
-- CANARY RESULTS
-- ============================================================================

CREATE TABLE canary_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    canary_task_id UUID NOT NULL REFERENCES canary_tasks(id),
    worker_id UUID NOT NULL REFERENCES workers(id),
    chunk_id UUID NOT NULL REFERENCES chunks(id),
    
    -- Result
    worker_output JSONB NOT NULL,
    passed BOOLEAN NOT NULL,
    similarity_score DECIMAL(5,2),
    
    -- Timestamp
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_canary_results_worker_id ON canary_results(worker_id, created_at DESC);
CREATE INDEX idx_canary_results_passed ON canary_results(passed);

-- ============================================================================
-- STAKE DEPOSITS
-- ============================================================================

CREATE TABLE stake_deposits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Deposit details
    amount INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'refunded', 'slashed')),
    
    -- Payment
    razorpay_payment_id VARCHAR(255),
    razorpay_order_id VARCHAR(255),
    
    -- Lock period
    locked_until TIMESTAMP WITH TIME ZONE NOT NULL,
    
    -- Refund/Slash
    refunded_at TIMESTAMP WITH TIME ZONE,
    slashed_at TIMESTAMP WITH TIME ZONE,
    slash_reason TEXT,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_stake_deposits_user_id ON stake_deposits(user_id);
CREATE INDEX idx_stake_deposits_status ON stake_deposits(status);

-- ============================================================================
-- AUDIT LOG
-- ============================================================================

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Actor
    user_id UUID REFERENCES users(id),
    
    -- Action
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID,
    
    -- Changes
    old_values JSONB,
    new_values JSONB,
    
    -- Context
    ip_address INET,
    user_agent TEXT,
    
    -- Timestamp
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_audit_log_user_id ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_created_at ON audit_log(created_at DESC);

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_canary_tasks_updated_at BEFORE UPDATE ON canary_tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_stake_deposits_updated_at BEFORE UPDATE ON stake_deposits
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Active workers view
CREATE VIEW active_workers AS
SELECT 
    w.*,
    u.email,
    u.name,
    u.reputation_score as user_reputation
FROM workers w
JOIN users u ON w.user_id = u.id
WHERE w.status = 'online'
AND u.deleted_at IS NULL;

-- Job statistics view
CREATE VIEW job_statistics AS
SELECT 
    j.id,
    j.developer_id,
    j.status,
    j.total_tasks,
    j.completed_tasks,
    j.total_chunks,
    j.completed_chunks,
    j.cost_estimate,
    j.actual_cost,
    j.created_at,
    j.completed_at,
    EXTRACT(EPOCH FROM (j.completed_at - j.created_at)) as duration_seconds,
    COUNT(DISTINCT c.worker_id) as unique_workers
FROM jobs j
LEFT JOIN chunks c ON j.id = c.job_id
GROUP BY j.id;

-- User statistics view
CREATE VIEW user_statistics AS
SELECT 
    u.id,
    u.email,
    u.name,
    u.role,
    u.credits,
    u.credits_earned,
    u.credits_spent,
    u.tasks_completed,
    u.jobs_submitted,
    u.reputation_score,
    COUNT(DISTINCT w.id) as worker_count,
    COUNT(DISTINCT CASE WHEN w.status = 'online' THEN w.id END) as active_worker_count
FROM users u
LEFT JOIN workers w ON u.id = w.user_id
WHERE u.deleted_at IS NULL
GROUP BY u.id;
