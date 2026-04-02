const crypto = require('crypto');
const mongoose = require('mongoose');

// Try to use MongoDB models, fallback to local storage if not connected
let User, Session;

if (mongoose.connection.readyState === 1) {
    User = require('./models/User');
    Session = require('./models/Session');
} else {
    const fallback = require('./storage-fallback');
    User = fallback.User;
    Session = fallback.Session;
}

// Update models when MongoDB connects
mongoose.connection.on('connected', () => {
    User = require('./models/User');
    Session = require('./models/Session');
    console.log('✓ Switched to MongoDB models');
});

function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function signup(name, email, password) {
    try {
        if (!name || !email || !password) {
            return { error: 'All fields are required' };
        }

        if (!validateEmail(email)) {
            return { error: 'Invalid email format' };
        }

        if (password.length < 6) {
            return { error: 'Password must be at least 6 characters' };
        }

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return { error: 'Email already registered' };
        }

        const user = await User.create({
            name,
            email: email.toLowerCase(),
            password: hashPassword(password),
            role: null,
            credits: 0,
            tasksCompleted: 0,
            jobsSubmitted: 0,
            creditsSpent: 0,
            active: true
        });

        const token = generateToken();
        await Session.create({
            token,
            userId: user._id,
            email: user.email
        });

        const userObj = user.toObject();
        delete userObj.password;
        return { token, user: userObj };
    } catch (error) {
        console.error('Signup error:', error);
        return { error: 'Signup failed' };
    }
}

async function login(email, password) {
    try {
        if (!email || !password) {
            return { error: 'Email and password are required' };
        }

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return { error: 'Invalid email or password' };
        }

        if (user.password !== hashPassword(password)) {
            return { error: 'Invalid email or password' };
        }

        const token = generateToken();
        await Session.create({
            token,
            userId: user._id,
            email: user.email
        });

        const userObj = user.toObject();
        delete userObj.password;
        return { token, user: userObj };
    } catch (error) {
        console.error('Login error:', error);
        return { error: 'Login failed' };
    }
}

async function verifyToken(token) {
    try {
        const session = await Session.findOne({ token });
        if (!session) {
            return null;
        }

        const user = await User.findById(session.userId);
        if (!user) {
            return null;
        }

        const userObj = user.toObject();
        delete userObj.password;
        return userObj;
    } catch (error) {
        console.error('Verify token error:', error);
        return null;
    }
}

async function selectRole(email, role) {
    try {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return { error: 'User not found' };
        }

        if (!['contributor', 'developer'].includes(role)) {
            return { error: 'Invalid role' };
        }

        user.role = role;
        
        if (role === 'developer') {
            user.credits = 100;
        }

        await user.save();

        const userObj = user.toObject();
        delete userObj.password;
        return { user: userObj };
    } catch (error) {
        console.error('Select role error:', error);
        return { error: 'Failed to select role' };
    }
}

async function getUserStats(email) {
    try {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return { error: 'User not found' };
        }

        return {
            credits: user.credits || 0,
            tasksCompleted: user.tasksCompleted || 0,
            jobsSubmitted: user.jobsSubmitted || 0,
            creditsSpent: user.creditsSpent || 0,
            activeWorkers: 0
        };
    } catch (error) {
        console.error('Get user stats error:', error);
        return { error: 'Failed to get stats' };
    }
}

async function getAllUsers() {
    try {
        const users = await User.find({}).select('-password');
        return users.map(u => u.toObject());
    } catch (error) {
        console.error('Get all users error:', error);
        return [];
    }
}

async function getSuperuserStats() {
    try {
        const allUsers = await getAllUsers();
        
        return {
            totalUsers: allUsers.length,
            totalContributors: allUsers.filter(u => u.role === 'contributor').length,
            totalDevelopers: allUsers.filter(u => u.role === 'developer').length,
            activeWorkers: 0,
            totalJobs: 0,
            creditsFlow: allUsers.reduce((sum, u) => sum + (u.credits || 0), 0),
            users: allUsers
        };
    } catch (error) {
        console.error('Get superuser stats error:', error);
        return {
            totalUsers: 0,
            totalContributors: 0,
            totalDevelopers: 0,
            activeWorkers: 0,
            totalJobs: 0,
            creditsFlow: 0,
            users: []
        };
    }
}

async function updateUserCredits(email, amount, operation = 'add') {
    try {
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            return { error: 'User not found' };
        }

        if (operation === 'add') {
            user.credits = (user.credits || 0) + amount;
        } else if (operation === 'subtract') {
            if (user.credits < amount) {
                return { error: 'Insufficient credits' };
            }
            user.credits -= amount;
        }

        await user.save();
        return { success: true, credits: user.credits };
    } catch (error) {
        console.error('Update credits error:', error);
        return { error: 'Failed to update credits' };
    }
}

async function getUserByEmail(email) {
    try {
        const user = await User.findOne({ email: email.toLowerCase() });
        return user;
    } catch (error) {
        console.error('Get user by email error:', error);
        return null;
    }
}

module.exports = {
    signup,
    login,
    verifyToken,
    selectRole,
    getUserStats,
    getAllUsers,
    getSuperuserStats,
    updateUserCredits,
    getUserByEmail
};
