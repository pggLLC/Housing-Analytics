'use strict';

// A glossary definition goes to the first use of a term the reader can SEE.
//
// Found 2026-09-26: js/glossary.js gives each term one definition per section
// and gave it to the first use in DOM order, visible or not. On
// market-analysis.html the first LIHTC is inside the map legend, which is
// collapsed by default (.pma-legend.is-collapsed .pma-legend-body is
// display:none), so every visible LIHTC below it went undefined. Opening the
// legend only toggles a class, which the glossary's observer did not watch,
// so a term used only inside a collapsed panel never got a definition at all.
// The site-wide map legend collapses differently — max-height:0, opacity:0,
// overflow:hidden (css/site-theme.css) — and a check for display:none alone
// would treat it as visible (Codex review on #1921).
//
// Runs the production code: js/glossary.js with data/glossary.json, the
// page's real stylesheets, and the PMA legend built by market-analysis.js's
// own buildPmaLegend(), toggled by clicking its own button.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const GLOSSARY = JSON.parse(read('data/glossary.json'));
const known = new Set(GLOSSARY.terms.map((t) => t.term));

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><html><head>
<style>${read('css/site-theme.css')}</style>
<style>${read('css/pages/market-analysis.css')}</style>
</head><body><main>
  <section id="pma"><div id="legendMount"></div>
    <p id="pmaVisible">Nearby LIHTC properties compete for the same renters.</p></section>
  <section id="legendOnly"><div id="legendOnlyMount"></div></section>
  <section id="mapLegend">
    <div class="map-legend is-collapsed"><div class="map-legend-head">Legend</div>
      <div class="map-legend-body"><span id="clippedQct">QCT tracts</span></div></div>
    <p id="qctVisible">The site is in a QCT.</p></section>
  <section id="details">
    <details><summary>More</summary><p id="closedAmi">AMI limits by county</p></details>
    <p id="amiVisible">Rents are capped by AMI.</p></section>
  <section id="tabs">
    <div hidden><p id="hiddenHud">HUD tab</p></div>
    <p id="hudVisible">HUD publishes the limits.</p></section>
  <section id="clipOnly">
    <div style="max-height:0;overflow:hidden"><span id="clippedChfa">CHFA note</span></div>
    <p id="chfaVisible">CHFA reviews the study.</p></section>
  <section id="control"><p id="controlVisible">A CHFA award.</p></section>
</main></body></html>`;

const dom = new JSDOM(PAGE, { url: 'http://localhost/market-analysis.html', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
const doc = w.document;
w.fetch = (url) => Promise.resolve(/glossary\.json$/.test(String(url))
  ? { ok: true, json: () => Promise.resolve(GLOSSARY) }
  : { ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
console.warn = console.error = console.info = () => {};
w.console.log = w.console.warn = w.console.error = w.console.info = () => {};
// The page's modules, for the legend builder. Leaflet is stubbed only after
// they load, so the page's own map start-up does not run.
['js/utils/format-money.js', 'js/market-analysis/market-analysis-utils.js',
  'js/market-analysis-scoring.js', 'js/market-analysis.js'].forEach((rel) => w.eval(read(rel)));
w.L = {
  DomUtil: { create: (tag, cls) => { const e = doc.createElement(tag); e.className = cls; return e; } },
  DomEvent: { disableClickPropagation() {}, disableScrollPropagation() {} },
};
const overlays = { 'LIHTC Projects': {}, 'Qualified Census Tracts': {} };
doc.getElementById('legendMount').appendChild(w.PMAEngine.buildPmaLegend(overlays));
const onlyLegend = w.PMAEngine.buildPmaLegend({ 'LIHTC Projects': {} });
doc.getElementById('legendOnlyMount').appendChild(onlyLegend);
// console.warn/error stay quiet for the run: the page's own start-up fails
// to load its data here, which is expected. Results go to console.log.

const defined = (el) => !!(el && el.querySelector('.gl-tooltip-trigger'));
const legendLihtc = (root) => Array.from(root.querySelectorAll('.pma-legend-body div'))
  .find((d) => /LIHTC/.test(d.textContent));

(async () => {
  console.log('\nA glossary definition goes to the first use of a term the reader can see');

  // Every term used below must be in the glossary, or nothing is tested.
  for (const t of ['LIHTC', 'QCT', 'AMI', 'HUD', 'CHFA']) assert(known.has(t), t + ' is not in data/glossary.json');

  w.eval(read('js/glossary.js'));
  await wait(700);

  await test('the scan wraps something: a visible term in a plain section gets its definition', () => {
    assert(defined(doc.getElementById('controlVisible')), 'no definition anywhere; the sweep did not run');
  });

  await test('the real PMA legend is collapsed by default, and its body is hidden by the page CSS', () => {
    const body = doc.querySelector('#pma .pma-legend-body');
    assert(doc.querySelector('#pma .pma-legend').classList.contains('is-collapsed'));
    assert.strictEqual(w.getComputedStyle(body).display, 'none', 'the page CSS no longer hides the collapsed body');
  });

  await test('LIHTC in the collapsed legend does not take the definition; the visible LIHTC after it gets it', () => {
    assert(!defined(legendLihtc(doc.getElementById('pma'))), 'the hidden legend LIHTC took the definition');
    assert(defined(doc.getElementById('pmaVisible')), 'the visible LIHTC is undefined');
  });

  await test('a legend clipped to zero height (max-height:0, opacity:0) counts as hidden', () => {
    assert(!defined(doc.getElementById('clippedQct')), 'the clipped legend QCT took the definition');
    assert(defined(doc.getElementById('qctVisible')), 'the visible QCT is undefined');
  });

  await test('a panel clipped to zero height at full opacity counts as hidden', () => {
    assert(!defined(doc.getElementById('clippedChfa')), 'the clipped CHFA took the definition');
    assert(defined(doc.getElementById('chfaVisible')), 'the visible CHFA is undefined');
  });

  await test('a closed <details> and a [hidden] panel count as hidden', () => {
    assert(!defined(doc.getElementById('closedAmi')) && defined(doc.getElementById('amiVisible')), 'AMI went to the closed <details>');
    assert(!defined(doc.getElementById('hiddenHud')) && defined(doc.getElementById('hudVisible')), 'HUD went to the hidden panel');
  });

  await test('a term used only inside a collapsed legend gets its definition once the legend is opened', async () => {
    assert(!defined(legendLihtc(onlyLegend)), 'the collapsed legend was defined while hidden');
    onlyLegend.querySelector('.pma-legend-toggle').click();
    assert(!onlyLegend.classList.contains('is-collapsed'), 'the legend button did not open it');
    await wait(700);
    assert(defined(legendLihtc(onlyLegend)), 'opening the legend (a class change) did not trigger a re-sweep');
  });

  console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed ✅');
  process.exit(failures ? 1 : 0);
})();
