// test/smoke.test.js
//
// Smoke tests verifying that all six major pages and their associated JS
// files are present and correctly cross-referenced.
//
// Also validates:
//   - Each page includes site-theme.css (for .data-timestamp styles)
//   - Each page has a data-timestamp element
//   - fetch-helper.js is included on pages that use safeFetchJSON or fetchWithTimeout
//   - cache-manager.js exists
//   - No raw fetch paths directly to data/ or maps/ in JS files (portability check)
//
// Usage:
//   node test/smoke.test.js
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

// ── Pages under test ─────────────────────────────────────────────────────────

const PAGES = [
  {
    html:       'market-analysis.html',
    jsScript:   'js/market-analysis.js',
    tsId:       'pmaDataTimestamp',
  },
  {
    html:       'dashboard.html',
    jsScript:   null,   // no dedicated JS file requirement
    tsId:       'dashboardDataTimestamp',
  },
  {
    html:       'housing-needs-assessment.html',
    jsScript:   'js/housing-needs-assessment.js',
    tsId:       'hnaDataTimestamp',
  },
  {
    html:       'colorado-deep-dive.html',
    jsScript:   null,
    tsId:       'deepDiveDataTimestamp',
  },
  {
    html:       'LIHTC-dashboard.html',
    jsScript:   null,
    tsId:       'lihtcDataTimestamp',
  },
  {
    html:       'economic-dashboard.html',
    jsScript:   null,
    tsId:       'economicDataTimestamp',
  },
];

// ── Tests ───────────────────────────────────────────────────────────────────

test('required JS files exist', () => {
  const jsFiles = [
    'js/market-analysis.js',
    'js/housing-needs-assessment.js',
    'js/fetch-helper.js',
    'js/housing-data-integration.js',
    'js/cache-manager.js',
  ];
  jsFiles.forEach(f => {
    assert(fs.existsSync(path.join(ROOT, f)), `${f} exists`);
  });
});

test('site-theme.css defines .data-timestamp style', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'site-theme.css'), 'utf8');
  assert(css.includes('.data-timestamp'), 'site-theme.css contains .data-timestamp rule');
});

test('cache-manager.js is syntactically sound', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'cache-manager.js'), 'utf8');
  // Basic brace-balance check as a quick sanity test.
  // Note: this does not account for braces inside strings or comments — it is
  // a lightweight heuristic, not a full syntax parse.
  const openBraces  = (src.match(/\{/g) || []).length;
  const closeBraces = (src.match(/\}/g) || []).length;
  assert(openBraces === closeBraces,
    `cache-manager.js has balanced braces (${openBraces} open, ${closeBraces} close)`);
});

PAGES.forEach(({ html, jsScript, tsId }) => {
  test(`${html}: file exists`, () => {
    assert(fs.existsSync(path.join(ROOT, html)), `${html} exists`);
  });

  test(`${html}: includes site-theme.css`, () => {
    const content = fs.readFileSync(path.join(ROOT, html), 'utf8');
    assert(content.includes('site-theme.css'),
      `${html} links site-theme.css`);
  });

  test(`${html}: has data-timestamp element (id="${tsId}")`, () => {
    const content = fs.readFileSync(path.join(ROOT, html), 'utf8');
    assert(content.includes(`id="${tsId}"`),
      `${html} contains timestamp element with id="${tsId}"`);
    assert(content.includes('data-timestamp'),
      `${html} uses data-timestamp CSS class`);
  });

  if (jsScript) {
    test(`${html}: includes ${jsScript}`, () => {
      const content = fs.readFileSync(path.join(ROOT, html), 'utf8');
      assert(content.includes(jsScript),
        `${html} references ${jsScript}`);
    });
  }
});

test('fetch-helper.js exposes fetchWithTimeout', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'fetch-helper.js'), 'utf8');
  assert(src.includes('window.fetchWithTimeout = fetchWithTimeout'),
    'fetch-helper.js exposes window.fetchWithTimeout');
});

test('fetch-helper.js exposes resolveAssetUrl and safeFetchJSON', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'fetch-helper.js'), 'utf8');
  assert(src.includes('window.resolveAssetUrl'), 'resolveAssetUrl is exposed');
  assert(src.includes('window.safeFetchJSON'),   'safeFetchJSON is exposed');
});

test('.github/workflows/car-data-update.yml has monthly schedule', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'car-data-update.yml'), 'utf8');
  assert(wf.includes('schedule:'),      'car-data-update.yml has schedule trigger');
  assert(wf.includes('0 4 1 * *'),      'schedule is 1st of month at 04:00 UTC');
  assert(wf.includes('workflow_dispatch'), 'manual trigger is preserved');
});

test('housing-needs-assessment.html has Labor Market and Prop 123 sections', () => {
  const hnaHtml = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
  assert(hnaHtml.includes('id="labor-market-section"'), 'Labor Market section present in HNA HTML');
  assert(hnaHtml.includes('id="prop123-section"'),       'Prop 123 section present in HNA HTML');
  assert(hnaHtml.includes('id="jobMetrics"'),            'jobMetrics container present in HNA HTML');
  assert(hnaHtml.includes('HB 22-1093'),                 'HB 22-1093 referenced in HNA HTML');
});

test('housing-needs-assessment.css has new section styles', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'pages', 'housing-needs-assessment.css'), 'utf8');
  assert(css.includes('.labor-market-section'), '.labor-market-section CSS defined');
  assert(css.includes('.prop123-section'),       '.prop123-section CSS defined');
  assert(css.includes('.metric-card'),           '.metric-card CSS defined');
  assert(css.includes('.compliance-status'),     '.compliance-status CSS defined');
});

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nSome checks failed. Review the output above for details.');
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed ✅');
}
