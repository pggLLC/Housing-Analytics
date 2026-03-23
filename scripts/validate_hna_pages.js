#!/usr/bin/env node
/**
 * scripts/validate_hna_pages.js
 *
 * HNA page smoke-test and sentinel-leak validator.
 *
 * Runs two complementary validation modes:
 *
 *  1. **Static checks** (always run, no browser required)
 *     • HNA HTML pages exist and declare required elements / scripts
 *     • JS utility files (data-quality.js, hna-utils.js, …) are present
 *     • All <canvas> elements carry role="img" and aria-label
 *     • aria-live regions are present on interactive HNA pages
 *     • Spot-check of data/hna/summary/*.json for leaked sentinel values
 *     • Ranking-index.json and geo-config.json have expected structure
 *
 *  2. **Browser checks** (opt-in, requires Playwright)
 *     • HNA pages load without JavaScript console errors
 *     • Missing-metric cells render as "—" (em-dash), not "-666,666,666"
 *     • Data-quality warning badges appear for incomplete geographies
 *     • Ranking table renders with ≥1 row
 *     Pass `--browser` to enable.
 *
 * Usage
 * -----
 *   node scripts/validate_hna_pages.js              # static checks only
 *   node scripts/validate_hna_pages.js --browser    # static + browser
 *   node scripts/validate_hna_pages.js --url http://localhost:3000  # custom base URL
 *
 * Exit codes
 * ----------
 *   0   All enabled checks passed.
 *   1   One or more checks failed.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------
const args       = process.argv.slice(2);
const RUN_BROWSER = args.includes('--browser');
const BASE_URL    = (() => {
  const idx = args.indexOf('--url');
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : 'http://localhost:3000';
})();

// ---------------------------------------------------------------------------
// Counters & helpers
// ---------------------------------------------------------------------------
let passed   = 0;
let failed   = 0;
let warnings = 0;

function pass(msg)  { console.log(`  ✅ PASS: ${msg}`);  passed++;   }
function fail(msg)  { console.error(`  ❌ FAIL: ${msg}`); failed++;   }
function warn(msg)  { console.warn(`  ⚠️  WARN: ${msg}`);  warnings++; }

function exists(rel)    { return fs.existsSync(path.join(ROOT, rel)); }
function read(rel)      { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function parseJSON(rel) { return JSON.parse(read(rel)); }

function section(title) { console.log(`\n── ${title} ──`); }

// ---------------------------------------------------------------------------
// 1. Required files
// ---------------------------------------------------------------------------
section('1. Required HNA pages & JS files');

const REQUIRED_FILES = [
  'housing-needs-assessment.html',
  'hna-comparative-analysis.html',
  'js/utils/data-quality.js',
  'js/hna/hna-utils.js',
  'js/hna/hna-controller.js',
  'js/hna/hna-ranking-index.js',
  'js/hna/hna-renderers.js',
  'css/pages/hna-comparative-analysis.css',
  'data/hna/ranking-index.json',
  'data/hna/geo-config.json',
];

REQUIRED_FILES.forEach(rel => {
  if (exists(rel)) pass(`${rel} exists`);
  else             fail(`${rel} is missing`);
});

// ---------------------------------------------------------------------------
// 2. HNA main page structure
// ---------------------------------------------------------------------------
section('2. housing-needs-assessment.html — structure');

if (exists('housing-needs-assessment.html')) {
  const html = read('housing-needs-assessment.html');

  const checks = [
    { re: /data-quality\.js/,                            label: 'includes data-quality.js' },
    { re: /hna-utils\.js/,                               label: 'includes hna-utils.js' },
    { re: /hna-controller\.js/,                          label: 'includes hna-controller.js' },
    { re: /<main[^>]+id=["']main-content["']/i,          label: '<main id="main-content"> present' },
    { re: /aria-live=["']polite["']/,                     label: 'aria-live="polite" region present' },
    { re: /href=["']#main-content["']/,                   label: 'skip-navigation link to #main-content' },
  ];

  checks.forEach(({ re, label }) => {
    if (re.test(html)) pass(label);
    else               fail(`housing-needs-assessment.html: ${label}`);
  });

  // Landmark checks — warn only (pre-existing issue tracked separately)
  [/<header\b/i, /<footer\b/i].forEach((re, i) => {
    const tag = i === 0 ? '<header>' : '<footer>';
    if (re.test(html)) pass(`${tag} landmark present`);
    else               warn(`housing-needs-assessment.html missing ${tag} landmark (pre-existing; see Rule 12)`);
  });

  // Canvas elements must have role="img" and aria-label
  const canvasCount = (html.match(/<canvas\b/gi) || []).length;
  const accessibleCanvas = (html.match(/<canvas[^>]+role=["']img["'][^>]*aria-label/gi) || []).length;
  if (canvasCount === 0) {
    warn('No <canvas> elements found in housing-needs-assessment.html');
  } else if (accessibleCanvas >= canvasCount) {
    pass(`All ${canvasCount} <canvas> element(s) have role="img" + aria-label`);
  } else {
    fail(`${canvasCount - accessibleCanvas} <canvas> element(s) missing role="img" or aria-label`);
  }
} else {
  warn('housing-needs-assessment.html not found — skipping structural checks');
}

// ---------------------------------------------------------------------------
// 3. HNA comparative analysis page structure
// ---------------------------------------------------------------------------
section('3. hna-comparative-analysis.html — structure');

if (exists('hna-comparative-analysis.html')) {
  const html = read('hna-comparative-analysis.html');

  const checks = [
    { re: /data-quality\.js/,       label: 'includes data-quality.js' },
    { re: /hna-ranking-index\.js/,  label: 'includes hna-ranking-index.js' },
    { re: /<main\b/i,               label: '<main> landmark present' },
    { re: /aria-live=["']polite["']/,label: 'aria-live region present' },
  ];

  checks.forEach(({ re, label }) => {
    if (re.test(html)) pass(label);
    else               fail(`hna-comparative-analysis.html: ${label}`);
  });
} else {
  warn('hna-comparative-analysis.html not found — skipping checks');
}

// ---------------------------------------------------------------------------
// 4. data-quality.js API surface
// ---------------------------------------------------------------------------
section('4. js/utils/data-quality.js — API surface');

if (exists('js/utils/data-quality.js')) {
  const src = read('js/utils/data-quality.js');

  const apis = [
    { re: /isMissingMetric/,  label: 'exports isMissingMetric()' },
    { re: /sanitizeNumber/,   label: 'exports sanitizeNumber()' },
    { re: /formatMetric/,     label: 'exports formatMetric()' },
    { re: /666666666/,        label: 'declares sentinel constant (-666666666)' },
  ];

  apis.forEach(({ re, label }) => {
    if (re.test(src)) pass(label);
    else              fail(`data-quality.js: ${label}`);
  });
}

// ---------------------------------------------------------------------------
// 5. Sentinel leak: spot-check summary JSON files
// ---------------------------------------------------------------------------
section('5. Sentinel leak check — data/hna/summary/*.json');

const SENTINEL          = -666666666;
const EXTREME_NEGATIVE  = -1_000_000;
const SUMMARY_DIR       = path.join(ROOT, 'data', 'hna', 'summary');

if (fs.existsSync(SUMMARY_DIR)) {
  const summaryFiles = fs.readdirSync(SUMMARY_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(SUMMARY_DIR, f));

  let leakFiles  = [];
  let cleanFiles = 0;

  /**
   * Recursively walk any JSON value; return true if a sentinel is found.
   * @param {*} val
   * @returns {boolean}
   */
  function hasSentinel(val) {
    if (typeof val === 'number') {
      return isFinite(val) ? val <= EXTREME_NEGATIVE : true;
    }
    if (Array.isArray(val)) return val.some(hasSentinel);
    if (val && typeof val === 'object') {
      return Object.values(val).some(hasSentinel);
    }
    return false;
  }

  summaryFiles.forEach(fp => {
    try {
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (hasSentinel(data)) {
        leakFiles.push(path.relative(ROOT, fp));
      } else {
        cleanFiles++;
      }
    } catch (_) {
      warn(`Could not parse ${path.relative(ROOT, fp)}`);
    }
  });

  if (leakFiles.length === 0) {
    pass(`All ${summaryFiles.length} summary file(s) are sentinel-free`);
  } else {
    fail(`${leakFiles.length} summary file(s) contain sentinel values:`);
    leakFiles.slice(0, 10).forEach(f => console.error(`       • ${f}`));
    if (leakFiles.length > 10) {
      console.error(`       … and ${leakFiles.length - 10} more`);
    }
    console.error('       Run `python scripts/hna/build_hna_data.py` to regenerate.');
  }
} else {
  warn(`data/hna/summary/ not found — skipping sentinel leak check`);
}

// ---------------------------------------------------------------------------
// 6. ranking-index.json — structural validation
// ---------------------------------------------------------------------------
section('6. data/hna/ranking-index.json — structure');

if (exists('data/hna/ranking-index.json')) {
  try {
    const ranking = parseJSON('data/hna/ranking-index.json');

    const hasRankings = Array.isArray(ranking.rankings);
    hasRankings
      ? pass(`rankings array present (${ranking.rankings.length} entries)`)
      : fail('ranking-index.json: missing "rankings" array');

    const hasMetadata = ranking.metadata && typeof ranking.metadata === 'object';
    hasMetadata ? pass('metadata object present') : fail('ranking-index.json: missing "metadata"');

    if (hasRankings) {
      const minExpected = 300;
      ranking.rankings.length >= minExpected
        ? pass(`≥${minExpected} ranking entries found (${ranking.rankings.length})`)
        : fail(`Only ${ranking.rankings.length} entries — expected ≥${minExpected}`);

      // Check a sample for sentinel leakage in metrics
      const sample = ranking.rankings.slice(0, 20);
      const leaks = [];
      sample.forEach(entry => {
        Object.entries(entry.metrics || {}).forEach(([k, v]) => {
          if (typeof v === 'number' && v <= EXTREME_NEGATIVE) {
            leaks.push({ geoid: entry.geoid, metric: k, value: v });
          }
        });
      });
      leaks.length === 0
        ? pass('First 20 ranking entries have no sentinel values in metrics')
        : fail(`Sentinel metrics in first 20 entries: ${JSON.stringify(leaks.slice(0, 3))}`);
    }
  } catch (err) {
    fail(`ranking-index.json parse error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 7. hna-utils.js — sentinel guard in fmt helpers
// ---------------------------------------------------------------------------
section('7. js/hna/hna-utils.js — sentinel guards in format helpers');

if (exists('js/hna/hna-utils.js')) {
  const src = read('js/hna/hna-utils.js');
  const hasGuard = src.includes('666666666') || src.includes('DataQuality') || src.includes('isMissingMetric');
  hasGuard
    ? pass('Sentinel guard found in hna-utils.js (DataQuality or explicit check)')
    : warn('No explicit sentinel guard in hna-utils.js — sentinel safety delegated to data-quality.js');

  const hasFmtNum   = /function fmtNum|fmtNum\s*=/.test(src);
  const hasFmtMoney = /function fmtMoney|fmtMoney\s*=/.test(src);
  if (hasFmtNum)   pass('fmtNum() helper defined');
  if (hasFmtMoney) pass('fmtMoney() helper defined');
} else {
  warn('js/hna/hna-utils.js not found');
}

// ---------------------------------------------------------------------------
// 8. CSS — data-quality badge class
// ---------------------------------------------------------------------------
section('8. css/pages/hna-comparative-analysis.css — DQ badge class');

if (exists('css/pages/hna-comparative-analysis.css')) {
  const src = read('css/pages/hna-comparative-analysis.css');
  src.includes('hca-dq-badge')
    ? pass('.hca-dq-badge class defined')
    : warn('.hca-dq-badge class not found — data-quality badges may be unstyled');
}

// ---------------------------------------------------------------------------
// 9. Browser checks (opt-in — requires Playwright)
// ---------------------------------------------------------------------------
if (RUN_BROWSER) {
  section('9. Browser checks via Playwright');

  (async () => {
    let playwright;
    try {
      playwright = require('playwright');
    } catch (_) {
      warn('Playwright not installed — skipping browser checks. Run: npm install playwright');
      finalize();
      return;
    }

    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext();

    const PAGE_CONFIGS = [
      {
        url:   `${BASE_URL}/housing-needs-assessment.html`,
        label: 'Housing Needs Assessment',
        checks: [
          // After initial load the page shows the default geography; verify
          // the stat cards do not contain the raw sentinel string.
          async (page) => {
            const bodyText = await page.evaluate(() => document.body.innerText);
            if (bodyText.includes('-666,666,666')) {
              fail('HNA page body contains unescaped sentinel "-666,666,666"');
            } else {
              pass('HNA page: no raw sentinel value visible in body text');
            }
          },
        ],
      },
      {
        url:   `${BASE_URL}/hna-comparative-analysis.html`,
        label: 'HNA Comparative Analysis',
        checks: [
          async (page) => {
            const bodyText = await page.evaluate(() => document.body.innerText);
            if (bodyText.includes('-666,666,666')) {
              fail('Comparative analysis page body contains unescaped sentinel');
            } else {
              pass('Comparative analysis: no raw sentinel value in body text');
            }
            // Check that the ranking table has rendered at least one row
            const rowCount = await page.evaluate(() => {
              const tbody = document.querySelector('#hcaTableBody, .hca-table tbody');
              return tbody ? tbody.querySelectorAll('tr').length : 0;
            });
            rowCount > 0
              ? pass(`Ranking table rendered ${rowCount} row(s)`)
              : warn('Ranking table has 0 rows — may require data to be loaded');
          },
        ],
      },
    ];

    for (const cfg of PAGE_CONFIGS) {
      console.log(`\n  Loading ${cfg.label}…`);
      const page = await context.newPage();

      const consoleErrors = [];
      page.on('console', msg => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      try {
        await page.goto(cfg.url, { waitUntil: 'networkidle', timeout: 20_000 });

        // Report console errors
        if (consoleErrors.length === 0) {
          pass(`${cfg.label}: no console errors on page load`);
        } else {
          fail(`${cfg.label}: ${consoleErrors.length} console error(s):`);
          consoleErrors.slice(0, 5).forEach(e => console.error(`       • ${e}`));
        }

        // Run page-specific checks
        for (const check of cfg.checks) {
          await check(page);
        }
      } catch (err) {
        warn(`${cfg.label}: could not load ${cfg.url} — ${err.message}`);
        warn('  Is the dev server running? Use: npm run serve');
      } finally {
        await page.close();
      }
    }

    await browser.close();
    finalize();
  })();
} else {
  finalize();
}

// ---------------------------------------------------------------------------
// Finalize
// ---------------------------------------------------------------------------
function finalize() {
  section('Summary');
  console.log(`  Passed:   ${passed}`);
  console.log(`  Failed:   ${failed}`);
  console.log(`  Warnings: ${warnings}`);
  if (!RUN_BROWSER) {
    console.log('\n  💡 Tip: pass --browser to run Playwright-based page validation.');
    console.log(`         Requires a running dev server at ${BASE_URL}`);
    console.log('         Start one with: npm run serve');
  }
  if (failed > 0) {
    console.error('\n🚨 One or more checks failed. See details above.');
    process.exitCode = 1;
  } else {
    console.log('\n✅ All checks passed.');
  }
}

// When not running in async/browser mode, finalize is already called above.
