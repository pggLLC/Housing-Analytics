'use strict';

// js/transit-zone.js — the one HB26-1065 zone answer every page uses (#1937
// Phase 2). Three things are pinned:
//   1. behaviour: within / outside / unconfirmed-only / every unavailable path,
//      and the designation before the OEDIT map, after its due date, and once
//      published;
//   2. agreement: the radius and due date come from
//      data/policy/thiz-map-status.json, and that file must agree with the
//      HB26-1065 entry in data/policy/tax-credit-legislation.json — the helper
//      holds no copy of either;
//   3. the real stop file answers for every Colorado place, fast enough to use.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const TZ = require('../js/transit-zone.js');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const mapStatus = JSON.parse(read('data/policy/thiz-map-status.json'));

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }

const NOW = new Date('2026-09-26T18:00:00Z');
const MI = 1609.344;
function east(lat, lon, miles) { return [lon + (miles * MI) / (111320 * Math.cos(lat * Math.PI / 180)), lat]; }
function stop(coords, name, reliability) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: coords },
           properties: { name, agency: 'Test', sources: reliability === 'unconfirmed' ? ['osm'] : ['cdot'], reliability } };
}
const SITE = { lat: 39.7392, lon: -104.9903 };
function stopsWith(features, generated) {
  return { type: 'FeatureCollection', meta: { generated: generated || '2026-09-26T00:00:00Z' }, features };
}

console.log('\ntransit-zone');

function fewStops0() { return stopsWith([stop(east(SITE.lat, SITE.lon, 1), 'A', 'confirmed')]); }

// ── 1. behaviour ────────────────────────────────────────────────────────────
test('a confirmed stop inside the radius → within_2mi, confirmedOnly', () => {
  const z = TZ.create({ stops: stopsWith([stop(east(SITE.lat, SITE.lon, 1.5), 'A', 'confirmed')]), mapStatus, now: NOW });
  const s = z.status(SITE.lat, SITE.lon);
  assert.equal(s.status, 'within_2mi');
  assert.equal(s.confirmedOnly, true);
  assert.equal(s.nearestConfirmedStop.name, 'A');
  assert.ok(Math.abs(s.nearestStop.distanceMiles - 1.5) < 0.02, `distance ${s.nearestStop.distanceMiles}`);
});

test('only an OpenStreetMap-only stop inside the radius → within_2mi, not confirmedOnly', () => {
  const z = TZ.create({ stops: stopsWith([
    stop(east(SITE.lat, SITE.lon, 0.5), 'OSM', 'unconfirmed'),
    stop(east(SITE.lat, SITE.lon, 3.0), 'Far', 'confirmed'),
  ]), mapStatus, now: NOW });
  const s = z.status(SITE.lat, SITE.lon);
  assert.equal(s.status, 'within_2mi');
  assert.equal(s.confirmedOnly, false);
  assert.equal(s.nearestStop.name, 'OSM');
  assert.equal(s.nearestConfirmedStop.name, 'Far');
});

test('a private shuttle pickup inside the radius does not count as transit', () => {
  const shuttle = stop(east(SITE.lat, SITE.lon, 0.3), 'Hotel pickup', 'confirmed');
  shuttle.properties.operator = 'private_shuttle';
  const z = TZ.create({ stops: stopsWith([shuttle, stop(east(SITE.lat, SITE.lon, 3), 'Bus', 'confirmed')]), mapStatus, now: NOW });
  const s = z.status(SITE.lat, SITE.lon);
  assert.equal(s.status, 'outside');
  assert.equal(s.nearestStop.name, 'Bus');
});

test('nearest stop beyond the radius → outside, with the distance', () => {
  const z = TZ.create({ stops: stopsWith([stop(east(SITE.lat, SITE.lon, 2.5), 'B', 'confirmed')]), mapStatus, now: NOW });
  const s = z.status(SITE.lat, SITE.lon);
  assert.equal(s.status, 'outside');
  assert.ok(s.nearestStop.distanceMiles > mapStatus.zone_radius_miles);
});

test('the boundary follows the radius in the status file, not a constant', () => {
  const pt = east(SITE.lat, SITE.lon, 2.5);
  const wider = Object.assign({}, mapStatus, { zone_radius_miles: 3 });
  const s = TZ.create({ stops: stopsWith([stop(pt, 'B', 'confirmed')]), mapStatus: wider, now: NOW }).status(SITE.lat, SITE.lon);
  assert.equal(s.status, 'within_2mi');
});

for (const [label, opts, reasonRe] of [
  ['no stop data', { stops: null }, /did not load/],
  ['an empty stop file', { stops: stopsWith([]) }, /did not load/],
  ['stop data with no build date', { stops: { type: 'FeatureCollection', meta: {}, features: [stop(east(SITE.lat, SITE.lon, 1), 'A', 'confirmed')] } }, /no build date/],
  ['stale stop data', { stops: stopsWith([stop(east(SITE.lat, SITE.lon, 1), 'A', 'confirmed')], '2026-08-01T00:00:00Z') }, /days old/],
  ['no radius in the status file', { stops: stopsWith([stop(east(SITE.lat, SITE.lon, 1), 'A', 'confirmed')]), mapStatus: Object.assign({}, mapStatus, { zone_radius_miles: null }) }, /radius/],
]) {
  test(`${label} → unavailable with a reason, never outside`, () => {
    const s = TZ.create(Object.assign({ mapStatus, now: NOW }, opts)).status(SITE.lat, SITE.lon);
    assert.equal(s.status, 'unavailable');
    assert.match(s.unavailableReason, reasonRe);
    assert.equal(s.nearestStop, null);
    assert.equal(s.confirmedOnly, null);
  });
}

test('an unreadable site → unavailable', () => {
  const z = TZ.create({ stops: stopsWith([stop(east(SITE.lat, SITE.lon, 1), 'A', 'confirmed')]), mapStatus, now: NOW });
  for (const [lat, lon] of [[null, SITE.lon], [NaN, SITE.lon], ['39.7', '-104.9'], [undefined, undefined]]) {
    assert.equal(z.status(lat, lon).status, 'unavailable', `lat=${lat} lon=${lon}`);
  }
});

test('a missing, swapped or out-of-state location → unavailable, never outside or official_out', () => {
  const box = [[[-110, 36], [-101, 36], [-101, 42], [-110, 42], [-110, 36]]];
  const zones = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: box } }] };
  const pub = Object.assign({}, mapStatus, { status: 'published' });
  for (const z of [TZ.create({ stops: fewStops0(), mapStatus, now: NOW }), TZ.create({ stops: fewStops0(), mapStatus: pub, zones, now: NOW })]) {
    for (const [lat, lon, why] of [[0, 0, 'null island'], [-105, 40, 'swapped'], [40.76, -111.89, 'Salt Lake City'], [39.7, 104.99, 'sign lost']]) {
      const s = z.status(lat, lon);
      assert.equal(s.status, 'unavailable', why);
      assert.notEqual(s.designation, 'official_out', why);
      assert.notEqual(s.designation, 'official_in', why);
      assert.match(s.unavailableReason, /outside Colorado/, why);
    }
  }
});

test('the Colorado box is the one the route fetcher uses', () => {
  const py = read('scripts/market/fetch_gtfs_transit.py');
  const m = py.match(/CO_BBOX = \(([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+)\)/);
  assert.ok(m, 'CO_BBOX not found in fetch_gtfs_transit.py');
  const js = read('js/transit-zone.js');
  const j = js.match(/minLon: ([-\d.]+), minLat: ([-\d.]+), maxLon: ([-\d.]+), maxLat: ([-\d.]+)/);
  assert.ok(j, 'CO_BBOX not found in js/transit-zone.js');
  assert.deepEqual(j.slice(1).map(Number), m.slice(1).map(Number));
});

// Designation
const fewStops = stopsWith([stop(east(SITE.lat, SITE.lon, 1), 'A', 'confirmed')]);
const DUE_WORDS = (() => {
  const [y, m, d] = mapStatus.map_due_date.split('-').map(Number);
  // #1937's provisional wording: "(due Oct 30, 2026)".
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
})();

test('before the due date: provisional, naming the due date from the status file', () => {
  const s = TZ.create({ stops: fewStops, mapStatus, now: NOW }).status(SITE.lat, SITE.lon);
  assert.equal(s.designation, 'provisional');
  assert.match(s.designationNote, /reliability questionable/);
  assert.ok(s.designationNote.includes(`(due ${DUE_WORDS})`), s.designationNote);
});

test('after the due date with no map loaded: still provisional, says to check', () => {
  const later = new Date(Date.parse(mapStatus.map_due_date) + 5 * 86400000);
  const s = TZ.create({ stops: stopsWith(fewStops.features, later.toISOString()), mapStatus, now: later }).status(SITE.lat, SITE.lon);
  assert.equal(s.designation, 'provisional');
  assert.match(s.designationNote, /was due/);
  assert.match(s.designationNote, /check whether it has been released/);
});

test('published with zones: official_in / official_out by polygon, screen result unchanged', () => {
  const box = (lon, lat, d) => [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]];
  const zones = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: box(SITE.lon, SITE.lat, 0.01) } }] };
  const pub = Object.assign({}, mapStatus, { status: 'published' });
  const z = TZ.create({ stops: fewStops, mapStatus: pub, zones, now: NOW });
  const inside = z.status(SITE.lat, SITE.lon);
  assert.equal(inside.designation, 'official_in');
  assert.equal(inside.status, 'within_2mi');
  assert.equal(z.status(SITE.lat + 0.05, SITE.lon).designation, 'official_out');
});

for (const [label, bad] of [
  ['a zone with no geometry', { type: 'Feature', geometry: null }],
  ['a zone with an unclosed ring', { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-105, 39], [-104, 39], [-104, 40]]] } }],
  ['a zone of an unsupported type', { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-105, 39], [-104, 40]] } }],
]) {
  test(`published map with ${label}: provisional with the reason, never official_out`, () => {
    const box = (lon, lat, d) => [[[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]];
    const good = { type: 'Feature', geometry: { type: 'Polygon', coordinates: box(-104, 38, 0.01) } };
    const pub = Object.assign({}, mapStatus, { status: 'published' });
    const s = TZ.create({ stops: fewStops, mapStatus: pub, zones: { type: 'FeatureCollection', features: [good, bad] }, now: NOW })
      .status(SITE.lat, SITE.lon);
    assert.equal(s.designation, 'provisional');
    assert.match(s.designationNote, /could not be read \(1 of 2 zones unusable\)/);
    assert.equal(s.status, 'within_2mi', 'the stop-based screen still answers');
  });
}

test('published but zones not loaded: provisional, says so', () => {
  const pub = Object.assign({}, mapStatus, { status: 'published' });
  const s = TZ.create({ stops: fewStops, mapStatus: pub, zones: null, now: NOW }).status(SITE.lat, SITE.lon);
  assert.equal(s.designation, 'provisional');
  assert.match(s.designationNote, /not been loaded/);
});

test('no status file: provisional, and the reason is given', () => {
  const s = TZ.create({ stops: fewStops, mapStatus: null, now: NOW }).status(SITE.lat, SITE.lon);
  assert.equal(s.status, 'unavailable');   // no radius without the file
  assert.equal(s.designation, 'provisional');
  assert.match(s.designationNote, /could not be read/);
});

// ── 2. agreement ────────────────────────────────────────────────────────────
test('the status file agrees with the HB26-1065 legislation entry', () => {
  const leg = JSON.parse(read('data/policy/tax-credit-legislation.json'));
  const entries = Array.isArray(leg) ? leg : (leg.entries || leg.credits || leg.items || []);
  const e = entries.find((x) => /hb26-1065/i.test(x.id || ''));
  assert.ok(e, 'HB26-1065 entry not found in tax-credit-legislation.json');
  const text = [e.source_note, e.pricing_impact].join(' ');
  assert.ok(text.includes(`due ${mapStatus.map_due_date}`), `legislation entry does not give the map due date ${mapStatus.map_due_date}`);
  assert.ok(text.includes(`${mapStatus.zone_radius_miles}-mile radius`), `legislation entry does not give a ${mapStatus.zone_radius_miles}-mile radius`);
  assert.equal(e.source_url, 'https://leg.colorado.gov/bills/HB26-1065');
  assert.ok(['not_published', 'published'].includes(mapStatus.status));
  if (mapStatus.status === 'published') {
    assert.ok(mapStatus.zones_file && fs.existsSync(path.join(root, mapStatus.zones_file)),
      'status says published but zones_file is missing');
  }
});

test('the helper holds no copy of the due date or the radius', () => {
  const src = read('js/transit-zone.js').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
  assert.ok(!src.includes(mapStatus.map_due_date), 'js/transit-zone.js hardcodes the map due date');
  assert.ok(!src.includes(DUE_WORDS), 'js/transit-zone.js hardcodes the map due date in words');
  assert.doesNotMatch(src, /\b2(?:\.0)?\s*\*\s*1609|\bradius\s*=\s*2\b|TWO_MILE/i, 'js/transit-zone.js hardcodes the radius');
});

// ── 3. the real stop file ───────────────────────────────────────────────────
test('the real stop file answers for every Colorado place', () => {
  const stops = JSON.parse(read('data/amenities/transit_stops_statewide_co.geojson'));
  const places = JSON.parse(read('data/co-place-centroids.json')).byGeoid;
  const z = TZ.create({ stops, mapStatus, now: new Date(Date.parse(stops.meta.generated) + 86400000) });
  assert.equal(z.dataProblem, null);
  const ids = Object.keys(places);
  assert.ok(ids.length > 400, 'place scan found too few places to be meaningful');
  const t0 = Date.now();
  const counts = { within_2mi: 0, outside: 0, unavailable: 0 };
  for (const id of ids) counts[z.status(places[id].lat, places[id].lng).status]++;
  const ms = Date.now() - t0;
  assert.equal(counts.unavailable, 0, 'a place with a readable centre came back unavailable');
  assert.ok(counts.within_2mi > 100 && counts.outside > 100, JSON.stringify(counts));
  assert.ok(ms < 3000, `${ids.length} places took ${ms} ms`);
  const denver = z.status(39.7527, -105.0003);   // Union Station
  assert.equal(denver.status, 'within_2mi');
  assert.equal(denver.confirmedOnly, true);
  assert.ok(denver.nearestStop.distanceMiles < 0.2);
  console.log(`    ${ids.length} places: ${counts.within_2mi} within ${mapStatus.zone_radius_miles} mi, ${counts.outside} outside (${ms} ms)`);
});

// ── 4. #1970 merge-bar checklist, #1973 map-failure funding path ────────────
const { spawnSync } = require('node:child_process');
const vm = require('node:vm');
const RADIUS = mapStatus.zone_radius_miles;

// A stop placed so its haversine distance from SITE is `miles` to the bit:
// the radius is then set to exactly that distance, so the boundary case is
// the real comparison, not a rounding accident.
function exactBoundary(reliability) {
  const pt = east(SITE.lat, SITE.lon, 1.8);
  const d = TZ.haversineMiles(SITE.lat, SITE.lon, pt[1], pt[0]);
  return { pt, ms: Object.assign({}, mapStatus, { zone_radius_miles: d }), reliability };
}

test('a stop exactly at the radius is within (confirmed and OpenStreetMap-only)', () => {
  for (const rel of ['confirmed', 'unconfirmed']) {
    const { pt, ms } = exactBoundary(rel);
    const s = TZ.create({ stops: stopsWith([stop(pt, 'Edge', rel)]), mapStatus: ms, now: NOW }).status(SITE.lat, SITE.lon);
    assert.equal(s.status, 'within_2mi', `${rel} stop at exactly the radius`);
    assert.equal(s.confirmedOnly, rel === 'confirmed');
  }
});

// A point due east of SITE whose haversine distance is `miles` (to ~1e-9 mi).
function atMiles(miles) {
  let lo = 0, hi = 0.1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (TZ.haversineMiles(SITE.lat, SITE.lon, SITE.lat, SITE.lon + mid) < miles) lo = mid; else hi = mid;
  }
  return [SITE.lon + hi, SITE.lat];
}

test('the shown distance never contradicts the status, on either side of the boundary', () => {
  const cases = [[2.004, 'outside'], [2.0001, 'outside'], [1.996, 'within_2mi'], [1.9999, 'within_2mi']];
  let crossing = 0;
  for (const [miles, want] of cases) {
    const pt = atMiles(miles);
    const d = TZ.haversineMiles(SITE.lat, SITE.lon, pt[1], pt[0]);
    if ((d > RADIUS) !== (Math.round(d * 100) / 100 > RADIUS)) crossing++;
    const s = TZ.create({ stops: stopsWith([stop(pt, 'S', 'confirmed')]), mapStatus, now: NOW }).status(SITE.lat, SITE.lon);
    assert.equal(s.status, want, `${miles} mi (${d})`);
    for (const shown of [s.nearestStop.distanceMiles, s.nearestConfirmedStop.distanceMiles]) {
      assert.equal(shown > RADIUS, want === 'outside', `${d} mi shown as ${shown} with status ${s.status}`);
      assert.ok(Math.abs(shown - d) <= 0.01, `${d} mi shown as ${shown}`);
      assert.ok(Math.abs(Math.round(shown * 100) - shown * 100) < 1e-6, `${shown} is not to 0.01 mi`);
    }
  }
  assert.ok(crossing >= 1, 'no case would round across the radius, so the scan checks nothing');
  // Away from the boundary, plain rounding is unchanged.
  const far = TZ.create({ stops: stopsWith([stop(east(SITE.lat, SITE.lon, 1.5), 'S', 'confirmed')]), mapStatus, now: NOW }).status(SITE.lat, SITE.lon);
  const pt = east(SITE.lat, SITE.lon, 1.5);
  assert.equal(far.nearestStop.distanceMiles, Math.round(TZ.haversineMiles(SITE.lat, SITE.lon, pt[1], pt[0]) * 100) / 100);
});

test('the status name carries the radius in the status file', () => {
  const src = read('js/transit-zone.js');
  const names = [...src.matchAll(/within_(\d+(?:\.\d+)?)mi/g)].map((m) => Number(m[1]));
  assert.ok(names.length >= 2, 'no within_<n>mi status found in js/transit-zone.js');
  for (const n of names) assert.equal(n, RADIUS, `status within_${n}mi but zone_radius_miles is ${RADIUS}`);
});

// The private-shuttle marker: helper, builder and the shipped stop file.
function shuttleAgreement(builderSrc, helperSrc, fileValues) {
  const helper = (helperSrc.match(/properties\.operator === '([^']+)'\) continue;/) || [])[1];
  assert.ok(helper, 'the helper no longer skips an operator value');
  const emitted = new Set([...builderSrc.matchAll(/"operator"\]?\s*[:=]\s*"([^"]+)" if [^\n]*? else "([^"]+)"/g)].flatMap((m) => [m[1], m[2]]));
  assert.ok(emitted.size >= 2, 'no operator values found in build_transit_stops_co.py');
  assert.ok(emitted.has(helper), `the helper skips operator "${helper}"; the builder writes ${[...emitted].join(', ')}`);
  assert.ok(fileValues.has(helper), `the stop file has no operator "${helper}" (it has ${[...fileValues].join(', ')})`);
  for (const v of fileValues) assert.ok(emitted.has(v), `the stop file has operator "${v}", which the builder does not write`);
  return helper;
}
const realStops = JSON.parse(read('data/amenities/transit_stops_statewide_co.geojson'));
const builderSrc = read('scripts/market/build_transit_stops_co.py');

test('the private-shuttle value agrees with the builder and the real stop file', () => {
  const fileValues = new Set(realStops.features.map((f) => f.properties.operator));
  const helperValue = shuttleAgreement(builderSrc, read('js/transit-zone.js'), fileValues);
  // A renamed builder value must break the agreement (proves the scan bites).
  const renamed = builderSrc.replace(/"private_shuttle"/g, '"private_bus"');
  assert.notEqual(renamed, builderSrc, 'rename did not apply');
  assert.throws(() => shuttleAgreement(renamed, read('js/transit-zone.js'), fileValues), /builder writes/);
  // And the real shuttle stops are what the helper skips.
  const shuttles = realStops.features.filter((f) => f.properties.operator === helperValue);
  assert.ok(shuttles.length > 0, 'the real stop file has no private shuttle stops to check');
  const [lon, lat] = shuttles[0].geometry.coordinates;
  const z = TZ.create({ stops: stopsWith([shuttles[0], stop([lon + 0.5, lat], 'Far', 'confirmed')]), mapStatus, now: NOW });
  const s = z.status(lat, lon);
  assert.equal(s.nearestStop && s.nearestStop.name, 'Far', 'a real private shuttle stop counted as transit');
});

test('the stop-age limit equals the inventory\'s maxAgeDays for the stop file', () => {
  const ctx = {};
  vm.runInNewContext(read('js/data-source-inventory.js'), { window: ctx });
  const src = ctx.DataSourceInventory.getSources().find((x) => x.id === 'transit-stops-statewide-co');
  assert.ok(src && Number.isFinite(src.maxAgeDays), 'transit-stops-statewide-co has no maxAgeDays in the inventory');
  assert.equal(TZ.MAX_AGE_DAYS, src.maxAgeDays, 'js/transit-zone.js stop-age limit differs from js/data-source-inventory.js');
  // And it is the limit create() applies by default.
  const gen = new Date(NOW.getTime() - (src.maxAgeDays + 1) * 86400000).toISOString();
  const s = TZ.create({ stops: stopsWith(fewStops.features, gen), mapStatus, now: NOW }).status(SITE.lat, SITE.lon);
  assert.match(s.unavailableReason, new RegExp(`limit ${src.maxAgeDays}\\)`));
});

test('every note that is not an official designation says "reliability questionable"', () => {
  const pub = Object.assign({}, mapStatus, { status: 'published' });
  const later = new Date(Date.parse(mapStatus.map_due_date) + 5 * 86400000);
  const badZones = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null }] };
  const notes = [
    TZ.create({ stops: fewStops, mapStatus, now: NOW }).status(SITE.lat, SITE.lon),
    TZ.create({ stops: stopsWith(fewStops.features, later.toISOString()), mapStatus, now: later }).status(SITE.lat, SITE.lon),
    TZ.create({ stops: fewStops, mapStatus: null, now: NOW }).status(SITE.lat, SITE.lon),
    TZ.create({ stops: fewStops, mapStatus: pub, zones: null, now: NOW }).status(SITE.lat, SITE.lon),
    TZ.create({ stops: fewStops, mapStatus: pub, zones: badZones, now: NOW }).status(SITE.lat, SITE.lon),
    TZ.create({ stops: fewStops, mapStatus, now: NOW }).status(0, 0),
    TZ.designation(mapStatus, NOW), TZ.designation(mapStatus, later), TZ.designation(null, NOW), TZ.designation(pub, NOW),
  ].map((r) => r.designationNote || r.note);
  // Point and area share three notes; the other seven variants are distinct.
  assert.ok(new Set(notes).size >= 7, `only ${new Set(notes).size} distinct notes scanned`);
  for (const n of notes) assert.match(n, /reliability questionable/, n);
});

test('the Colorado box agrees with the builder\'s in_colorado_bbox (no tolerance)', () => {
  const pts = [
    [38.5, -102.03, 'Kansas, just east of the line'], [38.5, -102.0416, 'Kansas, a hair east'],
    [38.5, -102.0415, 'on the eastern line'], [38.5, -102.06, 'Colorado, near the line'],
    [39.0, -109.07, 'Utah, just west'], [36.98, -105.0, 'New Mexico, just south'],
    [41.01, -105.0, 'Wyoming, just north'], [39.7392, -104.9903, 'Denver'],
  ];
  const py = spawnSync('python3', ['-c', `import sys,json; sys.path.insert(0,'scripts/market'); import build_transit_stops_co as b; print(json.dumps([b.in_colorado_bbox(x, y) for y, x in json.loads(sys.argv[1])]))`,
    JSON.stringify(pts.map(([la, lo]) => [la, lo]))], { cwd: root, encoding: 'utf8' });
  assert.equal(py.status, 0, py.stderr);
  const builder = JSON.parse(py.stdout);
  assert.ok(builder.includes(true) && builder.includes(false), 'the point scan does not straddle the line');
  const z = TZ.create({ stops: fewStops, mapStatus, now: NOW });
  pts.forEach(([la, lo, why], i) => {
    const helperIn = !/outside Colorado/.test(z.status(la, lo).unavailableReason || '');
    assert.equal(helperIn, builder[i], `${why}: helper says ${helperIn ? 'Colorado' : 'not Colorado'}, builder ${builder[i]}`);
  });
});

test('a published OEDIT map that fails to load or read gives no funding path (#1973)', () => {
  const pub = Object.assign({}, mapStatus, { status: 'published', zones_file: 'data/policy/thiz-zones.geojson' });
  const badZones = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null }] };
  const before = TZ.create({ stops: fewStops, mapStatus, now: NOW }).status(SITE.lat, SITE.lon);
  assert.equal(TZ.fundingPath(before), 'screen', 'before publication, a confirmed stop is the screen path');
  for (const [label, zones] of [['not loaded (fetch failed or zones_file rejected)', null], ['unreadable', badZones]]) {
    const s = TZ.create({ stops: fewStops, mapStatus: pub, zones, now: NOW }).status(SITE.lat, SITE.lon);
    assert.equal(s.status, 'within_2mi', label);
    assert.equal(s.confirmedOnly, true, label);
    assert.equal(s.designation, 'provisional', label);
    assert.equal(TZ.fundingPath(s), null, `${label}: a published map that did not load still opened the screen path`);
  }
});

// The status file's own freshness: while the map is unpublished, last_checked
// must be refreshed (scripts/audit/data-freshness-check.mjs).
const os = require('node:os');
function freshness(asOf, statusOverride) {
  let cwd = root;
  if (statusOverride !== undefined) {
    // A throwaway root with only the files the check needs for this row.
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'thiz-fresh-'));
    for (const f of ['scripts/audit/data-freshness-check.mjs', 'js/data-source-inventory.js']) {
      fs.mkdirSync(path.dirname(path.join(cwd, f)), { recursive: true });
      fs.copyFileSync(path.join(root, f), path.join(cwd, f));
    }
    fs.mkdirSync(path.join(cwd, 'data/policy'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'data/policy/thiz-map-status.json'), JSON.stringify(statusOverride));
  }
  const r = spawnSync(process.execPath, ['scripts/audit/data-freshness-check.mjs', '--json', `--as-of=${asOf}`], { cwd, encoding: 'utf8' });
  if (cwd !== root) fs.rmSync(cwd, { recursive: true, force: true });
  assert.ok([0, 1, 2].includes(r.status) && r.stdout, r.stderr || 'freshness check did not run');
  const row = JSON.parse(r.stdout).results.find((x) => x.file === 'data/policy/thiz-map-status.json');
  assert.ok(row && row.present, 'no freshness row for data/policy/thiz-map-status.json');
  return row;
}

test('the zone-map status file goes stale unless last_checked is refreshed, while unpublished', () => {
  const checked = Date.parse(mapStatus.last_checked);
  assert.ok(Number.isFinite(checked), 'thiz-map-status.json has no readable last_checked');
  const day = (n) => new Date(checked + n * 86400000).toISOString().slice(0, 10);
  const fresh = freshness(day(1));
  assert.equal(fresh.source, 'last_checked');
  assert.equal(fresh.stale, false);
  assert.equal(freshness(day(fresh.slaDays + 2)).stale, true, 'an old last_checked did not go stale');
  if (mapStatus.status !== 'published') {
    const noCheck = Object.assign({}, mapStatus); delete noCheck.last_checked;
    assert.equal(freshness(day(1), noCheck).stale, true, 'a status file with no last_checked counted as fresh');
    const pub = Object.assign({}, mapStatus, { status: 'published' });
    const p = freshness(day(fresh.slaDays + 30), pub);
    assert.equal(p.stale, false, 'a published map still ages');
    assert.equal(p.notApplicable, true);
  }
});

console.log(`transit-zone: ${passed} passed`);
