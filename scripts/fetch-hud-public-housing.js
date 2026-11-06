#!/usr/bin/env node
/**
 * fetch-hud-public-housing.js
 *
 * Fetches HUD's Public Housing Developments layer for Colorado and writes
 *   data/affordable-housing/preservation/hud-public-housing.json
 *
 * Public housing is owned by local housing authorities with HUD operating
 * and capital funds. It is not in CHFA's tax credit or preservation lists
 * unless a building was also refinanced there, and it is not in HUD's
 * multifamily (Section 8 contract) layer, so without this file the
 * affordable-housing inventory left most of it out.
 *
 * One record per development. A scattered-site development (several
 * buildings) is placed at one point by HUD.
 * Housing-authority staff names and contacts are not on this layer and are
 * not copied. Tenant characteristics on the layer are not copied either.
 *
 * Source: https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Public_Housing_Developments/FeatureServer/0
 * Run:    node scripts/fetch-hud-public-housing.js
 */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const SERVICE = 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Public_Housing_Developments/FeatureServer/0';
const OUT_PATH = path.resolve(__dirname, '..', 'data/affordable-housing/preservation/hud-public-housing.json');
const FIELDS = [
  'PARTICIPANT_CODE', 'FORMAL_PARTICIPANT_NAME', 'DEVELOPMENT_CODE', 'PROJECT_NAME',
  'SCATTERED_SITE_IND', 'TOTAL_DWELLING_UNITS', 'ACC_UNITS', 'TOTAL_UNITS',
  'STATE2KX', 'CNTY2KX', 'CURCNTY_NM', 'CURCOSUB_NM', 'MONTHS_SINCE_REPORT'
].join(',');

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'coho-analytics/1.0' } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error('HTTP ' + res.statusCode));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

const trim = (s) => (s == null ? null : String(s).trim() || null);
const title = (s) => (s ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : null);

async function main() {
  const features = [];
  let offset = 0;
  for (;;) {
    const q = new URLSearchParams({
      where: "STD_ST='CO'", outFields: FIELDS, outSR: '4326', returnGeometry: 'true',
      resultOffset: String(offset), resultRecordCount: '2000', orderByFields: 'DEVELOPMENT_CODE', f: 'json'
    });
    const page = await getJson(SERVICE + '/query?' + q.toString());
    if (page.error) throw new Error('ArcGIS error: ' + JSON.stringify(page.error));
    const pf = page.features || [];
    features.push(...pf);
    if (pf.length < 2000) break;
    offset += 2000;
  }
  const out = features.filter((f) => f.geometry && f.geometry.x != null).map((f) => {
    const a = f.attributes;
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [Math.round(f.geometry.x * 1e6) / 1e6, Math.round(f.geometry.y * 1e6) / 1e6] },
      properties: {
        PROJECT: title(trim(a.PROJECT_NAME)),
        DEVELOPMENT_CODE: trim(a.DEVELOPMENT_CODE),
        PHA_CODE: trim(a.PARTICIPANT_CODE),
        PHA_NAME: trim(a.FORMAL_PARTICIPANT_NAME),
        PROJ_ST: 'CO',
        CNTY_FIPS: a.STATE2KX && a.CNTY2KX ? String(a.STATE2KX) + String(a.CNTY2KX).padStart(3, '0') : null,
        CNTY_NAME: trim(a.CURCNTY_NM),
        COUNTY_SUBDIVISION: trim(a.CURCOSUB_NM),
        SCATTERED_SITE: a.SCATTERED_SITE_IND === 'Y',
        N_UNITS: a.TOTAL_UNITS || null,
        ACC_UNITS: a.ACC_UNITS || null,
        MONTHS_SINCE_REPORT: a.MONTHS_SINCE_REPORT,
        _source: 'HUD Public Housing Developments'
      }
    };
  });
  const units = out.reduce((s, f) => s + (f.properties.N_UNITS || 0), 0);
  const payload = {
    type: 'FeatureCollection',
    meta: {
      source: 'HUD Public Housing Developments (HUD eGIS)',
      source_url: SERVICE,
      query: "STD_ST='CO'",
      fetched: new Date().toISOString().slice(0, 10),
      unit_field: 'N_UNITS is the layer TOTAL_UNITS field; ACC_UNITS (units under the HUD annual contributions contract) is kept beside it',
      records: out.length,
      units,
      excluded: 'Tenant characteristics and any contact fields are not copied.'
    },
    features: out
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(payload, null, 1) + '\n');
  console.log(`Wrote ${OUT_PATH}: ${out.length} developments, ${units} homes`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
