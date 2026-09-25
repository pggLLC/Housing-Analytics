/**
 * Colorado county boundaries + point-in-polygon, shared by the two LIHTC
 * augmenters of the HNA ranking index (this module never touches the index).
 *
 * Both augmenters originally attributed LIHTC records to *places* only
 * (by PROJ_CTY name, and by place polygon), so all 64 county rows were
 * stamped lihtc_project_count = 0 / lihtc_in_boundary = 0 and every
 * county was scored "never funded" — Denver County reported 0 projects
 * beside Denver city's 251. Counties are measurable: this module gives
 * them a polygon test of their own.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

export const COUNTY_BOUNDARIES_REL = path.join('data', 'boundaries', 'counties_co.geojson');

/* Ray-casting point-in-polygon. `rings` is an array of rings (each an
 * array of [lng, lat] pairs); holes are handled by the even-odd rule
 * across all rings.
 */
export function pointInPolygon(lng, lat, rings) {
  let inside = false;
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersects = ((yi > lat) !== (yj > lat))
        && (lng < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi);
      if (intersects) inside = !inside;
    }
  }
  return inside;
}

export function flattenGeometry(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}

export function bboxOf(polygons) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const rings of polygons) {
    for (const ring of rings) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  return [minX, minY, maxX, maxY];
}

/* Returns [{ geoid, name, polygons, bbox }] for the 64 counties. Throws
 * rather than returning an empty index: a missing boundary file must not
 * quietly turn every county back into a 0.
 */
export async function loadCountyIndex(repoRoot) {
  const gj = JSON.parse(await fs.readFile(path.join(repoRoot, COUNTY_BOUNDARIES_REL), 'utf8'));
  const idx = [];
  for (const f of (gj.features || [])) {
    const p = f.properties || {};
    const polygons = flattenGeometry(f.geometry);
    if (!p.GEOID || !polygons.length) continue;
    idx.push({ geoid: String(p.GEOID), name: p.NAMELSAD || p.NAME, polygons, bbox: bboxOf(polygons) });
  }
  if (idx.length !== 64) {
    throw new Error(`${COUNTY_BOUNDARIES_REL}: expected 64 county polygons, found ${idx.length}`);
  }
  return idx;
}

export function containsPoint(area, lng, lat) {
  const [minX, minY, maxX, maxY] = area.bbox;
  if (lng < minX || lng > maxX || lat < minY || lat > maxY) return false;
  return area.polygons.some(rings => pointInPolygon(lng, lat, rings));
}

/* County GEOID containing (lng, lat), or null when the point is outside
 * every county or has no usable coordinates.
 */
export function countyForPoint(countyIdx, lng, lat) {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  const hit = countyIdx.find(c => containsPoint(c, lng, lat));
  return hit ? hit.geoid : null;
}
