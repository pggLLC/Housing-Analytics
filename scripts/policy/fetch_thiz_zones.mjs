#!/usr/bin/env node
/**
 * scripts/policy/fetch_thiz_zones.mjs: OEDIT's Transit and Housing
 * Investment Zone map (HB26-1065, C.R.S. 24-48.5-136) as one committed file.
 *
 * OEDIT published the map on 2026-11-03 as an ArcGIS Experience
 * (MAP_URL below; also data/policy/thiz-map-status.json map_source_url). It
 * reads two public, query-only feature services owned by the state's OIT GIS
 * account:
 *
 *   Transit_Facility_Buffer/FeatureServer/2  full_dissolve_2mile: the zone,
 *                                            one statewide MultiPolygon
 *   OEDIT_Transit_Facility/FeatureServer/0   every transportation facility
 *                                            OEDIT identifies, as points
 *
 * Both are written to data/policy/thiz-zones.geojson: the zone as the only
 * feature, and the facilities as a compact `facilities` table. A site inside
 * the zone is linked to the nearest listed facility within the statute's two
 * miles (js/transit-zone.js), the same rule OEDIT used to draw the zone
 * (BUFF_DIST on the per-facility buffer layer). No stop from our own stop
 * file is ever used.
 *
 *   node scripts/policy/fetch_thiz_zones.mjs           write the file
 *   node scripts/policy/fetch_thiz_zones.mjs --check   report whether OEDIT's
 *        layers changed since the committed vintage (exit 0 either way;
 *        prints CHANGED or UNCHANGED)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'data', 'policy', 'thiz-zones.geojson');
export const MAP_URL = 'https://experience.arcgis.com/experience/e6147b1935764243814c801b14d6d411';
const SVC = 'https://services3.arcgis.com/DgjqnJA1rgO92Soi/arcgis/rest/services';
export const ZONE_LAYER = `${SVC}/Transit_Facility_Buffer/FeatureServer/2`;
export const FACILITY_LAYER = `${SVC}/OEDIT_Transit_Facility/FeatureServer/0`;
const PAGE = 1000;           // the service's GeoJSON page size
const PRECISION = 5;         // decimal degrees, about 1 m

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'COHO-Analytics-data-refresh' } });
      if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
      const j = await r.json();
      if (j && j.error) throw new Error(`ArcGIS error ${JSON.stringify(j.error)} for ${url}`);
      return j;
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((res) => setTimeout(res, 2000 * 2 ** (attempt - 1)));
    }
  }
}

// The layer's own last data edit, as a date: the zone's vintage.
async function layerVintage(layerUrl) {
  const meta = await getJson(`${layerUrl}?f=json`);
  const t = meta && meta.editingInfo && (meta.editingInfo.dataLastEditDate || meta.editingInfo.lastEditDate);
  if (!Number.isFinite(t)) throw new Error(`no dataLastEditDate on ${layerUrl}`);
  return new Date(t).toISOString();
}

const round = (v) => Math.round(v * 10 ** PRECISION) / 10 ** PRECISION;
const STATUS = { 'Existing': 'existing', 'Concept/Design': 'concept_design', 'Under Construction': 'under_construction' };
export const typeKey = (t) => String(t || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

async function fetchFacilities() {
  const count = (await getJson(`${FACILITY_LAYER}/query?where=1%3D1&returnCountOnly=true&f=json`)).count;
  const rows = [];
  for (let offset = 0; offset < count; offset += PAGE) {
    const q = `${FACILITY_LAYER}/query?where=1%3D1&outFields=OBJECTID,stop_id,stop_name,type,status,agency,city,county`
      + `&outSR=4326&orderByFields=OBJECTID&resultOffset=${offset}&resultRecordCount=${PAGE}&f=geojson`;
    for (const f of (await getJson(q)).features || []) {
      const p = f.properties || {};
      const [lon, lat] = (f.geometry && f.geometry.coordinates) || [];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`facility ${p.OBJECTID} has no point`);
      if (!(p.status in STATUS)) throw new Error(`facility ${p.OBJECTID} has an unknown status "${p.status}"`);
      rows.push([String(p.OBJECTID), p.stop_name || null, typeKey(p.type), STATUS[p.status], p.agency ? String(p.agency).trim() : null,
        p.city || null, p.county || null, round(lat), round(lon)]);
    }
  }
  if (rows.length !== count) throw new Error(`fetched ${rows.length} facilities, service reports ${count}`);
  if (new Set(rows.map((r) => r[0])).size !== rows.length) throw new Error('duplicate facility ids');
  return rows;
}

async function fetchZone() {
  const j = await getJson(`${ZONE_LAYER}/query?where=1%3D1&outFields=OBJECTID&outSR=4326&geometryPrecision=${PRECISION}&f=geojson`);
  const feats = (j && j.features) || [];
  if (feats.length !== 1) throw new Error(`expected one dissolved zone, got ${feats.length}`);
  const g = feats[0].geometry;
  if (!g || !['Polygon', 'MultiPolygon'].includes(g.type)) throw new Error('zone geometry is not a polygon');
  return g;
}

async function main() {
  const check = process.argv.includes('--check');
  const [zoneVintage, facilityVintage] = await Promise.all([layerVintage(ZONE_LAYER), layerVintage(FACILITY_LAYER)]);
  if (check) {
    const cur = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')).meta : {};
    const changed = cur.zoneLayerEdited !== zoneVintage || cur.facilityLayerEdited !== facilityVintage;
    console.log(`${changed ? 'CHANGED' : 'UNCHANGED'} zone ${cur.zoneLayerEdited} -> ${zoneVintage}; facilities ${cur.facilityLayerEdited} -> ${facilityVintage}`);
    return;
  }
  const [geometry, facilities] = await Promise.all([fetchZone(), fetchFacilities()]);
  const vintage = (zoneVintage > facilityVintage ? zoneVintage : facilityVintage).slice(0, 10);
  const out = {
    type: 'FeatureCollection',
    meta: {
      source: 'Colorado Office of Economic Development and International Trade (OEDIT), Transit and Housing Investment Zone map',
      sourceUrl: MAP_URL,
      zoneLayer: ZONE_LAYER,
      facilityLayer: FACILITY_LAYER,
      vintage,
      zoneLayerEdited: zoneVintage,
      facilityLayerEdited: facilityVintage,
      fetched: new Date().toISOString(),
      complete: true,
      radiusMiles: 2,
      linkage: 'nearest_listed_facility_within_radius',
      facilityCount: facilities.length,
      facilityColumns: ['id', 'name', 'type', 'status', 'agency', 'city', 'county', 'lat', 'lon'],
      note: 'The zone is OEDIT’s full_dissolve_2mile layer as published; facilities are every transportation facility on its map, including planned ones (status concept_design or under_construction). OEDIT’s data notice: the State of Colorado makes no warranty as to completeness, accuracy or timeliness, and the data is subject to change. Refreshed by scripts/policy/fetch_thiz_zones.mjs.',
    },
    features: [{ type: 'Feature', id: 'oedit-thiz-full-dissolve-2mile', properties: { layer: 'full_dissolve_2mile' }, geometry }],
    facilities,
  };
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log(`wrote ${path.relative(ROOT, OUT)}: vintage ${vintage}, ${facilities.length} facilities`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
