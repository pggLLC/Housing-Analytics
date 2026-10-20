'use strict';

// The 20-year "net new units" figure must say which reading produced it.
//
// Found 2026-09-24 (audit F5): the HNA tile read "2,302 / DOLA forecast" for
// Fruita while the note under it said "Workforce-based: 2,302". The figure is
// the larger of two readings (_productionNeed): resident growth from DOLA's
// county household projection, or the workforce gap (LEHD jobs against homes
// affordable at <=60% AMI). For 365 of 546 jurisdictions the workforce
// reading wins, and every one of them carried the "DOLA forecast" subtitle.
// The Recommendation quoted the same figure as "Roughly 2,302 additional
// homes over 20 years" with nothing to say it was not a household forecast.
//
// Since 2026-10-20 the figure is resident growth plus homes for a quarter of
// today's lower- and middle-wage in-commuters, or resident growth alone where
// there is no in-commuter record; the jobs reading no longer sets it.
//
// Held as agreement with the data, not as wording:
//   - the tile's declared basis equals the digest's future_units_reading, and
//     a figure with in-commuters is the digest's growth plus its in-commuters;
//   - for every digest, the Recommendation's production basis equals
//     future_units_reading.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const DIGEST_DIR = 'data/hna/jurisdiction-metrics-digest';
const digest = (geoid) => JSON.parse(read(`${DIGEST_DIR}/${geoid}.json`));

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

function freshRequire(rel) {
  const abs = path.join(ROOT, rel);
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

/* ── The HNA tile, rendered by the real applyAssumptions ─────────────── */

function page() {
  // The stat block as the page ships it, so the subtitle element the
  // controller writes is the one on the page, not a fixture's.
  const html = read('housing-needs-assessment.html');
  const tile = html.match(/<div class="stat"><div class="k">Net new units \(20y\)<\/div>[\s\S]*?<\/div><\/div>/);
  assert(tile, 'the net-new-units tile could not be found in housing-needs-assessment.html');
  return `<!doctype html><html><body>
    <select id="geoType"><option value="place" selected>Place</option></select>
    <select id="geoSelect"><option value="0828745" selected>Fruita</option></select>
    <input id="assumpHorizon" value="20"><input id="assumpVacancy" value="5">
    <input type="radio" name="headship" value="current" checked>
    <div id="statBaseUnits"></div><div id="statBaseUnitsSrc"></div><div id="statTargetVac"></div>
    ${tile[0]}
    <div id="statNetMig"></div><div id="needNote"></div>
    <details id="projectionCalculationTrace"><div id="projectionCalculationTraceBody"></div></details>
  </body></html>`;
}

function install(dom) {
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  global.URLSearchParams = dom.window.URLSearchParams;
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
  const add = dom.window.document.addEventListener.bind(dom.window.document);
  dom.window.document.addEventListener = (type, l, o) => (type === 'DOMContentLoaded' ? undefined : add(type, l, o));
  global.Chart = class { destroy() {} };
  window.Chart = global.Chart;
  window.APP_CONFIG = { DATA_VERSION: 'test' };
  // Serve the repo's own data files, so the digest the controller reads is
  // the committed one.
  window.fetch = async (url) => {
    const rel = String(url).replace(/^\.?\//, '').split('?')[0];
    const abs = path.join(ROOT, rel);
    if (!rel.startsWith('data/') || !fs.existsSync(abs)) return { ok: false, status: 404, text: async () => '', json: async () => null };
    const body = fs.readFileSync(abs, 'utf8');
    return { ok: true, status: 200, text: async () => body, json: async () => JSON.parse(body) };
  };
  global.fetch = window.fetch;
  window.fetchWithTimeout = (u) => window.fetch(u);
  global.fetchWithTimeout = window.fetchWithTimeout;
  freshRequire('js/hna/hna-utils.js');
  freshRequire('js/hna/hna-renderers.js');
  freshRequire('js/hna/hna-controller.js');
}

async function renderTile(selection, countyFips) {
  const dom = new JSDOM(page(), { url: 'http://127.0.0.1/housing-needs-assessment.html' });
  install(dom);
  window.HNAState.state.currentSelection = selection;
  const proj = JSON.parse(read(`data/hna/projections/${countyFips}.json`));
  await window.HNAController.applyAssumptions(proj, selection);
  const basisEl = document.getElementById('statUnitsNeedBasis');
  assert(basisEl, 'the tile has no basis element for the controller to write');
  return { value: document.getElementById('statUnitsNeed').textContent.trim(), basis: basisEl.dataset.basis, label: basisEl.textContent.trim() };
}

(async () => {
  console.log('\nThe 20-year units figure names the reading that produced it');

  const FRUITA = '0828745';
  const fruita = digest(FRUITA);
  const reading = fruita.metrics.future_units_reading.value;
  const growth = fruita.metrics.future_units_growth_20yr.value;
  const incommuters = fruita.metrics.incommuter_need_units ? fruita.metrics.incommuter_need_units.value : null;

  await test('the tile declares the digest\'s reading, and its figure is growth plus in-commuters', async () => {
    const t = await renderTile({ geoType: 'place', geoid: FRUITA, label: 'Fruita', contextCounty: '08077',
      profile: { DP02_0001E: 5807, DP04_0001E: 6100, DP05_0001E: 14000 } }, '08077');
    assert.strictEqual(t.basis, reading, `tile declares ${t.basis}; the digest says ${reading}`);
    assert.strictEqual(reading, 'resident_growth_plus_incommuters', `Fruita reads ${reading}; this test expects its in-commuter record`);
    assert(Math.abs(Number(t.value.replace(/,/g, '')) - (growth + incommuters)) <= 1,
      `the tile shows ${t.value}; the digest's growth ${growth} plus in-commuters ${incommuters} is ${growth + incommuters}`);
    assert(t.label && t.label !== '—', 'the tile carries no basis label');
  });

  await test('the subtitle is written from the basis, for every basis, and differs between them', async () => {
    // Structure, not wording (Codex review of #1884): whatever the labels say,
    // each basis gets its own label, so the subtitle cannot claim one reading
    // while the figure came from the other.
    const rendered = await renderTile({ geoType: 'place', geoid: FRUITA, label: 'Fruita', contextCounty: '08077',
      profile: { DP02_0001E: 5807, DP04_0001E: 6100, DP05_0001E: 14000 } }, '08077');
    const src = read('js/hna/hna-controller.js');
    const fn = src.match(/function unitsNeedBasisLabel\([\s\S]*?\n  \}/);
    assert(fn, 'unitsNeedBasisLabel() is gone; the subtitle has no single producer');
    const label = new Function(fn[0] + '; return unitsNeedBasisLabel;')();
    const all = [
      label('resident_growth_plus_incommuters', false), label('resident_growth_plus_incommuters', true),
      label('resident_growth', false), label('resident_growth', true),
    ];
    assert(all.every(Boolean) && new Set(all).size === all.length, `bases share a label: ${all.join(' | ')}`);
    assert.strictEqual(label('workforce', false), label(null, false), 'the retired jobs basis still gets a label of its own');
    // Fruita's growth comes from the stored place projection when the ledger covers it.
    const placeLedger = JSON.parse(read('data/hna/projections/places.json')).places || {};
    const usedPlace = Boolean(placeLedger[FRUITA]);
    assert.strictEqual(rendered.label, label(rendered.basis, usedPlace),
      'the rendered subtitle is not what unitsNeedBasisLabel gives for its declared basis');
  });

  /* ── The Recommendation, for every jurisdiction ───────────────────── */

  const Contract = require('../js/workflow/recommendation-contract.js');
  const files = fs.readdirSync(path.join(ROOT, DIGEST_DIR)).filter((f) => f.endsWith('.json'));

  await test('for every digest, the Recommendation\'s production basis is the digest\'s reading', () => {
    const seen = { resident_growth_plus_incommuters: 0, resident_growth: 0 };
    const wrong = [];
    for (const f of files) {
      const d = JSON.parse(read(`${DIGEST_DIR}/${f}`));
      const c = Contract.build({ digest: d, generatedAt: 'x' }).conclusions.find((x) => x.id === 'production');
      if (!c || !c.verdict) continue;
      const r = d.metrics.future_units_reading ? d.metrics.future_units_reading.value : null;
      if (d.metrics.future_units_needed_20yr && d.metrics.future_units_needed_20yr.value != null) {
        if (c.basis !== r) wrong.push(`${f}: ${c.basis} vs ${r}`);
        if (seen[c.basis] !== undefined) seen[c.basis] += 1;
      }
    }
    assert.deepStrictEqual(wrong.slice(0, 5), [], `${wrong.length} disagreements`);
    // Non-vacuity on the scan. The few geographies with no in-commuter record
    // give no production verdict today, so growth alone is held on Fruita's
    // digest with its in-commuter part removed.
    assert(seen.resident_growth_plus_incommuters > 300,
      `checked ${seen.resident_growth_plus_incommuters} with-in-commuter answers; too few to mean anything`);
    const alone = JSON.parse(JSON.stringify(fruita));
    delete alone.metrics.incommuter_need_units;
    alone.metrics.future_units_reading.value = 'resident_growth';
    alone.metrics.future_units_needed_20yr.value = alone.metrics.future_units_growth_20yr.value;
    const c = Contract.build({ digest: alone, generatedAt: 'x' }).conclusions.find((x) => x.id === 'production');
    assert(c && c.verdict, 'growth alone gave no production verdict; this case checks nothing');
    assert.strictEqual(c.basis, 'resident_growth', `growth alone reads as ${c.basis}`);
    assert(!/in-commuter/i.test(c.plain), `growth alone still mentions in-commuters: "${c.plain}"`);
  });

  await test('a figure below zero is a surplus in words, never a minus sign', () => {
    // Where projected households fall, growth is negative and so may be the
    // total. "Roughly -1,030 additional homes" was the Recommendation for Las
    // Animas County before this was held.
    let surplus = 0;
    const raw = [];
    for (const f of files) {
      const d = JSON.parse(read(`${DIGEST_DIR}/${f}`));
      const fu = d.metrics.future_units_needed_20yr && d.metrics.future_units_needed_20yr.value;
      const c = Contract.build({ digest: d, generatedAt: 'x' }).conclusions.find((x) => x.id === 'production');
      if (!c || !c.verdict) continue;
      if (/(^|[\s(:])[-\u2212]\d/.test(c.verdict + ' ' + c.plain)) raw.push(`${f}: ${c.verdict} | ${c.plain}`);
      if (typeof fu === 'number' && fu < 0) {
        surplus += 1;
        if (!/surplus/i.test(c.verdict) || !/surplus/i.test(c.plain)) raw.push(`${f}: ${fu} is not called a surplus: ${c.plain}`);
      }
    }
    assert(surplus >= 10, `only ${surplus} digests carry a figure below zero; too few to mean anything`);
    assert.deepStrictEqual(raw.slice(0, 5), [], `${raw.length} answers print a minus sign or skip the word surplus`);
  });

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
  console.log('\nproduction-figure-names-its-reading: PASS');
})();
