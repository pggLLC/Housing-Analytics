// test/integration/housing-needs-assessment.test.js
//
// Integration tests for the Housing Needs Assessment page.
//
// Verifies:
//   1. HNA JS source file exists and exports expected functions.
//   2. fetchBoundary error is caught and a warning banner is set (graceful degradation).
//   3. fetchWithTimeout is used for the TIGERweb boundary request.
//   4. hnaDataTimestamp element ID is present in the HTML.
//   5. housing-needs-assessment.html references the correct JS file.
//
// Usage:
//   node test/integration/housing-needs-assessment.test.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

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

const HNA_JS   = path.join(ROOT, 'js',   'housing-needs-assessment.js');
const HNA_HTML = path.join(ROOT, 'housing-needs-assessment.html');

const hnaSrc  = fs.readFileSync(HNA_JS,   'utf8');
const hnaHtml = fs.readFileSync(HNA_HTML, 'utf8');

// ── Tests ───────────────────────────────────────────────────────────────────

test('housing-needs-assessment.js exists and is non-empty', () => {
  assert(fs.existsSync(HNA_JS),    'js/housing-needs-assessment.js exists');
  assert(hnaSrc.length > 1000,     'file is non-trivially sized');
});

test('housing-needs-assessment.html exists and references the JS file', () => {
  assert(fs.existsSync(HNA_HTML),                                  'housing-needs-assessment.html exists');
  assert(hnaHtml.includes('housing-needs-assessment.js'),          'HTML references the HNA JS file');
});

test('HNA HTML includes data timestamp element', () => {
  assert(hnaHtml.includes('id="hnaDataTimestamp"'),
    'housing-needs-assessment.html has hnaDataTimestamp element');
  assert(hnaHtml.includes('data-timestamp'),
    'timestamp element uses data-timestamp CSS class');
});

test('HNA JS uses fetchWithTimeout from global (fetch-helper)', () => {
  assert(hnaSrc.includes('window.fetchWithTimeout'),
    'HNA JS aliases window.fetchWithTimeout');
});

test('TIGERweb boundary fetch is wrapped in try/catch for graceful degradation', () => {
  // The update() function wraps fetchBoundary in try/catch
  assert(hnaSrc.includes('fetchBoundary('), 'fetchBoundary is called');
  // Search for the CALL site (await fetchBoundary) rather than the definition,
  // so that lastIndexOf finds the try{ that guards the call, not the definition.
  const callIdx     = hnaSrc.indexOf('await fetchBoundary(');
  const tryCatchIdx = hnaSrc.lastIndexOf('try{', callIdx);
  assert(callIdx !== -1,
    'fetchBoundary is called with await (indicating async call site exists)');
  assert(tryCatchIdx !== -1,
    'fetchBoundary call is inside a try block (graceful degradation)');
});

test('HNA JS updates timestamp after data load', () => {
  assert(hnaSrc.includes('hnaDataTimestamp'),
    'HNA JS references hnaDataTimestamp element');
  assert(hnaSrc.includes('Data as of'),
    'HNA JS sets "Data as of" text');
});

test('fetchBoundary uses 15-second timeout', () => {
  assert(hnaSrc.includes('15000'),
    'fetchBoundary uses 15000ms timeout for TIGERweb');
});

test('HNA boundary failure message is informative', () => {
  assert(hnaSrc.includes('TIGERweb'),
    'Boundary failure message mentions TIGERweb for user clarity');
});

test('Labor Market section: JS functions defined', () => {
  assert(hnaSrc.includes('function calculateJobMetrics'),   'calculateJobMetrics is defined');
  assert(hnaSrc.includes('function calculateWageDistribution'), 'calculateWageDistribution is defined');
  assert(hnaSrc.includes('function parseIndustries'),       'parseIndustries is defined');
  assert(hnaSrc.includes('function renderLaborMarketSection'), 'renderLaborMarketSection is defined');
  assert(hnaSrc.includes('function renderJobMetrics'),      'renderJobMetrics is defined');
  assert(hnaSrc.includes('function renderWageChart'),       'renderWageChart is defined');
  assert(hnaSrc.includes('function renderIndustryChart'),   'renderIndustryChart is defined');
  assert(hnaSrc.includes('function renderCommutingFlows'),  'renderCommutingFlows is defined');
});

test('Prop 123 section: JS functions defined', () => {
  assert(hnaSrc.includes('function calculateBaseline'),          'calculateBaseline is defined');
  assert(hnaSrc.includes('function calculateGrowthTarget'),      'calculateGrowthTarget is defined');
  assert(hnaSrc.includes('function checkFastTrackEligibility'),  'checkFastTrackEligibility is defined');
  assert(hnaSrc.includes('function renderProp123Section'),       'renderProp123Section is defined');
  assert(hnaSrc.includes('function renderBaselineCard'),         'renderBaselineCard is defined');
  assert(hnaSrc.includes('function renderGrowthChart'),          'renderGrowthChart is defined');
  assert(hnaSrc.includes('function renderFastTrackCard'),        'renderFastTrackCard is defined');
  assert(hnaSrc.includes('function renderChecklist'),            'renderChecklist is defined');
});

test('Prop 123 section: constants defined correctly', () => {
  assert(hnaSrc.includes('PROP123_GROWTH_RATE = 0.03'),     'growth rate constant is 0.03 (3%)');
  assert(hnaSrc.includes('PROP123_MUNICIPALITY_THRESHOLD'), 'municipality threshold constant defined');
  assert(hnaSrc.includes('PROP123_COUNTY_THRESHOLD'),       'county threshold constant defined');
});

test('HTML contains Labor Market section with expected elements', () => {
  assert(hnaHtml.includes('id="labor-market-section"'),      'labor-market-section present');
  assert(hnaHtml.includes('id="jobMetrics"'),                'jobMetrics container present');
  assert(hnaHtml.includes('id="wageChartContainer"'),        'wageChartContainer present');
  assert(hnaHtml.includes('id="industryChartContainer"'),    'industryChartContainer present');
  assert(hnaHtml.includes('id="commutingFlowsContainer"'),   'commutingFlowsContainer present');
  assert(hnaHtml.includes('id="chartWage"'),                 'chartWage canvas present');
  assert(hnaHtml.includes('id="chartIndustry"'),             'chartIndustry canvas present');
});

test('HTML contains Prop 123 section with expected elements', () => {
  assert(hnaHtml.includes('id="prop123-section"'),           'prop123-section present');
  assert(hnaHtml.includes('id="prop123BaselineContent"'),    'baseline content area present');
  assert(hnaHtml.includes('id="prop123GrowthContent"'),      'growth content area present');
  assert(hnaHtml.includes('id="prop123FastTrackContent"'),   'fast-track content area present');
  assert(hnaHtml.includes('id="prop123Checklist"'),          'compliance checklist present');
  assert(hnaHtml.includes('id="chartProp123Growth"'),        'growth chart canvas present');
  assert(hnaHtml.includes('HB 22-1093'),                     'HB 22-1093 referenced in HTML');
});

test('CSS contains new section styles', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'pages', 'housing-needs-assessment.css'), 'utf8');
  assert(css.includes('.labor-market-section'),  '.labor-market-section class defined');
  assert(css.includes('.metric-card'),           '.metric-card class defined');
  assert(css.includes('.prop123-section'),        '.prop123-section class defined');
  assert(css.includes('.compliance-status'),      '.compliance-status class defined');
  assert(css.includes('.timeline-chart'),         '.timeline-chart class defined');
  assert(css.includes('.checklist-item'),         '.checklist-item class defined');
  assert(css.includes('.commuting-table'),        '.commuting-table class defined');
});

// ── Compliance Checklist module integration ──────────────────────────────────

const CC_JS = path.join(ROOT, 'js', 'compliance-checklist.js');
const ccSrc  = fs.existsSync(CC_JS) ? fs.readFileSync(CC_JS, 'utf8') : '';

test('compliance-checklist.js: file exists and exports 7 public functions', () => {
  assert(fs.existsSync(CC_JS), 'js/compliance-checklist.js exists');
  assert(ccSrc.includes('initComplianceChecklist'),  'exports initComplianceChecklist');
  assert(ccSrc.includes('updateChecklistItem'),      'exports updateChecklistItem');
  assert(ccSrc.includes('getChecklistState'),        'exports getChecklistState');
  assert(ccSrc.includes('isChecklistComplete'),      'exports isChecklistComplete');
  assert(ccSrc.includes('getNextAction'),            'exports getNextAction');
  assert(ccSrc.includes('broadcastChecklistChange'), 'exports broadcastChecklistChange');
  assert(ccSrc.includes('validateChecklistItem'),    'exports validateChecklistItem');
});

test('compliance-checklist.js: referenced in housing-needs-assessment.html', () => {
  assert(hnaHtml.includes('compliance-checklist.js'), 'HTML includes compliance-checklist.js script');
});

test('HTML checklist: data-storage-key attributes present on all 5 items', () => {
  assert(hnaHtml.includes('data-storage-key="baseline"'),  'baseline has data-storage-key');
  assert(hnaHtml.includes('data-storage-key="growth"'),    'growth has data-storage-key');
  assert(hnaHtml.includes('data-storage-key="fasttrack"'), 'fasttrack has data-storage-key');
  assert(hnaHtml.includes('data-storage-key="dola"'),      'dola has data-storage-key');
  assert(hnaHtml.includes('data-storage-key="report"'),    'report has data-storage-key');
});

test('HTML checklist: timestamp elements present on all 5 items', () => {
  const dateCount = (hnaHtml.match(/class="checklist-date-completed"/g) || []).length;
  assert(dateCount === 5, 'exactly 5 checklist-date-completed elements present');
});

test('HTML checklist: status icon spans present on all 5 items', () => {
  const iconCount = (hnaHtml.match(/class="checklist-status-icon"/g) || []).length;
  assert(iconCount === 5, 'exactly 5 checklist-status-icon elements present');
});

test('HTML checklist: aria-live announcement region present', () => {
  assert(hnaHtml.includes('aria-live="polite"'),       'aria-live polite region present');
  assert(hnaHtml.includes('id="checklistAnnouncer"'),  'checklistAnnouncer element present');
  assert(hnaHtml.includes('aria-atomic="true"'),       'aria-atomic="true" present');
});

test('HTML checklist: aria-checked attribute on all 5 checkboxes', () => {
  // All checkboxes in the checklist should have aria-checked attribute
  assert(hnaHtml.includes('aria-checked="false"'), 'aria-checked="false" present on checkboxes');
});

test('HNA JS: wires compliance checklist change listener', () => {
  assert(hnaSrc.includes('ComplianceChecklist'),              'HNA JS references ComplianceChecklist');
  assert(hnaSrc.includes('updateChecklistItem'),              'HNA JS calls updateChecklistItem');
  assert(hnaSrc.includes('initComplianceChecklist'),          'HNA JS calls initComplianceChecklist');
  assert(hnaSrc.includes('broadcastChecklistChange'),         'HNA JS calls broadcastChecklistChange');
  assert(hnaSrc.includes('data-storage-key'),                 'HNA JS reads data-storage-key attribute');
  assert(hnaSrc.includes('checklistAnnouncer'),               'HNA JS updates ARIA announcer');
});

test('CSS: new checklist status classes defined', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css', 'pages', 'housing-needs-assessment.css'), 'utf8');
  assert(css.includes('.checklist-status-icon'),     '.checklist-status-icon class defined');
  assert(css.includes('.checklist-item.warning'),    '.checklist-item.warning class defined');
  assert(css.includes('.checklist-item.pending'),    '.checklist-item.pending class defined');
  assert(css.includes('.checklist-date-completed'),  '.checklist-date-completed class defined');
  assert(css.includes('max-width: 480px'),           'mobile 480px breakpoint defined');
});

// ── ACS S0801 Commuting Mode Share ───────────────────────────────────────────

test('ACS S0801: fetchAcsS0801 function is defined', () => {
  assert(hnaSrc.includes('async function fetchAcsS0801'),
    'fetchAcsS0801 async function is defined');
});

test('ACS S0801: all required mode-share fields requested', () => {
  assert(hnaSrc.includes('S0801_C01_001E'), 'S0801_C01_001E (total workers) in fetch');
  assert(hnaSrc.includes('S0801_C01_002E'), 'S0801_C01_002E (drove alone) in fetch');
  assert(hnaSrc.includes('S0801_C01_003E'), 'S0801_C01_003E (carpool) in fetch');
  assert(hnaSrc.includes('S0801_C01_004E'), 'S0801_C01_004E (transit) in fetch');
  assert(hnaSrc.includes('S0801_C01_005E'), 'S0801_C01_005E (walked) in fetch');
  assert(hnaSrc.includes('S0801_C01_006E'), 'S0801_C01_006E (other means) in fetch');
  assert(hnaSrc.includes('S0801_C01_007E'), 'S0801_C01_007E (work from home) in fetch');
  assert(hnaSrc.includes('S0801_C01_018E'), 'S0801_C01_018E (mean commute time) in fetch');
});

test('ACS S0801: renderModeShare function is defined', () => {
  assert(hnaSrc.includes('function renderModeShare'),
    'renderModeShare function is defined');
});

test('ACS S0801: renderModeShare is called in update() pipeline', () => {
  assert(hnaSrc.includes('renderModeShare(s0801)'),
    'renderModeShare(s0801) is called in the update pipeline');
});

test('ACS S0801: renderModeShare has a null/missing-data guard', () => {
  // The function should guard against null s0801 or missing total field
  assert(hnaSrc.includes('!s0801') || hnaSrc.includes('s0801?.S0801_C01_001E') ||
    hnaSrc.includes('s0801.S0801_C01_001E'),
    'renderModeShare guards against null/missing S0801 data');
  // The outer caller also guards
  assert(hnaSrc.includes('if (s0801)') && hnaSrc.includes('renderModeShare(s0801)'),
    'update() guards renderModeShare call with if (s0801)');
});

test('ACS S0801: mean commute time populates statCommute element', () => {
  assert(hnaSrc.includes('statCommute'),
    'statCommute element is referenced in JS');
  assert(hnaSrc.includes('S0801_C01_018E'),
    'S0801_C01_018E (mean commute time) is used');
  // Confirm it's used to set text (either textContent or innerHTML)
  assert(hnaSrc.includes('els.statCommute.textContent'),
    'statCommute textContent is set from S0801 mean commute field');
});

test('ACS S0801: renderModeShare uses a per-bar color palette from CSS tokens', () => {
  // The enhanced renderModeShare should use chartTheme().chartColors (from --chart-* CSS tokens)
  const modeShareFnStart = hnaSrc.indexOf('function renderModeShare');
  const modeShareFnEnd   = hnaSrc.indexOf('\n  function ', modeShareFnStart + 1);
  const fnBody = modeShareFnEnd > modeShareFnStart
    ? hnaSrc.slice(modeShareFnStart, modeShareFnEnd)
    : hnaSrc.slice(modeShareFnStart, modeShareFnStart + 3000);
  assert(fnBody.includes('backgroundColor'),
    'renderModeShare sets backgroundColor for bars');
  // Colors must come from chartTheme().chartColors, not hardcoded hex values (Rule 10)
  assert(fnBody.includes('chartColors'),
    'renderModeShare uses chartTheme().chartColors (CSS token palette, Rule 10)');
  // chartTheme() must expose chartColors populated from --chart-* tokens
  const themeFnStart = hnaSrc.indexOf('function chartTheme');
  const themeFnEnd   = hnaSrc.indexOf('\n  function ', themeFnStart + 1);
  const themeFnBody  = hnaSrc.slice(themeFnStart, themeFnEnd);
  assert(themeFnBody.includes('--chart-'),
    'chartTheme() reads --chart-* CSS variable tokens');
  assert(themeFnBody.includes('chartColors'),
    'chartTheme() returns chartColors array');
});

test('HTML: chartMode canvas and statCommute element present', () => {
  assert(hnaHtml.includes('id="chartMode"'),
    'chartMode canvas is present in HTML');
  assert(hnaHtml.includes('id="statCommute"'),
    'statCommute stat element is present in HTML');
  assert(hnaHtml.includes('S0801'),
    'HTML references ACS S0801 table');
});

// ── Municipality Boundary Fix ────────────────────────────────────────────────

test('fetchBoundary: uses Places MapServer for place/CDP geography types', () => {
  const fnStart = hnaSrc.indexOf('async function fetchBoundary(');
  const fnEnd   = hnaSrc.indexOf('\n  }', fnStart + 1);
  const fnBody  = hnaSrc.slice(fnStart, fnEnd + 4);

  // Must use the Places_CouSub_ConCity_SubMCD MapServer (not County) for places
  assert(fnBody.includes('Places_CouSub_ConCity_SubMCD'),
    'fetchBoundary references TIGERweb Places_CouSub_ConCity_SubMCD MapServer');
  // Must use State_County MapServer for counties
  assert(fnBody.includes('State_County'),
    'fetchBoundary references TIGERweb State_County MapServer for counties');
  // Layer selection: county=1, place=4 (2025 vintage), cdp=5 (2025 vintage)
  assert(fnBody.includes("geoType === 'county' ? 1"),
    'fetchBoundary selects layer 1 for counties');
  assert(fnBody.includes("geoType === 'place' ? 4"),
    'fetchBoundary selects layer 4 for places (Incorporated Places — 2025 TIGERweb vintage)');
  assert(fnBody.includes("geoType === 'cdp' ? 5"),
    'fetchBoundary selects layer 5 for CDPs (Census Designated Places — 2025 TIGERweb vintage)');
  // Validates that features were actually returned (not silently empty)
  assert(fnBody.includes('features.length === 0') || fnBody.includes('!Array.isArray(gj?.features)'),
    'fetchBoundary validates that TIGERweb returned at least one feature');
  // outSR=4326 required by Rule 9
  assert(fnBody.includes("outSR: '4326'") || fnBody.includes("outSR=4326"),
    'fetchBoundary requests WGS84 output coordinates (outSR=4326, Rule 9)');
});

test('fetchBoundary: throws informative error when TIGERweb returns no features', () => {
  // Must throw (not silently succeed) when 0 features returned so callers know to clear the boundary
  assert(hnaSrc.includes('No boundary found for'),
    'fetchBoundary throws when TIGERweb returns no features');
});

test('fetchBoundary: CDP fallback tries incorporated places layer after CDP layer', () => {
  const fnStart = hnaSrc.indexOf('async function fetchBoundary(');
  const fnEnd   = hnaSrc.indexOf('\n  }', fnStart + 1);
  const fnBody  = hnaSrc.slice(fnStart, fnEnd + 4);
  // CDPs have a fallback from layer 5 to layer 4 (Incorporated Places, 2025 vintage)
  // in case of vintage reclassification between Census vintages.
  assert(fnBody.includes("geoType === 'cdp'") && fnBody.indexOf('/4/query') !== -1,
    'fetchBoundary includes a fallback for CDPs to the incorporated places layer (layer 4)');
});

test('FEATURED list: Highlands Ranch CDP has correct GEOID (0836410 not 0836000)', () => {
  assert(hnaSrc.includes("geoid: '0836410'"),
    'Highlands Ranch CDP uses correct GEOID 0836410 in FEATURED');
  assert(!hnaSrc.includes("geoid: '0836000'"),
    'Old incorrect GEOID 0836000 is not present in FEATURED');
});

test('renderBoundary: clears old layer before rendering new one', () => {
  const fnStart = hnaSrc.indexOf('function renderBoundary(');
  const fnEnd   = hnaSrc.indexOf('\n  }', fnStart + 1);
  const fnBody  = hnaSrc.slice(fnStart, fnEnd + 4);

  assert(fnBody.includes('boundaryLayer.remove()'),
    'renderBoundary removes old boundary layer');
  assert(fnBody.includes('boundaryLayer = null'),
    'renderBoundary nulls out the old layer reference');
  assert(fnBody.includes('features.length') || fnBody.includes('!features.length'),
    'renderBoundary guards against empty GeoJSON features');
});

test('renderBoundary: uses distinct visual styles for place vs county', () => {
  assert(hnaSrc.includes('BOUNDARY_STYLES'),
    'BOUNDARY_STYLES constant is defined');
  // Places must use a different color from counties (green accent vs blue)
  assert(hnaSrc.includes("place:"),
    'BOUNDARY_STYLES includes place entry');
  assert(hnaSrc.includes("county:"),
    'BOUNDARY_STYLES includes county entry');
  assert(hnaSrc.includes("cdp:"),
    'BOUNDARY_STYLES includes cdp entry');
  // geoType is passed to renderBoundary so the correct style is applied
  assert(hnaSrc.includes('renderBoundary(gj, geoType)'),
    'renderBoundary is called with geoType argument');
});

test('update(): clears stat cards before fetching new geography data', () => {
  assert(hnaSrc.includes('function clearStats('),
    'clearStats function is defined');
  // clearStats must be called in update() before any async data fetch
  const updateIdx = hnaSrc.indexOf('async function update()');
  const clearIdx  = hnaSrc.indexOf('clearStats()', updateIdx);
  const fetchIdx  = hnaSrc.indexOf('fetchBoundary(', updateIdx);
  assert(clearIdx !== -1,
    'clearStats() is called inside update()');
  assert(clearIdx < fetchIdx,
    'clearStats() is called BEFORE boundary/data fetching (no stale values shown)');
});

test('update(): clears stale boundary when fetchBoundary fails', () => {
  // The catch block must call renderBoundary with empty GeoJSON to remove stale boundary
  const updateIdx = hnaSrc.indexOf('async function update()');
  const catchIdx  = hnaSrc.indexOf('renderBoundary({ type:', updateIdx);
  assert(catchIdx !== -1,
    'catch block calls renderBoundary with empty FeatureCollection to clear stale boundary');
  assert(hnaSrc.slice(catchIdx, catchIdx + 60).includes('features: []'),
    'stale-boundary clear passes empty features array');
});

test('update(): tracks boundaryFailed and downgrade banner after data loads', () => {
  const updateIdx = hnaSrc.indexOf('async function update()');
  assert(hnaSrc.indexOf('boundaryFailed', updateIdx) !== -1,
    'update() declares a boundaryFailed flag to track whether boundary fetch threw');
  assert(hnaSrc.includes('Map boundary unavailable'),
    'update() replaces alarming warn banner with informational message after data loads');
  // The banner downgrade must come AFTER the completion announcement
  const announceIdx = hnaSrc.indexOf('Data loaded for', updateIdx);
  const downgradeIdx = hnaSrc.indexOf('Map boundary unavailable', updateIdx);
  assert(announceIdx !== -1 && downgradeIdx !== -1 && downgradeIdx > announceIdx,
    'banner downgrade follows the aria-live completion announcement');
});

test('FEATURED list: four required Colorado cities have correct 7-digit GEOIDs', () => {
  // Verify the specific cities from the requirements
  const cities = [
    { label: 'Colorado Springs', geoid: '0816000', county: '08041' },
    { label: 'Boulder',          geoid: '0807850', county: '08013' },
    { label: 'Fort Collins',     geoid: '0827425', county: '08069' },
    { label: 'Grand Junction',   geoid: '0831660', county: '08077' },
  ];
  cities.forEach(function(city) {
    assert(hnaSrc.includes(`geoid: '${city.geoid}'`),
      `${city.label} has correct 7-digit GEOID ${city.geoid} in FEATURED`);
    assert(hnaSrc.includes(`containingCounty: '${city.county}'`),
      `${city.label} has correct containingCounty ${city.county} in FEATURED`);
  });
});

test('FEATURED list: all four cities use geoType=place (not county)', () => {
  // Cities must be place type so fetchBoundary queries Places MapServer
  assert(hnaSrc.includes("{ type: 'place', geoid: '0816000'"),
    "Colorado Springs is type 'place'");
  assert(hnaSrc.includes("{ type: 'place', geoid: '0807850'"),
    "Boulder is type 'place'");
  assert(hnaSrc.includes("{ type: 'place', geoid: '0827425'"),
    "Fort Collins is type 'place'");
  assert(hnaSrc.includes("{ type: 'place', geoid: '0831660'"),
    "Grand Junction is type 'place'");
});

test('fetchAcsProfile: constructs place-specific Census API parameter for municipalities', () => {
  const fnStart = hnaSrc.indexOf('async function fetchAcsProfile(');
  const fnEnd   = hnaSrc.indexOf('\n  async function ', fnStart + 1);
  const fnBody  = fnEnd > fnStart
    ? hnaSrc.slice(fnStart, fnEnd)
    : hnaSrc.slice(fnStart, fnStart + 3000);

  // Place ACS uses place:XXXXX (5-digit code = 7-digit GEOID minus state 2-digit prefix)
  assert(fnBody.includes("place:${geoid.slice(2)}"),
    "fetchAcsProfile uses place:${geoid.slice(2)} for municipality queries");
  // County ACS uses county:XXX (3-digit code = 5-digit GEOID minus state 2-digit prefix)
  assert(fnBody.includes("county:${geoid.slice(2,5)}"),
    "fetchAcsProfile uses county:${geoid.slice(2,5)} for county queries");
  // These are mutually exclusive — the same geoid slice pattern must NOT be used for both
  assert(
    fnBody.includes("geoType === 'county'") && fnBody.includes("geoType === 'place'"),
    'fetchAcsProfile branches on geoType to distinguish county vs place ACS endpoints'
  );
});

test('HTML: hnaLiveRegion aria-live region present for geography update announcements', () => {
  assert(hnaHtml.includes('id="hnaLiveRegion"'),
    'hnaLiveRegion element present in HTML');
  // The region containing hnaLiveRegion must have aria-live and aria-atomic
  const liveIdx = hnaHtml.indexOf('id="hnaLiveRegion"');
  const tagStart = hnaHtml.lastIndexOf('<', liveIdx);
  const tag = hnaHtml.slice(tagStart, hnaHtml.indexOf('>', liveIdx) + 1);
  assert(tag.includes('aria-live="polite"'),
    'hnaLiveRegion has aria-live="polite"');
  assert(tag.includes('aria-atomic="true"'),
    'hnaLiveRegion has aria-atomic="true"');
});

test('HNA JS: __announceUpdate is wired up in init() and called in update()', () => {
  assert(hnaSrc.includes('window.__announceUpdate'),
    'HNA JS references window.__announceUpdate');
  assert(hnaSrc.includes('hnaLiveRegion'),
    'HNA JS references hnaLiveRegion element');
  // update() must call it at start (loading) and end (loaded)
  const updateIdx = hnaSrc.indexOf('async function update()');
  const announceIdx = hnaSrc.indexOf('window.__announceUpdate', updateIdx);
  assert(announceIdx !== -1,
    'window.__announceUpdate is called inside update()');
});

// ── CHAS Affordability Gap ───────────────────────────────────────────────────

const CHAS_GAP_FILE = path.join(ROOT, 'data', 'hna', 'chas_affordability_gap.json');
const FETCH_CHAS_PY = path.join(ROOT, 'scripts', 'fetch_chas.py');
const CHAS_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'fetch-chas-data.yml');

const chasGapData = fs.existsSync(CHAS_GAP_FILE)
  ? JSON.parse(fs.readFileSync(CHAS_GAP_FILE, 'utf8'))
  : null;

test('CHAS affordability gap data file exists and is valid JSON', () => {
  assert(fs.existsSync(CHAS_GAP_FILE), 'data/hna/chas_affordability_gap.json exists');
  assert(chasGapData !== null, 'file parses as valid JSON');
  assert(typeof chasGapData === 'object', 'top-level value is an object');
});

test('CHAS gap file has required top-level sentinel keys (Rule 18)', () => {
  assert(chasGapData && 'meta' in chasGapData, 'has meta key');
  assert(chasGapData && 'state' in chasGapData, 'has state key');
  assert(chasGapData && 'counties' in chasGapData, 'has counties key');
  const meta = chasGapData && chasGapData.meta;
  assert(meta && meta.generated, 'meta.generated timestamp present');
  assert(meta && meta.source, 'meta.source present');
  assert(meta && meta.vintage, 'meta.vintage present');
});

test('CHAS gap file counties use 5-digit FIPS codes (Rule 1)', () => {
  if (!chasGapData) { assert(false, 'data file not available'); return; }
  const counties = chasGapData.counties || {};
  const allFips = Object.keys(counties);
  assert(allFips.length === 64, `exactly 64 Colorado counties present (found ${allFips.length})`);
  const badFips = allFips.filter(k => k.length !== 5 || !k.startsWith('08'));
  assert(badFips.length === 0, `all county FIPS are 5-digit CO codes (bad: ${badFips.join(', ') || 'none'})`);
  // Rule 1: Ouray (08091) must be present with correct 5-digit key
  assert('08091' in counties, 'Ouray County (08091) present with correct 5-digit FIPS');
});

test('CHAS gap county records have required renter_hh_by_ami structure', () => {
  if (!chasGapData) { assert(false, 'data file not available'); return; }
  const sample = chasGapData.counties['08031']; // Denver
  assert(sample, 'Denver county (08031) record exists');
  assert(sample && sample.renter_hh_by_ami, 'renter_hh_by_ami field present');
  const tiers = ['lte30', '31to50', '51to80', '81to100'];
  const ami = sample && sample.renter_hh_by_ami;
  tiers.forEach(tier => {
    assert(ami && tier in ami, `tier ${tier} present`);
    assert(ami && typeof ami[tier].total === 'number', `${tier}.total is a number`);
    assert(ami && typeof ami[tier].cost_burdened === 'number', `${tier}.cost_burdened is a number`);
    assert(ami && typeof ami[tier].severely_burdened === 'number', `${tier}.severely_burdened is a number`);
    // Severely burdened cannot exceed cost burdened
    assert(
      ami && ami[tier].severely_burdened <= ami[tier].cost_burdened,
      `${tier}: severely_burdened ≤ cost_burdened`
    );
    // Cost burdened cannot exceed total
    assert(
      ami && ami[tier].cost_burdened <= ami[tier].total,
      `${tier}: cost_burdened ≤ total`
    );
  });
});

test('CHAS gap file: meta.ami_tiers matches expected order', () => {
  if (!chasGapData) { assert(false, 'data file not available'); return; }
  const meta = chasGapData.meta;
  const tiers = meta && meta.ami_tiers;
  assert(Array.isArray(tiers), 'meta.ami_tiers is an array');
  assert(tiers && tiers.length === 4, 'meta.ami_tiers has 4 entries');
  assert(tiers && tiers[0] === 'lte30', 'first tier is lte30');
  assert(tiers && tiers[3] === '81to100', 'last tier is 81to100');
});

test('fetch_chas.py exists and references the gap output file', () => {
  assert(fs.existsSync(FETCH_CHAS_PY), 'scripts/fetch_chas.py exists');
  const pySrc = fs.readFileSync(FETCH_CHAS_PY, 'utf8');
  assert(pySrc.includes('chas_affordability_gap.json'), 'script references gap output path');
  assert(pySrc.includes('RENTER_AMI_COLS'), 'script defines RENTER_AMI_COLS column mapping');
  assert(pySrc.includes('aggregate_to_counties'), 'script has county aggregation function');
  assert(pySrc.includes('build_county_fips'), 'script has FIPS extraction helper');
});

test('fetch-chas-data.yml workflow exists with correct schedule', () => {
  assert(fs.existsSync(CHAS_WORKFLOW), '.github/workflows/fetch-chas-data.yml exists');
  const wfSrc = fs.readFileSync(CHAS_WORKFLOW, 'utf8');
  assert(wfSrc.includes("fetch_chas.py"), 'workflow runs fetch_chas.py');
  assert(wfSrc.includes('chas_affordability_gap.json'), 'workflow stages gap file for commit');
  assert(wfSrc.includes('workflow_dispatch'), 'workflow supports manual trigger');
  assert(wfSrc.includes('contents: write'), 'workflow has write permission for git push');
});

test('HNA JS: PATHS includes chasCostBurden path', () => {
  assert(hnaSrc.includes("chasCostBurden: 'data/hna/chas_affordability_gap.json'"),
    "PATHS.chasCostBurden points to data/hna/chas_affordability_gap.json");
});

test('HNA JS: renderChasAffordabilityGap function exists and is exported', () => {
  assert(hnaSrc.includes('function renderChasAffordabilityGap('),
    'renderChasAffordabilityGap function defined');
  assert(hnaSrc.includes('window.__HNA_renderChasAffordabilityGap'),
    'renderChasAffordabilityGap exported on window');
  assert(hnaSrc.includes('chartChasGap'),
    'function references chartChasGap canvas element');
  assert(hnaSrc.includes('chasGapStatus'),
    'function references chasGapStatus status element');
});

test('HNA JS: renderChasAffordabilityGap is called from update()', () => {
  const updateStart = hnaSrc.indexOf('async function update()');
  const updateEnd   = hnaSrc.indexOf('async function init()', updateStart);
  const updateBody  = hnaSrc.slice(updateStart, updateEnd);
  assert(updateBody.includes('renderChasAffordabilityGap('),
    'renderChasAffordabilityGap called inside update()');
  assert(updateBody.includes('state.chasData'),
    'update() caches CHAS data on state.chasData');
  assert(updateBody.includes('PATHS.chasCostBurden'),
    'update() loads CHAS data via PATHS.chasCostBurden');
});

test('HTML: chartChasGap canvas has role="img" and aria-label (Rule 15)', () => {
  assert(hnaHtml.includes('id="chartChasGap"'), 'chartChasGap canvas present in HTML');
  const canvasIdx = hnaHtml.indexOf('id="chartChasGap"');
  const tagStart  = hnaHtml.lastIndexOf('<', canvasIdx);
  const tagEnd    = hnaHtml.indexOf('>', canvasIdx);
  const tag       = hnaHtml.slice(tagStart, tagEnd + 1);
  assert(tag.includes('role="img"'), 'chartChasGap canvas has role="img"');
  assert(tag.includes('aria-label'), 'chartChasGap canvas has aria-label');
  assert(hnaHtml.includes('id="chasGapStatus"'), 'chasGapStatus status element present');
});

test('HTML: CHAS chart section has sr-only companion description (Rule 15)', () => {
  assert(hnaHtml.includes('class="sr-only"') && hnaHtml.includes('AMI income tier'),
    'sr-only description paragraph present near chartChasGap');
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
