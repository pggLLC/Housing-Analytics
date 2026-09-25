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
  const projections = require('../data/hna/projections/08.json');
  const amiGap = require('../data/co_ami_gap_by_county.json');
  const summary = require('../data/hna/summary/08.json');
  const recomputed = generator.buildSnapshot({
    ranking: require('../data/hna/ranking-index.json'),
    acs: require('../data/market/acs_tract_metrics_co.json'),
    chfa: require('../data/chfa-lihtc.json'),
    projections,
    amiGap,
    summary,
    now: new Date(committed.generated),
  });
  assert.deepEqual(committed.values, recomputed.values, 'every homepage value equals a fresh recomputation from the source files');
  assert.deepEqual(committed.deficit_growth_basis, recomputed.deficit_growth_basis, 'the deficit-growth basis reproduces from the source files');
  // The ≤60%-AMI household-growth figure must agree with the files it is
  // derived from, re-derived here independently of the generator: DOLA
  // statewide household growth per year × HUD CHAS share of ALL households
  // at ≤60% AMI (the card subtracts rental LIHTC supply from it, so the
  // tenure basis is recorded, not assumed).
  const years = projections.years;
  const households = projections.housing_need.households_dola;
  const growthPerYear = (households[households.length - 1] - households[0]) / (years[years.length - 1] - years[0]);
  // #1822: RENTER basis, re-derived here from the source files, not read back.
  const renterShare = amiGap.statewide.households_le_ami_pct['60'] / summary.acsProfile.DP02_0001E;
  assert.equal(committed.values.annual_le60_renter_household_growth, Math.round(growthPerYear * renterShare),
    'annual_le60_renter_household_growth equals DOLA household growth/yr × CHAS renter ≤60% share of all households');
  assert.equal(committed.deficit_growth_basis.tenure, 'renter', 'the basis states the renter tenure');
  assert.equal(amiGap.statewide.demand_tenure, 'renter', 'the AMI-gap demand series the card leans on is renter-based');
  assert(committed.values.annual_le60_renter_household_growth > 0, 'the derived growth is a positive number of households');
  const allTenureShare = amiGap.statewide.all_households_le_ami_pct['60'] / summary.acsProfile.DP02_0001E;
  assert.equal(committed.deficit_growth_basis.all_tenure_comparison.annual_growth_if_all_tenure, Math.round(growthPerYear * allTenureShare),
    'the all-tenure figure is recorded as a comparison, and reproduces');
  assert(committed.deficit_growth_basis.all_tenure_comparison.annual_growth_if_all_tenure > committed.values.annual_le60_renter_household_growth,
    'the comparison shows how much the all-tenure basis overstated');

  // New construction only: re-derived from CHFA ProjectType over the same window.
  const chfa = require('../data/chfa-lihtc.json');
  const win = committed.lihtc_window;
  let newc = 0, pres = 0; const yrs = new Set();
  for (const f of chfa.features) {
    const p = f.properties || {}; const y = Number(p.YR_PIS) || 0;
    if (y <= win.start_year_exclusive || y > win.end_year_inclusive || y === 8888) continue;
    yrs.add(y);
    const u = Number(p.LI_UNITS) || Number(p.N_UNITS) || 0;
    if (/^New Construction/i.test(String(p.ProjectType || ''))) newc += u; else pres += u;
  }
  assert.equal(committed.values.average_lihtc_new_construction_units_per_year, Math.round(newc / yrs.size), 'new-construction pace re-derives from CHFA ProjectType');
  assert.equal(committed.values.average_lihtc_preservation_units_per_year, Math.round(pres / yrs.size), 'preservation pace re-derives from CHFA ProjectType');
  assert(committed.values.average_lihtc_preservation_units_per_year > 0, 'preservation is a real, separately counted share of the window');
  assert.equal(committed.values.average_lihtc_new_construction_units_per_year + committed.values.average_lihtc_preservation_units_per_year,
    committed.values.average_lihtc_units_per_year, 'new construction plus preservation is the whole window');
  assert.equal(committed.values.lihtc_new_construction_coverage_of_le60_renter_growth,
    Number((newc / yrs.size / committed.values.annual_le60_renter_household_growth).toFixed(3)),
    'coverage ratio is new-construction pace over renter growth');
  assert.deepEqual(committed.source_vintages, recomputed.source_vintages, 'vintage sidecar entries reproduce the source timestamps');
  assert(Buffer.byteLength(JSON.stringify(committed)) < 5 * 1024, 'homepage snapshot remains below 5 KB');
}

async function testHomepageRendering() {
  const dom = new JSDOM(`<!doctype html><body>
    <span id="snapCostBurden">—</span>
    <span id="snapLihtcCount">—</span>
    <span id="snapAvgUnitsPerYr">—</span>
    <span id="snapDeficitGrowth">—</span>
    <span id="snapNewConstPerYr">—</span><span id="snapRenterGrowthPerYr">—</span><span id="snapPreservationPerYr">—</span>
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
  assert.equal(
    document.getElementById('snapDeficitGrowth').textContent,
    Math.round(snapshot.values.lihtc_new_construction_coverage_of_le60_renter_growth * 100) + '% covered',
    'the card renders the coverage ratio from the snapshot, not a net and not a literal'
  );
  assert.equal(document.getElementById('snapNewConstPerYr').textContent, snapshot.values.average_lihtc_new_construction_units_per_year.toLocaleString(), 'note states the new-construction pace');
  assert.equal(document.getElementById('snapRenterGrowthPerYr').textContent, snapshot.values.annual_le60_renter_household_growth.toLocaleString(), 'note states the renter growth');
  assert.equal(document.getElementById('snapPreservationPerYr').textContent, snapshot.values.average_lihtc_preservation_units_per_year.toLocaleString(), 'note states the preservation pace separately');
  assert(calls.includes('data/home-snapshot.json'), 'homepage requests the compact snapshot');
  assert(!calls.includes('data/market/acs_tract_metrics_co.json'), 'homepage does not fetch the tract-level ACS file');
  assert(!calls.includes('data/chfa-lihtc.json'), 'homepage does not fetch the CHFA feature collection');
}

async function testNoLiteralFallback() {
  // Before 2026-09-22 js/index.js held a literal 6,500 for the household
  // growth. Without the derived basis the card must stay "—", never revert
  // to a number nothing in the data supports.
  const dom = new JSDOM(`<!doctype html><body>
    <span id="snapAvgUnitsPerYr">—</span>
    <span id="snapDeficitGrowth">—</span>
  </body>`, { url: 'http://127.0.0.1/index.html' });
  installDom(dom);
  const committed = require('../data/home-snapshot.json');
  const withoutBasis = { ...committed, values: { ...committed.values } };
  delete withoutBasis.values.annual_le60_renter_household_growth;
  window.DataService = {
    baseData: (name) => 'data/' + name,
    getJSON: (url) => (url === 'data/home-snapshot.json' ? Promise.resolve(withoutBasis) : Promise.reject(new Error('not used in fixture'))),
  };
  freshRequire('js/index.js');
  document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await flushPromises();
  await flushPromises();
  assert.equal(document.getElementById('snapAvgUnitsPerYr').textContent, committed.values.average_lihtc_units_per_year.toLocaleString(), 'supply pace still renders');
  assert.equal(document.getElementById('snapDeficitGrowth').textContent, '—', 'no renter household-growth basis → no coverage figure (no literal fallback)');
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
  await testNoLiteralFallback();
  await testVintageSidecarAndFallback();
  console.log('homepage snapshot delivery: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
