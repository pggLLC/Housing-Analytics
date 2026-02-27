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
// JS: LIHTC / QCT / DDA map overlays
// ---------------------------------------------------------------------------
test('JS: LIHTC layer variables and fallback data are defined', () => {
    assert(js.includes('let lihtcLayer'),          'lihtcLayer variable is declared');
    assert(js.includes('let qctLayer'),            'qctLayer variable is declared');
    assert(js.includes('let ddaLayer'),            'ddaLayer variable is declared');
    assert(js.includes('LIHTC_FALLBACK_CO'),       'LIHTC_FALLBACK_CO fallback dataset is defined');
    assert(js.includes('CO_DDA'),                  'CO_DDA static DDA lookup is defined');
});

test('JS: LIHTC fetch function is implemented with fallback', () => {
    assert(js.includes('async function fetchLihtcProjects'), 'fetchLihtcProjects is an async function');
    assert(js.includes('lihtcFallbackForCounty'),            'lihtcFallbackForCounty fallback is called');
    assert(js.includes('hudLihtcQuery'),                     'HUD LIHTC ArcGIS service URL is referenced');
});

test('JS: QCT fetch function is implemented', () => {
    assert(js.includes('async function fetchQctTracts'), 'fetchQctTracts is an async function');
    assert(js.includes('hudQctQuery'),                   'HUD QCT ArcGIS service URL is referenced');
});

test('JS: DDA fetch function is implemented with static fallback', () => {
    assert(js.includes('async function fetchDdaForCounty'), 'fetchDdaForCounty is an async function');
    assert(js.includes('hudDdaQuery'),                      'HUD DDA ArcGIS service URL is referenced');
    assert(js.includes('CO_DDA[countyFips5]'),              'CO_DDA static lookup is used as fallback');
});

test('JS: LIHTC layer is rendered with Leaflet markers', () => {
    assert(js.includes('function renderLihtcLayer'), 'renderLihtcLayer function is defined');
    assert(js.includes('L.divIcon'),                 'LIHTC markers use L.divIcon');
    assert(js.includes('bindPopup'),                 'LIHTC markers have popups');
    assert(js.includes('statLihtcCount'),            'LIHTC project count stat is updated');
    assert(js.includes('statLihtcUnits'),            'LIHTC unit count stat is updated');
});

test('JS: QCT layer is rendered as a GeoJSON overlay', () => {
    assert(js.includes('function renderQctLayer'), 'renderQctLayer function is defined');
    assert(js.includes('statQctCount'),            'QCT tract count stat is updated');
});

test('JS: DDA layer is rendered with county status badge', () => {
    assert(js.includes('function renderDdaLayer'), 'renderDdaLayer function is defined');
    assert(js.includes('statDdaStatus'),           'DDA status stat is updated');
    assert(js.includes('statDdaNote'),             'DDA note/area is updated');
});

test('JS: layer toggle handlers are wired', () => {
    assert(js.includes('function wireLayerToggles'), 'wireLayerToggles function is defined');
    assert(js.includes('layerLihtc'),                'LIHTC layer toggle is handled');
    assert(js.includes('layerQct'),                  'QCT layer toggle is handled');
    assert(js.includes('layerDda'),                  'DDA layer toggle is handled');
});

test('JS: LIHTC/QCT/DDA overlays are loaded during update()', () => {
    assert(js.includes('updateLihtcOverlays'),       'updateLihtcOverlays is called from update()');
    assert(js.includes('wireLayerToggles'),          'wireLayerToggles is called from init()');
});

test('JS: LIHTC/QCT/DDA methodology entries are added', () => {
    assert(js.includes('Low-Income Housing Tax Credit'), 'LIHTC methodology entry is present');
    assert(js.includes('Qualified Census Tracts'),       'QCT methodology entry is present');
    assert(js.includes('Difficult Development Areas'),   'DDA methodology entry is present');
    assert(js.includes('SOURCES.lihtcDb'),               'LIHTC source link is referenced');
    assert(js.includes('SOURCES.hudQct'),                'QCT source link is referenced');
    assert(js.includes('SOURCES.hudDda'),                'DDA source link is referenced');
});

// ---------------------------------------------------------------------------
// HTML: LIHTC / QCT / DDA elements
// ---------------------------------------------------------------------------
test('HTML: LIHTC/QCT/DDA stat elements are present', () => {
    assert(html.includes('id="statLihtcCount"'),  'id="statLihtcCount" is in HTML');
    assert(html.includes('id="statLihtcUnits"'),  'id="statLihtcUnits" is in HTML');
    assert(html.includes('id="statQctCount"'),    'id="statQctCount" is in HTML');
    assert(html.includes('id="statDdaStatus"'),   'id="statDdaStatus" is in HTML');
    assert(html.includes('id="statDdaNote"'),     'id="statDdaNote" is in HTML');
    assert(html.includes('id="lihtcInfoPanel"'),  'id="lihtcInfoPanel" is in HTML');
    assert(html.includes('id="lihtcMapStatus"'),  'id="lihtcMapStatus" is in HTML');
});

test('HTML: map layer toggle checkboxes are present', () => {
    assert(html.includes('id="layerLihtc"'), 'LIHTC layer toggle checkbox is in HTML');
    assert(html.includes('id="layerQct"'),   'QCT layer toggle checkbox is in HTML');
    assert(html.includes('id="layerDda"'),   'DDA layer toggle checkbox is in HTML');
});

test('HTML: LIHTC/QCT/DDA info card is present', () => {
    assert(html.includes('LIHTC, QCT'), 'LIHTC/QCT/DDA card heading is in HTML');
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
// JS: dynamic ACS year detection and source links
// ---------------------------------------------------------------------------
test('JS: ACS_VINTAGES array is defined and starts with a year >= 2024', () => {
    assert(js.includes('ACS_VINTAGES'), 'ACS_VINTAGES array is defined');
    const m = js.match(/const ACS_VINTAGES\s*=\s*\[\s*(\d+)/);
    assert(m && parseInt(m[1], 10) >= 2024, 'ACS_VINTAGES first element is >= 2024');
});

test('JS: ACS_YEAR_PRIMARY and ACS_YEAR_FALLBACK constants are retained', () => {
    assert(js.includes('ACS_YEAR_PRIMARY'), 'ACS_YEAR_PRIMARY is present');
    assert(js.includes('ACS_YEAR_FALLBACK'), 'ACS_YEAR_FALLBACK is present');
});

test('JS: fetchAcsProfile probes vintages newest-first for both acs1 and acs5', () => {
    assert(js.includes('for (const v of ACS_VINTAGES)'), 'ACS_VINTAGES loop is present in fetch logic');
    assert(js.includes("'acs/acs1/profile'"), 'ACS1 profile endpoint is targeted');
    assert(js.includes("'acs/acs5/profile'"), 'ACS5 profile fallback endpoint is present');
});

test('JS: fetchAcsProfile attaches _acsYear and _acsSeries to returned data', () => {
    assert(js.includes('out._acsYear = usedYear'), 'fetchAcsProfile sets _acsYear on returned object');
    assert(js.includes('out._acsSeries = usedSeries'), 'fetchAcsProfile sets _acsSeries on returned object');
});

test('JS: fetchAcs5BSeries probes vintages newest-first and attaches metadata', () => {
    assert(js.includes('_acsYear: bYear'), 'fetchAcs5BSeries attaches _acsYear to returned object');
    assert(js.includes("_acsSeries: 'acs5'"), 'fetchAcs5BSeries attaches _acsSeries to returned object');
});

test('JS: fetchAcsS0801 probes vintages newest-first and attaches metadata', () => {
    assert(js.includes("'acs/acs1/subject'"), 'ACS1 subject endpoint is targeted');
    assert(js.includes("'acs/acs5/subject'"), 'ACS5 subject fallback endpoint is present');
    assert(js.includes('out._acsYear = usedYear'), '_acsYear is attached to S0801 result');
});

test('JS: update() attaches _geoType and _geoid to profile for source links', () => {
    assert(js.includes('profile._geoType = geoType'), '_geoType is attached to profile in update()');
    assert(js.includes('profile._geoid = geoid'), '_geoid is attached to profile in update()');
});

test('JS: update() extracts ACS year from cached summary source endpoint', () => {
    assert(js.includes('acs_profile_endpoint'), 'acs_profile_endpoint is referenced in update()');
    assert(js.includes('profile._acsYear'), 'profile._acsYear is set from cached source endpoint');
    assert(js.includes('profile._acsSeries'), 'profile._acsSeries is set from cached source endpoint');
});

test('JS: censusSourceUrl helper generates data.census.gov URLs', () => {
    assert(js.includes('function censusSourceUrl'), 'censusSourceUrl helper is defined');
    assert(js.includes('data.census.gov/table/'), 'censusSourceUrl builds data.census.gov table URLs');
    assert(js.includes('0500000US'), 'county geography code is used');
    assert(js.includes('1600000US'), 'place geography code is used');
    assert(js.includes('0100000US'), 'national geography code is used');
});

test('JS: srcLink helper generates source badge HTML', () => {
    assert(js.includes('function srcLink'), 'srcLink helper function is defined');
    assert(js.includes('[Source]'), 'srcLink includes [Source] text');
    // censusSourceUrl builds table links; verify the domain is present in the JS source
    assert(/censusSourceUrl/.test(js) && /data\.census\.gov\/table/.test(js),
        'srcLink uses censusSourceUrl which links to data.census.gov table URLs');
});

test('JS: renderSnapshot uses innerHTML for source elements (to render links)', () => {
    assert(js.includes('statPopSrc.innerHTML'), 'statPopSrc uses innerHTML for source link');
    assert(js.includes('statMhiSrc.innerHTML'), 'statMhiSrc uses innerHTML for source link');
    assert(js.includes('statHomeValueSrc.innerHTML'), 'statHomeValueSrc uses innerHTML for source link');
    assert(js.includes('statRentSrc.innerHTML'), 'statRentSrc uses innerHTML for source link');
});

test('JS: renderSnapshot passes ACS year and series to srcLink', () => {
    assert(js.includes("srcLink('DP05', yr, sr"), 'srcLink is called with DP05 for population');
    assert(js.includes("srcLink('DP03', yr, sr"), 'srcLink is called with DP03 for income');
    assert(js.includes("srcLink('DP04', yr, sr"), 'srcLink is called with DP04 for housing stats');
});

// ---------------------------------------------------------------------------
// census-stats.js: dynamic year detection and source links
// ---------------------------------------------------------------------------
test('census-stats.js: VINTAGES list starts at 2024 or newer', () => {
    const csjs = fs.readFileSync(path.join(ROOT, 'js', 'census-stats.js'), 'utf8');
    const m = csjs.match(/const VINTAGES\s*=\s*\[\s*(\d+)/);
    assert(m && parseInt(m[1], 10) >= 2024, 'census-stats.js VINTAGES first element is >= 2024');
});

test('census-stats.js: render includes [Source] link to data.census.gov', () => {
    const csjs = fs.readFileSync(path.join(ROOT, 'js', 'census-stats.js'), 'utf8');
    assert(csjs.includes('[Source]'), 'census-stats.js render includes [Source] text');
    // sourceUrl helper builds data.census.gov links; verify the domain pattern is present
    assert(/data\.census\.gov\/table/.test(csjs), 'census-stats.js links to data.census.gov table URLs');
});

test('census-stats.js: each SERIES entry has a table code for source links', () => {
    const csjs = fs.readFileSync(path.join(ROOT, 'js', 'census-stats.js'), 'utf8');
    assert(csjs.includes('table: "DP05"'), 'DP05 table code is in SERIES');
    assert(csjs.includes('table: "DP03"'), 'DP03 table code is in SERIES');
    assert(csjs.includes('table: "DP04"'), 'DP04 table code is in SERIES');
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
