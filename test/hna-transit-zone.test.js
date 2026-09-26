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
  let checked = 0;
  for (const [id, g] of Object.entries(data.geographies)) {
    if (!g.nearest_confirmed_stop) continue;
    assert.ok(Array.isArray(g.centre) && g.centre.length === 2, `${id}: no recorded centre`);
    const s = zone.status(g.centre[1], g.centre[0]);
    assert.ok(s.nearestConfirmedStop, id);
    assert.ok(Math.abs(s.nearestConfirmedStop.distanceMiles - g.nearest_confirmed_stop.distance_miles) <= 0.011,
      `${id}: JS ${s.nearestConfirmedStop.distanceMiles} vs file ${g.nearest_confirmed_stop.distance_miles}`);
    checked++;
  }
  assert.ok(checked > 450, `only ${checked} geographies compared — the scan found too little to check`);
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
  const zero = Object.entries(data.geographies).find(([, g]) => g.share_within_radius_confirmed === 0 && g.zero_is_exact === true && g.type === 'county');
  assert.ok(zero, 'no zero-share county to test');
  const w = page(realFetch());
  return w.HNARenderers.renderTransitZonePanel(zero[0], FRESH).then(() => {
    const el = w.document.getElementById('hnaTransitZoneContent');
    assert.match(el.textContent, /No part of .* is within/);
    assert.match(el.textContent, /No site here passes the 2-mile screen/);
  });
});

test('a sampled zero is only called "none" when the builder proved it', () => {
  for (const [id, g] of Object.entries(data.geographies)) {
    if (g.share_within_radius_confirmed !== 0) {
      assert.equal(g.zero_is_exact, null, `${id}: zero_is_exact set on a non-zero share`);
      continue;
    }
    assert.equal(typeof g.zero_is_exact, 'boolean', `${id}: zero share without zero_is_exact`);
    const d = g.nearest_confirmed_stop_to_boundary_miles;
    assert.equal(g.zero_is_exact, d === null || d > data.meta.radius_miles, `${id}: zero_is_exact disagrees with the boundary distance ${d}`);
  }
});

test('an edge-only zero says "less than 1%", never "no part"', () => {
  const edge = Object.entries(data.geographies).find(([, g]) => g.share_within_radius_confirmed === 0 && g.zero_is_exact === false);
  const fixture = edge || ['EDGE', { name: 'Edge town', type: 'place', share_within_radius_confirmed: 0, share_within_radius_any: 0,
    share_within_half_mile_confirmed: 0, confirmed_stops_inside: 0, nearest_confirmed_stop: { name: 'S', agency: 'A', distance_miles: 4 },
    nearest_confirmed_stop_to_boundary_miles: 1.5, zero_is_exact: false, samples: 900, unavailableReason: null }];
  const doc = Object.assign({}, data, { geographies: { [fixture[0]]: fixture[1] } });
  const w = page(realFetch({ 'data/hna/transit-zone-by-geography.json': doc }));
  return w.HNARenderers.renderTransitZonePanel(fixture[0], FRESH).then(() => {
    const el = w.document.getElementById('hnaTransitZoneContent');
    assert.ok(el.querySelector('[data-tz="share"]').textContent.startsWith('<1%'));
    assert.match(el.textContent, /Less than 1% of .* a strip along its edge/);
    assert.doesNotMatch(el.textContent, /No part of/);
    assert.ok(el.textContent.includes(String(fixture[1].nearest_confirmed_stop_to_boundary_miles) + ' miles from the boundary'));
  });
});

test('private shuttle pickups never reach the figures', () => {
  const src = read('scripts/market/build_transit_zone_by_geography.py');
  assert.match(src, /"operator"\) == "private_shuttle":\s*\n\s*continue/, 'the builder counts private shuttle pickups');
  const shuttles = stops.features.filter((f) => f.properties.operator === 'private_shuttle');
  assert.ok(shuttles.length > 0, 'no private shuttle stops in the stop file — the scan found nothing to check');
  const names = new Set(shuttles.map((f) => f.properties.name));
  for (const [id, g] of Object.entries(data.geographies)) {
    const n = g.nearest_confirmed_stop;
    if (n && names.has(n.name) && shuttles.some((f) => f.properties.name === n.name && f.properties.agency === n.agency)) {
      assert.fail(`${id}: nearest confirmed stop is a private shuttle pickup (${n.name}, ${n.agency})`);
    }
  }
});

test('each geography\'s recorded centre lies inside its own boundary', () => {
  const inRing = (x, y, r) => { let c = false; for (let i = 0, k = r.length - 1; i < r.length; k = i++) {
    if ((r[i][1] > y) !== (r[k][1] > y) && x < (r[k][0] - r[i][0]) * (y - r[i][1]) / (r[k][1] - r[i][1]) + r[i][0]) c = !c; } return c; };
  const inside = (geom, x, y) => (geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates)
    .some((p) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h)));
  const shapes = {};
  for (const f of readJson('data/co-county-boundaries.json').features) shapes[String(f.properties.GEOID).padStart(5, '0')] = f.geometry;
  for (const f of readJson('data/co-place-boundaries.geojson').features) shapes[f.properties.geoid] = f.geometry;
  let checked = 0;
  for (const [id, g] of Object.entries(data.geographies)) {
    if (!g.centre || !shapes[id]) continue;
    assert.ok(inside(shapes[id], g.centre[0], g.centre[1]), `${id} (${g.name}): centre ${g.centre} is outside its boundary`);
    checked++;
  }
  assert.ok(checked > 500, `only ${checked} centres checked`);
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
