const mongoose = require('mongoose');
require('dotenv').config();

// MongoDB connection string from environment variable
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/nebula';

async function connectDB() {
    try {
        // Connect with the working configuration
        await mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 10000,
        });
        console.log('✓ Connected to MongoDB');
        
        // Create default superuser if not exists
        const User = require('./models/User');
        const crypto = require('crypto');
        
        const superuserEmail = 'founder@nebula.com';
        const existingSuperuser = await User.findOne({ email: superuserEmail });
        
        if (!existingSuperuser) {
            const hashedPassword = crypto.createHash('sha256').update('nebula2024').digest('hex');
            await User.create({
                name: 'Founder',
                email: superuserEmail,
                password: hashedPassword,
                role: 'superuser',
                credits: 0
            });
            console.log('✓ Default superuser created');
        }
    } catch (error) {
        console.error('MongoDB connection error:', error.message);
        console.error('\nPlease check:');
        console.error('1. Your MongoDB Atlas cluster is running');
        console.error('2. Your IP address is whitelisted in MongoDB Atlas (try 0.0.0.0/0 for testing)');
        console.error('3. Your username and password are correct');
        console.error('4. Your cluster URL is correct: nebula.juoe7mu.mongodb.net');
        console.error('\nFalling back to local storage...\n');
        
        // Don't exit, let the app run without MongoDB
        return;
    }
}

module.exports = connectDB;
