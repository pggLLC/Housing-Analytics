'use strict';

// Site eligibility must agree with the designation polygons, never PMA area.
// Rendered assertions check presence/absence, not the editor's badge wording.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '../..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const OZ_PATH = 'data/market/opportunity_zones_co.geojson';
const ZONES = JSON.parse(read(OZ_PATH));
const INSIDE = { lat: 39.736, lon: -105.025, geoid: '08031000800' }; // Denver, Sun Valley tract
const OUTSIDE = { lat: 39.7392, lon: -104.9903 }; // Denver Civic Center
const fc = features => ({ type: 'FeatureCollection', features, meta: ZONES.meta });
const plain = v => JSON.parse(JSON.stringify(v));
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

function context(fetchImpl) {
  const win = { console: { log() {}, warn() {}, error() {} }, fetch: fetchImpl };
  win.window = win;
  vm.createContext(win);
  for (const file of ['js/pma-opportunities.js', 'js/pma-justification.js', 'js/pma-analysis-runner.js']) {
    vm.runInContext(read(file), win, { filename: file });
  }
  return win;
}
const win = context();
const O = win.PMAOpportunities;
function analyze(site, zones, affh = {}, atlas = {}) {
  O.scoreOpportunityIndex(site.lat, site.lon, affh, atlas, zones);
  return plain(O.getOpportunityJustification());
}

// Run the real UI controller's complete handler and the public funding renderer.
// Keep the same DOM across updates to catch stale badges/callouts after a move.
function renderers() {
  const dom = new JSDOM('<div id="pmaJustificationCard"><div id="pmaJustificationNarrative"></div>' +
    '<div id="pmaIncentiveBadges"></div></div><div id="dcSoftFundingBreakdown"></div>',
  { url: 'https://example.test/market-analysis.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.console = { log() {}, warn() {}, error() {} };
  w.fetch = async () => ({ ok: false });
  w.setTimeout = () => 0; // no unrelated delayed bootstrap/progress animation
  const handlers = {};
  w.PMAAnalysisRunner = { run() { return { on(event, fn) { handlers[event] = fn; return this; } }; } };
  w.SoftFundingTracker = { isLoaded: () => true };
  let current;
  w.SiteState = { getPmaResults: () => current };
  for (const p of ['js/pma-justification.js', 'js/pma-ui-controller.js', 'js/components/soft-funding-breakdown.js']) {
    w.eval(read(p));
  }
  return {
    async show(opportunities) {
      current = { opportunities };
      w.PMAUIController.runEnhanced(OUTSIDE.lat, OUTSIDE.lon);
      assert.equal(typeof handlers.complete, 'function', 'UI must register a completion handler');
      handlers.complete(current);
      assert.equal(w.PMAUIController.getLastScoreRun(), current, 'the real completion handler must run');
      w.SoftFundingBreakdown.render(null, '9%', null);
      await new Promise(resolve => setImmediate(resolve));
      const badge = w.document.getElementById('pmaIncentiveBadges');
      const callout = w.document.getElementById('dcOzCallout');
      return { badges: badge.children.length, callout: !!callout && !callout.hidden };
    },
    close() { dom.window.close(); }
  };
}
async function assertRendered(opportunities, expected) {
  const ui = renderers();
  try { assert.deepEqual(await ui.show(opportunities), { badges: expected ? 1 : 0, callout: expected }); }
  finally { ui.close(); }
}
function runRunner(w, site, options = {}) {
  return new Promise((resolve, reject) => {
    w.PMAAnalysisRunner.run(site.lat, site.lon, { method: 'buffer', ...options })
      .on('complete', resolve).on('error', reject);
  });
}

test('real CDFI polygon identifies the Sun Valley site and preserves provenance', async () => {
  assert.equal(ZONES.features.length, ZONES.meta.feature_count, 'fixture scan covers the tracked collection');
  const named = ZONES.features.find(f => f.properties.geoid === INSIDE.geoid);
  assert.ok(named, 'named fixture polygon must exist');
  for (const data of [fc([named]), ZONES]) {
    const status = plain(O.siteOpportunityZone(INSIDE.lat, INSIDE.lon, data));
    assert.deepEqual(status, { inZone: true, geoid: named.properties.geoid, unavailableReason: null,
      vintage: ZONES.meta.vintage, source_url: ZONES.meta.source_url });
  }
  const result = analyze(INSIDE, ZONES);
  assert.equal(result.opportunityZoneShare, null);
  assert.deepEqual(result.incentiveEligibility, { qualifiedOpportunityZone: true });
  assert.equal(result.opportunityIndex, 100);
  await assertRendered(result, true);
  assert.deepEqual(plain(O.getOpportunityLayer(ZONES)).features, ZONES.features, 'map features remain polygons');
});

test('Civic Center is outside every tracked polygon, a measured false with score zero', async () => {
  for (const feature of ZONES.features) {
    assert.equal(O.siteOpportunityZone(OUTSIDE.lat, OUTSIDE.lon, fc([feature])).inZone, false,
      'outside fixture unexpectedly intersects ' + feature.properties.geoid);
  }
  const result = analyze(OUTSIDE, ZONES);
  assert.equal(result.siteOpportunityZone.inZone, false);
  assert.equal(result.siteOpportunityZone.geoid, null);
  assert.equal(result.siteOpportunityZone.unavailableReason, null);
  assert.equal(result.siteOpportunityZone.vintage, ZONES.meta.vintage);
  assert.equal(result.siteOpportunityZone.source_url, ZONES.meta.source_url);
  assert.equal(result.incentiveEligibility.qualifiedOpportunityZone, false);
  assert.equal(result.opportunityIndex, 0);
  assert.equal(result._dataSources.opportunityZones, 'tracked');
  await assertRendered(result, false);
});

test('absent coordinates, missing data and malformed polygons remain unknown through rendering', async () => {
  const cases = [
    [INSIDE, null], [INSIDE, undefined], [INSIDE, []], [INSIDE, fc([])],
    [INSIDE, { features: [], unavailableReason: 'Test load failure' }],
    [INSIDE, fc([{ geometry: null }])],
    [INSIDE, fc([{ geometry: { type: 'Polygon', coordinates: [[[1, 1], [2, 2]]] } }])],
    ...[null, undefined, NaN, Infinity, '', '39.736', 91].map(lat => [{ lat, lon: INSIDE.lon }, ZONES]),
    ...[null, undefined, NaN, Infinity, '', '-105.025', -181].map(lon => [{ lat: INSIDE.lat, lon }, ZONES])
  ];
  const ui = renderers();
  try {
    await ui.show(analyze(INSIDE, ZONES)); // unknown must clear a previous positive
    for (const [site, data] of cases) {
      const result = analyze(site, data);
      assert.equal(result.siteOpportunityZone.inZone, null);
      assert.equal(result.siteOpportunityZone.geoid, null);
      assert.ok(result.siteOpportunityZone.unavailableReason);
      assert.equal(result.opportunityZoneShare, null);
      assert.equal(result.opportunityIndex, null);
      assert.deepEqual(result.incentiveEligibility, { qualifiedOpportunityZone: null });
      assert.equal(result._dataSources.opportunityZones, 'unavailable');
      assert.deepEqual(await ui.show(result), { badges: 0, callout: false });
    }
  } finally { ui.close(); }
});

test('polygon holes, edges and MultiPolygon parts use geometry, not their bounds', () => {
  const ring = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
  const hole = [[1, 1], [3, 1], [3, 3], [1, 3], [1, 1]];
  const second = [[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]];
  const polygons = fc([{ properties: { geoid: 'fixture' }, geometry: { type: 'MultiPolygon', coordinates: [[ring, hole], [second]] } }]);
  for (const [lat, lon, expected] of [[0.5, 0.5, true], [2, 2, false], [2, 0, true], [0, 0, true],
    [2, 1, true], [10.5, 10.5, true], [6, 6, false]]) {
    assert.equal(O.siteOpportunityZone(lat, lon, polygons).inZone, expected, `${lat},${lon}`);
  }
});

test('OZ contributes 100 or 0; unknown OZ/AFFH/Atlas dimensions are excluded from weights', () => {
  assert.equal(analyze(INSIDE, ZONES, { opportunityIndex: 60 }, { mobilityIndex: 80 }).opportunityIndex, 79);
  assert.equal(analyze(OUTSIDE, ZONES, { opportunityIndex: 60 }, { mobilityIndex: 80 }).opportunityIndex, 49);
  assert.equal(analyze(INSIDE, null, { opportunityIndex: 60 }, { mobilityIndex: 80 }).opportunityIndex, 70);
  assert.equal(analyze(INSIDE, null, { opportunityIndex: 60 }, { mobilityIndex: 80, _stub: true }).opportunityIndex, 60);
  assert.equal(analyze(INSIDE, null, { opportunityIndex: 50, _stub: true }, { mobilityIndex: 0 }).opportunityIndex, 0);
  assert.equal(analyze(INSIDE, null, { opportunityIndex: 50, _stub: true }, { mobilityIndex: 50, _stub: true }).opportunityIndex, null);
  for (const notASiteResult of [null, undefined, 0, 0.8, 1, true, { inZone: 'true' }]) {
    assert.deepEqual(plain(O.determineIncentiveEligibility(notASiteResult)), { qualifiedOpportunityZone: null });
  }
});

test('a small real OZ in the PMA bounding-box corner never establishes eligibility at its outside site', async () => {
  const tiny = ZONES.features.find(f => f.properties.geoid === '08031004404');
  assert.ok(tiny);
  const coords = tiny.geometry.coordinates[0];
  const east = Math.max(...coords.map(p => p[0]));
  const north = Math.max(...coords.map(p => p[1]));
  const boundsArea = (east - Math.min(...coords.map(p => p[0]))) * (north - Math.min(...coords.map(p => p[1])));
  assert.ok(boundsArea / (0.5 * 0.5) < 0.001, 'OZ bounds occupy less than 0.1% of the PMA bounds');
  const pma = { type: 'Polygon', coordinates: [[[east - 0.5, north - 0.5], [east, north - 0.5],
    [east, north], [east - 0.5, north], [east - 0.5, north - 0.5]]] };
  const site = { lat: north - 0.25, lon: east - 0.25 };
  assert.equal(O.calculateOpportunityShare(pma, [tiny]), null, 'PMA area share is not measured');
  const w = context(async url => { assert.equal(url, OZ_PATH); return { ok: true, json: async () => fc([tiny]) }; });
  const result = await runRunner(w, site, { method: 'tract', tractBoundary: pma, tractGeoids: ['fixture'] });
  assert.equal(result.opportunities.opportunityZoneShare, null);
  assert.equal(result.opportunities.siteOpportunityZone.inZone, false);
  await assertRendered(result.opportunities, false);
  // Even a legacy saved share cannot light either surface.
  await assertRendered({ opportunityZoneShare: 0.8 }, false);
});

test('runner loads tracked polygons (including APP_BASE_PATH), preserves evidence and recomputes on moving the site', async () => {
  const requested = [];
  const w = context(async url => { requested.push(url); return { ok: true, json: async () => ZONES }; });
  w.APP_BASE_PATH = '/Housing-Analytics/';
  w.DataService = {
    fetchOpportunityZones() { throw new Error('live OZ service must not be used'); },
    fetchHudAFFH: async () => ({ opportunityIndex: 50, _stub: true }),
    fetchHudOpportunityAtlas: async () => ({ mobilityIndex: 50, _stub: true })
  };
  const inside = await runRunner(w, INSIDE);
  assert.deepEqual(plain(inside.opportunities.siteOpportunityZone), plain(O.siteOpportunityZone(INSIDE.lat, INSIDE.lon, ZONES)));
  assert.equal(inside.opportunities.incentiveEligibility.qualifiedOpportunityZone, true);
  const outside = await runRunner(w, OUTSIDE);
  assert.equal(outside.opportunities.incentiveEligibility.qualifiedOpportunityZone, false);
  const missing = await runRunner(w, { lat: null, lon: null });
  assert.equal(missing.opportunities.incentiveEligibility.qualifiedOpportunityZone, null);
  assert.equal(requested.length, 3);
  assert.ok(requested.every(url => url === w.APP_BASE_PATH + OZ_PATH));
  const ui = renderers();
  try {
    assert.deepEqual(await ui.show(inside.opportunities), { badges: 1, callout: true });
    assert.deepEqual(await ui.show(outside.opportunities), { badges: 0, callout: false });
    assert.deepEqual(await ui.show(missing.opportunities), { badges: 0, callout: false });
  } finally { ui.close(); }
});

test('failed fetch, HTTP error, malformed JSON and unavailable fetch never become false', async () => {
  for (const fetchImpl of [
    undefined, async () => { throw new Error('offline'); }, async () => ({ ok: false, status: 503 }),
    async () => ({ ok: true, json: async () => { throw new Error('invalid JSON'); } }),
    async () => ({ ok: true, json: async () => ({ features: [] }) })
  ]) {
    const w = context(fetchImpl);
    const result = (await runRunner(w, INSIDE)).opportunities;
    assert.equal(result.siteOpportunityZone.inZone, null);
    assert.ok(result.siteOpportunityZone.unavailableReason);
    assert.equal(result.opportunityIndex, null);
    assert.deepEqual(plain(result.incentiveEligibility), { qualifiedOpportunityZone: null });
    await assertRendered(result, false);
  }
});

test('AFFH/Atlas failures or absent DataService do not discard the measured OZ result', async () => {
  for (const ds of [undefined, {}, {
    fetchHudAFFH() { throw new Error('AFFH unavailable'); },
    fetchHudOpportunityAtlas: async () => { throw new Error('Atlas unavailable'); }
  }]) {
    const w = context(async () => ({ ok: true, json: async () => ZONES }));
    w.DataService = ds;
    const result = (await runRunner(w, INSIDE)).opportunities;
    assert.equal(result.siteOpportunityZone.inZone, true);
    assert.equal(result.incentiveEligibility.qualifiedOpportunityZone, true);
    assert.equal(result.fairHousingScore, null);
    assert.equal(result.economicMobilityPercentile, null);
    assert.equal(result.opportunityIndex, 100);
  }
});

test('narrative reports site status, GEOID/provenance or the carried unavailable reason', () => {
  const say = opportunities => win.PMAJustification.generateNarrative({ opportunities });
  const inside = say(analyze(INSIDE, ZONES));
  const outside = say(analyze(OUTSIDE, ZONES));
  const unknown = analyze(INSIDE, null);
  assert.match(inside, /site.*within.*Opportunity Zone/i);
  assert.ok(inside.includes(INSIDE.geoid));
  assert.ok(inside.includes(ZONES.meta.vintage));
  assert.ok(inside.includes(ZONES.meta.source_url));
  assert.match(outside, /site.*outside.*Opportunity Zone/i);
  assert.match(say(unknown), /Opportunity Zone status is unavailable/i);
  assert.ok(say(unknown).includes(unknown.siteOpportunityZone.unavailableReason));
  assert.doesNotMatch(inside + outside + say(unknown), /% of the PMA|basis step.down|New Markets Tax Credits/i);
});

test('opportunities count toward data quality only when a component is measured, including false or zero', () => {
  // Two other measured blocks make the opportunities block decisive: 2/5 LOW,
  // 3/5 MEDIUM. A saved share alone must not cross that threshold.
  const quality = opportunities => win.PMAJustification.synthesizePMA({ opportunities,
    commuting: { lodesWorkplaces: 10 }, schools: { schoolsAligned: 1 }, transit: {}, infrastructure: {} }).dataQuality;
  for (const opps of [{}, analyze(INSIDE, null), { opportunityZoneShare: 0.8 }]) assert.equal(quality(opps), 'LOW');
  for (const opps of [analyze(INSIDE, ZONES), analyze(OUTSIDE, ZONES), { fairHousingScore: 0 },
    { economicMobilityPercentile: 0 }]) assert.equal(quality(opps), 'MEDIUM');
});

test('truthy flags, legacy area eligibility and shares cannot grant a badge or callout', async () => {
  for (const flag of [null, undefined, false, 1, 'true']) {
    await assertRendered({ siteOpportunityZone: { inZone: flag }, incentiveEligibility: { qualifiedOpportunityZone: flag },
      opportunityZoneShare: 1, qualifiedOpportunityZone: true }, false);
  }
  await assertRendered({ opportunityZoneShare: 0.8, incentiveEligibility: { qualifiedOpportunityZone: true } }, false);
});

test('no application code reads or sets the removed incentive flags; test is in a CI chain', () => {
  function jsFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const p = path.join(dir, entry.name);
      return entry.isDirectory() ? jsFiles(p) : /\.m?js$/.test(p) ? [p] : [];
    });
  }
  const sources = jsFiles(path.join(ROOT, 'js'));
  assert.ok(sources.length > 0, 'application-code scan must not be empty');
  for (const file of sources) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\b(?:lihtcBasisStepDown|newMarketsTaxCredit)\b/, path.relative(ROOT, file));
  const scripts = JSON.parse(read('package.json')).scripts;
  assert.equal(scripts['test:pma-opportunities'], 'node test/unit/pma-opportunities.test.js');
  const parts = Object.entries(scripts).filter(([name]) => /^ci:part-/.test(name));
  assert.ok(parts.some(([name, cmd]) => scripts['test:ci'].split(' && ').includes('npm run ' + name) &&
    cmd.split(' && ').includes('npm run test:pma-opportunities')));
});

(async () => {
  let failed = 0;
  for (const [name, fn] of queue) {
    try { await fn(); console.log('PASS ' + name); }
    catch (err) { failed++; console.error('FAIL ' + name + '\n' + err.stack); }
  }
  console.log(`${queue.length - failed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
})();
