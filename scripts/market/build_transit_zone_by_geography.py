#!/usr/bin/env python3
"""
scripts/market/build_transit_zone_by_geography.py

For every Colorado geography the housing needs assessment covers (64
counties, 272 places, 210 CDPs), how much of it lies within the HB26-1065
screening radius of a transit stop (#1937 Phase 3).

Inputs
------
    data/amenities/transit_stops_statewide_co.geojson   stops (Phase 1)
    data/policy/thiz-map-status.json                    radius (Phase 2)
    data/co-place-boundaries.geojson                    place / CDP polygons
    data/co-county-boundaries.json                      county polygons
    data/co-place-centroids.json                        place centres
    data/hna/geo-config.json                            the 546 geographies

Output
------
    data/hna/transit-zone-by-geography.json

Method
------
Each polygon is sampled on a regular grid (~2,000 points; the count is
recorded per geography). A sample is "within" when a stop is within the
radius (straight-line). Shares are reported three ways: within the radius of
a confirmed stop (CDOT or an agency feed), within the radius of any stop
(including OpenStreetMap-only), and within half a mile of a confirmed stop
(the distance CHFA's QAP uses for TOD points, as straight-line — the QAP
itself counts walk distance). The nearest confirmed stop is measured from
the geography's centre.

A geography with no boundary gets null shares and an unavailableReason,
never 0.

Usage
-----
    python3 scripts/market/build_transit_zone_by_geography.py
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
STOPS = ROOT / "data" / "amenities" / "transit_stops_statewide_co.geojson"
MAP_STATUS = ROOT / "data" / "policy" / "thiz-map-status.json"
PLACES = ROOT / "data" / "co-place-boundaries.geojson"
COUNTIES = ROOT / "data" / "co-county-boundaries.json"
CENTROIDS = ROOT / "data" / "co-place-centroids.json"
GEO_CONFIG = ROOT / "data" / "hna" / "geo-config.json"
OUT = ROOT / "data" / "hna" / "transit-zone-by-geography.json"

EARTH_RADIUS_MI = 3958.8
QAP_TOD_MILES = 0.5      # CHFA QAP TOD distance (js/market-analysis.js HALF_MILE_M)
TARGET_SAMPLES = 2000
CELL_DEG = 0.05


def haversine_mi(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return EARTH_RADIUS_MI * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


class StopIndex:
    def __init__(self, features):
        self.cells: dict[tuple[int, int], list] = {}
        for f in features:
            lon, lat = f["geometry"]["coordinates"][:2]
            key = (math.floor(lon / CELL_DEG), math.floor(lat / CELL_DEG))
            self.cells.setdefault(key, []).append((lon, lat, f["properties"]))

    def nearest(self, lat, lon, confirmed_only, max_rings=80):
        best, best_d = None, math.inf
        cx, cy = math.floor(lon / CELL_DEG), math.floor(lat / CELL_DEG)
        cell_mi = CELL_DEG * 69.0 * math.cos(math.radians(min(abs(lat), 80)))
        for r in range(max_rings + 1):
            for dx in range(-r, r + 1):
                for dy in range(-r, r + 1):
                    if max(abs(dx), abs(dy)) != r:
                        continue
                    for slon, slat, props in self.cells.get((cx + dx, cy + dy), ()):
                        if confirmed_only and props.get("reliability") == "unconfirmed":
                            continue
                        d = haversine_mi(lat, lon, slat, slon)
                        if d < best_d:
                            best, best_d = props, d
            if best is not None and best_d < (r - 1) * cell_mi:
                break
        return best, best_d

    def any_within(self, lat, lon, miles, confirmed_only):
        cx, cy = math.floor(lon / CELL_DEG), math.floor(lat / CELL_DEG)
        span = int(math.ceil(miles / (CELL_DEG * 69.0 * math.cos(math.radians(min(abs(lat), 80)))))) + 1
        for dx in range(-span, span + 1):
            for dy in range(-span, span + 1):
                for slon, slat, props in self.cells.get((cx + dx, cy + dy), ()):
                    if confirmed_only and props.get("reliability") == "unconfirmed":
                        continue
                    if haversine_mi(lat, lon, slat, slon) <= miles:
                        return True
        return False


def _in_ring(lon, lat, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def polygons_of(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    return []


def contains(polys, lon, lat):
    for poly in polys:
        if _in_ring(lon, lat, poly[0]) and not any(_in_ring(lon, lat, h) for h in poly[1:]):
            return True
    return False


def sample_points(polys):
    xs = [p[0] for poly in polys for p in poly[0]]
    ys = [p[1] for poly in polys for p in poly[0]]
    minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
    step = math.sqrt(max((maxx - minx) * (maxy - miny), 1e-10) / TARGET_SAMPLES)
    pts = []
    y = miny + step / 2
    while y < maxy:
        x = minx + step / 2
        while x < maxx:
            if contains(polys, x, y):
                pts.append((x, y))
            x += step
        y += step
    if not pts:  # sliver: fall back to the ring vertices' mean
        pts = [(sum(xs) / len(xs), sum(ys) / len(ys))]
    return pts


def summarize(polys, centre, idx, radius):
    pts = sample_points(polys)
    n = len(pts)
    conf = sum(1 for lon, lat in pts if idx.any_within(lat, lon, radius, True))
    anyk = sum(1 for lon, lat in pts if idx.any_within(lat, lon, radius, False))
    half = sum(1 for lon, lat in pts if idx.any_within(lat, lon, QAP_TOD_MILES, True))
    stops_inside = 0
    for cell in idx.cells.values():
        for slon, slat, props in cell:
            if props.get("reliability") != "unconfirmed" and contains(polys, slon, slat):
                stops_inside += 1
    near, d = idx.nearest(centre[1], centre[0], True)
    return {
        "share_within_radius_confirmed": round(conf / n, 4),
        "share_within_radius_any": round(anyk / n, 4),
        "share_within_half_mile_confirmed": round(half / n, 4),
        "confirmed_stops_inside": stops_inside,
        "nearest_confirmed_stop": None if near is None else {
            "name": near.get("name") or None,
            "agency": near.get("agency"),
            "distance_miles": round(d, 2),
        },
        "samples": n,
        "unavailableReason": None,
    }


def main() -> int:
    stops = json.loads(STOPS.read_text())
    status = json.loads(MAP_STATUS.read_text())
    radius = status["zone_radius_miles"]
    idx = StopIndex(stops["features"])

    places = {f["properties"]["geoid"]: f for f in json.loads(PLACES.read_text())["features"]}
    counties = {str(f["properties"]["GEOID"]).zfill(5): f for f in json.loads(COUNTIES.read_text())["features"]}
    centroids = json.loads(CENTROIDS.read_text())["byGeoid"]
    geo = json.loads(GEO_CONFIG.read_text())

    out = {}
    targets = ([(c["geoid"], c["label"], "county") for c in geo["counties"]] +
               [(p["geoid"], p["label"], "place") for p in geo["places"]] +
               [(p["geoid"], p["label"], "cdp") for p in geo["cdps"]])
    for geoid, label, kind in targets:
        feat = counties.get(geoid) if kind == "county" else places.get(geoid)
        if feat is None:
            out[geoid] = {"name": label, "type": kind, "share_within_radius_confirmed": None,
                          "share_within_radius_any": None, "share_within_half_mile_confirmed": None,
                          "confirmed_stops_inside": None, "nearest_confirmed_stop": None, "samples": 0,
                          "unavailableReason": "No boundary for this geography, so its area near transit could not be measured."}
            continue
        polys = polygons_of(feat["geometry"])
        if kind != "county" and geoid in centroids:
            centre = (centroids[geoid]["lng"], centroids[geoid]["lat"])
        else:
            ring = max((poly[0] for poly in polys), key=len)
            centre = (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
        rec = summarize(polys, centre, idx, radius)
        out[geoid] = {"name": label, "type": kind, **rec}

    doc = {
        "meta": {
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "source": "scripts/market/build_transit_zone_by_geography.py (#1937)",
            "stops_file": str(STOPS.relative_to(ROOT)),
            "stops_generated": (stops.get("meta") or {}).get("generated"),
            "radius_miles": radius,
            "radius_source": str(MAP_STATUS.relative_to(ROOT)),
            "qap_tod_miles": QAP_TOD_MILES,
            "method": ("Share of a regular grid of points inside each boundary (about 2,000 per "
                       "geography) lying within the radius of a stop, straight-line. 'confirmed' "
                       "means CDOT or an agency feed publishes the stop; 'any' also counts "
                       "OpenStreetMap-only stops. Nearest stop is measured from the geography's centre."),
            "geography_count": len(out),
        },
        "geographies": out,
    }
    OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(out)} geographies → {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
