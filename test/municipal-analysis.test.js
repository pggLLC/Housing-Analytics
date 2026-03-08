// test/municipal-analysis.test.js
//
// Unit tests for js/municipal-analysis.js — Municipal sub-county analysis framework.
//
// All seven public functions are tested:
//   1. calculateMunicipalScaling
//   2. estimateMunicipalHousingStock
//   3. scaleMunicipalAffordability
//   4. projectMunicipalDemographics
//   5. estimateMunicipalEmployment
//   6. calculateMunicipalProp123Baseline
//   7. getDataConfidence
//
// Data configuration files are also validated:
//   - data/hna/municipal/municipal-config.json  (FIPS format: 7-digit place, 5-digit county)
//   - data/hna/municipal/growth-rates.json
//
// Usage:
//   node test/municipal-analysis.test.js
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

// ── Load the module via CommonJS ─────────────────────────────────────────────

const MA = require(path.join(ROOT, 'js', 'municipal-analysis.js'));

test('module loads and exposes all seven public functions', () => {
  assert(typeof MA === 'object' && MA !== null,                         'module is an object');
  assert(typeof MA.calculateMunicipalScaling        === 'function',    'calculateMunicipalScaling exported');
  assert(typeof MA.estimateMunicipalHousingStock    === 'function',    'estimateMunicipalHousingStock exported');
  assert(typeof MA.scaleMunicipalAffordability      === 'function',    'scaleMunicipalAffordability exported');
  assert(typeof MA.projectMunicipalDemographics     === 'function',    'projectMunicipalDemographics exported');
  assert(typeof MA.estimateMunicipalEmployment      === 'function',    'estimateMunicipalEmployment exported');
  assert(typeof MA.calculateMunicipalProp123Baseline=== 'function',    'calculateMunicipalProp123Baseline exported');
  assert(typeof MA.getDataConfidence                === 'function',    'getDataConfidence exported');
});

// ── 1. calculateMunicipalScaling ─────────────────────────────────────────────

test('calculateMunicipalScaling: basic population share', () => {
  const result = MA.calculateMunicipalScaling(
    { population: 100000, growthRate: 0.01 },
    25000, 0.02
  );
  assert(Math.abs(result.popShare - 0.25) < 0.0001,
    'popShare = 25000/100000 = 0.25');
  assert(typeof result.projectedShareAtYear === 'function',
    'projectedShareAtYear is a function');
});

test('calculateMunicipalScaling: relative log growth is correct', () => {
  const result = MA.calculateMunicipalScaling(
    { population: 100000, growthRate: 0.01 },
    25000, 0.03
  );
  const expected = Math.log(1.03) - Math.log(1.01);
  assert(Math.abs(result.relativeLogGrowth - expected) < 1e-9,
    'relativeLogGrowth = ln(1.03) - ln(1.01)');
});

test('calculateMunicipalScaling: projectedShareAtYear at t=0 equals base share', () => {
  const result = MA.calculateMunicipalScaling(
    { population: 50000, growthRate: 0.015 },
    10000, 0.025
  );
  const shareAt0 = result.projectedShareAtYear(0);
  assert(Math.abs(shareAt0 - result.popShare) < 1e-9,
    'share at t=0 equals base popShare');
});

test('calculateMunicipalScaling: share grows when municipal rate > county rate', () => {
  const result = MA.calculateMunicipalScaling(
    { population: 100000, growthRate: 0.01 },
    20000, 0.03
  );
  const share10 = result.projectedShareAtYear(10);
  assert(share10 > result.popShare,
    'share at t=10 > base share when municipal rate > county rate');
});

test('calculateMunicipalScaling: share shrinks when municipal rate < county rate', () => {
  const result = MA.calculateMunicipalScaling(
    { population: 100000, growthRate: 0.03 },
    20000, 0.01
  );
  const share10 = result.projectedShareAtYear(10);
  assert(share10 < result.popShare,
    'share at t=10 < base share when municipal rate < county rate');
});

test('calculateMunicipalScaling: zero county pop returns zero share', () => {
  const result = MA.calculateMunicipalScaling(
    { population: 0, growthRate: 0.01 },
    5000, 0.02
  );
  assert(result.popShare === 0, 'popShare is 0 when county population is 0');
  assert(result.projectedShareAtYear(5) === 0, 'projectedShareAtYear returns 0');
});

test('calculateMunicipalScaling: zero municipal pop returns zero share', () => {
  const result = MA.calculateMunicipalScaling(
    { population: 100000, growthRate: 0.01 },
    0, 0.02
  );
  assert(result.popShare === 0, 'popShare is 0 when municipal population is 0');
});

test('calculateMunicipalScaling: null/undefined inputs handled gracefully', () => {
  const result = MA.calculateMunicipalScaling(null, null, null);
  assert(result.popShare === 0,          'null countyData → popShare 0');
  assert(result.relativeLogGrowth === 0, 'null inputs → relativeLogGrowth 0');
});

test('calculateMunicipalScaling: returns all expected fields', () => {
  const result = MA.calculateMunicipalScaling(
    { population: 80000, growthRate: 0.012 },
    16000, 0.018
  );
  assert('popShare'             in result, 'field popShare present');
  assert('relativeLogGrowth'    in result, 'field relativeLogGrowth present');
  assert('projectedShareAtYear' in result, 'field projectedShareAtYear present');
  assert('municipalPop'         in result, 'field municipalPop present');
  assert('countyPop'            in result, 'field countyPop present');
  assert('municipalGrowthRate'  in result, 'field municipalGrowthRate present');
  assert('countyGrowthRate'     in result, 'field countyGrowthRate present');
});

test('calculateMunicipalScaling: equal growth rates produce constant share', () => {
  const rate = 0.02;
  const result = MA.calculateMunicipalScaling(
    { population: 100000, growthRate: rate },
    30000, rate
  );
  const share5  = result.projectedShareAtYear(5);
  const share20 = result.projectedShareAtYear(20);
  assert(Math.abs(share5  - result.popShare) < 1e-9, 'share at t=5  constant when rates equal');
  assert(Math.abs(share20 - result.popShare) < 1e-9, 'share at t=20 constant when rates equal');
});

// ── 2. estimateMunicipalHousingStock ─────────────────────────────────────────

test('estimateMunicipalHousingStock: prefers direct housing units', () => {
  const result = MA.estimateMunicipalHousingStock(
    { totalUnits: 50000, households: 45000, population: 100000 },
    { directHousingUnits: 12000, households: 9000 }
  );
  assert(result.estimatedUnits === 12000,  'direct units used when provided');
  assert(result.method === 'direct',       'method is "direct"');
});

test('estimateMunicipalHousingStock: uses household-ratio when no direct units', () => {
  const result = MA.estimateMunicipalHousingStock(
    { totalUnits: 50000, households: 45000, population: 100000 },
    { households: 9000 }
  );
  assert(result.method === 'household-ratio', 'method is "household-ratio"');
  assert(result.estimatedUnits > 9000,        'estimated units > raw households (vacancy buffer)');
});

test('estimateMunicipalHousingStock: vacancyAdjustedUnits >= estimatedUnits', () => {
  const result = MA.estimateMunicipalHousingStock(
    { totalUnits: 55000, households: 50000, population: 100000 },
    { households: 5000 }
  );
  assert(result.vacancyAdjustedUnits >= result.estimatedUnits,
    'vacancyAdjustedUnits >= estimatedUnits');
});

test('estimateMunicipalHousingStock: returns countyVacancyRate as a number', () => {
  const result = MA.estimateMunicipalHousingStock(
    { totalUnits: 52500, households: 50000, population: 100000 },
    { households: 5000 }
  );
  assert(typeof result.countyVacancyRate === 'number', 'countyVacancyRate is a number');
  assert(result.countyVacancyRate >= 0,                'countyVacancyRate is non-negative');
});

test('estimateMunicipalHousingStock: zero inputs return zero units', () => {
  const result = MA.estimateMunicipalHousingStock(
    { totalUnits: 0, households: 0, population: 0 },
    {}
  );
  assert(result.estimatedUnits === 0, 'zero county data → zero estimated units');
});

test('estimateMunicipalHousingStock: falls back to population-share when no HH or direct', () => {
  const result = MA.estimateMunicipalHousingStock(
    { totalUnits: 10000, households: 9000, population: 50000 },
    { population: 5000 }
  );
  assert(result.method === 'population-share', 'method is "population-share" when only population given');
});

test('estimateMunicipalHousingStock: null municipalInputs handled gracefully', () => {
  const result = MA.estimateMunicipalHousingStock(
    { totalUnits: 10000, households: 9000, population: 50000 },
    null
  );
  assert(typeof result.estimatedUnits === 'number', 'returns a number for estimatedUnits');
});

// ── 3. scaleMunicipalAffordability ───────────────────────────────────────────

test('scaleMunicipalAffordability: rent adjustment factor clamped at 2.0', () => {
  const result = MA.scaleMunicipalAffordability(
    { medianRent: 1000 },
    5000, // very high municipal rent → unclamped factor = 5.0
    600000
  );
  assert(result.rentAdjustmentFactor === 2.0, 'RAF clamped at 2.0 upper bound');
});

test('scaleMunicipalAffordability: rent adjustment factor clamped at 0.5', () => {
  const result = MA.scaleMunicipalAffordability(
    { medianRent: 2000 },
    200, // very low municipal rent → unclamped factor = 0.1
    150000
  );
  assert(result.rentAdjustmentFactor === 0.5, 'RAF clamped at 0.5 lower bound');
});

test('scaleMunicipalAffordability: equal rents give RAF = 1', () => {
  const result = MA.scaleMunicipalAffordability(
    { medianRent: 1500 },
    1500,
    400000
  );
  assert(result.rentAdjustmentFactor === 1, 'equal rents → RAF = 1');
});

test('scaleMunicipalAffordability: returns 5-element amiTierShares summing to ~1', () => {
  const result = MA.scaleMunicipalAffordability(
    { medianRent: 1200 },
    1400,
    350000
  );
  assert(result.amiTierShares.length === 5, 'amiTierShares has 5 elements');
  const sum = result.amiTierShares.reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 1) < 0.0001, 'amiTierShares sum to 1');
});

test('scaleMunicipalAffordability: all tier shares are positive', () => {
  const result = MA.scaleMunicipalAffordability(
    { medianRent: 1200 },
    1800,
    450000
  );
  const allPositive = result.amiTierShares.every(s => s > 0);
  assert(allPositive, 'all AMI tier shares are positive');
});

test('scaleMunicipalAffordability: higher RAF shifts mass to higher tiers', () => {
  const base = MA.scaleMunicipalAffordability(
    { medianRent: 1000 },
    1000,
    300000
  );
  const high = MA.scaleMunicipalAffordability(
    { medianRent: 1000 },
    1800,  // RAF = 1.8 → higher cost area
    600000
  );
  // Highest tier (index 4) should have higher share in the high-rent scenario
  assert(high.amiTierShares[4] > base.amiTierShares[4],
    'high-rent area shifts mass to >100% AMI tier');
  // Lowest tier (index 0) should have lower share in the high-rent scenario
  assert(high.amiTierShares[0] < base.amiTierShares[0],
    'high-rent area reduces ≤30% AMI share');
});

test('scaleMunicipalAffordability: zero county rent returns RAF = 1', () => {
  const result = MA.scaleMunicipalAffordability(
    { medianRent: 0 },
    1200,
    350000
  );
  assert(result.rentAdjustmentFactor === 1, 'zero county rent → RAF = 1');
});

test('scaleMunicipalAffordability: uses county amiTierShares when provided', () => {
  const customShares = [0.25, 0.25, 0.25, 0.15, 0.10];
  const result = MA.scaleMunicipalAffordability(
    { medianRent: 1000, amiTierShares: customShares },
    1000,  // RAF = 1 (equal rents, no redistribution)
    300000
  );
  // With RAF=1 and equal rents the output shares should closely match input shares
  const sum = result.amiTierShares.reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 1) < 0.0001, 'custom base shares: output sums to 1');
});

test('scaleMunicipalAffordability: amiTierLabels has 5 elements', () => {
  const result = MA.scaleMunicipalAffordability({ medianRent: 1000 }, 1000, 300000);
  assert(result.amiTierLabels.length === 5, 'amiTierLabels has 5 elements');
});

// ── 4. projectMunicipalDemographics ──────────────────────────────────────────

const sampleProjections = [
  { year: 2024, population: 200000, households: 80000 },
  { year: 2029, population: 212000, households: 85000 },
  { year: 2034, population: 225000, households: 90000 },
  { year: 2039, population: 238000, households: 95000 },
  { year: 2044, population: 251000, households: 100000 },
];

test('projectMunicipalDemographics: returns same number of entries as input', () => {
  const result = MA.projectMunicipalDemographics(sampleProjections, 40000, 0.02);
  assert(result.length === sampleProjections.length,
    'output length matches input county projections length');
});

test('projectMunicipalDemographics: base year population matches input pop × share', () => {
  const mBasePop = 40000;
  const result = MA.projectMunicipalDemographics(sampleProjections, mBasePop, 0.015);
  const expectedShare = mBasePop / sampleProjections[0].population;
  const actualShare   = result[0].population / sampleProjections[0].population;
  assert(Math.abs(actualShare - expectedShare) < 0.0001,
    'base year share matches mBasePop / countyPop');
});

test('projectMunicipalDemographics: population grows when municipal rate > county rate', () => {
  const result = MA.projectMunicipalDemographics(sampleProjections, 30000, 0.04);
  // municipal rate (4%) > implied county rate (~1.1%), share should increase
  assert(result[result.length - 1].popShare > result[0].popShare,
    'final share > base share when municipal rate > county rate');
});

test('projectMunicipalDemographics: all year values are present', () => {
  const result = MA.projectMunicipalDemographics(sampleProjections, 20000, 0.015);
  result.forEach((entry, i) => {
    assert(entry.year === sampleProjections[i].year,
      `entry ${i} year matches county projection year`);
  });
});

test('projectMunicipalDemographics: households are non-negative integers', () => {
  const result = MA.projectMunicipalDemographics(sampleProjections, 25000, 0.02);
  const allOk = result.every(e => Number.isInteger(e.households) && e.households >= 0);
  assert(allOk, 'all household values are non-negative integers');
});

test('projectMunicipalDemographics: empty county projections returns empty array', () => {
  const result = MA.projectMunicipalDemographics([], 20000, 0.02);
  assert(Array.isArray(result) && result.length === 0,
    'empty county projections → empty result');
});

test('projectMunicipalDemographics: zero base population returns empty array', () => {
  const result = MA.projectMunicipalDemographics(sampleProjections, 0, 0.02);
  assert(Array.isArray(result) && result.length === 0,
    'zero municipal base pop → empty result');
});

test('projectMunicipalDemographics: non-array input returns empty array', () => {
  const result = MA.projectMunicipalDemographics(null, 20000, 0.02);
  assert(Array.isArray(result) && result.length === 0,
    'null county projections → empty result');
});

test('projectMunicipalDemographics: popShare field is present in each entry', () => {
  const result = MA.projectMunicipalDemographics(sampleProjections, 15000, 0.018);
  const allHaveShare = result.every(e => typeof e.popShare === 'number');
  assert(allHaveShare, 'all entries have a numeric popShare field');
});

// ── 5. estimateMunicipalEmployment ───────────────────────────────────────────

const sampleLEHD = {
  totalJobs: 120000,
  industries: [
    { label: 'Retail Trade',     jobs: 18000 },
    { label: 'Health Care',      jobs: 22000 },
    { label: 'Construction',     jobs: 9000  },
    { label: 'Finance',          jobs: 14000 },
    { label: 'Manufacturing',    jobs: 11000 },
  ],
};

test('estimateMunicipalEmployment: scales total jobs by pop share', () => {
  const result = MA.estimateMunicipalEmployment(sampleLEHD, 0.20);
  assert(result.totalJobs === Math.round(120000 * 0.20),
    'totalJobs = countyJobs × popShare');
});

test('estimateMunicipalEmployment: jobsByIndustry length matches input', () => {
  const result = MA.estimateMunicipalEmployment(sampleLEHD, 0.15);
  assert(result.jobsByIndustry.length === sampleLEHD.industries.length,
    'jobsByIndustry has same length as county industries array');
});

test('estimateMunicipalEmployment: individual industry jobs scaled correctly', () => {
  const popShare = 0.25;
  const result   = MA.estimateMunicipalEmployment(sampleLEHD, popShare);
  result.jobsByIndustry.forEach((ind, i) => {
    const expected = Math.round(sampleLEHD.industries[i].jobs * popShare);
    assert(ind.jobs === expected,
      `industry ${i} jobs scaled by popShare`);
  });
});

test('estimateMunicipalEmployment: returns popShare field', () => {
  const result = MA.estimateMunicipalEmployment(sampleLEHD, 0.18);
  assert(Math.abs(result.popShare - 0.18) < 0.0001, 'popShare field returned correctly');
});

test('estimateMunicipalEmployment: zero pop share returns zero jobs', () => {
  const result = MA.estimateMunicipalEmployment(sampleLEHD, 0);
  assert(result.totalJobs === 0, 'zero popShare → zero totalJobs');
});

test('estimateMunicipalEmployment: pop share > 1 is clamped to 1', () => {
  const result = MA.estimateMunicipalEmployment(sampleLEHD, 1.5);
  assert(result.totalJobs === sampleLEHD.totalJobs,
    'popShare > 1 is clamped to 1 → all county jobs');
});

test('estimateMunicipalEmployment: null LEHD handled gracefully', () => {
  const result = MA.estimateMunicipalEmployment(null, 0.20);
  assert(result.totalJobs === 0,        'null LEHD → zero totalJobs');
  assert(result.jobsByIndustry.length === 0, 'null LEHD → empty jobsByIndustry');
});

test('estimateMunicipalEmployment: LEHD without industries returns empty array', () => {
  const result = MA.estimateMunicipalEmployment({ totalJobs: 50000 }, 0.30);
  assert(result.totalJobs === Math.round(50000 * 0.30), 'total jobs still scaled');
  assert(Array.isArray(result.jobsByIndustry) && result.jobsByIndustry.length === 0,
    'jobsByIndustry is empty when industries not provided');
});

// ── 6. calculateMunicipalProp123Baseline ─────────────────────────────────────

test('calculateMunicipalProp123Baseline: scales baseline by renter share', () => {
  const countyData = { rentals60AMI: 8000, totalRenterHH: 40000 };
  const result     = MA.calculateMunicipalProp123Baseline(countyData, 8000, 25000);
  const expectedShare    = 8000 / 40000;
  const expectedBaseline = Math.round(8000 * expectedShare);
  assert(result.baseline60AMIRentals === expectedBaseline,
    'baseline = countyRentals × renterShare');
});

test('calculateMunicipalProp123Baseline: growthTarget3pct is 3% of baseline', () => {
  const countyData = { rentals60AMI: 10000, totalRenterHH: 50000 };
  const result     = MA.calculateMunicipalProp123Baseline(countyData, 5000, 15000);
  const expected   = Math.round(result.baseline60AMIRentals * 0.03);
  assert(result.growthTarget3pct === expected, 'growthTarget3pct = baseline × 0.03');
});

test('calculateMunicipalProp123Baseline: renterShare is correct', () => {
  const countyData = { rentals60AMI: 6000, totalRenterHH: 30000 };
  const result     = MA.calculateMunicipalProp123Baseline(countyData, 6000, 18000);
  assert(Math.abs(result.renterShare - (6000 / 30000)) < 0.0001,
    'renterShare = municipalRenterPop / countyTotalRenterHH');
});

test('calculateMunicipalProp123Baseline: amiShare is non-negative', () => {
  const countyData = { rentals60AMI: 5000, totalRenterHH: 25000 };
  const result     = MA.calculateMunicipalProp123Baseline(countyData, 4000, 12000);
  assert(result.amiShare >= 0, 'amiShare is non-negative');
});

test('calculateMunicipalProp123Baseline: zero county renterHH returns zero baseline', () => {
  const countyData = { rentals60AMI: 5000, totalRenterHH: 0 };
  const result     = MA.calculateMunicipalProp123Baseline(countyData, 2000, 8000);
  assert(result.baseline60AMIRentals === 0, 'zero countyRenterHH → zero baseline');
  assert(result.renterShare          === 0, 'zero countyRenterHH → zero renterShare');
});

test('calculateMunicipalProp123Baseline: returns countyRentals60AMI field', () => {
  const countyData = { rentals60AMI: 7500, totalRenterHH: 35000 };
  const result     = MA.calculateMunicipalProp123Baseline(countyData, 3500, 10000);
  assert(result.countyRentals60AMI === 7500, 'countyRentals60AMI passthrough correct');
});

test('calculateMunicipalProp123Baseline: null countyData returns zero baseline', () => {
  const result = MA.calculateMunicipalProp123Baseline(null, 2000, 8000);
  assert(result.baseline60AMIRentals === 0, 'null countyData → zero baseline');
});

test('calculateMunicipalProp123Baseline: returns all expected fields', () => {
  const countyData = { rentals60AMI: 4000, totalRenterHH: 20000 };
  const result     = MA.calculateMunicipalProp123Baseline(countyData, 2000, 6000);
  assert('baseline60AMIRentals' in result, 'baseline60AMIRentals field present');
  assert('renterShare'          in result, 'renterShare field present');
  assert('growthTarget3pct'     in result, 'growthTarget3pct field present');
  assert('amiShare'             in result, 'amiShare field present');
  assert('countyRentals60AMI'   in result, 'countyRentals60AMI field present');
});

// ── 7. getDataConfidence ─────────────────────────────────────────────────────

test('getDataConfidence: "direct" always returns DIRECT', () => {
  assert(MA.getDataConfidence('direct',       100) === 'DIRECT', 'direct/100 → DIRECT');
  assert(MA.getDataConfidence('direct',      1000) === 'DIRECT', 'direct/1000 → DIRECT');
  assert(MA.getDataConfidence('direct',     50000) === 'DIRECT', 'direct/50000 → DIRECT');
  assert(MA.getDataConfidence('DIRECT',      5000) === 'DIRECT', 'DIRECT (upper) → DIRECT');
});

test('getDataConfidence: "interpolated" + size >= 2500 returns INTERPOLATED', () => {
  assert(MA.getDataConfidence('interpolated', 2500)  === 'INTERPOLATED', 'interpolated/2500 → INTERPOLATED');
  assert(MA.getDataConfidence('interpolated', 5000)  === 'INTERPOLATED', 'interpolated/5000 → INTERPOLATED');
  assert(MA.getDataConfidence('interpolated', 25000) === 'INTERPOLATED', 'interpolated/25000 → INTERPOLATED');
});

test('getDataConfidence: "interpolated" + size < 2500 returns ESTIMATED (confidence ceiling)', () => {
  assert(MA.getDataConfidence('interpolated', 2499) === 'ESTIMATED', 'interpolated/2499 → ESTIMATED');
  assert(MA.getDataConfidence('interpolated', 1000) === 'ESTIMATED', 'interpolated/1000 → ESTIMATED');
  assert(MA.getDataConfidence('interpolated',  500) === 'ESTIMATED', 'interpolated/500 → ESTIMATED');
  assert(MA.getDataConfidence('interpolated',    0) === 'ESTIMATED', 'interpolated/0 → ESTIMATED');
});

test('getDataConfidence: "estimated" always returns ESTIMATED', () => {
  assert(MA.getDataConfidence('estimated',  100) === 'ESTIMATED', 'estimated/100 → ESTIMATED');
  assert(MA.getDataConfidence('estimated', 5000) === 'ESTIMATED', 'estimated/5000 → ESTIMATED');
});

test('getDataConfidence: "unavailable" returns UNAVAILABLE', () => {
  assert(MA.getDataConfidence('unavailable', 1000)  === 'UNAVAILABLE', 'unavailable → UNAVAILABLE');
});

test('getDataConfidence: unrecognised source returns UNAVAILABLE', () => {
  assert(MA.getDataConfidence('unknown', 5000)  === 'UNAVAILABLE', 'unknown → UNAVAILABLE');
  assert(MA.getDataConfidence('',        5000)  === 'UNAVAILABLE', 'empty string → UNAVAILABLE');
  assert(MA.getDataConfidence(null,      5000)  === 'UNAVAILABLE', 'null → UNAVAILABLE');
  assert(MA.getDataConfidence(undefined, 5000)  === 'UNAVAILABLE', 'undefined → UNAVAILABLE');
});

test('getDataConfidence: case-insensitive matching', () => {
  assert(MA.getDataConfidence('INTERPOLATED', 3000) === 'INTERPOLATED', 'INTERPOLATED (upper) → INTERPOLATED');
  assert(MA.getDataConfidence('Estimated',    1000) === 'ESTIMATED',    'Estimated (mixed) → ESTIMATED');
});

test('getDataConfidence: boundary at exactly 2500', () => {
  assert(MA.getDataConfidence('interpolated', 2500) === 'INTERPOLATED',
    'exactly 2500 is NOT downgraded (threshold is strictly < 2500)');
  assert(MA.getDataConfidence('interpolated', 2499) === 'ESTIMATED',
    '2499 IS downgraded');
});

// ── Data file validation ─────────────────────────────────────────────────────

test('data/hna/municipal/municipal-config.json: file exists and is valid JSON', () => {
  const configPath = path.join(ROOT, 'data', 'hna', 'municipal', 'municipal-config.json');
  assert(fs.existsSync(configPath), 'municipal-config.json exists');
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert(true, 'municipal-config.json is valid JSON');
  } catch (e) {
    assert(false, `municipal-config.json parse error: ${e.message}`);
    return;
  }
  assert(Array.isArray(config.municipalities),  'municipalities array present');
  assert(config.municipalities.length === 32,   'exactly 32 municipalities listed');
});

test('data/hna/municipal/municipal-config.json: all placeFips are 7-digit strings', () => {
  const config = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'data', 'hna', 'municipal', 'municipal-config.json'), 'utf8'));
  config.municipalities.forEach(m => {
    assert(typeof m.placeFips === 'string' && m.placeFips.length === 7,
      `${m.name}: placeFips "${m.placeFips}" is a 7-character string`);
    assert(/^\d{7}$/.test(m.placeFips),
      `${m.name}: placeFips "${m.placeFips}" contains only digits`);
  });
});

test('data/hna/municipal/municipal-config.json: all placeFips start with "08" (Colorado state FIPS)', () => {
  const config = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'data', 'hna', 'municipal', 'municipal-config.json'), 'utf8'));
  config.municipalities.forEach(m => {
    assert(m.placeFips.startsWith('08'),
      `${m.name}: placeFips starts with "08"`);
  });
});

test('data/hna/municipal/municipal-config.json: all countyFips are 5-digit strings (Rule 1)', () => {
  const config = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'data', 'hna', 'municipal', 'municipal-config.json'), 'utf8'));
  config.municipalities.forEach(m => {
    assert(typeof m.countyFips === 'string' && m.countyFips.length === 5,
      `${m.name}: countyFips "${m.countyFips}" is a 5-character string`);
    assert(/^\d{5}$/.test(m.countyFips),
      `${m.name}: countyFips "${m.countyFips}" contains only digits`);
  });
});

test('data/hna/municipal/municipal-config.json: all countyFips start with "08"', () => {
  const config = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'data', 'hna', 'municipal', 'municipal-config.json'), 'utf8'));
  config.municipalities.forEach(m => {
    assert(m.countyFips.startsWith('08'),
      `${m.name}: countyFips starts with "08"`);
  });
});

test('data/hna/municipal/municipal-config.json: all entries have required fields', () => {
  const config = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'data', 'hna', 'municipal', 'municipal-config.json'), 'utf8'));
  config.municipalities.forEach(m => {
    assert(typeof m.name      === 'string' && m.name.length > 0,  `${m.placeFips}: name present`);
    assert(typeof m.geoType   === 'string' && m.geoType.length > 0, `${m.name}: geoType present`);
  });
});

test('data/hna/municipal/municipal-config.json: placeFips values are unique', () => {
  const config = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'data', 'hna', 'municipal', 'municipal-config.json'), 'utf8'));
  const fipsSet = new Set(config.municipalities.map(m => m.placeFips));
  assert(fipsSet.size === config.municipalities.length,
    'all placeFips values are unique (no duplicates)');
});

test('data/hna/municipal/growth-rates.json: file exists and is valid JSON', () => {
  const grPath = path.join(ROOT, 'data', 'hna', 'municipal', 'growth-rates.json');
  assert(fs.existsSync(grPath), 'growth-rates.json exists');
  let gr;
  try {
    gr = JSON.parse(fs.readFileSync(grPath, 'utf8'));
    assert(true, 'growth-rates.json is valid JSON');
  } catch (e) {
    assert(false, `growth-rates.json parse error: ${e.message}`);
    return;
  }
  assert(typeof gr.municipalities === 'object' && gr.municipalities !== null,
    'municipalities object present');
  assert(Object.keys(gr.municipalities).length === 32,
    'growth-rates.json has 32 municipality entries');
});

test('data/hna/municipal/growth-rates.json: keys are 7-digit strings starting with "08"', () => {
  const gr = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'data', 'hna', 'municipal', 'growth-rates.json'), 'utf8'));
  Object.keys(gr.municipalities).forEach(key => {
    assert(typeof key === 'string' && key.length === 7 && /^\d{7}$/.test(key) && key.startsWith('08'),
      `key "${key}" is a valid 7-digit Colorado place FIPS`);
  });
});

test('data/hna/municipal/growth-rates.json: each entry has required rate fields', () => {
  const gr = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'data', 'hna', 'municipal', 'growth-rates.json'), 'utf8'));
  Object.entries(gr.municipalities).forEach(([fips, m]) => {
    assert(typeof m.cagr3yr       === 'number', `${fips} (${m.name}): cagr3yr is a number`);
    assert(typeof m.cagr5yr       === 'number', `${fips} (${m.name}): cagr5yr is a number`);
    assert(typeof m.cagr10yr      === 'number', `${fips} (${m.name}): cagr10yr is a number`);
    assert(typeof m.smoothedRate  === 'number', `${fips} (${m.name}): smoothedRate is a number`);
  });
});

test('data/hna/municipal/growth-rates.json: keys match municipal-config.json placeFips', () => {
  const config = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'data', 'hna', 'municipal', 'municipal-config.json'), 'utf8'));
  const gr = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'data', 'hna', 'municipal', 'growth-rates.json'), 'utf8'));
  const configFips  = new Set(config.municipalities.map(m => m.placeFips));
  const rateFips    = new Set(Object.keys(gr.municipalities));
  configFips.forEach(fips => {
    assert(rateFips.has(fips),
      `municipal-config fips ${fips} has a matching entry in growth-rates.json`);
  });
});

// ── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nSome checks failed. Review the output above for details.');
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed ✅');
}
