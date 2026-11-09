// test/pma-area-towns.test.js
//
// Other towns inside a tract-drawn market area, and the jobs there by where
// their workers live (js/pma-area-towns.js). CHFA's guide requires whole
// tracts, so a tract shared with another town is flagged, not split; its
// jobs are counted apart from the main town's. Nothing here adds demand.
//
// Usage: node test/pma-area-towns.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const T = require('../js/pma-area-towns.js');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); } catch (e) { failures++; console.log('  ✗ ' + name + ' — ' + e.message); }
}

// Main town A has 900 homes over tracts 1 and 2; town B has 300 of tract 3's 1,000 homes.
const placeDoc = {
  tract_housing_units: { '08001000001': 1000, '08001000002': 1000, '08001000003': 1000, '08001000009': 500 },
  places: {
    '0800001': { name: 'Alpha (town)', tracts: [{ tract_geoid: '08001000001', housing_units: 800 }, { tract_geoid: '08001000002', housing_units: 100 }] },
    '0800002': { name: 'Beta (town)', tracts: [{ tract_geoid: '08001000003', housing_units: 300 }] },
    '0800003': { name: 'Gamma (CDP)', tracts: [{ tract_geoid: '08001000002', housing_units: 50 }] },
    '0800004': { name: 'Delta (city)', tracts: [{ tract_geoid: '08001000009', housing_units: 400 }] }
  }
};
const area = ['08001000001', '08001000002', '08001000003'].map((g) => ({ geoid: g, share: 1 }));

test('the main town is the place with the most homes; a tract another town dominates is flagged', () => {
  const t = T.townsInArea(placeDoc, area);
  assert.strictEqual(t.main.place, '0800001');
  assert.deepStrictEqual(Object.keys(t.flagged), ['08001000003']);
  assert.strictEqual(t.others.length, 1, 'Gamma (5% of its tract, fewer homes than the main town there) is not flagged');
  assert(/Beta \(300 of 1,000 homes in tract 000003\)/.test(T.townsSentence(t)));
  assert(/entire census tracts.*Appendix A section 4, p\. 74/.test(T.townsSentence(t)));
});

test('a town with fewer homes in a tract than the main town is not flagged', () => {
  const doc = JSON.parse(JSON.stringify(placeDoc));
  doc.places['0800002'].tracts.push({ tract_geoid: '08001000001', housing_units: 150 });
  const t = T.townsInArea(doc, area);
  assert(!t.flagged['08001000001'], 'Alpha holds more of tract 1');
});

test('jobs split into local and in-commuters; a flagged tract\'s jobs are counted apart', () => {
  const od = { meta: { year: 2024, source_url: 'x/co_od_main_JT00_2024.csv.gz', retained_flow_share: 0.95 },
    pairs: [
      ['08001000001', '08001000001', 100],   // local
      ['08001000009', '08001000001', 40],    // in-commuter from Delta
      ['08001000003', '08001000002', 10],    // Beta resident working in Alpha: local (tract kept)
      ['08001000009', '08001000003', 30],    // jobs in Beta's tract: apart
      ['08001000001', '08001000009', 999]    // job outside the area: ignored
    ] };
  const t = T.townsInArea(placeDoc, area);
  const s = T.inflow(od, placeDoc, area, t, { '08001': 'Adams County' });
  assert.strictEqual(s.jobs, 150);
  assert.strictEqual(s.local, 110);
  assert.strictEqual(s.inCommuters, 40);
  assert.deepStrictEqual(s.top, [{ name: 'Delta', workers: 40 }]);
  assert.strictEqual(s.apart, 30);
  const line = T.inflowSentence(s, t);
  assert(/Counted apart: 30 jobs in tract 000003, shared with Beta/.test(line));
  assert(/None of these is added to demand: CHFA counts people moving in only when comparable projects show it \(2027–28 QAP, Appendix A section 7, p\. 83\)\. LEHD LODES 2024, all jobs, 95% of flows kept\./.test(line));
});

test('dropping a tract makes its working residents in-commuters, named by their town', () => {
  const od = { meta: {}, pairs: [['08001000003', '08001000001', 25]] };
  const kept = area.filter((t) => t.geoid !== '08001000003');
  const t = T.townsInArea(placeDoc, kept);
  const s = T.inflow(od, placeDoc, kept, t, { '08001': 'Adams County' });
  assert.strictEqual(s.inCommuters, 25);
  // Beta holds 30% of tract 3, under half, so the origin is named by county.
  assert.deepStrictEqual(s.top, [{ name: 'rural Adams County', workers: 25 }]);
});

test('work-side jobs follow the tract\'s share of the area; missing files are null', () => {
  const od = { meta: {}, pairs: [['08001000009', '08001000001', 100]] };
  const half = [{ geoid: '08001000001', share: 0.5 }];
  assert.strictEqual(T.inflow(od, placeDoc, half, T.townsInArea(placeDoc, half), {}).inCommuters, 50);
  assert.strictEqual(T.inflow(null, placeDoc, half, null, {}), null);
  assert.strictEqual(T.townsInArea(null, half), null);
});

test('real data: the files the page reads carry what the module needs', () => {
  const root = path.join(__dirname, '..');
  const pl = JSON.parse(fs.readFileSync(path.join(root, 'data', T.PLACES_PATH)));
  const od = JSON.parse(fs.readFileSync(path.join(root, 'data', T.OD_PATH)));
  assert(pl.tract_housing_units && Object.keys(pl.places).length > 400);
  assert(/JT00_2024/.test(od.meta.source_url));
  // Fruita's tracts take in Loma and Redlands; their jobs are counted apart.
  const fr = ['08077001402', '08077001502', '08077001503', '08077001504'].map((g) => ({ geoid: g, share: 1 }));
  const t = T.townsInArea(pl, fr);
  assert.strictEqual(T.townsSentence(t).slice(0, 18), 'Main town: Fruita.');
  assert(t.flagged['08077001502'] && t.flagged['08077001402']);
  const s = T.inflow(od, pl, fr, t, {});
  assert(s.jobs > 0 && s.apart > 0 && Math.abs(s.local + s.inCommuters - s.jobs) <= 1);
  const html = fs.readFileSync(path.join(root, 'market-analysis.html'), 'utf8');
  assert(/js\/pma-area-towns\.js/.test(html) && /id="pmaSumOtherTowns"/.test(html) && /id="pmaSumInflow"/.test(html));
});

test('without the town file, job totals are withheld, not shown unsplit (Codex #2748)', () => {
  const od = { meta: {}, pairs: [['08001000009', '08001000001', 100]] };
  const s = T.inflow(od, null, area, null, {});
  assert.strictEqual(s.unavailable, true);
  assert(/^Job counts withheld: the 2020 Census town file did not load/.test(T.inflowSentence(s, null)));
});

test('the no-other-town line states the whole flag rule (Codex #2748)', () => {
  // Gamma holds 40% of tract 2 but fewer homes there than Alpha: not flagged.
  const doc = JSON.parse(JSON.stringify(placeDoc));
  doc.places['0800001'].tracts[1].housing_units = 500;
  doc.places['0800003'].tracts[0].housing_units = 400;
  const t = T.townsInArea(doc, area.slice(0, 2));
  assert.strictEqual(t.others.length, 0);
  assert(/none holds 10% or more of a tract's homes \(and 25 or more\) and more of them than Alpha/.test(T.townsSentence(t)));
});

if (failures) { console.log('\n' + failures + ' failure(s)'); process.exit(1); }
console.log('\nAll checks passed ✅');
