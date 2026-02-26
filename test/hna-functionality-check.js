// test/hna-functionality-check.js
//
// Static-analysis functionality check for housing-needs-assessment.html and
// js/housing-needs-assessment.js.  Runs in Node.js without a browser.
//
// Usage:
//   node test/hna-functionality-check.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT   = path.resolve(__dirname, '..');
const HTML   = path.join(ROOT, 'housing-needs-assessment.html');
const JS     = path.join(ROOT, 'js', 'housing-needs-assessment.js');

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
// Load source files
// ---------------------------------------------------------------------------
let html = '';
let js   = '';

test('Source files exist and are readable', () => {
    assert(fs.existsSync(HTML), 'housing-needs-assessment.html exists');
    assert(fs.existsSync(JS),   'js/housing-needs-assessment.js exists');
    html = fs.readFileSync(HTML, 'utf8');
    js   = fs.readFileSync(JS,   'utf8');
    assert(html.length > 100, 'HTML file is non-empty');
    assert(js.length   > 100, 'JS file is non-empty');
});

// ---------------------------------------------------------------------------
// HTML: required element IDs
// ---------------------------------------------------------------------------
const REQUIRED_IDS = [
    // Controls
    'geoType', 'geoSelect', 'btnRefresh', 'btnPdf',
    // Banner
    'hnaBanner',
    // Executive snapshot
    'geoContextPill', 'execNarrative',
    'statPop', 'statPopSrc',
    'statMhi', 'statMhiSrc',
    'statHomeValue', 'statHomeValueSrc',
    'statRent', 'statRentSrc',
    'statTenure', 'statRentBurden', 'statIncomeNeed', 'statIncomeNeedNote', 'statCommute',
    // Map
    'hnaMap',
    // Charts
    'chartStock', 'chartTenure',
    'chartAfford', 'affordAssumptions',
    'chartRentBurdenBins',
    'chartMode',
    'chartLehd', 'lehdNote',
    'chartPyramid', 'chartSenior', 'seniorNote',
    'chartPopProj',
    // Projection stats
    'statBaseUnits', 'statBaseUnitsSrc', 'statTargetVac', 'statUnitsNeed', 'statNetMig',
    // Projection assumptions controls
    'assumpHorizon', 'assumpVacancy', 'assumpVacancyVal',
    // Methodology
    'methodology',
    // Local resources
    'localResources',
];

test('HTML: all required UI element IDs are present', () => {
    for (const id of REQUIRED_IDS) {
        assert(html.includes(`id="${id}"`), `id="${id}" found in HTML`);
    }
});

test('HTML: banner element has correct CSS class', () => {
    assert(html.includes('class="banner"'), 'banner div has class="banner"');
});

test('HTML: Leaflet and Chart.js are loaded from vendored local files', () => {
    assert(html.includes('js/vendor/leaflet.css'), 'vendored leaflet.css is referenced');
    assert(html.includes('js/vendor/leaflet.js'),  'vendored leaflet.js is referenced');
    assert(html.includes('js/vendor/chart.umd.min.js'), 'vendored chart.umd.min.js is referenced');
    // Should NOT use unpkg or jsdelivr CDN for these core dependencies
    assert(!html.includes('unpkg.com/leaflet'), 'Leaflet is NOT loaded from unpkg CDN');
    assert(!html.includes('cdn.jsdelivr.net/npm/chart.js'), 'Chart.js is NOT loaded from jsdelivr CDN');
});

test('HTML: site scripts are loaded', () => {
    assert(html.includes('js/config.js'),                    'js/config.js is loaded');
    assert(html.includes('js/housing-needs-assessment.js'), 'js/housing-needs-assessment.js is loaded');
});

// ---------------------------------------------------------------------------
// JS: diagnostic banner on ACS failure
// ---------------------------------------------------------------------------
test('JS: diagnostic banner shown when ACS profile fetch fails', () => {
    assert(js.includes('banner') && js.includes('.classList.add(\'show\')'), 'banner.classList.add(\'show\') is present');
    assert(js.includes('No ACS Census data'), 'ACS failure message text is present');
    assert(js.includes('acsDebugLog'), 'acsDebugLog link is included in ACS failure handling');
});

test('JS: setBanner helper function is defined', () => {
    assert(js.includes('function setBanner'), 'setBanner function is defined');
});

// ---------------------------------------------------------------------------
// JS: fallback to live Census API when cache is absent
// ---------------------------------------------------------------------------
test('JS: loads cached summary first (primary path)', () => {
    assert(js.includes('PATHS.summary(geoid)'), 'PATHS.summary(geoid) is used to load cached summary');
    assert(js.includes('sum.acsProfile'), 'acsProfile is extracted from cache');
});

test('JS: falls back to live Census API when cache is absent', () => {
    assert(js.includes('fetchAcsProfile(geoType, geoid)'), 'fetchAcsProfile live fallback is called');
    assert(js.includes('fetchAcsS0801(geoType, geoid)'),   'fetchAcsS0801 live fallback is called');
});

test('JS: live ACS profile fetch is implemented (fetchAcsProfile)', () => {
    assert(js.includes('async function fetchAcsProfile'), 'fetchAcsProfile is async function');
    assert(js.includes('acs/acs1/profile'), 'ACS1 profile endpoint is targeted');
    assert(js.includes('acs/acs5/profile'), 'ACS5 profile fallback endpoint is present');
    assert(js.includes('ACS_YEAR_PRIMARY'),  'ACS_YEAR_PRIMARY constant is used');
    assert(js.includes('ACS_YEAR_FALLBACK'), 'ACS_YEAR_FALLBACK constant is used');
});

test('JS: live ACS S0801 fetch implements year fallback (fetchAcsS0801)', () => {
    assert(js.includes('async function fetchAcsS0801'), 'fetchAcsS0801 is async function');
    assert(js.includes('acs/acs1/subject'), 'ACS1 subject endpoint is targeted');
    assert(js.includes('acs/acs5/subject'), 'ACS5 subject fallback endpoint is present');
});

// ---------------------------------------------------------------------------
// JS: robust handling of missing / corrupt data
// ---------------------------------------------------------------------------
test('JS: loadJson throws on non-OK HTTP responses', () => {
    assert(js.includes('async function loadJson'), 'loadJson is an async function');
    assert(js.includes('if (!r.ok) throw new Error'), 'loadJson throws on non-OK HTTP status');
});

test('JS: LEHD cache failure is handled gracefully', () => {
    assert(js.includes('PATHS.lehd('), 'PATHS.lehd path is used');
    assert(js.includes('lehdNote.textContent'), 'lehdNote is updated when LEHD is unavailable');
    assert(js.includes('LEHD flow cache not yet available'), 'user-facing LEHD unavailable message exists');
});

test('JS: DOLA SYA cache failure is handled gracefully', () => {
    assert(js.includes('PATHS.dolaSya('), 'PATHS.dolaSya path is used');
    assert(js.includes('seniorNote.textContent'), 'seniorNote is updated when DOLA data is unavailable');
    assert(js.includes('DOLA/SDO age data not yet available'), 'user-facing DOLA unavailable message exists');
});

test('JS: projections failure is handled gracefully', () => {
    assert(js.includes('renderProjections'), 'renderProjections function is called');
    assert(js.includes('Projections module not available'), 'user-facing projections unavailable message exists');
});

// ---------------------------------------------------------------------------
// JS: schema drift tolerance (safeNum / defensive number parsing)
// ---------------------------------------------------------------------------
test('JS: safeNum helper guards against non-numeric values', () => {
    assert(js.includes('function safeNum'), 'safeNum is defined');
    assert(js.includes('Number.isFinite(n) ? n : null'), 'safeNum returns null for non-finite input');
});

test('JS: fmtNum/fmtMoney/fmtPct guards against null/undefined/NaN', () => {
    assert(js.includes('function fmtNum'),   'fmtNum is defined');
    assert(js.includes('function fmtMoney'), 'fmtMoney is defined');
    assert(js.includes('function fmtPct'),   'fmtPct is defined');
    // Each formatter should return '—' for bad input
    assert((js.match(/return '—'/g) || []).length >= 3, 'formatters return \'—\' for invalid input');
});

// ---------------------------------------------------------------------------
// JS: map rendering
// ---------------------------------------------------------------------------
test('JS: Leaflet map is initialized with tile error fallback', () => {
    assert(js.includes('L.map('), 'L.map() is called to create the map');
    assert(js.includes('L.tileLayer'), 'tile layer is added to the map');
    assert(js.includes('function ensureMap'), 'ensureMap guard function is present');
    assert(js.includes('tileerror'), 'tile error fallback handler is present');
    assert(js.includes('tileLayer(') && (js.includes('basemaps') || js.includes('tile.openstreetmap')), 'tile provider URL is configured');
    assert(js.includes('map.invalidateSize'), 'map.invalidateSize is called to handle layout issues');
});

test('JS: boundary fetch and rendering is implemented', () => {
    assert(js.includes('fetchBoundary'), 'fetchBoundary function is referenced');
    assert(js.includes('renderBoundary'), 'renderBoundary function is referenced');
    assert(js.includes('L.geoJSON'),      'GeoJSON layer is created for boundary');
});

test('JS: boundary fetch failure shows banner but does not halt page', () => {
    // The update() function should catch boundary errors and set a banner message
    assert(
        js.includes('Boundary failed to load'),
        'Boundary failure banner message is present'
    );
});

// ---------------------------------------------------------------------------
// JS: charts
// ---------------------------------------------------------------------------
test('JS: Chart.js charts are created via makeChart helper', () => {
    assert(js.includes('function makeChart'), 'makeChart helper function is defined');
    assert(js.includes('new Chart(ctx, config)'), 'Chart is instantiated via new Chart()');
    assert(js.includes('charts[id].destroy()'),   'existing chart is destroyed before re-creating');
});

test('JS: all six chart canvases are rendered', () => {
    assert(js.includes('chartStock'),          'chartStock is rendered');
    assert(js.includes('chartTenure'),         'chartTenure is rendered');
    assert(js.includes('chartAfford'),         'chartAfford is rendered');
    assert(js.includes('chartRentBurdenBins'), 'chartRentBurdenBins is rendered');
    assert(js.includes('chartMode'),           'chartMode is rendered');
    assert(js.includes('chartLehd'),           'chartLehd is rendered');
    assert(js.includes('chartPyramid'),        'chartPyramid is rendered');
    assert(js.includes('chartSenior'),         'chartSenior is rendered');
    assert(js.includes('chartPopProj'),        'chartPopProj is rendered');
});

// ---------------------------------------------------------------------------
// JS: methodology section
// ---------------------------------------------------------------------------
test('JS: methodology section is populated dynamically', () => {
    assert(js.includes('function renderMethodology'), 'renderMethodology function is defined');
    assert(js.includes('els.methodology.innerHTML'), 'methodology innerHTML is set by the function');
});

test('JS: methodology references all data sources', () => {
    assert(js.includes('TIGERweb'),            'TIGERweb source is referenced');
    assert(js.includes('ACS'),                 'ACS source is referenced');
    assert(js.includes('LEHD'),                'LEHD source is referenced');
    assert(js.includes('DOLA') || js.includes('SDO'), 'DOLA/SDO source is referenced');
});

test('JS: cache status is reflected in the methodology section', () => {
    assert(js.includes('cacheFlags'), 'cacheFlags object is used in methodology');
    assert(js.includes('cacheBits'),  'cacheBits array is used to report loaded modules');
    assert(js.includes('No cached modules detected'), 'fallback message for no cached modules is present');
});

// ---------------------------------------------------------------------------
// JS: UI controls and event listeners
// ---------------------------------------------------------------------------
test('JS: geoType and geoSelect change events trigger update()', () => {
    assert(js.includes("addEventListener('change', ()=>"), 'geoType change listener calls buildSelect + update');
    assert(js.includes("addEventListener('change', update)"), 'geoSelect change listener calls update');
});

test('JS: Refresh button triggers update()', () => {
    assert(js.includes("addEventListener('click', update)"), 'Refresh button click triggers update()');
});

test('JS: projection assumption controls trigger applyAssumptions()', () => {
    assert(js.includes('onAssumpChange'), 'onAssumpChange handler is defined');
    assert(js.includes('assumpHorizon'), 'assumpHorizon control is wired');
    assert(js.includes('assumpVacancy'), 'assumpVacancy control is wired');
    assert(js.includes('assumpHeadship'), 'assumpHeadship radio buttons are wired');
});

// ---------------------------------------------------------------------------
// JS: PDF export
// ---------------------------------------------------------------------------
test('JS: PDF export button is wired and has fallback to print()', () => {
    assert(js.includes('async function exportPdf'), 'exportPdf is an async function');
    assert(js.includes('window.print()'), 'falls back to window.print() when PDF libs are absent');
});

// ---------------------------------------------------------------------------
// Deploy workflow: key configuration checks
// ---------------------------------------------------------------------------
test('Deploy workflow: workflow_dispatch is enabled', () => {
    const deployYml = path.join(ROOT, '.github', 'workflows', 'deploy.yml');
    assert(fs.existsSync(deployYml), 'deploy.yml exists');
    const workflow = fs.readFileSync(deployYml, 'utf8');
    assert(workflow.includes('workflow_dispatch'), 'workflow_dispatch trigger is present in deploy.yml');
});

test('Deploy workflow: js/config.js is generated from secrets at deploy time', () => {
    const deployYml = path.join(ROOT, '.github', 'workflows', 'deploy.yml');
    const workflow  = fs.readFileSync(deployYml, 'utf8');
    assert(workflow.includes('CENSUS_API_KEY'), 'CENSUS_API_KEY secret is injected into config.js');
    assert(workflow.includes('js/config.js'),   'deploy workflow writes js/config.js');
});

test('Deploy workflow: data/hna directory is included in the Pages artifact', () => {
    const deployYml = path.join(ROOT, '.github', 'workflows', 'deploy.yml');
    const workflow  = fs.readFileSync(deployYml, 'utf8');
    // The workflow uploads the entire repo root ('.') as the Pages artifact
    assert(workflow.includes("path: '.'"), "Pages artifact path includes repo root ('.')");
});

// ---------------------------------------------------------------------------
// HNA data directory: key cache files / structure checks
// ---------------------------------------------------------------------------
test('data/hna: directory structure is present', () => {
    const hnaDir = path.join(ROOT, 'data', 'hna');
    assert(fs.existsSync(hnaDir),                              'data/hna directory exists');
    assert(fs.existsSync(path.join(hnaDir, 'geo-config.json')), 'data/hna/geo-config.json exists');
    assert(fs.existsSync(path.join(hnaDir, 'summary')),        'data/hna/summary/ directory exists');
    assert(fs.existsSync(path.join(hnaDir, 'lehd')),           'data/hna/lehd/ directory exists');
    assert(fs.existsSync(path.join(hnaDir, 'dola_sya')),       'data/hna/dola_sya/ directory exists');
    assert(fs.existsSync(path.join(hnaDir, 'projections')),    'data/hna/projections/ directory exists');
    assert(fs.existsSync(path.join(hnaDir, 'derived')),        'data/hna/derived/ directory exists');
});

test('data/hna/geo-config.json: valid JSON with required fields', () => {
    const configPath = path.join(ROOT, 'data', 'hna', 'geo-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert(Array.isArray(config.featured),  'geo-config.json has a "featured" array');
    assert(config.featured.length > 0,      'geo-config.json "featured" array is not empty');
    const first = config.featured[0];
    assert(typeof first.type   === 'string', 'featured entry has a "type" field');
    assert(typeof first.geoid  === 'string', 'featured entry has a "geoid" field');
    assert(typeof first.label  === 'string', 'featured entry has a "label" field');
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
