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

test('the methodology explainer\'s source is the file the weights live in (#1973)', () => {
  // Agreement, not copy: every file the explainer cites must exist, and the
  // one holding `var WEIGHTS = {…}` must be among them — the same file the
  // test above reads the dimensions from.
  const ex = read('js/methodology-explainer.js');
  const source = (ex.match(/'pma-composite':\s*\{[\s\S]*?source:\s*'([^']*)'/) || [])[1];
  assert.ok(source, 'pma-composite explainer source not found');
  const cited = source.match(/[\w./-]+\.js\b/g) || [];
  assert.ok(cited.length > 0, `explainer source names no file: "${source}"`);
  for (const f of cited) assert.ok(fs.existsSync(path.join(root, f)), `explainer cites ${f}, which does not exist`);
  const holders = cited.filter((f) => /var WEIGHTS = \{/.test(read(f)));
  assert.equal(holders.length, 1, `explainer source "${source}" does not name the one file that defines the PMA weights`);
  assert.equal(read(holders[0]), scoring, `explainer cites ${holders[0]}, not the file the weights above are read from`);
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
                : { create: (o) => TZ.create(Object.assign({ now: new Date(Date.parse(stops.meta.generated) + 86400e3) }, o)),
                    fundingPath: TZ.fundingPath },
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
    _tzZones = ${JSON.stringify(opts.zones || null)};
    _tzZonesState = ${JSON.stringify(opts.zonesState || 'idle')};
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

// ── OEDIT's published map outranks the stop screen ──────────────────────────
const UNION = [39.7527, -105.0003];     // passes the stop screen
const PLAINS = [38.82, -102.35];        // fails it
function box(lat, lon, d) {             // a square zone polygon around a point
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon',
    coordinates: [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] } };
}
const published = Object.assign({}, mapStatus, { status: 'published', zones_file: 'data/policy/thiz-zones.geojson' });
const zonesAroundPlains = { type: 'FeatureCollection', features: [box(PLAINS[0], PLAINS[1], 0.05)] };

test('a published map that excludes the site suppresses the funding path, even beside a stop', () => {
  const { r, box: b, dcArg } = runGate(UNION[0], UNION[1], { mapStatus: published, zones: zonesAroundPlains, zonesState: 'ok' });
  assert.equal(r.status, 'within_2mi', 'the stop screen still passes; only the official map excludes it');
  assert.equal(r.designation, 'official_out');
  assert.equal(b.querySelector('[data-tz-designation]').textContent, r.designationNote);
  assert.doesNotMatch(b.textContent, /Soft Funding Stack/);
  assert.equal(TZ.fundingPath(dcArg), null);
});

test('a published map that includes the site gives the funding path, even far from a stop', () => {
  const { r, box: b } = runGate(PLAINS[0], PLAINS[1], { mapStatus: published, zones: zonesAroundPlains, zonesState: 'ok' });
  assert.equal(r.status, 'outside');
  assert.equal(r.designation, 'official_in');
  assert.match(b.textContent, /Soft Funding Stack/);
  assert.equal(TZ.fundingPath(r), 'official');
});

test('the gate waits for the published zones before answering, and fetches only a file under data/', () => {
  const waiting = runGate(UNION[0], UNION[1], { mapStatus: published, zonesState: 'loading' });
  assert.equal(waiting.r, null);
  assert.equal(waiting.box.getAttribute('data-tz-state'), 'loading');
  // Before the load starts, the gate starts it (the harness fetch never
  // resolves, so the gate stays "checking").
  assert.equal(runGate(UNION[0], UNION[1], { mapStatus: published }).box.getAttribute('data-tz-state'), 'loading');
  for (const bad of ['../secrets.json', 'https://example.com/z.geojson', 'data/../x.json', 5]) {
    const { r } = runGate(UNION[0], UNION[1], { mapStatus: Object.assign({}, published, { zones_file: bad }) });
    assert.equal(r.designation, 'provisional', `zones_file ${bad} was used`);
    assert.match(r.designationNote, /not been loaded/);
  }
});

// ── The deal calculator's funding line ──────────────────────────────────────
function dealCalc(extraHtml) {
  const dom = new JSDOM('<!doctype html><div id="dc-tz-note" hidden></div>' + (extraHtml || ''), { runScripts: 'outside-only' });
  dom.window.fetch = () => Promise.reject(new Error('offline'));
  dom.window.eval(read('js/transit-zone.js'));
  dom.window.eval(read('js/deal-calculator.js'));
  return { w: dom.window, note: dom.window.document.getElementById('dc-tz-note') };
}
const PASS = { status: 'within_2mi', confirmedOnly: true, radiusMiles: 2, designation: 'provisional', designationNote: 'Provisional — test note.' };

test('the line shows only for a pass via a confirmed stop, and states no amount for the project', () => {
  const { w, note } = dealCalc();
  w.__DealCalc.setTransitZoneContext(PASS);
  assert.equal(note.hidden, false);
  assert.match(note.textContent, /not added to this stack/);
  // The legislation file has not loaded (fetch is offline here): no amount.
  assert.equal(note.querySelector('[data-tz-pairing]').getAttribute('data-tz-pairing'), 'unavailable');
  assert.match(note.textContent, /per-project amounts could not be loaded, so none is shown/);
  assert.doesNotMatch(note.textContent, /\$\d{3},\d{3}/, 'an amount shown before the pairing data loaded');
  assert.doesNotMatch(note.textContent, /No per-project amount exists/, 'the retired claim is back (#1973)');
  assert.equal(note.querySelector('[data-tz-designation]').textContent, PASS.designationNote);
  for (const r of [Object.assign({}, PASS, { confirmedOnly: false }), Object.assign({}, PASS, { status: 'outside' }),
                   Object.assign({}, PASS, { designation: 'official_out' }),
                   { status: 'unavailable', unavailableReason: 'x' }, null]) {
    w.__DealCalc.setTransitZoneContext(r);
    assert.equal(note.hidden, true, JSON.stringify(r));
    assert.equal(note.textContent, '');
  }
});

test('a site on OEDIT\'s published map gets the line on that basis, not the stop screen\'s', () => {
  const { w, note } = dealCalc();
  w.__DealCalc.setTransitZoneContext(Object.assign({}, PASS, { status: 'outside', confirmedOnly: null, designation: 'official_in' }));
  assert.equal(note.hidden, false);
  assert.match(note.textContent, /inside a Transit and Housing Investment Zone on OEDIT.s published map/);
  assert.doesNotMatch(note.textContent, /within 2 miles of a confirmed transit stop/);
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

// ── The draft QAP's per-project pairing (#1973) ────────────────────────────
// The amounts live only in the HB26-1065 entry's tz_credit_pairing. The note
// must show exactly those amounts for the selected credit type, and the data
// must agree with the QAP text the repo archived.
const LEG = readJson('data/policy/tax-credit-legislation.json');
const PAIR = LEG.entries.find((x) => /^hb26-1065/i.test(x.id)).tz_credit_pairing;
const money = (n) => '$' + n.toLocaleString('en-US');

test('the pairing data agrees with the QAP Third Draft and its summary of changes', () => {
  const docs = readJson('data/audit/chfa-qap-watch.json').documents;
  const flat = (d) => (d.text || '').replace(/\s+/g, ' ');
  const draft = flat(docs.find((d) => /Third Draft \(PDF\)$/.test(d.title)));
  const summary = flat(docs.find((d) => /Third Draft - Summary of Changes/.test(d.title)));
  assert.ok(draft.length > 100000 && summary.length > 1000, 'QAP texts not found in chfa-qap-watch.json');
  // The summary lists 2027 then 2028 under "Maximum Credit Award".
  const start = summary.indexOf('Maximum Credit Award 2027');
  const mid = summary.indexOf(' 2028 ', start);
  const end = summary.indexOf('Maximum Credit Award if state gap funds', mid);
  assert.ok(start >= 0 && mid > start && end > mid, 'summary of changes no longer has the Maximum Credit Award years');
  const y27 = summary.slice(start, mid), y28 = summary.slice(mid, end);
  for (const [y, sec] of [['2027', y27], ['2028', y28]]) {
    assert.ok(sec.includes('Federal 9 Percent Housing Tax Credit Applications to ' + money(PAIR.nine_percent[y])),
      `9% ${y}: ${money(PAIR.nine_percent[y])} is not in the QAP summary`);
    assert.ok(sec.includes('amount optional to pair up to ' + money(PAIR.four_percent_round_two[y])),
      `4% ${y}: ${money(PAIR.four_percent_round_two[y])} is not in the QAP summary`);
  }
  const alt = PAIR.if_no_state_gap_funds;
  assert.ok(draft.includes(`A fixed amount of ${money(alt.nine_percent['2027'])} in 2027 and ${money(alt.nine_percent['2028'])} in 2028 of standard State Credit or TZ Credit, where eligible, with federal 9 percent`),
    '§3.L.1 9% alternative is not in the QAP draft');
  assert.ok(draft.includes(`up to ${money(alt.four_percent_round_two['2027'])} in 2027 and ${money(alt.four_percent_round_two['2028'])} in 2028 of standard State Credit or TZ Credit, where eligible, to pair in Round Two`),
    '§3.L.1 4% alternative is not in the QAP draft');
  assert.equal(PAIR.status, 'draft');
  // The unit is a claim that must match the QAP, not a wording choice: the
  // draft pairs "standard annual state credit".
  assert.equal(PAIR.unit, 'annual');
  assert.ok(draft.includes('in 2028 of standard annual state credit or Transit Zone (TZ) credit where eligible, with federal 9 percent'),
    'the QAP no longer describes the 9% pairing as annual state credit');
  assert.equal(PAIR.in_lieu_of_standard_state_credit, true);
});

test('a 9% deal shows the fixed pairing from the data, one allowance, not added to the stack', () => {
  const { w, note } = dealCalc();
  w.__DealCalc.setTransitZoneContext(PASS);
  w.__DealCalc.setTzCreditPairing(LEG);
  const t = note.textContent;
  assert.equal(note.querySelector('[data-tz-pairing]').getAttribute('data-tz-pairing'), '9pct');
  assert.ok(t.includes('For a 9% application'), t);
  assert.ok(t.includes(`a fixed ${money(PAIR.nine_percent['2027'])} a year (2027 awards) or ${money(PAIR.nine_percent['2028'])} a year (2028 awards)`), t);
  assert.ok(t.includes(`${money(PAIR.if_no_state_gap_funds.nine_percent['2027'])} a year (2027) and ${money(PAIR.if_no_state_gap_funds.nine_percent['2028'])} a year (2028) instead`), t);
  // The unit shown agrees with the data's unit (#1976 review).
  assert.match(t, /annual amounts, claimed in each credit year, not a project total/);
  assert.match(t, /§3\.L, not yet adopted/);
  assert.match(t, /replaces standard state credit, it does not add to it/);
  assert.match(t, /not added to this stack/);
  assert.doesNotMatch(t, /round two/i, 'a 9% deal was shown the 4% pairing');
});

test('a 4% deal shows the Round Two "up to" pairing, and the toggle re-renders it', () => {
  const html = '<input id="dc-rate-9" type="radio" name="r" value="0.09"><input id="dc-rate-4" type="radio" name="r" value="0.04" checked>';
  const { w, note } = dealCalc(html);
  w.__DealCalc.setTzCreditPairing(LEG);
  w.__DealCalc.setTransitZoneContext(PASS);
  const t = note.textContent;
  assert.equal(note.querySelector('[data-tz-pairing]').getAttribute('data-tz-pairing'), '4pct');
  assert.ok(t.includes(`in Round Two`) && t.includes(`pair up to ${money(PAIR.four_percent_round_two['2027'])} a year (2027 awards) or ${money(PAIR.four_percent_round_two['2028'])} a year (2028 awards)`), t);
  assert.match(t, /annual amounts, claimed in each credit year, not a project total/);
  assert.ok(t.includes(`up to ${money(PAIR.if_no_state_gap_funds.four_percent_round_two['2027'])} a year (2027)`), t);
  assert.doesNotMatch(t, /a fixed \$/, 'a 4% deal was shown the fixed 9% pairing');
  // The page's own credit-rate handler re-renders the note on a switch.
  const src = read('js/deal-calculator.js');
  const h = src.indexOf("['dc-rate-9', 'dc-rate-4'].forEach");
  assert.ok(h > 0 && src.slice(h, h + 1500).includes('setTransitZoneContext(_tzLastResult)'),
    'switching 9%/4% no longer re-renders the Transit Zone note');
  // …and re-rendering after a switch reads the same data for the other type.
  w.document.getElementById('dc-rate-9').checked = true;
  w.__DealCalc.setTransitZoneContext(PASS);
  assert.equal(note.querySelector('[data-tz-pairing]').getAttribute('data-tz-pairing'), '9pct');
});

test('unreadable pairing data shows no amount; a site that does not pass shows nothing', () => {
  const { w, note } = dealCalc();
  const broken = JSON.parse(JSON.stringify(LEG));
  broken.entries.find((x) => /^hb26-1065/i.test(x.id)).tz_credit_pairing.nine_percent['2027'] = null;
  const unitless = JSON.parse(JSON.stringify(LEG));
  delete unitless.entries.find((x) => /^hb26-1065/i.test(x.id)).tz_credit_pairing.unit;
  w.__DealCalc.setTransitZoneContext(PASS);
  w.__DealCalc.setTzCreditPairing(broken);
  assert.match(note.textContent, /could not be read, so none is shown/);
  assert.doesNotMatch(note.textContent, /\$\d{3},\d{3}/);
  // An amount whose unit is not recorded as annual is not shown either.
  w.__DealCalc.setTzCreditPairing(unitless);
  assert.match(note.textContent, /could not be read, so none is shown/);
  assert.doesNotMatch(note.textContent, /\$\d{3},\d{3}/);
  w.__DealCalc.setTzCreditPairing(LEG);
  w.__DealCalc.setTransitZoneContext({ status: 'unavailable', unavailableReason: 'x' });
  assert.equal(note.hidden, true);
  assert.equal(note.textContent, '');
});

// ── The for-sale market study ───────────────────────────────────────────────
const STZ = require('../js/project-market-study/study-transit-zone.js');
const byGeo = readJson('data/hna/transit-zone-by-geography.json');
const FRESH = new Date(Date.parse(byGeo.meta.stops_generated) + 86400e3);

// How a share must print is TZ.shareLabel (js/transit-zone.js) — the same
// rule the needs assessment's panel follows. The study must agree with it;
// this file does not restate the rule (#1973).
const shareLabel = TZ.shareLabel;

test('for-sale study: a measured share never prints as 0% or 100%', () => {
  const entries = Object.entries(byGeo.geographies);
  // A measured share that plain rounding would print as an absolute.
  const tiny = entries.find(([, x]) => x.share_within_radius_confirmed > 0 && Math.round(x.share_within_radius_confirmed * 100) === 0);
  const nearAll = entries.find(([, x]) => x.share_within_radius_confirmed < 1 && Math.round(x.share_within_radius_confirmed * 100) === 100);
  assert.ok(tiny && nearAll, 'the per-geography file no longer has a sub-1% and a near-100% share to check');
  for (const [id, g, want] of [[...tiny, '<1%'], [...nearAll, '>99%']]) {
    const out = STZ.summarize(id, byGeo, mapStatus, FRESH, TZ);
    const shown = new JSDOM(out.html).window.document.querySelector('[data-tz="share"] strong').textContent;
    assert.equal(shown, want, `${id} ${g.share_within_radius_confirmed}: ${out.html.slice(0, 120)}`);
    assert.doesNotMatch(out.html, /<strong>(0|100)%<\/strong>/);
  }
});

test('the for-sale study reports the area figure, the note, and no credit amount (PC-2)', () => {
  const [id, g] = Object.entries(byGeo.geographies).find(([, x]) => x.type === 'place' && x.share_within_radius_confirmed > 0.3);
  const out = STZ.summarize(id, byGeo, mapStatus, FRESH, TZ);
  assert.equal(out.state, 'ok');
  const shown = new JSDOM(out.html).window.document.querySelector('[data-tz="share"] strong').textContent;
  assert.equal(shown, shareLabel(g.share_within_radius_confirmed), 'share differs from the per-geography file');
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
    const out = STZ.summarize(args[0], args[1], mapStatus, args[2] || FRESH, TZ);
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
