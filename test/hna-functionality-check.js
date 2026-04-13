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
// After the HNA module refactor, the logic lives in js/hna/*.js.
// The js variable is built by concatenating all module files so that existing
// string-search assertions continue to find the code they expect.
const HNA_MODULES = [
    path.join(ROOT, 'js', 'hna', 'hna-utils.js'),
    path.join(ROOT, 'js', 'hna', 'hna-narratives.js'),
    path.join(ROOT, 'js', 'hna', 'hna-renderers.js'),
    path.join(ROOT, 'js', 'hna', 'hna-export.js'),
    path.join(ROOT, 'js', 'hna', 'hna-controller.js'),
];

let html = '';
let js   = '';

test('Source files exist and are readable', () => {
    assert(fs.existsSync(HTML), 'housing-needs-assessment.html exists');
    assert(fs.existsSync(JS),   'js/housing-needs-assessment.js exists');
    html = fs.readFileSync(HTML, 'utf8');
    // Build combined source from all HNA modules (refactored split of original monolith)
    const moduleParts = [];
    for (const modPath of HNA_MODULES) {
        assert(fs.existsSync(modPath), `${path.relative(ROOT, modPath)} exists`);
        moduleParts.push(fs.readFileSync(modPath, 'utf8'));
    }
    js = moduleParts.join('\n');
    assert(html.length > 100, 'HTML file is non-empty');
    assert(js.length   > 100, 'JS modules combined are non-empty');
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
    // Scenario tool elements (PR #457 / scenario-tool fixes)
    'btnResetScenarioDefaults',
    'scenarioNeedSummary',
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
// hna-export.js: dedicated export utilities module
// ---------------------------------------------------------------------------
const HNA_EXPORT_JS = path.join(ROOT, 'js', 'hna-export.js');
let exportJs = '';

test('hna-export.js: module exists and is readable', () => {
    assert(fs.existsSync(HNA_EXPORT_JS), 'js/hna-export.js exists');
    exportJs = fs.readFileSync(HNA_EXPORT_JS, 'utf8');
    assert(exportJs.length > 100, 'hna-export.js is non-empty');
});

test('hna-export.js: exports buildReportData on window', () => {
    assert(exportJs.includes('window.__HNA_buildReportData'), 'window.__HNA_buildReportData is assigned');
    assert(exportJs.includes('function buildReportData'),     'buildReportData function is defined');
});

test('hna-export.js: exports exportPdf on window', () => {
    assert(exportJs.includes('window.__HNA_exportPdf'), 'window.__HNA_exportPdf is assigned');
    assert(exportJs.includes('async function exportPdf'), 'exportPdf is async');
    assert(exportJs.includes('window.print()'),           'exportPdf falls back to window.print()');
    assert(exportJs.includes('html2canvas'),              'exportPdf uses html2canvas');
    assert(exportJs.includes('jspdf'),                    'exportPdf uses jsPDF');
});

test('hna-export.js: exports exportCsv on window', () => {
    assert(exportJs.includes('window.__HNA_exportCsv'), 'window.__HNA_exportCsv is assigned');
    assert(exportJs.includes('function exportCsv'),     'exportCsv function is defined');
    assert(exportJs.includes('text/csv'),               'exportCsv sets CSV MIME type');
    assert(exportJs.includes('createObjectURL'),        'exportCsv triggers download via createObjectURL');
});

test('hna-export.js: exports exportJson on window', () => {
    assert(exportJs.includes('window.__HNA_exportJson'), 'window.__HNA_exportJson is assigned');
    assert(exportJs.includes('function exportJson'),     'exportJson function is defined');
    assert(exportJs.includes('application/json'),        'exportJson sets JSON MIME type');
    assert(exportJs.includes('JSON.stringify'),          'exportJson serialises data with JSON.stringify');
});

test('hna-export.js: buildReportData reads expected DOM fields', () => {
    assert(exportJs.includes("'statPop'"),           "buildReportData reads statPop");
    assert(exportJs.includes("'statMhi'"),           "buildReportData reads statMhi");
    assert(exportJs.includes("'statHomeValue'"),     "buildReportData reads statHomeValue");
    assert(exportJs.includes("'statRent'"),          "buildReportData reads statRent");
    assert(exportJs.includes("'statTenure'"),        "buildReportData reads statTenure");
    assert(exportJs.includes("'statRentBurden'"),    "buildReportData reads statRentBurden");
    assert(exportJs.includes("'statCommute'"),       "buildReportData reads statCommute");
    assert(exportJs.includes("'statBaseUnits'"),     "buildReportData reads statBaseUnits");
    assert(exportJs.includes("'statUnitsNeed'"),     "buildReportData reads statUnitsNeed");
    assert(exportJs.includes("'statLihtcCount'"),    "buildReportData reads statLihtcCount");
    assert(exportJs.includes("'geoContextPill'"),    "buildReportData reads geoContextPill");
});

test('hna-export.js: CSV rows include required housing metric labels', () => {
    assert(exportJs.includes('Population'),                     'CSV row: Population');
    assert(exportJs.includes('Median Household Income'),        'CSV row: Median Household Income');
    assert(exportJs.includes('Median Home Value'),              'CSV row: Median Home Value');
    assert(exportJs.includes('Median Gross Rent'),              'CSV row: Median Gross Rent');
    assert(exportJs.includes('Rent Burden'),                    'CSV row: Rent Burden');
    assert(exportJs.includes('Baseline Housing Units'),         'CSV row: Baseline Housing Units');
    assert(exportJs.includes('Estimated Units Needed'),         'CSV row: Estimated Units Needed');
    assert(exportJs.includes('LIHTC Projects'),                 'CSV row: LIHTC Projects in County');
    assert(exportJs.includes('Exported At'),                    'CSV row: Exported At');
});

test('HTML: hna-export.js script tag is present', () => {
    assert(html.includes('js/hna-export.js'), 'housing-needs-assessment.html loads hna-export.js');
});

test('HTML: hna-export.js loads before housing-needs-assessment.js', () => {
    const exportIdx = html.indexOf('hna-export.js');
    const hnaIdx    = html.indexOf('housing-needs-assessment.js');
    assert(exportIdx !== -1 && hnaIdx !== -1 && exportIdx < hnaIdx,
        'hna-export.js script appears before housing-needs-assessment.js');
});

test('HTML: CSV and JSON download buttons are present', () => {
    assert(html.includes('id="btnCsv"'),  'btnCsv button is present in HTML');
    assert(html.includes('id="btnJson"'), 'btnJson button is present in HTML');
});

test('JS: CSV and JSON export buttons are wired in init()', () => {
    assert(js.includes('btnCsv'),                'btnCsv is referenced in housing-needs-assessment.js');
    assert(js.includes('btnJson'),               'btnJson is referenced in housing-needs-assessment.js');
    assert(js.includes('__HNA_exportCsv'),       '__HNA_exportCsv is called from housing-needs-assessment.js');
    assert(js.includes('__HNA_exportJson'),      '__HNA_exportJson is called from housing-needs-assessment.js');
});

test('JS: exportPdf delegates to window.__HNA_exportPdf', () => {
    assert(js.includes('window.__HNA_exportPdf'), 'exportPdf delegates to window.__HNA_exportPdf');
});

// ---------------------------------------------------------------------------
// JS: LIHTC / QCT / DDA map overlays
// ---------------------------------------------------------------------------
test('JS: LIHTC layer variables and fallback data are defined', () => {
    assert(js.includes('HNAState.lihtcLayer'), 'lihtcLayer referenced via HNAState');
    assert(js.includes('HNAState.qctLayer'),   'qctLayer referenced via HNAState');
    assert(js.includes('HNAState.ddaLayer'),   'ddaLayer referenced via HNAState');
    assert(js.includes('LIHTC_FALLBACK_CO'),       'LIHTC_FALLBACK_CO fallback dataset is defined');
    assert(js.includes('CO_DDA'),                  'CO_DDA static DDA lookup is defined');
});

test('JS: LIHTC fetch function is implemented with fallback', () => {
    assert(js.includes('async function fetchLihtcProjects'), 'fetchLihtcProjects is an async function');
    assert(js.includes('lihtcFallbackForCounty'),            'lihtcFallbackForCounty fallback is called');
    assert(js.includes('hudLihtcQuery'),                     'HUD LIHTC ArcGIS service URL is referenced');
});

test('JS: HUD LIHTC WHERE clause uses quoted CNTY_FIPS to avoid HTTP 400', () => {
    // ArcGIS SQL requires string fields to be quoted; an unquoted value causes a 400 error.
    assert(js.includes("CNTY_FIPS='${countyFips5}'"),     "HUD LIHTC WHERE clause quotes CNTY_FIPS value");
    assert(!js.includes("CNTY_FIPS=${countyFips5}"),       "HUD LIHTC WHERE clause does NOT have unquoted CNTY_FIPS");
});

test('JS: CHFA ArcGIS FeatureServer is the primary source for Colorado LIHTC', () => {
    assert(js.includes('chfaLihtcQuery'),            'chfaLihtcQuery is defined in SOURCES');
    assert(js.includes("stateFips === '08'"),         'Colorado state FIPS check is present');
    assert(js.includes("_source: 'CHFA'"),            '_source CHFA is tagged on successful fetch');
    assert(js.includes("_source: 'HUD'"),             '_source HUD is tagged on HUD fallback');
    assert(js.includes('CHFA LIHTC ArcGIS API unavailable'), 'CHFA fallback warning message is present');
});

test('JS: county-specific LIHTC file is tried first with features-length guard (Bug 2 fix)', () => {
    // PATHS.lihtc must be used inside fetchLihtcProjects to load the county-specific file.
    assert(js.includes('PATHS.lihtc(countyFips5)'), 'PATHS.lihtc(countyFips5) is referenced in fetchLihtcProjects');
    // The return must be guarded by a features.length check — not a bare "return await loadJson(...)".
    assert(js.includes('localCounty?.features?.length > 0'), 'county-specific file return is guarded by features.length check');
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
    assert(js.includes('lihtcDataSource') && (js.includes('Source: ${lihtcDataSource}') || js.includes('Source: ${S().lihtcDataSource}') || js.includes('Source: ${escHtml(S().lihtcDataSource)}')), 'source label is displayed in updateLihtcInfoPanel');
    assert(js.includes('sourceBadge'),               'source badge variable is used in LIHTC info panel');
});

test('JS: LIHTC info panel updates dynamically with map viewport (moveend)', () => {
    assert(js.includes('function updateLihtcInfoPanel'),  'updateLihtcInfoPanel function is defined');
    assert(js.includes('allLihtcFeatures'),               'all loaded features stored for viewport filtering');
    assert(
        js.includes("map.on('moveend', updateLihtcInfoPanel)") ||
        js.includes("map.on('moveend', window.HNARenderers.updateLihtcInfoPanel)"),
        'moveend listener registered to update panel on zoom/pan'
    );
    assert(js.includes('bounds.contains'),                'visible features filtered by map bounds');
    assert(js.includes('No LIHTC projects visible in current map area'), 'empty-viewport message is shown when no projects in view');
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
    assert(js.includes('CHFA ArcGIS FeatureServer'),     'CHFA is referenced as primary CO LIHTC source in methodology');
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

test('HTML: map layer toggle controls are present', () => {
    assert(html.includes('id="layerLihtc"'), 'LIHTC layer toggle is in HTML');
    assert(html.includes('id="layerQct"'),   'QCT layer toggle is in HTML');
    assert(html.includes('id="layerDda"'),   'DDA layer toggle is in HTML');
    assert(html.includes('layer-toggle-pill'), 'styled pill toggle controls are present');
});

test('HTML: LIHTC/QCT/DDA info card is present', () => {
    assert(html.includes('LIHTC, QCT'), 'LIHTC/QCT/DDA card heading is in HTML');
});

// ---------------------------------------------------------------------------
// JS: geography helper fixes — label lookup and countyFromGeoid
// ---------------------------------------------------------------------------
test('JS: countyFromGeoid searches all config arrays (featured, places, cdps)', () => {
    assert(js.includes('conf?.places'), 'countyFromGeoid checks cfg.places for containingCounty');
    assert(js.includes('conf?.cdps'),   'countyFromGeoid checks cfg.cdps for containingCounty');
    assert(js.includes('allEntries'),   'countyFromGeoid uses combined allEntries search');
});

test('JS: update() label lookup searches places and cdps arrays', () => {
    // The label lookup in update() should search cfg.places and cfg.cdps
    // in addition to cfg.featured for non-county geographies.
    assert(js.includes("conf?.places   || []"), 'label lookup searches cfg.places');
    assert(js.includes("conf?.cdps     || []"), 'label lookup searches cfg.cdps');
});

test('Python: build_hna_data.py fetch_places populates containingCounty', () => {
    const pyPath = path.join(ROOT, 'scripts', 'hna', 'build_hna_data.py');
    const py = fs.readFileSync(pyPath, 'utf8');
    assert(py.includes('fetch_place_county_map'), 'fetch_place_county_map function is defined');
    assert(py.includes("entry['containingCounty']"), 'containingCounty is set on each place entry');
    assert(py.includes('place_county=place_county'), 'place_county map is shared between places/cdps');
});

// ---------------------------------------------------------------------------
// Deploy workflow: key configuration checks
// ---------------------------------------------------------------------------
// NOTE: This test may fail in archive/zip contexts because macOS strips .github/ from zips.
// These failures are expected and do not indicate a real problem when running in the live repo.
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
    // The workflow uploads the repo root as the Pages artifact (no _site/ staging step)
    assert(workflow.includes("path: '.'"), "Pages artifact path is '.' (repo root)");
    // Verify that data/ directory is present in the repo root (served directly)
    assert(fs.existsSync(path.join(ROOT, 'data')), "data/ directory is present in the repo root (served directly)");
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
// data/hna/local-resources.json: housing plans & contacts
// ---------------------------------------------------------------------------
test('data/hna/local-resources.json: file exists and is valid JSON', () => {
    const lrPath = path.join(ROOT, 'data', 'hna', 'local-resources.json');
    assert(fs.existsSync(lrPath), 'data/hna/local-resources.json exists');
    const raw = fs.readFileSync(lrPath, 'utf8');
    let data;
    try { data = JSON.parse(raw); } catch (e) { assert(false, `valid JSON: ${e.message}`); return; }
    assert(typeof data === 'object' && data !== null, 'parses to an object');
    assert(Object.keys(data).length > 0, 'has at least one geography entry');
});

test('data/hna/local-resources.json: housingPlans entries are well-formed', () => {
    const lrPath = path.join(ROOT, 'data', 'hna', 'local-resources.json');
    const data = JSON.parse(fs.readFileSync(lrPath, 'utf8'));
    let planCount = 0;
    for (const [key, entry] of Object.entries(data)) {
        if (!entry.housingPlans) continue;
        assert(Array.isArray(entry.housingPlans), `${key}: housingPlans is an array`);
        for (const plan of entry.housingPlans) {
            assert(typeof plan.name === 'string' && plan.name.length > 0,
                `${key}: housingPlan entry has a non-empty "name"`);
            assert(typeof plan.type === 'string' && plan.type.length > 0,
                `${key}: housingPlan entry has a non-empty "type"`);
            if (plan.url !== undefined) {
                assert(typeof plan.url === 'string' && plan.url.startsWith('http'),
                    `${key}: housingPlan url starts with http`);
            }
            planCount++;
        }
    }
    assert(planCount > 0, 'at least one housingPlan entry exists across all geographies');
});

test('data/hna/local-resources.json: contacts entries are well-formed', () => {
    const lrPath = path.join(ROOT, 'data', 'hna', 'local-resources.json');
    const data = JSON.parse(fs.readFileSync(lrPath, 'utf8'));
    let contactCount = 0;
    for (const [key, entry] of Object.entries(data)) {
        if (!entry.contacts) continue;
        assert(Array.isArray(entry.contacts), `${key}: contacts is an array`);
        for (const c of entry.contacts) {
            assert(typeof c.name === 'string' && c.name.length > 0,
                `${key}: contact entry has a non-empty "name"`);
            assert(typeof c.title === 'string' && c.title.length > 0,
                `${key}: contact entry has a non-empty "title"`);
            if (c.url !== undefined) {
                assert(typeof c.url === 'string' && c.url.startsWith('http'),
                    `${key}: contact url starts with http`);
            }
            contactCount++;
        }
    }
    assert(contactCount > 0, 'at least one contact entry exists across all geographies');
});

test('JS: renderLocalResources renders housingPlans section', () => {
    assert(js.includes('housingPlans'),         'renderLocalResources references housingPlans');
    assert(js.includes('Housing plans'),        'renderLocalResources has "Housing plans" heading text');
    assert(js.includes('assessments'),          'renderLocalResources heading mentions assessments');
});

test('JS: renderLocalResources renders contacts section', () => {
    assert(js.includes('r.contacts'),           'renderLocalResources checks r.contacts');
    assert(js.includes('Key contacts'),         'renderLocalResources has "Key contacts" heading text');
    assert(js.includes('x.title'),              'renderLocalResources uses x.title for contact title');
    assert(js.includes('x.jurisdiction'),       'renderLocalResources uses x.jurisdiction');
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
    assert(
        js.includes('for (const v of ACS_VINTAGES)') ||
        js.includes('for (const v of window.HNAUtils.ACS_VINTAGES)'),
        'ACS_VINTAGES loop is present in fetch logic'
    );
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
// TIGERweb field-name consistency: STATEFP vs STATE
// Both the JS county-list fetch and the Python build-script fetch_counties()
// must use STATEFP='08' — the authoritative TIGERweb field for the state FIPS
// code on the State_County/MapServer/1 layer.  Using the old alias STATE='08'
// returns an empty result set on newer TIGERweb vintages.
// ---------------------------------------------------------------------------
test('JS: fetchCoCountiesList uses STATEFP (not STATE) for TIGERweb county query', () => {
    assert(
        js.includes("STATEFP='${STATE_FIPS_CO}'") || js.includes("STATEFP='08'") ||
        js.includes("STATEFP='${window.HNAUtils.STATE_FIPS_CO}'"),
        'fetchCoCountiesList queries TIGERweb with STATEFP field'
    );
    assert(
        !js.includes("where: `STATE='${STATE_FIPS_CO}'`") && !js.includes("where: \"STATE='08'\""),
        'fetchCoCountiesList does NOT use the deprecated STATE= alias'
    );
});

test('Python build_hna_data.py: fetch_counties uses STATEFP (not STATE) for TIGERweb query', () => {
    const py = fs.readFileSync(path.join(ROOT, 'scripts', 'hna', 'build_hna_data.py'), 'utf8');
    assert(
        py.includes("STATEFP='{STATE_FIPS_CO}'") || py.includes("STATEFP='08'"),
        'fetch_counties queries TIGERweb with STATEFP field'
    );
    assert(
        !py.includes("STATE='{STATE_FIPS_CO}'") && !py.includes("STATE='08'"),
        'fetch_counties does NOT use the deprecated STATE= alias'
    );
});


// ---------------------------------------------------------------------------
// HNA Scenario Tool: chart resize fix & reset button (PR #457 features)
// ---------------------------------------------------------------------------
test('JS: chart resize race condition fixed with requestAnimationFrame', () => {
    // The fix strategy evolved: charts in hidden views are now destroyed before
    // switching and re-rendered via applyAssumptions, ensuring correct dimensions.
    // Check that the view toggle destroys charts and triggers re-render.
    const hasDestroy = js.includes('ch.destroy()') && js.includes('projViewToggle');
    assert(
        hasDestroy || (js.includes('requestAnimationFrame') && js.includes('ch.resize()')),
        'requestAnimationFrame wraps ch.resize() and ch.update() for hidden-view charts'
    );
});

test('JS: reset button uses correct per-scenario migration defaults', () => {
    assert(js.includes('migration: 500'),  'baseline scenario uses 500/yr migration default');
    assert(js.includes('migration: 250'),  'low_growth scenario uses 250/yr migration default');
    assert(js.includes('migration: 1000'), 'high_growth scenario uses 1000/yr migration default');
});

test('JS: __announceUpdate called on projection view toggle for WCAG 4.1.3', () => {
    assert(
        js.includes("__announceUpdate(`Scenario view changed to:") ||
        js.includes("__announceUpdate('Scenario view changed to:"),
        '__announceUpdate is called when projection view tab changes'
    );
});

// ---------------------------------------------------------------------------
// HNA Scenario Tool: accessibility attributes (WCAG 2.5.5 touch targets)
// ---------------------------------------------------------------------------
test('HTML: projection view toggle uses role="group" with aria-label', () => {
    assert(
        html.includes('role="group"') && html.includes('aria-label="Projection view selector"'),
        'projection view selector has role="group" and aria-label'
    );
});

test('HTML: projection view labels use .proj-view-label class (WCAG 2.5.5 touch target)', () => {
    assert(
        html.includes('class="proj-view-label"'),
        '.proj-view-label class applied to projection toggle labels'
    );
});

// ---------------------------------------------------------------------------
// HNA CSS: new utility classes added with PR #457
// ---------------------------------------------------------------------------
test('CSS: .checklist-item-note rule is defined', () => {
    const css = fs.readFileSync(
        path.join(ROOT, 'css', 'pages', 'housing-needs-assessment.css'), 'utf8'
    );
    assert(css.includes('.checklist-item-note'), '.checklist-item-note CSS rule exists');
    assert(css.includes('.checklist-item.done .checklist-item-note'), '.checklist-item.done hides note');
});

test('CSS: .action-plan-grid responsive grid rule is defined', () => {
    const css = fs.readFileSync(
        path.join(ROOT, 'css', 'pages', 'housing-needs-assessment.css'), 'utf8'
    );
    assert(css.includes('.action-plan-grid'), '.action-plan-grid class exists');
    assert(
        css.includes('grid-template-columns: 1fr 1fr') || css.includes('grid-template-columns:1fr 1fr'),
        '.action-plan-grid uses two-column layout'
    );
});

test('CSS: .proj-view-label enforces WCAG 2.5.5 minimum touch target sizes', () => {
    const css = fs.readFileSync(
        path.join(ROOT, 'css', 'pages', 'housing-needs-assessment.css'), 'utf8'
    );
    assert(css.includes('.proj-view-label'), '.proj-view-label CSS rule exists');
    assert(css.includes('min-height: 44px'), '.proj-view-label has min-height: 44px (WCAG 2.5.5)');
    assert(css.includes('min-width: 44px'),  '.proj-view-label has min-width: 44px (WCAG 2.5.5)');
});

// ---------------------------------------------------------------------------
// HNA DLG methodology alignment
// ---------------------------------------------------------------------------
test('HTML: DLG methodology reference link is present', () => {
    assert(
        html.includes('href="https://dlg.colorado.gov/') &&
        html.includes('final-housing-needs-assessment-methodology'),
        'DLG HNA methodology reference link points to the correct URL'
    );
});

// ---------------------------------------------------------------------------
// HNA Scenario Tool: CSV export, debouncing, and data quality enhancements
// ---------------------------------------------------------------------------
test('HTML: scenario export CSV button is present', () => {
    assert(
        html.includes('id="btnExportScenario"'),
        'Export CSV button with id btnExportScenario is present in HTML'
    );
});

test('HTML: scenario freshness badge element is present', () => {
    assert(
        html.includes('id="scenarioFreshnessBadge"'),
        'Scenario freshness badge element is present in HTML'
    );
});

test('HTML: scenario data quality indicator element is present', () => {
    assert(
        html.includes('id="scenarioDataQuality"'),
        'Scenario data quality element is present in HTML'
    );
});

test('JS: exportScenarioCSV function is defined', () => {
    assert(
        js.includes('function exportScenarioCSV') || js.includes('exportScenarioCSV ='),
        'exportScenarioCSV function is defined in JS modules'
    );
});

test('JS: btnExportScenario is wired to exportScenarioCSV', () => {
    assert(
        js.includes('btnExportScenario') && js.includes('exportScenarioCSV'),
        'Export button is referenced and exportScenarioCSV is called'
    );
});

test('JS: slider debouncing uses setTimeout (performance)', () => {
    assert(
        js.includes('_sliderDebounce') && js.includes('clearTimeout(_sliderDebounce)'),
        'Slider input debounce uses clearTimeout/_sliderDebounce pattern'
    );
});

test('JS: lastScenarioSeries is saved to state for CSV export', () => {
    assert(
        js.includes('lastScenarioSeries'),
        'Scenario series are stored in state.lastScenarioSeries for CSV export'
    );
});

test('JS: lastGeoLabel is stored in state', () => {
    assert(
        js.includes('lastGeoLabel'),
        'Geography label is stored in state.lastGeoLabel for export file naming'
    );
});

test('JS: scenario data quality notice distinguishes synthetic vs direct data', () => {
    assert(
        js.includes('isSynthetic') || js.includes('dq-warn'),
        'Data quality indicator differentiates synthetic place/CDP projections from direct county data'
    );
});

test('HTML: scenario summary uses div with role=region (structured comparison)', () => {
    assert(
        html.includes('id="scenarioNeedSummary"') &&
        html.includes('role="region"') &&
        html.includes('aria-label="Scenario comparison summary"'),
        'Scenario summary uses <div> with ARIA role=region and descriptive aria-label'
    );
});

test('CSS: .scenario-freshness-badge is defined', () => {
    const css = fs.readFileSync(
        path.join(ROOT, 'css', 'pages', 'housing-needs-assessment.css'), 'utf8'
    );
    assert(css.includes('.scenario-freshness-badge'), '.scenario-freshness-badge CSS rule exists');
});

test('CSS: .scenario-need-summary is defined', () => {
    const css = fs.readFileSync(
        path.join(ROOT, 'css', 'pages', 'housing-needs-assessment.css'), 'utf8'
    );
    assert(css.includes('.scenario-need-summary'), '.scenario-need-summary CSS rule exists');
});

test('CSS: .scenario-data-quality is defined', () => {
    const css = fs.readFileSync(
        path.join(ROOT, 'css', 'pages', 'housing-needs-assessment.css'), 'utf8'
    );
    assert(css.includes('.scenario-data-quality'), '.scenario-data-quality CSS rule exists');
});


console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
    console.error('\nSome checks failed. Review the output above for details.');
    process.exitCode = 1;
} else {
    console.log('\nAll checks passed ✅');
}
