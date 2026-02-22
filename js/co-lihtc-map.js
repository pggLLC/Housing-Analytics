// Load dependencies
import 'leaflet';

// Define the fallback data
const FALLBACK_LIHTC = [...]; // Define your fallback data
const FALLBACK_QCT = [...]; // Define your fallback data
const FALLBACK_DDA = [...]; // Define your fallback data

// Initialize map function
function initMap() {
    const map = L.map('map').setView([39.7392, -104.9903], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
        maxZoom: 19 
    }).addTo(map);

    // Fetch data from APIs
    fetchData();
}

// Fetch data from APIs
async function fetchData() {
    try {
        const response = await fetch('https://api.example.com/data');
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        validateData(data) ? renderData(data) : renderFallback();
    } catch (error) {
        console.error('API Fetch Error:', error);
        renderFallback();
    }
}

// Validate data before rendering
function validateData(data) {
    // Add validation logic as per the expected structure; e.g., check data types and required fields
    return Array.isArray(data) && data.length > 0;
}

// Render data on map
function renderData(data) {
    data.forEach(item => {
        // Add null checks before accessing properties
        if (item && item.coordinates) {
            L.marker(item.coordinates).addTo(map);
        } else {
            console.warn('Invalid item:', item);
        }
    });
}

// Render fallback data
function renderFallback() {
    console.warn('Rendering fallback data');
    renderData(FALLBACK_LIHTC);
}

// Improve user status messaging
function updateStatus(message) {
    const statusElement = document.getElementById('status');
    if (statusElement) {
        statusElement.innerText = message;
    }
}

// Add timeout handling for slow responses
async function fetchDataWithTimeout(url, options, timeout = 5000) {
    return Promise.race([
        fetch(url, options),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), timeout))
    ]);
}

// On document loaded, initialize map
document.addEventListener('DOMContentLoaded', () => {
    updateStatus('Loading map...');
    initMap();
});