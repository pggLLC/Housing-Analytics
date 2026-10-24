#!/usr/bin/env python3
"""
scripts/market/build_walkability_layer.py

Builds the map layer data/market/walkability_co.geojson from the EPA Smart
Location Database file the PMA analysis already reads:

    data/market/epa_sld_co.json                (3,532 Colorado block groups)
    data/market/epa_sld_bg_geometry_co.geojson (their 2010 boundaries)

One point per block group, placed inside the block group (its area centroid
when that falls inside, otherwise a point on a line through it), so the
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


def in_ring(x, y, ring):
    inside = False
    for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0:
            inside = not inside
    return inside


def in_polygon(x, y, poly):
    """Inside the outer ring and outside every hole."""
    return in_ring(x, y, poly[0]) and not any(in_ring(x, y, h) for h in poly[1:])


def scanline_point(poly, y):
    """Midpoint of the widest stretch of a horizontal line at y that lies
    inside the polygon (holes included), or None."""
    xs = []
    for ring in poly:
        for (x0, y0), (x1, y1) in zip(ring, ring[1:] + ring[:1]):
            if (y0 > y) != (y1 > y):
                xs.append((x1 - x0) * (y - y0) / (y1 - y0) + x0)
    xs.sort()
    spans = [(xs[i], xs[i + 1]) for i in range(0, len(xs) - 1, 2)]
    if not spans:
        return None
    a, b = max(spans, key=lambda s: s[1] - s[0])
    return ((a + b) / 2, y)


def feature_point(geom):
    """A point inside the block group, after 5-decimal rounding: the area
    centroid of its largest part when that falls inside, otherwise a point on
    a horizontal line through the part. A concave or holed block group's
    centroid can sit in a neighbouring one."""
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    poly = max(polys, key=lambda p: ring_centroid(p[0])[1])
    (cx, cy), _ = ring_centroid(poly[0])
    ys = [p[1] for p in poly[0]]
    lo, hi = min(ys), max(ys)
    candidates = [(cx, cy)] + [scanline_point(poly, y) for y in
                               [cy] + [lo + (hi - lo) * k / 20 for k in range(1, 20)]]
    for c in candidates:
        if c is None:
            continue
        x, y = round(c[0], 5), round(c[1], 5)
        if in_polygon(x, y, poly):
            return x, y
    raise SystemExit("no interior point found")


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
        lon, lat = feature_point(f["geometry"])
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
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
            "geometry": "A point inside each block group (area centroid when inside) from data/market/epa_sld_bg_geometry_co.geojson (2010 block groups)",
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
