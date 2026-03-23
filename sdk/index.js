// sdk/index.js
const axios = require('axios');

class NebulaSDK {
    constructor(masterUrl) {
        // Developer points SDK to wherever master is running
        this.masterUrl = masterUrl;
    }

    async run(tasks) {
        try {
            console.log(`Submitting ${tasks.length} tasks to Nebula...`);
            
            const response = await axios.post(`${this.masterUrl}/job`, {
                tasks
            });

            return response.data;

        } catch (error) {
            if (error.response) {
                throw new Error(`Nebula error: ${error.response.data.error}`);
            }
            throw new Error(`Could not connect to Nebula master: ${error.message}`);
        }
    }
}

module.exports = NebulaSDK;