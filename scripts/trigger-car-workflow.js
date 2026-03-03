// This script triggers the car-data-update workflow with the correct CAR data structure.

const fetch = require('node-fetch');

const CAR_SECRET = process.env.CAR_SECRET;
const API_URL = 'https://api.github.com/repos/pggLLC/Housing-Analytics/actions/workflows/car-data-update.yml/dispatches';

// Define the correct CAR data structure required by the workflow
const carData = {
    // Populate this object with the necessary CAR data fields
    // placeholder: 'value',
};

const options = {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${CAR_SECRET}`,
        'Accept': 'application/vnd.github.v3+json',
    },
    body: JSON.stringify({ ref: 'main', inputs: { carData }}),
};

fetch(API_URL, options)
    .then(response => {
        if (!response.ok) {
            throw new Error(`Error: ${response.statusText}`);
        }
        return response.json();
    })
    .then(data => console.log('Workflow triggered successfully:', data))
    .catch(error => console.error('Error triggering workflow:', error));