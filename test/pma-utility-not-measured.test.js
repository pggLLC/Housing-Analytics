'use strict';
/**
 * Utility capacity must not be scored until a real source exists.
 *
 * utility_capacity_co.geojson holds town boundaries (as circles sized from
 * their area) and DWR water-rights districts with no geometry. The old
 * heuristic turned "inside a town circle" into 0.5 water / 0.6 sewer, so every
 * in-town site got the same 55/100 utility score, an "adequate" flag and an
 * 80/100 report row, all from no capacity data.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const PI = require(path.join(__dirname, '..', 'js', 'pma-infrastructure.js'));

const ds = fs.readFileSync(path.join(__dirname, '..', 'js', 'data-service-portable.js'), 'utf8');
assert(!/waterDistricts > 0 \? 0\.7/.test(ds), 'the in-town 0.7/0.5 water heuristic is gone');
assert(!/municipalAreas > 0 \? 0\.6/.test(ds), 'the in-town 0.6 sewer heuristic is gone');
assert(/_dataSource: 'utility-not-measured'/.test(ds), 'a matched town is reported as not measured');

const pi = fs.readFileSync(path.join(__dirname, '..', 'js', 'pma-infrastructure.js'), 'utf8');
assert(!/sewerHeadroom: 0\.5, waterCapacity: 0\.5/.test(pi), 'no neutral 0.5 fallback');

PI.fetchUtilityCapacity({ minLat: 39, minLon: -105, maxLat: 39.1, maxLon: -104.9 }).then((u) => {
  assert.strictEqual(u.sewerHeadroom, null, 'fallback sewer headroom is null');
  assert.strictEqual(u._stub, true, 'fallback is flagged as absent');
  const sc = PI.buildInfrastructureScorecard({ hazardPercent: 0.1 }, {}, u, {});
  assert.strictEqual(sc.utilityScore, null, 'no utility score');
  assert.strictEqual(sc.sewerCapacityAdequate, null, 'no adequate/at-capacity flag');
  assert(/Not measured/.test(sc.utilityUnavailableReason), 'reason carried for display');
  assert(sc._dataAvailability.stubSources.indexOf('utility') !== -1, 'utility counted as absent');
  assert.strictEqual(sc.compositeScore, 90, 'composite uses flood only (90), not a utility guess');
  const r = fs.readFileSync(path.join(__dirname, '..', 'js', 'market-analysis', 'market-report-renderers.js'), 'utf8');
  assert(/j\.utilityUnavailableReason/.test(r), 'report row shows the not-measured reason');
  console.log('pma-utility-not-measured: PASS');
}).catch((e) => { console.error(e); process.exit(1); });
