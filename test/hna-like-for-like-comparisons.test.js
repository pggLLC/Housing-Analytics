'use strict';
/**
 * Three HNA statements compare like with like (site deep dive, 2026-10-19).
 *
 *  - Renter burden: the narrative compared the ranking index's ACS share
 *    (Mesa County 51.8%) with the CHAS state row (47.2%). The ACS state
 *    figure is 52.9%. Each local share is now set against the state figure
 *    from its own source, and says which source.
 *  - Town vs county: 362 places carry the county's vacancy (renter base under
 *    500), and the digest labelled it 'place', so the table showed Rio Blanco
 *    County's 1.9% as Rangely's own against Rangely's 5.5%.
 *  - "Pre-date 1960" summed DP04_0023E, which is 1960-1969.
 *
 * Run: node test/hna-like-for-like-comparisons.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));
const RANKING = json('data/hna/ranking-index.json');
const ROWS = RANKING.rankings;
const BY_ID = Object.fromEntries(ROWS.map((r) => [r.geoid, r]));
const TEXT_DOC = new JSDOM('').window.document;
const text = (html) => {
  const t = TEXT_DOC.createElement('template');
  t.innerHTML = String(html || '');
  return t.content.textContent;
};

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ok  ' + name); } catch (e) { failures += 1; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

function summaryFor(geoid) {
  const p = path.join(ROOT, 'data/hna/summary', geoid + '.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')).acsProfile : null;
}

function narrativesContext() {
  const w = {
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve(RANKING) }),
    console,
  };
  w.window = w;
  vm.createContext(w);
  vm.runInContext(read('js/hna/hna-narratives.js'), w);
  return w;
}

function takeaways() {
  const w = { console, setTimeout, clearTimeout, document: { readyState: 'loading', querySelectorAll: () => [], querySelector: () => null, addEventListener() {} }, addEventListener() {} };
  w.window = w;
  vm.createContext(w);
  vm.runInContext(read('js/hna/hna-section-takeaways.js'), w);
  return w.HnaSectionTakeaways.takeaways;
}

(async () => {
  await test('an ACS renter-burden share is compared with the ACS state figure, and says so', async () => {
    const w = narrativesContext();
    await w.HNANarratives._internals.loadRanking();
    let checked = 0;
    for (const row of ROWS) {
      const pcb = row.metrics && row.metrics.pct_cost_burdened;
      const profile = summaryFor(row.geoid);
      if (typeof pcb !== 'number' || !profile) continue;
      const html = w.HNANarratives.buildExecutiveSummary(Object.assign({}, profile, { _geoid: row.geoid, _geoType: row.type }), row.name);
      const t = text(html);
      const m = t.match(/Overall renter burden runs at ([\d.]+)%[^.]*?\(([\d.]+)%, both ([^)]+)\)/);
      if (!m) continue;
      assert.equal(Number(m[1]), pcb, `${row.geoid}: overall share is not the ranking index's ACS figure`);
      assert.equal(m[2], '52.9', `${row.geoid}: ACS share compared with ${m[2]}%, not the ACS state figure`);
      assert(/ACS 2020.2024/.test(m[3]), `${row.geoid}: comparison does not name ACS: ${m[3]}`);
      assert(!/U\.S\. average/.test(t), `${row.geoid}: still compares with the U.S.`);
      checked += 1;
    }
    assert(checked > 300, `only ${checked} geographies checked`);
    const mesa = text(w.HNANarratives.buildExecutiveSummary(Object.assign({}, summaryFor('08077'), { _geoid: '08077', _geoType: 'county' }), 'Mesa County'));
    assert(!/above the Colorado average/.test(mesa), 'Mesa County 51.8% still reads as above a 52.9% state figure');
  });

  await test('the rent-burden takeaway uses the same overall share and names each source', () => {
    const fn = takeaways()['Rent burden distribution'];
    const line = text(fn({ renterCb30: 51.8, renterCb30FromAcs: true, renterCb50: 22 }));
    assert(/51\.8% of renters are cost-burdened \(ACS 2020.2024\)/.test(line), line);
    assert(/22\.0% pay half their income or more \(HUD CHAS 2018.2022\)/.test(line), line);
    const chas = text(fn({ renterCb30: 39.4, renterCb50: 30.3 }));
    assert(/39\.4% of renters are cost-burdened \(HUD CHAS 2018.2022\)/.test(chas), chas);
  });

  await test('"built before 1960" leaves out the 1960s', () => {
    const fn = takeaways()['Age of Housing Stock'];
    // 100 units, 40 of them in the 1960s and 10 before 1960.
    const profile = { DP04_0017E: 0, DP04_0018E: 10, DP04_0019E: 10, DP04_0020E: 10, DP04_0021E: 10, DP04_0022E: 10,
      DP04_0023E: 40, DP04_0024E: 5, DP04_0025E: 3, DP04_0026E: 2 };
    const line = text(fn({ profile }));
    assert(/10\.0% of units were built before 1960/.test(line), line);
  });

  await test('a town carrying its county\'s vacancy is labelled county, and the town table leaves it out', () => {
    const C = require(path.join(ROOT, 'js/hna/county-comparison.js'));
    const dir = path.join(ROOT, 'data/hna/jurisdiction-metrics-digest');
    let substituted = 0;
    for (const row of ROWS) {
      if (row.type === 'county') continue;
      const f = path.join(dir, row.geoid + '.json');
      if (!fs.existsSync(f)) continue;
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      const v = d.metrics && d.metrics.vacancy_rate_pct;
      if (!v) continue;
      const county = row.metrics.vacancy_adjustment_method === 'county_active_market_small_renter_base';
      assert.equal(v.geography_level, county ? 'county_context' : 'place', `${row.geoid}: vacancy labelled ${v.geography_level}`);
      if (!county) continue;
      substituted += 1;
      const cf = path.join(dir, row.containingCounty + '.json');
      if (!fs.existsSync(cf)) continue;
      const out = C.compare(d, JSON.parse(fs.readFileSync(cf, 'utf8')));
      assert(!out.rows.some((r) => r.key === 'vacancy_rate_pct'), `${row.geoid}: county vacancy shown as the town's`);
    }
    assert(substituted >= 1, 'no place carries the county vacancy, so the check is empty');
    assert.equal(BY_ID['0862880'].metrics.vacancy_adjustment_method, 'county_active_market_small_renter_base');
  });

  if (failures) { console.log(failures + ' failed'); process.exit(1); }
  console.log('all passed');
})();
