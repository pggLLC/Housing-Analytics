#!/usr/bin/env node
/**
 * Through-commuters and the local HNA comparison (paul 2026-11-02: "add indication to live site and
 * deep analysis to CHFA market recommendations behind the gate").
 *
 *   data/market/through-commuters.json  built by scripts/market/build_through_commuters.py
 *   data/hna/local-hna-comparisons.json curated, page-cited figures from recent local HNAs
 *
 * Pins:
 *   1. the data file adds up: bands sum to the total, top lists never exceed it, small totals are
 *      withheld, metro towns are not scored, Bayfield's count stays near the hand-routed check
 *      (OSRM, 2026-11-02);
 *   2. the public page (js/commuting.js) prints the count and top job town from the file, and
 *      prints nothing when the file is missing or the town has no count;
 *   3. the gated Jurisdiction Report prints the relocation steps from the file, says no number is
 *      added without comparable-property evidence, and quotes CHFA's in-migration rule;
 *   4. every COHO figure in the HNA comparison is recomputed from the data file it names, and every
 *      HNA figure carries a page and a quote;
 *   5. the public page names no relocation share or capture effect (that analysis is member-only).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));
let checks = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); checks++; };

const T = json('data/market/through-commuters.json');
const places = T.places;

// ---- 1. The data file.
ok(T.meta.lodes_year === 2023 && /JT01_2023/.test(T.meta.source), 'primary jobs, LODES 2023');
ok(/comparable/.test(T.meta.use), 'the file says it is a pool, counted as demand only with comparable evidence');
const scored = Object.entries(places).filter(([, p]) => p.through != null);
ok(scored.length >= 50, `a statewide file scores many towns (${scored.length})`);
for (const [g, p] of scored) {
  const e = p.earnings, a = p.age;
  ok(e.le_1250 + e['1251_3333'] + e.gt_3333 === p.through, `${g}: earnings bands sum to the total`);
  ok(a.under_30 + a['30_54'] + a['55_plus'] === p.through, `${g}: age bands sum to the total`);
  ok(p.through >= T.meta.min_shown, `${g}: a printed total meets the floor`);
  ok(p.to.every((f) => f[1] <= p.through) && p.from_counties.every((f) => f[1] <= p.through), `${g}: no top-list count exceeds the total`);
  ok(p.renter_share_at_home == null || (p.renter_share_at_home > 0 && p.renter_share_at_home < 1), `${g}: renter share is a share`);
  ok(p.avg_drive_minutes > 0 && p.avg_route_miles > 0, `${g}: trip length is positive`);
}
const bay = places['0805265'];
// Hand check 2026-11-02: OSRM routes from each home block to its Durango work block group gave 707 (0 m),
// 770 (200 m) and 820 (500 m) Bayfield through-commuters bound for Durango.
ok(bay && bay.to[0][0] === 'Durango (city)' && bay.to[0][1] >= 650 && bay.to[0][1] <= 850, `Bayfield's Durango-bound count stays near the OSRM check (${bay && bay.to[0][1]})`);
ok(bay.from_counties.slice(0, 2).map((f) => f[0]).sort().join() === 'Archuleta County,La Plata County', 'Bayfield\'s through-commuters live in La Plata and Archuleta');
const metro = ['0804000', '0820000', '0816000', '0827425', '0832155'];   // Aurora, Denver, Colorado Springs, Fort Collins, Greeley
ok(metro.every((g) => !places[g] || places[g].through == null), 'Front Range metro towns are not scored');

// ---- 2. The public page.
const C = require(join(ROOT, 'js/commuting.js'));
C._setThrough(T);
const item = C.throughItem({ geoid: '0805265', name: 'Bayfield (town)' });
ok(item.includes(bay.through.toLocaleString('en-US')) && item.includes('most to Durango') && item.includes('drive through Bayfield'), `the public line prints the file's count and job town: ${item}`);
ok(item.includes('LODES 2023'), 'the public line names its data year');
ok(!/capture|CHFA|%/.test(item), 'the public line carries no capture effect or share (member-only)');
const none = Object.keys(places).find((g) => places[g].through == null);
ok(C.throughItem({ geoid: none, name: 'X' }) === '', 'a town without a count prints nothing');
C._setThrough(null);
ok(C.throughItem({ geoid: '0805265', name: 'Bayfield (town)' }) === '', 'without the file the line is left out, not guessed');
const page = read('commuting.html') + read('js/commuting.js');
ok(page.includes('data/market/through-commuters.json'), 'the page loads the through-commuter file');

// ---- 3. The gated Jurisdiction Report.
const WP = require(join(ROOT, 'js/whitepaper/jurisdiction-whitepaper.js'));
const FundingFit = require(join(ROOT, 'js/funding-fit.js'));
const { loadSources } = await import(join(ROOT, 'scripts/whitepaper/build-whitepaper.mjs'));
const src = loadSources();
const m = WP.buildModel(src, '0805265', { FundingFit, today: '2026-11-02' });
const h = WP.renderHtml(m);
ok(m.relocation && m.relocation.through === bay.through, 'the report reads Bayfield\'s count from the file');
const low = bay.earnings.le_1250 + bay.earnings['1251_3333'];
ok(m.relocation.lowPaid === low && m.relocation.renters === Math.round(low * bay.renter_share_at_home), 'the pool steps are computed from the file');
ok(/Relocation potential/.test(h) && h.includes(bay.through.toLocaleString('en-US')), 'the report prints the relocation section');
const comps = json('data/market/relocation-comparables.json').comparables.filter((c) => c.county_fips === '08067' && c.measure === 'outside_county');
if (!comps.length) ok(/No comparable-property evidence/.test(h) && !m.relocation.comparable, 'La Plata has no comparable on file, so no number is added');
ok(/demonstrated from other comparable projects/.test(h) && /anecdotal evidence is not permitted/.test(h), 'the report quotes CHFA\'s in-migration rule');
ok(!WP.buildModel(src, '08067', { FundingFit, today: '2026-11-02' }).relocation, 'a county gets no through count (towns only)');
const noT = JSON.parse(JSON.stringify(src)); delete noT.through;
ok(!WP.buildModel(noT, '0805265', { FundingFit, today: '2026-11-02' }).relocation, 'without the file the section is left out');

// ---- 4. The HNA comparison.
const H = json('data/hna/local-hna-comparisons.json');
const proj = json('data/hna/projections/08067.json');
const chas = json('data/hna/chas_affordable_available.json');
const cs = json('data/market/commute-strength.json');
const bsum = json('data/hna/summary/0805265.json');
const i29 = proj.years.indexOf(2029);
const coho = {
  'need-2029': Math.round(proj.housing_need.tenure_split.incremental_units_needed_tenure_adjusted[i29]),
  'renter-gap-50': chas.counties['08067'].tiers['50'].homes_short,
  'in-commuters': Math.round(1000 * cs.counties['08067'].in_commuters / cs.counties['08067'].jobs) / 1000,
  'bayfield-households': bsum.acsProfile.DP02_0001E,
  'bayfield-rent': bsum.acsProfile.DP04_0134E,
};
for (const hna of H.hnas) {
  ok(/^\d{4}-\d{2}-\d{2}$/.test(hna.date) && Number(hna.date.slice(0, 4)) >= 2021, `${hna.id}: dated within five years`);
  ok(/^https:\/\//.test(hna.url), `${hna.id}: links the HNA`);
  for (const r of hna.rows) {
    ok(r.hna_page && r.hna_quote && r.hna_quote.length > 15, `${hna.id}/${r.id}: page and quote`);
    ok(r.why && r.coho_source, `${hna.id}/${r.id}: a reason and a COHO source`);
    if (r.id in coho) ok(Math.abs(r.coho_value - coho[r.id]) < 0.001, `${hna.id}/${r.id}: COHO figure ${r.coho_value} equals its data file (${coho[r.id]})`);
  }
}
// The comparison must agree with the HNA record it is rendered from, not with chosen wording.
const fmtHna = (v) => typeof v === 'number' ? (v < 1 ? Math.round(100 * v) + '%' : v.toLocaleString('en-US')) : String(v);
const escHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const section = (html) => { const i = html.indexOf('id="hna-compare"'); if (i < 0) return null; const j = html.indexOf('<h2', i + 1); return html.slice(i, j < 0 ? undefined : j); };
const hnaFor = (geoid) => H.hnas.find((x) => (x.applies_to || []).includes(geoid));
const rowsFor = (hna, geoid) => hna.rows.filter((r) => !r.geography || r.geography === geoid || r.geography === hna.county_fips || r.geography.length === 5);
function agrees(html, geoid) {
  const hna = hnaFor(geoid), sec = section(html);
  ok(hna && sec, `${geoid}: an HNA on file prints a comparison section`);
  ok(sec.includes(escHtml(hna.date.slice(0, 4))) && sec.includes(escHtml(hna.author)) && sec.includes(escHtml(hna.date)), `${geoid}: the section names the HNA's year, author and date from the record`);
  const shown = hna.rows.filter((r) => sec.includes(escHtml(r.measure)));
  ok(shown.length > 0, `${geoid}: the scan found rows to check`);
  for (const r of shown) {
    ok(sec.includes(escHtml(r.hna_text || fmtHna(r.hna_value))) && sec.includes(escHtml(r.hna_page)), `${geoid}/${r.id}: HNA figure and page match the record`);
    ok(sec.includes(escHtml(r.why)), `${geoid}/${r.id}: the reason matches the record`);
  }
  return shown.map((r) => r.id);
}
const bayRows = agrees(h, '0805265');
ok(bayRows.length === hnaFor('0805265').rows.length, 'Bayfield shows every row of its HNA');
ok(section(h).includes(bay.through.toLocaleString('en-US')), 'the relocation row reads the through count from the file');
const dur = WP.renderHtml(WP.buildModel(src, '0822035', { FundingFit, today: '2026-11-02' }));
const durRows = agrees(dur, '0822035');
ok(durRows.every((id) => { const r = hnaFor('0822035').rows.find((x) => x.id === id); return !r.geography || r.geography.length === 5; }), 'Durango gets the county rows, not Bayfield\'s');
ok(section(WP.renderHtml(WP.buildModel(src, '08077', { FundingFit, today: '2026-11-02' }))) === null && !hnaFor('08077'), 'a county without an HNA on file shows no comparison section');

console.log(`through-commuters: ${checks} checks passed`);
