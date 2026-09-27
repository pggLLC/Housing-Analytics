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
// How the panel must print a share: rounded, except that a measured share
// never rounds to an absolute (0.4% is not "0%", 99.6% is not "100%").
function shareLabel(v) {
  if (v > 0 && v < 0.005) return '<1%';
  if (v < 1 && v >= 0.995) return '>99%';
  return Math.round(v * 100) + '%';
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
    assert.ok(shareTile.startsWith(shareLabel(g.share_within_radius_confirmed)), shareTile);
    assert.ok(shareTile.includes(`within ${data.meta.radius_miles} miles`), shareTile);
    const halfTile = el.querySelector('[data-tz="half"]').textContent;
    assert.ok(halfTile.startsWith(shareLabel(g.share_within_half_mile_confirmed)), halfTile);
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

test('a measured share never prints as 0% or 100%', () => {
  const entries = Object.entries(data.geographies);
  const tiny = entries.find(([, g]) => g.share_within_radius_confirmed > 0 && g.share_within_radius_confirmed < 0.005);
  const nearAll = entries.find(([, g]) => g.share_within_radius_confirmed >= 0.995 && g.share_within_radius_confirmed < 1);
  const cases = [tiny || ['TINY', Object.assign({}, sample[1], { name: 'Tiny', share_within_radius_confirmed: 0.004, share_within_radius_any: 0.004, zero_is_exact: null })],
                 nearAll || ['NEAR', Object.assign({}, sample[1], { name: 'Near', share_within_radius_confirmed: 0.996, share_within_radius_any: 0.996, zero_is_exact: null })]];
  return Promise.all(cases.map(([id, g]) => {
    const doc = Object.assign({}, data, { geographies: { [id]: g } });
    const w = page(realFetch({ 'data/hna/transit-zone-by-geography.json': doc }));
    return w.HNARenderers.renderTransitZonePanel(id, FRESH).then(() => {
      const el = w.document.getElementById('hnaTransitZoneContent');
      const tile = el.querySelector('[data-tz="share"]').textContent;
      assert.ok(tile.startsWith(g.share_within_radius_confirmed < 0.5 ? '<1%' : '>99%'), `${id} ${g.share_within_radius_confirmed}: ${tile}`);
      assert.doesNotMatch(el.textContent, /(^|[^0-9<>])(0|100)% of /, `${id}: printed as an absolute`);
      assert.doesNotMatch(el.textContent, /No part of|No site here passes/, `${id}: a measured share read as none`);
    });
  }));
});

test('the panel names its geography, and a slow earlier request never overwrites a newer one', () => {
  // The controller does not await the panel, so a quick switch A → B can
  // resolve B first and A second. A must not land on top of B.
  const [a, b] = Object.keys(data.geographies).filter((g) => !data.geographies[g].unavailableReason).slice(0, 2);
  const gates = [];
  const w = page((url) => new Promise((resolve) => gates.push(() =>
    resolve({ ok: true, json: () => Promise.resolve(JSON.parse(read(url))) }))));
  const el = w.document.getElementById('hnaTransitZoneContent');
  const first = w.HNARenderers.renderTransitZonePanel(a, FRESH);
  assert.equal(el.getAttribute('data-tz-state'), 'loading');
  assert.equal(el.getAttribute('data-tz-geoid'), a);
  const firstGates = gates.splice(0);
  const second = w.HNARenderers.renderTransitZonePanel(b, FRESH);
  assert.equal(el.getAttribute('data-tz-geoid'), b, 'a new request did not claim the panel');
  gates.splice(0).forEach((open) => open());           // B resolves first
  return second.then(() => {
    assert.equal(el.getAttribute('data-tz-state'), 'ok');
    const shown = el.querySelector('[data-tz="share"]').textContent;
    firstGates.forEach((open) => open());              // then the stale A
    return first.then(() => {
      assert.equal(el.getAttribute('data-tz-geoid'), b);
      assert.equal(el.querySelector('[data-tz="share"]').textContent, shown, 'the earlier request overwrote the panel');
      assert.ok(shown.includes(data.geographies[b].name), 'the panel does not show the newer geography');
    });
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

// ── #1971: an absolute is printed only when the builder proved it ──────────
// Every geography is rendered through the real panel from the real file, and
// what each tile says must agree with the proof flags beside the number.
const tileText = (el, k) => el.querySelector(`[data-tz="${k}"]`).textContent;
function renderAll(ids) {
  const cache = {};
  const w = page((url) => Promise.resolve({ ok: true, json: () => Promise.resolve(cache[url] || (cache[url] = JSON.parse(read(url)))) }));
  const el = w.document.getElementById('hnaTransitZoneContent');
  const out = {};
  return ids.reduce((p, id) => p.then(() => w.HNARenderers.renderTransitZonePanel(id, FRESH).then(() => {
    out[id] = el.getAttribute('data-tz-state') === 'ok'
      ? { share: tileText(el, 'share'), half: tileText(el, 'half'), text: el.textContent } : null;
  })), Promise.resolve()).then(() => out);
}
const shown = renderAll(Object.keys(data.geographies));

test('the rendered tiles print 0% / 100% only where the file proves it (all 546)', () => shown.then((out) => {
  let zeros = 0, fulls = 0, rendered = 0;
  for (const [id, g] of Object.entries(data.geographies)) {
    const r = out[id];
    if (!r) continue;
    rendered++;
    if (r.half.startsWith('0%')) {
      zeros++;
      assert.equal(g.half_mile_zero_is_exact, true, `${id}: ½-mile tile says 0% without a proof`);
      assert.equal(g.confirmed_stops_inside, 0, `${id}: ½-mile tile says 0% with a confirmed stop inside`);
      assert.ok(g.nearest_confirmed_stop_to_boundary_miles === null || g.nearest_confirmed_stop_to_boundary_miles > data.meta.qap_tod_miles,
        `${id}: ½-mile tile says 0% with a stop ${g.nearest_confirmed_stop_to_boundary_miles} mi from the boundary`);
    }
    if (r.half.startsWith('100%')) assert.equal(g.half_mile_full_is_exact, true, `${id}: ½-mile tile says 100% without a proof`);
    if (r.share.startsWith('100%')) { fulls++; assert.equal(g.full_is_exact, true, `${id}: share tile says 100% without a proof`); }
    if (/rises to 100%/.test(r.text)) assert.equal(g.any_full_is_exact, true, `${id}: "any stop" share says 100% without a proof`);
    const d = g.max_boundary_vertex_distance_to_confirmed_stop_miles;
    if (d !== null && d > data.meta.radius_miles) assert.doesNotMatch(r.share, /^100%/, `${id}: a vertex ${d} mi from any stop, yet 100%`);
  }
  assert.ok(rendered > 540 && zeros > 100 && fulls > 100, `scan too thin: ${rendered} rendered, ${zeros} proven zeros, ${fulls} proven fulls`);
}));

test('the geographies in #1971 render what their stops and boundaries allow', () => shown.then((out) => {
  for (const id of ['08055', '08071']) {          // confirmed stops inside, grid missed them
    const g = data.geographies[id];
    assert.ok(g.confirmed_stops_inside > 0, `${id}: the file no longer has a stop inside — the case moved`);
    assert.equal(g.half_mile_zero_is_exact, false, id);
    assert.ok(out[id].half.startsWith(TZ.shareLabel(g.share_within_half_mile_confirmed)) && !out[id].half.startsWith('0%'), `${id}: ${out[id].half}`);
  }
  for (const id of ['0841560', '0859240']) {      // boundary vertices ~2.02 mi from the nearest confirmed stop
    const g = data.geographies[id];
    assert.ok(g.max_boundary_vertex_distance_to_confirmed_stop_miles > data.meta.radius_miles, `${id}: the case moved`);
    assert.equal(g.full_is_exact, false, id);
    assert.ok(out[id].share.startsWith('>99%'), `${id}: ${out[id].share}`);
  }
}));

test('the file\'s proof flags agree with its own numbers', () => {
  const r = data.meta.radius_miles, h = data.meta.qap_tod_miles;
  let checked = 0;
  for (const [id, g] of Object.entries(data.geographies)) {
    if (g.unavailableReason) continue;
    const pairs = [['share_within_radius_confirmed', 'full_is_exact'], ['share_within_radius_any', 'any_full_is_exact'],
                   ['share_within_half_mile_confirmed', 'half_mile_full_is_exact']];
    for (const [k, flag] of pairs) {
      if (g[k] === 1) assert.equal(g[flag], true, `${id}: ${k}=1 without ${flag}`);
      if (g[flag] === false) assert.ok(g[k] < 1, `${id}: ${flag}=false but ${k}=${g[k]}`);
      if (g[flag] !== null) checked++;
    }
    const half = g.share_within_half_mile_confirmed, d = g.nearest_confirmed_stop_to_boundary_miles;
    if (half === 0) assert.equal(g.half_mile_zero_is_exact, true, `${id}: ½-mile 0 without a proof`);
    if (g.half_mile_zero_is_exact !== null && g.half_mile_zero_is_exact !== undefined) {
      assert.equal(g.half_mile_zero_is_exact, d === null || d > h, `${id}: half_mile_zero_is_exact disagrees with the boundary distance ${d}`);
      assert.equal(g.half_mile_zero_is_exact, half === 0, `${id}: half_mile_zero_is_exact=${g.half_mile_zero_is_exact} but share ${half}`);
      checked++;
    }
    if (g.confirmed_stops_inside > 0) assert.ok(half > 0, `${id}: ${g.confirmed_stops_inside} confirmed stop(s) inside, ½-mile share 0`);
    if (g.max_boundary_vertex_distance_to_confirmed_stop_miles > r) assert.equal(g.full_is_exact, false, `${id}: a vertex is out of reach, yet full_is_exact`);
  }
  assert.ok(checked > 400, `only ${checked} proof flags checked`);
});

test('the recorded max vertex distance agrees with js/transit-zone.js', () => {
  const zone = TZ.create({ stops, mapStatus, now: new Date(Date.parse(stops.meta.generated) + 3600e3) });
  const shapes = {};
  for (const f of readJson('data/co-place-boundaries.geojson').features) shapes[f.properties.geoid] = f.geometry;
  let checked = 0;
  for (const [id, g] of Object.entries(data.geographies)) {
    const want = g.max_boundary_vertex_distance_to_confirmed_stop_miles;
    if (want === null || !shapes[id]) continue;
    const polys = shapes[id].type === 'Polygon' ? [shapes[id].coordinates] : shapes[id].coordinates;
    let worst = 0;
    for (const p of polys) for (const [x, y] of p[0]) worst = Math.max(worst, zone.status(y, x).nearestConfirmedStop.distanceMiles);
    assert.ok(Math.abs(worst - want) <= 0.011, `${id}: JS ${worst} vs file ${want}`);
    checked++;
  }
  assert.ok(checked > 100, `only ${checked} geographies compared`);
});

// The builder's proofs, on shapes whose answer is known.
test('the builder proves a full share, refuses an unproven one, and floors a reachable zero', () => {
  const { execFileSync } = require('node:child_process');
  const py = `
import json, sys
sys.path.insert(0, 'scripts/market')
import build_transit_zone_by_geography as b
def stop(lon, lat): return {"geometry": {"coordinates": [lon, lat]}, "properties": {"reliability": "confirmed"}}
lat0, dx, dy = 39.0, 0.5 / (69.172 * 0.7771), 0.5 / 69.0     # a 1 x 1 mile square
sq = [[[-105 - dx, lat0 - dy], [-105 + dx, lat0 - dy], [-105 + dx, lat0 + dy], [-105 - dx, lat0 + dy], [-105 - dx, lat0 - dy]]]
polys = [sq]
pts, step = b.sample_points(polys)
idx = b.StopIndex([stop(-105, lat0)])                         # corners are ~0.707 mi away
out = {"full_0_8": b.settle_full(polys, pts, step, idx, 0.8, True),
       "full_0_7": b.settle_full(polys, pts, step, idx, 0.7, True)}
far = b.StopIndex([stop(-105 + dx + 0.3 / 53.8, lat0)])       # 0.3 mi east of the square
out["zero_near"] = b.settle_zero(polys, pts, step, far, 0.5, b.min_distance_to_polygon_mi(polys, far))
out["zero_far"] = b.settle_zero(polys, pts, step, far, 0.2, b.min_distance_to_polygon_mi(polys, far))
out["summ_half"] = b.summarize(polys, None, idx, 2)["share_within_half_mile_confirmed"]
u = [[[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]]]   # a U: vertex mean (1.33,1.5) is outside
p = b.point_inside([u])
out["u_inside"] = b.contains([u], *p)
out["u_mean_inside"] = b.contains([u], sum(v[0] for v in u[0][:-1]) / 8, sum(v[1] for v in u[0][:-1]) / 8)
# A 100 x 0.001 mile sliver (one fallback sample point) straddling a row of
# fine-grid cell centres, with a stop 0.3 mi past its west end.
fs = (0.5 / 25) / 69.0
sl_lat = (round(39.0 / fs) + 0.5) * fs - 0.0005 / 69.0
sl_l, sl_w = 100 / (69.172 * 0.7771), 0.001 / 69.0
sl = [[[-105, sl_lat], [-105 + sl_l, sl_lat], [-105 + sl_l, sl_lat + sl_w], [-105, sl_lat + sl_w], [-105, sl_lat]]]
sl_pts, sl_step = b.sample_points([sl])
out["sliver_n"] = len(sl_pts)
sl_end = b.StopIndex([stop(-105 - 0.3 / (69.172 * 0.7771), sl_lat)])
out["sliver_zero"] = b.settle_zero([sl], sl_pts, sl_step, sl_end, 0.5, b.min_distance_to_polygon_mi([sl], sl_end))
# settle_full's raw ratio can go negative the same way (-1209 on a 10-mile
# sliver); that fixture takes minutes, so check the clamp both paths share.
out["clamp"] = [b.clamp_estimate(v) for v in (-1209.4282, 81.0199, 0.5)]
print(json.dumps(out))`;
  const r = JSON.parse(execFileSync('python3', ['-c', py], { cwd: root, encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }) }));
  assert.deepEqual(r.full_0_8, [1, true], 'a square wholly within reach was not proven full');
  assert.equal(r.full_0_7[1], false, 'corners out of reach, yet proven full');
  assert.ok(r.full_0_7[0] < 1 && r.full_0_7[0] >= 0.99, `unproven full published as ${r.full_0_7[0]}`);
  assert.equal(r.zero_near[1], false, 'a stop 0.3 mi away, yet the ½-mile zero was proven');
  assert.ok(r.zero_near[0] > 0, 'a reachable edge strip was published as 0');
  assert.deepEqual(r.zero_far, [0, true], 'an unreachable zero was not proven');
  assert.ok(r.summ_half > 0.5, `½-mile share of a square with a stop at its centre: ${r.summ_half}`);
  assert.equal(r.u_mean_inside, false, 'the U fixture no longer exercises the sliver fallback');
  assert.equal(r.u_inside, true, 'the sliver fallback point is outside the polygon');
  // An unproven estimate stays a fraction strictly inside (0, 1), even when a
  // sliver's single fallback point makes the area ratio meaningless.
  assert.equal(r.sliver_n, 1, 'the sliver fixture no longer falls back to one point');
  assert.equal(r.sliver_zero[1], false, 'sliver: a reachable zero was marked proven');
  assert.ok(r.sliver_zero[0] > 0 && r.sliver_zero[0] < 1, `sliver: unproven ½-mile share published as ${r.sliver_zero[0]}`);
  assert.deepEqual(r.clamp, [0.0001, 0.9999, 0.5], 'an unproven estimate left (0, 1), or a normal one was moved');
});

// ── #1971 item 3: one staleness limit, the source inventory's ──────────────
test('the panel goes stale exactly at the source inventory\'s maxAgeDays', () => {
  const ctx = {};
  require('node:vm').runInNewContext(read('js/data-source-inventory.js'), { window: ctx });
  const sla = ctx.DataSourceInventory.getSources().find((s) => s.id === 'transit-stops-statewide-co').maxAgeDays;
  assert.ok(sla > 0, 'no SLA in the inventory');
  const src = read('js/hna/hna-renderers.js');
  const body = src.slice(src.indexOf('function renderTransitZonePanel'), src.indexOf('function renderHnaScorecardPanel'));
  assert.doesNotMatch(body, /MAX_AGE|maxAge|86400/, 'the panel keeps its own age limit');
  const gen = Date.parse(data.meta.stops_generated);
  return Promise.all([[sla, 'ok'], [sla + 1, 'unavailable']].map(([days, want]) => {
    const w = page(realFetch());
    return w.HNARenderers.renderTransitZonePanel(sample[0], new Date(gen + days * 86400e3 + 3600e3)).then(() => {
      assert.equal(w.document.getElementById('hnaTransitZoneContent').getAttribute('data-tz-state'), want, `${days} days old`);
    });
  }));
});

Promise.all(pending).then(() => console.log(`hna-transit-zone: ${passed} passed`))
  .catch((e) => { console.error(e); process.exit(1); });
