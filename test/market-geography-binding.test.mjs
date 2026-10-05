#!/usr/bin/env node
/**
 * Three markets, no cross-market leakage (#1932).
 *
 * test/for-sale-study-follows-jurisdiction.test.mjs proves the for-sale study
 * follows ONE chosen jurisdiction (Denver). This file proves it keeps three
 * different ones apart, which is the failure the issue is about: a figure
 * that is correct arithmetic about the wrong market.
 *
 *   Fruita    0828745  Mesa County 08077    — the town the example program
 *                                             and its fixtures were built for
 *   Longmont  0845970  Boulder County 08013 — a Front Range city with a much
 *                                             higher AMI and home value
 *   Wray      0886310  Yuma County 08125    — a rural eastern-plains town
 *                                             (~2,100 people) with complete
 *                                             CHAS / HUD AMI / home-value /
 *                                             ACS records but NO sale-price
 *                                             (ownership-market) source
 *
 * Wray is the "rural no-ownership-data case" of the issue's acceptance
 * criteria: every screening input exists for it, so the page runs end to end,
 * and the one thing it lacks — a Redfin sale price — is exactly where a
 * borrowed number (Fruita's, which is also the example fixture's) would hide.
 *
 * What every bound figure has to agree with is the data file it comes from,
 * for the selected geoid — not a pinned string. The rendered page and the
 * exported report are then scanned for every OTHER market's figures.
 * Rendering all three into one DOM in sequence checks that nothing of the
 * previous market survives the switch.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const StudyGeography = require('../js/project-market-study/study-geography.js');
const EffectiveDemand = require('../js/project-market-study/effective-demand.js');
const Page = require('../js/project-market-study/market-study-page.js');
const SalePriceEvidence = require('../js/market/sale-price-evidence.js');

function ownershipEngine() {
  const context = { window: {} };
  vm.runInNewContext(read('js/hna/hna-ownership-need.js'), context);
  return context.window.HNAOwnershipNeed;
}
const ENGINES = { HNAOwnershipNeed: ownershipEngine(), EffectiveDemand };

// Shared across every market, exactly as one page load shares them. If any
// market's assembly writes into these, the next market reads it.
const SHARED = {
  placeChas: json('data/hna/place-chas.json'),
  countyChas: json('data/hna/chas_affordability_gap.json'),
  amiGapPlace: json('data/co_ami_gap_by_place.json'),
  amiGapCounty: json('data/co_ami_gap_by_county.json'),
  homeValueCascade: json('data/hna/home-value-cascade.json')
};
const MARKET_SOURCES = {
  tracker: json('data/market/redfin_place_market_tracker_co.json'),
  bridge: json('data/market/bridge_co_market_summary.json'),
  assessor: json('data/market/parcel_aggregates_co.json')
};
const OWNERSHIP_NEED = json('data/hna/ownership-need.json').records;
const FIXTURE = json('data/fixtures/fruita-commons.scenario.json');
const scenarios = ['fruita-commons', 'fruita-commons-compact', 'fruita-commons-family', 'fruita-commons-broad-income']
  .map((name) => json(`data/fixtures/${name}.scenario.json`));
const conventions = json('data/policy/resale-conventions.json');

const MARKETS = [
  { geoid: '0828745', countyFips: '08077' },
  { geoid: '0845970', countyFips: '08013' },
  { geoid: '0886310', countyFips: '08125' }
];

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); }
};

const money = (v) => v.toLocaleString('en-US');

/** The context the site resolver would hand the page for this market. */
function contextFor(market) {
  const summary = json(`data/hna/summary/${market.geoid}.json`);
  return {
    geoid: market.geoid,
    geoLevel: 'place',
    name: summary.geo.label,
    countyFips: market.countyFips,
    countyName: null,
    source: 'test'
  };
}

/** What init() in market-study-page.js assembles, for one market. */
function assemble(context) {
  const paths = StudyGeography.datasetPaths(context);
  return StudyGeography.inputs(context, Object.assign({}, SHARED, {
    summary: json(paths.summary),
    salePriceEvidence: SalePriceEvidence.forPlace(context.geoid, MARKET_SOURCES)
  }), ENGINES);
}

/** The source-of-truth value of every field the study binds, read from the data files. */
function truthFor(geoid) {
  const ami = SHARED.amiGapPlace.places[geoid];
  const home = SHARED.homeValueCascade.places[geoid];
  const chas = SHARED.placeChas.places[geoid];
  const redfin = MARKET_SOURCES.tracker.places[geoid];
  const own = OWNERSHIP_NEED[geoid];
  return {
    ami: ami ? ami.ami_4person : null,
    amiCounty: ami ? ami.containing_county_fips : null,
    homeValue: home && typeof home.value === 'number' ? home.value : null,
    salePrice: redfin && redfin.latest && typeof redfin.latest.median_sale_price === 'number'
      ? redfin.latest.median_sale_price : null,
    renterHouseholds: chas.summary.total_renter_hh,
    ownerHouseholds: chas.summary.total_owner_hh,
    renterCostBurdened: chas.summary.renter_cb30_count,
    ownerCostBurdened: chas.summary.owner_cb30_count,
    moderateIncomeRenters: own.moderate_income_renter_households,
    recommendation: own.recommendation
  };
}

/**
 * Compare every bound field with its source. Returns the number of fields
 * compared, so the caller can prove the scan was not vacuous.
 */
function assertBound(geography, geoid, model) {
  const t = truthFor(geoid);
  const lb = geography.localBaseline;
  const on = geography.ownershipNeed;
  const checks = [
    ['context.geoid', geography.context.geoid, geoid],
    ['localBaseline.ami_4person', lb.ami_4person.value, t.ami],
    ['localBaseline.home_value', lb.home_value.value, t.homeValue],
    ['localBaseline.median_sale_price', lb.median_sale_price.value, t.salePrice],
    ['salePrice evidence', geography.salePrice && geography.salePrice.value, t.salePrice],
    ['ownershipNeed.geographyId', on.geographyId, geoid],
    ['ownershipNeed.renterHouseholds', on.renterHouseholds, t.renterHouseholds],
    ['ownershipNeed.ownerHouseholds', on.ownerHouseholds, t.ownerHouseholds],
    ['ownershipNeed.renterCostBurdened', on.renterCostBurdened, t.renterCostBurdened],
    ['ownershipNeed.ownerCostBurdened', on.ownerCostBurdened, t.ownerCostBurdened],
    ['ownershipNeed.moderateIncomeRenterHouseholds', on.moderateIncomeRenterHouseholds, t.moderateIncomeRenters],
    ['ownershipNeed.affordabilityTest.ami4Person', on.affordabilityTest.ami4Person, t.ami],
    ['ownershipNeed.affordabilityTest.medianHomeValue', on.affordabilityTest.medianHomeValue, t.homeValue],
    ['model.localBaseline.ami_4person', model.localBaseline.ami_4person.value, t.ami],
    ['model.localBaseline.home_value', model.localBaseline.home_value.value, t.homeValue],
    ['funnel starting pool', model.funnel && model.funnel.stages[0].outputCount, t.moderateIncomeRenters]
  ];
  // Household counts are sums of apportioned tract shares; compare them to
  // the file's own rounding, not to the last floating-point bit.
  const same = (got, want) => got === want
    || (typeof got === 'number' && typeof want === 'number' && Math.abs(got - want) < 1e-6);
  const wrong = checks.filter(([, got, want]) => !same(got, want))
    .map(([field, got, want]) => `${field} = ${got}, but the data files say ${want} for ${geoid}`);
  assert.deepStrictEqual(wrong, [], `${geoid} bound figures that are not its own:\n    ${wrong.join('\n    ')}`);
  // The AMI is the place's own row (the HUD figure for its containing
  // county), labelled as such — not a county-file or statewide substitute.
  assert.strictEqual(StudyGeography.amiGapEntry(geography.context, SHARED).gapSource, 'place');
  assert.strictEqual(t.amiCounty, json(`data/hna/summary/${geoid}.json`).geo.containingCounty,
    `${geoid}'s AMI row is for another county`);
  return checks.length;
}

/** Figures that identify one market: only its own values, large enough not to collide by chance. */
function fingerprints(geoid) {
  const t = truthFor(geoid);
  return [t.ami, t.homeValue, t.salePrice].filter((v) => typeof v === 'number' && v >= 10000).map(money);
}

function newPage() {
  const dom = new JSDOM(
    '<main><div id="mount"></div><div id="marketStudyReportPreview"></div>'
    + '<button id="marketStudyReportDownload"></button></main>',
    { url: 'http://127.0.0.1/for-sale-market-study.html' }
  );
  const exported = [];
  dom.window.HTMLAnchorElement.prototype.click = () => {};
  return { dom, exported };
}

/** Render one market into an existing page, as a fresh render() call would. */
function renderInto(page, geography) {
  const data = {
    scenarios, conventions,
    reportAsOf: scenarios[0].meta.as_of,
    geography,
    localBaseline: geography.mode === 'jurisdiction' ? geography.localBaseline : null,
    observed: StudyGeography.observedFor(geography, scenarios[0], EffectiveDemand)
  };
  const model = Page.buildModel(data, {});
  const doc = page.dom.window.document;
  Page.render(doc.getElementById('mount'), model, data);
  const button = doc.getElementById('marketStudyReportDownload');
  page.exported.length = 0;
  if (!button.disabled && button.onclick) {
    // The controller runs in this Node realm, so the download is captured here.
    const saved = { Blob: globalThis.Blob, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    globalThis.Blob = function (parts) { page.exported.push(parts.join('')); };
    URL.createObjectURL = () => 'blob:test';
    URL.revokeObjectURL = () => {};
    try { button.onclick(); } finally {
      globalThis.Blob = saved.Blob; URL.createObjectURL = saved.create; URL.revokeObjectURL = saved.revoke;
    }
  }
  return {
    model,
    button,
    text: doc.getElementById('mount').textContent + '\n' + doc.getElementById('marketStudyReportPreview').textContent,
    report: page.exported.join('\n')
  };
}

console.log('market-geography-binding');

const sharedBefore = JSON.stringify(SHARED) + JSON.stringify(MARKET_SOURCES);

/* ── The three markets are what this file says they are ───────────────── */

test('the three markets are distinct, screenable, and retain their source-bound sale prices', () => {
  for (const m of MARKETS) {
    const t = truthFor(m.geoid);
    assert.ok(t.ami && t.homeValue, `${m.geoid} lost its AMI or home value; pick another market`);
    const g = assemble(contextFor(m));
    assert.strictEqual(g.unavailable, null,
      `${m.geoid} is no longer screenable (${g.unavailable && g.unavailable.reason}); every check below would test the absence path`);
    assert.strictEqual(json(`data/hna/summary/${m.geoid}.json`).geo.containingCounty, m.countyFips,
      `${m.geoid} is not in county ${m.countyFips}`);
  }
  // Leakage is only detectable between markets whose figures differ.
  for (const key of ['ami', 'homeValue']) {
    const values = MARKETS.map((m) => truthFor(m.geoid)[key]);
    assert.strictEqual(new Set(values).size, values.length, `two markets share a ${key}; leakage between them is invisible`);
  }
  for (const m of MARKETS) assert.strictEqual(SalePriceEvidence.forPlace(m.geoid, MARKET_SOURCES).value, truthFor(m.geoid).salePrice);

});

test('the resolver follows the selected market, and so does every dataset path', () => {
  for (const m of MARKETS) {
    const context = StudyGeography.resolve({
      JurisdictionUrlContext: { resolveSync: () => ({ geoid: m.geoid, geoType: 'place', displayName: m.geoid, countyFips: m.countyFips }) }
    });
    assert.strictEqual(context.geoid, m.geoid);
    assert.strictEqual(context.countyFips, m.countyFips);
    const summaryPath = StudyGeography.datasetPaths(context).summary;
    assert.strictEqual(summaryPath, `data/hna/summary/${m.geoid}.json`);
    assert.strictEqual(json(summaryPath).geo.geoid, m.geoid, `${summaryPath} is not ${m.geoid}'s summary`);
  }
});

/* ── Each market binds its own records ────────────────────────────────── */

const perMarket = {};
for (const m of MARKETS) {
  test(`${m.geoid}: every bound figure equals that geography's own record`, () => {
    const geography = assemble(contextFor(m));
    const page = newPage();
    const rendered = renderInto(page, geography);
    const compared = assertBound(geography, m.geoid, rendered.model);
    assert.ok(compared >= 15, `only ${compared} bound fields compared for ${m.geoid}`);
    perMarket[m.geoid] = compared;
  });
}

/* ── No market's figures appear in another market's study ─────────────── */

for (const m of MARKETS) {
  test(`${m.geoid}: the page and exported report carry none of the other markets' figures`, () => {
    const page = newPage();
    const r = renderInto(page, assemble(contextFor(m)));
    assert.ok(r.report.length > 0, 'no report was exported; the report half of the scan is vacuous');
    const banner = page.dom.window.document.querySelector('[data-study-geoid]');
    assert.strictEqual(banner && banner.getAttribute('data-study-geoid'), m.geoid);
    assert.ok(r.report.includes(m.geoid) || r.report.includes(contextFor(m).name),
      'the exported report does not name the selected market');

    const own = new Set(fingerprints(m.geoid));
    const others = MARKETS.filter((o) => o.geoid !== m.geoid)
      .flatMap((o) => fingerprints(o.geoid).map((f) => [o.geoid, f]))
      .filter(([, f]) => !own.has(f));
    assert.ok(others.length >= 4, `only ${others.length} foreign figures to look for; the scan is nearly blind`);
    const leaked = others.filter(([, f]) => r.text.includes(f) || r.report.includes(f));
    assert.deepStrictEqual(leaked.map(([o, f]) => `${o}'s ${f}`), [],
      `${m.geoid}'s study shows another market's figure`);

    // And this market's own home value does reach the reader.
    const home = money(truthFor(m.geoid).homeValue);
    assert.ok(r.text.includes(home) && r.report.includes(home), `${m.geoid}'s own home value ${home} is not shown`);
  });
}

test("Wray's missing sale price is named as missing, not filled from Fruita or the fixture", () => {
  const page = newPage();
  const geography = assemble(contextFor(MARKETS[2]));
  // Simulate an absent source even when Wray gains genuine market coverage.
  geography.salePrice = SalePriceEvidence.forPlace('0886310', {...MARKET_SOURCES, tracker:{places:{}}});
  geography.localBaseline.median_sale_price = StudyGeography.localBaseline(geography.context,
    {salePriceEvidence: geography.salePrice}).median_sale_price;
  const r = renderInto(page, geography);
  const section = page.dom.window.document.querySelector('#ms-s0');
  assert.ok(section, 'the sale-price section is missing entirely');
  assert.strictEqual(section.getAttribute('data-sale-price'), 'unavailable');
  const borrowed = [truthFor('0828745').salePrice, FIXTURE.local_baseline.median_sale_price.value].map(money);
  assert.ok(borrowed.every((f) => !r.text.includes(f) && !r.report.includes(f)),
    `a sale price (${borrowed.join(' / ')}) appears in Wray's study`);
  assert.strictEqual(r.model.localBaseline.median_sale_price.value, null);
});

/* ── Switching markets leaves nothing of the previous one behind ──────── */

test('Fruita → Longmont → Wray in one page: each render carries only its own market', () => {
  const page = newPage();
  let scanned = 0;
  MARKETS.forEach((m, i) => {
    const geography = assemble(contextFor(m));
    const r = renderInto(page, geography);
    assertBound(geography, m.geoid, r.model);
    const earlier = MARKETS.slice(0, i).flatMap((o) => fingerprints(o.geoid))
      .filter((f) => !fingerprints(m.geoid).includes(f));
    scanned += earlier.length;
    const stale = earlier.filter((f) => r.text.includes(f) || r.report.includes(f));
    assert.deepStrictEqual(stale, [], `after switching to ${m.geoid}, a previous market's figure is still shown`);
    const geoids = [...page.dom.window.document.querySelectorAll('[data-study-geoid]')].map((n) => n.getAttribute('data-study-geoid'));
    assert.deepStrictEqual(geoids, [m.geoid], `the page names ${geoids.join(', ')} after switching to ${m.geoid}`);
  });
  assert.ok(scanned >= 5, `only ${scanned} previous-market figures were looked for`);
});

test('a market that could not be screened does not leave its refusal on the next one', () => {
  const page = newPage();
  const orphan = StudyGeography.inputs({ geoid: '0899999', geoLevel: 'place', name: 'Unknown' },
    Object.assign({}, SHARED, { summary: null, salePriceEvidence: null }), ENGINES);
  assert.ok(orphan.unavailable, 'the orphan geoid became screenable; pick another');
  const refused = renderInto(page, orphan);
  assert.strictEqual(refused.button.disabled, true, 'the unscreenable market offered a report');
  const next = renderInto(page, assemble(contextFor(MARKETS[1])));
  assert.strictEqual(next.button.disabled, false,
    'the report download stays disabled for a screenable market after an unscreenable one');
  assert.ok(next.report.includes(money(truthFor(MARKETS[1].geoid).homeValue)), 'the next market\'s report was not produced');
});

test('assembling the three markets wrote nothing into the shared datasets', () => {
  assert.ok(Object.keys(perMarket).length === MARKETS.length, 'not every market was checked');
  assert.ok(JSON.stringify(SHARED) + JSON.stringify(MARKET_SOURCES) === sharedBefore,
    "a market's assembly mutated the shared data; the next market would read it");
});

console.log(`  fields compared per market: ${JSON.stringify(perMarket)}`);
if (failures) {
  console.log(`\n${failures} failing`);
  process.exit(1);
}
console.log('\nall passing');
