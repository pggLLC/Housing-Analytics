// test/hna-rent-burden-counts.test.js
//
// The housing gap summary called renters paying 35% or more "severely
// burdened" and estimated the count from all renters. HUD's severe line is
// 50% or more, and Census divides by renters with a computed ratio. Fruita
// (ACS 2020-2024 5-year, B25070): 840 computed, 366 at 30%+ (43.6%), 37.4% at
// 35%+, 165 at 50%+ (19.6%). Source:
// https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b25070.dat
//
// Run: node test/hna-rent-burden-counts.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const summary = (g) => JSON.parse(read(`data/hna/summary/${g}.json`));

const dom = new JSDOM('<!doctype html><body><div id="housingGapSummary"></div></body>',
  { url: 'http://127.0.0.1/housing-needs-assessment.html', runScripts: 'outside-only' });
const w = dom.window;
w.APP_CONFIG = {};
w.HNAState = { state: {} };
for (const f of ['js/utils/format-money.js', 'js/hna/hna-utils.js', 'js/hna/hna-renderers.js']) w.eval(read(f));
const U = w.HNAUtils;

let passed = 0;
function check(cond, msg) { assert.ok(cond, msg); console.log('  ✅ PASS: ' + msg); passed++; }

const prof = (g) => Object.assign({}, summary(g).acsProfile, { _geoType: summary(g).geo.type, _geoid: g });

// Fruita, place, 2020-2024 5-year
const fruita = U.rentBurdenCounts(prof('0828745'));
check(fruita && fruita.computedHouseholds === 840, 'Fruita: 840 renter households with a computed ratio');
check(fruita.atLeast30Households === 366 && fruita.atLeast30Pct === 43.6, 'Fruita: 366 households (43.6%) pay 30% or more');
check(fruita.atLeast35Pct === 37.4, 'Fruita: 37.4% pay 35% or more, matching DP04_0142PE');
check(fruita.atLeast50Households === 165 && fruita.atLeast50Pct === 19.6, 'Fruita: 165 households (19.6%) pay 50% or more');
check(fruita.year === '2024' && fruita.series === 'acs5', 'Fruita: counts are from the profile\'s own release');

// Mesa County moved from the 2025 1-year to the 2020-2024 5-year (4 Nov 2026);
// its counts follow the profile, and the stamp must survive the build.
const mesa = U.rentBurdenCounts(prof('08077'));
check(mesa && mesa.series === 'acs5' && mesa.year === '2024', 'Mesa: counts follow the 2020-2024 5-year profile');
check(mesa.atLeast50Pct === 25.1, 'Mesa: 25.1% pay 50% or more (2020-2024 5-year)');

// Hinsdale: measured zeros stay zero, not missing.
const hin = U.rentBurdenCounts(prof('08053'));
check(hin && hin.computedHouseholds === 113 && hin.atLeast30Households === 6 && hin.atLeast50Households === 4,
  'Hinsdale: 113 computed, 6 at 30%+, 4 at 50%+ with zero bins kept as zeros');

// Missing, suppressed, or mismatched counts are unavailable.
const base = prof('0828745');
check(U.rentBurdenCounts(Object.assign({}, base, { B25070_010E: null })) === null, 'missing 50%+ bin: unavailable');
check(U.rentBurdenCounts(Object.assign({}, base, { B25070_010E: -666666666 })) === null, 'suppressed 50%+ bin: unavailable');
check(U.rentBurdenCounts(Object.assign({}, base, { _b25070Year: '2023' })) === null, 'counts from another year: unavailable');
check(U.rentBurdenCounts(Object.assign({}, base, { _b25070Series: 'acs1' })) === null, 'counts from another series: unavailable');
check(U.rentBurdenCounts(Object.assign({}, base, { DP04_0142PE: 30.0 })) === null, 'counts that disagree with DP04_0142PE: unavailable');

// Every stored profile that carries counts agrees with its own 35%+ share.
let withCounts = 0;
for (const f of fs.readdirSync(path.join(ROOT, 'data/hna/summary'))) {
  const s = JSON.parse(read('data/hna/summary/' + f));
  for (const sec of ['acsProfile', 'acs5Profile']) {
    const p = s[sec];
    if (!p || p.B25070_001E == null) continue;
    withCounts++;
    assert.strictEqual(String(p._b25070Year), String(p._acsYear), f + ' ' + sec + ': B25070 year matches profile');
    assert.strictEqual(p._b25070Series, p._acsSeries, f + ' ' + sec + ': B25070 series matches profile');
  }
}
check(withCounts > 500, 'stored summaries carry period-matched B25070 counts (' + withCounts + ' profiles)');

// The rendered paragraph.
const el = w.document.getElementById('housingGapSummary');
w.HNARenderers.renderHousingGapSummary(base, 'place');
const text = el.textContent;
check(/43\.6%/.test(text) && /366/.test(text) && /840/.test(text), 'page: 43.6%, 366 of 840 households');
check(/19\.6%/.test(text) && /165/.test(text) && /50% or more/.test(text), 'page: 19.6% (165 households) pay 50% or more');
check(/2020-2024 5-year/.test(text), 'page: names the ACS period');
check(!/severe[^.]*35%|35%[^.]*severe/i.test(text), 'page: 35% is never called severe');

const noCounts = Object.assign({}, base);
for (const k of Object.keys(noCounts)) if (/B25070|b25070/.test(k)) delete noCounts[k];
w.HNARenderers.renderHousingGapSummary(noCounts, 'place');
check(/not available/.test(el.textContent) && !/roughly/.test(el.textContent) && !/165/.test(el.textContent),
  'page without counts: shares only, counts and 50% share marked not available');

const noBins = Object.assign({}, noCounts, { DP04_0141PE: null, DP04_0142PE: null });
w.HNARenderers.renderHousingGapSummary(noBins, 'place');
check(!/0\.0% of renter/.test(el.textContent), 'page with missing bins: no 0.0% burden claim');

// The gap panel's cost-pressure line (v3 review F2) agrees with the panel above: the same B25070
// count and denominator, never all renters times a rate measured on fewer households.
{
  const d2 = new JSDOM('<!doctype html><body><div id="hnaGapCoveragePanel"><div id="hnaGapBurdenContext"></div></div></body>',
    { url: 'http://127.0.0.1/housing-needs-assessment.html', runScripts: 'outside-only' });
  const w2 = d2.window;
  w2.APP_CONFIG = {};
  w2.HNAState = { state: {} };
  for (const f of ['js/utils/format-money.js', 'js/hna/hna-utils.js', 'js/hna/hna-renderers.js']) w2.eval(read(f));
  const placeAmi = JSON.parse(read('data/co_ami_gap_by_place.json'));
  const line = () => w2.document.getElementById('hnaGapBurdenContext').textContent;
  // Expected figures come from the helper the burden panel uses, not from copied numbers or wording.
  const numbersIn = (t) => (t.match(/\d[\d,]*(?:\.\d+)?/g) || []).map((x) => Number(x.replace(/,/g, '')));
  for (const g of ['0828745', '0845970', '08077']) {
    const p = prof(g), c = U.rentBurdenCounts(p);
    if (!c) continue;
    w2.HNARenderers.renderGapCoverageStats(g.slice(0, 5) === g ? g : '08077', null, null, { type: g.length === 5 ? 'county' : 'place', geoid: g }, placeAmi, p);
    const n = numbersIn(line());
    check(n.includes(c.atLeast30Households) && n.includes(c.computedHouseholds) && n.includes(c.atLeast30Pct) && n.includes(Number(c.year)),
      g + ': gap panel shows the helper\'s count ' + c.atLeast30Households + ', denominator ' + c.computedHouseholds + ', share ' + c.atLeast30Pct + ' and year ' + c.year);
    const all = Number(p.DP04_0047E);
    check(all === c.computedHouseholds || !n.includes(all), g + ': the denominator is not all renter households (' + all + ')');
  }
  // No renters and no published shares (Alpine CDP in the stored summaries): no line, never 0.0%.
  const empty = Object.assign({}, prof('0828745'), { DP04_0047E: 0, DP04_0141PE: null, DP04_0142PE: null });
  for (const k of Object.keys(empty)) if (/B25070|b25070/.test(k)) delete empty[k];
  w2.HNARenderers.renderGapCoverageStats('08077', null, null, { type: 'place', geoid: '0828745' }, placeAmi, empty);
  check(line().trim() === '', 'gap panel with no renters and no shares: no line, not 0.0%');
  const bare = prof('0828745');
  for (const k of Object.keys(bare)) if (/B25070|b25070/.test(k)) delete bare[k];
  w2.HNARenderers.renderGapCoverageStats('08077', null, null, { type: 'place', geoid: '0828745' }, placeAmi, bare);
  check(!/\d+ of \d/.test(line()) && /no count is shown/.test(line()), 'gap panel without counts: the share only, no estimated count');
}

console.log(`\n${passed} passed`);
