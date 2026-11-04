#!/usr/bin/env node
/**
 * Guards data/market/walk_bike_access_co.json and walk_bike_map_co.json, built by
 * scripts/market/build_walk_bike_access.py (walking and biking access by street and trail).
 *
 * A route is never shorter than a straight line, and adding trails can only shorten a route, so
 * for every place and every service: streets-only <= streets-and-trails <= straight-line. Shares
 * are of homes, so the counties' homes add to the state's. Bands must follow the published cut points.
 * The calmer ride and sidewalk walking use a subset of the network, so they never beat the full figure,
 * and sidewalk figures exist only where the sidewalk map covers at least 80% of homes.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = rel => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const doc = read('data/market/walk_bike_access_co.json');
const map = read('data/market/walk_bike_map_co.json');
const SERVICES = ['grocery', 'school', 'health', 'park', 'transit'];
let checks = 0;
const ok = (cond, msg) => { checks++; assert.ok(cond, msg); };

const m = doc.meta;
ok(m.generated_by === 'scripts/market/build_walk_bike_access.py', 'meta names its builder');
ok(/^\d{4}-\d{2}-\d{2}/.test(m.as_of), 'meta carries an as-of date');
for (const id of ['tiger-roads-2025', 'cotrex-trails', 'tiger-blocks-2020', 'lodes-wac-2023', 'epa-sld']) {
  ok(m.sources.some(s => s.id === id), `meta.sources lists ${id}`);
}
ok(m.sources.find(s => s.id === 'tiger-roads-2025').files === 64, 'all 64 county road files were read');
ok(/Open Database License/.test(m.odbl_notice), 'OpenStreetMap licence notice is present');
for (const s of SERVICES) ok(m.services[s] && m.services[s].source && m.services[s].kept, `service ${s} names its source and what was kept`);
ok(m.not_modelled.includes('hills') && m.not_modelled.includes('how often transit runs'), 'limits are stated');
const LOCAL = ['cdot-bike-prohibited', 'cdot-bike-paths', 'drcog-bike', 'drcog-sidewalks-2024', 'cos-bike', 'cos-sidewalks', 'cos-crosswalks', 'gj-bike'];
for (const id of LOCAL) {
  const s = m.sources.find(x => x.id === id);
  ok(s && /^https:\/\//.test(s.url) && s.features > 0 && /^\d{4}-\d{2}-\d{2}$/.test(s.fetched), `meta.sources lists ${id} with its layer, count and fetch date`);
}
ok(/Bicycles Prohibited/.test(m.bike_closed) && m.bike_calm_definition && m.sidewalk_definition, 'local-layer rules are stated');
const INV = new Set(['drcog', 'cos', 'gj']);

const L = m.bands.labels;
ok(L.length === 4, 'four bands');
// Strong >= top-quarter cut, Fair >= median, Limited > bottom-quarter cut, else Very limited.
const band = (v, c) => v >= c[0] ? L[0] : v >= c[1] ? L[1] : v > c[2] ? L[2] : L[3];

function checkRecord(r, where) {
  ok(r.homes > 0, `${where}: has homes`);
  for (const s of SERVICES) {
    for (const k of ['walk', 'bike', 'walk_roads', 'bike_roads', 'walk_straight', 'bike_straight']) {
      ok(r[k][s] >= 0 && r[k][s] <= 100, `${where}: ${k}.${s} is a share`);
    }
    ok(r.walk_roads[s] <= r.walk[s] + 0.05, `${where}: trails never lower walking reach to ${s}`);
    ok(r.walk[s] <= r.walk_straight[s] + 0.05, `${where}: route walking reach to ${s} never beats the straight line`);
    ok(r.bike_roads[s] <= r.bike[s] + 0.05, `${where}: trails never lower biking reach to ${s}`);
    ok(r.bike[s] <= r.bike_straight[s] + 0.05, `${where}: route biking reach to ${s} never beats the straight line`);
  }
  const avg = k => Math.round(10 * ['grocery', 'school', 'health', 'park'].reduce((t, s) => t + r[k][s], 0) / 4) / 10;
  ok(Math.abs(avg('walk') - r.walk_reach) <= 0.11, `${where}: walk_reach is the average of the four everyday services`);
  ok(Math.abs(avg('bike') - r.bike_reach) <= 0.11, `${where}: bike_reach is the average of the four everyday services`);
  ok(r.transit_reach === r.walk.transit, `${where}: transit_reach is the walk share to a stop`);
  if (r.bands) {
    for (const k of ['walk_reach', 'bike_reach', 'transit_reach']) ok(r.bands[k] === band(r[k], m.bands[k]), `${where}: ${k} band follows the cut points`);
  }
  // Homes off the network are left out of the job medians, so a median is missing only when every home is off it.
  if (r.off_network_pct != null && r.off_network_pct < 100) {
    ok(r.jobs_walk15 != null && r.jobs_bike15 != null, `${where}: job medians present when some homes are on the network`);
  }
  if (r.epa_walk_index != null) ok(r.epa_walk_index >= 1 && r.epa_walk_index <= 20, `${where}: EPA index on its 1-20 scale`);
  for (const s of SERVICES) ok(r.bike_calm[s] <= r.bike[s] + 0.05, `${where}: the calmer ride to ${s} never beats any-street biking`);
  ok(Math.abs(avg('bike_calm') - r.bike_calm_reach) <= 0.11, `${where}: bike_calm_reach is the average of the four`);
  ok(r.sidewalk_mapped_homes_pct >= 0 && r.sidewalk_mapped_homes_pct <= 100, `${where}: sidewalk map coverage is a share`);
  if (r.sidewalk_mapped_homes_pct < 80) {
    ok(r.walk_side === null && r.walk_sidewalk_reach === null && r.sidewalk_source === null, `${where}: no sidewalk figures without a sidewalk map`);
  } else {
    ok(['drcog', 'cos'].includes(r.sidewalk_source), `${where}: sidewalk source named`);
    for (const s of SERVICES) ok(r.walk_side[s] <= r.walk[s] + 0.05, `${where}: sidewalk walking to ${s} never beats any-street walking`);
    ok(Math.abs(avg('walk_side') - r.walk_sidewalk_reach) <= 0.11, `${where}: walk_sidewalk_reach is the average of the four`);
  }
  if (r.sidewalk_pct != null) ok(r.sidewalk_source && r.sidewalk_pct >= 0 && r.sidewalk_pct <= 100 && r.street_km_mapped > 0, `${where}: sidewalk share of measured street length`);
  if (r.missing_sidewalk_km != null) ok(r.sidewalk_source === 'drcog' && r.missing_sidewalk_km >= 0, `${where}: possible missing sidewalk only from DRCOG`);
  ok(r.bike_inventory == null ? r.bike_facility_km == null : INV.has(r.bike_inventory) && r.bike_facility_km >= 0, `${where}: bike facility length only where an inventory covers it`);
}

checkRecord(doc.state, 'state');
const counties = Object.keys(doc.counties);
ok(counties.length === 64, '64 counties');
counties.forEach(g => checkRecord(doc.counties[g], g));
const places = Object.keys(doc.places);
ok(places.length >= 450, 'every Colorado town and CDP with homes (got ' + places.length + ')');
places.forEach(g => { ok(/^08\d{5}$/.test(g), g + ' is a place GEOID'); checkRecord(doc.places[g], g); });
const countyHomes = counties.reduce((t, g) => t + doc.counties[g].homes, 0);
ok(Math.abs(countyHomes - doc.state.homes) <= 1, 'county homes add to the state');
ok(doc.state.homes > 2400000 && doc.state.homes < 2600000, 'state homes match the 2020 Census count (2,491,404 housing units)');

const bgs = Object.keys(doc.blockGroups);
ok(bgs.length > 3000, 'block groups present');
bgs.forEach(g => { const a = doc.blockGroups[g]; ok(a.length === 18 && a[0] > 0, g + ' block group row has 18 fields and homes');
  ok(a[16] <= a[2] + 0.05 && (a[17] == null || a[17] <= a[1] + 0.05), g + ' calmer ride and sidewalk walking never beat the full figures');  });

ok(Object.keys(map.places).every(g => doc.places[g]), 'map layers only for places in the access file');
Object.values(map.places).forEach(l => {
  ok(l.bbox.length === 4 && l.bbox[0] < l.bbox[2] && l.bbox[1] < l.bbox[3], 'map box is ordered');
  ok(Array.isArray(l.bikeways) && l.bikeways.every(t => (t[0] === 'l' || t[0] === 'p') && t.length > 2), 'bike lanes and paths are typed lines');
});
// Known coverage: Denver and Colorado Springs have sidewalk maps; Grand Junction has a bike map but no sidewalk map.
ok(doc.places['0820000'].sidewalk_source === 'drcog' && doc.places['0816000'].sidewalk_source === 'cos', 'Denver and Colorado Springs carry sidewalk figures');
ok(doc.places['0831660'].bike_inventory === 'gj' && doc.places['0831660'].sidewalk_pct === null, 'Grand Junction: bike inventory, no sidewalk map');

console.log(`walk-bike-access: ${checks} checks passed`);
