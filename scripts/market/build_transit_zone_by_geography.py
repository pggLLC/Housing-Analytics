#!/usr/bin/env python3
"""
scripts/market/build_transit_zone_by_geography.py

For every Colorado geography the housing needs assessment covers (64
counties, 272 places, 210 CDPs), how much of it lies within the HB26-1065
screening radius of a transit stop (#1937 Phase 3).

Inputs
------
    data/amenities/transit_stops_statewide_co.geojson   stops (Phase 1)
    data/policy/thiz-map-status.json                    radius (Phase 2), QAP TOD distance
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


def _qap_tod_miles() -> float:
    """The CHFA QAP transit-oriented (TOD) distance, from the zone-map status
    file (qap_tod_distance, beside zone_radius_miles) — the one value every
    page reads through js/transit-zone.js qapTodDistance (#1961). This builder
    measures straight-line distance, so it refuses a status file that says the
    measure is anything else rather than publish shares under the wrong name."""
    q = json.loads(MAP_STATUS.read_text()).get("qap_tod_distance") or {}
    miles = q.get("miles")
    if isinstance(miles, bool) or not isinstance(miles, (int, float)) or not miles > 0:
        raise ValueError(f"{MAP_STATUS.relative_to(ROOT)}: qap_tod_distance.miles is missing or not a positive number")
    if q.get("method") != "straight_line":
        raise ValueError(f"{MAP_STATUS.relative_to(ROOT)}: qap_tod_distance.method is {q.get('method')!r}; "
                         "this builder measures straight-line distance only")
    return miles


QAP_TOD_MILES = _qap_tod_miles()
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
            # Private airport/hotel shuttle pickups are mapped but are not
            # public transit: they never count toward the screen (same rule
            # as js/transit-zone.js and the TOD check).
            if (f.get("properties") or {}).get("operator") == "private_shuttle":
                continue
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


def _seg_dist_mi(plon, plat, a, b):
    """Distance in miles from a point to segment a-b (local equirectangular)."""
    kx = 69.172 * math.cos(math.radians(plat))
    ky = 69.0
    ax, ay = (a[0] - plon) * kx, (a[1] - plat) * ky
    bx, by = (b[0] - plon) * kx, (b[1] - plat) * ky
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L2))
    return math.hypot(ax + t * dx, ay + t * dy)


BOUNDARY_SEARCH_MI = 10.0


def min_distance_to_polygon_mi(polys, idx, confirmed_only=True):
    """Exact straight-line distance from the polygon to the nearest stop:
    0 when a stop is inside, else the least stop-to-edge distance. Used to
    confirm a sampled zero, which a grid alone cannot prove. Only stops
    within BOUNDARY_SEARCH_MI of the boundary's box are measured; None means
    none is that close (so the zero is certain)."""
    xs = [p[0] for poly in polys for p in poly[0]]
    ys = [p[1] for poly in polys for p in poly[0]]
    pad_lat = BOUNDARY_SEARCH_MI / 69.0
    pad_lon = BOUNDARY_SEARCH_MI / (69.172 * math.cos(math.radians(max(abs(min(ys)), abs(max(ys))))))
    minx, maxx, miny, maxy = min(xs) - pad_lon, max(xs) + pad_lon, min(ys) - pad_lat, max(ys) + pad_lat
    best = math.inf
    for cell in idx.cells.values():
        for slon, slat, props in cell:
            if not (minx <= slon <= maxx and miny <= slat <= maxy):
                continue
            if confirmed_only and props.get("reliability") == "unconfirmed":
                continue
            if contains(polys, slon, slat):
                return 0.0
            for poly in polys:
                for ring in poly:
                    for i in range(len(ring) - 1):
                        d = _seg_dist_mi(slon, slat, ring[i], ring[i + 1])
                        if d < best:
                            best = d
    return best if best <= BOUNDARY_SEARCH_MI else None


def representative_point(polys, samples):
    """Area-weighted centroid of the largest polygon when it lies inside the
    geography; otherwise the sample point nearest to it. A plain mean of ring
    vertices can fall outside (Adams and Boulder counties did)."""
    def area_centroid(ring):
        a = cx = cy = 0.0
        for i in range(len(ring) - 1):
            x0, y0 = ring[i][0], ring[i][1]
            x1, y1 = ring[i + 1][0], ring[i + 1][1]
            cross = x0 * y1 - x1 * y0
            a += cross
            cx += (x0 + x1) * cross
            cy += (y0 + y1) * cross
        if a == 0:
            return None, 0.0
        return (cx / (3 * a), cy / (3 * a)), abs(a) / 2

    best = None
    for poly in polys:
        c, area = area_centroid(poly[0])
        if c and (best is None or area > best[1]):
            best = (c, area)
    if best and contains(polys, best[0][0], best[0][1]):
        return best[0]
    target = best[0] if best else samples[0]
    return min(samples, key=lambda p: (p[0] - target[0]) ** 2 + (p[1] - target[1]) ** 2)


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
    if not pts:  # sliver: no grid point landed inside
        pts = [point_inside(polys)]
    return pts, step


def point_inside(polys):
    """A point guaranteed to lie inside the geography (#1971). The mean of
    the ring vertices can fall outside a crescent or a multi-part sliver, so
    instead take the largest ring's horizontal scanline through the middle of
    its vertical extent, and return the midpoint of the widest span the ring
    (less its holes) covers on that line. Spans come from the even-odd rule,
    so each midpoint is inside by construction; contains() confirms it."""
    best = None
    for poly in polys:
        ys = [p[1] for p in poly[0]]
        lo, hi = min(ys), max(ys)
        for frac in (0.5, 0.25, 0.75, 0.125, 0.375, 0.625, 0.875):
            y = lo + (hi - lo) * frac
            xs = []
            for ring in poly:
                for i in range(len(ring) - 1):
                    (x0, y0), (x1, y1) = ring[i][:2], ring[i + 1][:2]
                    if (y0 > y) != (y1 > y):
                        xs.append(x0 + (y - y0) * (x1 - x0) / (y1 - y0))
            xs.sort()
            for a, b in zip(xs[0::2], xs[1::2]):
                m = ((a + b) / 2, y)
                if b > a and contains(polys, m[0], m[1]) and (best is None or b - a > best[0]):
                    best = (b - a, m)
            if best:
                break
    if best is None:   # degenerate ring with no area: nothing is inside
        ring = polys[0][0]
        return (ring[0][0], ring[0][1])
    return best[1]


# ── Settling the absolutes (#1971) ─────────────────────────────────────────
# A grid share of exactly 0 or 1 is only what the samples saw: an edge strip
# near a stop, or a corner out of reach, can fall between grid points. Only a
# proof may publish an absolute. Otherwise the builder publishes a measured
# estimate that stays off the absolute (so the shared label rounds it to
# "<1%" / ">99%", never "0%" / "100%") and records why.

FULL_PROOF_DEPTH = 5          # a failing grid cell is split in four up to this depth
ABSOLUTE_FLOOR = 0.0001       # smallest share that is still published as "some"


def _kx(lat):
    return 69.172 * math.cos(math.radians(lat))


def _cell_halfdiag_mi(lat, w):
    return 0.5 * math.hypot(w * _kx(lat), w * 69.0)


def _segments(polys):
    for poly in polys:
        for ring in poly:
            for i in range(len(ring) - 1):
                yield ring[i], ring[i + 1]


def _dist_to_boundary_mi(polys, lon, lat):
    return min(_seg_dist_mi(lon, lat, a, b) for a, b in _segments(polys))


def max_vertex_distance_mi(polys, idx, confirmed_only=True):
    """Largest distance from any boundary vertex to its nearest stop. Above
    the radius it disproves full coverage outright: that vertex is in the
    geography and out of reach."""
    worst = 0.0
    for poly in polys:
        for lon, lat in (p[:2] for p in poly[0]):
            _, d = idx.nearest(lat, lon, confirmed_only)
            worst = max(worst, d)
    return worst


def full_coverage(polys, pts, step, idx, miles, confirmed_only):
    """Prove every point of the geography is within `miles` of a stop.

    Cover the geography with the sample grid's cells: every cell whose
    centre is inside (the samples), plus every cell within one cell of a
    boundary point densified to half a cell. A cell that meets the geography
    either has its centre inside or holds a piece of the boundary, so this
    covers all of it. A cell is proven when its centre is within `miles`
    less the cell's half-diagonal of a stop (triangle inequality); a cell
    that is not is split in four, down to FULL_PROOF_DEPTH, and a child that
    provably misses the geography is dropped. Returns the leaf cells that
    could not be proven: empty means full coverage is proven."""
    xs = [p[0] for poly in polys for p in poly[0]]
    ys = [p[1] for poly in polys for p in poly[0]]
    minx, miny = min(xs), min(ys)
    cells = {(round((x - minx) / step - 0.5), round((y - miny) / step - 0.5)) for x, y in pts}
    for a, b in _segments(polys):
        k = max(1, math.ceil(max(abs(b[0] - a[0]), abs(b[1] - a[1])) / (step / 2)))
        for t in range(k + 1):
            bx, by = a[0] + (b[0] - a[0]) * t / k, a[1] + (b[1] - a[1]) * t / k
            i, j = math.floor((bx - minx) / step), math.floor((by - miny) / step)
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    cells.add((i + di, j + dj))
    stack = [(minx + (i + 0.5) * step, miny + (j + 0.5) * step, step, 0) for i, j in cells]
    failing = []
    while stack:
        cx, cy, w, depth = stack.pop()
        hd = _cell_halfdiag_mi(cy, w)
        if depth > 0 and not contains(polys, cx, cy) and _dist_to_boundary_mi(polys, cx, cy) > hd:
            continue                        # this cell misses the geography
        if miles > hd and idx.any_within(cy, cx, miles - hd, confirmed_only):
            continue                        # the whole cell is within reach
        if depth >= FULL_PROOF_DEPTH:
            failing.append((cx, cy, w))
            continue
        q = w / 4
        for sx in (-q, q):
            for sy in (-q, q):
                stack.append((cx + sx, cy + sy, w / 2, depth + 1))
    return failing


def clamp_estimate(share):
    """An unproven share stays strictly between 0 and 1. The fine-grid area
    is divided by the sampled area (points x step squared), and for a sliver
    that fell back to a single point the two can disagree by orders of
    magnitude, so the raw ratio can land far outside [0, 1] (#1981 review)."""
    return min(max(round(share, 4), ABSOLUTE_FLOOR), 1 - ABSOLUTE_FLOOR)


def settle_full(polys, pts, step, idx, miles, confirmed_only):
    """A sampled share of 1.0: (share, is_exact). Proven → (1.0, True).
    Otherwise estimate the unreached area from the unproven cells and
    publish it below 1, never above ABSOLUTE_FLOOR short of it."""
    failing = full_coverage(polys, pts, step, idx, miles, confirmed_only)
    if not failing:
        return 1.0, True
    missed = 0.0
    for cx, cy, w in failing:
        f = w / 4
        for i in range(4):
            for j in range(4):
                x, y = cx - w / 2 + (i + 0.5) * f, cy - w / 2 + (j + 0.5) * f
                if contains(polys, x, y) and not idx.any_within(y, x, miles, confirmed_only):
                    missed += f * f
    share = 1 - missed / (len(pts) * step * step)
    return clamp_estimate(share), False


def settle_zero(polys, pts, step, idx, miles, boundary_d):
    """A sampled share of 0 near confirmed stops: (share, is_exact). Proven
    when the exact boundary distance is beyond `miles` (or no stop is within
    BOUNDARY_SEARCH_MI). Otherwise measure the reachable area on a fine grid
    around each stop within `miles` of the geography, and publish at least
    ABSOLUTE_FLOOR — a stop in reach means some of the area is."""
    if boundary_d is None or boundary_d > miles:
        return 0.0, True
    fs = (miles / 25) / 69.0
    xs = [p[0] for poly in polys for p in poly[0]]
    ys = [p[1] for poly in polys for p in poly[0]]
    pad_lat = miles / 69.0
    pad_lon = miles / _kx(max(abs(min(ys)), abs(max(ys))))
    box = (min(xs) - pad_lon, max(xs) + pad_lon, min(ys) - pad_lat, max(ys) + pad_lat)
    hit = set()
    for cell in idx.cells.values():
        for slon, slat, props in cell:
            if props.get("reliability") == "unconfirmed":
                continue
            if not (box[0] <= slon <= box[1] and box[2] <= slat <= box[3]):
                continue
            dlon = miles / _kx(slat)
            for i in range(math.floor((slon - dlon) / fs), math.floor((slon + dlon) / fs) + 1):
                for j in range(math.floor((slat - pad_lat) / fs), math.floor((slat + pad_lat) / fs) + 1):
                    if (i, j) in hit:
                        continue
                    x, y = (i + 0.5) * fs, (j + 0.5) * fs
                    if haversine_mi(y, x, slat, slon) <= miles and contains(polys, x, y):
                        hit.add((i, j))
    share = len(hit) * fs * fs / (len(pts) * step * step)
    return clamp_estimate(share), False


def summarize(polys, centre, idx, radius):
    pts, step = sample_points(polys)
    n = len(pts)
    if centre is None:
        centre = representative_point(polys, pts)
    conf = sum(1 for lon, lat in pts if idx.any_within(lat, lon, radius, True))
    anyk = sum(1 for lon, lat in pts if idx.any_within(lat, lon, radius, False))
    half = sum(1 for lon, lat in pts if idx.any_within(lat, lon, QAP_TOD_MILES, True))
    stops_inside = 0
    for cell in idx.cells.values():
        for slon, slat, props in cell:
            if props.get("reliability") != "unconfirmed" and contains(polys, slon, slat):
                stops_inside += 1
    near, d = idx.nearest(centre[1], centre[0], True)
    # A sampled zero is only a lower bound: an edge strip can fall between
    # grid points. Measure the exact distance to settle it. The ½-mile share
    # needs it whenever its sample saw nothing (which includes conf == 0).
    boundary_d = min_distance_to_polygon_mi(polys, idx) if half == 0 else None
    if boundary_d is not None:
        boundary_d = round(boundary_d, 3)   # decide exactness from the value we publish

    # The 2-mile share keeps a sampled 0 with zero_is_exact (the shared label
    # reads zero_is_exact=False as "<1%", an edge strip). A sampled 1.0 is
    # settled here; so is every absolute of the ½-mile share.
    share_conf, full_exact = (round(conf / n, 4), None) if conf != n else settle_full(polys, pts, step, idx, radius, True)
    share_any, any_full_exact = (round(anyk / n, 4), None) if anyk != n else settle_full(polys, pts, step, idx, radius, False)
    if half == 0:
        share_half, half_zero_exact = settle_zero(polys, pts, step, idx, QAP_TOD_MILES, boundary_d)
        half_full_exact = None
    elif half == n:
        share_half, half_full_exact = settle_full(polys, pts, step, idx, QAP_TOD_MILES, True)
        half_zero_exact = None
    else:
        share_half, half_zero_exact, half_full_exact = round(half / n, 4), None, None
    # Estimates made separately must still nest: more stops never shrink the
    # share, and the ½-mile area lies inside the radius area.
    share_any = max(share_any, share_conf)
    share_half = min(share_half, share_conf)
    return {
        # Set whenever no sample was within ½ mile (so always when none was
        # within the radius): the exact distance from the boundary to the
        # nearest confirmed stop, or None when none is within
        # BOUNDARY_SEARCH_MI. zero_is_exact (radius) and
        # half_mile_zero_is_exact (½ mile) are True when it proves no part of
        # the geography is that close.
        "nearest_confirmed_stop_to_boundary_miles": boundary_d,
        "zero_is_exact": (boundary_d is None or boundary_d > radius) if conf == 0 else None,
        "half_mile_zero_is_exact": half_zero_exact,
        # Set only when every sample was within reach: True when the whole
        # geography is proven within reach (full_coverage), False when it is
        # not, and the share is then an estimate kept below 1.
        "full_is_exact": full_exact,
        "any_full_is_exact": any_full_exact,
        "half_mile_full_is_exact": half_full_exact,
        "max_boundary_vertex_distance_to_confirmed_stop_miles":
            round(max_vertex_distance_mi(polys, idx), 3) if conf == n else None,
        "share_within_radius_confirmed": share_conf,
        "share_within_radius_any": share_any,
        "share_within_half_mile_confirmed": share_half,
        "confirmed_stops_inside": stops_inside,
        "nearest_confirmed_stop": None if near is None else {
            "name": near.get("name") or None,
            "agency": near.get("agency"),
            "distance_miles": round(d, 2),
        },
        "samples": n,
        "centre": [round(centre[0], 5), round(centre[1], 5)],
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
                          "nearest_confirmed_stop_to_boundary_miles": None, "zero_is_exact": None,
                          "half_mile_zero_is_exact": None, "full_is_exact": None, "any_full_is_exact": None,
                          "half_mile_full_is_exact": None, "max_boundary_vertex_distance_to_confirmed_stop_miles": None,
                          "share_within_radius_any": None, "share_within_half_mile_confirmed": None,
                          "confirmed_stops_inside": None, "nearest_confirmed_stop": None, "samples": 0,
                          "unavailableReason": "No boundary for this geography, so its area near transit could not be measured."}
            continue
        polys = polygons_of(feat["geometry"])
        if kind != "county" and geoid in centroids and contains(polys, centroids[geoid]["lng"], centroids[geoid]["lat"]):
            centre = (centroids[geoid]["lng"], centroids[geoid]["lat"])
        else:
            centre = None   # summarize() picks a point inside the boundary
        rec = summarize(polys, centre, idx, radius)
        out[geoid] = {"name": label, "type": kind, **rec}

    doc = {
        "meta": {
            "boundary_search_miles": BOUNDARY_SEARCH_MI,
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
                       "OpenStreetMap-only stops. Private airport/hotel shuttle pickups are "
                       "excluded: they are not public transit. Nearest stop is measured from a "
                       "point inside the geography (its centre when that lies inside). When no "
                       "sample is within the radius, nearest_confirmed_stop_to_boundary_miles "
                       "gives the exact distance from the boundary, so a zero is proven, not sampled. "
                       "A sampled 0 or 100% is published as an absolute only when proven "
                       "(zero_is_exact, half_mile_zero_is_exact, full_is_exact, any_full_is_exact, "
                       "half_mile_full_is_exact); otherwise the share is a finer local estimate "
                       "kept off the absolute, so it reads as under 1% or over 99%."),
            "geography_count": len(out),
        },
        "geographies": out,
    }
    OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(out)} geographies → {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
