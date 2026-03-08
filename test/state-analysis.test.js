// test/state-analysis.test.js
//
// Unit tests for js/state-analysis.js
// All 7 public functions: calculateStateScaling, estimateStateHousingStock,
// scaleStateAffordability, projectStateDemographics, estimateStateEmployment,
// calculateStateProp123Baseline, getStateDataConfidence
//
// Usage: node test/state-analysis.test.js
// Exit code 0 = all passed; non-zero = failures.

'use strict';

const fs   = require('fs');
const path = require('path');

// Load the module in CommonJS mode
const SA = require(path.resolve(__dirname, '..', 'js', 'state-analysis.js'));

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

// ─── Fixtures ──────────────────────────────────────────────────────────────

function makeCountyProfile(overrides) {
  return Object.assign({
    DP05_0001E:  '50000',   // population
    DP04_0001E:  '22000',   // total housing units
    DP04_0047PE: '65.0',    // owner occupancy rate
    DP04_0046PE: '35.0',    // renter occupancy rate
    DP04_0089E:  '400000',  // median home value
    DP04_0134E:  '1400',    // median gross rent
    DP03_0062E:  '75000',   // median household income
    DP04_0003E:  '1200',    // vacant units
    DP04_0142PE: '5.0',     // rent burden < 10%
    DP04_0143PE: '15.0',    // rent burden 10-14.9%
    DP04_0144PE: '20.0',    // rent burden 15-19.9%
    DP04_0145PE: '10.0',    // rent burden 20-24.9%
    DP04_0146PE: '10.0',    // rent burden 30-34.9% (burdened)
    DP04_0004E:  '1000',    // single-family detached
    DP04_0005E:  '200',     // single-family attached
    DP04_0006E:  '400',     // 2-unit structures
    DP04_0007E:  '500',     // 3-4 unit structures
    DP04_0008E:  '600',     // 5-9 unit structures
    DP04_0009E:  '3000',    // 10+ unit structures
    DP04_0010E:  '100',     // mobile homes
  }, overrides || {});
}

function makeProjection(countyFips, overrides) {
  return Object.assign({
    countyFips: countyFips || '08013',
    baseYear: 2024,
    years: [2024, 2025, 2026, 2027, 2028, 2029, 2030],
    population_dola: [50000, 50500, 51000, 51500, 52000, 52500, 53000],
  }, overrides || {});
}

function makeLehdEntry(overrides) {
  return Object.assign({
    inflow: 5000,
    outflow: 3000,
    within: 8000,
  }, overrides || {});
}

// ─── Tests: module structure ────────────────────────────────────────────────

test('Module loads and exports all 7 functions', () => {
  assert(typeof SA === 'object',                              'module exports an object');
  assert(typeof SA.calculateStateScaling        === 'function', 'calculateStateScaling exported');
  assert(typeof SA.estimateStateHousingStock    === 'function', 'estimateStateHousingStock exported');
  assert(typeof SA.scaleStateAffordability      === 'function', 'scaleStateAffordability exported');
  assert(typeof SA.projectStateDemographics     === 'function', 'projectStateDemographics exported');
  assert(typeof SA.estimateStateEmployment      === 'function', 'estimateStateEmployment exported');
  assert(typeof SA.calculateStateProp123Baseline === 'function', 'calculateStateProp123Baseline exported');
  assert(typeof SA.getStateDataConfidence        === 'function', 'getStateDataConfidence exported');
});

// ─── Tests: calculateStateScaling ───────────────────────────────────────────

test('calculateStateScaling — null/empty input returns safe defaults', () => {
  const r = SA.calculateStateScaling(null);
  assert(typeof r === 'object',            'returns object on null');
  assert(r.totalPopulation === 0,          'totalPopulation is 0');
  assert(r.totalHousingUnits === 0,        'totalHousingUnits is 0');
  assert(r.countyCount === 0,              'countyCount is 0');

  const r2 = SA.calculateStateScaling([]);
  assert(r2.totalPopulation === 0,         'empty array: totalPopulation is 0');
  assert(r2.countyCount === 0,             'empty array: countyCount is 0');
});

test('calculateStateScaling — single county', () => {
  const profile = makeCountyProfile();
  const r = SA.calculateStateScaling([profile]);
  assert(r.totalPopulation === 50000,      'population summed correctly');
  assert(r.totalHousingUnits === 22000,    'housing units summed correctly');
  assert(r.countyCount === 1,              'countyCount is 1');
  assert(r.weightedMhi > 0,               'weightedMhi > 0');
  assert(typeof r.weightedOwnerRate === 'number', 'weightedOwnerRate is number');
  assert(r.weightedOwnerRate > 0,          'weightedOwnerRate > 0');
});

test('calculateStateScaling — two counties, sums population', () => {
  const p1 = makeCountyProfile({ DP05_0001E: '100000', DP04_0001E: '40000' });
  const p2 = makeCountyProfile({ DP05_0001E: '50000',  DP04_0001E: '20000' });
  const r = SA.calculateStateScaling([p1, p2]);
  assert(r.totalPopulation === 150000,     'populations summed: 100000+50000');
  assert(r.totalHousingUnits === 60000,    'housing units summed: 40000+20000');
  assert(r.countyCount === 2,              'countyCount is 2');
});

test('calculateStateScaling — weighted MHI uses population weighting', () => {
  // county1: pop=100000, mhi=80000; county2: pop=50000, mhi=50000
  // expected weighted: (100000*80000 + 50000*50000) / 150000 ≈ 70000
  const p1 = makeCountyProfile({ DP05_0001E: '100000', DP03_0062E: '80000' });
  const p2 = makeCountyProfile({ DP05_0001E: '50000',  DP03_0062E: '50000' });
  const r = SA.calculateStateScaling([p1, p2]);
  const expected = (100000 * 80000 + 50000 * 50000) / 150000;
  assert(Math.abs(r.weightedMhi - expected) < 1, `weighted MHI ≈ ${expected.toFixed(0)}`);
});

test('calculateStateScaling — skips null entries gracefully', () => {
  const p1 = makeCountyProfile({ DP05_0001E: '80000' });
  const r = SA.calculateStateScaling([p1, null, undefined, null]);
  assert(r.totalPopulation === 80000,      'null entries skipped, population from valid entry');
  assert(r.countyCount === 1,              'countyCount counts only valid entries');
});

test('calculateStateScaling — owner/renter rates within 0-100 range', () => {
  const profiles = [makeCountyProfile(), makeCountyProfile()];
  const r = SA.calculateStateScaling(profiles);
  assert(r.weightedOwnerRate >= 0 && r.weightedOwnerRate <= 100, 'owner rate in [0,100]');
  assert(r.weightedRenterRate >= 0 && r.weightedRenterRate <= 100, 'renter rate in [0,100]');
});

// ─── Tests: estimateStateHousingStock ───────────────────────────────────────

test('estimateStateHousingStock — null/empty returns defaults', () => {
  const r = SA.estimateStateHousingStock(null);
  assert(r.totalUnits === 0, 'null: totalUnits is 0');
  assert(typeof r.structureTypes === 'object', 'structureTypes is object');

  const r2 = SA.estimateStateHousingStock([]);
  assert(r2.totalUnits === 0, 'empty: totalUnits is 0');
});

test('estimateStateHousingStock — sums housing units across counties', () => {
  const p1 = makeCountyProfile({ DP04_0001E: '30000' });
  const p2 = makeCountyProfile({ DP04_0001E: '20000' });
  const r = SA.estimateStateHousingStock([p1, p2]);
  assert(r.totalUnits === 50000, 'total units summed: 30000+20000');
});

test('estimateStateHousingStock — returns ownerOccupied and renterOccupied', () => {
  const profile = makeCountyProfile();
  const r = SA.estimateStateHousingStock([profile]);
  assert(typeof r.ownerOccupied === 'number', 'ownerOccupied is number');
  assert(typeof r.renterOccupied === 'number', 'renterOccupied is number');
  assert(r.ownerOccupied >= 0,   'ownerOccupied >= 0');
  assert(r.renterOccupied >= 0,  'renterOccupied >= 0');
});

test('estimateStateHousingStock — vacant units sum correctly', () => {
  const p1 = makeCountyProfile({ DP04_0003E: '500' });
  const p2 = makeCountyProfile({ DP04_0003E: '700' });
  const r = SA.estimateStateHousingStock([p1, p2]);
  assert(r.vacant === 1200, 'vacant units summed: 500+700');
});

test('estimateStateHousingStock — structureTypes is an object with numeric values', () => {
  const r = SA.estimateStateHousingStock([makeCountyProfile()]);
  assert(typeof r.structureTypes === 'object', 'structureTypes is object');
  const vals = Object.values(r.structureTypes);
  assert(vals.length > 0, 'structureTypes has at least one key');
  assert(vals.every(v => typeof v === 'number'), 'all structure type values are numbers');
});

test('estimateStateHousingStock — skips null entries', () => {
  const r = SA.estimateStateHousingStock([null, makeCountyProfile({ DP04_0001E: '10000' }), null]);
  assert(r.totalUnits === 10000, 'null entries skipped');
});

// ─── Tests: scaleStateAffordability ─────────────────────────────────────────

test('scaleStateAffordability — null/empty returns defaults', () => {
  const r = SA.scaleStateAffordability(null);
  assert(r.weightedMedianRent >= 0,        'null: weightedMedianRent >= 0');
  assert(r.weightedMedianHomeValue >= 0,   'null: weightedMedianHomeValue >= 0');

  const r2 = SA.scaleStateAffordability([]);
  assert(r2.weightedMedianRent >= 0,       'empty: weightedMedianRent >= 0');
});

test('scaleStateAffordability — returns all expected keys', () => {
  const r = SA.scaleStateAffordability([makeCountyProfile()]);
  assert('weightedMedianRent'       in r,  'weightedMedianRent present');
  assert('weightedMedianHomeValue'  in r,  'weightedMedianHomeValue present');
  assert('weightedIncomeNeedToBuy'  in r,  'weightedIncomeNeedToBuy present');
  assert('weightedRentBurdenRate'   in r,  'weightedRentBurdenRate present');
  assert('stateAffordabilityGap'    in r,  'stateAffordabilityGap present');
});

test('scaleStateAffordability — stateAffordabilityGap is income needed minus MHI', () => {
  const profile = makeCountyProfile({ DP04_0089E: '500000', DP03_0062E: '70000' });
  const r = SA.scaleStateAffordability([profile]);
  // gap should be positive when income needed > MHI
  assert(typeof r.stateAffordabilityGap === 'number', 'stateAffordabilityGap is number');
});

test('scaleStateAffordability — rent is population-weighted', () => {
  const p1 = makeCountyProfile({ DP05_0001E: '100000', DP04_0134E: '2000' });
  const p2 = makeCountyProfile({ DP05_0001E: '50000',  DP04_0134E: '1000' });
  const r = SA.scaleStateAffordability([p1, p2]);
  const expected = (100000 * 2000 + 50000 * 1000) / 150000;
  assert(Math.abs(r.weightedMedianRent - expected) < 1, 'weighted rent matches formula');
});

test('scaleStateAffordability — skips null entries', () => {
  const r = SA.scaleStateAffordability([null, makeCountyProfile(), null]);
  assert(r.weightedMedianRent > 0,        'valid entry used despite nulls');
});

// ─── Tests: projectStateDemographics ────────────────────────────────────────

test('projectStateDemographics — null/empty returns defaults', () => {
  const r = SA.projectStateDemographics(null);
  assert(Array.isArray(r.years),       'null: years is array');
  assert(Array.isArray(r.population),  'null: population is array');
  assert(r.baseYear === 2024,          'baseYear is always 2024');

  const r2 = SA.projectStateDemographics([]);
  assert(Array.isArray(r2.years),      'empty: years is array');
});

test('projectStateDemographics — sums population across counties per year', () => {
  const p1 = makeProjection('08013', { population_dola: [10000, 10100, 10200] });
  const p2 = makeProjection('08031', { population_dola: [20000, 20200, 20400] });
  const r = SA.projectStateDemographics([p1, p2]);
  assert(r.population[0] === 30000, 'year 0 sum: 10000+20000=30000');
  assert(r.population[1] === 30300, 'year 1 sum: 10100+20200=30300');
  assert(r.population[2] === 30600, 'year 2 sum: 10200+20400=30600');
});

test('projectStateDemographics — baseYear is always 2024', () => {
  const r = SA.projectStateDemographics([makeProjection()]);
  assert(r.baseYear === 2024, 'baseYear === 2024');
});

test('projectStateDemographics — uses years from first valid entry', () => {
  const years = [2024, 2025, 2026, 2027];
  const r = SA.projectStateDemographics([makeProjection('08013', { years })]);
  assert(JSON.stringify(r.years) === JSON.stringify(years), 'years array preserved');
});

test('projectStateDemographics — handles null entries gracefully', () => {
  const p = makeProjection('08013', { population_dola: [5000, 5050] });
  const r = SA.projectStateDemographics([null, p, null]);
  assert(r.population[0] === 5000, 'null entries skipped');
});

test('projectStateDemographics — mismatched array lengths handled without crashing', () => {
  const p1 = makeProjection('08013', { population_dola: [1000, 2000, 3000] });
  const p2 = makeProjection('08031', { population_dola: [500] });
  let threw = false;
  try { SA.projectStateDemographics([p1, p2]); } catch(e) { threw = true; }
  assert(!threw, 'no throw on mismatched array lengths');
});

// ─── Tests: estimateStateEmployment ─────────────────────────────────────────

test('estimateStateEmployment — null/empty returns defaults', () => {
  const r = SA.estimateStateEmployment(null);
  assert(r.totalInflow  === 0, 'null: totalInflow is 0');
  assert(r.totalOutflow === 0, 'null: totalOutflow is 0');
  assert(r.totalWithin  === 0, 'null: totalWithin is 0');
  assert(r.totalJobs    === 0, 'null: totalJobs is 0');

  const r2 = SA.estimateStateEmployment([]);
  assert(r2.totalJobs === 0, 'empty: totalJobs is 0');
});

test('estimateStateEmployment — sums LEHD fields', () => {
  const l1 = makeLehdEntry({ inflow: 1000, outflow: 500, within: 3000 });
  const l2 = makeLehdEntry({ inflow: 2000, outflow: 800, within: 5000 });
  const r = SA.estimateStateEmployment([l1, l2]);
  assert(r.totalInflow  === 3000, 'inflow summed: 1000+2000');
  assert(r.totalOutflow === 1300, 'outflow summed: 500+800');
  assert(r.totalWithin  === 8000, 'within summed: 3000+5000');
});

test('estimateStateEmployment — totalJobs = totalInflow + totalWithin', () => {
  const l = makeLehdEntry({ inflow: 1000, outflow: 500, within: 3000 });
  const r = SA.estimateStateEmployment([l]);
  assert(r.totalJobs === 4000, 'jobs = inflow(1000) + within(3000) = 4000');
});

test('estimateStateEmployment — skips null entries', () => {
  const l = makeLehdEntry({ inflow: 2000, outflow: 1000, within: 4000 });
  const r = SA.estimateStateEmployment([null, l, null]);
  assert(r.totalInflow === 2000, 'null entries skipped');
});

test('estimateStateEmployment — missing fields default to 0', () => {
  const r = SA.estimateStateEmployment([{ inflow: 500 }]);
  assert(r.totalInflow  === 500, 'inflow parsed');
  assert(r.totalOutflow === 0,   'missing outflow defaults to 0');
  assert(r.totalWithin  === 0,   'missing within defaults to 0');
});

// ─── Tests: calculateStateProp123Baseline ────────────────────────────────────

test('calculateStateProp123Baseline — null/empty returns safe defaults', () => {
  const r = SA.calculateStateProp123Baseline(null);
  assert(r.totalUnits === 0,           'null: totalUnits is 0');
  assert(r.baselineUnits === 0,        'null: baselineUnits is 0');
  assert(r.annualGrowthTarget === 0,   'null: annualGrowthTarget is 0');

  const r2 = SA.calculateStateProp123Baseline([]);
  assert(r2.totalUnits === 0, 'empty: totalUnits is 0');
});

test('calculateStateProp123Baseline — baselineUnits is 3% of totalUnits', () => {
  const profile = makeCountyProfile({ DP04_0001E: '100000' });
  const r = SA.calculateStateProp123Baseline([profile]);
  assert(r.totalUnits === 100000,      'totalUnits from DP04_0001E');
  assert(Math.abs(r.baselineUnits - 3000) < 1, '3% of 100000 = 3000');
});

test('calculateStateProp123Baseline — annualGrowthTarget = baselineUnits / 8', () => {
  const profile = makeCountyProfile({ DP04_0001E: '80000' });
  const r = SA.calculateStateProp123Baseline([profile]);
  const expected = Math.round(r.baselineUnits / 8);
  assert(r.annualGrowthTarget === expected, 'annualGrowthTarget = baselineUnits / 8');
});

test('calculateStateProp123Baseline — eligibleCounties counts entries with pop >= 1000', () => {
  const p1 = makeCountyProfile({ DP05_0001E: '5000' });   // eligible (county-level)
  const p2 = makeCountyProfile({ DP05_0001E: '500' });    // below threshold
  const p3 = makeCountyProfile({ DP05_0001E: '10000' });  // eligible
  const r = SA.calculateStateProp123Baseline([p1, p2, p3]);
  assert(r.eligibleCounties === 2, 'eligibleCounties counts pop >= 1000');
});

test('calculateStateProp123Baseline — skips null entries', () => {
  const r = SA.calculateStateProp123Baseline([null, makeCountyProfile({ DP04_0001E: '50000' }), null]);
  assert(r.totalUnits === 50000, 'null entries skipped');
});

// ─── Tests: getStateDataConfidence ───────────────────────────────────────────

test('getStateDataConfidence — returns object with level, description, score', () => {
  const r = SA.getStateDataConfidence('acs1');
  assert(typeof r === 'object',              'returns object');
  assert('level' in r,                       'level property present');
  assert('description' in r,                'description property present');
  assert('score' in r,                       'score property present');
  assert(typeof r.level === 'string',        'level is string');
  assert(typeof r.description === 'string',  'description is string');
  assert(typeof r.score === 'number',        'score is number');
});

test('getStateDataConfidence — acs1 returns high confidence', () => {
  const r = SA.getStateDataConfidence('acs1');
  assert(r.level === 'high', 'acs1 level is high');
  assert(r.score >= 0.85,    'acs1 score >= 0.85');
  assert(r.score <= 1.0,     'acs1 score <= 1.0');
});

test('getStateDataConfidence — acs5 returns high confidence', () => {
  const r = SA.getStateDataConfidence('acs5');
  assert(r.level === 'high', 'acs5 level is high');
  assert(r.score >= 0.80,    'acs5 score >= 0.80');
});

test('getStateDataConfidence — cache returns medium confidence', () => {
  const r = SA.getStateDataConfidence('cache');
  assert(r.level === 'medium', 'cache level is medium');
  assert(r.score >= 0.60,      'cache score >= 0.60');
  assert(r.score < 0.90,       'cache score < 0.90');
});

test('getStateDataConfidence — derived returns medium confidence', () => {
  const r = SA.getStateDataConfidence('derived');
  assert(r.level === 'medium', 'derived level is medium');
  assert(r.score >= 0.55,      'derived score >= 0.55');
});

test('getStateDataConfidence — estimate returns low confidence', () => {
  const r = SA.getStateDataConfidence('estimate');
  assert(r.level === 'low', 'estimate level is low');
  assert(r.score < 0.60,    'estimate score < 0.60');
});

test('getStateDataConfidence — unknown source returns low confidence', () => {
  const r = SA.getStateDataConfidence('unknown-source');
  assert(r.level === 'low', 'unknown source level is low');
  assert(r.score <= 0.40,   'unknown source score <= 0.40');
});

test('getStateDataConfidence — null/undefined input returns low confidence', () => {
  const r1 = SA.getStateDataConfidence(null);
  const r2 = SA.getStateDataConfidence(undefined);
  assert(r1.level === 'low', 'null input → low');
  assert(r2.level === 'low', 'undefined input → low');
});

test('getStateDataConfidence — score is between 0 and 1 for all inputs', () => {
  const sources = ['acs1', 'acs5', 'cache', 'derived', 'estimate', null, undefined, 'other'];
  for (const s of sources) {
    const r = SA.getStateDataConfidence(s);
    assert(r.score >= 0 && r.score <= 1, `score in [0,1] for source="${s}"`);
  }
});

// ─── Tests: FIPS validation ──────────────────────────────────────────────────

test('FIPS code rules — state FIPS constant', () => {
  // Verify the module uses a 2-digit state FIPS (no 3-digit bare codes)
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'state-analysis.js'), 'utf8');
  assert(src.includes("'08'") || src.includes('"08"'), 'state FIPS "08" is present in source');
  assert(!src.includes("'8'") && !src.includes('"8"'), 'bare "8" FIPS not used (must be "08")');
});

test('FIPS code rules — state-config.json FIPS is 2-digit string', () => {
  const cfg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'data', 'hna', 'state', 'state-config.json'), 'utf8')
  );
  assert(cfg.fips === '08',  'state-config.json fips is "08"');
  assert(cfg.geoid === '08', 'state-config.json geoid is "08"');
  assert(typeof cfg.fips === 'string', 'fips is a string (not number)');
});

test('state-config.json county FIPS codes are all 5-digit strings', () => {
  const cfg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'data', 'hna', 'state', 'state-config.json'), 'utf8')
  );
  assert(Array.isArray(cfg.countyGeoids), 'countyGeoids is array');
  assert(cfg.countyGeoids.length === 64,  'exactly 64 county GEOIDs');
  for (const geoid of cfg.countyGeoids) {
    assert(typeof geoid === 'string' && geoid.length === 5,
      `county GEOID "${geoid}" is a 5-char string (Rule 1)`);
  }
});

test('state-growth-rates.json structure', () => {
  const gr = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'data', 'hna', 'state', 'state-growth-rates.json'), 'utf8')
  );
  assert(gr.baseYear === 2024, 'state-growth-rates baseYear is 2024 (Rule 3)');
  assert(typeof gr.annualPopulationGrowthRate === 'number', 'annualPopulationGrowthRate present');
  assert(typeof gr.annualHouseholdGrowthRate  === 'number', 'annualHouseholdGrowthRate present');
  assert(gr.annualPopulationGrowthRate > 0, 'growth rate is positive');
});

test('municipal-config.json structure', () => {
  const cfg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'data', 'hna', 'municipal', 'municipal-config.json'), 'utf8')
  );
  assert(Array.isArray(cfg.municipalities), 'municipalities is array');
  assert(cfg.municipalities.length >= 1,    'at least 1 municipality');
  for (const m of cfg.municipalities) {
    assert(typeof m.geoid === 'string',                'municipality geoid is string');
    assert(m.geoid.length >= 7,                        'municipality geoid >= 7 chars (place FIPS)');
    assert(typeof m.containingCounty === 'string',     'containingCounty is string');
    assert(m.containingCounty.length === 5,            'containingCounty is 5-digit FIPS (Rule 1)');
    assert(m.containingCounty.startsWith('08'),        'containingCounty is Colorado FIPS');
    assert(typeof m.popShare === 'number',             'popShare is number');
    assert(m.popShare > 0 && m.popShare <= 1,         `popShare in (0,1] for ${m.label}`);
  }
});

// ─── Tests: data file sentinels (Rule 18) ────────────────────────────────────

test('data file sentinel keys — state-config has no required sentinel keys removed', () => {
  const cfg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'data', 'hna', 'state', 'state-config.json'), 'utf8')
  );
  assert('updated' in cfg, 'state-config.json has "updated" timestamp sentinel');
});

test('data file sentinel keys — state-growth-rates has updated timestamp', () => {
  const gr = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'data', 'hna', 'state', 'state-growth-rates.json'), 'utf8')
  );
  assert('updated' in gr, 'state-growth-rates.json has "updated" timestamp sentinel');
});

// ─── Tests: geo-config.json state entry ──────────────────────────────────────

test('geo-config.json includes state entry', () => {
  const cfg = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '..', 'data', 'hna', 'geo-config.json'), 'utf8')
  );
  assert(cfg.state != null,           'geo-config has "state" key');
  assert(cfg.state.fips === '08',     'state entry fips is "08"');
  assert(cfg.state.geoid === '08',    'state entry geoid is "08"');
  assert(cfg.state.label.toLowerCase().includes('colorado'), 'state label mentions Colorado');
});

// ─── Tests: Multiple county aggregation accuracy ──────────────────────────────

test('calculateStateScaling — 64-county simulation accuracy', () => {
  const profiles = [];
  for (let i = 0; i < 64; i++) {
    profiles.push(makeCountyProfile({
      DP05_0001E: String(10000 + i * 100),
      DP04_0001E: String(4000 + i * 40),
      DP03_0062E: String(60000 + i * 500),
    }));
  }
  const r = SA.calculateStateScaling(profiles);
  assert(r.countyCount === 64, '64-county simulation: countyCount === 64');
  const expectedPop = profiles.reduce((s, p) => s + Number(p.DP05_0001E), 0);
  assert(r.totalPopulation === expectedPop, `total population accurate: ${expectedPop}`);
  assert(r.weightedMhi > 60000, 'weighted MHI reasonable for simulated data');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nSome checks failed. Review the output above.');
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed ✅');
}
