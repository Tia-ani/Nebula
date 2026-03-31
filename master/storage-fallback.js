const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_FILE = path.join(__dirname, 'nebula-data.json');

let users = new Map();
let sessions = new Map();

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            users = new Map(Object.entries(data.users || {}));
            sessions = new Map(Object.entries(data.sessions || {}));
            console.log('✓ Loaded data from local file (fallback mode)');
        } else {
            // Create default superuser
            const hashedPassword = crypto.createHash('sha256').update('nebula2024').digest('hex');
            users.set('founder@nebula.com', {
                _id: crypto.randomBytes(12).toString('hex'),
                name: 'Founder',
                email: 'founder@nebula.com',
                password: hashedPassword,
                role: 'superuser',
                credits: 0,
                tasksCompleted: 0,
                jobsSubmitted: 0,
                creditsSpent: 0,
                active: true,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            saveData();
            console.log('✓ Created default superuser (fallback mode)');
        }
    } catch (error) {
        console.error('Error loading data:', error.message);
    }
}

function saveData() {
    try {
        const data = {
            users: Object.fromEntries(users),
            sessions: Object.fromEntries(sessions),
            lastUpdated: new Date().toISOString()
        };
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving data:', error.message);
    }
}

// Mock User model for fallback
const User = {
    async findOne(query) {
        const user = users.get(query.email?.toLowerCase());
        return user ? { ...user, toObject: () => user, save: async function() { saveData(); } } : null;
    },
    
    async create(userData) {
        const user = {
            _id: crypto.randomBytes(12).toString('hex'),
            ...userData,
            email: userData.email.toLowerCase(),
            createdAt: new Date(),
            updatedAt: new Date()
        };
        users.set(user.email, user);
        saveData();
        return { ...user, toObject: () => user };
    },
    
    async find(query) {
        const allUsers = Array.from(users.values());
        return allUsers.map(u => ({ ...u, toObject: () => u }));
    },
    
    async findById(id) {
        const user = Array.from(users.values()).find(u => u._id === id);
        return user ? { ...user, toObject: () => user, save: async function() { saveData(); } } : null;
    }
};

// Mock Session model for fallback
const Session = {
    async findOne(query) {
        const session = sessions.get(query.token);
        return session;
    },
    
    async create(sessionData) {
        sessions.set(sessionData.token, sessionData);
        saveData();
        return sessionData;
    }
};

loadData();

module.exports = { User, Session, saveData };
