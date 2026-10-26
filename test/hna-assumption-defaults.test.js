'use strict';

// One place, one 20-yr production need, on every HNA chapter.
//
// Found 2026-10-26: with no place picked, the HNA loaded Colorado statewide
// and the "20-yr production need" tile read 615,026 on the full report and
// What to do, but 444,604 on Who lives here, Where it's heading, What
// households can afford and What housing exists. Mesa County read 25,951 vs
// 13,953. The four chapters ship no assumptions panel, and getAssumptions()
// fell back to the held headship rate while the panel's checked default is
// Forecast (DOLA's household series). Places were unaffected, because the
// place projection replaces the resident-growth part.
//
// Held here:
//   1. The panel, where a page ships it, is checked at
//      HNARenderers.ASSUMPTION_DEFAULTS (horizon, vacancy, headship).
//   2. For a county and the state, every chapter page, rendered with the
//      controls it actually ships, gives the same 20-yr figure as the full
//      report at its defaults.
//   3. With nothing picked, update() computes nothing and keeps the
//      "pick a place" state, and init() does not load Colorado unasked.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const PAGES = [
  'housing-needs-assessment.html',
  'hna-what-to-do.html',
  'hna-what-housing-exists.html',
  'hna-who-lives-here.html',
  'hna-where-its-heading.html',
  'hna-what-households-can-afford.html',
];

const CARD_RE = /<h2>Housing need summary<\/h2>[\s\S]*?<div id="hnaNeedReconciliation"[^>]*><\/div>/;
const PANEL_RES = [
  /<select id="assumpHorizon"[\s\S]*?<\/select>/g,
  /<input id="assumpVacancy"[^>]*>/g,
  /<input[^>]*name="assumpHeadship"[^>]*>/g,
];

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

function shipsPanel(html) { return /name="assumpHeadship"/.test(html); }

// The page's own need card where it has one; otherwise the full report's card
// with the assumptions panel taken out, so the chapter is rendered with the
// controls it really ships (none).
function cardFor(page) {
  const html = read(page);
  const own = html.match(CARD_RE);
  if (own) return own[0];
  assert(!shipsPanel(html), `${page} ships headship options outside the need card; update this test`);
  let card = read('housing-needs-assessment.html').match(CARD_RE)[0];
  for (const re of PANEL_RES) card = card.replace(re, '');
  assert(!shipsPanel(card), 'the panel could not be removed from the full report card');
  return card;
}

function install(dom) {
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  global.URLSearchParams = dom.window.URLSearchParams;
  global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  global.Blob = dom.window.Blob;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
  const add = dom.window.document.addEventListener.bind(dom.window.document);
  dom.window.document.addEventListener = (type, l, o) => (type === 'DOMContentLoaded' ? undefined : add(type, l, o));
  global.Chart = class { constructor(ctx, config) { this.config = config; this.data = config && config.data; } destroy() {} };
  window.Chart = global.Chart;
  dom.window.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
  window.APP_CONFIG = { DATA_VERSION: 'test' };
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

async function twentyYear(page, selection, projFips) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <select id="geoType"><option value="${selection.geoType}" selected>${selection.geoType}</option></select>
    <select id="geoSelect"><option value="${selection.geoid}" selected>${selection.label}</option></select>
    <div class="chart-box"><canvas id="chartProjectedHH"></canvas></div>
    ${cardFor(page)}
  </body></html>`, { url: 'http://127.0.0.1/' + page });
  install(dom);
  window.HNAState.state.currentSelection = selection;
  const proj = JSON.parse(read(`data/hna/projections/${projFips}.json`));
  await window.HNAController.applyAssumptions(proj, selection);
  const text = document.getElementById('statUnitsNeed').textContent.trim();
  assert(/\d/.test(text), `${page}, ${selection.label}: no 20-yr figure rendered ("${text}")`);
  return { text, mode: window.HNARenderers.getAssumptions().headshipMode };
}

(async () => {
  console.log('HNA assumption defaults agree on every chapter');

  await test('the panel ships checked at ASSUMPTION_DEFAULTS', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/' });
    install(dom);
    const D = window.HNARenderers.ASSUMPTION_DEFAULTS;
    assert(D && D.headshipMode && D.horizon && D.vacancyPct, 'HNARenderers.ASSUMPTION_DEFAULTS is not exported');
    const panelPages = PAGES.filter((p) => shipsPanel(read(p)));
    assert(panelPages.includes('housing-needs-assessment.html'), 'the full report no longer ships the assumptions panel');
    for (const p of panelPages) {
      const html = read(p);
      const checked = html.match(/<input[^>]*name="assumpHeadship"[^>]*>/g).filter((t) => /\bchecked\b/.test(t));
      assert.strictEqual(checked.length, 1, `${p}: expected one checked headship option`);
      assert.match(checked[0], new RegExp(`value="${D.headshipMode}"`), `${p}: the checked headship option is not ${D.headshipMode}`);
      assert.match(html, new RegExp(`<option value="${D.horizon}" selected>`), `${p}: the horizon does not default to ${D.horizon}`);
      assert.match(html, new RegExp(`<input id="assumpVacancy"[^>]*value="${D.vacancyPct}"`), `${p}: the vacancy does not default to ${D.vacancyPct}%`);
    }
  });

  const CASES = [
    { sel: { geoType: 'county', geoid: '08077', label: 'Mesa County' }, fips: '08077' },
    { sel: { geoType: 'state', geoid: '08', label: 'State of Colorado' }, fips: '08' },
  ];
  for (const c of CASES) {
    await test(`${c.sel.label}: one 20-yr production need on all six chapters`, async () => {
      const seen = [];
      for (const p of PAGES) seen.push(Object.assign({ page: p }, await twentyYear(p, c.sel, c.fips)));
      const want = seen[0];
      for (const s of seen) {
        assert.strictEqual(s.mode, want.mode, `${s.page} used headship "${s.mode}", the full report "${want.mode}"`);
        assert.strictEqual(s.text, want.text, `${s.page} shows ${s.text}, the full report ${want.text}`);
      }
    });
  }

  await test('with nothing picked, update() computes nothing and keeps the pick-a-place state', async () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <select id="geoType"><option value="state" selected>State of Colorado</option></select>
      <select id="geoSelect"><option value="" selected>Pick a place</option><option value="08">State of Colorado</option></select>
      <div id="hnaWaitingState" style="display:none"><p class="hna-waiting-text">Pick a place</p></div>
      <div id="geoContextPill">No place picked</div>
      <div id="statUnitsNeed">—</div>
    </body></html>`, { url: 'http://127.0.0.1/housing-needs-assessment.html' });
    install(dom);
    let fetched = 0;
    const realFetch = window.fetch;
    window.fetch = global.fetch = async (u) => { fetched += 1; return realFetch(u); };
    await window.HNAController.update();
    assert.strictEqual(document.getElementById('hnaWaitingState').style.display, '', 'the waiting state was hidden');
    assert.strictEqual(document.getElementById('statUnitsNeed').textContent, '—', 'a figure was written with nothing picked');
    assert.strictEqual(document.getElementById('geoContextPill').textContent, 'No place picked');
    assert.strictEqual(fetched, 0, 'update() fetched data with nothing picked');
  });

  await test('init() starts on pick-a-place when no address or saved place names one', () => {
    const src = read('js/hna/hna-controller.js');
    assert.match(src, /const nothingChosen = !restoredGeoType && !_combined && !unknownGeoid;/);
    assert.match(src, /if \(!unknownGeoid && !nothingChosen\) update\(\);/);
    // The blank option is removed after the first real pick, so the page
    // cannot return to "no place" with the last place's figures on screen.
    assert.match(src, /addEventListener\('change', function dropPick\(\) \{[\s\S]{0,200}removeChild\(pick\)/);
  });

  if (failures) { console.log(`\nhna-assumption-defaults: ${failures} failing`); process.exit(1); }
  console.log('\nhna-assumption-defaults: PASS');
})();
