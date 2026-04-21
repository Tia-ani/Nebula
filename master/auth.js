const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query, transaction } = require('./database');

const JWT_SECRET = process.env.JWT_SECRET || 'nebula_super_secret_key_change_in_production_2024';
const JWT_EXPIRES_IN = '7d';

/**
 * Sign up a new user
 */
async function signup(name, email, password) {
    try {
        // Check if user already exists
        const { rows: existing } = await query(
            'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
            [email]
        );

        if (existing.length > 0) {
            return { error: 'Email already registered' };
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 10);

        // Create user with transaction
        const result = await transaction(async (client) => {
            // Insert user
            const { rows: [user] } = await client.query(`
                INSERT INTO users (email, name, password_hash, role, credits)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id, email, name, role, credits, created_at
            `, [email, name, passwordHash, 'contributor', 100]); // Default 100 credits

            // Log credit transaction
            await client.query(`
                INSERT INTO credit_transactions (user_id, type, amount, balance_after, description)
                VALUES ($1, $2, $3, $4, $5)
            `, [user.id, 'bonus', 100, 100, 'Welcome bonus']);

            return user;
        });

        // Generate token with timestamp to make it unique
        const token = jwt.sign(
            { 
                userId: result.id, 
                email: result.email, 
                role: result.role,
                timestamp: Date.now() // Add timestamp for uniqueness
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        // Create session
        await query(`
            INSERT INTO sessions (user_id, token, expires_at)
            VALUES ($1, $2, NOW() + INTERVAL '7 days')
        `, [result.id, token]);

        return {
            token,
            user: {
                id: result.id,
                email: result.email,
                name: result.name,
                role: result.role,
                credits: result.credits
            }
        };
    } catch (error) {
        console.error('Signup error:', error);
        return { error: 'Failed to create account' };
    }
}

/**
 * Login user
 */
async function login(email, password) {
    try {
        // Get user
        const { rows } = await query(`
            SELECT id, email, name, password_hash, role, credits, 
                   credits_earned, credits_spent, tasks_completed, jobs_submitted
            FROM users
            WHERE email = $1 AND deleted_at IS NULL
        `, [email]);

        if (rows.length === 0) {
            return { error: 'Invalid email or password' };
        }

        const user = rows[0];

        // Verify password
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) {
            return { error: 'Invalid email or password' };
        }

        // Generate token with timestamp to make it unique
        const token = jwt.sign(
            { 
                userId: user.id, 
                email: user.email, 
                role: user.role,
                timestamp: Date.now() // Add timestamp for uniqueness
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );

        // Create session and update last login
        await transaction(async (client) => {
            await client.query(`
                INSERT INTO sessions (user_id, token, expires_at)
                VALUES ($1, $2, NOW() + INTERVAL '7 days')
            `, [user.id, token]);

            await client.query(`
                UPDATE users SET last_login_at = NOW() WHERE id = $1
            `, [user.id]);
        });

        return {
            token,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                credits: user.credits,
                creditsEarned: user.credits_earned,
                creditsSpent: user.credits_spent,
                tasksCompleted: user.tasks_completed,
                jobsSubmitted: user.jobs_submitted
            }
        };
    } catch (error) {
        console.error('Login error:', error);
        return { error: 'Login failed' };
    }
}

/**
 * Verify JWT token
 */
async function verifyToken(token) {
    try {
        // Verify JWT
        const decoded = jwt.verify(token, JWT_SECRET);

        // Check if session exists and is valid
        const { rows } = await query(`
            SELECT s.id, u.id as user_id, u.email, u.name, u.role, u.credits
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = $1 
            AND s.expires_at > NOW()
            AND u.deleted_at IS NULL
        `, [token]);

        if (rows.length === 0) {
            return null;
        }

        return {
            id: rows[0].user_id,
            email: rows[0].email,
            name: rows[0].name,
            role: rows[0].role,
            credits: rows[0].credits
        };
    } catch (error) {
        console.error('Token verification error:', error);
        return null;
    }
}

/**
 * Select role (for users who signed up without role)
 */
async function selectRole(email, role) {
    try {
        if (!['contributor', 'developer'].includes(role)) {
            return { error: 'Invalid role' };
        }

        const { rows } = await query(`
            UPDATE users
            SET role = $1, updated_at = NOW()
            WHERE email = $2 AND deleted_at IS NULL
            RETURNING id, email, name, role, credits
        `, [role, email]);

        if (rows.length === 0) {
            return { error: 'User not found' };
        }

        return { user: rows[0] };
    } catch (error) {
        console.error('Select role error:', error);
        return { error: 'Failed to update role' };
    }
}

/**
 * Get user by email
 */
async function getUserByEmail(email) {
    try {
        const { rows } = await query(`
            SELECT id, email, name, role, credits, 
                   credits_earned, credits_spent, 
                   tasks_completed, jobs_submitted,
                   reputation_score, created_at
            FROM users
            WHERE email = $1 AND deleted_at IS NULL
        `, [email]);

        return rows.length > 0 ? rows[0] : null;
    } catch (error) {
        console.error('Get user error:', error);
        return null;
    }
}

/**
 * Get user by ID
 */
async function getUserById(userId) {
    try {
        const { rows } = await query(`
            SELECT id, email, name, role, credits, 
                   credits_earned, credits_spent, 
                   tasks_completed, jobs_submitted,
                   reputation_score, created_at
            FROM users
            WHERE id = $1 AND deleted_at IS NULL
        `, [userId]);

        return rows.length > 0 ? rows[0] : null;
    } catch (error) {
        console.error('Get user error:', error);
        return null;
    }
}

/**
 * Update user credits (atomic operation)
 */
async function updateUserCredits(email, amount, operation = 'add') {
    try {
        return await transaction(async (client) => {
            // Get current user
            const { rows: [user] } = await client.query(`
                SELECT id, credits, credits_earned, credits_spent
                FROM users
                WHERE email = $1 AND deleted_at IS NULL
                FOR UPDATE
            `, [email]);

            if (!user) {
                throw new Error('User not found');
            }

            // Convert to numbers (database might return strings)
            const currentCredits = parseInt(user.credits) || 0;
            const currentEarned = parseInt(user.credits_earned) || 0;
            const currentSpent = parseInt(user.credits_spent) || 0;

            let newCredits, newEarned, newSpent;
            let transactionType;

            if (operation === 'add') {
                newCredits = currentCredits + amount;
                newEarned = currentEarned + amount;
                newSpent = currentSpent;
                transactionType = 'earn';
            } else if (operation === 'subtract') {
                if (currentCredits < amount) {
                    throw new Error('Insufficient credits');
                }
                newCredits = currentCredits - amount;
                newEarned = currentEarned;
                newSpent = currentSpent + amount;
                transactionType = 'spend';
            } else {
                throw new Error('Invalid operation');
            }

            // Update user credits
            await client.query(`
                UPDATE users
                SET credits = $1,
                    credits_earned = $2,
                    credits_spent = $3,
                    updated_at = NOW()
                WHERE id = $4
            `, [newCredits, newEarned, newSpent, user.id]);

            // Log transaction
            await client.query(`
                INSERT INTO credit_transactions (user_id, type, amount, balance_after)
                VALUES ($1, $2, $3, $4)
            `, [user.id, transactionType, amount, newCredits]);

            return { success: true, newBalance: newCredits };
        });
    } catch (error) {
        console.error('Update credits error:', error);
        throw error;
    }
}

/**
 * Get user stats
 */
async function getUserStats(email) {
    try {
        const { rows } = await query(`
            SELECT 
                credits,
                credits_earned,
                credits_spent,
                tasks_completed,
                jobs_submitted,
                reputation_score
            FROM users
            WHERE email = $1 AND deleted_at IS NULL
        `, [email]);

        if (rows.length === 0) {
            return {
                credits: 0,
                creditsEarned: 0,
                creditsSpent: 0,
                tasksCompleted: 0,
                jobsSubmitted: 0,
                reputationScore: 100
            };
        }

        // Convert all numeric fields to actual numbers
        return {
            credits: parseInt(rows[0].credits) || 0,
            creditsEarned: parseInt(rows[0].credits_earned) || 0,
            creditsSpent: parseInt(rows[0].credits_spent) || 0,
            tasksCompleted: parseInt(rows[0].tasks_completed) || 0,
            jobsSubmitted: parseInt(rows[0].jobs_submitted) || 0,
            reputationScore: parseFloat(rows[0].reputation_score) || 100
        };
    } catch (error) {
        console.error('Get stats error:', error);
        return {
            credits: 0,
            creditsEarned: 0,
            creditsSpent: 0,
            tasksCompleted: 0,
            jobsSubmitted: 0
        };
    }
}

/**
 * Get superuser stats
 */
async function getSuperuserStats() {
    try {
        const { rows: [stats] } = await query(`
            SELECT 
                COUNT(DISTINCT CASE WHEN role = 'contributor' THEN id END) as total_contributors,
                COUNT(DISTINCT CASE WHEN role = 'developer' THEN id END) as total_developers,
                SUM(credits) as total_credits,
                SUM(credits_earned) as total_credits_earned,
                SUM(credits_spent) as total_credits_spent,
                SUM(tasks_completed) as total_tasks_completed,
                SUM(jobs_submitted) as total_jobs_submitted
            FROM users
            WHERE deleted_at IS NULL
        `);

        return {
            totalContributors: parseInt(stats.total_contributors) || 0,
            totalDevelopers: parseInt(stats.total_developers) || 0,
            totalCredits: parseInt(stats.total_credits) || 0,
            totalCreditsEarned: parseInt(stats.total_credits_earned) || 0,
            totalCreditsSpent: parseInt(stats.total_credits_spent) || 0,
            totalTasksCompleted: parseInt(stats.total_tasks_completed) || 0,
            totalJobsSubmitted: parseInt(stats.total_jobs_submitted) || 0
        };
    } catch (error) {
        console.error('Get superuser stats error:', error);
        return {
            totalContributors: 0,
            totalDevelopers: 0,
            totalCredits: 0,
            totalCreditsEarned: 0,
            totalCreditsSpent: 0,
            totalTasksCompleted: 0,
            totalJobsSubmitted: 0
        };
    }
}

/**
 * Increment user task count
 */
async function incrementTaskCount(email, count = 1) {
    try {
        await query(`
            UPDATE users
            SET tasks_completed = tasks_completed + $1,
                updated_at = NOW()
            WHERE email = $2 AND deleted_at IS NULL
        `, [count, email]);
    } catch (error) {
        console.error('Increment task count error:', error);
    }
}

/**
 * Increment user job count
 */
async function incrementJobCount(email) {
    try {
        await query(`
            UPDATE users
            SET jobs_submitted = jobs_submitted + 1,
                updated_at = NOW()
            WHERE email = $1 AND deleted_at IS NULL
        `, [email]);
    } catch (error) {
        console.error('Increment job count error:', error);
    }
}

module.exports = {
    signup,
    login,
    verifyToken,
    selectRole,
    getUserByEmail,
    getUserById,
    updateUserCredits,
    getUserStats,
    getSuperuserStats,
    incrementTaskCount,
    incrementJobCount
};
