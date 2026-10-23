#!/usr/bin/env python3
"""
scripts/market/build_walkability_layer.py

Builds the map layer data/market/walkability_co.geojson from the EPA Smart
Location Database file the PMA analysis already reads:

    data/market/epa_sld_co.json                (3,532 Colorado block groups)
    data/market/epa_sld_bg_geometry_co.geojson (their 2010 boundaries)

One point per block group, placed at the block group's area centroid, so the
map layer covers the same 3,532 block groups the analysis scores. The layer it
replaces had 1,070 tract points (179 of 1,249 2010 tracts missing, 29 of them
in Denver) and carried transit and bike scores that are not EPA fields; no
build script for it was in the repo.

The points are for display. The PMA analysis matches a site to block-group
polygons (js/data-service-portable.js), never to these points.

Fields:
    geoid             12-digit 2010 block group GEOID
    walkability_index EPA NatWalkInd, 1 (least walkable) to 20 (most)
    walk_score        NatWalkInd rescaled to 0-100: (NatWalkInd - 1) / 19 * 100

Usage:
    python3 scripts/market/build_walkability_layer.py
"""

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SLD_PATH = ROOT / "data" / "market" / "epa_sld_co.json"
GEOM_PATH = ROOT / "data" / "market" / "epa_sld_bg_geometry_co.geojson"
OUT_PATH = ROOT / "data" / "market" / "walkability_co.geojson"


def ring_centroid(ring):
    """Area centroid and absolute area of one polygon ring ([lon, lat] pairs)."""
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        cross = x0 * y1 - x1 * y0
        a += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    if abs(a) < 1e-12:
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return (sum(xs) / len(xs), sum(ys) / len(ys)), 0.0
    return (cx / (3 * a), cy / (3 * a)), abs(a) / 2


def feature_centroid(geom):
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    best = None
    for poly in polys:
        c, area = ring_centroid(poly[0])
        if best is None or area > best[1]:
            best = (c, area)
    return best[0]


def main():
    sld = json.loads(SLD_PATH.read_text())
    geom = json.loads(GEOM_PATH.read_text())
    groups = sld["blockGroups"]

    features = []
    for f in geom["features"]:
        geoid = f["properties"]["geoid"]
        row = groups.get(geoid)
        if not row or row.get("walkIndex") is None:
            continue
        idx = float(row["walkIndex"])
        lon, lat = feature_centroid(f["geometry"])
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
            "properties": {
                "geoid": geoid,
                "walkability_index": round(idx, 2),
                "walk_score": round((idx - 1) / 19 * 100),
            },
        })

    if len(features) != len(groups):
        raise SystemExit(f"walkability layer has {len(features)} block groups, EPA SLD has {len(groups)}")

    out = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "EPA Smart Location Database v3.0 (NatWalkInd), via data/market/epa_sld_co.json",
            "geometry": "Block-group area centroids from data/market/epa_sld_bg_geometry_co.geojson (2010 block groups)",
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "feature_count": len(features),
            "note": ("One display point per block group. The PMA analysis matches sites to "
                     "block-group polygons, not to these points. walk_score is NatWalkInd "
                     "(1-20) rescaled to 0-100. Rebuild via scripts/market/build_walkability_layer.py."),
        },
        "features": features,
    }
    OUT_PATH.write_text(json.dumps(out, separators=(",", ":")))
    print(f"Wrote {len(features)} block-group points -> {OUT_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
