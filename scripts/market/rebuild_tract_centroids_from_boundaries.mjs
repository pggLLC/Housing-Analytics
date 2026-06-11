#!/usr/bin/env node
/**
 * Rebuild data/market/tract_centroids_co.json from TIGER 2020 tract
 * boundaries. This avoids mixing ACS-expanded GEOIDs with unrelated centroid
 * coordinates.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const BOUNDARIES = path.join(ROOT, 'data', 'market', 'tract_boundaries_co.geojson');
const CENTROIDS = path.join(ROOT, 'data', 'market', 'tract_centroids_co.json');
const GEO_CONFIG = path.join(ROOT, 'data', 'hna', 'geo-config.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function countyNameByFips() {
  const gc = readJson(GEO_CONFIG);
  const out = {};
  (gc.counties || []).forEach((c) => {
    if (!c || !c.geoid) return;
    out[String(c.geoid).padStart(5, '0')] = String(c.label || '').replace(/\s+County$/i, '');
  });
  return out;
}

function visitPositions(coords, fn) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
    fn(coords[0], coords[1]);
    return;
  }
  coords.forEach((child) => visitPositions(child, fn));
}

function bboxForGeometry(geometry) {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  visitPositions(geometry && geometry.coordinates, (lon, lat) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  });
  if (!Number.isFinite(minLon)) return null;
  return [minLon, minLat, maxLon, maxLat].map((n) => Math.round(n * 1e6) / 1e6);
}

function containsBboxPoint(bbox, lat, lon) {
  return bbox &&
    lon >= bbox[0] && lon <= bbox[2] &&
    lat >= bbox[1] && lat <= bbox[3];
}

function centroidForFeature(feature, bbox) {
  const props = feature.properties || {};
  const intLat = Number(props.INTPTLAT);
  const intLon = Number(props.INTPTLON);
  if (Number.isFinite(intLat) && Number.isFinite(intLon) && containsBboxPoint(bbox, intLat, intLon)) {
    return { lat: intLat, lon: intLon, source: 'tiger2020_intpt' };
  }
  return {
    lat: (bbox[1] + bbox[3]) / 2,
    lon: (bbox[0] + bbox[2]) / 2,
    source: 'bbox_center'
  };
}

function main() {
  const boundaries = readJson(BOUNDARIES);
  const countyNames = countyNameByFips();
  const seen = new Set();
  const tracts = [];

  (boundaries.features || []).forEach((feature) => {
    const props = feature.properties || {};
    const geoid = String(props.GEOID || props.geoid || '').trim();
    if (!/^\d{11}$/.test(geoid)) {
      throw new Error(`Invalid tract GEOID: ${geoid || '(missing)'}`);
    }
    if (seen.has(geoid)) throw new Error(`Duplicate tract GEOID: ${geoid}`);
    seen.add(geoid);

    const bbox = bboxForGeometry(feature.geometry);
    if (!bbox) throw new Error(`Missing geometry bbox for ${geoid}`);
    const centroid = centroidForFeature(feature, bbox);
    if (!containsBboxPoint(bbox, centroid.lat, centroid.lon)) {
      throw new Error(`Centroid outside bbox for ${geoid}`);
    }

    const countyFips = geoid.slice(0, 5);
    const countyName = countyNames[countyFips] || countyFips;
    tracts.push({
      geoid,
      lat: Math.round(centroid.lat * 1e6) / 1e6,
      lon: Math.round(centroid.lon * 1e6) / 1e6,
      county_fips: countyFips,
      county_name: countyName,
      tract_name: props.NAME || props.NAMELSAD || `Census Tract ${geoid.slice(5)}`,
      bbox,
      bbox_source: 'tiger2020',
      centroid_source: centroid.source
    });
  });

  tracts.sort((a, b) => a.geoid.localeCompare(b.geoid));
  const expected = (boundaries.features || []).length;
  if (tracts.length !== expected) {
    throw new Error(`Centroid count ${tracts.length} does not match boundary count ${expected}`);
  }

  const out = {
    meta: {
      source: 'U.S. Census Bureau TIGER 2020 tract boundaries (derived from data/market/tract_boundaries_co.geojson)',
      state: 'Colorado',
      state_fips: '08',
      generated: new Date().toISOString(),
      count: tracts.length,
      note: 'Centroids are TIGER 2020 internal points when available, otherwise bbox centers. GEOID, county_fips, centroid, and bbox are all derived from the same tract boundary feature.',
      boundary_source: 'data/market/tract_boundaries_co.geojson',
      bbox_source: 'tiger2020'
    },
    tracts
  };

  fs.writeFileSync(CENTROIDS, `${JSON.stringify(out)}\n`);
  console.log(`Wrote ${path.relative(ROOT, CENTROIDS)} (${tracts.length} tracts)`);
}

main();
