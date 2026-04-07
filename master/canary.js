// Canary Verification System
// Detects fraudulent workers by injecting tasks with known answers

const crypto = require('crypto');

// Canary task corpus - tasks with verifiable answers
const canaryCorpus = [
    // Math tasks
    {
        prompt: "What is 2+2? Answer with just the number.",
        expectedPattern: /^4$/,
        type: "math",
        difficulty: "easy"
    },
    {
        prompt: "What is 10-3? Answer with just the number.",
        expectedPattern: /^7$/,
        type: "math",
        difficulty: "easy"
    },
    {
        prompt: "What is 5*6? Answer with just the number.",
        expectedPattern: /^30$/,
        type: "math",
        difficulty: "easy"
    },
    {
        prompt: "What is 100/4? Answer with just the number.",
        expectedPattern: /^25$/,
        type: "math",
        difficulty: "easy"
    },
    
    // Simple completion tasks
    {
        prompt: "Complete this: The sky is _____. One word only.",
        expectedPattern: /^blue$/i,
        type: "completion",
        difficulty: "easy"
    },
    {
        prompt: "Complete this: Water is _____. One word only.",
        expectedPattern: /^(wet|liquid)$/i,
        type: "completion",
        difficulty: "easy"
    },
    {
        prompt: "Complete this: Fire is _____. One word only.",
        expectedPattern: /^(hot|warm)$/i,
        type: "completion",
        difficulty: "easy"
    },
    {
        prompt: "Complete this: Ice is _____. One word only.",
        expectedPattern: /^(cold|frozen)$/i,
        type: "completion",
        difficulty: "easy"
    },
    
    // Simple questions
    {
        prompt: "What color is grass? One word.",
        expectedPattern: /^green$/i,
        type: "question",
        difficulty: "easy"
    },
    {
        prompt: "What color is the sun? One word.",
        expectedPattern: /^yellow$/i,
        type: "question",
        difficulty: "easy"
    },
    {
        prompt: "How many days in a week? Just the number.",
        expectedPattern: /^7$/,
        type: "question",
        difficulty: "easy"
    },
    {
        prompt: "How many months in a year? Just the number.",
        expectedPattern: /^12$/,
        type: "question",
        difficulty: "easy"
    },
    
    // Sentiment tasks
    {
        prompt: "Classify sentiment as positive, negative, or neutral: I love this product!",
        expectedPattern: /^positive$/i,
        type: "sentiment",
        difficulty: "easy"
    },
    {
        prompt: "Classify sentiment as positive, negative, or neutral: This is terrible.",
        expectedPattern: /^negative$/i,
        type: "sentiment",
        difficulty: "easy"
    },
    {
        prompt: "Classify sentiment as positive, negative, or neutral: The weather is okay.",
        expectedPattern: /^neutral$/i,
        type: "sentiment",
        difficulty: "easy"
    },
    
    // Entity extraction
    {
        prompt: "Extract the city name: I live in New York. Answer with just the city name.",
        expectedPattern: /^New York$/i,
        type: "extraction",
        difficulty: "easy"
    },
    {
        prompt: "Extract the number: There are 42 apples. Answer with just the number.",
        expectedPattern: /^42$/,
        type: "extraction",
        difficulty: "easy"
    },
    
    // Translation (simple)
    {
        prompt: "Translate to Spanish: Hello. One word only.",
        expectedPattern: /^Hola$/i,
        type: "translation",
        difficulty: "easy"
    },
    {
        prompt: "Translate to Spanish: Goodbye. One word only.",
        expectedPattern: /^Adiós$/i,
        type: "translation",
        difficulty: "easy"
    },
    
    // Yes/No questions
    {
        prompt: "Is the earth round? Answer yes or no.",
        expectedPattern: /^yes$/i,
        type: "boolean",
        difficulty: "easy"
    },
    {
        prompt: "Is water dry? Answer yes or no.",
        expectedPattern: /^no$/i,
        type: "boolean",
        difficulty: "easy"
    }
];

// Inject canaries into a batch of tasks
// Returns: { tasks: [...], canaryMap: { taskIndex: canaryData } }
function injectCanaries(realTasks, injectionRate = 0.15) {
    const result = [];
    const canaryMap = new Map();
    
    // Add all real tasks first
    realTasks.forEach(task => {
        result.push({
            task,
            isCanary: false
        });
    });
    
    // Calculate how many canaries to inject
    const canaryCount = Math.max(1, Math.floor(realTasks.length * injectionRate));
    
    // Inject canaries at random positions
    for (let i = 0; i < canaryCount; i++) {
        const canary = getRandomCanary();
        const canaryId = crypto.randomBytes(16).toString('hex');
        
        // Insert at random position
        const insertPos = Math.floor(Math.random() * (result.length + 1));
        result.splice(insertPos, 0, {
            task: canary.prompt,
            isCanary: true,
            canaryId,
            canaryData: canary
        });
        
        // Track canary position
        canaryMap.set(insertPos, {
            canaryId,
            expected: canary.expectedPattern,
            type: canary.type,
            difficulty: canary.difficulty
        });
    }
    
    // Return just the task strings (workers can't see metadata)
    const tasks = result.map(item => item.task);
    
    // Build index map (after injection, positions have shifted)
    const indexMap = {};
    result.forEach((item, index) => {
        if (item.isCanary) {
            indexMap[index] = {
                canaryId: item.canaryId,
                expected: item.canaryData.expectedPattern,
                type: item.canaryData.type,
                difficulty: item.canaryData.difficulty
            };
        }
    });
    
    return {
        tasks,
        canaryMap: indexMap,
        canaryCount,
        totalTasks: tasks.length
    };
}

// Get a random canary from the corpus
function getRandomCanary() {
    return canaryCorpus[Math.floor(Math.random() * canaryCorpus.length)];
}

// Validate a canary result
function validateCanary(result, expectedPattern) {
    if (!result || typeof result !== 'string') {
        return false;
    }
    
    // Trim whitespace and test against pattern
    const cleaned = result.trim();
    return expectedPattern.test(cleaned);
}

// Evaluate worker performance on canaries
function evaluateWorker(canaryResults) {
    if (canaryResults.length === 0) {
        return {
            passRate: 1.0,
            passed: 0,
            failed: 0,
            total: 0,
            status: 'no_canaries'
        };
    }
    
    const passed = canaryResults.filter(r => r.passed).length;
    const failed = canaryResults.length - passed;
    const passRate = passed / canaryResults.length;
    
    // Threshold: 85% pass rate required
    const threshold = 0.85;
    const status = passRate >= threshold ? 'pass' : 'fail';
    
    return {
        passRate,
        passed,
        failed,
        total: canaryResults.length,
        status,
        threshold
    };
}

// Get corpus statistics
function getCorpusStats() {
    const byType = {};
    const byDifficulty = {};
    
    canaryCorpus.forEach(canary => {
        byType[canary.type] = (byType[canary.type] || 0) + 1;
        byDifficulty[canary.difficulty] = (byDifficulty[canary.difficulty] || 0) + 1;
    });
    
    return {
        total: canaryCorpus.length,
        byType,
        byDifficulty
    };
}

module.exports = {
    canaryCorpus,
    injectCanaries,
    validateCanary,
    evaluateWorker,
    getCorpusStats
};
