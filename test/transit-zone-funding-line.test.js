'use strict';

// #1937 Phase 4 — the transit zone in the PMA and the deal calculator.
//
// Owner decision: zone status is an eligibility gate plus a funding line,
// NOT a weighted PMA dimension. Pinned here as agreements:
//   * the PMA score's weights contain no transit dimension, and the
//     methodology explainer names the dimensions the weights actually have;
//   * the PMA gate is the TransitZone answer (same helper, same files) and it
//     is what the deal calculator receives;
//   * the deal calculator's Transit Zone line appears only for a pass via a
//     confirmed stop, adds no amount, and quotes the statewide cap and QAP
//     section the repo's own sources state.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const TZ = require('../js/transit-zone.js');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }
console.log('\ntransit-zone-funding-line');

// ── The score stays the score ───────────────────────────────────────────────
const scoring = read('js/market-analysis-scoring.js');
const weightsSrc = (scoring.match(/var WEIGHTS = \{([\s\S]*?)\};/) || [])[1];
assert.ok(weightsSrc, 'WEIGHTS not found in js/market-analysis-scoring.js');
const weightKeys = [...weightsSrc.matchAll(/(\w+):\s*[\d.]+/g)].map((m) => m[1]);

test('the PMA score has no transit dimension', () => {
  assert.ok(weightKeys.length >= 3, 'WEIGHTS scan found too few dimensions');
  assert.ok(!weightKeys.some((k) => /transit|tod|zone/i.test(k)), `WEIGHTS includes a transit dimension: ${weightKeys}`);
});

test('the methodology explainer names the dimensions the weights have', () => {
  const ex = read('js/methodology-explainer.js');
  const what = (ex.match(/'pma-composite':\s*\{[\s\S]*?what:\s*'([^']*)'/) || [])[1];
  assert.ok(what, 'pma-composite explainer not found');
  const n = Number((what.match(/blending (\d+)/) || [])[1]);
  assert.equal(n, weightKeys.length, `explainer says ${n} dimensions; WEIGHTS has ${weightKeys.length}`);
  for (const k of weightKeys) {
    const words = k.replace(/([A-Z])/g, ' $1').toLowerCase();
    assert.ok(what.toLowerCase().includes(words), `explainer omits the "${words}" dimension`);
  }
});

// ── The PMA gate ────────────────────────────────────────────────────────────
const ma = read('js/market-analysis.js');
const gateSrc = (ma.match(/  var _tzMapStatus = null[\s\S]*?\n  function _renderTransitZoneGate[\s\S]*?\n  \}\n/) || [])[0];
assert.ok(gateSrc, '_renderTransitZoneGate not found in js/market-analysis.js');

test('the gate never writes the score', () => {
  assert.doesNotMatch(gateSrc, /pmaScore(Circle|Tier|Scale)/);
  const html = read('market-analysis.html');
  const card = html.slice(html.indexOf('id="pmaScoreWrap"'), html.indexOf('id="pmaRunBtn"'));
  assert.match(card, /id="pmaTransitZoneGate"/, 'the gate is not beside the score');
  assert.ok(html.indexOf('src="js/transit-zone.js"') > 0, 'market-analysis.html does not load js/transit-zone.js');
});

const stops = readJson('data/amenities/transit_stops_statewide_co.geojson');
const mapStatus = readJson('data/policy/thiz-map-status.json');
function runGate(lat, lon, opts) {
  opts = opts || {};
  const dom = new JSDOM('<!doctype html><div id="pmaTransitZoneGate" hidden></div>');
  let dcArg;
  const ctx = {
    // Same helper, clock pinned to the day after the stop file's build so
    // the pass/outside cases keep asserting after the file ages.
    window: { TransitZone: opts.noHelper ? undefined
                : { create: (o) => TZ.create(Object.assign({ now: new Date(Date.parse(stops.meta.generated) + 86400e3) }, o)) },
              __DealCalc: { setTransitZoneContext: (r) => { dcArg = r; } } },
    document: dom.window.document,
    el: (id) => dom.window.document.getElementById(id),
    _rawLayerData: { transitStops: opts.noStops ? undefined : stops },
    siteLatLng: null,
    _requestTodStops: () => {},
    fetch: () => new Promise(() => {}),
  };
  vm.createContext(ctx);
  vm.runInContext(gateSrc + `
    _tzMapStatus = ${JSON.stringify(opts.mapStatus === undefined ? mapStatus : opts.mapStatus)};
    _tzMapStatusState = ${JSON.stringify(opts.state || 'ok')};
    _tzStopsFailed = ${!!opts.stopsFailed};
    var __r = _renderTransitZoneGate(${lat}, ${lon});`, ctx);
  const box = dom.window.document.getElementById('pmaTransitZoneGate');
  return { r: ctx.__r, box, dcArg };
}
// Real stops are dated; judge them the day after their build.
const zone = TZ.create({ stops, mapStatus, now: new Date(Date.parse(stops.meta.generated) + 86400e3) });

test('a site near confirmed transit passes, and the deal calculator gets the same answer', () => {
  const { r, box, dcArg } = runGate(39.7527, -105.0003);   // Union Station
  const expect = zone.status(39.7527, -105.0003);
  assert.equal(r.status, expect.status);
  assert.equal(r.status, 'within_2mi');
  assert.equal(box.getAttribute('data-tz-state'), 'within_2mi');
  assert.match(box.textContent, /Passes the 2-mile screen/);
  assert.match(box.textContent, /Soft Funding Stack/);
  assert.equal(box.querySelector('[data-tz-designation]').textContent, r.designationNote);
  assert.equal(dcArg, r, 'the deal calculator did not receive the gate result');
});

test('a site far from transit is outside, with no funding pointer', () => {
  const { r, box } = runGate(38.82, -102.35);               // Cheyenne County plains
  assert.equal(r.status, 'outside');
  assert.match(box.textContent, /Outside the 2-mile screen/);
  assert.doesNotMatch(box.textContent, /Soft Funding Stack/);
});

for (const [label, opts, re] of [
  ['stop data failed to load', { noStops: true, stopsFailed: true }, /Transit stop data did not load/],
  ['the zone-map status failed to load', { state: 'failed' }, /zone-map status file did not load/],
  ['the zone helper is missing', { noHelper: true }, /zone screen did not load/],
]) {
  test(`${label} → Unavailable, and the deal calculator is cleared`, () => {
    const { r, box, dcArg } = runGate(39.7527, -105.0003, opts);
    assert.equal(r, null);
    assert.equal(box.getAttribute('data-tz-state'), 'unavailable');
    assert.match(box.textContent, /Unavailable/);
    assert.match(box.textContent, re);
    assert.equal(dcArg, null);
  });
}

// ── The deal calculator's funding line ──────────────────────────────────────
function dealCalc() {
  const dom = new JSDOM('<!doctype html><div id="dc-tz-note" hidden></div>', { runScripts: 'outside-only' });
  dom.window.fetch = () => Promise.reject(new Error('offline'));
  dom.window.eval(read('js/deal-calculator.js'));
  return { w: dom.window, note: dom.window.document.getElementById('dc-tz-note') };
}
const PASS = { status: 'within_2mi', confirmedOnly: true, radiusMiles: 2, designation: 'provisional', designationNote: 'Provisional — test note.' };

test('the line shows only for a pass via a confirmed stop, and states no amount for the project', () => {
  const { w, note } = dealCalc();
  w.__DealCalc.setTransitZoneContext(PASS);
  assert.equal(note.hidden, false);
  assert.match(note.textContent, /not added to this stack/);
  assert.match(note.textContent, /No per-project amount exists/);
  assert.equal(note.querySelector('[data-tz-designation]').textContent, PASS.designationNote);
  for (const r of [Object.assign({}, PASS, { confirmedOnly: false }), Object.assign({}, PASS, { status: 'outside' }),
                   { status: 'unavailable', unavailableReason: 'x' }, null]) {
    w.__DealCalc.setTransitZoneContext(r);
    assert.equal(note.hidden, true, JSON.stringify(r));
    assert.equal(note.textContent, '');
  }
});

test('the line sits in the rental-only Soft Funding Stack (ownership never sees it)', () => {
  const src = read('js/deal-calculator.js');
  const i = src.indexOf('id="dc-tz-note"');
  const fieldsetOpen = src.lastIndexOf('<fieldset', i);
  assert.match(src.slice(fieldsetOpen, fieldsetOpen + 120), /data-dc-mode="rental"/);
  assert.ok(src.slice(fieldsetOpen, i).includes('Soft Funding Stack'));
});

test('the statewide cap and QAP section agree with the repo\'s sources', () => {
  const { w, note } = dealCalc();
  w.__DealCalc.setTransitZoneContext(PASS);
  const shown = Number((note.textContent.match(/up to \$([\d.]+) million a year/) || [])[1]);
  const leg = readJson('data/policy/tax-credit-legislation.json');
  const entries = Array.isArray(leg) ? leg : (leg.entries || leg.credits || leg.items || []);
  const e = entries.find((x) => /hb26-1065/i.test(x.id || ''));
  const cap = Number((e.pricing_impact.match(/\$([\d.]+)M annually/) || [])[1]);
  assert.ok(cap > 0, 'cap not found in the HB26-1065 legislation entry');
  assert.equal(shown, cap, `deal calculator says $${shown}M; the legislation entry says $${cap}M`);
  const years = (e.pricing_impact.match(/in (\d{4})-(\d{4})/) || []).slice(1);
  assert.ok(note.textContent.includes(`${years[0]}–${years[1]}`), `the line's years differ from ${years.join('-')}`);
  const qap = readJson('data/audit/chfa-qap-watch.json').documents[0].text.replace(/\s+/g, ' ');
  assert.match(qap, /TZ Credit may be awarded in lieu of standard state credit\. 3\.B\.3/,
    'the QAP text no longer places the TZ in-lieu rule at the end of 3.B.2');
  assert.match(note.textContent, /in lieu of standard state credit \(2027–28 QAP Third Draft §3\.B\.2\)/);
});

// ── The for-sale market study ───────────────────────────────────────────────
const STZ = require('../js/project-market-study/study-transit-zone.js');
const byGeo = readJson('data/hna/transit-zone-by-geography.json');
const FRESH = new Date(Date.parse(byGeo.meta.stops_generated) + 86400e3);

test('the for-sale study reports the area figure, the note, and no credit amount (PC-2)', () => {
  const [id, g] = Object.entries(byGeo.geographies).find(([, x]) => x.type === 'place' && x.share_within_radius_confirmed > 0.3);
  const out = STZ.summarize(id, byGeo, mapStatus, FRESH, TZ.designation);
  assert.equal(out.state, 'ok');
  assert.ok(out.html.includes(Math.round(g.share_within_radius_confirmed * 100) + '%'), 'share differs from the per-geography file');
  assert.ok(out.html.includes(TZ.designation(mapStatus, FRESH).note.replace(/'/g, '&#39;').replace(/"/g, '&quot;')), 'designation note missing');
  assert.match(out.html, /<em>rental<\/em> housing/);
  assert.doesNotMatch(out.html, /\$\s?\d|million|per-project/i, 'an ownership study shows a credit amount');
});

for (const [label, args, re] of [
  ['an example study (no jurisdiction)', [null, byGeo], /example study/],
  ['missing data', ['0828745', null], /did not load/],
  ['stale stop data', ['0828745', byGeo, new Date(Date.parse(byGeo.meta.stops_generated) + 40 * 86400e3)], /days old/],
]) {
  test(`for-sale study: ${label} → Unavailable, no percentage`, () => {
    const out = STZ.summarize(args[0], args[1], mapStatus, args[2] || FRESH, TZ.designation);
    assert.equal(out.state, 'unavailable');
    assert.match(out.html, re);
    assert.doesNotMatch(out.html, /\d+%/);
  });
}

test('the for-sale page mounts the section and loads its scripts', () => {
  const html = read('for-sale-market-study.html');
  assert.match(html, /id="ms-transit-zone"[\s\S]*id="msTransitZoneContent"/);
  assert.ok(html.indexOf('js/transit-zone.js') > 0 && html.indexOf('js/project-market-study/study-transit-zone.js') > 0);
  assert.ok(html.indexOf('id="ms-transit-zone"') < html.indexOf('id="ms-s7"'), 'transit section should sit before the report');
});

console.log(`transit-zone-funding-line: ${passed} passed`);
