// test/verify-script-loads.js
//
// Verifies that every <script src="..."> referenced in colorado-deep-dive.html
// exists on disk.  Runs in plain Node.js — no browser APIs required.
//
// Usage:
//   node test/verify-script-loads.js
//
// Exit code 0 = all scripts present; non-zero = one or more missing.

'use strict';

const fs   = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

const ROOT     = path.resolve(__dirname, '..');
const HTML_FILE = path.join(ROOT, 'colorado-deep-dive.html');

function verifyScriptLoads() {
    const loadResults = [];

    // Read the HTML file from disk
    const htmlText = fs.readFileSync(HTML_FILE, 'utf8');

    // Extract all <script src="..."> values with a simple regex
    const scriptSrcRe = /<script[^>]+\bsrc=["']([^"']+)["']/gi;
    let match;
    while ((match = scriptSrcRe.exec(htmlText)) !== null) {
        const scriptSrc = match[1];
        // Skip absolute URLs (http/https) — only local paths are verifiable
        if (/^https?:\/\//i.test(scriptSrc)) {
            continue;
        }

        const scriptPath = path.join(ROOT, scriptSrc);
        const startTime  = performance.now();
        const exists     = fs.existsSync(scriptPath);
        const checkTime  = (performance.now() - startTime).toFixed(2) + ' ms';

        if (exists) {
            loadResults.push({ url: scriptSrc, status: 'found', checkTime });
        } else {
            loadResults.push({ url: scriptSrc, status: 'missing', checkTime, error: 'File not found on disk' });
        }
    }

    return loadResults;
}

const results = verifyScriptLoads();
console.table(results);

let failed = 0;
results.forEach(result => {
    if (result.error) {
        console.error(`❌ MISSING: ${result.url} — ${result.error}`);
        failed++;
    }
});

if (failed > 0) {
    console.error(`\n${failed} script(s) referenced in colorado-deep-dive.html are missing from disk.`);
    process.exitCode = 1;
} else {
    console.log(`\nAll ${results.length} scripts verified ✅`);
}
