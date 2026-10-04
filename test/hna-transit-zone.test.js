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
const { execFileSync } = require('node:child_process');
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

// H1: execute the Phase 3 functions now, not just their cached output. Fixed
// points intentionally straddle the 2-mile edge and both axes of the 0.05°
// index; changing either implementation must not silently move the answer.
const parityPoints = [
  { id: 'just-inside-2mi', lat: 39.037323775, lon: -108.6 },
  { id: 'just-outside-2mi', lat: 39.037259151, lon: -108.6 },
  { id: 'grid-lat-below', lat: 39.049999, lon: -108.75 },
  { id: 'grid-lat-above', lat: 39.050001, lon: -108.75 },
  { id: 'grid-lon-below', lat: 37.81, lon: -107.650001 },
  { id: 'grid-lon-above', lat: 37.81, lon: -107.649999 },
  { id: 'unconfirmed-Silverton', lat: 37.810631, lon: -107.663076 },
  { id: 'Empire-hole', lat: 39.76138549990078, lon: -105.67996338895097 },
  { id: 'Empire-interior', lat: 39.75996700021912, lon: -105.68170860770365 },
];
const empire = readJson('data/co-place-boundaries.geojson').features.find(f => f.properties.geoid === '0824620');
assert.ok(empire, 'real Empire boundary is missing');
const pyParity = JSON.parse(execFileSync('python3', ['-c', `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('zone', 'scripts/market/build_transit_zone_by_geography.py')
z = importlib.util.module_from_spec(spec)
spec.loader.exec_module(z)
stops = json.loads(z.STOPS.read_text())
idx = z.StopIndex(stops['features'])
request = json.load(sys.stdin)
polys = z.polygons_of(request['geometry'])
radius = json.loads(z.MAP_STATUS.read_text())['zone_radius_miles']
answers = []
for p in request['points']:
    lat, lon = p['lat'], p['lon']
    _, distance = idx.nearest(lat, lon, True)
    confirmed = idx.any_within(lat, lon, radius, True)
    any_stop = idx.any_within(lat, lon, radius, False)
    answers.append(dict(id=p['id'], distance=distance,
        status='within_2mi' if any_stop else 'outside',
        confirmedOnly=confirmed or not any_stop,
        inside=z.contains(polys, lon, lat),
        insideShell=any(z._in_ring(lon, lat, poly[0]) for poly in polys)))
print(json.dumps(dict(cellDegrees=z.CELL_DEG, stopCount=len(stops['features']), answers=answers)))
`], { cwd: root, encoding: 'utf8',
  input: JSON.stringify({ points: parityPoints, geometry: empire.geometry }),
  env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }));

test('JS and live Python Phase 3 agree on status, distance and polygon holes at all fixed points', () => {
  assert.equal(pyParity.stopCount, stops.features.length);
  assert.ok(pyParity.stopCount > 1000, 'real statewide stops were not exercised');
  assert.equal(pyParity.answers.length, parityPoints.length);
  // Exercise the polygon path with real geometry. This is a test-only map
  // adapter, NOT a claim that Empire is an official OEDIT zone.
  const zones = { type: 'FeatureCollection',
    meta: { sourceUrl: mapStatus.map_source_url, vintage: stops.meta.generated, complete: true },
    features: [{ ...empire, id: 'parity-polygon', properties: {
      facilityId: 'test-only', facilityType: 'transit_station' } }] };
  const zone = TZ.create({ stops, zones,
    mapStatus: { ...mapStatus, status: 'published', zones_file: 'test-only-polygon' },
    now: new Date(stops.meta.generated) });
  let checked = 0;
  for (const point of parityPoints) {
    const python = pyParity.answers.find(p => p.id === point.id);
    const js = zone.status(point.lat, point.lon, 'manual_coordinates');
    assert.equal(js.status, python.status, `${point.id}: stop status`);
    assert.equal(js.confirmedOnly, python.confirmedOnly, `${point.id}: confirmed vs OSM-only basis`);
    assert.ok(js.nearestConfirmedStop, `${point.id}: no confirmed distance`);
    // JS publishes hundredths, rounding away from the radius when necessary.
    // <0.010000001 mi allows that display rounding, not algorithmic drift.
    assert.ok(Math.abs(js.nearestConfirmedStop.distanceMiles - python.distance) < 0.010000001,
      `${point.id}: JS ${js.nearestConfirmedStop.distanceMiles} vs Python ${python.distance} miles`);
    assert.equal(js.program.qualified, python.inside, `${point.id}: polygon inclusion`);
    assert.equal(js.designation, python.inside ? 'official_in' : 'official_out', `${point.id}: polygon designation`);
    checked++;
  }
  assert.equal(checked, parityPoints.length, 'not every fixed point was checked');
  const answer = id => pyParity.answers.find(p => p.id === id);
  assert.equal(answer('just-inside-2mi').status, 'within_2mi');
  assert.equal(answer('just-outside-2mi').status, 'outside');
  for (const id of ['just-inside-2mi', 'just-outside-2mi']) {
    assert.ok(Math.abs(answer(id).distance - mapStatus.zone_radius_miles) < 0.002,
      `${id}: no longer exercises the real stop file's two-mile edge`);
  }
  assert.equal(answer('unconfirmed-Silverton').status, 'within_2mi');
  assert.equal(answer('unconfirmed-Silverton').confirmedOnly, false, 'must exercise an OSM-only answer');
  assert.equal(answer('Empire-hole').insideShell, true, 'hole point must be inside the outer ring');
  assert.equal(answer('Empire-hole').inside, false, 'hole must be excluded');
  assert.equal(answer('Empire-interior').inside, true, 'must also exercise polygon inclusion');
});

test('both Phase 3 indexes keep the 0.05-degree grid contract exercised by the boundary pairs', () => {
  // A consistently changed index can return identical nearest stops. Pin its
  // cell size separately, rather than pretending behavior alone detects it.
  const cells = [...read('js/transit-zone.js').matchAll(/\bvar CELL_DEG\s*=\s*([\d.]+)\s*;/g)];
  assert.equal(cells.length, 1, 'JS grid declaration not found exactly once');
  assert.equal(Number(cells[0][1]), pyParity.cellDegrees, 'JS/Python grid-cell sizes differ');
  assert.equal(pyParity.cellDegrees, 0.05, 'fixed samples require the 0.05-degree index');
  for (const axis of ['lat', 'lon']) {
    const a = parityPoints.find(p => p.id === `grid-${axis}-below`)[axis];
    const b = parityPoints.find(p => p.id === `grid-${axis}-above`)[axis];
    assert.equal(Math.floor(b / pyParity.cellDegrees) - Math.floor(a / pyParity.cellDegrees), 1,
      `${axis}: sample pair no longer straddles a grid cell`);
  }
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
// How the panel must print a share is TZ.shareLabel (js/transit-zone.js):
// rounded, except that a measured share never rounds to an absolute (0.4% is
// not "0%", 99.6% is not "100%"). The panel must agree with it; this file does
// not restate the rule (#1973).
const shareLabel = TZ.shareLabel;
// A measured share that plain rounding would print as an absolute.
const roundsToZero = (v) => v > 0 && Math.round(v * 100) === 0;
const roundsToAll = (v) => v < 1 && Math.round(v * 100) === 100;
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
  const tiny = entries.find(([, g]) => roundsToZero(g.share_within_radius_confirmed));
  const nearAll = entries.find(([, g]) => roundsToAll(g.share_within_radius_confirmed));
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

test('private shuttle pickups and demand-response stops never reach the figures', () => {
  // Behaviour, not source text: index one stop of each kind with the
  // builder's own StopIndex, and ask js/transit-zone.js the same question.
  // Both must see only the public scheduled stop (scripts/lib/transit_stops.py;
  // owner decision 2026-09-27: on-demand providers are not defined routes).
  const { execFileSync } = require('node:child_process');
  const kinds = [
    { name: 'fixed', props: { operator: 'public', reliability: 'confirmed', service: 'fixed_route' } },
    { name: 'unknown', props: { operator: 'public', reliability: 'confirmed', service: 'unknown' } },
    { name: 'shuttle', props: { operator: 'private_shuttle', reliability: 'confirmed', service: 'fixed_route' } },
    { name: 'flex', props: { operator: 'public', reliability: 'confirmed', service: 'demand_response' } },
  ];
  const feats = kinds.map((k, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [-104.99 + i * 0.001, 39.74] },
    properties: Object.assign({ name: k.name }, k.props) }));
  const py = 'import importlib.util, json, sys\n' +
    'spec = importlib.util.spec_from_file_location("tz", "scripts/market/build_transit_zone_by_geography.py")\n' +
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n' +
    'idx = m.StopIndex(json.loads(sys.stdin.read()))\n' +
    'print(json.dumps(sorted(p["name"] for cell in idx.cells.values() for _, _, p in cell)))\n';
  const indexed = JSON.parse(execFileSync('python3', ['-c', py], { cwd: root, encoding: 'utf8', input: JSON.stringify(feats),
    env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }) }));
  assert.deepEqual(indexed, ['fixed', 'unknown'], 'the zone builder counts a private shuttle or a demand-response stop');
  for (const k of kinds) {
    const only = { type: 'FeatureCollection', meta: { generated: new Date().toISOString() },
      features: [feats.find((f) => f.properties.name === k.name)] };
    const r = TZ.create({ stops: only, mapStatus }).status(39.74, -104.99);
    const counted = r.status === 'within_2mi';
    assert.equal(counted, indexed.includes(k.name), `js/transit-zone.js and the builder disagree on a ${k.name} stop`);
  }
  const shuttles = stops.features.filter((f) => f.properties.operator === 'private_shuttle');
  assert.ok(shuttles.length > 0, 'no private shuttle stops in the stop file — the scan found nothing to check');
  const names = new Set(shuttles.map((f) => f.properties.name));
  for (const [id, g] of Object.entries(data.geographies)) {
    const n = g.nearest_confirmed_stop;
    if (n && names.has(n.name) && shuttles.some((f) => f.properties.name === n.name && f.properties.agency === n.agency)) {
      assert.fail(`${id}: nearest confirmed stop is a private shuttle pickup (${n.name}, ${n.agency})`);
    }
  }
  const flex = stops.features.filter((f) => f.properties.service === 'demand_response');
  assert.ok(flex.length > 0, 'no demand-response stops in the stop file — the scan found nothing to check');
  const flexKeys = new Set(flex.map((f) => f.properties.name + '|' + f.properties.agency));
  const scheduled = new Set(stops.features.filter((f) => f.properties.service !== 'demand_response' &&
    f.properties.operator !== 'private_shuttle').map((f) => f.properties.name + '|' + f.properties.agency));
  for (const [id, g] of Object.entries(data.geographies)) {
    const n = g.nearest_confirmed_stop;
    const key = n && (n.name + '|' + n.agency);
    if (key && flexKeys.has(key) && !scheduled.has(key)) {
      assert.fail(`${id}: nearest confirmed stop is a demand-response stop (${n.name}, ${n.agency})`);
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

// ── #1961: one half-mile value, and its disclosure on every tile ───────────
// The tile's distance and its "straight-line; CHFA scores walking distance"
// sentence are TransitZone.qapTodDistance's, built from thiz-map-status.json.
// Agreement, not copy: whatever the status file says, the tile says.
const tod = TZ.qapTodDistance(mapStatus);
const STATUS_URL = 'data/policy/thiz-map-status.json';
const withTod = (patch) => {
  const ms = JSON.parse(JSON.stringify(mapStatus));
  if (patch === null) delete ms.qap_tod_distance; else Object.assign(ms.qap_tod_distance, patch);
  return ms;
};

test('the file was built for the status file\'s TOD distance', () => {
  assert.ok(tod, 'thiz-map-status.json has no readable qap_tod_distance');
  assert.equal(data.meta.qap_tod_miles, tod.miles, 'transit-zone-by-geography.json was built for a different half-mile distance');
});

test('every rendered ½-mile tile carries the shared disclosure (all 546)', () => shown.then((out) => {
  let n = 0;
  for (const r of Object.values(out)) {
    if (!r) continue;
    n++;
    assert.ok(r.half.includes(tod.disclosure), `a ½-mile tile without the disclosure: ${r.half}`);
    assert.ok(r.half.includes(`within ${tod.label} of a confirmed stop`), `a ½-mile tile that does not name the data's distance: ${r.half}`);
  }
  assert.ok(n > 540, `only ${n} tiles rendered — the scan found too little to check`);
}));

test('the tile\'s disclosure follows the status file\'s method fields', () => {
  const walked = withTod({ method: 'walking' });
  const after = TZ.qapTodDistance(walked);
  assert.notEqual(after.disclosure, tod.disclosure, 'fixture: the method change did not change the disclosure');
  const w = page(realFetch({ [STATUS_URL]: walked }));
  return w.HNARenderers.renderTransitZonePanel(sample[0], FRESH).then(() => {
    const half = w.document.querySelector('[data-tz="half"]');
    assert.equal(half.querySelector('[data-tz-disclosure]').textContent, after.disclosure);
    assert.ok(!half.textContent.includes(tod.disclosure), 'the tile kept the old disclosure');
  });
});

for (const [label, ms, doc, reason] of [
  ['the status file has no TOD distance', () => withTod(null), () => data, /could not be read/],
  ['the status file names an unknown measure', () => withTod({ method: 'as_the_crow_guesses' }), () => data, /could not be read/],
  ['the status file failed to load', () => 'fail', () => data, /could not be read/],
  ['the file was built for another distance', () => mapStatus,
    () => Object.assign({}, data, { meta: Object.assign({}, data.meta, { qap_tod_miles: tod.miles * 2 }) }), /built for a/],
]) {
  test(`${label} → the ½-mile tile is "Unavailable" with the reason, never a share`, () => {
    const w = page(realFetch({ [STATUS_URL]: ms(), 'data/hna/transit-zone-by-geography.json': doc() }));
    return w.HNARenderers.renderTransitZonePanel(sample[0], FRESH).then(() => {
      const el = w.document.getElementById('hnaTransitZoneContent');
      assert.equal(el.getAttribute('data-tz-state'), 'ok', 'the whole panel went unavailable over the half-mile distance');
      const half = el.querySelector('[data-tz="half"]');
      assert.equal(half.getAttribute('data-tz-half-state'), 'unavailable');
      assert.match(half.textContent, /Unavailable/);
      assert.match(half.textContent, reason);
      assert.doesNotMatch(half.textContent, /\d+%/);
      assert.ok(el.querySelector('[data-tz="share"]').textContent.startsWith(shareLabel(sample[1].share_within_radius_confirmed)),
        'the zone-radius share should still show');
    });
  });
}

Promise.all(pending).then(() => console.log(`hna-transit-zone: ${passed} passed`))
  .catch((e) => { console.error(e); process.exit(1); });
