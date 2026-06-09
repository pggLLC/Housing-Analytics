#!/usr/bin/env node
/**
 * F191 — Augment ranking-index.json with LIHTC counts via point-in-
 * polygon attribution (closes future-work item 4: CDP coverage).
 *
 * The existing recency augmentation script (scripts/augment_ranking_
 * index_recency.mjs) matches LIHTC records to jurisdictions by
 * normalized city name. This works for cities + towns where the LIHTC
 * record's PROJ_CTY matches a place's `name` field. It FAILS for CDPs
 * (Census Designated Places — unincorporated areas) because LIHTC
 * records list a postal city (e.g. "Aurora"), not the CDP name (e.g.
 * "Acres Green CDP").
 *
 * F191 fixes that by doing point-in-polygon against
 * data/co-place-boundaries.geojson. Each LIHTC record's lat/lng is
 * tested against every place polygon; the containing place gets +1 to
 * its lihtc_in_boundary count.
 *
 * Writes:
 *   - rankings[*].metrics.lihtc_in_boundary  (geographic count)
 *   - rankings[*].metrics.lihtc_in_boundary_year (max year of contained projects)
 *   - metric descriptors added
 *
 * The original `lihtc_project_count` (city-name-matched) stays in
 * place; the new field supplements it. Consumers can pick whichever
 * fits the semantic — city-name matching is more conservative for
 * cities (counts only properties listing that city as PROJ_CTY); the
 * geometric count is more accurate for CDPs (counts properties whose
 * coordinates fall inside the CDP boundary).
 *
 * Idempotent.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '..');

const RI_PATH     = path.join(REPO_ROOT, 'data', 'hna', 'ranking-index.json');
const CHFA_PATH   = path.join(REPO_ROOT, 'data', 'affordable-housing', 'lihtc', 'chfa-properties.json');
const PLACES_PATH = path.join(REPO_ROOT, 'data', 'co-place-boundaries.geojson');

/* Ray-casting point-in-polygon. Accepts a polygon as an array of
 * rings (each ring is an array of [lng, lat] pairs). Handles holes
 * via even-odd rule across all rings.
 */
function _pointInPolygon(lng, lat, rings) {
  let inside = false;
  for (const ring of rings) {
    let n = ring.length;
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

function _flattenGeometry(geom) {
  // Returns array of polygons; each polygon is array of rings.
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}

function _bbox(rings) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return [minX, minY, maxX, maxY];
}

async function main() {
  const [riText, chfaText, placesText] = await Promise.all([
    fs.readFile(RI_PATH, 'utf8'),
    fs.readFile(CHFA_PATH, 'utf8'),
    fs.readFile(PLACES_PATH, 'utf8'),
  ]);
  const ri = JSON.parse(riText);
  const chfa = JSON.parse(chfaText);
  const places = JSON.parse(placesText);

  // Pre-process each place into { geoid, polygons, bbox }.
  const placeIdx = [];
  for (const f of (places.features || [])) {
    const p = f.properties || {};
    const polys = _flattenGeometry(f.geometry);
    if (!polys.length) continue;
    // Combine bboxes from all polys
    let bb = null;
    for (const poly of polys) {
      const polyBb = _bbox(poly);
      if (!bb) bb = polyBb.slice();
      else {
        if (polyBb[0] < bb[0]) bb[0] = polyBb[0];
        if (polyBb[1] < bb[1]) bb[1] = polyBb[1];
        if (polyBb[2] > bb[2]) bb[2] = polyBb[2];
        if (polyBb[3] > bb[3]) bb[3] = polyBb[3];
      }
    }
    placeIdx.push({ geoid: p.geoid, name: p.name, polygons: polys, bbox: bb });
  }

  // For each LIHTC record, find containing place(s). bbox-prune first.
  const placeAgg = new Map();  // geoid → { count, latestYear }
  let lihtcWithPlace = 0;
  let lihtcWithoutPlace = 0;
  for (const f of (chfa.features || [])) {
    const c = f.geometry && f.geometry.coordinates;
    if (!c) continue;
    const [lng, lat] = c;
    const p = f.properties || {};
    const yr = Math.max(
      parseInt(p.AwardYear || 0, 10) || 0,
      parseInt(p.YR_ALLOC || 0, 10) || 0,
      parseInt(p.YR_PIS || 0, 10) || 0,
    );
    let matched = false;
    for (const place of placeIdx) {
      const [minX, minY, maxX, maxY] = place.bbox;
      if (lng < minX || lng > maxX || lat < minY || lat > maxY) continue;
      // bbox passes — do the actual polygon test
      let inside = false;
      for (const poly of place.polygons) {
        if (_pointInPolygon(lng, lat, poly)) { inside = true; break; }
      }
      if (!inside) continue;
      const agg = placeAgg.get(place.geoid) || { count: 0, latestYear: null };
      agg.count++;
      if (yr > 0 && (agg.latestYear == null || yr > agg.latestYear)) agg.latestYear = yr;
      placeAgg.set(place.geoid, agg);
      matched = true;
      // Don't break — a point can fall inside multiple overlapping
      // boundaries (city + CDP); count it for each.
    }
    if (matched) lihtcWithPlace++;
    else lihtcWithoutPlace++;
  }

  // Stamp ranking-index entries.
  let stamped = 0;
  for (const e of (ri.rankings || [])) {
    const agg = placeAgg.get(e.geoid);
    e.metrics = e.metrics || {};
    e.metrics.lihtc_in_boundary = agg ? agg.count : 0;
    e.metrics.lihtc_in_boundary_year = agg ? agg.latestYear : null;
    if (agg) stamped++;
  }

  // Add metric descriptors.
  const newMetrics = [
    { id: 'lihtc_in_boundary', label: 'LIHTC inside boundary (geographic)', description: 'Count of CHFA LIHTC project coordinates falling inside this place\'s boundary (point-in-polygon). Catches LIHTC inside CDPs that the city-name match misses; for cities the count is usually identical to lihtc_project_count.', unit: 'count', sortOrder: 'descending' },
    { id: 'lihtc_in_boundary_year', label: 'Latest LIHTC year inside boundary', description: 'Max of AwardYear/YR_ALLOC/YR_PIS among LIHTC projects inside the boundary.', unit: 'year', sortOrder: 'descending' },
  ];
  ri.metrics = ri.metrics || [];
  const haveIds = new Set(ri.metrics.map(m => m.id));
  for (const m of newMetrics) {
    if (!haveIds.has(m.id)) ri.metrics.push(m);
  }

  ri.metadata = ri.metadata || {};
  ri.metadata.lihtcGeometryAugmentedAt = '2026-06-09';
  ri.metadata.lihtcGeometryAugmentedBy = 'scripts/augment_lihtc_by_geometry.mjs';

  await fs.writeFile(RI_PATH, JSON.stringify(ri, null, 2) + '\n', 'utf8');

  console.log('F191 — geographic LIHTC attribution');
  console.log('  · LIHTC records tested:                 ' + (chfa.features || []).length);
  console.log('  · matched to ≥1 place boundary:         ' + lihtcWithPlace);
  console.log('  · outside every place boundary:         ' + lihtcWithoutPlace + ' (likely outside place geographies — county-level unincorporated)');
  console.log('  · places with ≥1 LIHTC inside boundary: ' + placeAgg.size);
  console.log('  · ranking-index entries stamped:        ' + stamped);
}

main().catch(e => { console.error(e); process.exit(1); });
