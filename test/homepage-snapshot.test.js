#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');

function freshRequire(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  delete require.cache[require.resolve(absolutePath)];
  return require(absolutePath);
}

function installDom(dom) {
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  global.fetch = dom.window.fetch;
}

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function testSnapshotFidelity() {
  const generator = await import(pathToFileURL(path.join(ROOT, 'scripts/build-home-snapshot.mjs')).href);
  const committed = require('../data/home-snapshot.json');
  const recomputed = generator.buildSnapshot({
    ranking: require('../data/hna/ranking-index.json'),
    acs: require('../data/market/acs_tract_metrics_co.json'),
    chfa: require('../data/chfa-lihtc.json'),
    now: new Date(committed.generated),
  });
  assert.deepEqual(committed.values, recomputed.values, 'all three homepage values equal a fresh recomputation from the source files');
  assert.deepEqual(committed.source_vintages, recomputed.source_vintages, 'vintage sidecar entries reproduce the source timestamps');
  assert(Buffer.byteLength(JSON.stringify(committed)) < 5 * 1024, 'homepage snapshot remains below 5 KB');
}

async function testHomepageRendering() {
  const dom = new JSDOM(`<!doctype html><body>
    <span id="snapCostBurden">—</span>
    <span id="snapLihtcCount">—</span>
    <span id="snapAvgUnitsPerYr">—</span>
    <span id="snapDeficitGrowth">—</span>
  </body>`, { url: 'http://127.0.0.1/index.html' });
  installDom(dom);
  const snapshot = require('../data/home-snapshot.json');
  const calls = [];
  window.DataService = {
    baseData: (name) => 'data/' + name,
    getJSON: (url) => {
      calls.push(url);
      return url === 'data/home-snapshot.json' ? Promise.resolve(snapshot) : Promise.reject(new Error('not used in fixture'));
    },
  };
  freshRequire('js/index.js');
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await flushPromises();
  await flushPromises();

  assert.equal(document.getElementById('snapCostBurden').textContent, snapshot.values.renter_cost_burden_pct.toFixed(1) + '%');
  assert.equal(document.getElementById('snapLihtcCount').textContent, snapshot.values.lihtc_property_count.toLocaleString());
  assert.equal(document.getElementById('snapAvgUnitsPerYr').textContent, snapshot.values.average_lihtc_units_per_year.toLocaleString());
  assert(calls.includes('data/home-snapshot.json'), 'homepage requests the compact snapshot');
  assert(!calls.includes('data/market/acs_tract_metrics_co.json'), 'homepage does not fetch the tract-level ACS file');
  assert(!calls.includes('data/chfa-lihtc.json'), 'homepage does not fetch the CHFA feature collection');
}

async function runBadgeFixture(snapshot, sourceResult) {
  const dom = new JSDOM('<!doctype html><body><div id="target" data-vintage-source="data/hna/ranking-index.json"></div></body>', {
    url: 'http://127.0.0.1/index.html',
  });
  installDom(dom);
  const addEventListener = document.addEventListener.bind(document);
  document.addEventListener = function (type, listener, options) {
    if (type === 'DOMContentLoaded') return undefined;
    return addEventListener(type, listener, options);
  };
  const calls = [];
  window.safeFetchJSON = (url) => {
    calls.push(url);
    if (url === 'data/home-snapshot.json') return Promise.resolve(snapshot);
    if (url === 'data/hna/ranking-index.json') return Promise.resolve(sourceResult);
    return Promise.reject(new Error('unexpected URL'));
  };
  freshRequire('js/components/data-vintage-badge.js');
  window.DataVintageBadge.scan();
  await flushPromises();
  await flushPromises();
  return { calls, badge: document.querySelector('.data-vintage-badge') };
}

async function testVintageSidecarAndFallback() {
  const committed = require('../data/home-snapshot.json');
  const sidecar = await runBadgeFixture(committed, null);
  assert(sidecar.badge, 'sidecar timestamp renders a vintage badge');
  assert.deepEqual(sidecar.calls, ['data/home-snapshot.json'], 'a migrated source does not fetch the multi-megabyte source file');

  const fallback = await runBadgeFixture({ source_vintages: {} }, {
    metadata: { generatedAt: '2026-01-02T03:04:05Z' },
  });
  assert(fallback.badge, 'unmigrated source still renders through the established full-file fallback');
  assert.deepEqual(fallback.calls, ['data/home-snapshot.json', 'data/hna/ranking-index.json']);
}

(async function main() {
  await testSnapshotFidelity();
  await testHomepageRendering();
  await testVintageSidecarAndFallback();
  console.log('homepage snapshot delivery: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
