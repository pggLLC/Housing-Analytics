const { exec } = require('child_process');
const lighthouse = require('lighthouse');
const chromeLauncher = require('chrome-launcher');

const runLighthouse = async () => {
    const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] });
    const options = {
        logLevel: 'info',
        output: ['html', 'json'],
        onlyCategories: ['performance', 'accessibility', 'seo'],
        port: chrome.port
    };

    const runnerResult = await lighthouse('colorado-deep-dive.html', options);
    
    // Save the report
    const reportHtml = runnerResult.report;
    const reportJson = runnerResult.lhr;

    // Output scores to console
    console.log('Performance score:', reportJson.categories.performance.score * 100);
    console.log('Accessibility score:', reportJson.categories.accessibility.score * 100);
    console.log('SEO score:', reportJson.categories.seo.score * 100);

    await chrome.kill();
};

runLighthouse();
