// test/smoke-market-analysis.js
//
// Smoke tests for the Market Analysis feature.
// Checks:
//  1. market-analysis.html exists & references js/market-analysis.js
//  2. Required HTML elements present in market-analysis.html
//  3. Required data artifacts exist & contain valid JSON/GeoJSON
//  4. Prop 123 fallback file exists
//  5. Navigation updated with Market Analysis link
//  6. Build workflow present
//  7. PMA JS module exports PMAEngine
//  8. CSS page file exists
//  9. Documentation files exist
// 10. Python builder exists
//
// Usage:
//   node test/smoke-market-analysis.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

let passed   = 0;
let failed   = 0;
let warnings = 0;

function pass(msg) { console.log('  ✅ PASS: ' + msg); passed++; }
function fail(msg) { console.error('  ❌ FAIL: ' + msg); failed++; }
function warn(msg) { console.warn('  ⚠️  WARN: ' + msg); warnings++; }

function fileExists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function readFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function parseJSON(rel) {
  const content = readFile(rel);
  return JSON.parse(content);
}

// ─── 1. market-analysis.html ──────────────────────────────────────────────────
console.log('\n── 1. market-analysis.html ──');

if (fileExists('market-analysis.html')) {
  pass('market-analysis.html exists');
  const html = readFile('market-analysis.html');

  const checks = [
    { pattern: /market-analysis\.js/,            label: 'References js/market-analysis.js' },
    { pattern: /id=["']pmaMap["']/,               label: '#pmaMap container present' },
    { pattern: /id=["']pmaBufferSelect["']/,       label: '#pmaBufferSelect present' },
    { pattern: /id=["']pmaScoreCircle["']/,        label: '#pmaScoreCircle present' },
    { pattern: /id=["']pmaRadarChart["']/,         label: '#pmaRadarChart (radar chart canvas) present' },
    { pattern: /id=["']pmaLihtcCount["']/,         label: '#pmaLihtcCount present' },
    { pattern: /id=["']pmaLihtcUnits["']/,         label: '#pmaLihtcUnits present' },
    { pattern: /id=["']pmaCaptureRate["']/,         label: '#pmaCaptureRate present' },
    { pattern: /id=["']pmaProposedUnits["']/,       label: '#pmaProposedUnits (simulator) present' },
    { pattern: /id=["']pmaExportJson["']/,          label: '#pmaExportJson button present' },
    { pattern: /id=["']pmaExportCsv["']/,           label: '#pmaExportCsv button present' },
    { pattern: /id=["']pmaAmi60["']/,               label: '#pmaAmi60 AMI mix input present' },
    { pattern: /<h1/i,                              label: 'Has <h1> heading' },
    { pattern: /market-analysis\.css/,             label: 'References market-analysis.css' },
    { pattern: /leaflet\.js/,                       label: 'Loads Leaflet' },
    { pattern: /chart\.umd\.min\.js/,              label: 'Loads Chart.js' },
  ];

  checks.forEach(function (c) {
    if (c.pattern.test(html)) pass(c.label);
    else fail(c.label + ' — missing from market-analysis.html');
  });
} else {
  fail('market-analysis.html not found');
}

// ─── 2. js/market-analysis.js ────────────────────────────────────────────────
console.log('\n── 2. js/market-analysis.js ──');

if (fileExists('js/market-analysis.js')) {
  pass('js/market-analysis.js exists');
  const src = readFile('js/market-analysis.js');
  const srcChecks = [
    { pattern: /haversine/,               label: 'Haversine distance function present' },
    { pattern: /computePma/,              label: 'computePma scoring function present' },
    { pattern: /simulateCapture/,         label: 'simulateCapture function present' },
    { pattern: /WEIGHTS/,                 label: 'WEIGHTS constant defined' },
    { pattern: /RISK/,                    label: 'RISK thresholds defined' },
    { pattern: /demand.*0\.30|0\.30.*demand/s, label: 'Demand weight 30% present' },
    { pattern: /exportJson|exportCsv/,    label: 'Export functions present' },
    { pattern: /PMAEngine/,               label: 'PMAEngine public API exposed on window' },
    { pattern: /DataService\.getJSON|DataService\.baseData/, label: 'Uses DataService (no raw fetch)' },
  ];
  srcChecks.forEach(function (c) {
    if (c.pattern.test(src)) pass(c.label);
    else fail(c.label + ' — not found in js/market-analysis.js');
  });
} else {
  fail('js/market-analysis.js not found');
}

// ─── 3. Data artifacts ───────────────────────────────────────────────────────
console.log('\n── 3. Data artifacts ──');

const DATA_ARTIFACTS = [
  { path: 'data/market/tract_centroids_co.json',  key: 'tracts',   label: 'tract_centroids_co.json' },
  { path: 'data/market/acs_tract_metrics_co.json', key: 'tracts',  label: 'acs_tract_metrics_co.json' },
  { path: 'data/market/hud_lihtc_co.geojson',     key: 'features', label: 'hud_lihtc_co.geojson' },
];

DATA_ARTIFACTS.forEach(function (a) {
  if (!fileExists(a.path)) {
    fail(a.label + ' not found at ' + a.path);
    return;
  }
  try {
    const obj = parseJSON(a.path);
    if (!Array.isArray(obj[a.key])) {
      fail(a.label + ': "' + a.key + '" is not an array');
    } else if (obj[a.key].length === 0) {
      warn(a.label + ': "' + a.key + '" array is empty');
    } else {
      pass(a.label + ' exists, valid JSON, has ' + obj[a.key].length + ' ' + a.key);
    }
  } catch (e) {
    fail(a.label + ': invalid JSON — ' + e.message);
  }
});

// ─── 4. Prop 123 fallback file ────────────────────────────────────────────────
console.log('\n── 4. Prop 123 fallback file ──');

if (fileExists('data/prop123_jurisdictions.json')) {
  try {
    const obj = parseJSON('data/prop123_jurisdictions.json');
    const list = obj.jurisdictions || obj;
    if (Array.isArray(list) && list.length > 0) {
      pass('data/prop123_jurisdictions.json exists, valid JSON, ' + list.length + ' records');
    } else {
      warn('data/prop123_jurisdictions.json exists but has no jurisdictions');
    }
  } catch (e) {
    fail('data/prop123_jurisdictions.json invalid JSON: ' + e.message);
  }
} else {
  warn('data/prop123_jurisdictions.json not found (may be fetched by CI)');
}

// ─── 5. Navigation updated ────────────────────────────────────────────────────
console.log('\n── 5. Navigation updated ──');

if (fileExists('js/navigation.js')) {
  const nav = readFile('js/navigation.js');
  if (/Market Analysis/.test(nav) && /market-analysis\.html/.test(nav)) {
    pass('js/navigation.js includes "Market Analysis" link to market-analysis.html');
  } else {
    fail('js/navigation.js missing "Market Analysis" entry');
  }
} else {
  fail('js/navigation.js not found');
}

// ─── 6. Build workflow present ───────────────────────────────────────────────
console.log('\n── 6. Build workflow present ──');

if (fileExists('.github/workflows/build-market-data.yml')) {
  const yml = readFile('.github/workflows/build-market-data.yml');
  const ymlChecks = [
    { pattern: /workflow_dispatch/,                     label: 'Has workflow_dispatch trigger' },
    { pattern: /schedule/,                              label: 'Has schedule trigger' },
    { pattern: /build_public_market_data\.py/,          label: 'Runs build_public_market_data.py' },
    { pattern: /git commit/,                            label: 'Commits artifacts back to repo' },
  ];
  pass('.github/workflows/build-market-data.yml exists');
  ymlChecks.forEach(function (c) {
    if (c.pattern.test(yml)) pass(c.label);
    else fail(c.label + ' — not found in build-market-data.yml');
  });
} else {
  fail('.github/workflows/build-market-data.yml not found');
}

// ─── 7. CSS file exists ───────────────────────────────────────────────────────
console.log('\n── 7. CSS file ──');

if (fileExists('css/pages/market-analysis.css')) {
  pass('css/pages/market-analysis.css exists');
} else {
  fail('css/pages/market-analysis.css not found');
}

// ─── 8. Documentation ─────────────────────────────────────────────────────────
console.log('\n── 8. Documentation ──');

['docs/MARKET_ANALYSIS_METHOD.md', 'docs/PMA_SCORING.md'].forEach(function (f) {
  if (fileExists(f)) {
    pass(f + ' exists');
  } else {
    fail(f + ' not found');
  }
});

// ─── 9. Python builder ───────────────────────────────────────────────────────
console.log('\n── 9. Python builder ──');

if (fileExists('scripts/market/build_public_market_data.py')) {
  const py = readFile('scripts/market/build_public_market_data.py');
  const pyChecks = [
    { pattern: /tract_centroids/,  label: 'Builds tract centroids' },
    { pattern: /acs_tract_metrics/, label: 'Builds ACS metrics' },
    { pattern: /hud_lihtc/,        label: 'Builds HUD LIHTC data' },
    { pattern: /CENSUS_API_KEY/,   label: 'Supports optional CENSUS_API_KEY' },
  ];
  pass('scripts/market/build_public_market_data.py exists');
  pyChecks.forEach(function (c) {
    if (c.pattern.test(py)) pass(c.label);
    else fail(c.label + ' — not found in build_public_market_data.py');
  });
} else {
  fail('scripts/market/build_public_market_data.py not found');
}

// ─── 10. Prop 123 & boundary fixes ───────────────────────────────────────────
console.log('\n── 10. Prop 123 & boundary fixes ──');

if (fileExists('js/colorado-deep-dive.js')) {
  const src = readFile('js/colorado-deep-dive.js');
  if (/prop123Initialized/.test(src)) {
    pass('prop123Initialized flag present in colorado-deep-dive.js');
  } else {
    fail('prop123Initialized flag missing from colorado-deep-dive.js');
  }
}

if (fileExists('js/prop123-map.js')) {
  const src = readFile('js/prop123-map.js');
  if (/getComputedStyle/.test(src)) {
    pass('prop123-map.js reads CSS tokens via getComputedStyle');
  } else {
    fail('prop123-map.js does not use getComputedStyle for theme tokens');
  }
  if (/MutationObserver/.test(src)) {
    pass('prop123-map.js uses MutationObserver for theme change detection');
  } else {
    fail('prop123-map.js missing MutationObserver for theme changes');
  }
}

if (fileExists('css/site-theme.css')) {
  const src = readFile('css/site-theme.css');
  if (/--map-boundary-stroke-light/.test(src) && /--map-boundary-stroke-dark/.test(src)) {
    pass('css/site-theme.css has --map-boundary-stroke-light and -dark tokens');
  } else {
    fail('css/site-theme.css missing --map-boundary-stroke-light/-dark tokens');
  }
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n── Summary ──');
console.log('Passed:   ' + passed);
console.log('Warnings: ' + warnings);
console.log('Failed:   ' + failed);

if (failed > 0) {
  console.error('\n✗ Smoke tests completed with ' + failed + ' failure(s).');
  process.exit(1);
} else {
  console.log('\n✓ All smoke tests passed' + (warnings > 0 ? ' (' + warnings + ' warning(s) to review).' : '.'));
  process.exit(0);
}
