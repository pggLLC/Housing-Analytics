#!/usr/bin/env node
'use strict';
// The site's own town is always in the starting market area (paul, 27 Nov
// 2026: "the pma for bayfield doesn't include bayfield!"). Before this, the
// tract picker pre-selected tracts by centre distance only (4 miles, else the
// single nearest centre); a rural tract's centre can sit 6-8 miles out, so a
// pin in Bayfield got the tract to the north-west and not Bayfield's own.
// Checks: (a) the Bayfield pin paul used gets tract 9706.02, which holds 1,109
// of Bayfield's 1,111 homes; (b) every Colorado town and CDP under 10,000
// homes, pinned at its own Census internal point, gets its site tract and at
// least 80% of its 2020 homes; (c) a saved set nobody edited is redrawn with
// the town, and an edited one is kept as the analyst left it.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

global.window = global;
global.localStorage = { _s: {}, getItem(k) { return this._s[k] || null; }, setItem(k, v) { this._s[k] = v; }, removeItem(k) { delete this._s[k]; } };
const files = {};
global.fetch = (url) => {
  files[url] = files[url] || read(url);
  return Promise.resolve({ ok: true, json: () => Promise.resolve(files[url]) });
};
global.L = {
  geoJSON(fc, opts) {
    const layers = [];
    const group = { eachLayer: (fn) => layers.forEach(fn), addTo() { return group; } };
    fc.features.forEach((feature) => {
      const layer = { feature, on() {}, setStyle() {}, bindTooltip() {} };
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
require(path.join(ROOT, 'js/pma-tract-picker.js'));
const P = global.PMATractPicker;
const homes = read('data/market/census2020-place-tract-housing-co.json').places;
const points = read('data/market/tract_drive_bands_co.json').places; // [geoid, name, lat, lon], TIGER 2020 internal points
const quiet = console.log; console.log = () => {};

(async () => {
  // (a) paul's Bayfield pin
  const BAYFIELD = { lat: 37.23419, lon: -107.59467 };
  localStorage._s = {};
  await P.init(map, BAYFIELD.lat, BAYFIELD.lon);
  const sel = P.getSelectedGeoids();
  assert(sel.includes('08067970602'), 'Bayfield pin: tract 9706.02 (the town) is selected; got ' + sel.join(', '));
  const home = P.getHome();
  assert.equal(home.siteTract, '08067970602');
  assert.equal(home.town && home.town.geoid, '0805265', 'the town found is Bayfield');
  assert(home.town.inside, 'the pin is inside Bayfield');

  // (b) every town and CDP under 10,000 homes
  let checked = 0;
  const short = [];
  for (const [pid, name, lat, lon] of points) {
    const info = homes[pid];
    if (!info || !info.housing_units || info.housing_units >= 10000) continue;
    localStorage._s = {};
    await P.init(map, lat, lon);
    const got = new Set(P.getSelectedGeoids());
    const h = P.getHome();
    const share = info.tracts.reduce((s, t) => s + (got.has(t.tract_geoid) ? t.housing_units : 0), 0) / info.housing_units;
    if (!h.siteTract || !got.has(h.siteTract) || share < 0.8) short.push(name + ' ' + Math.round(share * 100) + '%');
    checked++;
  }
  assert(checked > 400, 'non-vacuity: ' + checked + ' towns checked');
  assert.deepEqual(short, [], 'towns whose own tract or most of whose homes are left out');

  // (c) saved sets: unedited is redrawn with today's rule; edited is kept
  const KEY = Object.keys(localStorage._s)[0];
  assert(KEY, 'the picker saves its set');
  const oldAuto = ['08067970601'];
  localStorage._s[KEY] = JSON.stringify({ siteCenter: BAYFIELD, selected: oldAuto, autoSelected: oldAuto, rationale: 'kept words', updated_at: Date.now() });
  await P.init(map, BAYFIELD.lat, BAYFIELD.lon);
  assert(P.getSelectedGeoids().includes('08067970602'), 'an unedited saved set gets the town');
  assert.equal(P.getRationale(), 'kept words', 'the rationale is kept');
  const edited = ['08067970601', '08067940300'];
  localStorage._s[KEY] = JSON.stringify({ siteCenter: BAYFIELD, selected: edited, autoSelected: oldAuto, rationale: '', updated_at: Date.now() });
  await P.init(map, BAYFIELD.lat, BAYFIELD.lon);
  assert.deepEqual(P.getSelectedGeoids().slice().sort(), edited.slice().sort(), 'an edited saved set is kept as left');

  console.log = quiet;
  console.log('pma-own-town: ok (' + checked + ' towns and CDPs under 10,000 homes, each with its site tract and 80%+ of its homes)');
})().catch((e) => { console.log = quiet; console.error(e && e.message || e); process.exit(1); });
