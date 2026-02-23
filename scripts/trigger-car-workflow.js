const axios = require('axios');

const triggerCarWorkflow = async () => {
    const url = 'https://api.github.com/repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches';
    const data = {
        ref: 'main',
        inputs: {
            // Add your inputs here
        }
    };

    try {
        const response = await axios.post(url, data, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`
            }
        });
        console.log('Workflow triggered:', response.data);
    } catch (error) {
        console.error('Error triggering workflow:', error);
    }
};

triggerCarWorkflow();
