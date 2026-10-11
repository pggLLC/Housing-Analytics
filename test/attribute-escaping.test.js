'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { parseScript } = require('meriyah');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
// All values are invented. Exercise both attribute delimiters, entity handling,
// and text that would create a second attribute if either quote escaped intact.
const value = `Invented " data-injected="yes ' data-single='yes <&> &quot;`;
const helpers = [
  ['js/pma-ui-controller.js', '_esc'],
  ['js/market-analysis/site-comparison.js', '_esc'],
  ['js/historical-trends.js', 'esc'],
];
function functionNode(node, name) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'FunctionDeclaration' && node.id.name === name) return node;
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) {
      for (const item of child) { const found = functionNode(item, name); if (found) return found; }
    } else if (child && typeof child === 'object') {
      const found = functionNode(child, name); if (found) return found;
    }
  }
  return null;
}
function attribute(el, name) {
  assert(el, name + ' attribute consumer rendered');
  assert.equal(el.getAttribute(name), value, name + ' preserves the complete original value');
  assert(!el.hasAttribute('data-injected') && !el.hasAttribute('data-single'), 'value cannot inject attributes');
}
async function main() {
  let checked = 0;
  for (const [file, name] of helpers) {
    const source = read(file);
    const node = functionNode(parseScript(source, { ranges: true }), name);
    assert(node, file + ' exposes a local helper to the source-level guard');
    const dom = new JSDOM('', { runScripts: 'outside-only' });
    try {
      const escape = dom.window.eval('(' + source.slice(...node.range) + ')');
      for (const delimiter of ['"', "'"]) {
        dom.window.document.body.innerHTML = '<span data-value=' + delimiter + escape(value) + delimiter + '>Invented label</span>';
        attribute(dom.window.document.querySelector('span'), 'data-value');
        assert.equal(dom.window.document.body.children.length, 1);
      }
    } finally { dom.window.close(); }
    checked++;
  }
  assert.equal(checked, 3, 'all three attribute-reaching helpers checked');

  // Render the real PMA fallback card, without the optional external renderer.
  const pma = new JSDOM('<div id="lihtcConceptCard"></div>', { url: 'https://example.com/', runScripts: 'outside-only' });
  try {
    const w = pma.window, handlers = {};
    w.setTimeout = () => 0;
    w.fetch = () => Promise.resolve({ ok: false });
    const predictor = require(path.join(root, 'js/lihtc-deal-predictor.js'));
    w.LIHTCDealPredictor = { predictConcept(input) {
      const rec = predictor.predictConcept(input);
      rec.indicativeCapitalStack.unavailableReason = value;
      return rec;
    } };
    w.PMAAnalysisRunner = { run: () => ({ on(event, fn) { handlers[event] = fn; return this; } }) };
    w.eval(read(helpers[0][0]));
    w.PMAUIController.runEnhanced(39.123, -105.123);
    handlers.complete({ pma: {} });
    attribute(w.document.querySelector('[data-unavailable-reason]'), 'data-unavailable-reason');
  } finally { pma.window.close(); }

  const comparison = new JSDOM('<div id="siteCompTable"></div>', { url: 'https://example.com/', runScripts: 'outside-only' });
  try {
    const w = comparison.window;
    w.SiteState = { get: () => [{ id: value, label: 'Invented site', demand: 52, subsidy: null, subsidyUnavailableReason: value }] };
    w.eval(read(helpers[1][0]));
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    attribute(w.document.querySelector('[data-site-id]'), 'data-site-id');
    attribute(w.document.querySelector('[data-remove]'), 'data-remove');
    attribute(w.document.querySelector('td.sc-dim--unavailable'), 'title');
  } finally { comparison.window.close(); }

  const history = new JSDOM('<select id="benchCounty"></select><div id="htErrorBanner" hidden></div>', { url: 'https://example.com/', runScripts: 'outside-only' });
  try {
    const w = history.window;
    w.fetch = async url => ({ ok: true, json: async () => String(url).includes('chfa-lihtc.json') ? { features: [{ properties: { CNTY_NAME: value } }] } : null });
    w.LihtcByYear = { series: () => ({}), projects: () => [] };
    w.eval(read(helpers[2][0]));
    w.HistoricalTrends.render();
    await new Promise(resolve => w.setTimeout(resolve, 0));
    assert.equal(w.document.getElementById('htErrorBanner').textContent, '', 'history render completed');
    attribute(w.document.querySelectorAll('#benchCounty option')[1], 'value');
  } finally { history.window.close(); }
  console.log('attribute-escaping: PASS (3 helpers, both quote delimiters, 5 real DOM attribute sinks; invented data only)');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
