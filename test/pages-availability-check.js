// test/pages-availability-check.js
//
// Programmatically checks that all files required for GitHub Pages deployment
// are present in the repository, have the correct case, and are non-empty.
// Runs in Node.js without a browser.
//
// Usage:
//   node test/pages-availability-check.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`  ✅ PASS: ${message}`);
        passed++;
    } else {
        console.error(`  ❌ FAIL: ${message}`);
        failed++;
    }
}

function test(name, fn) {
    console.log(`\n[test] ${name}`);
    try {
        fn();
    } catch (err) {
        console.error(`  ❌ FAIL: threw unexpected error — ${err.message}`);
        failed++;
    }
}

// ---------------------------------------------------------------------------
// Helper: confirm a file exists AND that the on-disk name matches expected
// case exactly (catches case-insensitive OS false-positives on Linux).
// ---------------------------------------------------------------------------
function fileExists(relPath) {
    const full = path.join(ROOT, relPath);
    if (!fs.existsSync(full)) return false;
    // Verify the actual filename case matches by listing the parent directory
    const dir  = path.dirname(full);
    const base = path.basename(full);
    return fs.readdirSync(dir).includes(base);
}

function fileNonEmpty(relPath) {
    const full = path.join(ROOT, relPath);
    try {
        return fs.statSync(full).size > 0;
    } catch (_) {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Core HTML pages
// ---------------------------------------------------------------------------
const HTML_PAGES = [
    'index.html',
    'housing-needs-assessment.html',
    'economic-dashboard.html',
    'LIHTC-dashboard.html',
    'colorado-deep-dive.html',

    'dashboard.html',
    'regional.html',
    'state-allocation-map.html',
    'housing-legislation-2026.html',
    'about.html',
    'insights.html',
];

test('HTML pages: all core pages present at repository root with correct case', () => {
    for (const page of HTML_PAGES) {
        assert(fileExists(page), `${page} exists`);
    }
});

test('HTML pages: all core pages are non-empty', () => {
    for (const page of HTML_PAGES) {
        if (fileExists(page)) {
            assert(fileNonEmpty(page), `${page} is non-empty`);
        }
    }
});

// ---------------------------------------------------------------------------
// JavaScript assets
// ---------------------------------------------------------------------------
const JS_FILES = [
    'js/config.js.template',
    'js/housing-needs-assessment.js',
    'js/app.js',
    'js/dashboard.js',
    'js/main.js',
    'js/path-resolver.js',
    'js/fetch-helper.js',
    'js/data-service-portable.js',
    'js/dark-mode-toggle.js',
    'js/navigation.js',
    'js/vendor/chart.umd.min.js',
    'js/vendor/d3.v7.min.js',
    'js/vendor/leaflet.js',
    'js/vendor/leaflet.css',
    'js/vendor/topojson.v3.min.js',
];

test('JS assets: all required JavaScript files present with correct case', () => {
    for (const f of JS_FILES) {
        assert(fileExists(f), `${f} exists`);
    }
});

test('JS assets: all required JavaScript files are non-empty', () => {
    for (const f of JS_FILES) {
        if (fileExists(f)) {
            assert(fileNonEmpty(f), `${f} is non-empty`);
        }
    }
});

// ---------------------------------------------------------------------------
// Deploy workflow
// ---------------------------------------------------------------------------
test('Deploy workflow: deploy.yml exists and is properly configured', () => {
    const deployYml = '.github/workflows/deploy.yml';
    assert(fileExists(deployYml), 'deploy.yml exists');

    const content = fs.readFileSync(path.join(ROOT, deployYml), 'utf8');
    assert(content.includes('workflow_dispatch'),    'workflow_dispatch trigger present');
    assert(content.includes('actions/checkout'),     'actions/checkout step present');
    assert(content.includes('js/config.js'),         'js/config.js is generated from secrets');
    assert(content.includes("path: '.'"),            "artifact path is repo root ('.')");
    assert(content.includes('deploy-pages'),         'deploy-pages action present');
});

// ---------------------------------------------------------------------------
// CSS assets
// ---------------------------------------------------------------------------
test('CSS directory: css/ directory is present and contains stylesheets', () => {
    assert(fileExists('css'), 'css/ directory exists');
    const cssFiles = fs.readdirSync(path.join(ROOT, 'css')).filter(f => f.endsWith('.css'));
    assert(cssFiles.length > 0, `css/ contains ${cssFiles.length} stylesheet(s)`);
});

// ---------------------------------------------------------------------------
// Case-sensitivity spot-check: LIHTC-dashboard.html uses uppercase
// ---------------------------------------------------------------------------
test('Case sensitivity: LIHTC-dashboard.html uses the exact expected case', () => {
    const dir   = ROOT;
    const files = fs.readdirSync(dir);
    assert(files.includes('LIHTC-dashboard.html'), 'LIHTC-dashboard.html (exact case) found at root');
    assert(!files.includes('lihtc-dashboard.html'), 'no lower-case variant lihtc-dashboard.html exists');
});

// ---------------------------------------------------------------------------
// Validate housing-needs-assessment.html references config.js
// ---------------------------------------------------------------------------
test('housing-needs-assessment.html: loads js/config.js and js/housing-needs-assessment.js', () => {
    const htmlPath = path.join(ROOT, 'housing-needs-assessment.html');
    if (!fileExists('housing-needs-assessment.html')) {
        assert(false, 'housing-needs-assessment.html missing — cannot check script references');
        return;
    }
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert(html.includes('js/config.js'),                    'js/config.js is referenced');
    assert(html.includes('js/housing-needs-assessment.js'), 'js/housing-needs-assessment.js is referenced');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
    console.error('\nSome checks failed. Review the output above for details.');
    process.exitCode = 1;
} else {
    console.log('\nAll checks passed ✅');
}
