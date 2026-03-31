const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true
    },
    role: {
        type: String,
        enum: ['contributor', 'developer', 'superuser', null],
        default: null
    },
    credits: {
        type: Number,
        default: 0
    },
    tasksCompleted: {
        type: Number,
        default: 0
    },
    jobsSubmitted: {
        type: Number,
        default: 0
    },
    creditsSpent: {
        type: Number,
        default: 0
    },
    active: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('User', userSchema);
