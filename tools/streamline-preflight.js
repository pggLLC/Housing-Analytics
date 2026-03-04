// tools/streamline-preflight.js
//
// Preflight verification script for SEO and compliance assets.
// Verifies robots.txt, sitemap.xml, and the Privacy Policy section in about.html.
//
// Usage:
//   node tools/streamline-preflight.js              # run all checks
//   node tools/streamline-preflight.js --only=seo   # run only SEO/compliance checks
//   node tools/streamline-preflight.js --verbose     # verbose output
//   node tools/streamline-preflight.js --json=report.json  # export JSON report
//
// Exit code 0 = all asserts passed; non-zero = one or more assert failures.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

const onlyFlag     = args.find(a => a.startsWith('--only='));
const onlyCategory = onlyFlag ? onlyFlag.split('=')[1].toLowerCase() : null;
const jsonFlag     = args.find(a => a.startsWith('--json='));

// ---------------------------------------------------------------------------
// ANSI color helpers
// ---------------------------------------------------------------------------
const C = {
    reset:  '\x1b[0m',
    bold:   '\x1b[1m',
    green:  '\x1b[32m',
    yellow: '\x1b[33m',
    red:    '\x1b[31m',
    cyan:   '\x1b[36m',
};

// ---------------------------------------------------------------------------
// Counters & result log
// ---------------------------------------------------------------------------
let passed  = 0;
let warned  = 0;
let failed  = 0;
const results = [];

// ---------------------------------------------------------------------------
// Core assertion helpers
// ---------------------------------------------------------------------------

/** Hard failure — increments failed counter and sets non-zero exit code. */
function assert(condition, message, category) {
    if (condition) {
        console.log(`  ${C.green}✅${C.reset}  [${category}] ${message}`);
        passed++;
        results.push({ type: 'PASS', category, message });
    } else {
        console.error(`  ${C.red}❌${C.reset}  [${category}] ${message}`);
        failed++;
        results.push({ type: 'FAIL', category, message });
    }
}

/** Soft warning — logs a warning but does not fail the script. */
function warn(condition, message, category) {
    if (condition) {
        console.log(`  ${C.green}✅${C.reset}  [${category}] ${message}`);
        passed++;
        results.push({ type: 'PASS', category, message });
    } else {
        console.warn(`  ${C.yellow}⚠️${C.reset}   [${category}] ${message}`);
        warned++;
        results.push({ type: 'WARN', category, message });
    }
}

// ---------------------------------------------------------------------------
// File utilities
// ---------------------------------------------------------------------------

/** Case-sensitive existence check (avoids false-positives on macOS/Windows). */
function exists(relPath) {
    const full = path.join(ROOT, relPath);
    if (!fs.existsSync(full)) return false;
    const dir  = path.dirname(full);
    const base = path.basename(full);
    return fs.readdirSync(dir).includes(base);
}

/** Read file contents as UTF-8 string; returns '' on error. */
function readFile(relPath) {
    try {
        return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    } catch (_) {
        return '';
    }
}

// ---------------------------------------------------------------------------
// SEO & Compliance test suite
// ---------------------------------------------------------------------------

function testSeoCompliance() {

    // -----------------------------------------------------------------------
    // robots.txt — SEO-ROBOTS-TXT
    // -----------------------------------------------------------------------
    console.log(`\n${C.cyan}${C.bold}--- robots.txt (SEO-ROBOTS-TXT) ---${C.reset}`);
    const CAT_ROBOTS = 'SEO-ROBOTS-TXT';

    const robotsExists = exists('robots.txt');
    assert(robotsExists, 'robots.txt exists at repository root', CAT_ROBOTS);

    if (robotsExists) {
        const robots = readFile('robots.txt');
        assert(robots.includes('User-agent: *'),      'Contains User-agent: *',           CAT_ROBOTS);
        assert(robots.includes('Disallow: /data/'),   'Disallows /data/ directory',        CAT_ROBOTS);
        assert(robots.includes('Disallow: /scripts/'), 'Disallows /scripts/ directory',    CAT_ROBOTS);
        assert(robots.includes('Disallow: /test/'),   'Disallows /test/ directory',        CAT_ROBOTS);
        assert(
            robots.includes('Sitemap:') && robots.includes('sitemap.xml'),
            'Contains Sitemap: directive pointing to sitemap.xml',
            CAT_ROBOTS
        );
        warn(
            !(/^Disallow: \/$/m.test(robots)),
            'Does not globally disable crawlers (Disallow: /)',
            CAT_ROBOTS
        );
    }

    // -----------------------------------------------------------------------
    // sitemap.xml — SEO-SITEMAP-XML
    // -----------------------------------------------------------------------
    console.log(`\n${C.cyan}${C.bold}--- sitemap.xml (SEO-SITEMAP-XML) ---${C.reset}`);
    const CAT_SITEMAP = 'SEO-SITEMAP-XML';

    const sitemapExists = exists('sitemap.xml');
    assert(sitemapExists, 'sitemap.xml exists at repository root', CAT_SITEMAP);

    if (sitemapExists) {
        const sitemap = readFile('sitemap.xml');
        assert(
            sitemap.includes('<urlset') && sitemap.includes('</urlset>'),
            'Valid XML structure with <urlset> root and closing tag',
            CAT_SITEMAP
        );

        const majorPages = [
            'index.html',
            'colorado-deep-dive.html',
            'housing-needs-assessment.html',
            'economic-dashboard.html',
            'LIHTC-dashboard.html',
        ];
        for (const page of majorPages) {
            warn(sitemap.includes(page), `Sitemap includes major page: ${page}`, CAT_SITEMAP);
        }

        assert(sitemap.includes('<priority>'),  'Contains <priority> values for tiering', CAT_SITEMAP);
        warn(sitemap.includes('<lastmod>'),      'Contains <lastmod> dates',               CAT_SITEMAP);
    }

    // -----------------------------------------------------------------------
    // Privacy Policy in about.html — COMPLIANCE-PRIVACY-POLICY
    // -----------------------------------------------------------------------
    console.log(`\n${C.cyan}${C.bold}--- Privacy Policy in about.html (COMPLIANCE-PRIVACY-POLICY) ---${C.reset}`);
    const CAT_PRIVACY = 'COMPLIANCE-PRIVACY-POLICY';

    const aboutExists = exists('about.html');
    assert(aboutExists, 'about.html exists', CAT_PRIVACY);

    if (aboutExists) {
        const about = readFile('about.html');

        assert(
            about.includes('id="privacy-policy"'),
            'Contains section with id="privacy-policy" anchor',
            CAT_PRIVACY
        );

        const privacyIdx    = about.indexOf('id="privacy-policy"');
        const disclaimerIdx = about.indexOf('Disclaimer');
        assert(
            privacyIdx !== -1 && disclaimerIdx !== -1 && privacyIdx < disclaimerIdx,
            'Privacy Policy section appears before Disclaimer section',
            CAT_PRIVACY
        );

        const requiredTerms = ['PII', 'FRED', 'Census', 'cookies', 'third-party', 'data'];
        for (const term of requiredTerms) {
            warn(
                about.toLowerCase().includes(term.toLowerCase()),
                `Mentions required coverage term: "${term}"`,
                CAT_PRIVACY
            );
        }

        const ppIdx = about.indexOf('id="privacy-policy"');
        warn(
            about.includes('class="chart-card"') &&
            ppIdx !== -1 &&
            about.slice(Math.max(0, ppIdx - 50), ppIdx + 50).includes('chart-card'),
            'Privacy Policy uses .chart-card styling for visual consistency',
            CAT_PRIVACY
        );
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
    console.log(`${C.bold}=== streamline-preflight: SEO & Compliance Checks ===${C.reset}\n`);

    const runAll = !onlyCategory;
    const runSeo = runAll || onlyCategory === 'seo';

    if (runSeo) {
        testSeoCompliance();
    }

    // Summary
    console.log('\n' + '='.repeat(52));
    console.log(
        `streamline-preflight: ` +
        `${C.green}${passed} passed${C.reset}, ` +
        `${C.yellow}${warned} warned${C.reset}, ` +
        `${C.red}${failed} failed${C.reset}`
    );

    if (jsonFlag) {
        const outPath = path.resolve(jsonFlag.split('=')[1]);
        const report  = { passed, warned, failed, results, timestamp: new Date().toISOString() };
        fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
        console.log(`\nJSON report written to: ${outPath}`);
    }

    if (failed > 0) {
        console.error(`\n${C.red}Pre-flight check FAILED.${C.reset} Fix the issues above before deploying.`);
        process.exitCode = 1;
    } else if (warned > 0) {
        console.log(`\n${C.yellow}Pre-flight check PASSED with warnings.${C.reset} Review warnings above.`);
    } else {
        console.log(`\n${C.green}Pre-flight check PASSED ✅${C.reset}  — all SEO & compliance checks clear.`);
    }
}

main();
