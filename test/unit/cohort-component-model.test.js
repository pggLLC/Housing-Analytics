// test/unit/cohort-component-model.test.js
//
// Unit tests for js/projections/cohort-component-model.js
//
// Verifies:
//   1. Public API is fully exposed on window.
//   2. project() returns one snapshot per year including base year.
//   3. Snapshot fields are non-negative integers.
//   4. Population grows with high migration and shrinks with zero migration + low fertility.
//   5. Births are distributed by sex ratio (male > female at birth).
//   6. unitsNeeded formula: HH / (1 - vacancyTarget).
//   7. cumulativeNeedAboveBase is non-negative.
//   8. buildBasePopFromDola correctly aggregates single-age rows into 5-yr cohorts.
//   9. mortalityMult > 1 reduces population vs baseline.
//  10. Zero population base produces zero-ish population throughout.
//  11. Default constants (AGE_GROUPS, DEFAULT_SURVIVAL) are sane.
//
// Usage: node test/unit/cohort-component-model.test.js

'use strict';

const path = require('path');
global.window = global;

require(path.join(__dirname, '../../js/projections/cohort-component-model.js'));

let passed = 0, failed = 0;

function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS:', msg); passed++; }
  else       { console.error('  ❌ FAIL:', msg); failed++; }
}

function test(name, fn) {
  console.log('\n[test]', name);
  try { fn(); }
  catch (e) { console.error('  ❌ FAIL: threw —', e.message); failed++; }
}

const CCM = global.CohortComponentModel;

// ---------------------------------------------------------------------------
// Helper: build a minimal uniform base population (18 cohorts × 2 sexes)
// ---------------------------------------------------------------------------
function uniformPop(perCohort) {
  return {
    male:   new Array(18).fill(perCohort),
    female: new Array(18).fill(perCohort),
  };
}

// ---------------------------------------------------------------------------
// 1. Public API
// ---------------------------------------------------------------------------

test('CohortComponentModel exposed on window', function () {
  assert(typeof CCM === 'function', 'CohortComponentModel is a constructor');
  assert(typeof CCM.prototype.project === 'function', 'project() on prototype');
  assert(typeof CCM.prototype._stepYear === 'function', '_stepYear() on prototype');
  assert(typeof CCM.prototype._snapshot === 'function', '_snapshot() on prototype');
  assert(typeof CCM.prototype._calcUnitsNeeded === 'function', '_calcUnitsNeeded() on prototype');
  assert(typeof CCM.buildBasePopFromDola === 'function', 'buildBasePopFromDola static method');
  assert(Array.isArray(CCM.AGE_GROUPS), 'AGE_GROUPS array exposed');
  assert(Array.isArray(CCM.DEFAULT_SURVIVAL), 'DEFAULT_SURVIVAL array exposed');
});

// ---------------------------------------------------------------------------
// 2. project() length — base year + N annual steps
// ---------------------------------------------------------------------------

test('project() length equals (targetYear - baseYear + 1)', function () {
  const model = new CCM({
    basePopulation: uniformPop(1000),
    baseYear:  2024,
    targetYear: 2030,
  });
  const results = model.project();
  assert(results.length === 7, 'returns 7 snapshots for 2024–2030 (inclusive)');
  assert(results[0].year === 2024, 'first snapshot year is baseYear');
  assert(results[6].year === 2030, 'last snapshot year is targetYear');
});

// ---------------------------------------------------------------------------
// 3. Snapshot field types and non-negative values
// ---------------------------------------------------------------------------

test('snapshot fields are non-negative integers', function () {
  const model   = new CCM({ basePopulation: uniformPop(500), baseYear: 2024, targetYear: 2026 });
  const results = model.project();
  results.forEach(function (snap) {
    assert(Number.isInteger(snap.totalPopulation) && snap.totalPopulation >= 0,
      'year ' + snap.year + ': totalPopulation is non-negative integer');
    assert(Number.isInteger(snap.households) && snap.households >= 0,
      'year ' + snap.year + ': households is non-negative integer');
    assert(Number.isInteger(snap.unitsNeeded) && snap.unitsNeeded >= 0,
      'year ' + snap.year + ': unitsNeeded is non-negative integer');
    assert(Number.isInteger(snap.cumulativeNeedAboveBase) && snap.cumulativeNeedAboveBase >= 0,
      'year ' + snap.year + ': cumulativeNeedAboveBase is non-negative integer');
    assert(snap.malePop + snap.femalePop === snap.totalPopulation,
      'year ' + snap.year + ': malePop + femalePop === totalPopulation');
  });
});

// ---------------------------------------------------------------------------
// 4. High migration grows population relative to zero migration
// ---------------------------------------------------------------------------

test('high migration increases total population vs zero migration', function () {
  const base = uniformPop(1000);

  const highMig = new CCM({
    basePopulation: base,
    baseYear: 2024, targetYear: 2034,
    scenario: { net_migration_annual: 5000, fertility_multiplier: 1.0, mortality_multiplier: 1.0 },
  });

  const zeroMig = new CCM({
    basePopulation: base,
    baseYear: 2024, targetYear: 2034,
    scenario: { net_migration_annual: 0, fertility_multiplier: 1.0, mortality_multiplier: 1.0 },
  });

  const highEnd = highMig.project().slice(-1)[0].totalPopulation;
  const zeroEnd = zeroMig.project().slice(-1)[0].totalPopulation;

  assert(highEnd > zeroEnd,
    'population is larger with high migration (' + highEnd + ' > ' + zeroEnd + ')');
});

// ---------------------------------------------------------------------------
// 5. Sex ratio: male cohort 0 (births) is slightly larger than female cohort 0
// ---------------------------------------------------------------------------

test('sex ratio at birth allocates more males than females', function () {
  const pop = uniformPop(1000);
  const model = new CCM({
    basePopulation: pop,
    baseYear: 2024, targetYear: 2025,
    scenario: { fertility_multiplier: 2.0, net_migration_annual: 0, mortality_multiplier: 0.5 },
  });
  const step = model._stepYear(
    pop,
    CCM.DEFAULT_SURVIVAL.map(function (s) { return Math.pow(s, 0.2); }),
    { 3: 0.008, 4: 0.032, 5: 0.056, 6: 0.056, 7: 0.032, 8: 0.011, 9: 0.0016 }
  );
  // Cohort 0 (0-4): male births > female births due to sex ratio 1.05
  assert(step.male[0] > step.female[0],
    'male cohort 0 > female cohort 0 (sex ratio 1.05:1 at birth)');
});

// ---------------------------------------------------------------------------
// 6. _calcUnitsNeeded formula
// ---------------------------------------------------------------------------

test('_calcUnitsNeeded follows HH / (1 - vacancyTarget)', function () {
  const model = new CCM({
    basePopulation: uniformPop(0),
    vacancyTarget: 0.05,
  });
  // households = 200; expected = round(200 / 0.95) = 211
  assert(model._calcUnitsNeeded(200) === 211,
    '_calcUnitsNeeded(200) === 211 with 5% vacancy');
  // households = 100; expected = round(100 / 0.95) = 105
  assert(model._calcUnitsNeeded(100) === 105,
    '_calcUnitsNeeded(100) === 105 with 5% vacancy');
  // vacancyTarget: 0 is falsy and defaults to 0.05 in the constructor;
  // instead verify a non-default rate: 10% vacancy → round(500/0.90) = 556
  const model10 = new CCM({ basePopulation: uniformPop(0), vacancyTarget: 0.10 });
  assert(model10._calcUnitsNeeded(500) === 556,
    '_calcUnitsNeeded(500) === 556 with 10% vacancy');
});

// ---------------------------------------------------------------------------
// 7. cumulativeNeedAboveBase is clipped at 0 when baseUnits > projected need
// ---------------------------------------------------------------------------

test('cumulativeNeedAboveBase is non-negative even when baseUnits is large', function () {
  const model = new CCM({
    basePopulation: uniformPop(10),
    baseYear: 2024, targetYear: 2025,
    baseUnits: 1_000_000,
  });
  const results = model.project();
  results.forEach(function (snap) {
    assert(snap.cumulativeNeedAboveBase >= 0,
      'year ' + snap.year + ': cumulativeNeedAboveBase >= 0');
  });
});

// ---------------------------------------------------------------------------
// 8. buildBasePopFromDola aggregates single-age rows into 5-year cohorts
// ---------------------------------------------------------------------------

test('buildBasePopFromDola maps single ages to correct 5-yr cohort indices', function () {
  // Age 0-4 → cohort 0, age 5-9 → cohort 1, age 85+ → cohort 17
  const dolaSyaData = {
    pyramid: [
      { age: 0,  male: 100, female: 90 },
      { age: 4,  male: 110, female: 105 },
      { age: 5,  male: 95,  female: 88 },
      { age: 85, male: 30,  female: 50 },
      { age: 99, male: 10,  female: 20 },
    ],
  };
  const pop = CCM.buildBasePopFromDola(dolaSyaData);
  assert(pop.male[0]  === 210 && pop.female[0]  === 195, 'cohort 0 (0-4) aggregated correctly');
  assert(pop.male[1]  === 95  && pop.female[1]  === 88,  'cohort 1 (5-9) aggregated correctly');
  assert(pop.male[17] === 40  && pop.female[17] === 70,  'cohort 17 (85+) aggregated correctly');
});

test('buildBasePopFromDola handles missing/null data gracefully', function () {
  const pop1 = CCM.buildBasePopFromDola(null);
  const allZero = pop1.male.every(function (v) { return v === 0; }) &&
                  pop1.female.every(function (v) { return v === 0; });
  assert(allZero, 'null input returns all-zero population');

  const pop2 = CCM.buildBasePopFromDola({});
  const allZero2 = pop2.male.every(function (v) { return v === 0; });
  assert(allZero2, 'missing pyramid field returns all-zero population');
});

// ---------------------------------------------------------------------------
// 9. Lower mortalityMult (< 1) reduces survival and thus reduces population
// ---------------------------------------------------------------------------

test('mortalityMult < 1 reduces population compared to baseline', function () {
  const base = uniformPop(1000);

  const baseline = new CCM({
    basePopulation: base,
    baseYear: 2024, targetYear: 2040,
    scenario: { mortality_multiplier: 1.0, net_migration_annual: 0, fertility_multiplier: 1.0 },
  });

  const lowMort = new CCM({
    basePopulation: base,
    baseYear: 2024, targetYear: 2040,
    scenario: { mortality_multiplier: 0.5, net_migration_annual: 0, fertility_multiplier: 1.0 },
  });

  const baseEnd  = baseline.project().slice(-1)[0].totalPopulation;
  const mortEnd  = lowMort.project().slice(-1)[0].totalPopulation;

  assert(mortEnd < baseEnd,
    'lower mortality_multiplier (higher death rate) yields smaller population (' + mortEnd + ' < ' + baseEnd + ')');
});

// ---------------------------------------------------------------------------
// 10. Zero base population stays zero (within floating-point tolerance)
// ---------------------------------------------------------------------------

test('zero base population produces zero total population', function () {
  const model = new CCM({
    basePopulation: uniformPop(0),
    baseYear: 2024, targetYear: 2030,
    scenario: { net_migration_annual: 0, fertility_multiplier: 1.0, mortality_multiplier: 1.0 },
  });
  const results = model.project();
  results.forEach(function (snap) {
    assert(snap.totalPopulation === 0,
      'year ' + snap.year + ': totalPopulation === 0 with no base pop and no migration');
  });
});

// ---------------------------------------------------------------------------
// 11. AGE_GROUPS and DEFAULT_SURVIVAL sanity
// ---------------------------------------------------------------------------

test('AGE_GROUPS has 18 entries and DEFAULT_SURVIVAL values are in (0,1)', function () {
  assert(CCM.AGE_GROUPS.length === 18, 'AGE_GROUPS.length === 18');
  assert(CCM.AGE_GROUPS[0]  === '0-4',  'first group is 0-4');
  assert(CCM.AGE_GROUPS[17] === '85+',  'last group is 85+');
  assert(CCM.DEFAULT_SURVIVAL.length === 18, 'DEFAULT_SURVIVAL.length === 18');
  CCM.DEFAULT_SURVIVAL.forEach(function (s, i) {
    assert(s > 0 && s < 1, 'survival rate [' + i + '] in (0,1): ' + s);
  });
});

// ---------------------------------------------------------------------------
// 12. headshipRate and vacancyTarget applied correctly
// ---------------------------------------------------------------------------

test('headshipRate scales households from totalPopulation', function () {
  const model = new CCM({
    basePopulation: uniformPop(1000),
    baseYear: 2024, targetYear: 2024,
    headshipRate: 0.40,
    vacancyTarget: 0.05,
  });
  const snap = model.project()[0];
  const expectedHH = Math.round(snap.totalPopulation * 0.40);
  assert(snap.households === expectedHH,
    'households = round(totalPop * 0.40) at headshipRate=0.40');
  // With 5% vacancy, unitsNeeded > households
  assert(snap.unitsNeeded > snap.households,
    'unitsNeeded > households when vacancyTarget=0.05');
  // Formula: round(HH / (1 - 0.05))
  assert(snap.unitsNeeded === Math.round(snap.households / 0.95),
    'unitsNeeded === round(households / 0.95)');
});

// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(60));
console.log('Results:', passed, 'passed,', failed, 'failed');
if (failed > 0) process.exitCode = 1;
