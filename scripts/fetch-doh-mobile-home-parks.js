#!/usr/bin/env node
/**
 * fetch-doh-mobile-home-parks.js
 *
 * Fetches the Colorado Division of Housing's registered mobile home parks and writes
 *   data/affordable-housing/preservation/doh-mobile-home-parks.json
 *
 * Sources (DOH Mobile Home Park Oversight, https://doh.colorado.gov/mobile-home-parks):
 *   - Lot counts by park: one row per registered park, with its address, county and lots by type.
 *   - Parks owned by residents, nonprofits or local governments: marks those parks and their year of purchase.
 *
 * Left out on purpose: owner and manager names, and DOH's list of parks with sale notices.
 * The sale-notice list is a dated acquisition lead and belongs on the member site (paul, 2026-10-26).
 *
 * Addresses are placed with the US Census Geocoder (batch, public, no key). A park the
 * geocoder cannot match keeps its row with geometry null, and is counted in meta.
 *
 * DOH says it does not guarantee the lists' accuracy; meta.caveat carries that.
 *
 * Run:  node scripts/fetch-doh-mobile-home-parks.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SHEET = id => `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
const LOTS_ID = '1HVvW0QAey7-ovN41jp6_s4pbmBAPNuUbIa6r8R2S3E8';
const COMMUNITY_ID = '1YZ9HQkVCa5eEGdp6Hx8AUYPBAzbOKM5ya2tCkRRbMAk';
const GEOCODER = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch';
const OUT_PATH = path.resolve(__dirname, '..', 'data/affordable-housing/preservation/doh-mobile-home-parks.json');

// RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift().map(h => h.trim());
  return rows.filter(r => r.some(v => v.trim())).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

async function getText(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.text();
}

// A count or year as published; blanks, missing columns and markers such as "N/A" stay null, never 0.
const count = v => {
  const t = String(v == null ? '' : v).replace(/[,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
};

async function geocode(parks) {
  const csv = parks.map(p => [p.id, p.street, p.city, 'CO', p.zip].map(v => '"' + String(v || '').replace(/"/g, '') + '"').join(',')).join('\n');
  const form = new FormData();
  form.append('addressFile', new Blob([csv], { type: 'text/csv' }), 'parks.csv');
  form.append('benchmark', 'Public_AR_Current');
  const res = await fetch(GEOCODER, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`${res.status} from the Census geocoder`);
  const out = new Map();
  parseCsv('id,input,match,exact,matched,coords,tiger,side\n' + await res.text()).forEach(r => {
    if (r.match !== 'Match' || !r.coords) return;
    const [lon, lat] = r.coords.split(',').map(Number);
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.set(r.id, { lon, lat, exact: r.exact === 'Exact' });
  });
  return out;
}

async function main() {
  const lots = parseCsv(await getText(SHEET(LOTS_ID)));
  const community = parseCsv(await getText(SHEET(COMMUNITY_ID)));
  const owned = new Map(community.map(r => [r['Registration Number'], count(r['Year of Purchase'])]));

  const parks = lots.filter(r => r['Registration Number']).map(r => ({
    id: r['Registration Number'], name: r['Park Name'], street: r.Street, city: r.City, zip: r.Zip, county: r.County,
    lots: count(r['Total Number of Lots']),
    ownerHome: count(r['A. Lot rented to a mobile home owner']),
    parkHome: count(r['B. Park-owned mobile home rented to a tenant']),
    otherMobile: count(r['C. Other mobile home']),
    otherUse: count(r['D. Other non-mobile home'])
  }));
  if (parks.length < 500) throw new Error(`Only ${parks.length} parks in the DOH sheet; refusing to overwrite`);

  const placed = await geocode(parks);
  const features = parks.map(p => {
    const g = placed.get(p.id);
    return {
      type: 'Feature',
      geometry: g ? { type: 'Point', coordinates: [Number(g.lon.toFixed(6)), Number(g.lat.toFixed(6))] } : null,
      properties: {
        REGISTRATION: p.id, PROJECT: p.name, PROJ_ADD: p.street, PROJ_CTY: p.city, PROJ_ST: 'CO', Zip: p.zip, CNTY_NAME: p.county,
        N_UNITS: p.lots,
        lots_owner_home: p.ownerHome, lots_park_owned_rented: p.parkHome, lots_other_mobile: p.otherMobile, lots_other_use: p.otherUse,
        community_owned: owned.has(p.id),
        community_purchase_year: owned.has(p.id) ? owned.get(p.id) : null,
        geocode_match: g ? (g.exact ? 'exact' : 'non-exact') : null,
        _source: 'Colorado Division of Housing, Mobile Home Park Oversight',
        program_type: 'mobile-home-park'
      }
    };
  });

  const out = {
    type: 'FeatureCollection',
    meta: {
      source: 'Colorado Division of Housing, Mobile Home Park Oversight',
      source_url: 'https://doh.colorado.gov/mobile-home-parks',
      sheets: { lot_counts: SHEET(LOTS_ID).replace('/export?format=csv', ''), community_owned: SHEET(COMMUNITY_ID).replace('/export?format=csv', '') },
      fetched_at: new Date().toISOString(),
      parks: features.length,
      lots: features.reduce((t, f) => t + (f.properties.N_UNITS || 0), 0),
      community_owned: features.filter(f => f.properties.community_owned).length,
      community_owned_in_sheet: community.length,
      geocoded: features.filter(f => f.geometry).length,
      geocoder: 'US Census Geocoder, Public_AR_Current benchmark',
      units_note: 'N_UNITS is the total number of lots DOH lists for the park.',
      caveat: 'DOH does not guarantee the accuracy of these lists and advises against relying on them for business or legal decisions.',
      left_out: 'Owner and manager names, and DOH’s list of parks with sale notices.'
    },
    features
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out) + '\n');
  console.log(`Wrote ${features.length} parks (${out.meta.lots} lots, ${out.meta.geocoded} placed, ${out.meta.community_owned} community-owned) to ${path.relative(process.cwd(), OUT_PATH)}`);
}

if (require.main === module) main().catch(err => { console.error(err.message); process.exit(1); });
module.exports = { parseCsv, count };
