#!/usr/bin/env node
/** Source-bound sale prices: observed city medians, modeled ZIP allocations,
 * dated stale observations and explicit absence all reach screen and report. */

import assert from 'node:assert';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const Evidence = require('../js/market/sale-price-evidence.js');
const StudyGeography = require('../js/project-market-study/study-geography.js');
const ProjectScenario = require('../js/project-market-study/project-scenario.js');
const Page = require('../js/project-market-study/market-study-page.js');
const context = {window:{}};
vm.runInNewContext(read('js/hna/hna-ownership-need.js'), context);
const engines = { HNAOwnershipNeed: context.window.HNAOwnershipNeed, EffectiveDemand: require('../js/project-market-study/effective-demand.js') };

const TRACKER = 'data/market/redfin_place_market_tracker_co.json';
const CONTEXT = {
  tracker: json(TRACKER),
  bridge: json('data/market/bridge_co_market_summary.json'),
  assessor: json('data/market/parcel_aggregates_co.json')
};

// The three cases #1620 §6 names.
const FRUITA = '0828745';
const SALIDA = json('data/hna/geo-config.json').places.find(g => !CONTEXT.tracker.places[g.geoid]?.latest?.median_sale_price && json('data/hna/place-chas.json').places[g.geoid])?.geoid;
assert.ok(SALIDA, 'at least one real place still exercises unavailable sale prices');
const LONGMONT = '0845970';

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); }
};

console.log('sale-price-evidence-is-named');

/* ── The data is actually read by something ─────────────────────────────── */

test('a page reads the tracker, not only the builder and its own test', () => {
  // The defect stated directly. Before this, the readers were: the file's own
  // test, a freshness checker, and a hand-copied constant in a fixture.
  const html = read('for-sale-market-study.html');
  assert.ok(html.includes('src="js/market/sale-price-evidence.js"'),
    'for-sale-market-study.html does not load the sale-price module');
  const geo = read('js/project-market-study/study-geography.js');
  assert.ok(geo.includes(TRACKER),
    'nothing in the page path names the tracker file, so nothing fetches it');
});

/* ── Coverage is real, and so is the gap ────────────────────────────────── */

test('coverage and absence both have real source cases', () => {
  const places = CONTEXT.tracker.places;
  assert.ok(places[FRUITA]?.latest?.median_sale_price);
  assert.ok(places[LONGMONT]?.latest?.median_sale_price);
  assert.ok(!places[SALIDA]?.latest?.median_sale_price);
  assert.ok(Object.values(places).some(r => r.source_level === 'redfin_city_observed'));
  assert.ok(Object.values(places).some(r => r.source_level === 'redfin_zip_to_place_modeled'));
});

/* ── A covered place: the figure, labelled as what it is ────────────────── */

test('a covered place reports its figure with its period', () => {
  const evidence = Evidence.forPlace(FRUITA, CONTEXT);
  assert.strictEqual(evidence.state, CONTEXT.tracker.places[FRUITA].source_level === 'redfin_city_observed' ? Evidence.OBSERVED : Evidence.MODELLED);
  assert.strictEqual(evidence.value, CONTEXT.tracker.places[FRUITA].latest.median_sale_price);
  assert.ok(/^\d{4}-\d{2}$/.test(evidence.period), `period is malformed: ${evidence.period}`);
});

test('every price retains the source geography and classification', () => {
  for (const [geoid, row] of Object.entries(CONTEXT.tracker.places)) {
    const evidence = Evidence.forPlace(geoid, CONTEXT);
    if (!(row.latest.median_sale_price > 0)) { assert.strictEqual(evidence.state, Evidence.UNAVAILABLE); continue; }
    assert.strictEqual(evidence.sourceLevel, row.source_level);
    if (row.source_level === 'redfin_city_observed') assert.strictEqual(evidence.sourceSalesCount, row.latest.homes_sold_allocated);
    assert.ok(evidence.label && evidence.caveat);
    const baseline = StudyGeography.localBaseline({geoid, geoLevel:'place'}, {salePriceEvidence:evidence});
    assert.strictEqual(baseline.median_sale_price.classification,
      row.source_level === 'redfin_city_observed' ? 'observed' : 'modeled');
  }
});

test('the ZIP count travels with every figure that has one', () => {
  const missing = [];
  for (const [geoid, record] of Object.entries(CONTEXT.tracker.places)) {
    const evidence = Evidence.forPlace(geoid, CONTEXT);
    const zips = record.latest && record.latest.source_zip_count;
    if (record.source_level === 'redfin_zip_to_place_modeled' && typeof zips === 'number' && !new RegExp(`\\b${zips}\\b`).test(evidence.label)) {
      missing.push(`${geoid} (${zips} ZIPs)`);
    }
  }
  assert.deepStrictEqual(missing.slice(0, 5), [],
    `${missing.length} figures drop the ZIP count that qualifies them`);
});

test('the figure classification agrees with its source record', () => {
  // `observed` is the badge that says someone measured this here. Nobody did:
  // it is allocated from ZIP sales to a place footprint.
  const baseline = StudyGeography.localBaseline(
    { geoid: FRUITA, geoLevel: 'place', name: 'Fruita' },
    { salePriceEvidence: Evidence.forPlace(FRUITA, CONTEXT) });
  assert.strictEqual(baseline.median_sale_price.classification, CONTEXT.tracker.places[FRUITA].source_level === 'redfin_city_observed' ? 'observed' : 'modeled',
    'the modelled ZIP allocation carries the badge for a direct observation');
  assert.ok(/redfin_place_market_tracker/.test(baseline.median_sale_price.source),
    'the node does not name the file it came from');
  // And it still satisfies the scenario schema, so derive() accepts it.
  assert.ok(ProjectScenario.validateLocalBaseline(baseline));
});

/* ── A stale row is separated, not folded in ────────────────────────────── */

test('a row a year behind the rest is called stale, not current', () => {
  const asOf = CONTEXT.tracker.meta.as_of;
  const behindBy = (period) => {
    const a = /^(\d{4})-(\d{2})/.exec(asOf), b = /^(\d{4})-(\d{2})/.exec(period);
    return b ? (Number(a[1]) * 12 + Number(a[2])) - (Number(b[1]) * 12 + Number(b[2])) : 0;
  };
  const old = Object.keys(CONTEXT.tracker.places)
    .filter((g) => behindBy(CONTEXT.tracker.places[g].latest_period) > Evidence.STALE_MONTHS);
  assert.ok(old.length > 0,
    'every row is current now — good, but this guard is no longer testing anything real');
  for (const geoid of old) {
    const evidence = Evidence.forPlace(geoid, CONTEXT);
    assert.strictEqual(evidence.state, Evidence.STALE,
      `${geoid} is ${behindBy(CONTEXT.tracker.places[geoid].latest_period)} months behind and reads as current`);
    assert.ok(/months behind/.test(evidence.caveat), `${geoid}: the caveat does not say how far behind`);
    assert.ok(evidence.value !== null, `${geoid}: a stale figure was discarded rather than dated`);
  }
  // And a current row must not be swept up with them.
  assert.notStrictEqual(Evidence.forPlace(FRUITA, CONTEXT).state, Evidence.STALE);
});

/* ── An uncovered place: the absence, with its reasons ──────────────────── */

test('an uncovered place says so, and says why, from the sources\' own files', () => {
  const evidence = Evidence.forPlace(SALIDA, CONTEXT);
  assert.strictEqual(evidence.state, Evidence.UNAVAILABLE);
  assert.strictEqual(evidence.value, null, 'a figure appeared for a place with no row');
  assert.ok(/No sale-price source for this place/.test(evidence.label));

  const named = evidence.reasons.map((r) => r.source);
  for (const source of ['Redfin', 'Bridge', 'assessor']) {
    assert.ok(named.some((n) => n.includes(source)),
      `the reasons do not mention ${source}: ${named.join(', ')}`);
  }
  for (const reason of evidence.reasons) {
    assert.ok(reason.detail && reason.detail.length > 20, `${reason.source} gives no detail`);
  }
});

test('the reasons are read from the files, not written down', () => {
  // These states change. Bridge is a pending access decision and the assessor
  // endpoints are a coverage number; a hardcoded sentence would keep telling a
  // reader access was denied on the day it was granted.
  const granted = Evidence.reasons({
    tracker: CONTEXT.tracker,
    bridge: { available: true },
    assessor: { meta: { coverage_pct: 62.5, counties_attempted: 8 } }
  });
  const bridge = granted.find((r) => r.source.includes('Bridge'));
  assert.ok(/Available/.test(bridge.detail),
    'Bridge still reads as unavailable when its own file says otherwise');
  assert.strictEqual(bridge.issue, null, 'a granted source still points at its blocking issue');
  const assessor = granted.find((r) => r.source.includes('assessor'));
  assert.ok(/62\.5%/.test(assessor.detail), 'assessor coverage is not read from the file');

  // And the live files still produce the blocked wording, so the check above
  // is not passing because both branches say the same thing.
  const live = Evidence.reasons(CONTEXT);
  assert.ok(/not granted/.test(live.find((r) => r.source.includes('Bridge')).detail));
  assert.strictEqual(live.find((r) => r.source.includes('Bridge')).issue, 1611);
  assert.strictEqual(live.find((r) => r.source.includes('assessor')).issue, 1602);
});

test('an uncovered place never borrows a figure from anywhere', () => {
  const baseline = StudyGeography.localBaseline(
    { geoid: SALIDA, geoLevel: 'place', name: 'Salida' },
    { salePriceEvidence: Evidence.forPlace(SALIDA, CONTEXT),
      homeValueCascade: json('data/hna/home-value-cascade.json') });
  assert.strictEqual(baseline.median_sale_price.value, null,
    'a sale price appeared for a place with no sale-price source');
  assert.strictEqual(baseline.median_sale_price.classification, 'not_available');
  // The home value is a different measure from a different source; it must not
  // have been quietly reused as a sale price.
  const home = baseline.home_value.value;
  assert.ok(home === null || home !== baseline.median_sale_price.value,
    'the home-value estimate was reused as a closed-sale price');
});

/* ── What the reader sees ───────────────────────────────────────────────── */

const scenarios = ['fruita-commons', 'fruita-commons-compact', 'fruita-commons-family',
  'fruita-commons-broad-income'].map((n) => json(`data/fixtures/${n}.scenario.json`));
const conventions = json('data/policy/resale-conventions.json');

function renderFor(geoid, name) {
  const dom = new JSDOM('<main><div id="mount"></div><div id="marketStudyReportPreview"></div>'
    + '<button id="marketStudyReportDownload"></button></main>',
    { url: 'http://127.0.0.1/for-sale-market-study.html' });
  const geography = StudyGeography.inputs(
    { geoid, geoLevel: 'place', name, countyFips: CONTEXT.tracker.places[geoid]?.county_fips },
    {
      placeChas: json('data/hna/place-chas.json'),
      countyChas: json('data/hna/chas_affordability_gap.json'),
      amiGapPlace: json('data/co_ami_gap_by_place.json'),
      amiGapCounty: json('data/co_ami_gap_by_county.json'),
      homeValueCascade: json('data/hna/home-value-cascade.json'),
      summary: null,
      salePriceEvidence: Evidence.forPlace(geoid, CONTEXT)
    },
    engines);
  const data = {
    scenarios, conventions, reportAsOf: scenarios[0].meta.as_of,
    geography,
    localBaseline: geography.localBaseline,
    observed: StudyGeography.observedFor(geography, scenarios[0], engines.EffectiveDemand)
  };
  const mount = dom.window.document.getElementById('mount');
  Page.render(mount, Page.buildModel(data, {}), data);
  return mount;
}

test('a covered place renders the figure and its period', () => {
  const mount = renderFor(FRUITA, 'Fruita');
  const section = mount.querySelector('[data-sale-price]');
  assert.ok(section, 'no sale-price section rendered');
  assert.strictEqual(section.getAttribute('data-sale-price'), Evidence.forPlace(FRUITA, CONTEXT).state);
  assert.ok(section.textContent.includes('$' + Math.round(CONTEXT.tracker.places[FRUITA].latest.median_sale_price).toLocaleString('en-US')), 'source figure reaches screen');
  assert.ok(/\d{4}-\d{2}/.test(section.textContent), 'the screen does not date the figure');
});

test('an uncovered place renders the absence and all three reasons', () => {
  const mount = renderFor(SALIDA, 'Salida');
  const section = mount.querySelector('[data-sale-price]');
  assert.ok(section, 'no sale-price section rendered for an uncovered place');
  assert.strictEqual(section.getAttribute('data-sale-price'), 'unavailable');
  assert.ok(/No sale-price source for this place/.test(section.textContent));
  const reasons = section.querySelectorAll('.ms-reasons li');
  assert.strictEqual(reasons.length, 3, `${reasons.length} reasons shown; expected three sources`);
  assert.ok(/#1611/.test(section.textContent), 'the Bridge decision is not tracked on screen');
  assert.ok(/#1602/.test(section.textContent), 'the assessor coverage is not tracked on screen');
  // And no number anywhere in that section.
  assert.ok(!/\$\d/.test(section.textContent), 'a dollar figure appeared in the unavailable state');
});

test('the city sales-floor reason reaches the screen and the report', () => {
  // Use a known renderable geography; do not let source changes erase this case.
  const before = CONTEXT.tracker.places[FRUITA];
  CONTEXT.tracker.places[FRUITA] = {...before, source_level:'unavailable',
    latest:{median_sale_price:null}, latest_period:null, monthly:[],
    unavailable_reason:'redfin_city_sales_below_floor'};
  try {
    const evidence = Evidence.forPlace(FRUITA, CONTEXT);
    assert.strictEqual(evidence.value, null);
    assert.strictEqual(evidence.unavailableReason, 'redfin_city_sales_below_floor');
    const detail = evidence.reasons[0].detail;
    assert(detail.includes(String(CONTEXT.tracker.meta.minimum_homes_sold)), 'notice names the actual sales floor');
    const mount = renderFor(FRUITA, 'Fruita');
    const sections = [mount.querySelector('[data-sale-price]'),
      mount.ownerDocument.querySelector('#marketStudyReportPreview [data-sale-price]')];
    for (const section of sections) {
      assert(section);
      assert.strictEqual(section.dataset.unavailableReason, evidence.unavailableReason);
      assert(section.textContent.includes(detail), 'the source reason is visible, not only metadata');
      assert(!/\$\d/.test(section.textContent));
    }
  } finally { CONTEXT.tracker.places[FRUITA] = before; }
});

test('every modeled price above the county benchmark renders its review flag', () => {
  const flagged = Object.entries(CONTEXT.tracker.places).filter(([,row]) => row.review_flag);
  for (const [geoid,row] of flagged) {
    const mount = renderFor(geoid, row.name);
    const note = mount.querySelector('[data-sale-price-review]');
    assert.ok(note, geoid + ': missing visible review flag');
    assert.strictEqual(note.dataset.salePriceReview, row.review_flag.reason);
    assert.ok(note.textContent.includes(row.review_flag.note));
    const exported = mount.ownerDocument.querySelector('#marketStudyReportPreview [data-sale-price-review]');
    assert.ok(exported, geoid + ': exported report omits the review flag');
    assert.strictEqual(exported.dataset.salePriceReview, row.review_flag.reason);
    assert.ok(exported.textContent.includes(row.review_flag.note));
  }
  // Render a fixture too, so falling real prices cannot make this guard vacuous.
  const row = CONTEXT.tracker.places[FRUITA];
  const before = row.review_flag;
  row.review_flag = {reason:'modeled_sale_price_above_recent_sales',note:'Benchmark review fixture'};
  try { assert.ok(renderFor(FRUITA,'Fruita').querySelector('[data-sale-price-review]')); }
  finally { if (before) row.review_flag = before; else delete row.review_flag; }
});

console.log(failures === 0
  ? '  sale-price-evidence-is-named: PASS'
  : `  sale-price-evidence-is-named: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
