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
    'LIHTC-dashboard.html',           // redirect stub → lihtc-allocations.html
    'lihtc-allocations.html',          // consolidated LIHTC page (PR 2.1)
    'colorado-deep-dive.html',
    'lihtc-guide-for-stakeholders.html',
    'dashboard.html',
    'regional.html',
    'state-allocation-map.html',       // redirect stub → lihtc-allocations.html
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
    'js/housing-needs-assessment.js', // compatibility stub; page behavior loads js/hna/* modules
    'js/main.js',
    'js/path-resolver.js',
    'js/fetch-helper.js',
    'js/data-service-portable.js',
    'js/dark-mode-toggle.js',
    'js/navigation.js',
    'js/glossary.js',                  // PR 1.2 — global glossary modal
    'js/help-modal.js',                // PR 2.2 — "How to use" help modals
    'js/data-status-footer.js',        // PR 2.3 — data status injection
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
// Data files
// ---------------------------------------------------------------------------
const DATA_FILES = [
    'data/allocations.json',
    'data/census-acs-state.json',
    'data/co_ami_gap_by_county.json',
    'data/fred-data.json',
    'data/states-10m.json',
    'data/glossary.json',              // PR 1.2 — acronym definitions
    'data/hna/geo-config.json',
    'data/hna/local-resources.json',
    'data/hna/summary',
    'data/hna/lehd',
    'data/hna/dola_sya',
    'data/hna/projections',
    'data/hna/derived',
];

test('Data files: required data files and directories exist with correct case', () => {
    for (const f of DATA_FILES) {
        assert(fileExists(f), `${f} exists`);
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
    assert(content.includes('node scripts/build-public-site.mjs'), 'public artifact build step present');
    assert(content.includes('node scripts/audit/public-artifact-guard.mjs dist'), 'public artifact guard step present');
    assert(content.includes('path: dist'),            "artifact path is dist");
    assert(content.includes('deploy-pages'),         'deploy-pages action present');
});

test('Deploy watchdog: automation commits cannot silently miss Pages deploy', () => {
    const archiveYml = '.github/workflows/archive-audit-post-merge.yml';
    const watchdogYml = '.github/workflows/pages-deploy-watchdog.yml';
    assert(fileExists(archiveYml), 'archive-audit-post-merge.yml exists');
    assert(fileExists(watchdogYml), 'pages-deploy-watchdog.yml exists');

    const archive = fs.readFileSync(path.join(ROOT, archiveYml), 'utf8');
    assert(archive.includes('actions: write'), 'archive workflow can dispatch downstream workflows');
    assert(archive.includes('gh workflow run deploy.yml --ref main'), 'archive workflow dispatches Pages deploy after automation commit');

    const watchdog = fs.readFileSync(path.join(ROOT, watchdogYml), 'utf8');
    assert(watchdog.includes('schedule:'), 'Pages deploy watchdog has a scheduled trigger');
    assert(watchdog.includes("workflow_id: workflowId"), 'Pages deploy watchdog queries deploy.yml runs');
    assert(watchdog.includes('head_sha === headSha'), 'Pages deploy watchdog compares deploy run SHA to main HEAD');
    assert(watchdog.includes('core.setFailed'), 'Pages deploy watchdog fails loudly when deploy coverage is missing');
});

test('robots.txt: public crawler policy does not pretend to protect private paths', () => {
    const robotsPath = 'robots.txt';
    assert(fileExists(robotsPath), 'robots.txt exists');
    const robots = fs.readFileSync(path.join(ROOT, robotsPath), 'utf8');
    assert(robots.includes('Allow: /'), 'robots.txt allows public site crawl');
    assert(robots.includes('Disallow: /data/'), 'robots.txt discourages crawler indexing of shipped data files');
    assert(
        !/Disallow:\s*\/(scripts|serverless|cloudflare-worker|test|tools|Housing-Analytics)/.test(robots),
        'robots.txt has no stale private/source-path Disallow blocks'
    );
    // De-pinned from a literal URL: assert a well-formed Sitemap line whose host matches the live
    // custom domain in CNAME. Pinning the exact URL here broke EVERY deploy when robots.txt was
    // repointed to cohoanalytics.com (#975, fixed in #977) — this test runs inside deploy.yml.
    // Deriving the host from CNAME keeps the invariant (sitemap host == custom domain) without a
    // hard-coded value that a future domain change would silently break.
    const sitemapLine = robots.match(/^Sitemap:\s*(https:\/\/\S+\/sitemap\.xml)\s*$/m);
    assert(sitemapLine, 'robots.txt advertises an https .../sitemap.xml URL');
    const cnamePath = path.join(ROOT, 'CNAME');
    if (fs.existsSync(cnamePath)) {
        const domain = fs.readFileSync(cnamePath, 'utf8').trim();
        assert(
            sitemapLine[1] === `https://${domain}/sitemap.xml`,
            `robots.txt sitemap host matches custom domain from CNAME (${domain})`
        );
    }
});

test('sitemap.xml: public sitemap includes generated place pages and excludes private/redirect pages', () => {
    const sitemapPath = 'sitemap.xml';
    assert(fileExists(sitemapPath), 'sitemap.xml exists');
    const sitemap = fs.readFileSync(path.join(ROOT, sitemapPath), 'utf8');
    const urls = sitemap.match(/<loc>https:\/\/[^<]+<\/loc>/g) || [];
    const placeUrls = sitemap.match(/<loc>https:\/\/[^<]+\/places\/\d{7}\.html<\/loc>/g) || [];
    assert(urls.length >= 500, `sitemap includes public tool pages plus place profiles (${urls.length} URLs)`);
    assert(placeUrls.length >= 480, `sitemap includes generated place profiles (${placeUrls.length} place URLs)`);
    assert(!sitemap.includes('_template.html'), 'sitemap excludes place template');
    assert(!sitemap.includes('404.html'), 'sitemap excludes 404 page');
    assert(!sitemap.includes('developer-brief'), 'sitemap excludes private developer pages');
    assert(!urls.some((u) => u.includes('state-allocation-map.html')), 'sitemap excludes state-allocation-map redirect stub');
});

// ---------------------------------------------------------------------------
// Run-all-data-workflows orchestrator
// ---------------------------------------------------------------------------
test('Run-all-workflows: run-all-workflows.yml exists and is properly configured', () => {
    const ymlPath = '.github/workflows/run-all-workflows.yml';
    assert(fileExists(ymlPath), 'run-all-workflows.yml exists');

    const content = fs.readFileSync(path.join(ROOT, ymlPath), 'utf8');
    assert(content.includes('workflow_dispatch'),         'workflow_dispatch trigger present');
    assert(content.includes('schedule'),                  'schedule trigger present');
    assert(content.includes('actions: write'),            'actions: write permission present');
    assert(content.includes('actions/checkout'),          'actions/checkout step present');

    // Must list only data workflows — not CI/deploy/audit workflows
    assert(content.includes('build-hna-data.yml'),        'build-hna-data.yml in data list');
    assert(content.includes('fetch-census-acs.yml'),      'fetch-census-acs.yml in data list');
    assert(content.includes('fetch-fred-data.yml'),       'fetch-fred-data.yml in data list');
    assert(content.includes('market_data_build.yml'), 'market data workflow in data list');
    assert(!content.includes('ci-checks.yml'),            'ci-checks.yml excluded from data list');
    assert(!content.includes('deploy.yml'),               'deploy.yml excluded from data list');
    assert(!content.includes('site-audit.yml'),           'site-audit.yml excluded from data list');

    // Must report errors (not just trigger failures)
    assert(content.includes('::error::'),                 '::error:: annotation used for failures');
    assert(content.includes('exit 1'),                    'exits with failure when workflows fail');

    // Must wait for completion (polling)
    assert(content.includes('gh run view'),               'polls run status with gh run view');
});

// ---------------------------------------------------------------------------
// CSS assets
// ---------------------------------------------------------------------------
test('CSS directory: css/ directory is present and contains stylesheets', () => {
    assert(fileExists('css'), 'css/ directory exists');
    const cssFiles = fs.readdirSync(path.join(ROOT, 'css')).filter(f => f.endsWith('.css'));
    assert(cssFiles.length > 0, `css/ contains ${cssFiles.length} stylesheet(s)`);
    assert(fileExists('css/help-modal.css'), 'css/help-modal.css exists (PR 2.2)');
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
test('housing-needs-assessment.html: loads js/config.js', () => {
    const htmlPath = path.join(ROOT, 'housing-needs-assessment.html');
    if (!fileExists('housing-needs-assessment.html')) {
        assert(false, 'housing-needs-assessment.html missing — cannot check script references');
        return;
    }
    const html = fs.readFileSync(htmlPath, 'utf8');
    assert(html.includes('js/config.js'), 'js/config.js is referenced');
    // js/housing-needs-assessment.js is a compatibility stub and is not loaded;
    // the page loads the modular js/hna/* files instead.
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
