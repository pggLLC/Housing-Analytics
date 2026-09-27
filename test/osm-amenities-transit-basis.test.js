/**
 * test/osm-amenities-transit-basis.test.js
 *
 * The OpenStreetMap-only transit fallback is decided per ANALYZED SITE by
 * OsmAmenities (Codex on #1991). It used to be decided by the builder around
 * preselected place centroids, which failed two ways:
 *   - near Trinidad (37.15050, -104.51144) a confirmed stop and the
 *     OpenStreetMap-only "Trinidad Bus Station" are both within 2 miles, and
 *     the nearer, unconfirmed one won;
 *   - a site far from every preselected centroid never got a fallback at all.
 *
 * Rule: the nearest confirmed stop when one is within the scoring radius;
 * otherwise the nearest OpenStreetMap-only stop, flagged; otherwise the site
 * scores as it always did (nearest confirmed stop, out of range, score 0 on a
 * real distance; no stop data at all stays distanceMiles null).
 *
 * The last block runs the rule over the committed neighborhood_access.json at
 * every place centroid and checks it agrees with the builder's own
 * meta.transit.places_by_basis, which scripts/lib/transit_stops.py computes.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js/data-connectors/osm-amenities.js'), 'utf8');

function connector() {
  const sandbox = { window: {}, console: { log() {}, warn() {} } };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.OsmAmenities;
}

// Offsets north of a site, in miles (1 degree of latitude ~ 69.05 mi).
const SITE = { lat: 37.15050, lon: -104.51144 };
const north = (miles) => SITE.lat + miles / 69.05;

// ── 1. Confirmed in range beats a nearer unconfirmed stop ─────────────────
{
  const A = connector();
  A.loadAmenities([
    { type: 'transit_stop', name: 'Bus Station (OSM only)', lat: north(0.3), lon: SITE.lon,
      transit_stop_basis: 'openstreetmap_unconfirmed' },
    { type: 'transit_stop', name: 'Outrider stop', lat: north(1.2), lon: SITE.lon, transit_stop_basis: 'confirmed' }
  ]);
  const t = A.getAccessScore(SITE.lat, SITE.lon).transit;
  assert.strictEqual(t.name, 'Outrider stop', 'a nearer unconfirmed stop outranked a confirmed stop in range');
  assert.strictEqual(t.transitStopBasis, 'confirmed');
  assert.strictEqual(t.confirmed, true);
  assert.strictEqual(t.transitStopBasisReason, null);
  assert.strictEqual(t.score, 25, 'scored on the confirmed stop at ~1.2 mi');
  assert.strictEqual(A.getNearestByType(SITE.lat, SITE.lon, 'transit_stop').name, 'Outrider stop',
    'getNearestByType must apply the same per-site rule');
  const bus = A.getAccessScore(SITE.lat, SITE.lon).transit_bus;
  assert.strictEqual(bus.name, 'Outrider stop', 'the bus distance came from the unconfirmed stop');
  // Nothing is hidden from a radius search; each hit says what it is.
  const hits = A.getWithinRadius(SITE.lat, SITE.lon, 'transit_stop', 2);
  assert.deepStrictEqual(Array.from(hits, (h) => h.transitStopBasis), ['openstreetmap_unconfirmed', 'confirmed']);
}

// ── 2. Only an unconfirmed stop in range: use it, flagged ─────────────────
{
  const A = connector();
  A.loadAmenities([
    { type: 'transit_stop', name: 'Town Hall (OSM only)', lat: north(0.4), lon: SITE.lon,
      transit_stop_basis: 'openstreetmap_unconfirmed' },
    { type: 'transit_stop', name: 'Far confirmed', lat: north(6), lon: SITE.lon, transit_stop_basis: 'confirmed' }
  ]);
  const t = A.getAccessScore(SITE.lat, SITE.lon).transit;
  assert.strictEqual(t.name, 'Town Hall (OSM only)');
  assert.strictEqual(t.score, 75);
  assert.strictEqual(t.transitStopBasis, 'openstreetmap_unconfirmed');
  assert.strictEqual(t.confirmed, false);
  assert.match(t.transitStopBasisReason, /OpenStreetMap/, 'an unconfirmed basis must carry its reason');
}

// ── 3. Neither in range: scores as before ─────────────────────────────────
{
  const A = connector();
  A.loadAmenities([
    { type: 'transit_stop', name: 'Far OSM', lat: north(3), lon: SITE.lon, transit_stop_basis: 'openstreetmap_unconfirmed' },
    { type: 'transit_stop', name: 'Far confirmed', lat: north(6), lon: SITE.lon, transit_stop_basis: 'confirmed' },
    { type: 'grocery', name: 'Shop', lat: north(0.1), lon: SITE.lon }
  ]);
  const t = A.getAccessScore(SITE.lat, SITE.lon).transit;
  assert.strictEqual(t.name, 'Far confirmed', 'out of range, the nearest confirmed stop is reported, as before');
  assert.strictEqual(t.score, 0);
  assert.ok(t.distanceMiles > 5.9 && t.distanceMiles < 6.1, `a real distance, not a placeholder: ${t.distanceMiles}`);
  assert.strictEqual(t.transitStopBasis, 'none');
  assert.strictEqual(t.confirmed, null, 'no stop in range is neither confirmed nor unconfirmed');
  assert.match(t.transitStopBasisReason, /No transit stop/);

  // No transit records at all: unchanged absence (distance null, not 0 miles).
  const B = connector();
  B.loadAmenities([{ type: 'grocery', name: 'Shop', lat: north(0.1), lon: SITE.lon }]);
  const none = B.getAccessScore(SITE.lat, SITE.lon).transit;
  assert.strictEqual(none.distanceMiles, null, 'no transit data must not become a distance');
  assert.strictEqual(none.name, '');
}

// ── 4. A record with no basis (seed fallback) counts as confirmed ─────────
{
  const A = connector();
  A.loadAmenities([
    { type: 'transit_stop', name: 'Seed', lat: north(1.5), lon: SITE.lon },
    { type: 'transit_stop', name: 'OSM', lat: north(0.1), lon: SITE.lon, transit_stop_basis: 'openstreetmap_unconfirmed' }
  ]);
  assert.strictEqual(A.getAccessScore(SITE.lat, SITE.lon).transit.name, 'Seed');
}

// ── 5. The committed file, at every place centroid ─────────────────────────
// Non-vacuity is on the scan: both bases must actually occur.
{
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/derived/market-analysis/neighborhood_access.json'), 'utf8'));
  const centroids = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/co-place-centroids.json'), 'utf8')).byGeoid;
  const A = connector();
  A.loadAmenities(doc.amenities);
  const counts = { confirmed: 0, openstreetmap_unconfirmed: 0, none: 0 };
  const fallback = [];
  for (const [geoid, c] of Object.entries(centroids)) {
    if (typeof c.lat !== 'number' || typeof c.lng !== 'number') continue;
    const t = A.getNearestByType(c.lat, c.lng, 'transit_stop');
    counts[t.transitStopBasis]++;
    if (t.transitStopBasis === 'openstreetmap_unconfirmed') fallback.push(String(geoid).padStart(7, '0'));
  }
  assert.ok(counts.confirmed > 0 && counts.openstreetmap_unconfirmed > 0,
    `the scan did not exercise both bases: ${JSON.stringify(counts)}`);
  assert.deepStrictEqual(counts, doc.meta.transit.places_by_basis,
    'the connector and scripts/lib/transit_stops.py disagree on which basis a place centroid gets');
  assert.deepStrictEqual(fallback.sort(), doc.meta.transit.fallback_places.map((p) => p.geoid).sort());
  // The two places the old centroid rule withheld now resolve per site.
  for (const g of ['0851975', '0878345']) {
    const c = centroids[g];
    const t = A.getAccessScore(c.lat, c.lng).transit;
    assert.strictEqual(t.transitStopBasis, 'openstreetmap_unconfirmed', `${g} did not get its fallback`);
    assert.ok(t.score > 0, `${g} scored ${t.score}`);
  }
  // The Trinidad site from the review: a confirmed stop is in range, so it wins.
  const trinidad = A.getAccessScore(SITE.lat, SITE.lon).transit;
  assert.strictEqual(trinidad.transitStopBasis, 'confirmed', JSON.stringify(trinidad));
  assert.notStrictEqual(trinidad.name, 'Trinidad Bus Station');
  console.log(`osm-amenities-transit-basis: place centroids ${JSON.stringify(counts)}; Trinidad site -> ${trinidad.name} (${trinidad.distanceMiles} mi) — OK`);
}
