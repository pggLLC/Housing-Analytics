// Drive times between nearby Colorado tracts (data/market/tract_drive_times_co.json), built offline by
// scripts/market/build_tract_drive_times.py from OpenStreetMap through OSRM. The Market check reads it to leave out a
// tract that is near on the map but a long drive (a mesa, a range, a long way round). Checks: provenance and the ODbL
// notice; every tract, in the centroid file's order, with a routing point; minutes are positive and plausible; the
// second pass ran; a real barrier stays long and an ordinary town pair stays short.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const doc = readJson('data/market/tract_drive_times_co.json');
const centroids = readJson('data/market/tract_centroids_co.json');
const freshness = fs.readFileSync(path.join(ROOT, 'scripts', 'audit', 'benchmark-freshness-check.mjs'), 'utf8');

const m = doc.meta;
assert.equal(m.generated_by, 'scripts/market/build_tract_drive_times.py');
assert.equal(m.router.engine, 'OSRM Table API');
assert.equal(m.router.profile, 'driving');
assert.match(m.odbl_notice, /Open Database License/);
assert.equal(m.osm_copyright_url, 'https://www.openstreetmap.org/copyright');
assert.match(m.points_source_url, /^https:\/\/www2\.census\.gov\/geo\/docs\/reference\/cenpop2020\//);
assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(m.as_of) && /^\d{4}-\d{2}-\d{2}$/.test(m.review_by), 'as_of and review_by are dates');
assert.ok(m.recheck && m.recheck.pairs_rechecked > 0, 'the second pass on long pairs ran');
assert.ok(Array.isArray(m.limitations) && m.limitations.length >= 3, 'limitations are stated');
assert.match(freshness, /data\/market\/tract_drive_times_co\.json/, 'freshness check watches the file');

const geoids = centroids.tracts.map(t => t.geoid).sort();
assert.deepEqual(doc.tracts, geoids, 'every tract, in GEOID order');
assert.equal(doc.points.length, doc.tracts.length, 'a routing point per tract');
doc.points.forEach(([lat, lon], i) => assert.ok(lat > 36.9 && lat < 41.1 && lon > -109.1 && lon < -102, 'point inside Colorado: ' + doc.tracts[i]));

const miles = (a, b) => {
  const r = Math.PI / 180, h = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.sqrt(h));
};
let pairs = 0;
Object.entries(doc.from).forEach(([g, row]) => {
  const i = doc.tracts.indexOf(g);
  assert.ok(i >= 0, 'source tract listed: ' + g);
  row.forEach(([j, min]) => {
    pairs++;
    assert.ok(j !== i && j >= 0 && j < doc.tracts.length, 'destination index valid');
    assert.ok(min > 0 && min < 240, 'minutes plausible: ' + g + ' to ' + doc.tracts[j] + ' ' + min);
    assert.ok(miles(doc.points[i], doc.points[j]) <= m.radius_miles + 0.01, 'pair inside the radius');
  });
});
assert.equal(pairs, m.pair_count, 'pair count matches meta');

const drive = (a, b) => { const j = doc.tracts.indexOf(b); const h = (doc.from[a] || []).find(r => r[0] === j); return h ? h[1] : null; };
// Up on the mesa south-west of Grand Junction (Mesa County tract 19) to Grand Junction tract 13.02: a few miles on the
// map, over an hour by road.
assert.ok(drive('08077001900', '08077001302') > 45, 'mesa to Grand Junction stays a long drive');
// Two Grand Junction tracts next to each other: a short drive.
assert.ok(drive('08077001302', '08077001304') < 15, 'neighbouring Grand Junction tracts are a short drive');

console.log('tract drive times: PASS (' + pairs + ' pairs)');
