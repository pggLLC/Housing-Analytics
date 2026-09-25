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
// Held as agreement with the data, not as wording:
//   - the tile's declared basis equals the digest's future_units_reading, and
//     a workforce figure equals the digest's workforce_gap_units;
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
  const workforce = fruita.metrics.workforce_gap_units.value;

  await test('the tile declares the digest\'s reading, and a workforce figure is the workforce gap', async () => {
    const t = await renderTile({ geoType: 'place', geoid: FRUITA, label: 'Fruita', contextCounty: '08077',
      profile: { DP02_0001E: 5807, DP04_0001E: 6100, DP05_0001E: 14000 } }, '08077');
    assert.strictEqual(t.basis, reading, `tile declares ${t.basis}; the digest says ${reading}`);
    if (reading === 'workforce') {
      assert.strictEqual(t.value.replace(/,/g, ''), String(workforce),
        `a workforce-based tile shows ${t.value}; the digest's workforce gap is ${workforce}`);
    }
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
    const w = label('workforce', false);
    const g = label('resident_growth', false);
    const gp = label('resident_growth', true);
    assert(w && g && gp && w !== g && w !== gp, `bases share a label: ${w} | ${g} | ${gp}`);
    assert.strictEqual(rendered.label, label(rendered.basis, false),
      'the rendered subtitle is not what unitsNeedBasisLabel gives for its declared basis');
  });

  /* ── The Recommendation, for every jurisdiction ───────────────────── */

  const Contract = require('../js/workflow/recommendation-contract.js');
  const files = fs.readdirSync(path.join(ROOT, DIGEST_DIR)).filter((f) => f.endsWith('.json'));

  await test('for every digest, the Recommendation\'s production basis is the digest\'s reading', () => {
    const seen = { workforce: 0, resident_growth: 0 };
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
    // Non-vacuity on the scan: both readings occur and were checked.
    assert(seen.workforce > 100 && seen.resident_growth > 10,
      `checked ${seen.workforce} workforce and ${seen.resident_growth} resident-growth answers; too few to mean anything`);
  });

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
  console.log('\nproduction-figure-names-its-reading: PASS');
})();
