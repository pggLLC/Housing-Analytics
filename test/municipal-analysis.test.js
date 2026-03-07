// test/municipal-analysis.test.js
//
// Unit tests for js/municipal-analysis.js
//
// Because the module detects whether it is running in Node.js and exports via
// module.exports when it is, we can require() it directly without any DOM
// stub.
//
// Usage:
//   node test/municipal-analysis.test.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const path = require('path');
const fs   = require('fs');

const ROOT = path.resolve(__dirname, '..');
const MA   = require(path.join(ROOT, 'js', 'municipal-analysis.js'));

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

// ── Fixtures ──────────────────────────────────────────────────────────────

const COUNTY = {
  population:           170000,
  households:            68000,
  vacancyRate:           0.06,
  renterRate:            0.35,
  populationGrowthRate:  0.018,
  medianRent:            1100,
  medianHomeValue:       280000,
  medianHouseholdIncome: 62000,
  amiTierDistribution: {
    tier_0_30:    0.12,
    tier_30_60:   0.22,
    tier_60_80:   0.18,
    tier_80_120:  0.25,
    tier_120_plus: 0.23,
  },
  grapi_30plus:          0.30,
  renterHouseholds:      23800,
  ami60RentalFraction:   0.40,
};

const COUNTY_PROJ = {
  baseYear:   2024,
  years:      [2024, 2025, 2026, 2027, 2028, 2029, 2034, 2044],
  population: [170000, 173060, 176181, 179344, 182549, 185799, 204143, 246640],
};

const LEHD = {
  totalJobs: 85000,
  CE01:      32000,
  CE02:      30000,
  CE03:      23000,
};

// ── 1. Confidence constants ────────────────────────────────────────────────

test('CONFIDENCE constants exist with expected keys', () => {
  assert(typeof MA.CONFIDENCE === 'object',              'CONFIDENCE is an object');
  assert(typeof MA.CONFIDENCE.DIRECT === 'object',       'CONFIDENCE.DIRECT exists');
  assert(typeof MA.CONFIDENCE.INTERPOLATED === 'object', 'CONFIDENCE.INTERPOLATED exists');
  assert(typeof MA.CONFIDENCE.ESTIMATED === 'object',    'CONFIDENCE.ESTIMATED exists');
  assert(typeof MA.CONFIDENCE.UNAVAILABLE === 'object',  'CONFIDENCE.UNAVAILABLE exists');
  assert(MA.CONFIDENCE.DIRECT.score === 100,             'DIRECT score is 100');
  assert(MA.CONFIDENCE.INTERPOLATED.score === 80,        'INTERPOLATED score is 80');
  assert(MA.CONFIDENCE.ESTIMATED.score === 60,           'ESTIMATED score is 60');
  assert(MA.CONFIDENCE.UNAVAILABLE.score === 0,          'UNAVAILABLE score is 0');
});

// ── 2. calculateMunicipalScaling ─────────────────────────────────────────

test('calculateMunicipalScaling: basic share calculation', () => {
  const result = MA.calculateMunicipalScaling(COUNTY, 34000);
  assert(Math.abs(result.popShare - (34000 / 170000)) < 0.0001, 'popShare = muniPop / countyPop');
  assert(result.households > 0,       'households is positive');
  assert(result.headshipRate > 0,     'headshipRate is positive');
  assert(result.confidence !== MA.CONFIDENCE.UNAVAILABLE, 'confidence is not UNAVAILABLE');
});

test('calculateMunicipalScaling: returns UNAVAILABLE on missing inputs', () => {
  const result = MA.calculateMunicipalScaling({}, 0);
  assert(result.popShare === 0,       'popShare is 0 on bad inputs');
  assert(result.households === 0,     'households is 0 on bad inputs');
  assert(result.confidence === MA.CONFIDENCE.UNAVAILABLE, 'confidence is UNAVAILABLE');
});

test('calculateMunicipalScaling: adjusted share with growth rate', () => {
  const base = MA.calculateMunicipalScaling(COUNTY, 34000, null);
  const adj  = MA.calculateMunicipalScaling(COUNTY, 34000, 0.035);  // faster than county 1.8%
  assert(adj.adjustedShare > base.adjustedShare, 'faster growth → higher adjusted share');
});

test('calculateMunicipalScaling: headship rate ≈ county households / county population', () => {
  const result = MA.calculateMunicipalScaling(COUNTY, 34000);
  const expectedHeadship = COUNTY.households / COUNTY.population;
  assert(Math.abs(result.headshipRate - expectedHeadship) < 0.001, 'headshipRate matches county ratio');
});

test('calculateMunicipalScaling: clamps share between 0.0001 and 0.999', () => {
  const tiny = MA.calculateMunicipalScaling(COUNTY, 1);
  assert(tiny.popShare >= 0.0001, 'popShare not below 0.0001 for tiny municipality');

  const huge = MA.calculateMunicipalScaling(COUNTY, 999999999);
  assert(huge.popShare <= 0.999,  'popShare capped at 0.999 for oversized input');
});

// ── 3. estimateMunicipalHousingStock ─────────────────────────────────────

test('estimateMunicipalHousingStock: total units > households (vacancy buffer)', () => {
  const result = MA.estimateMunicipalHousingStock(COUNTY, { households: 10000 });
  assert(result.totalUnits > 10000, 'totalUnits exceeds households by vacancy buffer');
  assert(result.ownerUnits + result.renterUnits === result.totalUnits,
    'owner + renter = total units');
});

test('estimateMunicipalHousingStock: uses directHousingUnits when provided', () => {
  const result = MA.estimateMunicipalHousingStock(COUNTY, {
    households: 10000,
    directHousingUnits: 12500,
  });
  assert(result.totalUnits === 12500,  'totalUnits equals directHousingUnits');
  assert(result.confidence === MA.CONFIDENCE.DIRECT, 'confidence is DIRECT');
});

test('estimateMunicipalHousingStock: structure breakdown sums close to total', () => {
  const result = MA.estimateMunicipalHousingStock(COUNTY, { households: 10000 });
  const structureTotal = Object.values(result.structureBreakdown).reduce((a, b) => a + b, 0);
  // Allow ±5 due to rounding
  assert(Math.abs(structureTotal - result.totalUnits) <= 5, 'structure breakdown ≈ total units');
});

// ── 4. scaleMunicipalAffordability ──────────────────────────────────────

test('scaleMunicipalAffordability: tier fractions sum to 1', () => {
  const result = MA.scaleMunicipalAffordability(COUNTY, 1200, 310000);
  const sum = Object.values(result.amiTierDistribution).reduce((a, b) => a + b, 0);
  assert(Math.abs(sum - 1.0) < 0.001, 'AMI tier fractions sum to 1');
});

test('scaleMunicipalAffordability: higher rent → higher rent burden rate', () => {
  const base     = MA.scaleMunicipalAffordability(COUNTY, COUNTY.medianRent, null);
  const expensive = MA.scaleMunicipalAffordability(COUNTY, COUNTY.medianRent * 1.5, null);
  assert(expensive.rentBurdenRate > base.rentBurdenRate,
    'higher municipal rent → higher rent burden rate');
});

test('scaleMunicipalAffordability: incomeNeededToBuy is positive', () => {
  const result = MA.scaleMunicipalAffordability(COUNTY, null, null);
  assert(result.incomeNeededToBuy > 0, 'incomeNeededToBuy is positive');
});

test('scaleMunicipalAffordability: rentAdjFactor = 1 when no municipal rent', () => {
  const result = MA.scaleMunicipalAffordability(COUNTY, null, null);
  assert(result.municipalRentAdjFactor === 1.0, 'rentAdjFactor is 1.0 when no municipal data');
  assert(result.confidence === MA.CONFIDENCE.ESTIMATED, 'confidence is ESTIMATED without muni data');
});

// ── 5. projectMunicipalDemographics ─────────────────────────────────────

test('projectMunicipalDemographics: returns correct array lengths', () => {
  const result = MA.projectMunicipalDemographics(COUNTY_PROJ, 34000, 0.02);
  assert(result.years.length === COUNTY_PROJ.years.length,      'years length matches');
  assert(result.population.length === COUNTY_PROJ.years.length, 'population length matches');
  assert(result.households.length === COUNTY_PROJ.years.length, 'households length matches');
  assert(result.unitsNeeded.length === COUNTY_PROJ.years.length,'unitsNeeded length matches');
});

test('projectMunicipalDemographics: base-year population ≈ municipal input', () => {
  const result = MA.projectMunicipalDemographics(COUNTY_PROJ, 34000, 0.0);
  // At year 0 share = muni/county so projected pop = county_pop[0] * share ≈ 34000
  assert(Math.abs(result.population[0] - 34000) < 100, 'base-year population ≈ 34000');
});

test('projectMunicipalDemographics: population increases over time with positive growth', () => {
  const result = MA.projectMunicipalDemographics(COUNTY_PROJ, 34000, 0.02);
  const first  = result.population[0];
  const last   = result.population[result.population.length - 1];
  assert(last > first, 'population grows with positive relative growth rate');
});

test('projectMunicipalDemographics: returns UNAVAILABLE on missing inputs', () => {
  const result = MA.projectMunicipalDemographics(null, 0);
  assert(result.years.length === 0,      'empty years on null input');
  assert(result.confidence === MA.CONFIDENCE.UNAVAILABLE, 'confidence is UNAVAILABLE');
});

// ── 6. estimateMunicipalEmployment ──────────────────────────────────────

test('estimateMunicipalEmployment: jobs scale by population share', () => {
  const share  = 34000 / 170000;   // ~0.2
  const result = MA.estimateMunicipalEmployment(LEHD, share);
  const expected = Math.round(LEHD.totalJobs * share);
  assert(result.estimatedJobs === expected, 'estimatedJobs = totalJobs × share');
  assert(result.confidence === MA.CONFIDENCE.ESTIMATED, 'confidence is ESTIMATED (county-level source)');
});

test('estimateMunicipalEmployment: wage tiers are all non-negative', () => {
  const result = MA.estimateMunicipalEmployment(LEHD, 0.2);
  assert(result.wageTiers.low  >= 0, 'low-wage tier ≥ 0');
  assert(result.wageTiers.mid  >= 0, 'mid-wage tier ≥ 0');
  assert(result.wageTiers.high >= 0, 'high-wage tier ≥ 0');
});

test('estimateMunicipalEmployment: returns UNAVAILABLE on missing LEHD', () => {
  const result = MA.estimateMunicipalEmployment({}, 0.2);
  assert(result.estimatedJobs === 0, 'estimatedJobs = 0 on empty LEHD');
  assert(result.confidence === MA.CONFIDENCE.UNAVAILABLE, 'confidence is UNAVAILABLE');
});

// ── 7. calculateMunicipalProp123Baseline ────────────────────────────────

test('calculateMunicipalProp123Baseline: eligible at ≥1000 population', () => {
  const r1 = MA.calculateMunicipalProp123Baseline(COUNTY, 2000, 5000);
  assert(r1.eligible === true,  'eligible at pop = 5000');
  const r2 = MA.calculateMunicipalProp123Baseline(COUNTY, 300,  800);
  assert(r2.eligible === false, 'not eligible at pop = 800');
});

test('calculateMunicipalProp123Baseline: targetY1 = baseline × 1.03', () => {
  const r = MA.calculateMunicipalProp123Baseline(COUNTY, 2000, 5000);
  assert(r.targetY1 === Math.round(r.baseline60AmiRentals * 1.03),
    'targetY1 = baseline × 1.03');
});

test('calculateMunicipalProp123Baseline: targetY10 > targetY5 > targetY1', () => {
  const r = MA.calculateMunicipalProp123Baseline(COUNTY, 2000, 5000);
  assert(r.targetY10 > r.targetY5,  'targetY10 > targetY5');
  assert(r.targetY5  > r.targetY1,  'targetY5 > targetY1');
});

// ── 8. getDataConfidence ────────────────────────────────────────────────

test('getDataConfidence: direct → DIRECT regardless of size', () => {
  assert(MA.getDataConfidence('direct', 500).score === 100,   'direct confidence for pop 500');
  assert(MA.getDataConfidence('direct', 50000).score === 100, 'direct confidence for pop 50000');
});

test('getDataConfidence: interpolated for small place → ESTIMATED', () => {
  const result = MA.getDataConfidence('interpolated', 800);
  assert(result.score === 60, 'interpolated for small place downgrades to ESTIMATED');
});

test('getDataConfidence: interpolated for large place → INTERPOLATED', () => {
  const result = MA.getDataConfidence('interpolated', 10000);
  assert(result.score === 80, 'interpolated for large place keeps INTERPOLATED');
});

test('getDataConfidence: unavailable → UNAVAILABLE', () => {
  const result = MA.getDataConfidence('unavailable', 100000);
  assert(result.score === 0, 'unavailable always returns UNAVAILABLE');
});

// ── 9. buildMunicipalAnalysis ────────────────────────────────────────────

test('buildMunicipalAnalysis: returns all expected keys', () => {
  const result = MA.buildMunicipalAnalysis({
    countyData:           COUNTY,
    municipalPopulation:  34000,
    municipalGrowthRate:  0.02,
    municipalRent:        1150,
    municipalMedianValue: 295000,
    countyProjections:    COUNTY_PROJ,
    countyLEHD:           LEHD,
  });
  assert(result.scaling       !== undefined, 'result has scaling');
  assert(result.housingStock  !== undefined, 'result has housingStock');
  assert(result.affordability !== undefined, 'result has affordability');
  assert(result.projections   !== undefined, 'result has projections');
  assert(result.employment    !== undefined, 'result has employment');
  assert(result.prop123       !== undefined, 'result has prop123');
});

// ── 10. Data files exist and are valid JSON ─────────────────────────────

test('data/hna/municipal/municipal-config.json exists and is valid', () => {
  const filePath = path.join(ROOT, 'data', 'hna', 'municipal', 'municipal-config.json');
  assert(fs.existsSync(filePath), 'municipal-config.json exists');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    assert(false, `municipal-config.json is valid JSON: ${e.message}`);
    return;
  }
  assert(Array.isArray(parsed.municipalities), 'has municipalities array');
  assert(parsed.municipalities.length > 0,     'municipalities array is non-empty');
  // Verify FIPS codes are at least 7 chars (state + place code)
  parsed.municipalities.forEach(function (m) {
    assert(typeof m.geoid === 'string' && m.geoid.length === 7,
      `geoid "${m.geoid}" is a 7-character string`);
    assert(typeof m.countyFips5 === 'string' && m.countyFips5.length === 5,
      `countyFips5 "${m.countyFips5}" is a 5-character string`);
  });
});

test('data/hna/municipal/growth-rates.json exists and is valid', () => {
  const filePath = path.join(ROOT, 'data', 'hna', 'municipal', 'growth-rates.json');
  assert(fs.existsSync(filePath), 'growth-rates.json exists');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    assert(false, `growth-rates.json is valid JSON: ${e.message}`);
    return;
  }
  assert(Array.isArray(parsed.rates), 'has rates array');
  assert(parsed.rates.length > 0,     'rates array is non-empty');
});

// ── Summary ──────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nSome checks failed. Review the output above for details.');
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed ✅');
}
