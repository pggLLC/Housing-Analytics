#!/usr/bin/env python3
"""
scripts/market/bbox_fix.py

Processes GeoJSON FeatureCollection files and computes a ``bbox`` field for
every feature that is missing one.

Background
----------
Several downstream distance calculations in the PMA scoring engine rely on
each tract feature having a ``bbox`` array ``[min_lon, min_lat, max_lon,
max_lat]``.  When TIGERweb returns polygon geometries these bounds can be
derived exactly from the coordinate rings.  When only centroid data is
available the script synthesises an approximate square bounding box using a
configurable buffer (default: 0.025°, ≈2.5 km).

Usage
-----
    # Fix all features in a GeoJSON file, overwriting in-place:
    python scripts/market/bbox_fix.py data/market/tract_boundaries_co.geojson

    # Specify a separate output file:
    python scripts/market/bbox_fix.py data/market/tract_centroids_co.json --out /tmp/out.json

    # Choose a custom buffer for centroid-only features (degrees):
    python scripts/market/bbox_fix.py data/market/tract_centroids_co.json --buffer 0.05

Library usage
-------------
    from scripts.market.bbox_fix import add_missing_bboxes
    geojson_dict = add_missing_bboxes(geojson_dict, centroid_buffer=0.025)
"""

import json
import logging
import sys
import argparse
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# ── Geometry helpers ───────────────────────────────────────────────────────────


def _bbox_from_polygon_rings(rings: list) -> Optional[list]:
    """Compute [min_lon, min_lat, max_lon, max_lat] from ArcGIS-style rings."""
    lons, lats = [], []
    for ring in rings:
        for coord in ring:
            if len(coord) >= 2:
                lons.append(coord[0])
                lats.append(coord[1])
    if not lons:
        return None
    return [min(lons), min(lats), max(lons), max(lats)]


def _bbox_from_geojson_geometry(geom: dict) -> Optional[list]:
    """Derive a [min_lon, min_lat, max_lon, max_lat] bbox from a GeoJSON geometry."""
    if not geom:
        return None
    coords = geom.get("coordinates")
    if not coords:
        return None

    lons, lats = [], []

    def _collect(coords_any):
        """Flatten arbitrarily nested coordinate arrays."""
        if not coords_any:
            return
        first = coords_any[0]
        if isinstance(first, (int, float)):
            # Leaf coordinate pair/triple [lon, lat, ?z]
            if len(coords_any) >= 2:
                lons.append(coords_any[0])
                lats.append(coords_any[1])
        else:
            for item in coords_any:
                _collect(item)

    _collect(coords)
    if not lons:
        return None
    return [min(lons), min(lats), max(lons), max(lats)]


def _bbox_from_centroid(lon: float, lat: float, buffer: float = 0.025) -> list:
    """Synthesise an approximate square bbox around a centroid point."""
    return [lon - buffer, lat - buffer, lon + buffer, lat + buffer]


# ── Main processing ────────────────────────────────────────────────────────────


def compute_feature_bbox(feature: dict, centroid_buffer: float = 0.025) -> Optional[list]:
    """Return a [min_lon, min_lat, max_lon, max_lat] bbox for *feature*.

    Strategy:
    1. Exact bounds from GeoJSON geometry (Polygon / MultiPolygon / Point / …)
    2. Approximate box from centroid ``lat``/``lon`` properties (for point-only data)
    3. None if no coordinate information is available
    """
    geom = feature.get("geometry")
    if geom:
        bbox = _bbox_from_geojson_geometry(geom)
        if bbox:
            return bbox

    # Fallback: centroid lat/lon in properties
    props = feature.get("properties") or {}
    lat = props.get("lat") or props.get("LAT") or props.get("latitude")
    lon = props.get("lon") or props.get("LON") or props.get("longitude") or props.get("lng")
    if lat is not None and lon is not None:
        try:
            return _bbox_from_centroid(float(lon), float(lat), centroid_buffer)
        except (TypeError, ValueError):
            logger.debug(
                "Could not convert centroid lat=%r / lon=%r to float for feature %s",
                lat, lon, feature.get("id", "<unknown>"),
            )

    return None


def add_missing_bboxes(geojson: dict, centroid_buffer: float = 0.025) -> dict:
    """Add ``bbox`` to every feature in *geojson* that does not already have one.

    Parameters
    ----------
    geojson : dict
        A GeoJSON FeatureCollection (modified in-place).
    centroid_buffer : float
        Half-side of the approximate bounding box (degrees) used when only a
        centroid point is available.  Default is 0.025° ≈ 2.5 km.

    Returns
    -------
    dict
        The (mutated) GeoJSON dict.  Also sets/updates the top-level
        ``bbox`` key on the FeatureCollection itself.
    """
    features = geojson.get("features", [])
    fixed = 0
    skipped = 0
    all_lons, all_lats = [], []

    for feature in features:
        # Accumulate for collection-level bbox
        existing = feature.get("bbox")
        if existing and len(existing) == 4:
            all_lons.extend([existing[0], existing[2]])
            all_lats.extend([existing[1], existing[3]])
            continue

        bbox = compute_feature_bbox(feature, centroid_buffer)
        if bbox:
            feature["bbox"] = bbox
            all_lons.extend([bbox[0], bbox[2]])
            all_lats.extend([bbox[1], bbox[3]])
            fixed += 1
        else:
            skipped += 1

    # Set / update collection-level bbox
    if all_lons:
        geojson["bbox"] = [min(all_lons), min(all_lats), max(all_lons), max(all_lats)]

    print(
        f"[bbox_fix] Added bbox to {fixed} feature(s); "
        f"{skipped} feature(s) had no usable coordinate data; "
        f"{len(features) - fixed - skipped} already had bbox.",
        flush=True,
    )
    return geojson


# ── Centroid-JSON support ──────────────────────────────────────────────────────

def fix_centroid_json(data: dict, centroid_buffer: float = 0.025) -> dict:
    """Add ``bbox`` to tract records in the centroid JSON format
    (``{"tracts": [...], ...}`` produced by ``build_public_market_data.py``).

    Each tract entry is expected to have ``lat`` and ``lon`` fields.
    """
    tracts = data.get("tracts", [])
    fixed = 0
    for tract in tracts:
        if "bbox" in tract:
            continue
        lat = tract.get("lat")
        lon = tract.get("lon")
        if lat is not None and lon is not None:
            try:
                tract["bbox"] = _bbox_from_centroid(float(lon), float(lat), centroid_buffer)
                fixed += 1
            except (TypeError, ValueError):
                logger.debug(
                    "Could not convert centroid lat=%r / lon=%r to float for tract %s",
                    lat, lon, tract.get("GEOID", "<unknown>"),
                )
    print(f"[bbox_fix] Added bbox to {fixed}/{len(tracts)} tract centroid records.", flush=True)
    return data


# ── CLI ────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Compute missing bbox fields in GeoJSON or centroid-JSON files.",
    )
    parser.add_argument("input", help="Path to the input GeoJSON or centroid JSON file.")
    parser.add_argument(
        "--out", default=None,
        help="Output file path (default: overwrite input file).",
    )
    parser.add_argument(
        "--buffer", type=float, default=0.025,
        help="Centroid buffer in degrees for point-only data (default: 0.025).",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.out) if args.out else input_path

    if not input_path.exists():
        print(f"ERROR: Input file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    print(f"[bbox_fix] Reading {input_path} …", flush=True)
    data = json.loads(input_path.read_text(encoding="utf-8"))

    if data.get("type") == "FeatureCollection":
        data = add_missing_bboxes(data, centroid_buffer=args.buffer)
    elif "tracts" in data:
        data = fix_centroid_json(data, centroid_buffer=args.buffer)
    else:
        print(
            "[bbox_fix] WARNING: Unrecognised format — attempting FeatureCollection processing.",
            flush=True,
        )
        data = add_missing_bboxes(data, centroid_buffer=args.buffer)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    print(f"[bbox_fix] Written to {output_path} ({output_path.stat().st_size:,} bytes).", flush=True)


if __name__ == "__main__":
    main()
