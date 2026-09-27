'use strict';
/**
 * test/pma-transit-stops.test.js
 *
 * The site-selection (PMA) transit score is computed from CONFIRMED TRANSIT
 * STOPS, not route geometry, at exactly the two HB26-1065 distances in
 * data/policy/thiz-map-status.json — the CHFA QAP transit-oriented distance
 * (qap_tod_distance.miles) and the zone screening radius (zone_radius_miles)
 * — read at runtime, never hardcoded (owner decisions 2026-09-27).
 *
 *   1. Selection agrees with scripts/lib/transit_stops.py — the JS rule
 *      (TransitZone.countsAsConfirmedStop, used by PMATransit) is run over the
 *      committed stop file and compared, stop for stop, with the Python rule's
 *      own selection of the same file.
 *   2. The distances are the status file's: tier edges move when the file's
 *      values move, a stop just past the zone radius never counts whatever
 *      the radius, and a status file without either value gives null.
 *   3. The metric: a confirmed stop wins over nearer unconfirmed, private and
 *      demand-response stops; tier counts; a load failure is null + reason;
 *      no stop within the zone radius is a measured 0, labelled as one.
 *   4. scoreAccess and the narrative keep those cases apart.
 *   5. The PMA scoring path does not load the route-line file: the runner is
 *      run end to end against a recording fetch, and the scoring files are
 *      scanned for the file name.
 *   6. The displayed site-selection score waits for the stop-based score in
 *      both the circular-buffer and the enhanced-runner flows.
 *
 * Run: node test/pma-transit-stops.test.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const STOPS_PATH = 'data/amenities/transit_stops_statewide_co.geojson';
const STATUS_PATH = 'data/policy/thiz-map-status.json';
const ROUTES_FILE = 'transit_routes_co.geojson';
const MAP_STATUS = JSON.parse(read(STATUS_PATH));
const TOD_MI = MAP_STATUS.qap_tod_distance && MAP_STATUS.qap_tod_distance.miles;
const ZONE_MI = MAP_STATUS.zone_radius_miles;

let passed = 0;
let failed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

// A browser-like context holding the real modules the PMA page loads.
function pageContext({ fetchJSON, modules = ['js/transit-zone.js', 'js/pma-transit.js'] } = {}) {
  const win = { console: { log() {}, warn() {}, error() {}, info() {} }, APP_CONFIG: {} };
  if (fetchJSON) win.safeFetchJSON = fetchJSON;
  win.window = win;
  const ctx = vm.createContext(win);
  for (const m of modules) vm.runInContext(read(m), ctx, { filename: m });
  return win;
}
const plain = (v) => JSON.parse(JSON.stringify(v));   // out of the vm realm, for deepEqual

const EARTH_MI = 3958.8;
// A point `miles` due north of a site (inverse of the haversine along a meridian).
const north = (site, miles) => ({ lat: site.lat + (miles / EARTH_MI) * 180 / Math.PI, lon: site.lon });
function feature(pt, props) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [pt.lon, pt.lat] },
    properties: Object.assign({ name: 'Stop', agency: 'Test Transit', operator: 'public', sources: ['cdot'],
      reliability: 'confirmed', service: 'fixed_route' }, props) };
}
const fc = (features) => ({ type: 'FeatureCollection', meta: { generated: '2026-09-27T00:00:00Z' }, features });
const withDistances = (tod, zone) => Object.assign({}, MAP_STATUS, { zone_radius_miles: zone,
  qap_tod_distance: Object.assign({}, MAP_STATUS.qap_tod_distance, { miles: tod }) });

const SITE = { lat: 39.7392, lon: -104.9903 };

// ── 1. Selection agrees with the Python rule ───────────────────────────────
test('JS stop selection matches scripts/lib/transit_stops.py on the committed stop file', () => {
  const stops = JSON.parse(read(STOPS_PATH));
  const win = pageContext();
  const TZ = win.TransitZone;
  const P = win.PMATransit;
  // Non-vacuity: the file holds every class the rule excludes, or the
  // comparison would not be exercising the exclusions.
  const props = stops.features.map((f) => f.properties);
  assert.ok(props.some((p) => p.operator === 'private_shuttle'), 'no private shuttle stop in the file to exclude');
  assert.ok(props.some((p) => p.service === 'demand_response'), 'no demand-response stop in the file to exclude');
  assert.ok(props.some((p) => p.reliability === 'unconfirmed'), 'no unconfirmed stop in the file to exclude');

  const key = (lat, lon) => lat.toFixed(6) + ',' + lon.toFixed(6);
  const viaHelper = stops.features.filter((f) => TZ.countsAsConfirmedStop(f.properties))
    .map((f) => key(f.geometry.coordinates[1], f.geometry.coordinates[0])).sort();
  const viaPma = Array.from(P.selectCountedStops(stops).stops, (s) => key(s.lat, s.lon)).sort();

  const py = 'import importlib.util, json, sys\n' +
    'spec = importlib.util.spec_from_file_location("ts", "scripts/lib/transit_stops.py")\n' +
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n' +
    'got = m.load_stops(sys.argv[1])[m.BASIS_CONFIRMED]\n' +
    'print(json.dumps(["%.6f,%.6f" % (f["geometry"]["coordinates"][1], f["geometry"]["coordinates"][0]) for f in got]))\n';
  const viaPython = JSON.parse(execFileSync('python3', ['-c', py, STOPS_PATH], { cwd: ROOT, encoding: 'utf8',
    env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }) })).sort();

  assert.ok(viaPython.length > 1000, `the Python rule selected only ${viaPython.length} stops — the scan checks almost nothing`);
  assert.ok(viaPython.length < stops.features.length, 'the Python rule excluded nothing');
  assert.equal(viaHelper.length, viaPython.length,
    `TransitZone.countsAsConfirmedStop selects ${viaHelper.length} stops; scripts/lib/transit_stops.py selects ${viaPython.length}`);
  assert.deepEqual(viaHelper, viaPython, 'the JS and Python rules select different stops');
  assert.deepEqual(viaPma, viaPython, 'PMATransit scores a different set of stops from the shared rule');
});

test('the PMA reads the stop file the market-analysis stop layer and the Python rule read', () => {
  const win = pageContext({ modules: ['js/data-service-portable.js'] });
  const ds = read('js/data-service-portable.js');
  const dsPath = (ds.match(/var TRANSIT_STOPS_PATH = '([^']+)'/) || [])[1];
  const statusPath = (ds.match(/var TRANSIT_ZONE_STATUS_PATH = '([^']+)'/) || [])[1];
  const layer = (read('js/market-analysis.js').match(/transitStops:\s*\{\s*src:\s*'([^']+)'/) || [])[1];
  const py = (read('scripts/lib/transit_stops.py').match(/STATEWIDE_STOPS_REL = "([^"]+)"/) || [])[1];
  assert.ok(dsPath && statusPath && layer && py, 'a stop-file or status-file path was not found');
  assert.equal(dsPath, win.DataService.baseData(layer), 'DataService and the stop layer read different files');
  assert.equal(dsPath, py, 'DataService and scripts/lib/transit_stops.py read different files');
  assert.equal(statusPath, STATUS_PATH, 'DataService reads a different zone-map status file');
});

// ── 2. The distances are the status file's ────────────────────────────────
test('the PMA distance tiers are the status file\'s two distances, and move with them', () => {
  const P = pageContext().PMATransit;
  assert.ok(TOD_MI > 0 && ZONE_MI > 0, 'the status file has no TOD distance or zone radius to check against');
  const t = P.distanceTiers(MAP_STATUS);
  assert.deepEqual(plain(t.tiers.map((x) => x.maxMiles)), [TOD_MI, ZONE_MI],
    'the PMA tiers are not qap_tod_distance.miles and zone_radius_miles');
  assert.equal(t.tiers.length, 2, 'the PMA metric uses a distance the status file does not define');
  // Change either value in the file and the tiers change with it.
  for (const [tod, zone] of [[0.25, ZONE_MI], [TOD_MI, 3], [0.75, 1.5], [1, 7]]) {
    assert.deepEqual(plain(P.distanceTiers(withDistances(tod, zone)).tiers.map((x) => x.maxMiles)), [tod, zone]);
  }
});

test('a stop just past the zone radius never counts, and one just inside always does, whatever the radius', () => {
  const P = pageContext().PMATransit;
  let checked = 0;
  for (const zone of [1, ZONE_MI, 3, 5, 7, 12]) {
    const status = withDistances(Math.min(TOD_MI, zone / 2), zone);
    P.calculateTransitScore(SITE.lat, SITE.lon, fc([feature(north(SITE, zone + 0.01), {})]), {}, status);
    const out = P.getTransitJustification();
    assert.equal(out.stopsWithinZoneRadius, 0, `radius ${zone}: a stop at ${zone + 0.01} mi counted (an extra buffer beyond the zone radius)`);
    assert.equal(out.noConfirmedStopWithinZoneRadius, true);
    assert.equal(out.transitAccessibilityScore, 0);
    P.calculateTransitScore(SITE.lat, SITE.lon, fc([feature(north(SITE, zone - 0.01), {})]), {}, status);
    assert.equal(P.getTransitJustification().stopsWithinZoneRadius, 1, `radius ${zone}: a stop at ${zone - 0.01} mi did not count`);
    checked++;
  }
  assert.ok(checked >= 5);
});

test('a status file that did not load, or lacks either distance, gives a null score and a reason', () => {
  const P = pageContext().PMATransit;
  const file = fc([feature(north(SITE, 0.2), {})]);
  const noTod = Object.assign({}, MAP_STATUS); delete noTod.qap_tod_distance;
  const noZone = Object.assign({}, MAP_STATUS); delete noZone.zone_radius_miles;
  const cases = [null, undefined, {}, noTod, noZone, withDistances(0, ZONE_MI), withDistances(TOD_MI, -2),
    { unavailableReason: 'Fixture: status 404.' }];
  for (const status of cases) {
    const score = P.calculateTransitScore(SITE.lat, SITE.lon, file, {}, status);
    const j = P.getTransitJustification();
    assert.equal(score, null, `a score was produced without both distances (${JSON.stringify(status)})`);
    assert.equal(typeof j.transitUnavailableReason, 'string');
    assert.equal(j.nearbyStopCount, null);
    assert.equal(j.noConfirmedStopWithinZoneRadius, null);
  }
  assert.equal(P.getTransitJustification().transitUnavailableReason, 'Fixture: status 404.');
});

// ── 3. The metric ──────────────────────────────────────────────────────────
test('a confirmed stop 0.3 mi away is scored over nearer unconfirmed, private and demand-response stops', () => {
  const P = pageContext().PMATransit;
  assert.ok(TOD_MI >= 0.3, 'fixture assumes the TOD distance reaches 0.3 mi');
  const file = fc([
    feature(north(SITE, 0.1), { name: 'OSM only', reliability: 'unconfirmed', sources: ['osm'] }),
    feature(north(SITE, 0.12), { name: 'Hotel shuttle', operator: 'private_shuttle' }),
    feature(north(SITE, 0.15), { name: 'Flex zone', service: 'demand_response' }),
    feature(north(SITE, 0.3), { name: 'Confirmed', agency: 'RTD' })
  ]);
  const score = P.calculateTransitScore(SITE.lat, SITE.lon, file, {}, MAP_STATUS);
  const j = P.getTransitJustification();
  assert.equal(j.nearestConfirmedStop.name, 'Confirmed');
  assert.equal(j.nearestConfirmedStop.distanceMiles, 0.3);
  assert.equal(j.nearbyStopCount, 1, 'only the confirmed stop counts within the TOD distance');
  assert.equal(j.stopsWithinZoneRadius, 1);
  assert.equal(j.nearbyAgencyCount, 1);
  assert.equal(j._dataSources.coverageScore, 100 / P.STOPS_FOR_FULL_TIER, 'one TOD-tier stop');
  assert.equal(score, Math.round(100 / P.STOPS_FOR_FULL_TIER));
  // Without the confirmed stop, the excluded ones alone are no transit.
  P.calculateTransitScore(SITE.lat, SITE.lon, fc(file.features.slice(0, 3)), {}, MAP_STATUS);
  assert.equal(P.getTransitJustification().stopsWithinZoneRadius, 0);
});

test('tier counts follow the status file\'s two distances, each stop in its tightest tier', () => {
  const P = pageContext().PMATransit;
  // Offsets relative to the file's own distances, so the fixture follows them.
  const miles = [TOD_MI * 0.5, TOD_MI - 0.01, TOD_MI + 0.01, (TOD_MI + ZONE_MI) / 2, ZONE_MI - 0.01, ZONE_MI + 0.01, ZONE_MI * 3];
  P.calculateTransitScore(SITE.lat, SITE.lon, fc(miles.map((m) => feature(north(SITE, m), { name: m.toFixed(2) + ' mi' }))), {}, MAP_STATUS);
  const j = P.getTransitJustification();
  assert.deepEqual(plain(j._dataSources.tierBreakdown), { tod: 2, zone: 3 });
  assert.equal(j.nearbyStopCount, 2);
  assert.equal(j.stopsWithinZoneRadius, 5);
  assert.equal(j.todMiles, TOD_MI);
  assert.equal(j.zoneRadiusMiles, ZONE_MI);
  const n = P.STOPS_FOR_FULL_TIER;
  assert.equal(j._dataSources.coverageScore, Math.round((100 * 2 / n + 50 * 3 / n) * 10) / 10);
  assert.equal(j.nearestConfirmedStop.name, (TOD_MI * 0.5).toFixed(2) + ' mi');
});

test('a stop-file load failure gives a null score and a reason, not 0', async () => {
  const P = pageContext().PMATransit;
  for (const input of [null, undefined, fc([]), { unavailableReason: 'Fixture: the file 404ed.' }]) {
    const score = P.calculateTransitScore(SITE.lat, SITE.lon, input, { transitAccessibility: 80, walkScore: 80, _dataSource: 'epa-live' }, MAP_STATUS);
    const j = P.getTransitJustification();
    assert.equal(score, null, 'a stop file that did not load must not produce a score');
    assert.equal(j.transitAccessibilityScore, null);
    assert.equal(typeof j.transitUnavailableReason, 'string');
    assert.ok(j.transitUnavailableReason.length > 20);
    assert.equal(j.nearbyStopCount, null, 'no stop count is known');
    assert.equal(j.noConfirmedStopWithinZoneRadius, null, 'unknown is not "no stops"');
    assert.equal(j.siteLat, SITE.lat, 'the null is still tagged with its site');
  }
  assert.equal(P.getTransitJustification().transitUnavailableReason, 'Fixture: the file 404ed.');

  // Without the shared rules on the page there is no score either.
  const bare = pageContext({ modules: ['js/pma-transit.js'] }).PMATransit;
  assert.equal(bare.calculateTransitScore(SITE.lat, SITE.lon, fc([feature(north(SITE, 0.2), {})]), {}, MAP_STATUS), null);
  assert.match(bare.getTransitJustification().transitUnavailableReason, /js\/transit-zone\.js/);

  // DataService: a failed load resolves to null + reason, and is retried.
  let calls = 0;
  let fail = true;
  const win = pageContext({ modules: ['js/data-service-portable.js'], fetchJSON: (url) => {
    calls++;
    return fail ? Promise.reject(new Error('HTTP 404 for ' + url)) : Promise.resolve(fc([feature(SITE, {})]));
  } });
  const r1 = await win.DataService.fetchTransitStops();
  assert.equal(r1.geojson, null);
  assert.match(r1.unavailableReason, /could not be loaded/);
  fail = false;
  const r2 = await win.DataService.fetchTransitStops();
  assert.ok(r2.geojson && r2.geojson.features.length === 1, 'a failed load must not be cached');
  const r3 = await win.DataService.fetchTransitStops();
  assert.equal(r3.geojson, r2.geojson, 'a loaded file is shared, not refetched');
  assert.equal(calls, 2, 'one failed fetch and one successful fetch, then the cache');
});

test('no confirmed stop within the zone radius is a measured 0, labelled as such', () => {
  const P = pageContext().PMATransit;
  const file = fc([feature(north(SITE, ZONE_MI + 5), { name: 'Far stop' }),
    feature(north(SITE, 0.2), { name: 'Shuttle', operator: 'private_shuttle' })]);
  const score = P.calculateTransitScore(SITE.lat, SITE.lon, file, {}, MAP_STATUS);
  const j = P.getTransitJustification();
  assert.equal(score, 0);
  assert.equal(j.transitAccessibilityScore, 0);
  assert.equal(j.transitUnavailableReason, null);
  assert.equal(j.noConfirmedStopWithinZoneRadius, true);
  assert.equal(j.nearbyStopCount, 0);
  assert.equal(j.nearestConfirmedStop.name, 'Far stop');
  assert.equal(j.nearestConfirmedStop.distanceMiles, ZONE_MI + 5);
});

test('high-frequency service is unknown (null + reason), because the stop file has no frequency field', () => {
  const stops = JSON.parse(read(STOPS_PATH));
  const keys = new Set(stops.features.flatMap((f) => Object.keys(f.properties || {})));
  const frequencyish = [...keys].filter((k) => /headway|frequen|trips|route_type|mode|route/i.test(k));
  assert.deepEqual(frequencyish, [], `the stop file now carries ${frequencyish.join(', ')} — hasHighFrequencyService can be measured; revisit the null`);
  assert.ok(keys.size >= 5, 'the scan read almost no stop properties');
  const P = pageContext().PMATransit;
  P.calculateTransitScore(SITE.lat, SITE.lon, fc([feature(north(SITE, 0.2), {})]), {}, MAP_STATUS);
  const j = P.getTransitJustification();
  assert.equal(j.hasHighFrequencyService, null);
  assert.match(j.highFrequencyUnavailableReason, /no schedule/);
});

// ── 4. scoreAccess and the narrative keep the cases apart ──────────────────
test('scoreAccess: a null transit score is disclosed, and left out when there is no distance either', () => {
  const win = pageContext({ modules: ['js/market-analysis/site-selection-score.js'] });
  const SSS = win.SiteSelectionScore;
  const reason = 'Fixture: the stop file did not load.';
  const noTransit = { grocery: 0.3, parks: 0.2, healthcare: 0.9, schools: 0.4 };   // every other component full
  const out = SSS.scoreAccess(noTransit, null, { transitAccessibilityScore: null, transitUnavailableReason: reason });
  assert.equal(out.transitSource, 'unavailable');
  assert.equal(out.transitPoints, null);
  assert.equal(out.transitUnavailableReason, reason);
  assert.equal(out.score, 100, 'transit left out and the rest rescaled — not scored as 0 (which would give 75)');

  const withDist = SSS.scoreAccess(Object.assign({ transit: 0.2 }, noTransit), null,
    { transitAccessibilityScore: null, transitUnavailableReason: reason });
  assert.equal(withDist.transitSource, 'distance', 'a measured nearest-stop distance is still used');
  assert.equal(withDist.transitUnavailableReason, reason, 'and the reason the stop score is missing travels with it');

  const measuredZero = SSS.scoreAccess(noTransit, null, { transitAccessibilityScore: 0, noConfirmedStopWithinZoneRadius: true });
  assert.equal(measuredZero.transitSource, 'pma');
  assert.equal(measuredZero.transitPoints, 0, 'a measured 0 is scored as 0');
  assert.equal(measuredZero.score, 75);

  const full = SSS.computeScore({ amenities: noTransit, transitMetrics: { transitAccessibilityScore: null, transitUnavailableReason: reason } });
  assert.equal(full.accessTransitSource, 'unavailable');
  assert.ok(full.narrative.includes(reason), 'the composite narrative must disclose why transit was left out');
});

test('the justification narrative names the status file\'s distances, and says "not scored" or "none in range" — never a hidden 0', () => {
  const win = pageContext({ modules: ['js/transit-zone.js', 'js/pma-transit.js', 'js/pma-justification.js'] });
  const J = win.PMAJustification;
  const P = win.PMATransit;
  const say = (transit) => J.generateNarrative({ transit });
  const unavailable = say({ transitAccessibilityScore: null, transitUnavailableReason: 'Fixture reason.' });
  assert.match(unavailable, /Transit accessibility was not scored: Fixture reason\./);

  // Real results, so the distances in the sentence are the ones measured.
  P.calculateTransitScore(SITE.lat, SITE.lon, fc([feature(north(SITE, ZONE_MI + 5.2), {})]), {}, MAP_STATUS);
  const zero = say(P.getTransitJustification());
  const radiusText = ZONE_MI + (ZONE_MI === 1 ? ' mile' : ' miles');
  assert.ok(zero.includes('No confirmed transit stop was found within ' + radiusText), zero);
  assert.ok(zero.includes((ZONE_MI + 5.2) + ' miles away'), zero);

  const stops = [0.5, 0.6, 0.7].map((f) => feature(north(SITE, TOD_MI * f), {}))
    .concat([feature(north(SITE, (TOD_MI + ZONE_MI) / 2), {})]);
  P.calculateTransitScore(SITE.lat, SITE.lon, fc(stops), {}, MAP_STATUS);
  const j = P.getTransitJustification();
  const some = say(j);
  assert.ok(some.includes('3 confirmed transit stop(s) within ' + j.todLabel + ' and 4 within ' + radiusText), some);
  const tod = win.TransitZone.qapTodDistance(MAP_STATUS);
  assert.equal(j.todLabel, tod.label, 'the TOD wording is not the shared label');
  assert.ok(some.includes(tod.disclosure), 'a TOD-distance count is shown without the shared straight-line/walking disclosure');

  // Move the file's distances: both sentences move with them.
  P.calculateTransitScore(SITE.lat, SITE.lon, fc(stops), {}, withDistances(TOD_MI, ZONE_MI + 1));
  assert.ok(say(P.getTransitJustification()).includes('within ' + (ZONE_MI + 1) + ' miles'));
  P.calculateTransitScore(SITE.lat, SITE.lon, fc([feature(north(SITE, ZONE_MI + 5.2), {})]), {}, withDistances(TOD_MI, ZONE_MI + 1));
  assert.ok(say(P.getTransitJustification()).includes('No confirmed transit stop was found within ' + (ZONE_MI + 1) + ' miles'));
  // Stops, not routes. (The shared TOD disclosure's "walking route" is a
  // walking path, not a transit route, so the check is on transit routes.)
  assert.doesNotMatch(unavailable + zero + some, /\btransit routes?\b|\broutes\b/i, 'the narrative must describe stops, not routes');
});

// ── 5. The scoring path never loads the route-line file ───────────────────
function runRunner(fetchJSON) {
  const win = pageContext({ fetchJSON, modules: ['js/data-service-portable.js', 'js/transit-zone.js', 'js/pma-transit.js',
    'js/pma-justification.js', 'js/pma-analysis-runner.js'] });
  // EPA SLD is not part of this check; answer it as unavailable.
  win.DataService.fetchEPASmartLocation = () => Promise.resolve({ transitAccessibility: null, walkScore: null, _dataSource: 'epa-unavailable' });
  return new Promise((resolve, reject) => {
    win.PMAAnalysisRunner.run(SITE.lat, SITE.lon, { method: 'buffer', bufferMiles: 3 })
      .on('complete', resolve).on('error', reject);
  });
}

test('the PMA runner scores transit from the stop and status files and never requests the route-line file', async () => {
  const requested = [];
  const stops = fc([feature(north(SITE, 0.3), { name: 'Confirmed' }), feature(north(SITE, 0.1), { reliability: 'unconfirmed' })]);
  const serve = (url) => {
    requested.push(url);
    if (url.endsWith(STOPS_PATH)) return Promise.resolve(stops);
    if (url.endsWith(STATUS_PATH)) return Promise.resolve(MAP_STATUS);
    return Promise.reject(new Error('not in fixture'));
  };
  const run = await runRunner(serve);
  assert.ok(requested.length > 0, 'the runner requested nothing — the check saw no traffic');
  assert.ok(requested.some((u) => u.endsWith(STOPS_PATH)), 'the runner did not load the stop file');
  assert.ok(requested.some((u) => u.endsWith(STATUS_PATH)), 'the runner did not load the zone-map status file');
  assert.deepEqual(requested.filter((u) => u.includes(ROUTES_FILE)), [], 'the PMA runner loaded the route-line file');
  const t = run._analysisResults.transit;
  assert.equal(t.nearbyStopCount, 1);
  assert.equal(t.zoneRadiusMiles, ZONE_MI);
  assert.equal(t.todMiles, TOD_MI);
  assert.equal(typeof t.transitAccessibilityScore, 'number');
  assert.equal(t._stopDataSource, 'local-stops');

  const failed = await runRunner(() => Promise.reject(new Error('HTTP 503')));
  const ft = failed._analysisResults.transit;
  assert.equal(ft.transitAccessibilityScore, null, 'a failed stop load reached the PMA result as a number');
  assert.match(ft.transitUnavailableReason, /could not be loaded/);
  assert.equal(ft._stopDataSource, 'unavailable');
  assert.match(failed.justification.narrative, /Transit accessibility was not scored/);

  const noStatus = await runRunner((url) => url.endsWith(STOPS_PATH) ? Promise.resolve(stops) : Promise.reject(new Error('HTTP 404')));
  const nt = noStatus._analysisResults.transit;
  assert.equal(nt.transitAccessibilityScore, null, 'a missing status file still produced a score');
  assert.match(nt.transitUnavailableReason, /status file/);
});

test('no file on the PMA transit scoring path names the route-line file', () => {
  const scoring = ['js/pma-transit.js', 'js/pma-analysis-runner.js', 'js/data-service-portable.js',
    'js/market-analysis/site-selection-score.js', 'js/pma-justification.js'];
  for (const f of scoring) {
    const src = read(f);
    assert.ok(src.length > 1000, `${f} is empty — nothing was scanned`);
    assert.ok(!src.includes(ROUTES_FILE), `${f} references ${ROUTES_FILE}; PMA transit is scored from stops`);
  }
  // The runner's transit step is the one scanned: it calls the scorer.
  assert.match(read('js/pma-analysis-runner.js'), /pmaTransit\.scoreSite\(lat, lon/);
});

// ── 6. The displayed site-selection score waits for the stop-based score ──
// Codex review of #1996: the controller read PMATransit synchronously, before
// the runner's fetches finished (and the circular-buffer flow never runs the
// runner), so the access score silently used the nearest-distance proxy.
// These drive the real controller with the stop file held back.
function controllerPage({ holdStops = true, failStops = false } = {}) {
  const calls = { stops: 0, status: 0, rendered: [], states: [], errors: [] };
  const timers = [];
  const win = { APP_CONFIG: {},
    console: { log() {}, warn() {}, info() {}, error(...a) { calls.errors.push(a.map(String).join(' ')); } },
    // Zero-delay timers run only when the test flushes, so "pending" is
    // observable; the controller's long safety timeout never fires here.
    setTimeout: (fn, ms) => { if (!ms) timers.push(fn); return timers.length; } };
  win.window = win;
  win.CustomEvent = function (t, o) { this.type = t; this.detail = o && o.detail; };
  win.document = { readyState: 'complete', getElementById: () => null, addEventListener() {}, dispatchEvent() {},
    querySelector: () => null, querySelectorAll: () => [] };
  let releaseStops;
  const stopsGate = new Promise((r) => { releaseStops = r; });
  const stopsFile = fc([feature(north(SITE, 0.3), { name: 'Confirmed' }), feature(north(SITE, 1.2), {})]);
  win.safeFetchJSON = (url) => {
    if (url.endsWith(STOPS_PATH)) {
      calls.stops++;
      if (failStops) return Promise.reject(new Error('HTTP 503'));
      return holdStops ? stopsGate.then(() => stopsFile) : Promise.resolve(stopsFile);
    }
    if (url.endsWith(STATUS_PATH)) { calls.status++; return Promise.resolve(MAP_STATUS); }
    return Promise.reject(new Error('not in fixture: ' + url));
  };
  const ctx = vm.createContext(win);
  for (const m of ['js/data-service-portable.js', 'js/transit-zone.js', 'js/pma-transit.js', 'js/pma-justification.js',
    'js/pma-analysis-runner.js', 'js/market-analysis/site-selection-score.js', 'js/market-analysis/market-analysis-controller.js']) {
    vm.runInContext(read(m), ctx, { filename: m });
  }
  calls.epa = 0;
  win.DataService.fetchEPASmartLocation = () => { calls.epa++; return Promise.resolve({ transitAccessibility: null, walkScore: null, _dataSource: 'epa-unavailable' }); };
  // A nearest-stop distance exists, so the proxy WOULD score if it were used.
  win.OsmAmenities = { isLoaded: () => true, getAccessScore: () => ({
    grocery: { distanceMiles: 0.4 }, transit: { distanceMiles: 0.2 }, transit_rail: null, transit_bus: { distanceMiles: 0.2 },
    parks: { distanceMiles: 0.2 }, healthcare: { distanceMiles: 0.9 }, schools: { distanceMiles: 0.4 } }) };
  win.MAState = { setState(s) { if (s && s.scores !== undefined) calls.states.push(s.scores); }, getState: () => ({}) };
  win.MARenderers = new Proxy({}, { get: (t, k) => (k === 'renderExecutiveSummary'
    ? (scores) => calls.rendered.push(scores) : () => {}) });
  const flush = async () => {
    for (let i = 0; i < 20; i++) {
      while (timers.length) timers.shift()();
      await new Promise((r) => setImmediate(r));
    }
  };
  return { win, calls, flush, releaseStops };
}

test('circular-buffer mode: the displayed score waits for, and uses, the stop-based transit score', async () => {
  const page = controllerPage();
  page.win.MAController.runAnalysis(SITE.lat, SITE.lon, 3);   // the buffer flow: no PMA runner at all
  await page.flush();
  assert.equal(page.calls.rendered.length, 0, 'a score was rendered while the transit score was still pending');
  assert.equal(page.calls.states.length, 0, 'scores were published while the transit score was still pending');
  page.releaseStops();
  await page.flush();
  assert.equal(page.calls.rendered.length, 1, 'the score was never rendered: ' + page.calls.errors.join(' | '));
  const scores = page.calls.rendered[0];
  assert.equal(scores.accessTransitSource, 'pma', 'the displayed access score used the nearest-distance proxy, not the stop-based score');
  assert.equal(page.calls.stops, 1, 'the stop file is fetched once');
});

test('enhanced-runner mode: controller and runner share one stop-based score, whichever finishes first', async () => {
  const page = controllerPage();
  const done = new Promise((resolve, reject) => page.win.PMAAnalysisRunner
    .run(SITE.lat, SITE.lon, { method: 'hybrid', bufferMiles: 3 }).on('complete', resolve).on('error', reject));
  page.win.MAController.runAnalysis(SITE.lat, SITE.lon, 3);
  await page.flush();
  assert.equal(page.calls.rendered.length, 0, 'a score was rendered while the transit score was still pending');
  page.releaseStops();
  await page.flush();
  const run = await done;
  const scores = page.calls.rendered[0];
  assert.ok(scores, 'the score was never rendered: ' + page.calls.errors.join(' | '));
  assert.equal(scores.accessTransitSource, 'pma');
  const t = run._analysisResults.transit;
  assert.equal(typeof t.transitAccessibilityScore, 'number');
  assert.equal(t.nearbyStopCount, 1);
  const ssPts = page.win.SiteSelectionScore.scoreAccess({ grocery: 99, parks: 99, healthcare: 99, schools: 99 }, null,
    { transitAccessibilityScore: t.transitAccessibilityScore }).transitPoints;
  assert.ok(ssPts !== null, 'the runner narrative score is not a number');
  // One transit computation for the site: the narrative and the displayed
  // score cannot rest on different inputs (e.g. different EPA boxes).
  assert.equal(page.calls.epa, 1, 'runner and controller computed the transit score separately');
});

test('a stop file that fails still reaches the displayed score as null with a reason, not a proxy passed off as measured', async () => {
  const page = controllerPage({ failStops: true });
  page.win.MAController.runAnalysis(SITE.lat, SITE.lon, 3);
  await page.flush();
  const scores = page.calls.rendered[0];
  assert.ok(scores, 'the score was never rendered: ' + page.calls.errors.join(' | '));
  assert.equal(scores.accessTransitSource, 'distance', 'a measured nearest-stop distance is still used');
  assert.match(scores.accessTransitUnavailableReason || '', /could not be loaded/, 'the reason the stop score is missing was dropped');
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); console.log(`  ✅ ${name}`); passed++; }
    catch (err) { console.log(`  ❌ ${name}\n     ${err.message}`); failed++; }
  }
  console.log(`\npma-transit-stops: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
