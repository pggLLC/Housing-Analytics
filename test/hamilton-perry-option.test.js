#!/usr/bin/env node
'use strict';
// The Scenario Builder's second way for a town to take its share of its
// county: a share of each age group from Hamilton-Perry projections of the
// town and the county (data/hna/place-hamilton-perry.json), in place of the
// HNA page's one share of growth for every age.
//
// 1. The file: its 2020 people are the census's, its 2030 people are 2020's
//    times the 2010-2020 ratios (worked here a second way, for Fruita), and a
//    town is left out when it grew or shrank too fast, with its counts.
// 2. The model: a "town" that is its whole county gets SDO's people and
//    households exactly, every year; a real town's shares move between the
//    file's decades in straight lines.
// 3. The page: the choice is offered to a town that has shares, says what
//    they are, runs the scenario on them, is undone by a preset and by Reset,
//    is kept by a saved scenario; a town without shares says why; a county
//    does not see it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

const hp = readJson('data/hna/place-hamilton-perry.json');
const census = readJson('data/hna/source/census_age_2010_2020.json');
const total = (y) => y.male.reduce((a, b) => a + b, 0) + y.female.reduce((a, b) => a + b, 0);
const sum = (a) => a.reduce((t, v) => t + v, 0);

// 1. The file.
assert.deepEqual(hp.years, [2020, 2030, 2040, 2050]);
assert.deepEqual(hp.groups, ['0-17', '18-24', '25-44', '45-64', '65+']);
assert.equal(Object.keys(hp.counties).length, 64, 'every county');
for (const [fips, c] of Object.entries(hp.counties)) {
  assert(Math.abs(sum(c.people[0]) - total(census.county[fips]['2020'])) < 1, `${c.name}: 2020 is the census count`);
}
const geo = readJson('data/hna/geo-config.json');
const towns = geo.places.concat(geo.cdps);
const aliases = readJson('data/hna/place-phantom-aliases.json').aliases;
const censusId = (g) => Object.keys(aliases).find((k) => aliases[k] === g && census.place[k]) || g;
for (const t of towns) {
  const p = hp.places[t.geoid];
  const out = hp.leftOut[t.geoid];
  assert(p || out, `${t.label}: in the file or left out`);
  if (p) assert(Math.abs(sum(p.people[0]) - total(census.place[censusId(t.geoid)]['2020'])) < 1, `${t.label}: 2020 is the census count`);
  if (out && out.reason === 'changed_too_much') {
    const r = out.population2020 / out.population2010;
    assert(!(r >= 2 / 3 && r <= 1.5), `${out.name}: left out at ${r.toFixed(2)} times its 2010 count`);
  }
}
assert(Object.keys(hp.places).length >= 400, `${Object.keys(hp.places).length} towns and CDPs have shares by age`);
assert.equal(hp.leftOut['0877510'].population2010, 625, 'Timnath: 625 people in 2010');
assert.equal(hp.leftOut['0877510'].population2020, 6487, 'and 6,487 in 2020, so it is left out');

// Fruita's 2030, worked a second way: each sex's people of each five-year age
// group, from the census's 19 groups, ten years on at its 2010-2020 ratio.
{
  const five = (g) => g.slice(0, 3).concat([g[3] + g[4]], g.slice(5));
  const f = census.place['0828745'];
  let got = [0, 0, 0, 0, 0];
  const teens20 = f['2020'].male[3] + f['2020'].female[3];
  const split = teens20 / (teens20 + f['2020'].male[4] + f['2020'].female[4]);
  const w20 = five(f['2020'].female);
  const wNext = new Array(18).fill(0);
  const bySex = {};
  for (const sex of ['female', 'male']) {
    const a = five(f['2010'][sex]);
    const b = five(f['2020'][sex]);
    const next = new Array(18).fill(0);
    for (let k = 2; k < 17; k++) next[k] = b[k - 2] * (b[k] / a[k - 2]);
    next[17] = (b[15] + b[16] + b[17]) * (b[17] / (a[15] + a[16] + a[17]));
    bySex[sex] = next;
    if (sex === 'female') for (let k = 0; k < 18; k++) wNext[k] = next[k];
  }
  for (const sex of ['female', 'male']) {
    const b = five(f['2020'][sex]);
    bySex[sex][0] = b[0] / sum(w20.slice(3, 9)) * sum(wNext.slice(3, 9));
    bySex[sex][1] = b[1] / sum(w20.slice(4, 10)) * sum(wNext.slice(4, 10));
  }
  const t = bySex.male.map((v, k) => v + bySex.female[k]);
  got = [sum(t.slice(0, 3)) + t[3] * split, t[3] * (1 - split) + t[4], sum(t.slice(5, 9)), sum(t.slice(9, 13)), sum(t.slice(13))];
  hp.places['0828745'].people[1].forEach((v, g) => assert(Math.abs(v - got[g]) < 0.2, `Fruita 2030 ${hp.groups[g]}: file ${v}, worked ${got[g].toFixed(1)}`));
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
  <label><input type="radio" name="sbHeadship" value="sdo" checked></label>
  <label><input type="radio" name="sbHeadship" value="held"> <span id="sbHeadshipHeldLabel"></span></label>
  <p id="sbHeadshipHelp"></p>
  <div id="sbTownShareGroup" hidden>
    <label><input type="radio" name="sbTownShare" value="hna" checked></label>
    <label><input type="radio" name="sbTownShare" value="hamilton_perry" disabled></label>
    <p id="sbTownShareHelp"></p>
  </div>
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
const hpRadio = () => w.document.querySelector('input[name="sbTownShare"][value="hamilton_perry"]');
const baseline = (fips) => readJson(`data/hna/scenario-baseline/${fips}.json`);

// A town that is its whole county takes all of every group: SDO's people and
// households, every year, with any setting the model is held to.
for (const fips of ['08077', '08031', '08053']) {
  const b = baseline(fips);
  const whole = { years: hp.years, counties: { [fips]: hp.counties[fips] }, places: { whole: hp.counties[fips] } };
  const shareAt = M.townShares(whole, 'whole', [fips]);
  assert(shareAt(2031).every((s) => Math.abs(s - 1) < 1e-12), `${b.name}: its whole self, all of every group`);
  const rows = M.townProjection([b], {}, shareAt);
  rows.forEach((r, i) => {
    assert(Math.abs(r.population - b.sdo.population[i]) < 1e-6, `${b.name} ${r.year}: SDO's people`);
    assert(Math.abs(r.households[0] - b.sdo.households[i]) < 1e-6, `${b.name} ${r.year}: SDO's households`);
  });
  const run = M.project(b, { migration_pct: 50 });
  const def = M.project(b, {});
  M.townProjection([b], { migration_pct: 50 }, shareAt).forEach((r, i) => {
    const want = run[i].population - def[i].population + b.sdo.population[i];
    assert(Math.abs(r.population - want) < 1e-6, `${b.name} ${r.year}: half the migration, SDO's people plus the change`);
  });
}
// Fruita's shares: the file's at 2020 and 2030, the straight line between.
{
  const shareAt = M.townShares(hp, '0828745', ['08077']);
  const at = (t) => hp.places['0828745'].people[t].map((v, g) => v / hp.counties['08077'].people[t][g]);
  shareAt(2020).forEach((s, g) => assert(Math.abs(s - at(0)[g]) < 1e-12, '2020'));
  shareAt(2024).forEach((s, g) => assert(Math.abs(s - (0.6 * at(0)[g] + 0.4 * at(1)[g])) < 1e-12, '2024: four-tenths of the way to 2030'));
  shareAt(2060).forEach((s, g) => assert(Math.abs(s - at(3)[g]) < 1e-12, 'after 2050, 2050\'s'));
  assert.equal(M.townShares(hp, '0877510', ['08069']), null, 'Timnath has none');
  assert.equal(M.townShares(hp, '0828745', ['08077', '08999']), null, 'nor does a town whose county the file lacks');
}

// 3. The page.
const ranking = readJson('data/hna/ranking-index.json').rankings;
const rankRec = (geoid) => (Array.isArray(ranking) ? ranking : Object.values(ranking)).find((r) => r.geoid === geoid);
const ledger = readJson('data/hna/projections/places.json').places;
const cross = readJson('data/hna/cross-county-places.json').places;
function townData(fipsList, hamiltonPerry) {
  const d = { ledger, cross, baselines: {}, projections: {}, hamiltonPerry };
  fipsList.forEach((f) => { d.baselines[f] = baseline(f); d.projections[f] = readJson(`data/hna/projections/${f}.json`); });
  return d;
}
// A town, loaded on the counties the page would load for it.
function town(geoid, file) {
  const r = rankRec(geoid);
  const geo = { geoid, name: r.name, type: r.type, containingCounty: r.containingCounty, population: r.metrics.population };
  const fips = SB.countiesFor(geo, { ledger, cross });
  const ctx = SB.contextFor(geo, townData(fips, file === undefined ? hp : file));
  assert(!ctx.unavailableReason, `${r.name}: loads`);
  SB.init(ctx);
  return ctx;
}
function choose(value) {
  const el = w.document.querySelector(`input[name="sbTownShare"][value="${value}"]`);
  el.checked = true;
  el.dispatchEvent(new w.Event('change'));
}

{
  SB.init({ unavailableReason: 'Pick a place.' });
  assert.equal($('sbTownShareGroup').hidden, true, 'no place loaded: no choice');
  SB.init(SB.contextFor({ geoid: '08077', name: 'Mesa County', type: 'county' }, townData(['08077'], null)));
  assert.equal($('sbTownShareGroup').hidden, true, 'a county has no share to choose');

  const ctx = town('0828745');
  assert.equal($('sbTownShareGroup').hidden, false, 'Fruita: the choice is shown');
  assert.equal(hpRadio().disabled, false, 'and shares by age can be chosen');
  const pct = (v) => (Math.round(v * 1000) / 10).toFixed(1).replace(/\.0$/, '') + '%';
  const now = ctx.townShares(2024);
  const later = ctx.townShares(2044);
  const byAge = ['under 18', '18–24', '25–44', '45–64', '65 and over'].map((a, i) => `${a} ${pct(now[i])} to ${pct(later[i])}`).join(', ');
  const hnaText = `The HNA page gives ${ctx.displayName} ${pct(ctx.share)} of Mesa County’s growth at every age.`;
  assert.equal($('sbTownShareHelp').textContent,
    `${hnaText} By age, from the 2010 and 2020 Census (Hamilton-Perry), its share of the people, 2024 to 2044: ${byAge}.`,
    `Fruita: "${$('sbTownShareHelp').textContent}"`);
  const hnaHomes = SB.getResults().custom[20].homesNeeded;
  choose('hamilton_perry');
  assert.match($('sbTownShareHelp').textContent, /^By age, carrying each age group’s change from the 2010 to the 2020 Census forward \(Hamilton-Perry\)/);
  const custom = SB.getResults().custom;
  const base = SB.getResults().baseline;
  const want = SB.homesSeries(ctx, { births_pct: 100, deaths_pct: 100, migration_pct: 100, town_share: 'hamilton_perry' });
  assert(Math.abs(custom[20].homesNeeded - want[20].homesNeeded) < 1e-9, 'the scenario runs on shares by age');
  assert(Math.abs(custom[20].homesNeeded - hnaHomes) > 100, `and differs from the HNA page's share (${Math.round(custom[20].homesNeeded)} against ${Math.round(hnaHomes)})`);
  assert.equal(base[20].homesNeeded, hnaHomes, 'SDO\'s line keeps the HNA page\'s share');
  assert.equal(custom[0].population, ctx.placePop, 'the town starts from its own population');
  assert.equal(w.document.querySelector('.sb-scenario-btn.active'), null, 'no preset is marked as chosen');
  assert.equal($('sbLiveRegion').textContent, `Scenario updated. ${$('sbKeyHomesLabel').textContent}: ${$('sbKeyHomes').textContent}. ${$('sbKeyPopLabel').textContent}: ${$('sbKeyPop').textContent}.`,
    'a screen reader hears the new figures');
  console.log(`  Fruita by age: ${$('sbTownShareHelp').textContent}`);
  console.log(`  Homes by 2044: ${Math.round(custom[20].homesNeeded)} by age, ${Math.round(hnaHomes)} at the HNA page's share`);

  // Households: each county's households at its vacancy. Fruita is in one.
  const rows = M.townProjection([baseline('08077')], { town_share: 'hamilton_perry' }, ctx.townShares);
  const v = ctx.counties[0].vacancy;
  assert(Math.abs(want[20].homesNeeded - (rows[20].households[0] - rows[0].households[0]) / (1 - v)) < 1e-6, 'homes are households added at the county\'s vacancy');

  // A preset goes back to the HNA page's share.
  w.document.querySelector('[data-scenario="low_growth"]').dispatchEvent(new w.Event('click'));
  assert.equal(hpRadio().checked, false, 'a preset goes back to the HNA page\'s share');

  // Saved, it loads by age again, and says so.
  choose('hamilton_perry');
  $('sbScenarioName').value = 'By age';
  $('sbSaveScenario').dispatchEvent(new w.Event('click'));
  const rec = w.ScenarioStorage.list().find((s) => s.name === 'By age');
  assert.equal(rec.parameters.town_share, 'hamilton_perry', 'the record keeps the choice');
  assert.equal(rec.assumptions.townShare, "Town's share of the county by age, Hamilton-Perry from the 2010 and 2020 Census", 'and says it in words');
  assert.match($('sbSavedScenarios').textContent, /\| Towns by age \(Hamilton-Perry\)/, 'and the list names it');
  choose('hna');
  w.document.querySelector(`.sb-load-btn[data-id="${rec.id}"]`).dispatchEvent(new w.Event('click'));
  assert.equal(hpRadio().checked, true, 'loading it takes shares by age again');
  assert.equal(M.paramsFromSaved(rec.parameters).town_share, 'hamilton_perry', 'and the HNA page reads it the same way');

  // A county cannot use it; the next town can, and still has it chosen.
  w.document.querySelector('[data-scenario="baseline"]').dispatchEvent(new w.Event('click'));
  choose('hamilton_perry');
  SB.init(SB.contextFor({ geoid: '08077', name: 'Mesa County', type: 'county' }, townData(['08077'], null)));
  assert.equal($('sbTownShareGroup').hidden, true, 'a county hides it');
  town('0831660');
  assert.equal(hpRadio().checked, true, 'Grand Junction: still chosen');
  $('sbClearResults').dispatchEvent(new w.Event('click'));
  assert.equal(hpRadio().checked, false, 'Reset goes back to the HNA page\'s share');
}

// Towns without shares say why, and run on the HNA page's.
{
  choose('hamilton_perry');
  town('0877510');
  assert.equal(hpRadio().disabled, true, 'Timnath: shares by age cannot be chosen');
  assert.equal(hpRadio().checked, false, 'and are not in use');
  assert.match($('sbTownShareHelp').textContent,
    /Timnath \(town\) grew from 625 people in 2010 to 6,487 in 2020\. Hamilton-Perry would repeat that every ten years, so shares by age are offered only where the 2020 count was between two-thirds and one and a half times the 2010 count\.$/,
    `Timnath: "${$('sbTownShareHelp').textContent}"`);
  const newCdp = Object.keys(hp.leftOut).find((g) => hp.leftOut[g].reason === 'new_in_2020' && rankRec(g) && ledger[g]);
  if (newCdp) {
    const r = rankRec(newCdp);
    town(newCdp);
    assert.match($('sbTownShareHelp').textContent, /was first counted in the 2020 Census, so there is no 2010 count by age to carry forward\.$/, `${r.name}: says why`);
  }
  town('0828745', null);
  assert.equal(hpRadio().disabled, true, 'the file did not load: not offered');
  assert.match($('sbTownShareHelp').textContent, /The Census counts by age did not load/, 'and says so');
  town('0828745');
  assert.equal(hpRadio().checked, true, 'the choice comes back when it can be used');
  choose('hna');
}

// A town across several counties takes each county's households at its vacancy.
{
  const geoid = Object.keys(cross).find((g) => ledger[g] && ledger[g].shares && ledger[g].shares.blended != null &&
    cross[g].all_counties.length > 1 && hp.places[g] && rankRec(g));
  assert(geoid, 'a town in more than one county with shares by age');
  const fips = cross[geoid].all_counties.map((m) => m.fips);
  const ctx = town(geoid);
  assert(ctx.townShares, `${ctx.displayName}: has shares by age`);
  assert.match($('sbTownShareHelp').textContent, / counties’ growth at every age\./, 'names its counties');
  choose('hamilton_perry');
  const got = SB.getResults().custom;
  const rows = M.townProjection(fips.map(baseline), { town_share: 'hamilton_perry' }, ctx.townShares);
  const want = rows[20].households.reduce((t, h, c) => t + (h - rows[0].households[c]) / (1 - ctx.counties[c].vacancy), 0);
  assert(Math.abs(got[20].homesNeeded - want) < 1e-6, `${ctx.displayName}: each county's vacancy`);
  choose('hna');
}

const html = read('hna-scenario-builder.html');
assert(/<input type="radio" name="sbTownShare" value="hna" checked>/.test(html), 'the page offers the HNA page\'s share, chosen');
assert(/<input type="radio" name="sbTownShare" value="hamilton_perry" disabled>/.test(html), 'and shares by age, until a town has them');
assert(/cachedJSON\('data\/hna\/place-hamilton-perry\.json'\)\.catch\(/.test(html), 'a town loads without them when the file fails');

console.log(`hamilton-perry-option: PASS (${Object.keys(hp.places).length} towns and CDPs with shares by age from the 2010 and 2020 Census; the builder runs it, says it, saves it)`);
