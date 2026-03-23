// sdk/test.js
const NebulaSDK = require('./index');

// Point SDK at your master
const nebula = new NebulaSDK('http://localhost:3000');

async function main() {
    console.log('Testing Nebula SDK...');
    
    const result = await nebula.run([
        "review1",
        "review2", 
        "review3",
        "review4"
    ]);
    
    console.log('Result:', result);
}

main();