#!/usr/bin/env node
/*
 * Build a lightweight tract-geometry artifact for automatic PMA display.
 *
 * Source of truth remains data/market/tract_boundaries_co.geojson. The PMA
 * display layer only needs dissolved-looking tract fills keyed by GEOID, so
 * this derivative keeps minimal properties and simplifies rings enough to
 * avoid loading the 16MB canonical boundary file for every PMA run.
 */

'use strict';

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'data', 'market', 'tract_boundaries_co.geojson');
const OUTPUT = path.join(ROOT, 'data', 'market', 'pma_tract_display_geometry.geojson');
const TOLERANCE_DEG = 0.0012;

function sqDist(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function sqSegDist(p, a, b) {
  let x = a[0];
  let y = a[1];
  let dx = b[0] - x;
  let dy = b[1] - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

function simplifyDPStep(points, first, last, sqTolerance, simplified) {
  let maxSqDist = sqTolerance;
  let index = -1;

  for (let i = first + 1; i < last; i += 1) {
    const sq = sqSegDist(points[i], points[first], points[last]);
    if (sq > maxSqDist) {
      index = i;
      maxSqDist = sq;
    }
  }

  if (index > -1) {
    if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
    simplified.push(points[index]);
    if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
  }
}

function roundCoord(coord) {
  return [
    Number(coord[0].toFixed(5)),
    Number(coord[1].toFixed(5))
  ];
}

function simplifyRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return ring || [];
  const closed = sqDist(ring[0], ring[ring.length - 1]) < 1e-14;
  const body = closed ? ring.slice(0, -1) : ring.slice();
  if (body.length < 4) return ring.map(roundCoord);

  const sqTolerance = TOLERANCE_DEG * TOLERANCE_DEG;
  const simplified = [body[0]];
  simplifyDPStep(body, 0, body.length - 1, sqTolerance, simplified);
  simplified.push(body[body.length - 1]);

  let out = simplified.map(roundCoord);
  if (out.length < 3) out = body.slice(0, 3).map(roundCoord);
  out.push(out[0]);
  return out;
}

function simplifyGeometry(geometry) {
  if (!geometry) return null;
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates.map(simplifyRing).filter((ring) => ring.length >= 4)
    };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geometry.coordinates
        .map((poly) => poly.map(simplifyRing).filter((ring) => ring.length >= 4))
        .filter((poly) => poly.length > 0)
    };
  }
  return geometry;
}

function ringArea(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i];
    const b = ring[i + 1];
    sum += (a[0] * b[1]) - (b[0] * a[1]);
  }
  return sum / 2;
}

function ringCentroid(ring) {
  const area = ringArea(ring);
  if (!area) return null;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i];
    const b = ring[i + 1];
    const cross = (a[0] * b[1]) - (b[0] * a[1]);
    cx += (a[0] + b[0]) * cross;
    cy += (a[1] + b[1]) * cross;
  }
  return [cx / (6 * area), cy / (6 * area)];
}

function pointInRing(point, ring) {
  let inside = false;
  const x = point[0];
  const y = point[1];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  if (!Array.isArray(polygon) || !polygon.length) return false;
  if (!pointInRing(point, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i += 1) {
    if (pointInRing(point, polygon[i])) return false;
  }
  return true;
}

function polygonBbox(ring) {
  return ring.reduce((acc, coord) => ({
    minX: Math.min(acc.minX, coord[0]),
    minY: Math.min(acc.minY, coord[1]),
    maxX: Math.max(acc.maxX, coord[0]),
    maxY: Math.max(acc.maxY, coord[1])
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
}

function polygonCandidates(polygon) {
  const outer = polygon && polygon[0];
  if (!Array.isArray(outer) || outer.length < 4) return [];
  const centroid = ringCentroid(outer);
  const candidates = [];
  if (centroid) candidates.push({ point: centroid, method: 'largest-ring-centroid' });

  const bbox = polygonBbox(outer);
  const steps = 8;
  for (let x = 1; x < steps; x += 1) {
    for (let y = 1; y < steps; y += 1) {
      candidates.push({
        point: [
          bbox.minX + ((bbox.maxX - bbox.minX) * x / steps),
          bbox.minY + ((bbox.maxY - bbox.minY) * y / steps)
        ],
        method: 'interior-grid'
      });
    }
  }
  return candidates;
}

function sourceInteriorPoint(props) {
  const lon = Number(props.INTPTLON);
  const lat = Number(props.INTPTLAT);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

function pointOnSurface(geometry, props) {
  if (!geometry) return null;
  const polygons = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon'
      ? geometry.coordinates
      : [];
  if (!polygons.length) return null;
  const largest = polygons
    .map((poly) => ({ poly, area: Math.abs(ringArea(poly && poly[0])) }))
    .sort((a, b) => b.area - a.area)[0].poly;

  const intpt = sourceInteriorPoint(props || {});
  if (intpt && polygons.some((poly) => pointInPolygon(intpt, poly))) {
    return { lon: Number(intpt[0].toFixed(6)), lat: Number(intpt[1].toFixed(6)), method: 'census-intpt' };
  }

  const centroid = ringCentroid(largest && largest[0]);
  const candidates = polygonCandidates(largest)
    .sort((a, b) => {
      if (!centroid) return 0;
      return sqDist(a.point, centroid) - sqDist(b.point, centroid);
    });
  const match = candidates.find((candidate) => polygons.some((poly) => pointInPolygon(candidate.point, poly)));
  const point = match ? match.point : (largest && largest[0] && largest[0][0]);
  if (!point) return null;
  return {
    lon: Number(point[0].toFixed(6)),
    lat: Number(point[1].toFixed(6)),
    method: match ? match.method : 'boundary-fallback'
  };
}

function featureGeoid(feature) {
  const p = feature && feature.properties;
  return p && (p.GEOID || p.geoid || p.GEOID20);
}

function main() {
  const sourceRaw = fs.readFileSync(SOURCE, 'utf8');
  const sourceHash = crypto.createHash('sha256').update(sourceRaw).digest('hex');
  const source = JSON.parse(sourceRaw);
  const features = (source.features || []).map((feature) => {
    const props = feature.properties || {};
    const geoid = featureGeoid(feature);
    return {
      type: 'Feature',
      properties: {
        GEOID: geoid,
        COUNTY: props.COUNTY || (geoid ? String(geoid).slice(2, 5) : null),
        NAME: props.NAME || null,
        point_on_surface: pointOnSurface(feature.geometry, props)
      },
      geometry: simplifyGeometry(feature.geometry)
    };
  }).filter((feature) => feature.properties.GEOID && feature.geometry);

  const output = {
    type: 'FeatureCollection',
    meta: {
      source: 'data/market/tract_boundaries_co.geojson',
      generated_by: 'scripts/market-analysis/build_pma_tract_display_geometry.mjs',
      source_sha256: sourceHash,
      simplify_tolerance_deg: TOLERANCE_DEG,
      point_on_surface: 'Computed at build time from canonical tract geometry; Census INTPT is used only when it falls inside the tract polygon.',
      purpose: 'Lazy-loaded display geometry for PMA included-tract fills; analysis still uses tract_centroids_co.json and ACS tract metrics.'
    },
    features
  };

  fs.writeFileSync(OUTPUT, JSON.stringify(output), 'utf8');
  const sourceSize = fs.statSync(SOURCE).size;
  const outputSize = fs.statSync(OUTPUT).size;
  console.log(`wrote ${path.relative(ROOT, OUTPUT)} (${features.length} features, ${outputSize} bytes; source ${sourceSize} bytes)`);
}

main();
