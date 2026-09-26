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

// Designation
const fewStops = stopsWith([stop(east(SITE.lat, SITE.lon, 1), 'A', 'confirmed')]);
const DUE_WORDS = (() => {
  const [y, m, d] = mapStatus.map_due_date.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[m - 1]} ${d}, ${y}`;
})();

test('before the due date: provisional, naming the due date from the status file', () => {
  const s = TZ.create({ stops: fewStops, mapStatus, now: NOW }).status(SITE.lat, SITE.lon);
  assert.equal(s.designation, 'provisional');
  assert.match(s.designationNote, /reliability questionable/);
  assert.ok(s.designationNote.includes(DUE_WORDS), s.designationNote);
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

console.log(`transit-zone: ${passed} passed`);
