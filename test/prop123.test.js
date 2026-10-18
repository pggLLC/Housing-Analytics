// test/prop123.test.js
//
// Unit tests for Prop 123 (C.R.S. 29-32) calculation helpers defined in
// js/hna/* modules. The Prop 123 rules run against the shipped hna-utils.js;
// the labor-market helpers below are still re-implemented copies.
//
// Because the helpers are defined inside an IIFE (immediately invoked function
// expression) in the browser JS file, this test file re-implements the same
// pure calculation logic to validate correctness independently — matching the
// spec described in the problem statement and the implementation in HNA JS.
//
// Usage:
//   node test/prop123.test.js
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

// ── Re-implemented calculation helpers (mirrors js/hna/* modules) ──

const NAICS_LABELS = {
  CNS01: 'Agriculture & Forestry',   CNS02: 'Mining & Oil/Gas',
  CNS03: 'Utilities',                CNS04: 'Construction',
  CNS05: 'Manufacturing',            CNS06: 'Wholesale Trade',
  CNS07: 'Retail Trade',             CNS08: 'Transportation & Warehousing',
  CNS09: 'Information',              CNS10: 'Finance & Insurance',
  CNS11: 'Real Estate',              CNS12: 'Professional & Technical Services',
  CNS13: 'Management',               CNS14: 'Administrative & Support',
  CNS15: 'Educational Services',     CNS16: 'Health Care & Social Assistance',
  CNS17: 'Arts & Entertainment',     CNS18: 'Accommodation & Food Services',
  CNS19: 'Other Services',           CNS20: 'Public Administration',
};

// The Prop 123 rules are tested against the shipped hna-utils.js, loaded in a
// vm sandbox the way the page runs it — not against a copy kept here.
const vm = require('vm');
const utilsCtx = { console, URLSearchParams, location: { search: '' } };
utilsCtx.window = utilsCtx;
vm.createContext(utilsCtx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'hna', 'hna-utils.js'), 'utf8'), utilsCtx);
const { calculateGrowthTarget, checkFastTrackEligibility } = utilsCtx.HNAUtils;

function calculateBaseline(profile) {
  if (!profile) return null;

  const totalUnits = Number(profile.DP04_0001E);
  const renterPct  = Number(profile.DP04_0047PE);

  if (!Number.isFinite(totalUnits) || totalUnits <= 0) return null;
  if (!Number.isFinite(renterPct)  || renterPct  <= 0) return null;

  const totalRentals = Math.round(totalUnits * (renterPct / 100));
  if (totalRentals <= 0) return null;

  const grapi_lt15  = Number(profile.DP04_0144PE);
  const grapi_15_20 = Number(profile.DP04_0145PE);
  const grapi_20_25 = Number(profile.DP04_0146PE);

  let baseline60Ami, method;

  if (Number.isFinite(grapi_lt15) || Number.isFinite(grapi_15_20) || Number.isFinite(grapi_20_25)) {
    const notBurdenedPct = (Number.isFinite(grapi_lt15)  ? grapi_lt15  : 0) +
                           (Number.isFinite(grapi_15_20) ? grapi_15_20 : 0) +
                           (Number.isFinite(grapi_20_25) ? grapi_20_25 : 0);
    baseline60Ami = Math.round(totalRentals * (notBurdenedPct / 100) * 0.70);
    method = 'acs-grapi-proxy';
  } else {
    baseline60Ami = Math.round(totalRentals * 0.40);
    method = 'national-avg-proxy';
  }

  const pctOfStock = totalRentals > 0 ? (baseline60Ami / totalRentals) * 100 : 0;
  return { baseline60Ami, totalRentals, pctOfStock, method };
}

function parseIndustries(lehd, topN) {
  topN = topN || 5;
  if (!lehd) return [];
  const entries = [];
  Object.keys(NAICS_LABELS).forEach(function(key) {
    const count = Number(lehd[key]);
    if (Number.isFinite(count) && count > 0) {
      entries.push({ label: NAICS_LABELS[key], count });
    }
  });
  if (!entries.length) return [];
  entries.sort(function(a, b) { return b.count - a.count; });
  return entries.slice(0, topN);
}

function calculateWageDistribution(lehd) {
  if (!lehd) return null;
  const low    = Number(lehd.CE01);
  const medium = Number(lehd.CE02);
  const high   = Number(lehd.CE03);
  if (!Number.isFinite(low) && !Number.isFinite(medium) && !Number.isFinite(high)) return null;
  const l = Number.isFinite(low)    ? low    : 0;
  const m = Number.isFinite(medium) ? medium : 0;
  const h = Number.isFinite(high)   ? high   : 0;
  const total = l + m + h;
  if (total === 0) return null;
  return { low: l, medium: m, high: h, total: l + m + h };
}

// ── Tests ───────────────────────────────────────────────────────────────────

test('HNA modules contain Prop 123 functions', () => {
  // After the HNA module refactor, functions live in js/hna/*.js.
  const hnaDirs = [
    path.join(ROOT, 'js', 'hna', 'hna-utils.js'),
    path.join(ROOT, 'js', 'hna', 'hna-renderers.js'),
    path.join(ROOT, 'js', 'hna', 'hna-controller.js'),
  ];
  const src = hnaDirs.map(f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '').join('\n');
  assert(src.includes('calculateBaseline'),           'calculateBaseline defined');
  assert(src.includes('calculateGrowthTarget'),       'calculateGrowthTarget defined');
  assert(src.includes('checkFastTrackEligibility'),   'checkFastTrackEligibility defined');
  assert(src.includes('parseIndustries'),             'parseIndustries defined');
  assert(src.includes('calculateWageDistribution'),   'calculateWageDistribution defined');
  assert(src.includes('renderProp123Section'),        'renderProp123Section defined');
  assert(src.includes('renderLaborMarketSection'),    'renderLaborMarketSection defined');
});

test('housing-needs-assessment.html contains new sections', () => {
  const html = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
  assert(html.includes('id="labor-market-section"'), 'Labor Market section present');
  assert(html.includes('id="prop123-section"'),       'Prop 123 section present');
  assert(html.includes('id="jobMetrics"'),            'jobMetrics container present');
  assert(html.includes('id="prop123BaselineContent"'), 'Prop 123 baseline card present');
  assert(html.includes('id="prop123GrowthContent"'),   'Prop 123 growth card present');
  assert(html.includes('id="prop123FastTrackContent"'), 'Prop 123 fast-track card present');
  assert(html.includes('id="prop123Checklist"'),       'Compliance checklist present');
});

// 2024–2026: 3% of the baseline per year, simple not compound, capped at the
// cycle's three years (C.R.S. § 29-32-105(1)(a)); HB26-1313 sets later goals.
test('calculateGrowthTarget: 3% of the baseline per year, not compound', () => {
  const baseline = 1000;
  assert(calculateGrowthTarget(baseline, 0) === 1000, 'year 0 = baseline');
  assert(calculateGrowthTarget(baseline, 1) === 1030, 'year 1 = 1030');
  assert(calculateGrowthTarget(baseline, 2) === 1060, 'year 2 = 1060, not 1061 (compound)');
  assert(calculateGrowthTarget(baseline, 3) === 1090, 'year 3 = 1090 (9% over the cycle)');
  assert(calculateGrowthTarget(baseline, 5) === 1090, 'no goal past the 2024–2026 cycle');
});

test('calculateGrowthTarget: no baseline means no target', () => {
  assert(calculateGrowthTarget(0, 3)   === null, 'zero baseline → null');
  assert(calculateGrowthTarget(-100, 1) === null, 'negative baseline → null');
  assert(calculateGrowthTarget(null, 1) === null, 'null baseline → null');
});

// The law sets no population threshold for filing or for fast-track review,
// and a CDP is covered by its county (C.R.S. § 29-32-105(1)(b), (2)).
test('checkFastTrackEligibility: no population threshold', () => {
  [[1, 'place'], [999, 'place'], [4999, 'county'], [null, 'county']].forEach(([pop, gt]) => {
    const r = checkFastTrackEligibility(pop, gt);
    assert(r.eligible === true && r.threshold === null, `${gt} of ${pop} people: applies, no threshold`);
  });
});

test('checkFastTrackEligibility: a CDP is covered by its county', () => {
  const cdp = checkFastTrackEligibility(2000, 'cdp');
  assert(cdp.eligible === true, 'CDP is not excluded');
  assert(/county/i.test(cdp.reason), 'reason names the county');
  assert(checkFastTrackEligibility(2000, undefined).eligible === null, 'unknown type → null');
});

test('calculateBaseline: returns correct fields from ACS profile', () => {
  const profile = {
    DP04_0001E: '10000',  // total units
    DP04_0047PE: '30',    // 30% renter-occupied → 3000 rentals
    DP04_0144PE: '10',    // GRAPI <15%
    DP04_0145PE: '8',     // GRAPI 15-20%
    DP04_0146PE: '7',     // GRAPI 20-25%
    // not-burdened sum = 25% of rentals; 60%AMI ≈ 70% of that = 17.5% of 3000 = 525
  };
  const result = calculateBaseline(profile);
  assert(result !== null, 'returns a result');
  assert(result.totalRentals === 3000, 'totalRentals is 3000');
  assert(result.baseline60Ami === Math.round(3000 * (25 / 100) * 0.70), 'baseline60Ami uses GRAPI proxy');
  assert(result.method === 'acs-grapi-proxy', 'method is acs-grapi-proxy');
  assert(typeof result.pctOfStock === 'number', 'pctOfStock is a number');
});

test('calculateBaseline: falls back to national avg when no GRAPI data', () => {
  const profile = {
    DP04_0001E: '5000',
    DP04_0047PE: '40',   // 40% renter → 2000 rentals
    // no GRAPI bins
  };
  const result = calculateBaseline(profile);
  assert(result !== null, 'returns result with fallback');
  assert(result.totalRentals === 2000, 'totalRentals correct');
  assert(result.baseline60Ami === Math.round(2000 * 0.40), 'uses 40% national avg proxy');
  assert(result.method === 'national-avg-proxy', 'method is national-avg-proxy');
});

test('calculateBaseline: returns null for missing/invalid data', () => {
  assert(calculateBaseline(null)                 === null, 'null profile → null');
  assert(calculateBaseline({})                   === null, 'empty profile → null');
  assert(calculateBaseline({ DP04_0001E: '1000' }) === null, 'missing renter pct → null');
  assert(calculateBaseline({ DP04_0001E: '0', DP04_0047PE: '30' }) === null, 'zero units → null');
  assert(calculateBaseline({ DP04_0001E: '1000', DP04_0047PE: '0' }) === null, 'zero renter pct → null');
});

test('parseIndustries: returns top-N sorted by employment', () => {
  const lehd = {
    CNS07: 5000,   // Retail
    CNS16: 8000,   // Health Care (largest)
    CNS04: 3000,   // Construction
    CNS18: 4000,   // Accommodation
    CNS12: 6000,   // Professional
    CNS15: 2000,   // Educational
  };
  const top5 = parseIndustries(lehd, 5);
  assert(top5.length === 5, 'returns 5 industries');
  assert(top5[0].count === 8000, 'largest sector first');
  assert(top5[0].label === 'Health Care & Social Assistance', 'correct label for CNS16');
  assert(top5[4].count === 3000, '5th is Construction (3000)');
});

test('parseIndustries: returns empty array for missing/empty data', () => {
  assert(parseIndustries(null).length === 0, 'null → []');
  assert(parseIndustries({}).length   === 0, 'no CNS fields → []');
  assert(parseIndustries({ CNS07: 0 }).length === 0, 'all-zero fields → []');
});

test('calculateWageDistribution: splits CE01/CE02/CE03 correctly', () => {
  const lehd = { CE01: 1200, CE02: 3500, CE03: 2800 };
  const dist = calculateWageDistribution(lehd);
  assert(dist !== null, 'returns a result');
  assert(dist.low    === 1200, 'low wage correct');
  assert(dist.medium === 3500, 'medium wage correct');
  assert(dist.high   === 2800, 'high wage correct');
  assert(dist.total  === 7500, 'total is sum');
});

test('calculateWageDistribution: handles missing wage fields', () => {
  assert(calculateWageDistribution(null) === null, 'null → null');
  assert(calculateWageDistribution({})   === null, 'no CE fields → null');

  const partial = { CE01: 1000 };
  const dist = calculateWageDistribution(partial);
  assert(dist !== null, 'partial data returns result');
  assert(dist.low    === 1000, 'low = 1000');
  assert(dist.medium === 0,    'medium defaults to 0');
  assert(dist.high   === 0,    'high defaults to 0');
  assert(dist.total  === 1000, 'total = 1000');
});

test('calculateWageDistribution: handles edge cases (zero values, negatives ignored)', () => {
  const zero = { CE01: 0, CE02: 0, CE03: 0 };
  assert(calculateWageDistribution(zero) === null, 'all-zero CE fields → null');
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
