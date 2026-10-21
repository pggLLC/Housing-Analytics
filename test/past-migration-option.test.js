#!/usr/bin/env node
'use strict';
// The Scenario Builder's second migration choice: the ten years before SDO's
// forecast, as SDO estimated them, carried forward in place of its forecast
// migration.
//
// 1. Each county's baseline file carries those years' net migration as SDO's
//    components file has it, and the same residual by age and sex that the
//    forecast years use, averaged; a second implementation here agrees.
// 2. The model runs that migration by age every year, times the percentage.
// 3. On the page the choice says what 100% means in people for the place
//    loaded, runs the scenario on it, is undone by a preset, and is kept by a
//    saved scenario on both the builder and the HNA page's saved line.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const sum = (v) => v.reduce((a, b) => a + b, 0);

function sdoRows(rel) {
  const lines = read(rel).split(/\r?\n/);
  const head = lines.findIndex((l) => l.startsWith('id,'));
  const cols = lines[head].split(',');
  return { at: (name) => cols.indexOf(name), rows: lines.slice(head + 1).filter(Boolean).map((l) => l.split(',')) };
}

// 1. The files.
const comp = sdoRows('data/hna/source/dola_components_county.csv');
const compBy = new Map();
for (const c of comp.rows) {
  if (c[comp.at('countyfips')] === '0') continue;
  compBy.set(`08${c[comp.at('countyfips')].padStart(3, '0')}|${c[comp.at('year')]}`, {
    datatype: c[comp.at('datatype')], netmig: Number(c[comp.at('netmig')]),
    births: Number(c[comp.at('births')]), deaths: Number(c[comp.at('deaths')]),
  });
}
const dir = 'data/hna/scenario-baseline';
const files = fs.readdirSync(path.join(ROOT, dir)).filter((f) => /^08\d{3}\.json$/.test(f));
assert.equal(files.length, 64, '64 county baseline files');
const baselines = {};
for (const f of files) {
  const b = readJson(`${dir}/${f}`);
  baselines[b.geoid] = b;
  const p = b.pastMigration;
  const want = Array.from({ length: 10 }, (_, i) => b.baseYear - 9 + i);
  assert.deepEqual(p.years, want, `${b.geoid}: the ten years up to ${b.baseYear}`);
  want.forEach((y, i) => {
    const row = compBy.get(`${b.geoid}|${y}`);
    assert.equal(row.datatype, 'Estimate', `${b.geoid} ${y}: an SDO estimate, not its forecast`);
    assert.equal(p.netMigration[i], row.netmig, `${b.geoid} ${y}: SDO's estimated net migration`);
  });
  assert.equal(p.male.length, 101, `${b.geoid}: male migration by age 0-100`);
  assert.equal(p.female.length, 101, `${b.geoid}: female migration by age 0-100`);
  assert(Math.abs(sum(p.male) + sum(p.female) - sum(p.netMigration) / 10) <= 5,
    `${b.geoid}: migration by age adds up to SDO's estimated total, within 5 people a year`);
}

// The residual again, for two counties: SDO's estimated population by age next
// year, less survivors of this year's at Colorado's death rates scaled to
// SDO's deaths, and newborns at its birth rates scaled to SDO's births.
const vital = readJson('data/hna/source/colorado_vital_rates.json');
const asfr = new Array(101).fill(0);
for (const [g, rate] of Object.entries(vital.births.per_1000_women)) {
  const [lo, hi] = g.split('-').map(Number);
  for (let a = lo; a <= hi; a++) asfr[a] = rate / 1000;
}
const sya = sdoRows('data/hna/source/dola_sya_county.csv');
const check = { '08077': 'Mesa County', '08037': 'Eagle County' };
const pop = {};
for (const c of sya.rows) {
  const geoid = `08${c[sya.at('countyfips')].padStart(3, '0')}`;
  const y = Number(c[sya.at('year')]);
  if (!check[geoid] || y < 2014 || y > 2024) continue;
  const k = `${geoid}|${y}`;
  pop[k] = pop[k] || { m: new Array(101).fill(0), f: new Array(101).fill(0) };
  const a = Math.min(100, Number(c[sya.at('age')]));
  pop[k].m[a] += Number(c[sya.at('malepopulation')]);
  pop[k].f[a] += Number(c[sya.at('femalepopulation')]);
}
for (const geoid of Object.keys(check)) {
  const am = new Array(101).fill(0);
  const af = new Array(101).fill(0);
  for (let y = 2015; y <= 2024; y++) {
    const { m, f } = pop[`${geoid}|${y - 1}`];
    const next = pop[`${geoid}|${y}`];
    const row = compBy.get(`${geoid}|${y}`);
    const deathsAt = (k) => sum(m.map((v, a) => v * Math.min(1, vital.deaths.male[a] * k))) + sum(f.map((v, a) => v * Math.min(1, vital.deaths.female[a] * k)));
    let lo = 0, hi = 20;
    for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (deathsAt(mid) < row.deaths) lo = mid; else hi = mid; }
    const kd = (lo + hi) / 2;
    const kb = row.births / sum(f.map((v, a) => (a >= 10 && a <= 49 ? v * asfr[a] : 0)));
    const sm = new Array(101).fill(0);
    const sf = new Array(101).fill(0);
    for (let a = 0; a <= 100; a++) {
      const to = a < 100 ? a + 1 : a;
      sm[to] += m[a] * (1 - Math.min(1, vital.deaths.male[a] * kd));
      sf[to] += f[a] * (1 - Math.min(1, vital.deaths.female[a] * kd));
    }
    const births = sum(f.map((v, a) => (a >= 10 && a <= 49 ? v * asfr[a] : 0))) * kb;
    sm[0] += births * 1.05 / 2.05;
    sf[0] += births / 2.05;
    for (let a = 0; a <= 100; a++) {
      am[a] += (next.m[a] - sm[a]) / 10;
      af[a] += (next.f[a] - sf[a]) / 10;
    }
  }
  const p = baselines[geoid].pastMigration;
  for (let a = 0; a <= 100; a++) {
    assert(Math.abs(p.male[a] - am[a]) <= 0.02 && Math.abs(p.female[a] - af[a]) <= 0.02,
      `${check[geoid]} age ${a}: file ${p.male[a]}/${p.female[a]}, recomputed ${am[a].toFixed(2)}/${af[a].toFixed(2)}`);
  }
}

// 2. The model.
const dom = new JSDOM(`<!doctype html><body>
  <div id="sbScenarioButtons"><button class="sb-scenario-btn active" data-scenario="baseline"></button><button class="sb-scenario-btn" data-scenario="low_growth"></button></div>
  <label><input type="radio" name="sbMigrationFrom" value="sdo" checked></label>
  <label><input type="radio" name="sbMigrationFrom" value="past" disabled> <span id="sbMigrationFromPast"></span></label>
  <input type="range" id="sbMigrationPct" min="0" max="200" step="5" value="100"><span id="sbMigrationPctVal"></span>
  <input type="range" id="sbBirthsPct" min="50" max="150" step="5" value="100"><span id="sbBirthsPctVal"></span>
  <input type="range" id="sbDeathsPct" min="80" max="120" step="5" value="100"><span id="sbDeathsPctVal"></span>
  <span id="sbMigrationBasis"></span><span id="sbMigrationSdo"></span>
  <div id="sbKeyNumbers"><span id="sbKeyMigration"></span></div>
  <input id="sbScenarioName"><button id="sbSaveScenario"></button><div id="sbSavedScenarios"></div>
  <canvas id="sbProjectionChart"></canvas><table><tbody id="sbResultsBody"></tbody></table>
</body>`, { runScripts: 'outside-only', url: 'http://localhost/hna-scenario-builder.html' });
const w = dom.window;
w.Chart = class { constructor(c, cfg) { this.data = cfg.data; this.options = cfg.options; } update() {} destroy() {} };
for (const f of ['js/projections/cohort-component-model.js', 'js/projections/scenario-presets.js',
  'js/projections/scenario-storage.js', 'js/projections/scenario-builder.js']) w.eval(read(f));
const SB = w.ScenarioBuilder;
const M = w.CohortComponentModel;
const $ = (id) => w.document.getElementById(id);
const pastRadio = () => w.document.querySelector('input[name="sbMigrationFrom"][value="past"]');
const avgMigration = (rows) => sum(rows.slice(1, 21).map((r) => r.migration)) / 20;
const n = (v) => Math.round(Math.abs(v)).toLocaleString('en-US');

{
  const b = baselines['08077'];
  const profile = sum(b.pastMigration.male) + sum(b.pastMigration.female);
  assert.equal(M.pastMigration(b).annual, profile, 'the past a year is the migration by age summed');
  const run = M.project(b, { migration_from: 'past' });
  assert(run.slice(1).every((r) => Math.abs(r.migration - profile) < 1e-6), 'Mesa: every forecast year gets the past migration');
  const half = M.project(b, { migration_from: 'past', migration_pct: 50 });
  assert(half.slice(1).every((r) => Math.abs(r.migration - profile / 2) < 1e-6), 'Mesa: and the percentage scales it');
  assert(Math.abs(run[20].population - M.project(b, {})[20].population) > 1000, 'Mesa: the past and SDO\'s forecast give different populations');
  const old = JSON.parse(JSON.stringify(b));
  delete old.pastMigration;
  assert.equal(M.project(old, { migration_from: 'past' }).length, 0, 'a file without the past runs no past');
}

// Every county, both choices: each year's net migration is the one asked for.
// A small cohort can be fewer than the past's departures at its age (or SDO's
// above 100%); stopping it at zero alone kept the arrivals at other ages and
// turned Hinsdale's 5 more people leaving a year into arrivals.
for (const b of Object.values(baselines)) {
  const past = M.pastMigration(b).annual;
  const sdo = (i) => sum(b.steps.migrationMale[i]) + sum(b.steps.migrationFemale[i]);
  for (const [params, want] of [
    [{ migration_from: 'past' }, () => past],
    [{ migration_from: 'past', migration_pct: 200 }, () => 2 * past],
    [{ migration_pct: 150 }, (i) => 1.5 * sdo(i)],
    [{ migration_pct: 200 }, (i) => 2 * sdo(i)],
  ]) {
    M.project(b, params).slice(1).forEach((r, i) => {
      assert(Math.abs(r.migration - want(i)) < 0.01, `${b.name || b.geoid} ${JSON.stringify(params)} ${r.year}: migration ${r.migration.toFixed(2)}, asked ${want(i).toFixed(2)}`);
    });
  }
}
{
  const hinsdale = baselines['08053'];
  assert(M.pastMigration(hinsdale).annual < -4, 'Hinsdale: more left than arrived in 2015-2024');
  assert(M.project(hinsdale, { migration_from: 'past' }).slice(1).every((r) => r.migration < 0), 'Hinsdale: and on the past, more leave every year');
}

// 3. The page.
const projections = (geoid) => ({ [geoid]: readJson(`data/hna/projections/${geoid}.json`) });
function load(geo, data) {
  const ctx = SB.contextFor(geo, data);
  assert(!ctx.unavailableReason, `${geo.name}: loads`);
  SB.init(ctx);
  return ctx;
}
function choose(value) {
  const el = w.document.querySelector(`input[name="sbMigrationFrom"][value="${value}"]`);
  el.checked = true;
  el.dispatchEvent(new w.Event('change'));
}
const mesa = { geoid: '08077', name: 'Mesa County', type: 'county' };
const mesaData = { baselines: { '08077': baselines['08077'] }, projections: projections('08077') };

{
  load(mesa, mesaData);
  const past = M.pastMigration(baselines['08077']).annual;
  const sdo = M.averageAnnualMigration(baselines['08077'], 20);
  assert.equal(pastRadio().disabled, false, 'Mesa: the past can be chosen');
  assert.equal($('sbMigrationFromPast').textContent, '2015–2024, as SDO estimated it', 'the choice names its years');
  assert.equal($('sbMigrationSdo').textContent,
    `SDO’s forecast for Mesa County: about ${n(sdo)} more people arrive than leave each year. In 2015–2024, about ${n(past)} more people arrived than left each year.`,
    `SDO first, the past beside it: "${$('sbMigrationSdo').textContent}"`);
  choose('past');
  assert.match($('sbMigrationBasis').textContent, /^100% = the 2015–2024 average, by age, from SDO’s estimates\.$/);
  assert.equal($('sbMigrationSdo').textContent,
    `In 2015–2024, about ${n(past)} more people arrived than left each year. SDO’s forecast for Mesa County: about ${n(sdo)} more people arrive than leave each year.`);
  assert.equal($('sbMigrationPct').getAttribute('aria-label'), 'People moving in minus people moving out, as a percentage of the 2015–2024 average', 'the slider says what it scales');
  const custom = SB.getResults().custom;
  assert(Math.abs(avgMigration(custom) - past) < 1e-6, 'the scenario runs the past');
  assert.equal($('sbKeyMigration').textContent, n(past), 'and the key number says so');
  assert(Math.abs(custom[20].homesNeeded - SB.getResults().baseline[20].homesNeeded) > 100, 'with a different number of homes');
  assert.equal(w.document.querySelector('.sb-scenario-btn.active'), null, 'no preset is marked as chosen');
  console.log(`  Mesa County, past: ${$('sbMigrationBasis').textContent} ${$('sbMigrationSdo').textContent}`);

  // A preset is a share of SDO's forecast, so it goes back to SDO's.
  w.document.querySelector('[data-scenario="low_growth"]').dispatchEvent(new w.Event('click'));
  assert.equal(pastRadio().checked, false, 'a preset goes back to SDO\'s forecast');
  assert.match($('sbMigrationBasis').textContent, /^100% = SDO's forecast/);

  // Saved, it loads with the past, and the HNA page's saved line runs it.
  // The slider keeps the preset's 50%, now of the past.
  choose('past');
  assert(Math.abs(avgMigration(SB.getResults().custom) - past / 2) < 1e-6, 'the percentage carries over to the past');
  $('sbScenarioName').value = 'Past decade';
  $('sbSaveScenario').dispatchEvent(new w.Event('click'));
  const rec = w.ScenarioStorage.list().find((s) => s.name === 'Past decade');
  assert(rec, 'saved');
  assert.equal(rec.parameters.migration_from, 'past', 'the record keeps the choice');
  assert.match($('sbSavedScenarios').textContent, /Moving in \(net\) 50% of the years before SDO's forecast/, 'and the list names it');
  choose('sdo');
  w.document.querySelector(`.sb-load-btn[data-id="${rec.id}"]`).dispatchEvent(new w.Event('click'));
  assert.equal(pastRadio().checked, true, 'loading it chooses the past again');
  assert(Math.abs(avgMigration(SB.getResults().custom) - past / 2) < 1e-6, 'and runs it');
  const params = M.paramsFromSaved(rec.parameters, sdo);
  const change = M.changeFromSdo(baselines['08077'], params);
  assert(Math.abs(change[20].population - (M.project(baselines['08077'], params)[20].population - M.project(baselines['08077'], {})[20].population)) < 1e-6 &&
    Math.abs(change[20].population) > 1000, 'the HNA page\'s saved line (paramsFromSaved, changeFromSdo) runs the past too');
}

// Eagle County: more left than arrived, so the slider's direction is said.
{
  load({ geoid: '08037', name: 'Eagle County', type: 'county' }, { baselines: { '08037': baselines['08037'] }, projections: projections('08037') });
  const past = M.pastMigration(baselines['08037']).annual;
  assert(past < 0 && M.averageAnnualMigration(baselines['08037'], 20) > 0, 'Eagle: departures in the past, arrivals in SDO\'s forecast');
  assert.equal(pastRadio().checked, true, 'the choice carries to the next place');
  assert.match($('sbMigrationSdo').textContent, new RegExp(`^In 2015–2024, about ${n(past)} more people left than arrived each year, so a higher percentage means more leave\\. SDO’s forecast for Eagle County: about [\\d,]+ more people arrive than leave each year\\.$`),
    `Eagle: "${$('sbMigrationSdo').textContent}"`);
  assert(avgMigration(SB.getResults().custom) < 0, 'Eagle: the scenario has more people leaving');
  console.log(`  Eagle County, past: ${$('sbMigrationSdo').textContent}`);
}

// Fruita: its county's past at its share, said as such.
{
  const fruita = readJson('data/hna/ranking-index.json').rankings.find((r) => r.geoid === '0828745');
  const ctx = load({ geoid: '0828745', name: 'Fruita', type: 'place', containingCounty: '08077', population: fruita.metrics.population },
    Object.assign({ ledger: readJson('data/hna/projections/places.json').places, cross: {} }, mesaData));
  choose('sdo');
  const past = ctx.share * M.pastMigration(baselines['08077']).annual;
  assert(new RegExp(`In 2015–2024, at the same share of the county’s estimates, about ${n(past)} more people arrived than left each year\\.$`).test($('sbMigrationSdo').textContent),
    `Fruita: "${$('sbMigrationSdo').textContent}"`);
}

// A county file from before this build: no past to choose.
{
  const old = JSON.parse(JSON.stringify(baselines['08077']));
  delete old.pastMigration;
  choose('past');
  load(mesa, { baselines: { '08077': old }, projections: projections('08077') });
  assert.equal(pastRadio().disabled, true, 'no past on file: the choice is off');
  assert.equal(pastRadio().checked, false, 'and SDO\'s forecast is used');
  assert(SB.getResults().custom.length > 0, 'the projection still shows');
  assert(!/2015/.test($('sbMigrationSdo').textContent), 'and no past is described');
}

// The page.
const html = read('hna-scenario-builder.html');
assert(/<input type="radio" name="sbMigrationFrom" value="sdo" checked>/.test(html), 'the page offers SDO\'s forecast, chosen');
assert(/<input type="radio" name="sbMigrationFrom" value="past" disabled>/.test(html), 'and the past, off until a place loads');
assert(/<span id="sbMigrationBasis">/.test(html), 'what 100% means is written by the page');

console.log('past-migration-option: PASS (64 counties carry SDO\'s 2015-2024 migration by age, matching its totals and a second implementation; the builder runs it, says it, saves it)');
