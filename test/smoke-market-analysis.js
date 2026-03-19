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

// ─── 11. generate-market-analysis-data workflow ───────────────────────────────
console.log('\n── 11. generate-market-analysis-data workflow ──');

if (fileExists('.github/workflows/generate-market-analysis-data.yml')) {
  const yml = readFile('.github/workflows/generate-market-analysis-data.yml');
  const ymlChecks = [
    { pattern: /workflow_dispatch/,             label: 'Has workflow_dispatch trigger' },
    { pattern: /schedule/,                      label: 'Has schedule trigger' },
    { pattern: /build_public_market_data\.py/,  label: 'Runs build_public_market_data.py' },
    { pattern: /co-county-boundaries\.json/,    label: 'Generates co-county-boundaries.json' },
    { pattern: /git commit/,                    label: 'Commits artifacts back to repo' },
  ];
  pass('.github/workflows/generate-market-analysis-data.yml exists');
  ymlChecks.forEach(function (c) {
    if (c.pattern.test(yml)) pass(c.label);
    else fail(c.label + ' — not found in generate-market-analysis-data.yml');
  });
} else {
  fail('.github/workflows/generate-market-analysis-data.yml not found');
}

// ─── 12. Overlay data files ───────────────────────────────────────────────────
console.log('\n── 12. Overlay data files ──');

const OVERLAY_FILES = [
  { path: 'data/co-county-boundaries.json', key: 'features', label: 'co-county-boundaries.json', warnIfEmpty: true },
  { path: 'data/qct-colorado.json',         key: 'features', label: 'qct-colorado.json',         warnIfEmpty: false },
  { path: 'data/dda-colorado.json',         key: 'features', label: 'dda-colorado.json',         warnIfEmpty: false },
];
OVERLAY_FILES.forEach(function (a) {
  if (!fileExists(a.path)) {
    fail(a.label + ' not found at ' + a.path);
    return;
  }
  try {
    const obj = parseJSON(a.path);
    if (obj.type !== 'FeatureCollection') {
      fail(a.label + ': not a GeoJSON FeatureCollection');
    } else if (!Array.isArray(obj.features)) {
      fail(a.label + ': "features" is not an array');
    } else if (obj.features.length === 0 && a.warnIfEmpty) {
      warn(a.label + ': features array is empty (will be populated by workflow)');
    } else {
      pass(a.label + ' exists, valid GeoJSON' + (obj.features.length > 0 ? ', ' + obj.features.length + ' features' : ' (empty stub)'));
    }
  } catch (e) {
    fail(a.label + ': invalid JSON — ' + e.message);
  }
});

// ─── 13. Map overlay JS functions ────────────────────────────────────────────
console.log('\n── 13. Map overlay JS functions ──');

if (fileExists('js/market-analysis.js')) {
  const src = readFile('js/market-analysis.js');
  const overlayChecks = [
    { pattern: /initOverlayLayers/,     label: 'initOverlayLayers function present' },
    { pattern: /loadOverlays/,           label: 'loadOverlays function present' },
    { pattern: /OVERLAY_STYLES/,         label: 'OVERLAY_STYLES constants defined' },
    { pattern: /L\.control\.layers/,     label: 'Leaflet layer control used' },
    { pattern: /pma-legend/,             label: 'Map legend class defined' },
    { pattern: /qct-colorado/,           label: 'Loads QCT overlay data' },
    { pattern: /dda-colorado/,           label: 'Loads DDA overlay data' },
    { pattern: /co-county-boundaries/,   label: 'Loads county boundary data' },
  ];
  overlayChecks.forEach(function (c) {
    if (c.pattern.test(src)) pass(c.label);
    else fail(c.label + ' — not found in js/market-analysis.js');
  });
}

// ─── 14. Legend CSS ───────────────────────────────────────────────────────────
console.log('\n── 14. Legend CSS ──');

if (fileExists('css/pages/market-analysis.css')) {
  const css = readFile('css/pages/market-analysis.css');
  if (/pma-legend/.test(css)) {
    pass('css/pages/market-analysis.css has .pma-legend styles');
  } else {
    fail('css/pages/market-analysis.css missing .pma-legend styles');
  }
  if (/pma-legend-swatch/.test(css)) {
    pass('css/pages/market-analysis.css has .pma-legend-swatch styles');
  } else {
    fail('css/pages/market-analysis.css missing .pma-legend-swatch styles');
  }
}

// ─── 15. Data quality & enhancement modules ───────────────────────────────────
console.log('\n── 15. Data quality & enhancement modules ──');

if (fileExists('js/market-data-quality.js')) {
  const src = readFile('js/market-data-quality.js');
  const checks = [
    { pattern: /validateMarketData/,       label: 'validateMarketData function defined' },
    { pattern: /calculateDataQuality/,     label: 'calculateDataQuality function defined' },
    { pattern: /calculateConfidenceScore/, label: 'calculateConfidenceScore function defined' },
    { pattern: /checkDataFreshness/,       label: 'checkDataFreshness function defined' },
    { pattern: /PMADataQuality/,           label: 'PMADataQuality exposed on window' },
  ];
  checks.forEach(function (c) {
    if (c.pattern.test(src)) pass(c.label);
    else fail(c.label + ' — not found in js/market-data-quality.js');
  });
} else {
  fail('js/market-data-quality.js is missing');
}

if (fileExists('js/market-analysis-enhancements.js')) {
  const src = readFile('js/market-analysis-enhancements.js');
  const checks = [
    { pattern: /benchmarkVsReference/,       label: 'benchmarkVsReference function defined' },
    { pattern: /analyzeCompetitivePipeline/, label: 'analyzeCompetitivePipeline function defined' },
    { pattern: /generateScenarios/,          label: 'generateScenarios function defined' },
    { pattern: /exportWithMetadata/,         label: 'exportWithMetadata function defined' },
    { pattern: /PMAEnhancements/,            label: 'PMAEnhancements exposed on window' },
  ];
  checks.forEach(function (c) {
    if (c.pattern.test(src)) pass(c.label);
    else fail(c.label + ' — not found in js/market-analysis-enhancements.js');
  });
} else {
  fail('js/market-analysis-enhancements.js is missing');
}

// ─── 16. Reference projects data file ─────────────────────────────────────────
console.log('\n── 16. Reference projects data file ──');

const refPath = 'data/market/reference-projects.json';
if (fileExists(refPath)) {
  try {
    const obj = JSON.parse(readFile(refPath));
    const count = (obj.projects || []).length;
    if (count >= 50) {
      pass('data/market/reference-projects.json has ' + count + ' benchmark projects');
    } else {
      fail('data/market/reference-projects.json has only ' + count + ' projects (need ≥50)');
    }
    if (obj.meta && obj.meta.generated) {
      pass('reference-projects.json has meta.generated timestamp');
    } else {
      fail('reference-projects.json missing meta.generated');
    }
  } catch (e) {
    fail('data/market/reference-projects.json: invalid JSON — ' + e.message);
  }
} else {
  fail('data/market/reference-projects.json is missing');
}

// ─── 17. Enhanced HTML elements ───────────────────────────────────────────────
console.log('\n── 17. Enhanced HTML elements ──');

if (fileExists('market-analysis.html')) {
  const html = readFile('market-analysis.html');
  const checks = [
    { pattern: /pmaDataQualityBanner/,    label: 'Data quality banner element present' },
    { pattern: /pmaQualityAcs/,           label: 'ACS coverage pill element present' },
    { pattern: /pmaConfidenceScore/,      label: 'Confidence score element present' },
    { pattern: /pmaFreshnessIndicator/,   label: 'Freshness indicator element present' },
    { pattern: /pmaBenchmarkResult/,      label: 'Benchmarking result panel present' },
    { pattern: /pmaPipelineResult/,       label: 'Pipeline result panel present' },
    { pattern: /pmaScenarioResult/,       label: 'Scenario analysis panel present' },
    { pattern: /pmaExportMeta/,           label: 'Export with metadata button present' },
    { pattern: /market-data-quality\.js/, label: 'HTML loads market-data-quality.js' },
    { pattern: /market-analysis-enhancements\.js/, label: 'HTML loads market-analysis-enhancements.js' },
  ];
  checks.forEach(function (c) {
    if (c.pattern.test(html)) pass(c.label);
    else fail(c.label + ' — not found in market-analysis.html');
  });
}

// ─── 18. Enhanced data coverage counts ────────────────────────────────────────
console.log('\n── 18. Data coverage counts ──');

const cenPath = 'data/market/tract_centroids_co.json';
const acsPath = 'data/market/acs_tract_metrics_co.json';
const lihtcPath = 'data/market/hud_lihtc_co.geojson';

if (fileExists(cenPath)) {
  try {
    const obj = JSON.parse(readFile(cenPath));
    const n = (obj.tracts || []).length;
    if (n >= 200) pass('tract_centroids_co.json has ' + n + ' tracts (≥200)');
    else warn('tract_centroids_co.json has only ' + n + ' tracts — run build workflow to populate');
  } catch (e) { fail('tract_centroids_co.json: invalid JSON'); }
}
if (fileExists(acsPath)) {
  try {
    const obj = JSON.parse(readFile(acsPath));
    const n = (obj.tracts || []).length;
    if (n >= 200) pass('acs_tract_metrics_co.json has ' + n + ' tracts (≥200)');
    else warn('acs_tract_metrics_co.json has only ' + n + ' tracts — run build workflow');
  } catch (e) { fail('acs_tract_metrics_co.json: invalid JSON'); }
}
if (fileExists(lihtcPath)) {
  try {
    const obj = JSON.parse(readFile(lihtcPath));
    const n = (obj.features || []).length;
    if (n >= 100) pass('hud_lihtc_co.geojson has ' + n + ' features (≥100)');
    else warn('hud_lihtc_co.geojson has only ' + n + ' features — run build workflow');
  } catch (e) { fail('hud_lihtc_co.geojson: invalid JSON'); }
}

// ─── 19. New modular architecture ─────────────────────────────────────────────
console.log('\n── 19. New modular architecture ──');

// Check JS module files exist
var newModules = [
  'js/market-analysis/market-analysis-state.js',
  'js/market-analysis/market-analysis-utils.js',
  'js/market-analysis/site-selection-score.js',
  'js/market-analysis/market-report-renderers.js',
  'js/market-analysis/market-analysis-controller.js',
  'js/data-connectors/market-data-cache.js',
  'js/data-connectors/hud-egis.js',
  'js/data-connectors/census-acs.js',
  'js/data-connectors/hud-lihtc.js',
  'js/data-connectors/nhpd.js',
  'js/data-connectors/osm-amenities.js',
  'js/data-connectors/fema-flood.js',
  'js/data-connectors/epa-cleanup.js',
];

newModules.forEach(function(mod) {
  if (fileExists(mod)) pass(mod + ' exists');
  else fail(mod + ' is missing');
});

// Check each module exposes correct window global
var globalChecks = [
  { file: 'js/market-analysis/market-analysis-state.js',      global: 'MAState' },
  { file: 'js/market-analysis/market-analysis-utils.js',      global: 'MAUtils' },
  { file: 'js/market-analysis/site-selection-score.js',       global: 'SiteSelectionScore' },
  { file: 'js/market-analysis/market-report-renderers.js',    global: 'MARenderers' },
  { file: 'js/market-analysis/market-analysis-controller.js', global: 'MAController' },
  { file: 'js/data-connectors/market-data-cache.js',          global: 'MarketDataCache' },
  { file: 'js/data-connectors/hud-egis.js',                   global: 'HudEgis' },
  { file: 'js/data-connectors/census-acs.js',                 global: 'CensusAcs' },
  { file: 'js/data-connectors/hud-lihtc.js',                  global: 'HudLihtc' },
  { file: 'js/data-connectors/nhpd.js',                       global: 'Nhpd' },
  { file: 'js/data-connectors/osm-amenities.js',              global: 'OsmAmenities' },
  { file: 'js/data-connectors/fema-flood.js',                 global: 'FemaFlood' },
  { file: 'js/data-connectors/epa-cleanup.js',                global: 'EpaCleanup' },
];

globalChecks.forEach(function(c) {
  if (!fileExists(c.file)) return;
  var src = readFile(c.file);
  if (src.includes('window.' + c.global)) pass(c.file + ' exposes window.' + c.global);
  else fail(c.file + ' does not expose window.' + c.global);
});

// Check new HTML sections
if (fileExists('market-analysis.html')) {
  var html = readFile('market-analysis.html');
  var sectionChecks = [
    { pattern: /id=["']maExecSummary["']/, label: '#maExecSummary section present' },
    { pattern: /id=["']maMarketDemand["']/, label: '#maMarketDemand section present' },
    { pattern: /id=["']maAffordableSupply["']/, label: '#maAffordableSupply section present' },
    { pattern: /id=["']maSubsidyOpp["']/, label: '#maSubsidyOpp section present' },
    { pattern: /id=["']maSiteFeasibility["']/, label: '#maSiteFeasibility section present' },
    { pattern: /id=["']maNeighborhoodAccess["']/, label: '#maNeighborhoodAccess section present' },
    { pattern: /id=["']maPolicyOverlays["']/, label: '#maPolicyOverlays section present' },
    { pattern: /id=["']maOpportunities["']/, label: '#maOpportunities section present' },
    { pattern: /id=["']maPmaTool["']/, label: '#maPmaTool wrapper present' },
    { pattern: /ma-section-nav/, label: '.ma-section-nav navigation present' },
    { pattern: /maLiveRegion/, label: '#maLiveRegion aria-live region present' },
    { pattern: /site-selection-score\.js/, label: 'HTML loads site-selection-score.js' },
    { pattern: /market-analysis-controller\.js/, label: 'HTML loads market-analysis-controller.js' },
  ];
  sectionChecks.forEach(function(c) {
    if (c.pattern.test(html)) pass(c.label);
    else fail(c.label + ' — not found in market-analysis.html');
  });
}

// Check build scripts exist
var buildScripts = [
  'scripts/market-analysis/build_market_demand.py',
  'scripts/market-analysis/build_subsidy_layers.py',
  'scripts/market-analysis/build_site_opportunities.py',
  'scripts/market-analysis/build_neighborhood_access.py',
];
buildScripts.forEach(function(s) {
  if (fileExists(s)) pass(s + ' exists');
  else fail(s + ' is missing');
});

// Check derived data directory and README
if (fileExists('data/derived/market-analysis/README.md')) {
  pass('data/derived/market-analysis/README.md exists');
} else {
  fail('data/derived/market-analysis/README.md is missing');
}

// ─── 20. QCT/DDA designation wiring ──────────────────────────────────────────
console.log('\n── 20. QCT/DDA designation wiring ──');

// hud-egis.js — public API and algorithm presence
if (fileExists('js/data-connectors/hud-egis.js')) {
  var hudSrc = readFile('js/data-connectors/hud-egis.js');
  var hudChecks = [
    { pattern: /checkDesignation/,     label: 'checkDesignation() function in hud-egis.js' },
    { pattern: /_pointInRing/,          label: 'Ray-casting _pointInRing() in hud-egis.js' },
    { pattern: /_isInCollection/,       label: '_isInCollection() in hud-egis.js' },
    { pattern: /basis_boost_eligible/,  label: 'basis_boost_eligible returned by checkDesignation()' },
    { pattern: /in_qct/,               label: 'in_qct returned by checkDesignation()' },
    { pattern: /in_dda/,               label: 'in_dda returned by checkDesignation()' },
    { pattern: /_loadAttempted/,        label: 'In-memory caching (_loadAttempted) in hud-egis.js' },
  ];
  hudChecks.forEach(function(c) {
    if (c.pattern.test(hudSrc)) pass(c.label);
    else fail(c.label + ' — not found in hud-egis.js');
  });
}

// market-analysis-controller.js — designation flags integration
if (fileExists('js/market-analysis/market-analysis-controller.js')) {
  var ctrlSrc = readFile('js/market-analysis/market-analysis-controller.js');
  var ctrlChecks = [
    { pattern: /_getDesignationFlags/,               label: '_getDesignationFlags() helper in controller' },
    { pattern: /HudEgis.*checkDesignation|checkDesignation.*HudEgis/, label: 'Calls HudEgis.checkDesignation()' },
    { pattern: /basisBoostEligible/,                 label: 'basisBoostEligible in scoring inputs' },
  ];
  ctrlChecks.forEach(function(c) {
    if (c.pattern.test(ctrlSrc)) pass(c.label);
    else fail(c.label + ' — not found in market-analysis-controller.js');
  });
}

// site-selection-score.js — basis_boost_eligible scoring
if (fileExists('js/market-analysis/site-selection-score.js')) {
  var scoreSrc = readFile('js/market-analysis/site-selection-score.js');
  var scoreChecks = [
    { pattern: /basis_boost_eligible/,       label: 'basis_boost_eligible parameter in scoreSubsidy()' },
    { pattern: /scoreSubsidy/,               label: 'scoreSubsidy() function present in site-selection-score.js' },
    { pattern: /basisBoostEligible/,         label: 'basisBoostEligible passed into scoreSubsidy() from computeScore()' },
  ];
  scoreChecks.forEach(function(c) {
    if (c.pattern.test(scoreSrc)) pass(c.label);
    else fail(c.label + ' — not found in site-selection-score.js');
  });
}

// deal-calculator.js — QCT/DDA checkbox and explanatory note
if (fileExists('js/deal-calculator.js')) {
  var calcSrc = readFile('js/deal-calculator.js');
  var calcChecks = [
    { pattern: /dc-qct-dda/,          label: 'QCT/DDA checkbox (id="dc-qct-dda") in deal-calculator.js' },
    { pattern: /dc-qct-dda-note/,      label: 'QCT/DDA note (id="dc-qct-dda-note") in deal-calculator.js' },
    { pattern: /130%/,                 label: '130% eligible basis boost text in deal-calculator.js' },
    { pattern: /IRC.*42|42.*IRC/,      label: 'IRC §42 reference in deal-calculator.js' },
  ];
  calcChecks.forEach(function(c) {
    if (c.pattern.test(calcSrc)) pass(c.label);
    else fail(c.label + ' — not found in deal-calculator.js');
  });
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
