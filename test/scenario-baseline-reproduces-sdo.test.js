#!/usr/bin/env node
'use strict';
// The Scenario Builder starts from the State Demography Office (SDO) forecast
// and must agree with the two things a reader can check it against:
//
//   1. SDO itself. With births, deaths and migration at 100%, the
//      cohort-component model (js/projections/cohort-component-model.js) run
//      on data/hna/scenario-baseline/<county>.json reproduces SDO's population
//      and households for every county and year.
//   2. The HNA page. At 100% the builder's 20-year homes figure, resident
//      growth and in-commuters, equals the ranking index's
//      future_units_growth_20yr and future_units_needed_20yr for every county,
//      town and CDP that has one. The page says "the same as the HNA page";
//      this is what makes it true.
//
// Expected values come from the data files, not from pinned numbers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));

global.window = global;
global.document = { getElementById: () => null, addEventListener() {}, dispatchEvent() {}, querySelector: () => null, documentElement: {} };
global.CustomEvent = function CustomEvent() {};
require(path.join(ROOT, 'js/projections/cohort-component-model.js'));
require(path.join(ROOT, 'js/projections/scenario-presets.js'));
require(path.join(ROOT, 'js/projections/scenario-builder.js'));
const M = global.CohortComponentModel;
const SB = global.ScenarioBuilder;

const index = json('data/hna/ranking-index.json');
const rows = Array.isArray(index.rankings) ? index.rankings : Object.values(index.rankings);
const countyRows = rows.filter((r) => r.type === 'county');
const data = {
  baselines: {},
  projections: {},
  ledger: json('data/hna/projections/places.json').places,
  cross: json('data/hna/cross-county-places.json').places,
};
const baselineDir = 'data/hna/scenario-baseline';
const files = fs.readdirSync(path.join(ROOT, baselineDir)).filter((f) => /^08\d{3}\.json$/.test(f));
for (const f of files) {
  const g = f.slice(0, 5);
  data.baselines[g] = json(`${baselineDir}/${f}`);
  data.projections[g] = json(`data/hna/projections/${g}.json`);
}
assert.deepEqual(Object.keys(data.baselines).sort(), countyRows.map((r) => r.geoid).sort(),
  'one baseline file for each of the index\'s counties');

// 1. The default path is SDO's, for every county and year.
let worstPop = 0;
let worstHh = 0;
for (const [g, b] of Object.entries(data.baselines)) {
  const run = M.project(b, M.DEFAULT_PARAMS);
  assert.equal(run.length, b.sdo.years.length, `${g}: one row per SDO year`);
  run.forEach((r, i) => {
    assert.equal(r.year, b.sdo.years[i], `${g}: years line up`);
    worstPop = Math.max(worstPop, Math.abs(r.population - b.sdo.population[i]));
    worstHh = Math.max(worstHh, Math.abs(r.households - b.sdo.households[i]));
  });
  M.changeFromSdo(b, M.DEFAULT_PARAMS).forEach((c) => {
    assert.equal(c.population, 0, `${g}: no change from SDO at 100%`);
    assert.equal(c.households, 0, `${g}: no household change at 100%`);
  });
}
// Migration is stored to the hundredth of a person; rounding alone moves the
// path by a few people over 26 years (build_scenario_baseline.py checks 5).
assert(worstPop <= 5, `model at 100% drifts from SDO population by ${worstPop.toFixed(2)} people`);
assert(worstHh <= 5, `model at 100% drifts from SDO households by ${worstHh.toFixed(2)}`);

// 2. The builder's 20-year figure at 100% is the HNA page's, everywhere.
const geoFor = (r) => {
  const m = r.metrics || {};
  return {
    geoid: r.geoid, name: r.name, type: r.type, containingCounty: r.containingCounty,
    population: m.population, inCommuters: m.incommuter_need_units, inCommutersHigh: m.incommuter_need_units_high,
  };
};
let checked = 0;
const mismatched = [];
for (const r of rows) {
  const m = r.metrics || {};
  const ctx = SB.contextFor(geoFor(r), data);
  if (ctx.unavailableReason) {
    assert.equal(m.future_units_growth_20yr == null, true,
      `${r.name}: the builder shows nothing (${ctx.unavailableReason}) where the HNA page has ${m.future_units_growth_20yr}`);
    continue;
  }
  if (m.future_units_growth_20yr == null) continue;
  const fig = SB.twentyYearFigure(SB.homesSeries(ctx, M.DEFAULT_PARAMS), ctx);
  checked += 1;
  if (!fig || fig.growth !== m.future_units_growth_20yr || fig.total !== m.future_units_needed_20yr) {
    mismatched.push(`${r.name}: builder ${fig && fig.growth} + ${fig && fig.inCommuters} = ${fig && fig.total}; ` +
      `index ${m.future_units_growth_20yr} → ${m.future_units_needed_20yr}`);
  }
}
assert(checked >= 500, `checked ${checked} jurisdictions against the index (expected most of 546)`);
assert.deepEqual(mismatched, [], 'builder at 100% differs from the HNA page\'s 20-year figure:\n  ' + mismatched.join('\n  '));

// 3. The two migration presets fall on either side of SDO's forecast. Which
//    side is not fixed: where the people SDO has moving in form fewer
//    households than those moving out (a college town's arriving students and
//    departing graduates), less migration means more homes, and the page says
//    so (scenario-builder.js _updateKeyNumbers).
const presets = global.ScenarioPresets.byKey;
let ordered = 0;
let reversed = 0;
for (const r of countyRows) {
  const ctx = SB.contextFor(geoFor(r), data);
  const at = (key) => SB.homesSeries(ctx, presets[key].params)[20].homesNeeded;
  const [lo, sdo, hi] = ['low_growth', 'baseline', 'high_growth'].map(at);
  if (Math.abs(hi - lo) < 1) continue;
  assert((lo - sdo) * (hi - sdo) < 0, `${r.name}: half and 1.5x the migration both land on one side of SDO: ${lo}, ${sdo}, ${hi}`);
  const mig = M.averageAnnualMigration(data.baselines[r.geoid], 20);
  if ((hi - lo) * mig < 0) reversed += 1;
  ordered += 1;
}
assert(ordered >= 60, `checked the migration presets for ${ordered} counties`);

// 4. The vacancy the status line names is the county's target vacancy, the
//    one the HNA page divides by.
for (const r of countyRows) {
  const ctx = SB.contextFor(geoFor(r), data);
  const v = data.projections[r.geoid].housing_need.target_vacancy;
  const p = Math.round(v * 1000) / 10;
  const text = (p % 1 === 0 ? p.toFixed(0) : p.toFixed(1)) + '%';
  assert(SB.describeContext(ctx).includes(text), `${r.name}: status names the county's target vacancy, ${text}`);
}

// 5. The page's preset buttons and sliders agree with the presets the model
//    runs: same labels, and every preset value is a value its slider can show.
const html = read('hna-scenario-builder.html');
for (const preset of global.ScenarioPresets.list) {
  const btn = html.match(new RegExp(`data-scenario="${preset.key}"[^>]*>\\s*<span>([^<]+)</span>\\s*<small>([^<]+)</small>`));
  assert(btn, `the page has a ${preset.key} button`);
  assert.equal(btn[1].trim(), preset.label, `${preset.key} button label matches the preset`);
  assert.equal(btn[2].trim(), preset.short, `${preset.key} button detail matches the preset`);
  for (const [key, id] of [['births_pct', 'sbBirthsPct'], ['deaths_pct', 'sbDeathsPct'], ['migration_pct', 'sbMigrationPct']]) {
    const input = html.match(new RegExp(`id="${id}"[^>]*min="(\\d+)" max="(\\d+)" step="(\\d+)" value="(\\d+)"`));
    assert(input, `the page has the ${id} slider`);
    const [min, max, step, value] = input.slice(1).map(Number);
    assert.equal(value, 100, `${id} starts at SDO's forecast`);
    assert.deepEqual([min, max], M.RANGES[key], `${id} covers the range the model reads saved scenarios within`);
    const v = preset.params[key];
    assert(v >= min && v <= max && (v - min) % step === 0, `${preset.key} sets ${key} to ${v}, which ${id} (${min}-${max} by ${step}) cannot show`);
  }
}

// 6. A scenario saved by the earlier model (multipliers and people a year)
//    reads as percentages of the loaded place's own SDO migration.
const mesaMig = M.averageAnnualMigration(data.baselines['08077'], 20);
const legacy = M.paramsFromSaved({ fertility_multiplier: 1.1, mortality_multiplier: 0.9, net_migration_annual: mesaMig / 2 }, mesaMig);
assert.deepEqual([legacy.births_pct, legacy.deaths_pct, legacy.migration_pct], [110, 90, 50], 'legacy multipliers and migrants convert');
const outflow = M.paramsFromSaved({ net_migration_annual: 500 }, -120);
assert.equal(outflow.migration_pct, 100, 'where SDO expects net departures a number of migrants is not converted');
assert(outflow.migrationNote, 'and the reader is told why');

// 7. No setting the sliders allow makes anyone a negative person: above 100%,
//    SDO's departures at an age can outnumber the people of that age.
{
  const src = read('js/projections/cohort-component-model.js');
  const probe = src.replace('pm = s.sm;', 'pm = s.sm; global.__lowest = Math.min(global.__lowest, ...s.sm, ...s.sf);');
  assert.notEqual(probe, src, 'probe applied to the model');
  const saved = global.CohortComponentModel;
  new Function('window', 'global', probe)(global, global);
  const P = global.CohortComponentModel;
  global.CohortComponentModel = saved;
  let scanned = 0;
  for (const [geoid, b] of Object.entries(data.baselines)) {
    global.__lowest = 0;
    P.project(b, { migration_pct: M.RANGES.migration_pct[1] });
    assert(global.__lowest >= 0, `${geoid}: a cohort falls below zero at ${M.RANGES.migration_pct[1]}% migration (${global.__lowest})`);
    scanned++;
  }
  assert.equal(scanned, 64, 'checked every county at the highest migration setting');
}

console.log(`scenario-baseline-reproduces-sdo: PASS (${files.length} counties within ${worstPop.toFixed(2)} people / ${worstHh.toFixed(2)} households of SDO; ` +
  `${checked} jurisdictions equal the HNA page's 20-year figure; presets bracket SDO in ${ordered} counties, ${reversed} where less migration means more homes)`);
