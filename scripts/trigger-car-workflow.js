// trigger-car-workflow.js

// Editable variables
const GITHUB_TOKEN = 'your_github_token_here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'; // Replace with your GitHub token
const CAR_DATA = {
    // Add your car data details here
    make: 'Toyota',
    model: 'Camry',
    year: 2020
};

// Function to trigger the CAR workflow
async function triggerCarWorkflow() {
    try {
        const response = await fetch('https://api.github.com/repos/pggLLC/Housing-Analytics/actions/workflows/YOUR_WORKFLOW_ID/dispatches', {
            method: 'POST',
            headers: {
                'Authorization': `token ${GITHUB_TOKEN}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                ref: 'main', // or the branch you want to run the workflow on
                inputs: {
                    carData: CAR_DATA
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Error triggering workflow: ${response.statusText}`);
        }

        console.log('CAR workflow triggered successfully!');
    } catch (error) {
        console.error('Failed to trigger CAR workflow:', error);
    }
}

// Execute the function
triggerCarWorkflow();