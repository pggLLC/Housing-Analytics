'use strict';

/**
 * js/housing-predictions.js reads data/kalshi/prediction-market.json, where a
 * contract with no price carries prob null. That absence must survive to the
 * chart: an unpriced contract is not drawn as 0%, and a file with no priced
 * contract at all is not presented as live odds.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'js/housing-predictions.js'), 'utf8');

async function render(payload) {
  const dom = new JSDOM('<!doctype html><body><section id="housing-predictions-section"></section></body>', {
    runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  const charts = {};
  w.HTMLCanvasElement.prototype.getContext = function () { return { canvas: this }; };
  w.Chart = function (ctx, cfg) { charts[ctx.canvas.id] = cfg; this.destroy = () => {}; };
  w.fetch = async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(payload)) });
  w.eval(SRC);
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 20));
  return { charts, text: w.document.getElementById('housing-predictions-section').textContent };
}

(async () => {
  let failures = 0;
  async function run(name, fn) {
    try { await fn(); console.log('  ✓ ' + name); }
    catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
  }
  console.log('housing-predictions-null-odds');

  const item = (outcomes) => ({ metric: 'housing_starts', label: 'Starts', outcomes });

  await run('unpriced contracts are left out of the chart, not drawn as 0%', async () => {
    const { charts } = await render({ updated: '2026-10-04T00:00:00Z', items: [item([
      { name: 'above 1.10M', prob: 0.95 }, { name: 'above 1.30M', prob: null }, { name: 'above 1.45M', prob: 0.08 }
    ])] });
    const starts = charts['hp-chart-starts'];
    assert.ok(starts, 'the starts chart must render (non-vacuity)');
    assert.deepEqual(Array.from(starts.data.labels), ['above 1.10M', 'above 1.45M']);
    assert.deepEqual(Array.from(starts.data.datasets[0].data), [95, 8]);
  });

  await run('a file with no priced contract is not presented as live', async () => {
    const committed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/kalshi/prediction-market.json'), 'utf8'));
    const allNull = committed.items.every((i) => (i.outcomes || []).every((o) => o.prob == null));
    const { text, charts } = await render(allNull ? committed : { updated: '2026-10-04T00:00:00Z', items: [item([{ name: 'a', prob: null }])] });
    assert.ok(!/Live prediction-market data loaded/.test(text), 'all-null odds must not carry the live banner');
    assert.ok(/illustrative/i.test(text), 'the illustrative banner shows instead');
    const starts = charts['hp-chart-starts'];
    assert.ok(starts && !Array.from(starts.data.labels).some((l) => /September 2026/.test(l)),
      'no unpriced contract from the file reaches the chart');
  });

  if (failures) { console.error(failures + ' failing'); process.exit(1); }
  console.log('all passed');
})();
