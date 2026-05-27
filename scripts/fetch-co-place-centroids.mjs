#!/usr/bin/env node
/**
 * fetch-co-place-centroids.mjs  (F16, 2026-05-27)
 *
 * One-shot data-refresh script that pulls the Census TIGER Gazetteer
 * file for Colorado places and produces data/co-place-centroids.json
 * keyed by 7-digit place GEOID with lat/lng.
 *
 * Why: tract_centroids_co.json is documented-corrupted (Appendix A.2
 * of the repo audit — GEOID→coord pairings scrambled). County centroids
 * are reliable but place a single dot at the county center, which
 * causes Blue River, Breck, Frisco, etc. all to stack at the Summit
 * County center. With this file we get per-place INTPTLAT/INTPTLONG
 * from the Census Gazetteer — accurate population-weighted centroids
 * for all 482 Colorado incorporated places + CDPs.
 *
 * Used by:
 *   - js/lihtc-opportunity-finder.js _computeOpportunities() for
 *     marker placement on the OF map.
 *
 * Run:
 *   node scripts/fetch-co-place-centroids.mjs
 *
 * The Gazetteer is updated annually by Census (usually February-March).
 * To refresh: bump GAZETTEER_URL to the latest year and re-run.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'data', 'co-place-centroids.json');

const GAZETTEER_URL = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_gaz_place_08.txt';
const VINTAGE = '2024 Census Gazetteer (CO places)';

async function main() {
  console.error('[centroids] Fetching', GAZETTEER_URL);
  const res = await fetch(GAZETTEER_URL, {
    headers: { 'User-Agent': 'CohoAnalyticsBot/1.0 (+https://github.com/pggLLC/Housing-Analytics)' }
  });
  if (!res.ok) {
    console.error('[centroids] Fetch failed:', res.status);
    process.exit(1);
  }
  const raw = await res.text();
  const lines = raw.trim().split('\n');
  const header = lines[0].split('\t').map((s) => s.trim());
  const idx = {
    geoid:  header.indexOf('GEOID'),
    name:   header.indexOf('NAME'),
    lsad:   header.indexOf('LSAD'),
    lat:    header.indexOf('INTPTLAT'),
    lng:    header.indexOf('INTPTLONG'),
    aland:  header.indexOf('ALAND_SQMI')
  };
  if (idx.geoid < 0 || idx.lat < 0 || idx.lng < 0) {
    console.error('[centroids] Gazetteer schema unexpected:', header);
    process.exit(1);
  }
  const byGeoid = {};
  let valid = 0;
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split('\t').map((s) => s.trim());
    const geoid = f[idx.geoid];
    const lat = parseFloat(f[idx.lat]);
    const lng = parseFloat(f[idx.lng]);
    if (!geoid || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    byGeoid[geoid] = {
      name: f[idx.name],
      lsad: f[idx.lsad],   // 25 = city · 43 = town · 57 = CDP · 53 = village
      lat,
      lng,
      area_sqmi: parseFloat(f[idx.aland]) || null
    };
    valid++;
  }
  const out = {
    fetchedAt: new Date().toISOString(),
    source: GAZETTEER_URL,
    vintage: VINTAGE,
    placeCount: valid,
    byGeoid
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(out, null, 2) + '\n');
  console.error(`[centroids] Wrote ${valid} places to ${path.relative(ROOT, OUTPUT_PATH)}`);
}

main().catch((err) => {
  console.error('[centroids] FATAL:', err);
  process.exit(2);
});
