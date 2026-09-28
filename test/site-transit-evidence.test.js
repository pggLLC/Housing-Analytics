'use strict';

// #1931 Task 3. Published-map cases are explicitly synthetic contract fixtures:
// no official OEDIT polygons/facilities are tracked yet. The live data must stay unknown.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const TZ = require('../js/transit-zone.js');
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const json = f => JSON.parse(read(f));
const plain = x => JSON.parse(JSON.stringify(x));
const mapStatus = json('data/policy/thiz-map-status.json');
const stops = json('data/amenities/transit_stops_statewide_co.geojson');
const now = new Date(Date.parse(stops.meta.generated) + 86400e3);
const A = { lat: 39.7527, lon: -105.0003 };
const B = { lat: 38.82, lon: -102.35 };
const published = { ...mapStatus, status: 'published', zones_file: 'data/policy/test-only-thiz.geojson' };
function zonesAt(site = A) {
  const { lat, lon } = site;
  return { type: 'FeatureCollection', meta: { sourceUrl: published.map_source_url, vintage: 'synthetic-test-vintage', complete: true },
    features: [{ type: 'Feature', id: 'test-zone', properties: { facilityId: 'test-facility', facilityName: 'Synthetic mapped station',
      facilityType: 'transit_station', facilityLat: lat + 0.005, facilityLon: lon },
      geometry: { type: 'Polygon', coordinates: [[[lon - .01, lat - .01], [lon + .01, lat - .01],
        [lon + .01, lat + .01], [lon - .01, lat + .01], [lon - .01, lat - .01]]] } }] };
}
function check(site = A, opts = {}, source = 'site') {
  return TZ.create({ stops, mapStatus: published, zones: zonesAt(), now, ...opts }).status(site.lat, site.lon, source);
}

test('a genuine site uses the mapped facility, polygon and provenance, independently of ordinary stops', () => {
  const r = check(A, { stops: null });
  const p = r.program;
  assert.equal(p.qualified, true);
  assert.equal(p.facilityId, 'test-facility');
  assert.equal(p.zoneId, 'test-zone');
  assert.equal(p.facilityType, 'transit_station');
  assert.equal(p.determinationMethod, 'point_in_official_polygon');
  // Independent meridian arc calculation; never derive expected distance from TZ.
  assert.ok(Math.abs(p.distanceMiles - 3958.8 * .005 * Math.PI / 180) < 1e-8);
  assert.equal(p.distanceMethod, 'straight_line_haversine');
  assert.equal(p.thresholdMiles, 2);
  assert.equal(p.sourceUrl, published.map_source_url);
  assert.equal(p.sourceFile, published.zones_file);
  assert.equal(p.vintage, zonesAt().meta.vintage);
  assert.equal(p.checkedAt, now.toISOString());
  assert.equal(TZ.fundingPath(r), 'official');
  assert.equal(r.status, 'unavailable', 'stop accessibility can be unavailable while the map answers');
  assert.equal(check(B).program.qualified, false, 'complete official coverage supports a negative');
  for (const source of ['map_point', 'geocoded_address', 'parcel', 'manual_coordinates']) {
    assert.equal(check(A, {}, source).program.qualified, true);
  }
});

test('missing/invalid sites and every proxy source remain unknown even inside mapped geography', () => {
  for (const site of [{}, { lat: null, lon: A.lon }, { ...A, lat: NaN }, { lat: 0, lon: 0 }]) {
    const r = check(site);
    assert.equal(r.program.qualified, null);
    assert.ok(r.program.unavailableReason);
    assert.equal(TZ.fundingPath(r), null);
  }
  for (const source of [undefined, null, '', 'jurisdiction_centroid', 'pma_centroid', 'municipality', 'county', 'proxy']) {
    const r = TZ.create({ stops, mapStatus: published, zones: zonesAt(), now }).status(A.lat, A.lon, source);
    assert.equal(r.program.qualified, null, String(source));
    assert.ok(r.program.unavailableReason);
    assert.equal(r.program.facilityId, null);
    assert.equal(r.program.distanceMiles, null);
    assert.equal(TZ.fundingPath(r), null);
  }
});

test('nearby real ordinary stops provide accessibility but never program eligibility or a funding benefit', () => {
  assert.ok(check(A, { mapStatus: null }).nearestStop, 'general accessibility does not require a THIZ source');
  const r = check(A, { mapStatus, zones: null });
  assert.equal(r.status, 'within_2mi', 'non-vacuity: real confirmed transit is nearby');
  assert.ok(r.nearestStop.name);
  assert.ok(r.nearestStop.distanceMiles < 2);
  assert.equal(r.nearestStop.distanceMethod, 'straight_line_haversine');
  assert.equal(r.stopsVintage, stops.meta.generated);
  assert.equal(r.program.qualified, null);
  assert.ok(r.program.unavailableReason);
  assert.equal(r.program.facilityId, null);
  assert.equal(TZ.fundingPath(r), null);
  assert.equal(TZ.fundingPath({ status: 'within_2mi', confirmedOnly: true, designation: 'official_in' }), null,
    'legacy saved flags without site evidence cannot open the credit line');
  // A normal bus stop cannot be passed off as an OEDIT-mapped facility.
  const z = zonesAt(); z.features[0].properties.facilityType = 'bus_stop';
  assert.equal(check(A, { zones: z }).program.qualified, null);
  assert.equal(TZ.fundingPath(check(A, { zones: z })), null);
});

test('unavailable, partial, malformed or unlinked official geography remains null, never false', () => {
  const changes = [z => { delete z.meta; }, z => { z.meta.complete = false; }, z => { delete z.meta.vintage; },
    z => { z.meta.sourceUrl = 'https://example.com/unrelated'; }, z => { delete z.features[0].properties.facilityId; },
    z => { delete z.features[0].id; }, z => { z.features.push({ geometry: null }); },
    z => { z.features[0].geometry.coordinates[0][4] = [0, 0]; }];
  for (const site of [A, B]) {
    for (const opts of [{ mapStatus: null }, { zones: null }, { zones: { features: [] } },
      ...changes.map(fn => { const z = zonesAt(); fn(z); return { zones: z }; })]) {
      const r = check(site, opts);
      assert.equal(r.program.qualified, null, JSON.stringify(opts));
      assert.ok(r.program.unavailableReason);
      assert.equal(r.program.distanceMiles, null);
      assert.equal(TZ.fundingPath(r), null);
    }
  }
});

test('polygon holes, multipolygons and boundary uncertainty are handled without a distance fallback', () => {
  const z = zonesAt();
  const outer = z.features[0].geometry.coordinates[0];
  const hole = outer.map(([x, y]) => [A.lon + (x - A.lon) / 2, A.lat + (y - A.lat) / 2]);
  z.features[0].geometry.coordinates.push(hole);
  assert.equal(check(A, { zones: z }).program.qualified, false);
  z.features[0].geometry = { type: 'MultiPolygon', coordinates: [z.features[0].geometry.coordinates] };
  assert.equal(check({ ...A, lat: A.lat + .007 }, { zones: z }).program.qualified, true);
  const boundary = check({ lat: outer[0][1], lon: outer[0][0] }, { zones: z }).program;
  assert.equal(boundary.qualified, null);
  assert.ok(boundary.unavailableReason);
  const noCoordinates = zonesAt(); delete noCoordinates.features[0].properties.facilityLat;
  const p = check(A, { zones: noCoordinates }).program;
  assert.equal(p.qualified, true, 'official geography can answer without fabricating a facility location');
  assert.equal(p.distanceMiles, null);
  assert.equal(p.distanceMethod, null);
});

// Execute the production marker, gate, controller, save handler and storage.
// The marker runs without Leaflet: state must invalidate before drawing returns.
function page(storage = new Map()) {
  const dom = new JSDOM('<div id="pmaTransitZoneGate"></div><div id="dc-tz-note" hidden></div>');
  const timers = [], errors = [];
  const win = { document: { readyState: 'loading', addEventListener() {}, dispatchEvent() {},
      getElementById: id => dom.window.document.getElementById(id) },
    console: { log() {}, warn() {}, error: (...x) => errors.push(x.join(' ')) },
    CustomEvent: function () {}, setTimeout: (fn, ms) => { if (!ms) timers.push(fn); },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) },
    fetch: () => new Promise(() => {}),
    el: id => dom.window.document.getElementById(id),
    _rawLayerData: { transitStops: stops }, siteLatLng: null, _jurisdictionCentroid: null,
    _requestTodStops() {}, _drawTodRing() {},
    SiteSelectionScore: { computeScore: () => ({ final_score: 88 }) },
    TransitZone: { ...TZ, create: o => TZ.create({ ...o, now }) } };
  win.window = win;
  const ctx = vm.createContext(win);
  for (const file of ['js/workflow-state-core.js', 'js/workflow-state-api.js',
    'js/market-analysis/market-analysis-state.js', 'js/market-analysis/market-analysis-controller.js', 'js/deal-calculator.js']) {
    vm.runInContext(read(file), ctx, { filename: file });
  }
  const src = read('js/market-analysis.js');
  const gate = src.match(/  var _tzMapStatus = null[\s\S]*?\n  function _renderTransitZoneGate[\s\S]*?\n  \}\n/);
  const marker = src.match(/  function placeSiteMarker\(lat, lon, opts\) \{[\s\S]*?\n  \}\n/);
  const save = read('market-analysis.html').match(/  function savePmaToProject\(\) \{[\s\S]*?\n  \}/);
  assert.ok(gate && marker && save, 'exercise the actual page entry points');
  vm.runInContext(gate[0] + marker[0] + save[0], ctx);
  if (!win.WorkflowState.getActiveProject()) win.WorkflowState.newProject('Transit evidence');
  const setData = (status = published, zones = zonesAt()) => {
    win._tzMapStatus = status; win._tzMapStatusState = status ? 'ok' : 'failed';
    win._tzZones = zones; win._tzZonesState = zones ? 'ok' : 'failed';
  };
  setData();
  return { win, storage, setData, dom,
    select: (site, centroid = false) => win.placeSiteMarker(site.lat, site.lon, { jurisdictionCentroid: centroid }),
    evidence: () => plain(win.MAController.getCurrentSite().transitEvidence),
    saved: () => plain(win.WorkflowState.getStep('market')),
    save: () => win.savePmaToProject(),
    async flush() { while (timers.length) timers.shift()(); for (let i = 0; i < 4; i++) await new Promise(setImmediate);
      assert.deepEqual(errors, []); }
  };
}

test('rendered positive badge and calculator require qualified true; accessibility is shown separately', () => {
  const p = page(); p.select(A);
  const gate = p.dom.window.document.getElementById('pmaTransitZoneGate');
  const note = p.dom.window.document.getElementById('dc-tz-note');
  assert.equal(gate.querySelector('[data-thiz-qualified]').dataset.thizQualified, 'true');
  assert.ok(gate.textContent.includes(p.evidence().program.facilityName));
  assert.ok(gate.textContent.includes(p.evidence().nearestStop.name));
  assert.equal(note.hidden, false);
  p.select(A, true);
  assert.equal(gate.querySelector('[data-thiz-qualified]').dataset.thizQualified, 'null');
  assert.equal(note.hidden, true);
  assert.equal(gate.querySelector('.pma-tz-pill'), null);
  p.select(B);
  assert.equal(gate.querySelector('[data-thiz-qualified]').dataset.thizQualified, 'false');
  p.setData(mapStatus, null); p.select(A);
  assert.equal(gate.querySelector('[data-thiz-qualified]').dataset.thizQualified, 'null');
  assert.equal(note.hidden, true);
  assert.ok(gate.textContent.includes(p.evidence().program.unavailableReason));
});

test('movement clears current evidence while the saved site changes only on save', async () => {
  const p = page(); p.select(A); p.save();
  assert.equal(p.saved().transitEvidence.program.qualified, true);
  const savedA = p.saved();
  // A programmatic controller run must also clear the calculator before lookup.
  p.win.MAController.runAnalysis(B.lat, B.lon, 3);
  assert.equal(p.dom.window.document.getElementById('dc-tz-note').hidden, true);
  assert.equal(p.win.MAController.getCurrentSite().transitEvidence, null);
  assert.deepEqual(p.saved(), savedA, 'exploring B leaves saved A intact');
  p.select(B);
  assert.deepEqual(p.saved(), savedA, 'B lookup must not write into saved A');
  assert.equal(p.evidence().program.qualified, false);
  for (const key of ['facilityId', 'facilityName', 'distanceMiles', 'distanceMethod']) assert.equal(p.evidence().program[key], null);
  p.save();
  assert.deepEqual([p.saved().siteLat, p.saved().siteLon], [B.lat, B.lon]);
  assert.deepEqual(p.saved().transitEvidence, p.evidence());
  const savedB = p.saved();
  const reloaded = page(p.storage); reloaded.select(A);
  assert.deepEqual(reloaded.saved(), savedB, 'exploring A after reload preserves saved B');
  // A late prior controller run must not become current after movement.
  let release;
  p.win.PMATransit = { scoreSite: () => new Promise(r => { release = r; }) };
  p.win.MAController.runAnalysis(B.lat, B.lon, 3); await p.flush();
  p.select(A); release({ transitAccessibilityScore: 99 }); await p.flush();
  assert.equal(p.win.MAController.getCurrentSite().lat, A.lat);
  assert.equal(p.evidence().program.facilityId, 'test-facility');
  assert.deepEqual(p.saved(), savedB, 'late results cannot overwrite the saved site');
});

test('PMA/buffer changes preserve program evidence; source changes at identical coordinates invalidate it', async () => {
  const p = page(); p.select(A); p.save();
  const before = p.evidence();
  for (const radius of [1, 5, 15]) {
    p.win.MAController.runAnalysis(A.lat, A.lon, radius, { siteSource: 'site' }); await p.flush();
    assert.deepEqual(p.evidence(), before);
    p.save(); assert.deepEqual(p.saved().transitEvidence, before);
  }
  p.win.WorkflowState.setStep('market', { siteAddress: 'Exact site A', dimensions: { access: 80 } });
  const savedSite = p.saved();
  p.select(A, true);
  assert.deepEqual(p.saved(), savedSite, 'unsaved provenance change preserves the saved exact site');
  assert.equal(p.evidence().program.qualified, null);
  p.save(); assert.equal(p.saved().transitEvidence.program.qualified, null);
  assert.equal(p.saved().siteSource, 'jurisdiction_centroid');
  assert.equal(p.saved().siteAddress, null, 'saving a proxy must not retain an exact-site address');
  assert.equal(p.saved().dimensions, null, 'saving a proxy must not retain exact-site scores');
});

test('snapshot round-trips full evidence and receives a lookup completed after saving', () => {
  const p = page(); p.setData(mapStatus, null); p.select(A); p.save();
  assert.equal(p.saved().transitEvidence.program.qualified, null);
  assert.ok(p.saved().transitEvidence.program.unavailableReason);
  p.setData(); p.select(A);
  assert.equal(p.saved().transitEvidence.program.qualified, true);
  const saved = p.saved().transitEvidence;
  assert.deepEqual(saved, p.evidence());
  assert.deepEqual(page(p.storage).saved().transitEvidence, saved);
  p.setData(null, null); p.select(A);
  assert.equal(p.saved().transitEvidence.program.qualified, null);
  assert.equal(p.saved().transitEvidence.program.facilityId, null);
  assert.equal(p.dom.window.document.getElementById('dc-tz-note').hidden, true);
});
