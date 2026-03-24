const NebulaSDK = require('./index');

const nebula = new NebulaSDK('http://localhost:3000');

async function main() {
    console.log('Testing Nebula with real AI...\n');

    const result = await nebula.run([
        "Classify as positive or negative: 'Great product, loved it!'",
        "Classify as positive or negative: 'Terrible experience, never again.'",
        "Classify as positive or negative: 'It was okay, nothing special.'",
        "Classify as positive or negative: 'Absolutely amazing, highly recommend!'"
    ]);

    console.log('AI Results:');
    result.result.forEach((r, i) => {
        console.log(`Task ${i + 1}: ${r}`);
    });
}

main();