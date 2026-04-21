// Canary Verification System
// Detects fraudulent workers by injecting tasks with known answers

const crypto = require('crypto');
const { expandedCanaryCorpus } = require('./canary-expanded');

// Use expanded corpus (100+ tasks)
const canaryCorpus = expandedCanaryCorpus;

// Inject canaries into a batch of tasks
// Returns: { tasks: [...], canaryMap: { taskIndex: canaryData } }
function injectCanaries(realTasks, injectionRate = 0.15) {
    const result = [];
    
    // Filter out any undefined/null tasks from input
    const validRealTasks = realTasks.filter(task => task && typeof task === 'string');
    
    if (validRealTasks.length !== realTasks.length) {
        console.warn(`⚠️  Filtered out ${realTasks.length - validRealTasks.length} invalid tasks before canary injection`);
    }
    
    // Add all real tasks first
    validRealTasks.forEach(task => {
        result.push({
            task,
            isCanary: false
        });
    });
    
    // Calculate how many canaries to inject
    const canaryCount = Math.max(1, Math.floor(validRealTasks.length * injectionRate));
    
    // Inject canaries at random positions
    for (let i = 0; i < canaryCount; i++) {
        const canary = getRandomCanary();
        
        // Validate canary has a prompt
        if (!canary || !canary.prompt) {
            console.error(`⚠️  Invalid canary selected:`, canary);
            continue;
        }
        
        const canaryId = crypto.randomBytes(16).toString('hex');
        
        // Insert at random position
        const insertPos = Math.floor(Math.random() * (result.length + 1));
        result.splice(insertPos, 0, {
            task: canary.prompt,
            isCanary: true,
            canaryId,
            canaryData: canary
        });
    }
    
    // Return just the task strings (workers can't see metadata)
    const tasks = result.map(item => item.task);
    
    // Validate no undefined tasks in final array
    const undefinedCount = tasks.filter(t => !t).length;
    if (undefinedCount > 0) {
        console.error(`⚠️  ERROR: ${undefinedCount} undefined tasks in final array after canary injection!`);
        console.error(`Tasks:`, tasks);
    }
    
    // Build index map AFTER all injections (positions are now final)
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
    
    console.log(`Canary injection: ${validRealTasks.length} real tasks + ${canaryCount} canaries = ${tasks.length} total`);
    console.log(`Canary positions:`, Object.keys(indexMap).map(k => parseInt(k)));
    
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
