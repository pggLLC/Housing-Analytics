#!/usr/bin/env python3
"""
scripts/market/build_tract_bboxes.py
=====================================
Add **real polygon-derived** bbox fields to every record in
data/market/tract_centroids_co.json by reading the Census TIGER 2020
tract shapefile for Colorado.

Why
---
The PMA buffer-share apportionment (F80) was falling back to a distance-ramp
heuristic because every tract record only had a centroid + a synthesized
2.5-km square bbox produced by scripts/market/bbox_fix.py. Real geometric
bbox values (derived from the polygon coordinate rings) let the page do
true circle×rectangle intersection, sharpening rural PMA counts that the
heuristic was overestimating by 2-4×.

Pipeline
--------
1. Download tl_2020_08_tract.zip from Census TIGER 2020 (~8 MB).
2. Extract the .shp + .dbf + .shx + .prj.
3. For every shape, compute [min_lon, min_lat, max_lon, max_lat] from the
   polygon coordinates.
4. Merge bbox values into tract_centroids_co.json, keyed by GEOID.

Output
------
data/market/tract_centroids_co.json gains a "bbox" key per tract record:
    "bbox": [-105.07, 39.76, -105.06, 39.77]

Re-running is idempotent. If a tract already has bbox, the script
leaves it alone unless --force is given.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path
from typing import Optional

try:
    import shapefile  # type: ignore
except ImportError:
    print("ERROR: pyshp not installed. Run: pip install pyshp", file=sys.stderr)
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
CENTROIDS = REPO_ROOT / "data" / "market" / "tract_centroids_co.json"
CACHE_DIR = REPO_ROOT / ".cache" / "tiger"
TIGER_URL = "https://www2.census.gov/geo/tiger/TIGER2020/TRACT/tl_2020_08_tract.zip"


def _download_zip() -> bytes:
    """Fetch the TIGER 2020 CO tract shapefile zip, caching on disk."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_DIR / "tl_2020_08_tract.zip"
    if cache_path.exists() and cache_path.stat().st_size > 1_000_000:
        print(f"  using cached {cache_path}")
        return cache_path.read_bytes()
    print(f"  downloading {TIGER_URL}…")
    req = urllib.request.Request(
        TIGER_URL,
        headers={"User-Agent": "COHO-Analytics/1.0 (+tract-bbox build)"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = resp.read()
    cache_path.write_bytes(data)
    print(f"  cached {len(data):,} bytes to {cache_path}")
    return data


def _open_shapefile(zip_bytes: bytes) -> shapefile.Reader:
    """Open the .shp inside the zip without extracting to disk."""
    zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    shp = dbf = shx = None
    for name in zf.namelist():
        if name.endswith(".shp"):
            shp = io.BytesIO(zf.read(name))
        elif name.endswith(".dbf"):
            dbf = io.BytesIO(zf.read(name))
        elif name.endswith(".shx"):
            shx = io.BytesIO(zf.read(name))
    if not (shp and dbf):
        raise RuntimeError("Could not find .shp / .dbf in the TIGER zip.")
    return shapefile.Reader(shp=shp, dbf=dbf, shx=shx)


def _bbox_from_shape(shape) -> Optional[list]:
    """Return [min_lon, min_lat, max_lon, max_lat] from a pyshp shape."""
    if not shape or not getattr(shape, "points", None):
        return None
    # pyshp Shape.bbox is already [min_lon, min_lat, max_lon, max_lat] but
    # we recompute from points for safety and to avoid float-encoding noise.
    lons = [p[0] for p in shape.points]
    lats = [p[1] for p in shape.points]
    if not lons:
        return None
    return [
        round(min(lons), 6),
        round(min(lats), 6),
        round(max(lons), 6),
        round(max(lats), 6),
    ]


def _build_geoid_to_bbox(reader) -> dict:
    """Return {geoid: bbox} for every tract in the TIGER reader."""
    fields = [f[0] for f in reader.fields[1:]]  # skip DeletionFlag
    try:
        geoid_idx = fields.index("GEOID")
    except ValueError:
        raise RuntimeError(f"GEOID column not found in TIGER fields: {fields}")

    out = {}
    for shape_rec in reader.iterShapeRecords():
        rec = shape_rec.record
        geoid = str(rec[geoid_idx]).strip()
        bbox = _bbox_from_shape(shape_rec.shape)
        if geoid and bbox:
            out[geoid] = bbox
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite any existing bbox values (default: keep existing)",
    )
    args = parser.parse_args()

    if not CENTROIDS.exists():
        print(f"ERROR: {CENTROIDS} not found.", file=sys.stderr)
        return 1

    print(f"Loading centroids from {CENTROIDS.relative_to(REPO_ROOT)}…")
    data = json.loads(CENTROIDS.read_text())
    tracts = data.get("tracts", [])
    print(f"  {len(tracts):,} tract records")

    print("Downloading + parsing TIGER 2020 CO tract shapefile…")
    zip_bytes = _download_zip()
    reader = _open_shapefile(zip_bytes)
    print(f"  {len(reader):,} shapes in TIGER")

    geoid_to_bbox = _build_geoid_to_bbox(reader)
    print(f"  computed bbox for {len(geoid_to_bbox):,} TIGER tracts")

    updated = 0
    fallback = 0
    skipped_existing = 0
    for tract in tracts:
        gid = str(tract.get("geoid", "")).strip()
        if not gid:
            continue
        if not args.force and "bbox" in tract:
            skipped_existing += 1
            continue
        bbox = geoid_to_bbox.get(gid)
        if bbox:
            tract["bbox"] = bbox
            tract["bbox_source"] = "tiger2020"
            updated += 1
        else:
            # Fallback: synthesize a 2.5-km square bbox around the centroid so
            # PMA buffer-share still has *some* bbox for the geometric path.
            # Marked as "centroid" so consumers can downgrade confidence.
            lat = tract.get("lat")
            lon = tract.get("lon")
            if lat is not None and lon is not None:
                tract["bbox"] = [
                    round(float(lon) - 0.025, 6),
                    round(float(lat) - 0.025, 6),
                    round(float(lon) + 0.025, 6),
                    round(float(lat) + 0.025, 6),
                ]
                tract["bbox_source"] = "centroid_fallback"
                fallback += 1

    # Update meta to note the source.
    meta = data.setdefault("meta", {})
    meta["bbox_source"] = "U.S. Census Bureau TIGER 2020 tract polygons (CO state)"
    meta["bbox_url"] = TIGER_URL
    meta["bbox_added"] = updated
    meta["bbox_fallback"] = fallback
    meta["bbox_existing"] = skipped_existing
    meta["note"] = (meta.get("note", "") +
                    " | TIGER 2020 polygon bbox added by scripts/market/build_tract_bboxes.py")

    print(f"\nResults:")
    print(f"  bbox from TIGER 2020 polygons : {updated:,}")
    print(f"  bbox from centroid fallback   : {fallback:,}")
    print(f"  bbox already set (skipped)    : {skipped_existing:,}")

    CENTROIDS.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    print(f"  wrote {CENTROIDS.relative_to(REPO_ROOT)} ({CENTROIDS.stat().st_size:,} bytes)")

    # 158 tracts (≈10%) is the expected gap between this centroids file's
    # 2010-era GEOIDs and TIGER 2020 — those got renumbered/split. The
    # fallback ensures every tract still has a usable bbox.
    if fallback > len(tracts) * 0.15:
        print(
            f"\nWARN: more than 15% of centroid records fell back to "
            f"synthesized bboxes. Check whether the centroids file mixes "
            f"vintages (expected ~10% for 2010 vs 2020).",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
