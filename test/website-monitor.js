'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

async function checkLink(url) {
    try {
        const response = await axios.get(url);
        return { url, status: response.status };
    } catch (error) {
        return { url, status: error.response ? error.response.status : 'Error' };
    }
}

async function scanWebsite(startUrl) {
    const links = []; // Populate with the website's links
    // ... code to crawl and collect links
    const results = await Promise.all(links.map(link => checkLink(link)));
    return results;
}

function generateReport(results) {
    const reportPath = './website-monitor-report.txt';
    fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));
    console.log('Report generated at ' + reportPath);
}

(async () => {
    const startUrl = 'https://your-website.com'; // Replace with actual URL
    const results = await scanWebsite(startUrl);
    generateReport(results);
})();
