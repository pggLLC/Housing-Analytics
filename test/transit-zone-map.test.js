'use strict';

// The map in the HNA "Potential location: transit zone (HB26-1065)" panel.
//
//   * data/hna/transit-zone-map.json must be built from the committed stop
//     file (its date and its counted-stop set) at the status file's radius;
//   * every counted stop must sit inside the merged zone shape, and the shape
//     must not reach far past the radius of the nearest stop;
//   * thiz-map-status.json's statute quote must say the radius the screen uses;
//   * every view with the panel must load the map and Leaflet;
//   * with no Leaflet the map says "Map unavailable" with a reason, never blank.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const TZ = require('../js/transit-zone.js');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

const map = readJson('data/hna/transit-zone-map.json');
const stops = readJson('data/amenities/transit_stops_statewide_co.geojson');
const status = readJson('data/policy/thiz-map-status.json');

let passed = 0;
const pending = [];
function test(name, fn) {
  const r = fn();
  const done = () => { passed++; console.log('  ✓ ' + name); };
  if (r && typeof r.then === 'function') pending.push(r.then(done)); else done();
}

console.log('\ntransit-zone-map');

test('built from the committed stop file at the status file radius', () => {
  assert.equal(map.meta.radius_miles, status.zone_radius_miles);
  assert.equal(map.meta.stops_generated, stops.meta.generated,
    'stop file was rebuilt; run python3 scripts/market/build_transit_zone_map.py');
  const seen = new Set();
  for (const f of stops.features) {
    if (!TZ.countsAsConfirmedStop(f.properties)) continue;
    const [lon, lat] = f.geometry.coordinates;
    seen.add([lon.toFixed(4), lat.toFixed(4), f.properties.agency || 'Agency not listed'].join('|'));
  }
  assert.equal(map.stops.length, seen.size, 'counted stops differ from the stop file');
  assert.equal(map.meta.stop_count, map.stops.length);
});

function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > lat) !== (yj > lat)) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inZone(lon, lat) {
  return map.zone.coordinates.some((poly) => inRing(lon, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lon, lat, h)));
}
function miles(lat1, lon1, lat2, lon2) {
  const r = (d) => d * Math.PI / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

test('every counted stop is inside the merged zone', () => {
  const outside = map.stops.filter(([lon, lat]) => !inZone(lon, lat));
  assert.equal(outside.length, 0, `${outside.length} stops outside the zone, e.g. ${JSON.stringify(outside[0])}`);
});

test('zone edge sits at the radius: every vertex is 2 mi (±3%) from its nearest stop', () => {
  const r = map.meta.radius_miles;
  let worst = 0, n = 0;
  map.zone.coordinates.forEach((poly) => poly[0].forEach(([lon, lat], i) => {
    if (i % 7) return;   // a sample keeps this fast; ~5k vertices
    let best = Infinity;
    for (const [slon, slat] of map.stops) {
      if (Math.abs(slat - lat) > 0.06 || Math.abs(slon - lon) > 0.08) continue;
      const d = miles(lat, lon, slat, slon);
      if (d < best) best = d;
    }
    worst = Math.max(worst, Math.abs(best - r) / r);
    n++;
  }));
  assert.ok(n > 500, `only ${n} vertices sampled`);
  assert.ok(worst < 0.03, `a zone vertex is ${(worst * 100).toFixed(1)}% off the radius`);
});

test('statute quote states the radius the screen uses; no frequency test is claimed', () => {
  const st = status.statute_text;
  const words = { 1: 'one', 2: 'two', 3: 'three' };
  assert.match(st.zone.quote, new RegExp('within ' + words[status.zone_radius_miles] + ' miles of a transportation facility'));
  assert.equal(st.facility.quote, 'a transit station or passenger rail station');
  assert.equal(st.frequency_test, null);
  assert.match(st.source_url, /^https:\/\/leg\.colorado\.gov\//);
  assert.match(st.checked, /^\d{4}-\d{2}-\d{2}$/);
});

test('every view with the panel loads the map script and Leaflet', () => {
  const pages = ['housing-needs-assessment.html'].concat(fs.readdirSync(root).filter((f) => /^hna-.*\.html$/.test(f)));
  let withPanel = 0;
  for (const p of pages) {
    const html = read(p);
    if (!html.includes('id="hnaTransitZonePanel"')) continue;
    withPanel++;
    for (const src of ['js/transit-zone-map.js', 'js/vendor/leaflet.js', 'js/vendor/leaflet.css', 'js/config/basemaps.js']) {
      assert.ok(html.includes('"' + src + '"'), `${p} has the transit zone panel but does not load ${src}`);
    }
  }
  assert.ok(withPanel >= 2, 'expected the canonical page and at least one view to carry the panel');
  assert.match(read('js/hna/hna-renderers.js'), /TransitZoneMap\.render\(/);
});

test('no Leaflet: "Map unavailable" with the reason', () => {
  const dom = new JSDOM('<div id="m"></div>');
  global.window = dom.window; global.document = dom.window.document;
  delete require.cache[require.resolve('../js/transit-zone-map.js')];
  const TZM = require('../js/transit-zone-map.js');
  const el = dom.window.document.getElementById('m');
  return TZM.render(el, { geoid: '08031', name: 'Denver', mapStatus: status }).then((r) => {
    assert.equal(r, 'unavailable');
    assert.equal(el.getAttribute('data-tzm-state'), 'unavailable');
    assert.match(el.textContent, /Map unavailable\. The mapping library did not load\./);
  });
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed`);
}).catch((e) => { console.error('  ✗ ' + e.message); process.exit(1); });
