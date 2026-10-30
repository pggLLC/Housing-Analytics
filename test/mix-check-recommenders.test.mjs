#!/usr/bin/env node
/**
 * The site's "ideal deal" recommenders all run the shared need notes and 15-year
 * pencil check (js/mix-check.js) through js/mix-check-inputs.js:
 *   - js/housing-need-projector.js   Recommended AMI Distribution (HNA)
 *   - js/hna/hna-comparison.js       Recommended AMI Unit Mix (comparison)
 *   - js/components/housing-type-need.js   per-lane pencil lines (HNA)
 *   - js/lihtc-opportunity-finder.js 15-year rent check (detail panel)
 *   - js/hna/hna-dev-context.js      pointer to the check, and the 31–80% burden
 *
 * What is held is agreement, not copy: every figure equals the data file it is
 * read from (HUD CHAS, CHFA limits, CHFA rules, HUD FMR, ZORI, the funding
 * guide), every recommender's pencil equals MixCheck run directly on the same
 * inputs, scores and presets do not move, and each page loads js/mix-check.js
 * before the code that calls it. Each section also breaks an input and shows
 * the output changes (sabotage).
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { JSDOM } = require('jsdom');
const M = require(join(ROOT, 'js/mix-check.js'));
const MI = require(join(ROOT, 'js/mix-check-inputs.js'));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const clone = (o) => JSON.parse(JSON.stringify(o));
let checks = 0;
const ok = (c, m) => { assert.ok(c, m); checks++; };

const files = {};
for (const [k, p] of Object.entries(MI.PATHS)) files[k] = json(p);
const COUNTY = '08051', PLACE = '0833640';

// ------------------------------------------------------------------ 1. inputs
{
  const rec = files.countyChas.records.find((r) => r.fips === COUNTY);
  const cty = MI.build(files, { countyFips: COUNTY }, M);
  ok(cty.chasScope === 'county', 'a county reads county CHAS');
  for (const k of ['31to50', '51to80', '81to100']) {
    const row = rec.renter_hh_by_ami[k];
    ok(cty.burden[k].households === row.total && Math.abs(cty.burden[k].pct - row.pct_cost_burdened_30 * 100) < 1e-9,
      `county ${k} burden must equal data/market/chas_co.json`);
  }
  const gap = MI.build({ ...files, countyChas: json('data/hna/chas_affordability_gap.json') }, { countyFips: COUNTY }, M);
  ok(JSON.stringify(gap.burden) === JSON.stringify(cty.burden), 'the HNA page\'s chas_affordability_gap.json must give the same burden');

  const lim = files.limits.counties.find((c) => c.fips === COUNTY);
  for (const t of MI.TIERS) ok(cty.limits[t] === lim.regular_tiers[t].max_rents['2br'], `${t}% limit must equal the CHFA 2026 two-bedroom rent`);
  ok(cty.ruralResort === lim.rural_resort, 'rural resort flag from the CHFA file');

  const fmr = files.fmr.counties.find((c) => c.fips === COUNTY).fmr.two_br;
  // Zillow drops thin counties some months (Gunnison, Ouray and Park left the
  // September 2026 file), so the range follows whatever the file holds.
  const zrow = files.zori.counties[COUNTY];
  const want = zrow ? [fmr, zrow.rent] : [fmr];
  ok(cty.rentRange.low === Math.min(...want) && cty.rentRange.high === Math.max(...want), 'rent range must be HUD FMR and ZORI, not ACS median');
  const withZ = clone(files.zori); withZ.counties[COUNTY] = { name: 'Gunnison County', rent: fmr + 400 };
  const zr = MI.build({ ...files, zori: withZ }, { countyFips: COUNTY }, M);
  ok(zr.rentRange.low === fmr && zr.rentRange.high === fmr + 400, 'a county Zillow publishes puts its rent in the range');
  const noZ = clone(withZ); delete noZ.counties[COUNTY];
  ok(COUNTY in withZ.counties && !(COUNTY in noZ.counties), 'the removal mutation applied');
  const nz = MI.build({ ...files, zori: noZ }, { countyFips: COUNTY }, M);
  ok(nz.rentRange.low === fmr && nz.rentRange.high === fmr, 'a county Zillow does not publish uses FMR alone, never a $0 Zillow rent');
  const guideName = files.guide.programs.find((p) => p.id === 'chfa-mihtc').name;
  ok(cty.mihtc && cty.mihtc.name === guideName, 'MIHTC name comes from the funding guide');

  const pl = MI.build(files, { countyFips: COUNTY, placeGeoid: PLACE, placeName: 'Gunnison (city)' }, M);
  const prow = files.placeChas.places[PLACE].renter_hh_by_ami['31to50'];
  ok(pl.chasScope === 'place' && pl.burden['31to50'].households === prow.total, 'a place reads place CHAS');
  const low = clone(files.placeChas); low.places[PLACE].low_confidence = true;
  const fb = MI.build({ ...files, placeChas: low }, { countyFips: COUNTY, placeGeoid: PLACE }, M);
  ok(fb.chasScope === 'county' && fb.burden['31to50'].households === rec.renter_hh_by_ami['31to50'].total, 'sabotage: a low-confidence place falls back to county CHAS');

  const none = MI.build(files, { countyFips: '08999' }, M);
  ok(none.burden === null && Object.keys(none.limits).length === 0 && none.rentRange === null, 'unknown county gives nulls, not zeros');
  ok(/No CHFA rent limits/.test(MI.check(M, none, {}).reason), 'unknown county: the pencil says why');
  ok(/HUD CHAS 2018-2022/.test(MI.sourceLine(cty)) && /CHFA 2026 income and rent limits/.test(MI.sourceLine(cty)), 'the source line names CHAS and the CHFA limits with their vintages');
  ok(!/data\/|\.json/.test(MI.sourceLine(pl)), 'visitor source line names datasets, not repo paths');
}
const inputs = MI.build(files, { countyFips: COUNTY }, M);
const direct = M.pencil({ limits: inputs.limits, rules: files.rules });

// ------------------------------------------------------------------ 2. projector
function dom(url) {
  const d = new JSDOM('<div id="hnpAmiContainer"></div><div id="hnaHousingTypeNeed"></div>', { runScripts: 'outside-only', url: url || 'http://127.0.0.1/hna-what-to-do.html' });
  d.window.safeFetchJSON = (p) => Promise.resolve(json(p));
  d.window.fetch = () => Promise.reject(new Error('offline in test'));
  return d;
}
{
  const d = dom();
  d.window.eval(read('js/housing-need-projector.js'));
  const P = d.window.HousingNeedProjector;
  const cd = { households: 7000, cost_burdened_pct: 55, median_household_income: 50000, vacancy_rate: 0.03 };
  const rec = P.recommendAmiMix(cd);
  ok(rec.priority === 'deeply_affordable' && rec.recommended.pct30 === 30 && rec.totalUnitsNeeded === null && P.recommendAmiMix(Object.assign({ renter_households: 2000 }, cd)).totalUnitsNeeded === 1100, 'preset choice unchanged; burdened count uses renter households only (D6)');
  const mc = P.mixCheckFor(rec, inputs, M, MI);
  ok(mc.units['30'] === 30 && mc.units['80'] === 7 && !('100' in mc.units) && mc.leftOut === 5, 'the check tests the preset\'s 30–80% shares and names the 100% slice it leaves out');
  const viaMix = M.pencil({ limits: inputs.limits, units: mc.units, rules: files.rules });
  ok(mc.result.mixSentence === M.mixSentence(viaMix), 'the projector\'s mix sentence equals MixCheck run on the same units');
  ok(/nominal 100-unit building/.test(mc.lead) && /95 tax-credit units/.test(mc.lead), 'the lead says the shares are a nominal 100 units');

  P.renderAmiRecommendation('hnpAmiContainer', cd);
  ok(!d.window.document.getElementById('hnpAmiContainerMixCheck'), 'without a county the card renders as before');
  d.window.eval(read('js/mix-check.js'));
  d.window.eval(read('js/mix-check-inputs.js'));
  let event = null;
  d.window.addEventListener('mixcheck:inputs', (e) => { event = e.detail.inputs; });
  P.renderAmiRecommendation('hnpAmiContainer', cd, { countyFips: COUNTY, placeGeoid: PLACE, placeName: 'Gunnison (city)' });
  await new Promise((r) => setTimeout(r, 50));
  const text = d.window.document.getElementById('hnpAmiContainerMixCheck').textContent;
  ok(text.includes(M.tierLine(direct.tiers[0])) && text.includes(M.assumptionsLine(direct.assumptions)), 'the card prints each tier line and CHFA\'s assumptions');
  ok(/31–50% AMI \(8\d%\) pay more than 30% of income/.test(text) || /51–80% AMI/.test(text), 'the card names renters at 31–80% AMI who pay too much');
  ok(event && event.chasScope === 'place', 'the card announces the inputs it used');
  const bars = d.window.document.querySelectorAll('.hnp-ami-bar-wrap').length;
  ok(bars === 7, 'the seven preset bars are still drawn');
}

// ------------------------------------------------------------------ 3. comparison
{
  const d = dom('http://127.0.0.1/hna-comparative-analysis.html');
  d.window.eval(read('js/mix-check.js'));
  d.window.eval(read('js/mix-check-inputs.js'));
  d.window.eval(read('js/hna/hna-comparison.js'));
  const C = d.window.HNAComparison;
  const ri = json('data/hna/ranking-index.json').rankings;
  const place = ri.find((e) => e.geoid === PLACE), county = ri.find((e) => e.geoid === COUNTY);
  const mix = C._deriveAmiMix(place);
  const mc = C._mixCheckForEntry(place, mix, files, M, MI);
  const units = {}; ['30', '50', '60'].forEach((t, i) => { if (mix.tiers[i].pct > 0) units[t] = Math.round(mix.tiers[i].pct * 10) / 10; });
  ok(JSON.stringify(units) === JSON.stringify({ '30': 100 }), 'Gunnison\'s derived mix is all 30% AMI (gaps 366 / 22 / 0)');
  ok(mc.result.mixSentence === M.mixSentence(M.pencil({ limits: mc.inputs.limits, units, rules: files.rules })), 'the comparison pencils the derived mix it shows');
  ok(mc.result.notes.some((n) => n.includes('though only ' + place.metrics.ami_gap_50pct + ' homes are counted short')), 'the 31–50% note uses this entry\'s own ≤50% shortfall');
  const noGap = clone(place); noGap.metrics.ami_gap_50pct = null;
  ok(!C._mixCheckForEntry(noGap, mix, files, M, MI).result.notes.some((n) => /though only/.test(n)), 'sabotage: an unknown ≤50% shortfall is not read as 0');
  C._setMixFiles(files);
  const html = C._buildAmiMixSection(place, county);
  ok(html.includes('Need beyond the homes-short counts') && html.includes('CHFA minimum pro forma assumptions'), 'the section carries the check for both sides');
  ok((html.match(/<details/g) || []).length === 2, 'one check per side');
}

// ------------------------------------------------------------------ 4. housing-type need lanes
{
  const d = dom();
  d.window.eval(read('js/components/housing-type-need.js'));
  const H = d.window.HousingTypeNeed;
  const chasRows = files.countyChas.records.find((r) => r.fips === COUNTY);
  const base = H.compute({ chasRows, acsProfile: {} });
  const mixCheck = { inputs, result: MI.check(M, inputs, {}) };
  const withCheck = H.compute({ chasRows, acsProfile: {}, mixCheck });
  ok(JSON.stringify(base.map((r) => [r.type, r.score])) === JSON.stringify(withCheck.map((r) => [r.type, r.score])), 'scores and order do not move');
  const lane = (t) => withCheck.find((r) => r.type === t);
  ok(JSON.stringify(lane('deeplyAffordableRental').pencilLines) === JSON.stringify([M.tierLine(direct.tiers.find((t) => t.tier === '30'))]), 'deep lane shows the 30% tier line');
  ok(JSON.stringify(lane('workforceRental').pencilLines) === JSON.stringify(['60', '70', '80'].map((x) => M.tierLine(direct.tiers.find((t) => t.tier === x)))), 'workforce lane shows the 60, 70 and 80% tier lines');
  const mid = lane('middleIncomeRental');
  ok(!mid.pencilLines && mid.laneNotes.some((n) => /not at 100–120% AMI/.test(n)), 'middle-income lane says CHAS does not measure 100–120% AMI');
  ok(mid.laneNotes.some((n) => n.includes(inputs.mihtc.name) && /up to 140%/.test(n)), 'middle-income lane names MIHTC from the funding guide, with the rural resort limit');
  const noGuide = MI.build({ ...files, guide: { programs: [] } }, { countyFips: COUNTY }, M);
  const mid2 = H.compute({ chasRows, acsProfile: {}, mixCheck: { inputs: noGuide, result: MI.check(M, noGuide, {}) } }).find((r) => r.type === 'middleIncomeRental');
  ok(!mid2.laneNotes.some((n) => /MIHTC/.test(n)) && mid2.laneNotes.some((n) => /needs its own funding/.test(n)), 'sabotage: without the guide entry the program is not named');
  const r = read('js/hna/hna-renderers.js');
  ok(/_htnMixCheckHtml\(r\)/.test(r) && /MixCheckInputs\.load\(\{ keys: \['limits', 'rules', 'guide'\] \}\)/.test(r), 'the HNA renderer prints the lane lines and loads only what it lacks');
}

// ------------------------------------------------------------------ 5. opportunity finder
{
  const d = dom('http://127.0.0.1/lihtc-opportunity-finder.html');
  d.window.eval(read('js/chfa-rent-limits.js'));
  d.window.eval(read('js/mix-check.js'));
  d.window.eval(read('js/mix-check-inputs.js'));
  d.window.eval(read('js/lihtc-opportunity-finder.js'));
  const lof = d.window.__LOF._test;
  const facts = lof.mixPencilFacts(COUNTY, { limits: files.limits, rules: files.rules, guide: files.guide });
  for (const t of direct.tiers) ok(facts.includes(M.tierLine(t).replace(/'/g, '&#39;')) || facts.includes(M.tierLine(t)), `finder shows the ${t.tier}% tier line`);
  const broken = clone(files.rules); delete broken.rules.pupa_minimum.source;
  ok(/Not available: CHFA underwriting rule not on file: pupa/.test(lof.mixPencilFacts(COUNTY, { limits: files.limits, rules: broken })), 'sabotage: an unsourced rule hides the check with its reason');
  const warn = lof.opActionWarning({ captureAdvantage: -100, type: 'place' });
  ok(!/won't pencil|to pencil/.test(warn) && /15-year rent check/.test(warn), 'the finder no longer says a deeper mix makes the deal pencil');
  const capture = lof.marketCaptureFacts({ lihtc60ami2br: 1669, fmr2br: 1437, captureAdvantage: -232, tableYear: 2026 });
  ok(/deeper units lease but carry less debt/.test(capture), 'capture facts point to the 15-year check');
  const src = read('js/lihtc-opportunity-finder.js');
  ok(/loadSoft\('data\/policy\/lihtc-underwriting-rules\.json'\),\s*\n(?:\s*\/\/[^\n]*\n)*\s*loadSoft\('data\/policy\/chfa-common-app-tables\.json'\)\s*\n\s*\]\)\.then/.test(src) && /rules: parts\[31\]/.test(src) && /_chfaLocationIndex\(parts\[32\]\)/.test(src), 'the rules file is load 31, read as parts[31]; the CHFA tables follow as parts[32]');
}

// ------------------------------------------------------------------ 6. dev-context
{
  const d = new JSDOM('<main></main>', { runScripts: 'outside-only', url: 'http://127.0.0.1/hna-what-households-can-afford.html?geoid=0833640' });
  d.window.eval(read('js/hna/hna-dev-context.js'));
  const DC = d.window.HnaDevContext;
  for (const k of ['Cost burden by AMI tier', 'Labor Market Context', 'Wage Distribution']) ok(DC.explain[k], `${k} is an EXPLAIN key`);
  const html = DC.render('Cost burden by AMI tier');
  ok(/15-year check/.test(html) && /href="hna-what-to-do\.html\?geoid=0833640"/.test(html), 'off the What to do view the pointer links to it');
  const pl = MI.build(files, { countyFips: COUNTY, placeGeoid: PLACE }, M);
  const s = DC.burdenSentence(pl);
  ok(s.includes(Math.round(pl.burden['31to50'].burdened).toLocaleString('en-US') + ' at 31–50% AMI') && /place estimate/.test(s), 'the burden sentence equals the CHAS figures');
  d.window.dispatchEvent(new d.window.CustomEvent('mixcheck:inputs', { detail: { inputs: pl } }));
  ok(DC.render('Labor Market Context').includes(s.trim().slice(0, 40)), 'once inputs arrive, new callouts name the burden');
  ok(!DC.render('Race & ethnicity').includes('15-year'), 'callouts that do not suggest a mix are unchanged');
  ok(DC.burdenSentence({ burden: null }) === '', 'no CHAS on hand: nothing is named');
}

// ------------------------------------------------------------------ 7. pages load the check first
for (const [page, consumer] of [
  ['hna-what-to-do.html', 'js/housing-need-projector.js'],
  ['housing-needs-assessment.html', 'js/housing-need-projector.js'],
  ['housing-needs-assessment.html', 'js/components/housing-type-need.js'],
  ['hna-comparative-analysis.html', 'js/hna/hna-comparison.js'],
  ['lihtc-opportunity-finder.html', 'js/lihtc-opportunity-finder.js']]) {
  const h = read(page);
  const a = h.indexOf('src="js/mix-check.js"'), b = h.indexOf('src="js/mix-check-inputs.js"'), c = h.indexOf('src="' + consumer + '"');
  ok(a > 0 && a < b && b < c, `${page} loads js/mix-check.js and js/mix-check-inputs.js before ${consumer}`);
}
const call = read('housing-needs-assessment.html');
ok(/renderAmiRecommendation\('hnpAmiContainer', countyData, \{\s*countyFips: countyFips/.test(call), 'the report passes the county to the projector');

console.log(`mix-check-recommenders: ${checks} checks passed`);
