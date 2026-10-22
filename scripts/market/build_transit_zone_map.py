#!/usr/bin/env python3
"""
scripts/market/build_transit_zone_map.py

The map layer behind the needs assessment's "Potential location: transit
zone (HB26-1065)" panel: every confirmed public transit stop, and the area
within the screening radius of any of them merged into one shape.

Inputs
------
    data/amenities/transit_stops_statewide_co.geojson   stops
    data/policy/thiz-map-status.json                    radius (zone_radius_miles)

Output
------
    data/hna/transit-zone-map.json
        meta    radius, stop file and its date, counts, method
        agencies  agency names; stops point into this list by index
        stops   [lon, lat, agency_index] for each counted stop
        zone    GeoJSON MultiPolygon: the merged (dissolved) radius around
                every counted stop

Which stops count is scripts/lib/transit_stops.py counts_as_confirmed, the
rule the zone shares in data/hna/transit-zone-by-geography.json use, so the
shaded area and the panel's share figures describe the same stops.

Method
------
Stops are projected to UTM zone 13N (EPSG:26913), each buffered by the radius,
the buffers merged with a union, the result simplified by SIMPLIFY_M metres
and projected back. Across Colorado UTM 13N's scale error is under 0.15%, so a
2-mile buffer is within about 15 feet of the straight-line distance
transit-zone-by-geography.json measures. Coordinates are rounded to 4
decimals (about 10 m).

The file carries no build timestamp of its own: it changes only when the
stops or the radius change, so a weekly run that finds the same stops writes
the same bytes.

Usage
-----
    python3 scripts/market/build_transit_zone_map.py
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import MultiPolygon, Point, mapping
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scripts" / "lib"))
import transit_stops  # noqa: E402  (the one statewide stop-selection rule)

STOPS = ROOT / "data" / "amenities" / "transit_stops_statewide_co.geojson"
MAP_STATUS = ROOT / "data" / "policy" / "thiz-map-status.json"
OUT = ROOT / "data" / "hna" / "transit-zone-map.json"

METRES_PER_MILE = 1609.344
SIMPLIFY_M = 25
DECIMALS = 4


def _round(coords):
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], DECIMALS), round(coords[1], DECIMALS)]
    return [_round(c) for c in coords]


def build() -> dict:
    status = json.loads(MAP_STATUS.read_text())
    radius = status.get("zone_radius_miles")
    if isinstance(radius, bool) or not isinstance(radius, (int, float)) or not radius > 0:
        raise ValueError(f"{MAP_STATUS.relative_to(ROOT)}: zone_radius_miles is missing or not a positive number")

    stops_doc = json.loads(STOPS.read_text())
    features = stops_doc.get("features") or []
    if not features:
        raise ValueError(f"{STOPS.relative_to(ROOT)} has no stops; refusing to write an empty zone")

    agencies: list[str] = []
    agency_ix: dict[str, int] = {}
    seen = set()
    stops = []
    for f in features:
        props = f.get("properties") or {}
        if not transit_stops.counts_as_confirmed(props):
            continue
        coords = (f.get("geometry") or {}).get("coordinates") or []
        if len(coords) < 2:
            continue
        lon, lat = round(coords[0], DECIMALS), round(coords[1], DECIMALS)
        agency = props.get("agency") or "Agency not listed"
        if agency not in agency_ix:
            agency_ix[agency] = len(agencies)
            agencies.append(agency)
        key = (lon, lat, agency_ix[agency])
        if key in seen:
            continue
        seen.add(key)
        stops.append([lon, lat, agency_ix[agency]])
    stops.sort()

    fwd = Transformer.from_crs("EPSG:4326", "EPSG:26913", always_xy=True).transform
    inv = Transformer.from_crs("EPSG:26913", "EPSG:4326", always_xy=True).transform
    r_m = radius * METRES_PER_MILE
    circles = [Point(fwd(lon, lat)).buffer(r_m, quad_segs=16) for lon, lat, _ in stops]
    merged = unary_union(circles).simplify(SIMPLIFY_M, preserve_topology=True)
    merged = shapely.transform(merged, lambda xy: np.column_stack(inv(xy[:, 0], xy[:, 1])))
    if merged.geom_type == "Polygon":
        merged = MultiPolygon([merged])
    zone = mapping(merged)
    zone = {"type": "MultiPolygon", "coordinates": _round(zone["coordinates"])}

    fingerprint = hashlib.sha256(json.dumps(stops_doc["features"], sort_keys=True).encode()).hexdigest()[:16]
    meta = {
        "schema": "transit-zone-map/1",
        "source": "scripts/market/build_transit_zone_map.py",
        "stops_file": str(STOPS.relative_to(ROOT)),
        "stops_generated": (stops_doc.get("meta") or {}).get("generated"),
        "stops_fingerprint": fingerprint,
        "stops_source": (stops_doc.get("meta") or {}).get("source"),
        "radius_miles": radius,
        "radius_source": str(MAP_STATUS.relative_to(ROOT)),
        "stop_count": len(stops),
        "zone_polygons": len(merged.geoms),
        "method": (f"Each counted stop is buffered by {radius} miles (straight-line, UTM zone 13N) and the buffers are "
                   f"merged into one shape, simplified by {SIMPLIFY_M} m. Counted stops are confirmed (CDOT or an "
                   "agency schedule feed), public and fixed-route: private airport/hotel shuttles, on-demand "
                   "(GTFS-Flex) stops and OpenStreetMap-only stops are left out (scripts/lib/transit_stops.py)."),
    }
    return {"meta": meta, "agencies": agencies, "stops": stops, "zone": zone}


def main() -> int:
    out = build()
    text = json.dumps(out, separators=(",", ":")) + "\n"
    if OUT.exists() and OUT.read_text() == text:
        print(f"{OUT.relative_to(ROOT)}: unchanged ({out['meta']['stop_count']} stops)")
        return 0
    OUT.write_text(text)
    print(f"{OUT.relative_to(ROOT)}: {out['meta']['stop_count']} stops, "
          f"{out['meta']['zone_polygons']} zone polygons, {len(text) // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
