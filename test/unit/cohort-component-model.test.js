// test/unit/cohort-component-model.test.js
//
// Unit tests for js/projections/cohort-component-model.js on small, hand-made
// baselines whose results can be worked out by hand. The test that the model
// reproduces the State Demography Office's forecast for every county is
// test/scenario-baseline-reproduces-sdo.test.js.
//
// Verifies:
//   1. One row per year; the base year carries no flows.
//   2. With no deaths, births or migration, everyone ages a year and stays.
//   3. Deaths: population x rate x the year's scale x the deaths slider,
//      capped at everyone; the 100+ group stays in place.
//   4. Births: women 10-49 x rate x scale x the births slider, split by the
//      sex ratio at birth.
//   5. Migration adds the stored people by age, scaled by the slider; no
//      more than everyone of an age can leave, and departures a cohort cannot
//      supply come from everyone else, so the net is the one asked for.
//   6. Households: each group's rate x the scenario's people of that age;
//      with headship 'held', the base year's rates every year.
//   7. changeFromSdo is zero at 100% and the difference from 100% otherwise.
//   8. averageAnnualMigration over a window and over the whole forecast.
//   9. paramsFromSaved reads new records, converts earlier ones, holds every
//      setting to the sliders' ranges, keeps SDO's migration when none was
//      saved, and says when an earlier migrant count cannot be converted.
//
// Usage: node test/unit/cohort-component-model.test.js

'use strict';

const assert = require('node:assert/strict');
const path = require('path');
global.window = global;

require(path.join(__dirname, '../../js/projections/cohort-component-model.js'));
const M = global.CohortComponentModel;
const N = M.N_AGES;

const zeros = () => new Array(N).fill(0);
function baseline(opts) {
  const o = opts || {};
  const years = o.years || 2;
  const male = zeros();
  const female = zeros();
  (o.people || []).forEach(([age, m, f]) => { male[age] = m; female[age] = f; });
  return {
    baseYear: 2024,
    rates: {
      deathMale: o.deathMale || zeros(),
      deathFemale: o.deathFemale || zeros(),
      birthByAge: o.birthByAge || zeros(),
      sexRatioAtBirth: 1.05,
    },
    base: { male, female },
    steps: {
      deathScale: new Array(years).fill(o.kd == null ? 1 : o.kd),
      birthScale: new Array(years).fill(o.kb == null ? 1 : o.kb),
      migrationMale: new Array(years).fill(0).map(() => (o.migMale || zeros()).slice()),
      migrationFemale: new Array(years).fill(0).map(() => (o.migFemale || zeros()).slice()),
    },
    households: {
      groups: [{ label: '18-24', minAge: 18, maxAge: 24 }, { label: '25+', minAge: 25, maxAge: 100 }],
      ratesByYear: new Array(years + 1).fill(0).map(() => (o.hhRates || [0.5, 0.5]).slice()),
    },
  };
}
const close = (a, b, msg) => assert(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

// 1 and 2
{
  const b = baseline({ people: [[30, 100, 100]], years: 3 });
  const rows = M.project(b);
  assert.equal(rows.length, 4, 'base year plus one row per step');
  assert.deepEqual(rows.map((r) => r.year), [2024, 2025, 2026, 2027], 'years count up from the base year');
  assert.equal(rows[0].births, null, 'base year has no births');
  assert.equal(rows[0].migration, null, 'base year has no migration');
  rows.forEach((r) => close(r.population, 200, 'no flows: population holds'));
}

// 3. Deaths
{
  const dm = zeros(); dm[30] = 0.1;
  const df = zeros(); df[30] = 0.2; df[100] = 2; // capped at everyone
  const b = baseline({ people: [[30, 100, 100], [100, 10, 10]], deathMale: dm, deathFemale: df, kd: 0.5 });
  const r = M.project(b)[1];
  close(r.deaths, 100 * 0.05 + 100 * 0.1 + 10, 'deaths = people x rate x scale, capped at everyone');
  close(r.population, 220 - r.deaths, 'survivors age on; the 100+ group stays');
  const r2 = M.project(b, { deaths_pct: 50 })[1];
  close(r2.deaths, 100 * 0.025 + 100 * 0.05 + 10 * 0.5, 'the deaths slider scales the rate, after the year\'s scale');
}

// 4. Births
{
  const asfr = zeros(); asfr[30] = 0.1;
  const b = baseline({ people: [[30, 0, 1000]], birthByAge: asfr, kb: 2 });
  const r = M.project(b)[1];
  close(r.births, 1000 * 0.1 * 2, 'births = women x rate x scale');
  close(r.population, 1000 + 200, 'newborns join the population');
  close(M.project(b, { births_pct: 150 })[1].births, 300, 'the births slider scales births');
}

// 5. Migration
{
  const mm = zeros(); mm[25] = 40;
  const mf = zeros(); mf[31] = -10;
  const b = baseline({ people: [[30, 100, 100]], migMale: mm, migFemale: mf });
  close(M.project(b)[1].migration, 30, 'migration at 100% is the stored net by age');
  close(M.project(b, { migration_pct: 50 })[1].population, 215, 'half the migration adds half the people');
  close(M.project(b, { migration_pct: 0 })[1].population, 200, 'no migration adds no one');
}
{
  const mm = zeros(); mm[31] = -80;
  const b = baseline({ people: [[30, 100, 100]], migMale: mm });
  close(M.project(b)[1].population, 120, 'at 100% 80 of the 100 men aged 31 leave');
  const r = M.project(b, { migration_pct: 200 })[1];
  close(r.population, 40, 'at 200% the 160 departures take the 100 men there are and 60 of the women');
  close(r.migration, -160, 'so migration is the 160 asked for');
  close(M.project(b, { migration_pct: null })[1].population, 120, 'a missing setting is SDO\'s, not zero');
}
{
  // Departures at one age, arrivals at another: clipping the departures alone
  // would keep the arrivals and turn 100 more leaving into 40.
  const mm = zeros(); mm[31] = -80;
  const mf = zeros(); mf[31] = 30;
  const b = baseline({ people: [[30, 100, 100]], migMale: mm, migFemale: mf });
  const r = M.project(b, { migration_pct: 200 })[1];
  close(r.migration, -100, 'at 200% of 50 more leaving, 100 more leave');
  close(r.population, 100, 'and the population falls by 100');
  const few = baseline({ people: [[30, 10, 10]], migMale: mm });
  const gone = M.project(few)[1];
  close(gone.population, 0, 'departures above everyone there is leave no one');
  close(gone.migration, -20, 'and migration counts the 20 who left');
}

// 6. Households
{
  const b = baseline({ people: [[20, 50, 50], [40, 100, 100]], hhRates: [0.2, 0.5] });
  close(M.project(b)[0].households, 100 * 0.2 + 200 * 0.5, 'households = rate x people of that age');
  // Rates that move: 18-24 from 0.2 to 0.1, 25+ from 0.5 to 0.6. Ages 20 and
  // 40 are 21 and 41 a year on, still in their groups.
  b.households.ratesByYear[1] = [0.1, 0.6];
  close(M.project(b)[1].households, 100 * 0.1 + 200 * 0.6, 'SDO\'s rates for the year');
  const held = M.project(b, { headship: 'held' });
  close(held[0].households, M.project(b)[0].households, 'held: the base year is the same');
  close(held[1].households, 100 * 0.2 + 200 * 0.5, 'held: the base year\'s rates a year on');
  close(M.project(b, { headship: 'other' })[1].households, 100 * 0.1 + 200 * 0.6, 'anything else is SDO\'s');
  // Each row carries people and households by group, for a town's share by age.
  const row = M.project(b)[1];
  assert.deepEqual(row.groupPeople.map(Math.round), [100, 200], 'people in each group');
  close(row.groupHouseholds[0], 100 * 0.1, 'households in the first group');
  close(row.groupHouseholds[0] + row.groupHouseholds[1], row.households, 'and they add to the households');
}

// 7. changeFromSdo
{
  const mm = zeros(); mm[25] = 40;
  const b = baseline({ people: [[30, 100, 100]], migMale: mm, hhRates: [0.5, 0.5] });
  M.changeFromSdo(b, M.DEFAULT_PARAMS).forEach((c) => {
    assert.equal(c.population, 0, 'no change at 100%');
    assert.equal(c.households, 0, 'no household change at 100%');
  });
  const c = M.changeFromSdo(b, { migration_pct: 0 });
  close(c[1].population, -40, 'no migration removes the 40 SDO adds');
  close(c[1].households, -20, 'and the households they would form');
}

// 8. averageAnnualMigration
{
  const mm = zeros(); mm[25] = 40;
  const b = baseline({ migMale: mm, years: 4 });
  b.steps.migrationMale[3][25] = 0;
  close(M.averageAnnualMigration(b, 2), 40, 'average over the first two years');
  close(M.averageAnnualMigration(b), 30, 'average over the whole forecast');
  assert.equal(M.averageAnnualMigration(null), null, 'no baseline, no average');
}

// 9. paramsFromSaved
{
  assert.deepEqual(M.paramsFromSaved({ births_pct: 90, deaths_pct: 105, migration_pct: 40 }),
    { births_pct: 90, deaths_pct: 105, migration_pct: 40, migrationNote: null }, 'new records read as saved');
  const legacy = M.paramsFromSaved({ fertility_multiplier: 1.05, mortality_multiplier: 0.98, net_migration_annual: 1000 }, 500);
  assert.deepEqual([legacy.births_pct, legacy.deaths_pct, legacy.migration_pct], [105, 98, 200], 'earlier records convert');
  // Signed: where SDO expects net departures, a saved 0 or net departure is a
  // share of SDO's; a count the other way loads at the nearest setting, 0%.
  const zero = M.paramsFromSaved({ net_migration_annual: 0 }, -57);
  assert.deepEqual([zero.migration_pct, zero.migrationNote], [0, null], 'a saved 0 where SDO expects departures is 0%');
  assert.equal(M.paramsFromSaved({ net_migration_annual: -57 }, -57).migration_pct, 100, 'SDO\'s own departures are 100%');
  assert.equal(M.paramsFromSaved({ net_migration_annual: -114 }, -57).migration_pct, 200, 'twice SDO\'s departures are 200%');
  const out = M.paramsFromSaved({ net_migration_annual: 250 }, -40);
  assert.equal(out.migration_pct, 0, 'arrivals where SDO expects departures load at the nearest setting, 0%');
  assert(/250 people moving in a year/.test(out.migrationNote) && /0%/.test(out.migrationNote), 'and the note says what was saved and what loads');
  const down = M.paramsFromSaved({ net_migration_annual: -300 }, 600);
  assert.equal(down.migration_pct, 0, 'departures where SDO expects arrivals load at 0%');
  assert(/300 more people leaving than arriving/.test(down.migrationNote), 'with a note, not silently');
  const small = M.paramsFromSaved({ net_migration_annual: -50 }, 10000);
  assert.deepEqual([small.migration_pct, /0%/.test(small.migrationNote || '')], [0, true], 'a small count the other way, rounding to 0%, still carries the note');
  const flat = M.paramsFromSaved({ net_migration_annual: 100 }, 0);
  assert.equal(flat.migration_pct, 100, 'where SDO\'s average is zero there is nothing to take a share of');
  assert(flat.migrationNote, 'and the reader is told');
  const none = M.paramsFromSaved({ fertility_multiplier: 1.0, mortality_multiplier: 1.0, net_migration_annual: null }, 600);
  assert.equal(none.migration_pct, 100, 'no saved migrant count keeps SDO\'s migration, not 0%');
  assert.equal(none.migrationNote, null, 'and needs no note');
  const big = M.paramsFromSaved({ net_migration_annual: 500 }, 10);
  assert.equal(big.migration_pct, M.RANGES.migration_pct[1], 'a count far above SDO\'s is held to the slider\'s top');
  assert(/500 people moving in a year/.test(big.migrationNote), 'and the note says what was saved');
  assert.equal(M.paramsFromSaved({ migration_pct: 100, headship: 'held' }).headship, 'held', 'a saved held headship loads held');
  assert.equal(M.paramsFromSaved({ migration_pct: 100, headship: 'x' }).headship, undefined, 'and nothing else does');
  assert.equal(M.paramsFromSaved({ migration_pct: 100, town_share: 'hamilton_perry' }).town_share, 'hamilton_perry', 'a saved town share by age loads by age');
  assert.equal(M.paramsFromSaved({ migration_pct: 100, town_share: 'x' }).town_share, undefined, 'and nothing else does');
  assert.deepEqual(M.paramsFromSaved({ births_pct: 400, deaths_pct: 10, migration_pct: -5 }),
    { births_pct: 150, deaths_pct: 80, migration_pct: 0, migrationNote: null }, 'new records are held to the sliders\' ranges');
}

console.log('cohort-component-model unit: PASS');
