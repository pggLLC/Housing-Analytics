'use strict';

// HNA "Potential location: transit zone" (#1937 Phase 3).
//
// Agreement, not copy:
//   * the per-geography file must agree with the stop file it was built from
//     (build date), the zone-map status file (radius) and geo-config (the 546
//     geographies);
//   * its nearest-stop distances (Python) must agree with js/transit-zone.js
//     (JS) on the same stops — two implementations, one answer;
//   * the canonical page's static intro must state the radius the data uses;
//   * the rendered panel must show the file's numbers, carry the designation
//     note from TransitZone.designation(), and say "Unavailable" — never 0% —
//     for missing, stale or unmatched data.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const TZ = require('../js/transit-zone.js');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

const data = readJson('data/hna/transit-zone-by-geography.json');
const stops = readJson('data/amenities/transit_stops_statewide_co.geojson');
const mapStatus = readJson('data/policy/thiz-map-status.json');
const geo = readJson('data/hna/geo-config.json');

let passed = 0;
const pending = [];
function test(name, fn) {
  const r = fn();
  const done = () => { passed++; console.log('  ✓ ' + name); };
  if (r && typeof r.then === 'function') pending.push(r.then(done)); else done();
}

console.log('\nhna-transit-zone');

// ── The data file ───────────────────────────────────────────────────────────
test('covers exactly the 546 HNA geographies', () => {
  const want = [...geo.counties, ...geo.places, ...geo.cdps].map((g) => g.geoid).sort();
  assert.deepEqual(Object.keys(data.geographies).sort(), want);
  assert.equal(data.meta.geography_count, want.length);
});

test('agrees with the stop file and the zone-map status file', () => {
  assert.equal(data.meta.stops_generated, stops.meta.generated, 'built from a different stop file than the one committed');
  assert.equal(data.meta.radius_miles, mapStatus.zone_radius_miles, 'radius differs from data/policy/thiz-map-status.json');
});

test('every share is a fraction, or null with a reason — never a silent 0', () => {
  let nulls = 0;
  for (const [id, g] of Object.entries(data.geographies)) {
    if (g.unavailableReason) {
      nulls++;
      assert.equal(g.share_within_radius_confirmed, null, id);
      continue;
    }
    for (const k of ['share_within_radius_confirmed', 'share_within_radius_any', 'share_within_half_mile_confirmed']) {
      assert.ok(typeof g[k] === 'number' && g[k] >= 0 && g[k] <= 1, `${id} ${k}=${g[k]}`);
    }
    assert.ok(g.share_within_radius_any >= g.share_within_radius_confirmed, `${id}: adding unconfirmed stops lowered the share`);
    assert.ok(g.share_within_half_mile_confirmed <= g.share_within_radius_confirmed, `${id}: ½-mile share exceeds the radius share`);
    assert.ok(g.samples >= 100, `${id}: only ${g.samples} sample points`);
  }
  assert.ok(nulls < 5, `${nulls} geographies unavailable`);
});

test('Python nearest-stop distances agree with js/transit-zone.js', () => {
  const zone = TZ.create({ stops, mapStatus, now: new Date(Date.parse(stops.meta.generated) + 3600e3) });
  const centroids = readJson('data/co-place-centroids.json').byGeoid;
  let checked = 0;
  for (const [id, g] of Object.entries(data.geographies)) {
    if (g.type === 'county' || !centroids[id] || !g.nearest_confirmed_stop) continue;
    const s = zone.status(centroids[id].lat, centroids[id].lng);
    assert.ok(s.nearestConfirmedStop, id);
    assert.ok(Math.abs(s.nearestConfirmedStop.distanceMiles - g.nearest_confirmed_stop.distance_miles) <= 0.011,
      `${id}: JS ${s.nearestConfirmedStop.distanceMiles} vs file ${g.nearest_confirmed_stop.distance_miles}`);
    checked++;
  }
  assert.ok(checked > 400, `only ${checked} places compared — the scan found too little to check`);
});

// ── The page ────────────────────────────────────────────────────────────────
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five'];
test('the canonical page states the radius the data uses, and the view keeps the section', () => {
  const html = read('housing-needs-assessment.html');
  const sec = (html.match(/<section[^>]*id="hnaTransitZonePanel"[\s\S]*?<\/section>/) || [])[0];
  assert.ok(sec, 'hnaTransitZonePanel section missing from the canonical page');
  assert.match(sec, /id="hnaTransitZoneContent"/);
  const r = data.meta.radius_miles;
  assert.ok(sec.includes(`${WORDS[r] || r} miles`), `the intro does not say ${WORDS[r] || r} miles`);
  assert.ok(html.indexOf('src="js/transit-zone.js"') < html.indexOf('src="js/hna/hna-renderers.js"'),
    'js/transit-zone.js must load before hna-renderers.js');
  const title = (sec.match(/<h2[^>]*>([^<]+)<\/h2>/) || [])[1];
  const views = readJson('data/hna/hna-views.json').views;
  const owners = views.filter((v) => v.sections.some((s) => s.title === title));
  assert.equal(owners.length, 1, 'the section must belong to exactly one view');
  assert.match(owners[0].slug, /what-to-do/);
  assert.match(read(owners[0].slug), /id="hnaTransitZoneContent"/, `${owners[0].slug} is stale — rerun build_hna_views.py`);
});

// ── The renderer ────────────────────────────────────────────────────────────
function page(fetchImpl) {
  const dom = new JSDOM('<!doctype html><div id="hnaTransitZoneContent"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.fetch = fetchImpl;
  w.HNAState = { state: {} };
  w.HNAUtils = {};
  w.eval(read('js/transit-zone.js'));
  w.eval(read('js/hna/hna-renderers.js'));
  return w;
}
function realFetch(overrides) {
  return (url) => {
    const o = overrides && overrides[url];
    if (o === 'fail') return Promise.reject(new Error('offline'));
    const body = o !== undefined ? o : JSON.parse(read(url));
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  };
}
const FRESH = new Date(Date.parse(data.meta.stops_generated) + 86400e3);
// A place whose three shares all differ, so a tile showing the wrong one fails.
const sample = Object.entries(data.geographies).find(([, g]) => g.type !== 'county' && g.nearest_confirmed_stop
  && Math.round(g.share_within_radius_any * 100) !== Math.round(g.share_within_radius_confirmed * 100)
  && Math.round(g.share_within_half_mile_confirmed * 100) !== Math.round(g.share_within_radius_confirmed * 100));
assert.ok(sample, 'no place with distinct confirmed / any / ½-mile shares to render');

test('renders the file\'s figures and the designation note for a place', () => {
  const w = page(realFetch());
  const [id, g] = sample;
  return w.HNARenderers.renderTransitZonePanel(id, FRESH).then(() => {
    const el = w.document.getElementById('hnaTransitZoneContent');
    assert.equal(el.getAttribute('data-tz-state'), 'ok');
    const shareTile = el.querySelector('[data-tz="share"]').textContent;
    assert.ok(shareTile.startsWith(Math.round(g.share_within_radius_confirmed * 100) + '%'), shareTile);
    assert.ok(shareTile.includes(`within ${data.meta.radius_miles} miles`), shareTile);
    const halfTile = el.querySelector('[data-tz="half"]').textContent;
    assert.ok(halfTile.startsWith(Math.round(g.share_within_half_mile_confirmed * 100) + '%'), halfTile);
    assert.ok(el.textContent.includes(g.nearest_confirmed_stop.agency));
    const note = el.querySelector('[data-tz-designation]');
    assert.equal(note.textContent, TZ.designation(mapStatus, FRESH).note);
  });
});

test('a geography with no stop nearby says so in words, with 0% and no credit path', () => {
  const zero = Object.entries(data.geographies).find(([, g]) => g.share_within_radius_confirmed === 0 && g.type === 'county');
  assert.ok(zero, 'no zero-share county to test');
  const w = page(realFetch());
  return w.HNARenderers.renderTransitZonePanel(zero[0], FRESH).then(() => {
    const el = w.document.getElementById('hnaTransitZoneContent');
    assert.match(el.textContent, /No part of .* is within/);
    assert.match(el.textContent, /No site here passes the 2-mile screen/);
  });
});

for (const [label, overrides, geoid, now, reason] of [
  ['the data file fails to load', { 'data/hna/transit-zone-by-geography.json': 'fail' }, () => sample[0], FRESH, /did not load/],
  ['the geography is not covered (state view)', {}, () => '08', FRESH, /pick one/],
  ['the stop data behind the file is stale', {}, () => sample[0], new Date(Date.parse(data.meta.stops_generated) + 40 * 86400e3), /days old/],
  ['the geography carries its own unavailable reason',
    { 'data/hna/transit-zone-by-geography.json': Object.assign({}, data, { geographies: { X: { name: 'X', unavailableReason: 'No boundary for this geography.' } } }) },
    () => 'X', FRESH, /No boundary/],
]) {
  test(`${label} → "Unavailable" with the reason, no percentage`, () => {
    const w = page(realFetch(overrides));
    return w.HNARenderers.renderTransitZonePanel(geoid(), now).then(() => {
      const el = w.document.getElementById('hnaTransitZoneContent');
      assert.equal(el.getAttribute('data-tz-state'), 'unavailable');
      assert.match(el.textContent, /Unavailable/);
      assert.match(el.textContent, reason);
      assert.doesNotMatch(el.textContent, /\d+%/);
    });
  });
}

Promise.all(pending).then(() => console.log(`hna-transit-zone: ${passed} passed`))
  .catch((e) => { console.error(e); process.exit(1); });
