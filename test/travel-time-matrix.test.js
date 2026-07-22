const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

const doc = readJson('data/market/travel_time_matrix_co.json');
const centroids = readJson('data/market/tract_centroids_co.json');
const builder = fs.readFileSync(path.join(ROOT, 'scripts', 'market', 'build_travel_time_matrix.py'), 'utf8');
const freshnessSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'audit', 'benchmark-freshness-check.mjs'), 'utf8');
const scoringSource = fs.readFileSync(path.join(ROOT, 'js', 'market-analysis-scoring.js'), 'utf8');
const pmaSource = fs.readFileSync(path.join(ROOT, 'js', 'market-analysis.js'), 'utf8');
const commuteShapedSource = fs.readFileSync(path.join(ROOT, 'js', 'pma-commute-shaped.js'), 'utf8');

assert(doc.meta, 'artifact exposes meta');
assert.equal(doc.meta.source, 'OpenStreetMap-derived Colorado tract-to-regional-hub travel-time matrix');
assert.equal(doc.meta.context_only, true, 'meta marks artifact context-only');
assert.equal(doc.meta.not_scoring_input, true, 'meta marks artifact as not scoring input');
assert.equal(doc.meta.generated_by, 'scripts/market/build_travel_time_matrix.py');
assert.equal(doc.meta.tract_centroids_file, 'data/market/tract_centroids_co.json');
assert.equal(doc.meta.router.engine, 'OSRM Table API');
assert.equal(doc.meta.router.profile, 'driving');
assert.equal(doc.meta.router.quarterly_refresh_ready, true);
assert.equal(doc.meta.osm_extract_source_url, 'https://download.geofabrik.de/north-america/us/colorado.html');
assert.equal(doc.meta.osm_copyright_url, 'https://www.openstreetmap.org/copyright');
assert.match(doc.meta.odbl_notice, /Open Database License/, 'ODbL notice is present');
assert.match(doc.meta.as_of, /^\d{4}-\d{2}-\d{2}$/, 'as_of is ISO');
assert.match(doc.meta.last_verified, /^\d{4}-\d{2}-\d{2}$/, 'last_verified is ISO');
assert.match(doc.meta.review_by, /^\d{4}-\d{2}-\d{2}$/, 'review_by is ISO');
assert(doc.meta.methodology.includes('OSRM Table API'), 'methodology names the router API');
assert(doc.meta.limitations.some((line) => /not formal market-area definitions/i.test(line)), 'hub limitation is pinned');
assert(doc.meta.limitations.some((line) => /No PMA score, tract selection, buffer, or underwriting calculation consumes this artifact/i.test(line)), 'runtime boundary limitation is pinned');

const tracts = Object.values(doc.tracts || {});
const hubs = Object.values(doc.hubs || {});
const centroidCount = (centroids.tracts || []).length;

assert.equal(tracts.length, centroidCount, 'travel matrix covers every committed tract centroid');
assert.equal(doc.meta.tract_count, tracts.length, 'tract_count matches rows');
assert.equal(hubs.length, 15, 'regional hub inventory is non-vacuous');
assert.equal(doc.meta.hub_count, hubs.length, 'hub_count matches hubs');
assert.equal(doc.meta.expected_pair_count, tracts.length * hubs.length, 'expected pair count matches matrix dimensions');
assert.equal(doc.meta.routed_pair_count, doc.meta.expected_pair_count, 'all tract/hub pairs have routed OSRM values');
assert.equal(doc.meta.null_pair_count, 0, 'no routed pairs are null in the committed artifact');
assert(doc.meta.max_drive_minutes > 300, 'statewide long-drive guard is non-vacuous');
assert(doc.meta.max_distance_miles > 250, 'statewide long-distance guard is non-vacuous');

for (const hub of hubs) {
  assert.match(hub.id, /^[a-z0-9_]+$/, `${hub.id} has stable id`);
  assert(Number.isFinite(hub.lat), `${hub.id} has lat`);
  assert(Number.isFinite(hub.lon), `${hub.id} has lon`);
}

for (const row of tracts) {
  assert.match(row.geoid, /^08\d{9}$/, `${row.geoid} is a Colorado tract GEOID`);
  assert.equal(row.context_only, true, `${row.geoid} is context-only`);
  assert.equal(row.not_scoring_input, true, `${row.geoid} is not a scoring input`);
  assert(row.nearest_hub && doc.hubs[row.nearest_hub.hub_id], `${row.geoid} has a known nearest hub`);
  assert(Object.keys(row.hubs || {}).length === hubs.length, `${row.geoid} has every hub route`);
  for (const [hubId, route] of Object.entries(row.hubs || {})) {
    assert(doc.hubs[hubId], `${row.geoid} hub ${hubId} is registered`);
    assert.equal(route.status, 'routed', `${row.geoid}/${hubId} is routed`);
    assert(route.drive_minutes > 0, `${row.geoid}/${hubId} drive minutes are positive`);
    assert(route.distance_miles > 0, `${row.geoid}/${hubId} distance miles are positive`);
    assert(route.distance_miles >= route.straight_line_miles * 0.65, `${row.geoid}/${hubId} route distance is plausible after OSRM road snapping`);
  }
  // Denormalized nearest_hub must agree with the per-hub matrix — the
  // fixture assertions read nearest_hub, so drift between the two would
  // otherwise go undetected.
  const routedHubs = Object.entries(row.hubs || {}).filter(([, r]) => r.status === 'routed' && Number.isFinite(r.drive_minutes));
  const [argminId, argminRoute] = routedHubs.reduce((best, cur) => (cur[1].drive_minutes < best[1].drive_minutes ? cur : best));
  assert.equal(row.nearest_hub.hub_id, argminId, `${row.geoid} nearest_hub matches the hub matrix argmin`);
  assert(Math.abs(row.nearest_hub.drive_minutes - argminRoute.drive_minutes) <= 0.05, `${row.geoid} nearest_hub minutes match the hub matrix`);
}

const denver = doc.tracts['08031004102'];
assert(denver, 'Denver tract fixture exists');
assert.equal(denver.nearest_hub.hub_id, 'denver', 'Denver fixture nearest hub is Denver');
assert(denver.nearest_hub.drive_minutes < 30, 'Denver fixture has plausible local drive time');

const mesa = doc.tracts['08077000900'];
assert(mesa, 'Mesa County tract fixture exists');
assert.equal(mesa.nearest_hub.hub_id, 'grand_junction', 'Mesa fixture nearest hub is Grand Junction');
assert(mesa.hubs.denver.drive_minutes > 200, 'Mesa fixture has long drive time to Denver');

const garfield = doc.tracts['08045951702'];
assert(garfield, 'Garfield County tract fixture exists');
assert.equal(garfield.nearest_hub.hub_id, 'glenwood_springs', 'Garfield fixture nearest hub is Glenwood Springs');
assert(garfield.hubs.denver.drive_minutes > 150, 'Garfield fixture has mountain-corridor drive time to Denver');

assert(builder.includes('TRAVEL_TIME_MATRIX_ROUTER_URL'), 'builder supports CI/local router endpoint override');
assert(builder.includes('DEFAULT_OSRM_TABLE_URL'), 'builder has explicit OSRM table default');
assert(!JSON.stringify(doc).toLowerCase().includes('google'), 'artifact does not contain Google Distance Matrix provenance');
assert(freshnessSrc.includes('data/market/travel_time_matrix_co.json'), 'benchmark freshness audit includes travel-time matrix');

assert(!scoringSource.includes('travel_time_matrix_co.json'), 'travel-time matrix is not wired into scoring');
assert(!pmaSource.includes('travel_time_matrix_co.json'), 'travel-time matrix is not fetched by default PMA runtime');
assert(commuteShapedSource.includes('data/market/travel_time_matrix_co.json'), 'D-F2 commute-shaped module is the intentional travel-time consumer');
assert(commuteShapedSource.includes('same') || commuteShapedSource.includes('nearestHub'), 'travel-time consumer uses hub/basin gating');

console.log(`travel-time-matrix: PASS (${tracts.length} tracts x ${hubs.length} hubs, ${doc.meta.routed_pair_count} routed pairs)`);
