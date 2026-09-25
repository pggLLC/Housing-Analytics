'use strict';

/**
 * When the HNA cannot load QCT or DDA boundaries, it must say the status is
 * unknown — never "0 QCT tracts" or "Non-DDA".
 *
 * hna-controller.js used to finish its tier chain with QCT_FALLBACK_CO and
 * DDA_FALLBACK_CO from hna-utils.js: rectangles whose GEOIDs were not on HUD's
 * 2026 list. QCT and DDA decide the 30% basis boost, so those were removed.
 * Removing them exposes the next defect in line: renderDdaLayer read a null
 * as "not a DDA county". This test runs both halves:
 *
 *   1. fetchQctTracts / fetchDdaForCounty, extracted from the controller and
 *      run with every tier failing, return `unavailableReason` — and with the
 *      statewide file loaded but no match for the county, return an empty
 *      collection WITHOUT one (a county with no QCT is a real zero).
 *   2. renderQctLayer / renderDdaLayer, run in jsdom, show "Unavailable" and a
 *      toggle note for the first case, and 0 / "Non-DDA" for the second.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ── 1. Fetch tiers ───────────────────────────────────────────────────────────
const controller = read('js/hna/hna-controller.js');

function extractAsyncFn(src, name) {
  const start = src.indexOf(`  async function ${name}(`);
  assert(start >= 0, `hna-controller.js must define ${name}`);
  const end = src.indexOf('\n  }\n', start);
  assert(end > start, `could not find the end of ${name}`);
  return src.slice(start, end + 4);
}

const fnSrc = extractAsyncFn(controller, 'fetchQctTracts') + '\n' + extractAsyncFn(controller, 'fetchDdaForCounty');
assert(!/(QCT|DDA)_FALLBACK_CO/.test(fnSrc), 'fetch tiers must not reference an embedded QCT/DDA fallback');

function makeFetchers({ localFile }) {
  const ctx = {
    console: { info() {}, warn() {} },
    URLSearchParams,
    window: {
      HNAUtils: {
        SOURCES: { hudQctQuery: 'https://example.invalid/qct', hudDdaQuery: 'https://example.invalid/dda' },
        CO_DDA: {},
      },
    },
    // Every live request fails.
    fetchWithTimeout: async () => { throw new Error('network down'); },
    loadJson: async (rel) => {
      if (!localFile) throw new Error('404 ' + rel);
      return localFile;
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fnSrc + '\nthis.fetchQctTracts = fetchQctTracts; this.fetchDdaForCounty = fetchDdaForCounty;', ctx);
  return ctx;
}

async function checkFetchTiers() {
  // Everything fails → unknown.
  const down = makeFetchers({ localFile: null });
  for (const [label, p] of [['QCT', down.fetchQctTracts('08031')], ['DDA', down.fetchDdaForCounty('08031')]]) {
    const r = await p;
    assert(r && typeof r.unavailableReason === 'string' && r.unavailableReason.length > 0,
      `${label}: every tier failing must return an unavailableReason, got ${JSON.stringify(r)}`);
    assert(Array.isArray(r.features) && r.features.length === 0, `${label}: an unavailable result must carry no features`);
  }

  // File loads, county has nothing in it → a known zero, not unknown.
  const empty = makeFetchers({ localFile: { type: 'FeatureCollection', features: [] } });
  for (const [label, p] of [['QCT', empty.fetchQctTracts('08031')], ['DDA', empty.fetchDdaForCounty('08031')]]) {
    const r = await p;
    assert(r && Array.isArray(r.features) && r.features.length === 0, `${label}: loaded-but-empty must return features: []`);
    assert(!r.unavailableReason, `${label}: a loaded file with no match is a real "none", not unavailable`);
  }
}

// ── 2. Renderers ─────────────────────────────────────────────────────────────
function makeRenderers() {
  const dom = new JSDOM(`<!doctype html><body>
    <label class="layer-toggle"><input type="checkbox" id="layerQct" checked><span>QCT tracts</span></label>
    <label class="layer-toggle"><input type="checkbox" id="layerDda" checked><span>DDA</span></label>
    <div id="statQctCount">—</div>
    <div id="statDdaStatus">—</div><div id="statDdaNote">HUD designation</div>
  </body>`, { runScripts: 'outside-only' });
  const w = dom.window;
  const $ = (id) => w.document.getElementById(id);
  const added = [];
  w.console = { log() {}, info() {}, warn() {}, error() {} };
  w.L = { geoJSON: (gj) => ({ gj, addTo() { added.push(gj); return this; }, remove() {} }) };
  w.HNAUtils = {};
  w.HNAState = {
    map: {},
    els: {
      statQctCount: $('statQctCount'), statDdaStatus: $('statDdaStatus'), statDdaNote: $('statDdaNote'),
      layerQct: $('layerQct'), layerDda: $('layerDda'),
    },
  };
  w.eval(read('js/hna/hna-renderers.js'));
  assert(w.HNARenderers && typeof w.HNARenderers.renderQctLayer === 'function', 'renderers must load in jsdom');
  return { R: w.HNARenderers, $, added };
}

function toggleNote($, id) {
  const n = $(id).closest('label').querySelector('.overlay-unavailable');
  return n ? n.textContent : null;
}

function checkRenderers() {
  const { R, $, added } = makeRenderers();
  const unavailable = { type: 'FeatureCollection', features: [], unavailableReason: 'test: both sources failed' };

  // Unknown.
  R.renderQctLayer(unavailable);
  assert.strictEqual($('statQctCount').textContent, 'Unavailable', 'QCT unavailable must not render a count');
  assert.match(toggleNote($, 'layerQct') || '', /unavailable/, 'QCT toggle must say the layer is unavailable');

  R.renderDdaLayer('08031', unavailable, { type: 'county', name: 'Denver County' });
  assert.strictEqual($('statDdaStatus').textContent, 'Unavailable', 'DDA unavailable must not render "Non-DDA"');
  assert.doesNotMatch($('statDdaNote').textContent, /is not in a HUD Difficult Development Area/,
    'DDA unavailable must not claim the area is outside a DDA');
  assert.match(toggleNote($, 'layerDda') || '', /unavailable/, 'DDA toggle must say the layer is unavailable');

  // A bare null is also unknown, never "Non-DDA".
  R.renderDdaLayer('08031', null, { type: 'county', name: 'Denver County' });
  assert.strictEqual($('statDdaStatus').textContent, 'Unavailable', 'null DDA data must render as unavailable');

  assert.strictEqual(added.length, 0, 'nothing may be drawn for an unavailable overlay');

  // Known zero — the other direction. The note clears when data arrives.
  const none = { type: 'FeatureCollection', features: [] };
  R.renderQctLayer(none);
  assert.strictEqual($('statQctCount').textContent, '0', 'a loaded county with no QCTs shows 0');
  assert.strictEqual(toggleNote($, 'layerQct'), null, 'the unavailable note must clear once QCT data loads');

  R.renderDdaLayer('08031', none, { type: 'county', name: 'Denver County' });
  assert.strictEqual($('statDdaStatus').textContent, 'Non-DDA', 'a loaded county with no DDA shows Non-DDA');
  assert.strictEqual(toggleNote($, 'layerDda'), null, 'the unavailable note must clear once DDA data loads');
}

(async () => {
  await checkFetchTiers();
  checkRenderers();
  console.log('hna-qct-dda-unavailable: PASS (fetch tiers report unavailableReason; renderers show unknown, not 0 / Non-DDA)');
})().catch((e) => { console.error(e); process.exit(1); });
