'use strict';

const { exec } = require('child_process');

exec('lighthouse colorado-deep-dive.html --output json --output-html --output-path ./report.html', (error, stdout, stderr) => {
    if (error) {
        console.error(`Error: ${error.message}`);
        return;
    }
    if (stderr) {
        console.error(`Error: ${stderr}`);
        return;
    }
    console.log(`Lighthouse audit completed:
${stdout}`);
});
