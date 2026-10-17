#!/usr/bin/env node
'use strict';
// Natural features as a market-area limit (option A, 2026-10-17). The tract
// picker proposes the selected tracts that a supported feature separates
// from the site, removes them only on Apply, keeps any tract the analyst says
// a crossing connects, and restores the pre-Apply selection when turned off.
// Each check compares one surface with the record it has to agree with
// (getSelectedGeoids, getNaturalFeatures, the ACS file), not with wording.
// Site: downtown Grand Junction, with the Colorado River to the south.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const SITE = { lat: 39.0639, lon: -108.5506 };

global.window = global;
global.localStorage = { _s: {}, getItem(k) { return this._s[k] || null; }, setItem(k, v) { this._s[k] = v; }, removeItem(k) { delete this._s[k]; } };
let blockBarriers = false;
global.fetch = (url) => {
  if (blockBarriers && /natural_barriers/.test(url)) return Promise.resolve({ ok: false });
  return Promise.resolve({ ok: true, json: () => Promise.resolve(read(url)) });
};
// Minimal Leaflet: the picker only needs layers it can style and click.
const layers = [];
global.L = {
  geoJSON(fc, opts) {
    const group = { eachLayer: (fn) => layers.forEach(fn), addTo() { return group; } };
    fc.features.forEach((feature) => {
      const layer = { feature, handlers: {}, on(h) { Object.assign(this.handlers, h); }, setStyle() {}, bindTooltip() {} };
      opts.onEachFeature(feature, layer);
      layers.push(layer);
    });
    return group;
  },
  polyline: () => ({}),
  layerGroup: () => ({ addTo() { return this; } }),
  DomEvent: { stopPropagation() {} }
};
const map = { removeLayer() {} };
require(path.join(ROOT, 'js/pma-barriers.js'));
require(path.join(ROOT, 'js/pma-tract-picker.js'));
require(path.join(ROOT, 'js/pma-justification.js'));
const P = global.PMATractPicker, B = global.PMABarriers, J = global.PMAJustification;

const acs = {};
read('data/market/acs_tract_metrics_co.json').tracts.forEach((t) => { acs[t.geoid] = t; });
const households = (geoids) => geoids.reduce((s, g) => s + (acs[g] ? acs[g].total_hh : 0), 0);
const sorted = (a) => a.slice().sort();
const narrativeFor = () => J.generateNarrative(Object.assign(J.synthesizePMA({}), { pmaTractSelection: P.getCurationMetadata() }));

(async () => {
  await P.init(map, SITE.lat, SITE.lon);
  const before = sorted(P.getSelectedGeoids());

  // ── (a) propose, then apply ──────────────────────────────────────────────
  let nf = await P.proposeNaturalFeatures();
  assert.equal(nf.status, 'proposed');
  assert(nf.tracts.length >= 2, `non-vacuity: the river site has tracts to propose (${nf.tracts.length})`);
  assert.deepEqual(sorted(P.getSelectedGeoids()), before, 'proposing removes nothing');
  // The on-screen list of supported features and the proposals agree: a
  // highway proposal is always one the stated list covers.
  const statesInterstates = /interstates/i.test(B.SUPPORTED_FEATURES) && !/\bUS routes?\b/i.test(B.SUPPORTED_FEATURES);
  nf.tracts.filter((t) => t.featureType === 'highway').forEach((t) => {
    assert(statesInterstates && /^I-\d+$/.test(t.feature), `${t.geoid}: ${t.feature} is not a feature the option says it checks`);
  });
  const proposed = nf.tracts.map((t) => t.geoid);
  // A tract added after the proposal is drawn joins it before Apply, so
  // Apply never removes a tract that was not shown as proposed (Codex review).
  const visible = layers.map((l) => l.feature.properties.GEOID);
  const cent0 = {};
  read('data/market/tract_centroids_co.json').tracts.forEach((t) => { cent0[t.GEOID || t.geoid] = t; });
  const across = B.proposeTractExclusions(SITE.lat, SITE.lon,
    visible.filter((g) => !before.includes(g) && cent0[g]).map((g) => ({ geoid: g, lat: cent0[g].lat, lon: cent0[g].lon })),
    read('data/market/natural_barriers_co.geojson').features).exclusions.map((e) => e.geoid);
  assert(across.length >= 1, 'non-vacuity: an unselected visible tract is across a feature');
  const clickTract = (g) => layers.find((l) => l.feature.properties.GEOID === g).handlers.click({});
  clickTract(across[0]);
  assert(P.getNaturalFeatures().tracts.some((t) => t.geoid === across[0] && t.state === 'proposed out'),
    'a tract added across a feature is shown as proposed before Apply');
  clickTract(across[0]);
  assert(!P.getNaturalFeatures().tracts.some((t) => t.geoid === across[0]), 'and leaves the proposal when removed');
  // The whole proposal follows the selection, across a status change: Clear
  // all leaves no tract to test, and re-adding the tracts brings the proposal back.
  const keptBefore = proposed[0];
  P.setNaturalFeatureKeep(keptBefore, true, 'Old reason');
  P.clearSelection();
  assert.equal(P.getNaturalFeatures().tracts.length, 0, 'an empty selection proposes nothing');
  before.forEach(clickTract);
  assert.deepEqual(sorted(P.getNaturalFeatures().tracts.map((t) => t.geoid)), sorted(proposed),
    'the proposal returns with the tracts, whatever status the empty selection had');
  assert.equal(P.getNaturalFeatures().tracts.find((t) => t.geoid === keptBefore).state, 'proposed out',
    'Clear all dropped the keep; adding the tract back needs a new choice');
  nf = P.applyNaturalFeatures();
  const after = sorted(P.getSelectedGeoids());
  assert.deepEqual(after, sorted(before.filter((g) => !proposed.includes(g))), 'Apply removes exactly the proposed tracts');
  assert.equal(households(after), households(before) - households(proposed), 'the household count drops by exactly those tracts');
  assert.deepEqual(nf.preApply, before, 'the pre-Apply selection is recorded');

  // Narrative and audit export read the same record as the counts.
  let text = narrativeFor();
  const nfPara = text.split('\n\n').find((p) => /natural features were used/i.test(p)) || '';
  assert(new RegExp('\\b' + proposed.length + ' tract\\(s\\) were excluded').test(nfPara), `narrative names ${proposed.length} excluded: "${nfPara}"`);
  assert(new RegExp('union of ' + after.length + ' whole census tract').test(text), 'narrative tract count = selected tracts');
  const audit = JSON.parse(J.exportToJSON(Object.assign(J.synthesizePMA({}), { pmaTractSelection: P.getCurationMetadata() })));
  const sel = audit.auditTrail ? audit.auditTrail.pma_tract_selection : audit.pma_tract_selection;
  assert.deepEqual(sel.selected, after, 'export GEOIDs = map/count GEOIDs');
  assert.deepEqual(sel.naturalFeatures, P.getNaturalFeatures(), 'export carries the natural-feature record verbatim');
  assert(P.wasCurated(), 'an applied proposal counts as curation');

  // ── (b) keep one for a crossing ──────────────────────────────────────────
  const keep = proposed[0];
  nf = P.setNaturalFeatureKeep(keep, true, 'Bridge at 5th St');
  assert(P.getSelectedGeoids().includes(keep), 'a kept tract is back in the market area');
  assert.equal(households(P.getSelectedGeoids()), households(after) + households([keep]), 'and the count returns by that tract');
  assert.equal(nf.tracts.find((t) => t.geoid === keep).state, 'kept: crossing');
  assert(narrativeFor().includes('Bridge at 5th St'), 'the narrative gives the analyst\'s crossing');

  // Re-adding an excluded tract by clicking it is recorded as the analyst's, and
  // the narrative no longer counts it as excluded.
  const readd = proposed[1];
  layers.find((l) => l.feature.properties.GEOID === readd).handlers.click({});
  assert(P.getSelectedGeoids().includes(readd), 'clicked back in');
  assert.equal(P.getNaturalFeatures().tracts.find((t) => t.geoid === readd).state, 're-added by analyst');
  const stillOut = proposed.length - 2;
  text = narrativeFor();
  assert(new RegExp('\\b' + stillOut + ' tract\\(s\\) were excluded').test(text), `narrative excluded count follows the map (${stillOut})`);

  // Removing a kept tract by hand undoes the keep: no surface may say "kept"
  // for a tract the boundary leaves out (Codex review of #2300).
  layers.find((l) => l.feature.properties.GEOID === keep).handlers.click({});
  assert(!P.getSelectedGeoids().includes(keep), 'the kept tract was removed by hand');
  const keptRec = P.getNaturalFeatures().tracts.find((t) => t.geoid === keep);
  assert.notEqual(keptRec.state, 'kept: crossing', 'its record no longer says kept');
  assert(!narrativeFor().includes('Bridge at 5th St'), 'nor does the narrative');
  layers.find((l) => l.feature.properties.GEOID === keep).handlers.click({});

  // ── (d) turning it off restores the pre-Apply selection ──────────────────
  nf = P.turnOffNaturalFeatures();
  assert.equal(nf.status, 'off');
  assert.deepEqual(sorted(P.getSelectedGeoids()), before, 'off restores the exact pre-Apply set');
  assert(!/natural features were used/i.test(narrativeFor()), 'and the narrative drops the claim');

  // ── (c) the feature file does not load ───────────────────────────────────
  P.clear(map);
  // a fresh module copy, so the cached file is not reused
  delete require.cache[require.resolve(path.join(ROOT, 'js/pma-tract-picker.js'))];
  require(path.join(ROOT, 'js/pma-tract-picker.js'));
  const P2 = global.PMATractPicker;
  blockBarriers = true;
  await P2.init(map, SITE.lat, SITE.lon);
  const plain = sorted(P2.getSelectedGeoids());
  nf = await P2.proposeNaturalFeatures();
  assert.equal(nf.status, 'unavailable', 'a missing file is unavailable, never "none found"');
  P2.applyNaturalFeatures();
  assert.deepEqual(sorted(P2.getSelectedGeoids()), plain, 'counts stay those of the plain selection');
  const t2 = J.generateNarrative(Object.assign(J.synthesizePMA({}), { pmaTractSelection: P2.getCurationMetadata() }));
  assert(/data was unavailable/i.test(t2) && !/were excluded/i.test(t2), 'the narrative says the data was unavailable');
  // A failed load is not cached: turning the option on again retries it.
  blockBarriers = false;
  P2.turnOffNaturalFeatures();
  assert.equal((await P2.proposeNaturalFeatures()).status, 'proposed', 'the file is fetched again once it is reachable');
  P2.turnOffNaturalFeatures();

  // ── turned off while the file loads: the late proposal is dropped ───────
  blockBarriers = false;
  delete require.cache[require.resolve(path.join(ROOT, 'js/pma-tract-picker.js'))];
  require(path.join(ROOT, 'js/pma-tract-picker.js'));
  const P3 = global.PMATractPicker;
  await P3.init(map, SITE.lat, SITE.lon);
  const pending = P3.proposeNaturalFeatures();
  P3.turnOffNaturalFeatures();
  assert.equal((await pending).status, 'off', 'switching off during the load is not undone by the load');
  assert.equal(P3.getNaturalFeatures().status, 'off');

  // ── the file's abbreviated and numbered lake names are checked ────────────
  const square = (x, y, d) => [[[x - d, y - d], [x + d, y - d], [x + d, y + d], [x - d, y + d], [x - d, y - d]]];
  ['Lk Hope', 'Cottonwood Lake Number 5', 'Road Canyon Reservoir No 1'].forEach((name) => {
    const lake = { type: 'Feature', properties: { name, barrier_type: 'water', sub_type: 'lake' }, geometry: { type: 'Polygon', coordinates: square(-105.5, 39.5, 0.01) } };
    const r = B.proposeTractExclusions(39.5, -105.6, [{ geoid: '08000000001', lat: 39.5, lon: -105.4 }], [lake]);
    assert.equal(r.exclusions.length, 1, `"${name}" is a named lake the option checks`);
    assert(!/\bLk\b/.test(r.exclusions[0].feature), 'and its label is spelled out');
  });
  const pond = { type: 'Feature', properties: { name: 'Unnamed water body', barrier_type: 'water', sub_type: 'lake' }, geometry: { type: 'Polygon', coordinates: square(-105.5, 39.5, 0.01) } };
  assert.equal(B.proposeTractExclusions(39.5, -105.6, [{ geoid: '08000000001', lat: 39.5, lon: -105.4 }], [pond]).status, 'no_features', 'an unnamed pond is not checked');

  // ── the site's own tract is never proposed (Carbondale: one tract, across the Crystal River) ──
  const cent = read('data/market/tract_centroids_co.json').tracts;
  const crb = { lat: 39.4019, lon: -107.2112 };
  const near = cent.filter((t) => Math.hypot(t.lat - crb.lat, (t.lon - crb.lon) * 0.77) < 0.06).map((t) => ({ geoid: t.GEOID || t.geoid, lat: t.lat, lon: t.lon }));
  const fc = read('data/market/natural_barriers_co.geojson').features;
  const without = B.proposeTractExclusions(crb.lat, crb.lon, near, fc).exclusions.map((e) => e.geoid);
  assert(without.length >= 1, 'non-vacuity: a tract is across a feature from the Carbondale point');
  const withSite = B.proposeTractExclusions(crb.lat, crb.lon, near, fc, without[0]).exclusions.map((e) => e.geoid);
  assert(!withSite.includes(without[0]), 'the tract containing the site is never proposed');

  // ── a site inside a hole in one tract belongs to the tract filling the hole ──
  // Denver 08031006701 has an interior ring that Arapahoe 08005006712 fills,
  // and it comes first in the boundary file (Codex review).
  const holeSite = { lat: 39.62417, lon: -104.90397 };
  const bfc = read('data/market/tract_boundaries_co.geojson').features;
  const gidOf = (f) => f.properties.GEOID || f.properties.geoid;
  const denver = bfc.find((f) => gidOf(f) === '08031006701');
  assert(denver.geometry.coordinates.length >= 2, 'non-vacuity: the Denver tract has a hole');
  assert(bfc.indexOf(denver) < bfc.findIndex((f) => gidOf(f) === '08005006712'), 'non-vacuity: the holed tract is tested first');
  await P.init(map, holeSite.lat, holeSite.lon);
  assert.equal(P.siteGeoid(), '08005006712', 'the site tract is the one filling the hole');

  // ── the generated rationale sentence follows the record, across a reload ──
  blockBarriers = false;
  const fresh = () => {
    delete require.cache[require.resolve(path.join(ROOT, 'js/pma-tract-picker.js'))];
    require(path.join(ROOT, 'js/pma-tract-picker.js'));
    return global.PMATractPicker;
  };
  let P4 = fresh();
  await P4.init(map, SITE.lat, SITE.lon);
  P4.setRationale('Followed the river.');
  await P4.proposeNaturalFeatures();
  const n4 = P4.getNaturalFeatures().tracts.length;
  P4.applyNaturalFeatures();
  assert(P4.getRationale().startsWith('Followed the river.'), 'the analyst\'s text is kept');
  assert(P4.getRationale().includes('Excluded ' + n4 + ' tract'), 'Apply adds the generated sentence');
  P4 = fresh();                                   // a reload at the same site
  await P4.init(map, SITE.lat, SITE.lon);
  assert.equal(P4.getNaturalFeatures().status, 'applied', 'the applied state is restored');
  const k4 = P4.getNaturalFeatures().tracts[0].geoid;
  P4.setNaturalFeatureKeep(k4, true, 'Bridge');
  assert(P4.getRationale().includes('Excluded ' + (n4 - 1) + ' tract') && P4.getRationale().includes('Kept 1'),
    `after a reload the sentence still follows a keep: "${P4.getRationale()}"`);
  P4.turnOffNaturalFeatures();
  assert.equal(P4.getRationale(), 'Followed the river.', 'turning off takes the sentence out and leaves the analyst\'s text');

  console.log(`pma-natural-features: PASS (${proposed.length} proposed at the river site; keep, re-add, off, unavailable, site tract)`);
})().catch((e) => { console.error(e); process.exit(1); });
