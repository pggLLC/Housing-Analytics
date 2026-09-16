#!/usr/bin/env node
/**
 * The ownership market: shown where it exists, named where it does not.
 *
 * data/market/redfin_place_market_tracker_co.json is rebuilt on a schedule,
 * freshness-checked, 1.5 MB, 121 Colorado places — and nothing on the site
 * read it. Not one page, not one module. The only place a reader could see a
 * Redfin median was a number hand-copied into a project fixture, which names
 * the file as its source and would have drifted from it silently.
 *
 * #1620 §6 criterion 3 asks for both halves and neither existed: a covered
 * place shows its figure with a date, and an uncovered place shows "no
 * sale-price source for this place" WITH the reasons. Salida is the case the
 * issue names for the second half, deliberately, because it is a real
 * Colorado town with full need and affordability coverage and no sale-price
 * row anywhere.
 *
 * ── The thing this file mostly guards ──
 *
 * The figure is not what its name suggests. Every one of the 121 rows is
 * `redfin_zip_to_place_modeled`; the file's own limitations say "Place rows
 * are modeled aggregates from ZIP-level Redfin data, not direct Redfin place
 * statistics." Fruita's is allocated across seven ZIP codes, three of them
 * Grand Junction. One place in the file draws on forty-one ZIPs.
 *
 * So "median sale price, Fruita — $489,439" would be the most ordinary kind
 * of lie: a true number under a label that means something else. The ZIP count
 * travels with the value, the classification is `derived` and never
 * `observed`, and five rows that are a year or more behind the rest are
 * separated here rather than by whoever reads the number.
 */

import assert from 'node:assert';
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

const TRACKER = 'data/market/redfin_place_market_tracker_co.json';
const CONTEXT = {
  tracker: json(TRACKER),
  bridge: json('data/market/bridge_co_market_summary.json'),
  assessor: json('data/market/parcel_aggregates_co.json')
};

// The three cases #1620 §6 names.
const FRUITA = '0828745';
const SALIDA = '0867280';
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

test('the three validation cases are the cases the issue says they are', () => {
  // If Salida ever gains a Redfin row, the absence half below stops being
  // tested by a real place and this guard should be re-pointed deliberately.
  const places = CONTEXT.tracker.places;
  assert.ok(places[FRUITA], 'Fruita has lost its Redfin row; it is the primary covered case');
  assert.ok(places[LONGMONT], 'Longmont has lost its Redfin row');
  assert.ok(!places[SALIDA],
    'Salida now has a Redfin row. That is good news, but it was the deliberate '
    + '"ownership market unavailable" case — re-point this at another uncovered place');

  const covered = Object.keys(places).length;
  const all = Object.keys(json('data/hna/place-chas.json').places).length;
  assert.ok(covered < all * 0.5,
    `${covered} of ${all} places are covered; if that is now most of the state, the `
    + 'absence path has become the rare case and deserves re-checking');
});

/* ── A covered place: the figure, labelled as what it is ────────────────── */

test('a covered place reports its figure with its period', () => {
  const evidence = Evidence.forPlace(FRUITA, CONTEXT);
  assert.strictEqual(evidence.state, Evidence.MODELLED);
  assert.strictEqual(evidence.value, CONTEXT.tracker.places[FRUITA].latest.median_sale_price);
  assert.ok(/^\d{4}-\d{2}$/.test(evidence.period), `period is malformed: ${evidence.period}`);
});

test('the label never claims the figure is the place\'s own median', () => {
  // The whole point. A true number under a label that means something else is
  // the failure this module exists to prevent.
  for (const geoid of Object.keys(CONTEXT.tracker.places)) {
    const evidence = Evidence.forPlace(geoid, CONTEXT);
    assert.ok(/Modelled from/.test(evidence.label),
      `${geoid}: label does not say the figure is modelled — "${evidence.label}"`);
    assert.ok(!/median sale price/i.test(evidence.label),
      `${geoid}: the label calls it a median sale price for the place`);
    assert.ok(/ZIP/.test(evidence.caveat) || /ZIP/.test(evidence.label),
      `${geoid}: nothing on the figure says it came from ZIP-level data`);
  }
});

test('the ZIP count travels with every figure that has one', () => {
  const missing = [];
  for (const [geoid, record] of Object.entries(CONTEXT.tracker.places)) {
    const evidence = Evidence.forPlace(geoid, CONTEXT);
    const zips = record.latest && record.latest.source_zip_count;
    if (typeof zips === 'number' && !new RegExp(`\\b${zips}\\b`).test(evidence.label)) {
      missing.push(`${geoid} (${zips} ZIPs)`);
    }
  }
  assert.deepStrictEqual(missing.slice(0, 5), [],
    `${missing.length} figures drop the ZIP count that qualifies them`);
});

test('the figure is classified derived, never observed', () => {
  // `observed` is the badge that says someone measured this here. Nobody did:
  // it is allocated from ZIP sales to a place footprint.
  const baseline = StudyGeography.localBaseline(
    { geoid: FRUITA, geoLevel: 'place', name: 'Fruita' },
    { salePriceEvidence: Evidence.forPlace(FRUITA, CONTEXT) });
  assert.strictEqual(baseline.median_sale_price.classification, 'derived',
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
    return (Number(a[1]) * 12 + Number(a[2])) - (Number(b[1]) * 12 + Number(b[2]));
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
  assert.strictEqual(Evidence.forPlace(FRUITA, CONTEXT).state, Evidence.MODELLED);
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
    { geoid, geoLevel: 'place', name },
    {
      placeChas: json('data/hna/place-chas.json'),
      countyChas: json('data/hna/chas_affordability_gap.json'),
      amiGapPlace: json('data/co_ami_gap_by_place.json'),
      amiGapCounty: json('data/co_ami_gap_by_county.json'),
      homeValueCascade: json('data/hna/home-value-cascade.json'),
      summary: null,
      salePriceEvidence: Evidence.forPlace(geoid, CONTEXT)
    },
    { HNAOwnershipNeed: null, EffectiveDemand: null });
  const data = {
    scenarios, conventions, reportAsOf: scenarios[0].meta.as_of,
    geography,
    localBaseline: geography.localBaseline,
    observed: null
  };
  const mount = dom.window.document.getElementById('mount');
  Page.render(mount, Page.buildModel(data, {}), data);
  return mount;
}

test('a covered place renders the figure and its period', () => {
  const mount = renderFor(FRUITA, 'Fruita');
  const section = mount.querySelector('[data-sale-price]');
  assert.ok(section, 'no sale-price section rendered');
  assert.strictEqual(section.getAttribute('data-sale-price'), 'modelled');
  assert.ok(/\$489,439|\$\d{3},\d{3}/.test(section.textContent), 'no figure on screen');
  assert.ok(/ZIP/.test(section.textContent), 'the screen does not say the figure is ZIP-modelled');
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

console.log(failures === 0
  ? '  sale-price-evidence-is-named: PASS'
  : `  sale-price-evidence-is-named: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
