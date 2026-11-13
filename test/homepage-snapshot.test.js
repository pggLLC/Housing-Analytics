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
  // Burden is weighted by the renters Census scores (B25070 total less "not
  // computed"), not every renter household, once the tract file carries it.
  const weighted = generator.buildSnapshot({
    ranking: require('../data/hna/ranking-index.json'),
    acs: { meta: require('../data/market/acs_tract_metrics_co.json').meta, tracts: [
      { renter_hh: 100, cost_burden_universe: 90, cost_burden_rate: 0.6 },
      { renter_hh: 100, cost_burden_universe: 10, cost_burden_rate: 0.2 },
      // A 0% tract stays in the denominator; a missing rate is left out.
      { renter_hh: 50, cost_burden_universe: 25, cost_burden_rate: 0 },
      { renter_hh: 50, cost_burden_universe: 40, cost_burden_rate: null },
    ] },
    chfa: require('../data/chfa-lihtc.json'),
    projections, amiGap, summary,
    now: new Date(committed.generated),
  });
  assert.equal(weighted.values.renter_cost_burden_pct, 44.8, 'burden weights by cost_burden_universe, 0% tracts included, missing rates out: (0.6x90 + 0.2x10 + 0x25) / 125');
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

// Home is drawn by hub/home.js since the 13 Nov 2026 rebuild (index.html); the old js/index.js is gone. The
// three tests below held that script to the snapshot. They now hold the page as drawn, from the same file, and
// from stand-in copies of it for the cases today's data does not contain.
const home = require('./helpers/render-home');
const SNAP = 'data/home-snapshot.json';
// One "at a glance" card by a word in its title: its headline value and all of its text.
function glanceCard(html, re) {
  const cards = [...html.matchAll(/<article class="hg-card"><h3>([\s\S]*?)<\/h3><p class="hg-value">([\s\S]*?)<\/p>([\s\S]*?)<\/article>/g)]
    .map((m) => ({ title: home.text(m[1]), value: home.text(m[2]), text: home.text(m[3]) }));
  const hit = cards.find((c) => re.test(c.title));
  assert(hit, `Home has no "at a glance" card matching ${re}`);
  return hit;
}
function factRow(html, re) {
  const rows = [...html.matchAll(/<li><span class="fact-value">([\s\S]*?)<\/span><span class="fact-label">([\s\S]*?)<\/span>/g)].map((m) => ({ value: home.text(m[1]), label: home.text(m[2]) }));
  const hit = rows.find((r) => re.test(r.label));
  assert(hit, `Home has no fact row matching ${re}`);
  return hit;
}

async function testHomepageRendering() {
  const snapshot = require('../data/home-snapshot.json');
  const html = await home.renderHome();
  const v = snapshot.values;
  assert.equal(glanceCard(html, /Renters paying 30%/).value, v.renter_cost_burden_pct.toFixed(1) + '%');
  assert.equal(factRow(html, /tax credit properties/i).value, v.lihtc_property_count.toLocaleString('en-US'));
  assert.equal(factRow(html, /Tax credit homes a year/i).value, v.average_lihtc_units_per_year.toLocaleString('en-US'));
  const coverage = glanceCard(html, /New tax-credit homes against/);
  assert.equal(coverage.value, Math.round(v.lihtc_new_construction_coverage_of_le60_renter_growth * 100) + '% covered',
    'the card renders the coverage ratio from the snapshot, not a net and not a literal');
  assert(coverage.text.includes(v.average_lihtc_new_construction_units_per_year.toLocaleString('en-US') + ' homes a year'), 'note states the new-construction pace');
  assert(coverage.text.includes(v.annual_le60_renter_household_growth.toLocaleString('en-US') + ' a year'), 'note states the renter growth');
  assert(coverage.text.includes(v.average_lihtc_preservation_units_per_year.toLocaleString('en-US') + ' a year'), 'note states the preservation pace separately');
  const calls = (await home.boot()).fetched;
  assert(calls.includes(SNAP), 'homepage requests the compact snapshot');
  assert(!calls.includes('data/market/acs_tract_metrics_co.json'), 'homepage does not fetch the tract-level ACS file');
  // Changed with the rebuild, and said plainly: the old page read its figures from the snapshot alone. The
  // rebuilt page still reads its headline figures from the snapshot, but its town search and county map share the
  // Places hub's place data, which includes the CHFA feature collection. The figures above must not come from it:
  // they are checked against the snapshot, and the stand-in tests below change only the snapshot.
  assert(/snap: 'data\/home-snapshot\.json'/.test(require('node:fs').readFileSync(path.join(ROOT, 'hub', 'home.js'), 'utf8')), 'hub/home.js reads its statewide figures from the compact snapshot');
}

async function testNoLiteralFallback() {
  // Before 2026-09-22 js/index.js held a literal 6,500 for the household
  // growth. Without the derived basis the card must stay "—", never revert
  // to a number nothing in the data supports.
  const committed = require('../data/home-snapshot.json');
  const withoutBasis = { ...committed, values: { ...committed.values } };
  delete withoutBasis.values.annual_le60_renter_household_growth;
  const html = await home.renderHomeWith({ [SNAP]: withoutBasis });
  assert.equal(factRow(html, /Tax credit homes a year/i).value, committed.values.average_lihtc_units_per_year.toLocaleString('en-US'), 'supply pace still renders');
  const coverage = glanceCard(html, /New tax-credit homes against/);
  assert.equal(coverage.value, '—', 'no renter household-growth basis → no coverage figure (no literal fallback)');
  assert(!/\b6,500\b/.test(home.text(html)), 'the old literal 6,500 is not on the page');
  assert(!coverage.text.includes(committed.values.annual_le60_renter_household_growth.toLocaleString('en-US') + ' a year'), 'the note does not state a growth figure the snapshot no longer carries');
}

async function testNullIsNotZero() {
  // Number(null) is 0 (#1480): a null burden or preservation pace in the
  // snapshot must leave "—", not render "0.0%" or "0".
  const committed = require('../data/home-snapshot.json');
  const nulls = { ...committed, values: { ...committed.values, renter_cost_burden_pct: null, average_lihtc_preservation_units_per_year: null } };
  const html = await home.renderHomeWith({ [SNAP]: nulls });
  const coverage = glanceCard(html, /New tax-credit homes against/);
  assert.notEqual(coverage.value, '—', 'the fixture still renders the rest of the snapshot');
  assert.equal(glanceCard(html, /Renters paying 30%/).value, '—', 'null burden is unknown, not 0.0%');
  assert(!/\b0(\.0)?%\s+of Colorado renters/.test(home.text(html)), 'the strip under the search does not show 0% for an unknown burden');
  assert(/rehab \(— a year\)/.test(coverage.text) && !/rehab \(0 a year\)/.test(coverage.text), 'null preservation pace is unknown, not 0');
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

async function testStatewideNullYearStaysAbsent() {
  // The statewide projection writes null for a year any county cannot value
  // (#2260). Number(null) is 0 (#1480), so both consumers of that file must
  // treat the null as absent: the generator refuses to derive a growth from
  // it, and the homepage leaves the 20-year need at "—". The control case,
  // the committed file, must still produce the positive figure.
  const generator = await import(pathToFileURL(path.join(ROOT, 'scripts/build-home-snapshot.mjs')).href);
  const projections = require('../data/hna/projections/08.json');
  const amiGap = require('../data/co_ami_gap_by_county.json');
  const summary = require('../data/hna/summary/08.json');
  const lastIdx = projections.years.length - 1;
  assert(typeof projections.housing_need.households_dola[lastIdx] === 'number', 'committed statewide series has a horizon value (the control is not vacuous)');
  const control = generator.deriveLe60HouseholdGrowth({ projections, amiGap, summary });
  assert(control.annual_le60_renter_household_growth > 0, 'committed file still derives a positive growth');
  const nullYear = JSON.parse(JSON.stringify(projections));
  nullYear.housing_need.households_dola[lastIdx] = null;
  nullYear.housing_need.incremental_units_needed_dola[lastIdx] = null;
  assert.throws(
    () => generator.deriveLe60HouseholdGrowth({ projections: nullYear, amiGap, summary }),
    /no value at the base or horizon year/,
    'a null horizon household value stops the snapshot build instead of deriving a negative growth from 0'
  );

  const render = async (proj) => glanceCard(await home.renderHomeWith({ 'data/hna/projections/08.json': proj }), /Homes Colorado needs by/).value;
  const expected = Math.round(projections.housing_need.incremental_units_needed_dola[lastIdx]).toLocaleString('en-US');
  assert.equal(await render(projections), expected, 'homepage renders the committed 20-year need');
  assert.equal(await render(nullYear), '—', 'a null 20-year need stays "—", not 0');
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
  await testNullIsNotZero();
  await testStatewideNullYearStaysAbsent();
  await testVintageSidecarAndFallback();
  testDecisionLineMatchesCoverage(await home.renderHome());
  console.log('homepage snapshot delivery: PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

function testDecisionLineMatchesCoverage(homeHtml) {
  // The decision text sits under the four key numbers. It says new tax-credit
  // homes cover "only part" of new low-income renters; that is true only while
  // the ratio the coverage card renders is below 1.
  const decide = /<div class="hg-read">([\s\S]*?)<\/div>/.exec(homeHtml);
  assert(decide, 'Home has the "why this matters / what to decide" block');
  const coverage = require('../data/home-snapshot.json').values.lihtc_new_construction_coverage_of_le60_renter_growth;
  assert(Number.isFinite(coverage) && coverage > 0, 'fixture: the snapshot carries a coverage ratio');
  // Each phrase the line may use, and the ratio it is true for.
  const PHRASES = [
    [/cover only part/, (c) => c < 1, 'below 1'],
    [/cover all\b/, (c) => c >= 1, 'at least 1'],
    [/cover more than/, (c) => c > 1, 'above 1'],
  ];
  const used = PHRASES.filter(([re]) => re.test(decide[1]));
  assert(used.length > 0, 'the decision line still states what the coverage ratio shows');
  for (const [re, holds, needs] of used) {
    assert(holds(coverage), `the decision line says ${re} but coverage is ${coverage}, not ${needs}; reword it`);
  }
}
