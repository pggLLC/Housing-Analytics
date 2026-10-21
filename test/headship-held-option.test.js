#!/usr/bin/env node
'use strict';
// The Scenario Builder's second household choice: each age group's households
// per person held at the base year's, the constant headship rate method, in
// place of the way SDO's forecast moves them.
//
// 1. The model: held, every county's households in each year are the base
//    year's rates times SDO's people of each age that year (from SDO's own
//    file, a second implementation), and the base year is SDO's.
// 2. The page: the choice says what it holds for the place loaded, runs the
//    scenario on it, is heard, is undone by a preset and by Reset, and is
//    kept by a saved scenario.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

const dir = 'data/hna/scenario-baseline';
const files = fs.readdirSync(path.join(ROOT, dir)).filter((f) => /^08\d{3}\.json$/.test(f));
assert.equal(files.length, 64, '64 county baseline files');
const baselines = {};
for (const f of files) {
  const b = readJson(`${dir}/${f}`);
  baselines[b.geoid] = b;
}

// SDO's people by age group, by county and year, from its own file.
const lines = read('data/hna/source/dola_sya_county.csv').split(/\r?\n/);
const head = lines.findIndex((l) => l.startsWith('id,'));
const cols = lines[head].split(',');
const at = (name) => cols.indexOf(name);
const groups = baselines['08077'].households.groups;
const people = {};
for (const l of lines.slice(head + 1)) {
  if (!l) continue;
  const c = l.split(',');
  if (c[at('countyfips')] === '0') continue;
  const y = Number(c[at('year')]);
  if (y < 2024 || y > 2050) continue;
  const k = `08${c[at('countyfips')].padStart(3, '0')}|${y}`;
  const p = people[k] || (people[k] = new Array(groups.length).fill(0));
  const age = Math.min(100, Number(c[at('age')]));
  const g = groups.findIndex((gr) => age >= gr.minAge && age <= gr.maxAge);
  if (g >= 0) p[g] += Number(c[at('malepopulation')]) + Number(c[at('femalepopulation')]);
}

const dom = new JSDOM(`<!doctype html><body>
  <div id="sbScenarioButtons"><button class="sb-scenario-btn active" data-scenario="baseline"></button><button class="sb-scenario-btn" data-scenario="low_growth"></button></div>
  <label><input type="radio" name="sbMigrationFrom" value="sdo" checked></label>
  <label><input type="radio" name="sbMigrationFrom" value="past" disabled> <span id="sbMigrationFromPast"></span></label>
  <input type="range" id="sbMigrationPct" min="0" max="200" step="5" value="100"><span id="sbMigrationPctVal"></span>
  <input type="range" id="sbBirthsPct" min="50" max="150" step="5" value="100"><span id="sbBirthsPctVal"></span>
  <input type="range" id="sbDeathsPct" min="80" max="120" step="5" value="100"><span id="sbDeathsPctVal"></span>
  <span id="sbMigrationBasis"></span><span id="sbMigrationSdo"></span>
  <label><input type="radio" name="sbHeadship" value="sdo" checked></label>
  <label><input type="radio" name="sbHeadship" value="held"> <span id="sbHeadshipHeldLabel"></span></label>
  <p id="sbHeadshipHelp"></p>
  <div id="sbKeyNumbers"><span id="sbKeyHomesLabel"></span><span id="sbKeyHomes"></span><span id="sbKeyPopLabel"></span><span id="sbKeyPop"></span><span id="sbKeyMigration"></span></div>
  <input id="sbScenarioName"><button id="sbSaveScenario"></button><div id="sbSavedScenarios"></div>
  <button id="sbClearResults"></button>
  <canvas id="sbProjectionChart"></canvas><table><tbody id="sbResultsBody"></tbody></table>
  <div id="sbLiveRegion" aria-live="polite" aria-atomic="true"></div>
</body>`, { runScripts: 'outside-only', url: 'http://localhost/hna-scenario-builder.html' });
const w = dom.window;
w.Chart = class { constructor(c, cfg) { this.data = cfg.data; this.options = cfg.options; } update() {} destroy() {} };
for (const f of ['js/projections/cohort-component-model.js', 'js/projections/scenario-presets.js',
  'js/projections/scenario-storage.js', 'js/projections/scenario-builder.js']) w.eval(read(f));
const SB = w.ScenarioBuilder;
const M = w.CohortComponentModel;
const $ = (id) => w.document.getElementById(id);
const heldRadio = () => w.document.querySelector('input[name="sbHeadship"][value="held"]');

// 1. The model, every county. The model's people of each age follow SDO's to
// within rounding (5 people in a year), so the households do to within that
// times a rate below 1.
for (const b of Object.values(baselines)) {
  const r0 = b.households.ratesByYear[0];
  const run = M.project(b, { headship: 'held' });
  const def = M.project(b, {});
  assert.equal(run.length, def.length, `${b.name}: the same years`);
  assert.equal(run[0].households, def[0].households, `${b.name}: the base year is the same`);
  run.forEach((r, i) => {
    const p = people[`${b.geoid}|${r.year}`];
    const want = p.reduce((t, v, g) => t + v * r0[g], 0);
    assert(Math.abs(r.households - want) <= 5, `${b.name} ${r.year}: held ${r.households.toFixed(1)}, ${b.baseYear} rates x SDO's people ${want.toFixed(1)}`);
    assert(Math.abs(r.population - def[i].population) < 1e-9, `${b.name} ${r.year}: the people are the same`);
  });
}
// Douglas: SDO lowers every rate, so holding 2024's adds households; Larimer:
// SDO raises some, so holding them gives fewer.
{
  const added = (geoid, params) => {
    const rows = M.project(baselines[geoid], params);
    return rows[20].households - rows[0].households;
  };
  assert(baselines['08035'].households.ratesByYear[20].every((v, g) => v < baselines['08035'].households.ratesByYear[0][g]), 'Douglas: SDO lowers every rate');
  assert(added('08035', { headship: 'held' }) - added('08035', {}) > 20000, 'Douglas: held adds over 20,000 households by 2044');
  assert(added('08069', { headship: 'held' }) - added('08069', {}) < -5000, 'Larimer: held gives over 5,000 fewer');
}

// 2. The page.
const projections = (geoid) => ({ [geoid]: readJson(`data/hna/projections/${geoid}.json`) });
function load(geo, data) {
  const ctx = SB.contextFor(geo, data);
  assert(!ctx.unavailableReason, `${geo.name}: loads`);
  SB.init(ctx);
  return ctx;
}
function choose(value) {
  const el = w.document.querySelector(`input[name="sbHeadship"][value="${value}"]`);
  el.checked = true;
  el.dispatchEvent(new w.Event('change'));
}
const two = (v) => v.toFixed(2);
const mesa = { geoid: '08077', name: 'Mesa County', type: 'county' };
const mesaData = { baselines: { '08077': baselines['08077'] }, projections: projections('08077') };

{
  SB.init({ unavailableReason: 'Pick a place.' });
  assert.equal($('sbHeadshipHelp').textContent, '', 'no place loaded: nothing to describe');
  load(mesa, mesaData);
  const r = baselines['08077'].households.ratesByYear;
  assert.equal($('sbHeadshipHeldLabel').textContent, 'Held at 2024’s', 'the choice names its year');
  assert.equal($('sbHeadshipHelp').textContent,
    'SDO’s forecast moves households per person in each age group. Mesa County, 2024 to 2044: ' +
    `18–24 from ${two(r[0][0])} to ${two(r[20][0])}, 25–44 from ${two(r[0][1])} to ${two(r[20][1])}, ` +
    `45–64 from ${two(r[0][2])} to ${two(r[20][2])}, 65 and over from ${two(r[0][3])} to ${two(r[20][3])}.`,
    `SDO's rates, then and in 20 years: "${$('sbHeadshipHelp').textContent}"`);
  const sdoHomes = SB.getResults().custom[20].homesNeeded;
  choose('held');
  assert.equal($('sbHeadshipHelp').textContent,
    `Mesa County’s 2024 households per person stay the same every year: 18–24 ${two(r[0][0])}, 25–44 ${two(r[0][1])}, ` +
    `45–64 ${two(r[0][2])}, 65 and over ${two(r[0][3])}. SDO’s forecast moves them to ${two(r[20][0])}, ${two(r[20][1])}, ${two(r[20][2])} and ${two(r[20][3])} by 2044.`,
    `held: "${$('sbHeadshipHelp').textContent}"`);
  const custom = SB.getResults().custom;
  const baseline = SB.getResults().baseline;
  assert(custom[20].homesNeeded < sdoHomes - 1000, `Mesa: held, fewer homes (${Math.round(custom[20].homesNeeded)} against ${Math.round(sdoHomes)})`);
  assert.equal(baseline[20].homesNeeded, sdoHomes, 'SDO\'s line stays SDO\'s');
  assert(Math.abs(custom[20].population - baseline[20].population) < 1e-6, 'the people are the same');
  assert.equal(w.document.querySelector('.sb-scenario-btn.active'), null, 'no preset is marked as chosen');
  assert.equal($('sbLiveRegion').textContent, `Scenario updated. ${$('sbKeyHomesLabel').textContent}: ${$('sbKeyHomes').textContent}. ${$('sbKeyPopLabel').textContent}: ${$('sbKeyPop').textContent}.`,
    `a screen reader hears the new figures: "${$('sbLiveRegion').textContent}"`);
  console.log(`  Mesa County, held: ${$('sbHeadshipHelp').textContent}`);
  console.log(`  Homes by 2044: ${Math.round(custom[20].homesNeeded)} held, ${Math.round(sdoHomes)} on SDO's rates`);

  // A preset is SDO's forecast with one change, so it goes back to SDO's rates.
  w.document.querySelector('[data-scenario="low_growth"]').dispatchEvent(new w.Event('click'));
  assert.equal(heldRadio().checked, false, 'a preset goes back to SDO\'s rates');
  assert(/^SDO’s forecast moves/.test($('sbHeadshipHelp').textContent), 'and says so');

  // Saved, it loads held again.
  choose('held');
  $('sbScenarioName').value = 'Held rates';
  $('sbSaveScenario').dispatchEvent(new w.Event('click'));
  const rec = w.ScenarioStorage.list().find((s) => s.name === 'Held rates');
  assert(rec, 'saved');
  assert.equal(rec.parameters.headship, 'held', 'the record keeps the choice');
  assert.equal(rec.assumptions.households, "SDO's base-year households per person by age, held", 'and says it in words');
  assert.match($('sbSavedScenarios').textContent, /\| Households per person held/, 'and the list names it');
  choose('sdo');
  w.document.querySelector(`.sb-load-btn[data-id="${rec.id}"]`).dispatchEvent(new w.Event('click'));
  assert.equal(heldRadio().checked, true, 'loading it holds the rates again');
  assert.equal(M.paramsFromSaved(rec.parameters).headship, 'held', 'and the HNA page reads it the same way');

  // The choice carries to the next place; Reset goes back to SDO's. (SDO's
  // forecast first, so the saved scenario's 50% migration is not carried too.)
  w.document.querySelector('[data-scenario="baseline"]').dispatchEvent(new w.Event('click'));
  choose('held');
  load({ geoid: '08035', name: 'Douglas County', type: 'county' }, { baselines: { '08035': baselines['08035'] }, projections: projections('08035') });
  assert.equal(heldRadio().checked, true, 'the choice carries to the next place');
  assert(/^Douglas County’s 2024 households per person/.test($('sbHeadshipHelp').textContent), 'and describes it');
  assert(SB.getResults().custom[20].homesNeeded > SB.getResults().baseline[20].homesNeeded + 20000, 'Douglas: held, over 20,000 more homes');
  $('sbClearResults').dispatchEvent(new w.Event('click'));
  assert.equal(heldRadio().checked, false, 'Reset goes back to SDO\'s rates');
}

// A town takes its share of its county's households, so its county's rates
// are named.
{
  const fruita = readJson('data/hna/ranking-index.json').rankings.find((r) => r.geoid === '0828745');
  load({ geoid: '0828745', name: 'Fruita', type: 'place', containingCounty: '08077', population: fruita.metrics.population },
    Object.assign({ ledger: readJson('data/hna/projections/places.json').places, cross: {} }, mesaData));
  assert(/^SDO’s forecast moves households per person in each age group\. Mesa County, 2024 to 2044: /.test($('sbHeadshipHelp').textContent),
    `Fruita: "${$('sbHeadshipHelp').textContent}"`);
}

// A place in several counties runs each county's own rates.
{
  const cross = readJson('data/hna/cross-county-places.json').places;
  const ledger = readJson('data/hna/projections/places.json').places;
  const geoid = Object.keys(cross).find((g) => ledger[g] && ledger[g].shares && ledger[g].shares.blended != null &&
    cross[g].all_counties.length > 1 && cross[g].all_counties.every((m) => baselines[m.fips]));
  assert(geoid, 'a town in more than one county');
  const fips = cross[geoid].all_counties.map((m) => m.fips);
  const data = { ledger, cross, baselines: {}, projections: {} };
  fips.forEach((f) => { data.baselines[f] = baselines[f]; data.projections[f] = readJson(`data/hna/projections/${f}.json`); });
  load({ geoid, name: cross[geoid].name || geoid, type: 'place', containingCounty: fips[0] }, data);
  assert.equal($('sbHeadshipHelp').textContent, 'SDO’s forecast moves each county’s households per person in each age group over time.');
  choose('held');
  assert.equal($('sbHeadshipHelp').textContent, 'Each county’s 2024 households per person in each age group stay the same every year.');
  assert(SB.getResults().custom.length > 0, 'and it runs');
  choose('sdo');
}

// The page.
const html = read('hna-scenario-builder.html');
assert(/<input type="radio" name="sbHeadship" value="sdo" checked>/.test(html), 'the page offers SDO\'s rates, chosen');
assert(/<input type="radio" name="sbHeadship" value="held">/.test(html), 'and held rates');
assert(/<p class="sb-slider-help" id="sbHeadshipHelp"><\/p>/.test(html), 'what each means is written by the page');

console.log('headship-held-option: PASS (64 counties: held rates times SDO\'s people by age; the builder runs it, says it, saves it)');
