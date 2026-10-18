'use strict';

/**
 * "What's near this site" (js/market-analysis/whats-near.js).
 *
 *   - jobs: a site's own census tract always counts, however far its centre
 *     point is (Bayfield's tract centre is more than 5 miles from town, so the
 *     5-mile row read 0 jobs before);
 *   - the tract lookup finds the 2020 tract that contains the point;
 *   - the place table is a single-header-row table with a data-tip on every
 *     header (the shared sorter and header tips work on it) and no score.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data', p), 'utf8'));

const hosts = {};
const ctx = {
  console,
  Promise,
  window: {},
  document: { getElementById: (id) => hosts[id] || null }
};
ctx.window.DataService = {
  getJSON: (p) => Promise.resolve(read(p.replace(/^data\//, ''))),
  baseData: (p) => 'data/' + p
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/market-analysis/whats-near.js'), 'utf8'), ctx);
const WN = ctx.window.WhatsNear;

const centroids = read('market/tract_centroids_co.json');
const lodes = read('market/lodes_co.json');
const geometry = read('market/pma_tract_display_geometry.geojson');

// Bayfield town (Mill St), Durango downtown.
const BAYFIELD = [37.2256, -107.5981];
const DURANGO = [37.2753, -107.8801];

const bayTract = WN._tractAt(BAYFIELD[0], BAYFIELD[1], geometry);
assert.ok(/^08067/.test(bayTract), 'Bayfield is in a La Plata County tract, got ' + bayTract);
const durTract = WN._tractAt(DURANGO[0], DURANGO[1], geometry);
assert.ok(/^08067/.test(durTract) && durTract !== bayTract, 'Durango has its own La Plata tract');
assert.strictEqual(WN._tractAt(40.0, -95.0, geometry), '', 'a point outside Colorado has no tract');

const own = lodes.tracts.find((t) => t.geoid === bayTract);
const bay = WN._jobsWithin(BAYFIELD[0], BAYFIELD[1], centroids, lodes, bayTract);
assert.deepStrictEqual(Array.from(bay, (r) => r.radius), [0, 5, 10]);
assert.strictEqual(bay[0].total, own.totalJobs, 'tract row = the tract\'s LODES jobs');
assert.strictEqual(bay[0].low, own.low_wage);
assert.ok(bay[1].total >= own.totalJobs, 'the 5-mile row always includes the site\'s tract');
assert.ok(bay[2].total >= bay[1].total, '10 miles includes 5 miles');
const noOwn = WN._jobsWithin(BAYFIELD[0], BAYFIELD[1], centroids, lodes, '');
assert.ok(noOwn[1].total < bay[1].total, 'without the own-tract rule Bayfield\'s 5-mile row loses its tract');

const s = WN._summary([{ type: 'grocery', distance: 0.5 }, { type: 'park', near: 1, distance: 0.4 }],
  [{ radius: 5, total: 19102, low: 3917 }]);
assert.strictEqual(s, 'About 19,100 jobs in census tracts within 5 miles, 3,900 of them low-wage; ' +
  'full grocery store 0.5 mi; 1 park within 1 mile.');

// Render with a stub OsmAmenities.
ctx.window.OsmAmenities = {
  isLoaded: () => true,
  getNearestByType: (lat, lon, type) => type === 'pharmacy' ? null
    : type === 'hospital' ? { name: 'Gunnison Valley Hospital', distanceMiles: 0.4, hospitalType: 'CAH' }
    : type === 'transit_stop' ? { name: 'Stop', distanceMiles: 0.02, transitStopBasis: 'confirmed' }
    : { name: 'X & <Y>', distanceMiles: 1.25 },
  getWithinRadius: (lat, lon, type) => type === 'transit_stop'
    ? [{ distanceMiles: 0.02, transitStopBasis: 'confirmed' }, { distanceMiles: 0.5, transitStopBasis: 'openstreetmap_unconfirmed' }]
    : [{ distanceMiles: 0.5 }, { distanceMiles: 2.5 }]
};
hosts.wn = { innerHTML: '' };
WN.render('wn', { lat: DURANGO[0], lon: DURANGO[1] });
const html = hosts.wn.innerHTML;
const places = html.slice(html.indexOf('Places near this site'));
assert.strictEqual((places.match(/<thead>/g) || []).length, 1);
assert.strictEqual((places.match(/<tr>/g) || []).length, 11, 'one header row and ten place rows');
const ths = places.match(/<th [^>]*>/g);
assert.strictEqual(ths.length, 6);
ths.forEach((t) => assert.ok(/data-tip="[^"]+"/.test(t), 'every header has its help text: ' + t));
assert.ok(places.includes('X &amp; &lt;Y&gt;'), 'names are escaped');
assert.ok(places.includes('(critical access hospital)'));
assert.ok(places.includes('under 0.1 mi'));
assert.ok(/Pharmacy<\/td><td[^>]*>—<\/td>/.test(places), 'no pharmacy found shows a dash');
assert.ok(places.includes('None found'));
assert.ok(/Transit stop<\/td><td[^>]*>under 0.1 mi<\/td><td[^>]*>1<\/td><td[^>]*>1<\/td>/.test(places),
  'an OpenStreetMap-only stop is not counted beside agency stops');
assert.ok(!/score/i.test(places.replace('the site score does not use these counts', '')), 'no score in the block');

setTimeout(() => {
  const after = hosts.wn.innerHTML;
  assert.ok(after.includes('This census tract'), 'jobs table fills in once LODES loads');
  assert.ok(/This census tract is (not )?a USDA/.test(after) || !after.includes('USDA Food'), 'food line, when shown, is a sentence');
  // A failed or empty amenity file: the block says so instead of loading forever,
  // whether the failure lands after the render or before a later one.
  ctx.window.OsmAmenities = { isLoaded: () => false };
  hosts.wn2 = { innerHTML: '' };
  WN.render('wn2', { lat: DURANGO[0], lon: DURANGO[1] });
  assert.ok(hosts.wn2.innerHTML.includes('Nearby places are still loading.'));
  WN.setPlacesUnavailable('the amenity file did not load.');
  assert.ok(hosts.wn2.innerHTML.includes('Nearby places are unavailable: the amenity file did not load.'));
  hosts.wn3 = { innerHTML: '' };
  WN.render('wn3', { lat: BAYFIELD[0], lon: BAYFIELD[1] });
  assert.ok(hosts.wn3.innerHTML.includes('Nearby places are unavailable'));
  // The connector script itself missing: unavailable, never "still loading".
  delete ctx.window.OsmAmenities;
  hosts.wn4 = { innerHTML: '' };
  WN.render('wn4', { lat: DURANGO[0], lon: DURANGO[1] });
  assert.ok(hosts.wn4.innerHTML.includes('Nearby places are unavailable: the amenity connector did not load.'));
  console.log('whats-near: all checks passed');
}, 500);
