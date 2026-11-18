// The reasons Market check gives for each tract in a market area (paul approved 18 Nov 2026: "only justification for
// the [tract] method, to capture the right [tracts] for CHFA"). Three files, built offline:
//   data/market/tract_drive_bands_co.json      share of each tract's 2020 people within 10, 15, 20 minutes by road
//   data/market/tract_school_districts_co.json each tract's 2020 people by public school district
//   data/market/acs_tract_movers_co.json       renters who moved in from another county, state or abroad (ACS B07013)
// Checks: provenance and dates; every tract in the centroid file; shares are whole percents that rise with the band;
// each tract reaches its own people; town origins are listed; school shares sum to about 100; Bayfield's tracts sit in
// Bayfield's district; mover counts are whole people and no larger than the renters; the freshness check watches all
// three.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const readJson = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const centroids = readJson('data/market/tract_centroids_co.json');
const geoids = centroids.tracts.map(t => String(t.geoid)).sort();
const freshness = fs.readFileSync(path.join(ROOT, 'scripts', 'audit', 'benchmark-freshness-check.mjs'), 'utf8');
const dated = m => /^\d{4}-\d{2}-\d{2}$/.test(m.as_of) && /^\d{4}-\d{2}-\d{2}$/.test(m.review_by);

// ---- people by road ----
const bands = readJson('data/market/tract_drive_bands_co.json');
const bm = bands.meta;
assert.equal(bm.generated_by, 'scripts/market/build_tract_drive_bands.py');
assert.equal(bm.router.engine, 'OSRM Table API');
assert.match(bm.odbl_notice, /Open Database License/);
assert.deepEqual(bm.bands_minutes, [10, 15, 20]);
assert.ok(dated(bm), 'bands: as_of and review_by are dates');
assert.ok(Array.isArray(bm.limitations) && bm.limitations.length >= 3, 'bands: limitations are stated');
assert.deepEqual(bands.tracts, geoids, 'bands: every tract, in GEOID order');
assert.equal(bands.pop.length, bands.tracts.length);
assert.equal(bands.points.length, bands.tracts.length);
assert.ok(bands.places.length >= 400 && bands.places.every(p => /^08\d{5}$/.test(p[0]) && p[2] > 36.9 && p[2] < 41.1), 'bands: town origins listed');
assert.equal(bands.pop.reduce((s, x) => s + x, 0), bm.population, 'bands: population adds up');
let pairs = 0;
Object.entries(bands.from).forEach(([o, rows]) => {
  assert.ok(bands.tracts.includes(o) || bands.places.some(p => p[0] === o), 'bands: origin listed: ' + o);
  rows.forEach(r => {
    pairs++;
    assert.equal(r.length, 4);
    assert.ok(r[0] >= 0 && r[0] < bands.tracts.length, 'bands: index valid');
    assert.ok(r[1] <= r[2] && r[2] <= r[3] && r[3] <= 100 && r[3] > 0 && r.every(Number.isInteger), 'bands: shares rise with the band: ' + o + ' ' + r);
  });
});
assert.equal(pairs, bm.pair_count, 'bands: pair count matches meta');
// A populated tract reaches most of its own people within 20 minutes of its own population centre, outside the
// largest rural tracts.
const own = bands.tracts.filter((g, i) => bands.pop[i] > 0).map(g => { const r = (bands.from[g] || []).find(x => bands.tracts[x[0]] === g); return r ? r[3] : 0; });
assert.ok(own.filter(x => x >= 50).length / own.length > 0.9, 'bands: most tracts reach most of their own people');
// Bayfield's own town point reaches most of the town's tract, and only a few of Vallecito's people.
const bay = bands.places.find(p => /^Bayfield town$/.test(p[1]));
assert.ok(bay, 'bands: Bayfield is a town origin');
const share = (o, g) => { const r = (bands.from[o] || []).find(x => bands.tracts[x[0]] === g); return r ? r[3] : 0; };
assert.ok(share(bay[0], '08067970602') >= 50, 'bands: Bayfield reaches its own tract');
assert.ok(share(bay[0], '08067970706') < 25, 'bands: Vallecito is mostly beyond 20 minutes of Bayfield');
assert.match(freshness, /data\/market\/tract_drive_bands_co\.json/, 'freshness check watches the bands file');

// ---- school districts ----
const sch = readJson('data/market/tract_school_districts_co.json');
assert.equal(sch.meta.generated_by, 'scripts/market/build_tract_school_districts.py');
assert.ok(dated(sch.meta), 'schools: dates');
assert.ok(sch.districts.length >= 170 && sch.districts.every(d => /^08\d{5}$/.test(d[0]) && d[1]), 'schools: districts listed');
assert.equal(sch.meta.population_not_in_a_district, 0, 'schools: every person placed');
Object.entries(sch.tracts).forEach(([g, rows]) => {
  assert.ok(geoids.includes(g), 'schools: tract listed: ' + g);
  const t = rows.reduce((s, r) => s + r[1], 0);
  assert.ok(t >= 97 && t <= 102, 'schools: shares add to about 100 for ' + g + ': ' + t);
  rows.forEach(r => assert.ok(r[0] >= 0 && r[0] < sch.districts.length));
});
const bayDist = sch.districts.findIndex(d => /Bayfield/.test(d[1]));
assert.ok(bayDist >= 0 && sch.tracts['08067970602'][0][0] === bayDist, 'schools: Bayfield’s tract is mostly Bayfield School District');
assert.match(freshness, /data\/market\/tract_school_districts_co\.json/, 'freshness check watches the schools file');

// ---- movers ----
const mv = readJson('data/market/acs_tract_movers_co.json');
assert.equal(mv.meta.generated_by, 'scripts/market/build_acs_tract_movers.py');
assert.ok(dated(mv.meta), 'movers: dates');
assert.match(mv.meta.source, /B07013/);
assert.match(mv.meta.use, /never added to a capture rate/);
assert.ok(Object.keys(mv.tracts).length >= 1400, 'movers: tracts');
Object.entries(mv.tracts).forEach(([g, r]) => {
  assert.equal(r.length, 6);
  if (r[0] == null) return;
  const out = (r[2] || 0) + (r[3] || 0) + (r[4] || 0);
  assert.ok(r.slice(0, 5).every(x => x == null || Number.isInteger(x)) && out + (r[1] || 0) <= r[0], 'movers: counts fit inside the renters for ' + g);
});
assert.match(freshness, /data\/market\/acs_tract_movers_co\.json/, 'freshness check watches the movers file');

console.log('tract market reasons: PASS (' + pairs + ' drive pairs, ' + sch.districts.length + ' districts, ' + Object.keys(mv.tracts).length + ' mover tracts)');
