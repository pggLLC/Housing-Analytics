#!/usr/bin/env python3
"""
scripts/market/build_transit_stops_co.py

Build one statewide Colorado transit-stop file, CDOT first (#1937 Phase 1).

Sources, in priority order
--------------------------
1. CDOT Statewide Transit Points (ArcGIS feature service). Primary. Every row
   with a real location inside Colorado is kept, whatever CDOT's own type or
   station fields say. Rows at 0,0 or outside Colorado are dropped and listed
   in the coverage report, each keyed by its CDOT FID (``cdot_fid``, the
   layer's objectIdField), so they can be sent to CDOT.
2. Agency GTFS feeds (the same feeds agencies publish to Google Maps), from
   the Mobility Database catalog that scripts/market/fetch_gtfs_transit.py
   already uses. A feed stop is added only when no CDOT stop is within
   ``FEED_MATCH_M`` metres. Entrances, generic nodes and boarding areas
   (GTFS location_type 2/3/4) are skipped: they are not stops.
3. OpenStreetMap stops (data/amenities/transit_stops_co.geojson, written by
   scripts/amenities/build_osm_amenities.py). Added only when nothing above is
   within ``OSM_MATCH_M`` metres, and marked ``reliability: "unconfirmed"``.
   School-bus names and school-service tags are excluded by the shared rule
   in scripts/lib/transit_stops.py, even if the OSM input is unfiltered.

Outputs
-------
    data/amenities/transit_stops_statewide_co.geojson   one Point per stop
    data/market/transit_stops_coverage_co.json          per-county / per-agency
                                                         report, CDOT gap list,
                                                         counties with no fixed
                                                         stop

A failed CDOT request exits non-zero and leaves both outputs untouched: a
partial statewide file is not a smaller truth, it is a wrong one.

Usage
-----
    python3 scripts/market/build_transit_stops_co.py
    python3 scripts/market/build_transit_stops_co.py --skip-feeds   # CDOT + OSM only
    python3 scripts/market/build_transit_stops_co.py --filter-cached  # offline correction, no freshness bump
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import posixpath
import sys
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(ROOT / "scripts"))

import fetch_gtfs_transit as gtfs  # noqa: E402  (shared catalog, fetch and CO_BBOX)
from lib.transit_stops import exclude_school_transport, exclusion_summary

OUT_STOPS = ROOT / "data" / "amenities" / "transit_stops_statewide_co.geojson"
OUT_REPORT = ROOT / "data" / "market" / "transit_stops_coverage_co.json"
OSM_STOPS = ROOT / "data" / "amenities" / "transit_stops_co.geojson"
COUNTIES = ROOT / "data" / "co-county-boundaries.json"

CDOT_URL = ("https://services.arcgis.com/yzB9WM8W0BO3Ql7d/arcgis/rest/services/"
            "Statewide_Transit_Points/FeatureServer/0/query")
CDOT_PAGE = 2000

FEED_MATCH_M = 30.0   # a feed stop this close to a CDOT stop is the same stop
OSM_MATCH_M = 60.0    # OSM positions are hand-placed, so allow more slack

# GTFS location_type values that are not boardable stops.
NON_STOP_LOCATION_TYPES = {"2", "3", "4"}

# ── Service type (owner decision: on-demand providers are not defined routes) ─
# Each stop carries `service`: "fixed_route", "demand_response" or "unknown".
# The only signal used is GTFS-Flex in the agency feeds, which is how a feed
# says a stop is served on demand rather than on a schedule:
#   * a stop_times row that references the stop (stop_id) WITHOUT a
#     pickup/drop-off window is a scheduled trip calling at it -> fixed route.
#     Times may be blank there (non-timepoint stops on a fixed route).
#   * a row WITH a window (start_pickup_drop_off_window; the older draft
#     spelling start_pickup_dropoff_window too) that references the stop,
#     directly or through a location group, is on-demand service.
#   * a feed with on-demand trips and no scheduled stop call at all is an
#     on-demand-only feed; every stop it lists is on-demand.
# A stop with any fixed-route evidence is fixed_route. A stop with only
# on-demand evidence is demand_response. A stop no trip references, and every
# stop with no feed behind it (CDOT has no service-type field; OSM has none),
# is "unknown" — which is not the same as fixed_route and is kept separate.
# Agency names are NOT used: several agencies named "Transit"/"Mobility" run
# both kinds of service from one feed.
SERVICE_FIXED = "fixed_route"
SERVICE_DEMAND = "demand_response"
SERVICE_UNKNOWN = "unknown"
FLEX_WINDOW_COLUMNS = (
    "start_pickup_drop_off_window", "end_pickup_drop_off_window",
    "start_pickup_dropoff_window", "end_pickup_dropoff_window",
)
SERVICE_BASIS = (
    "GTFS-Flex in the agency feeds (Mobility Database catalog). fixed_route: a "
    "stop_times row calls at the stop without a pickup/drop-off window. "
    "demand_response: the stop is referenced only by windowed (on-demand) "
    "stop_times rows, directly or through location_group_stops, or is listed by a "
    "feed whose every trip is on-demand (no scheduled stop call). A CDOT stop takes "
    "the service of the feed stops within feed_match_m of it (any fixed_route wins; "
    "demand_response only when every match says so). unknown: no feed evidence "
    "(CDOT's layer has no service-type field; OpenStreetMap has none)."
)


def combine_services(services) -> str:
    """One stop's service from the evidence of every feed stop at it."""
    services = list(services)
    if SERVICE_FIXED in services:
        return SERVICE_FIXED
    if services and all(s == SERVICE_DEMAND for s in services):
        return SERVICE_DEMAND
    return SERVICE_UNKNOWN


def gtfs_member(names, basename: str) -> str | None:
    """The archive member that IS ``basename``, preferring one at the root.

    Matched on exact basename, never a suffix: ``n.endswith("stops.txt")``
    also matches ``location_group_stops.txt``, which GTFS-Flex feeds often
    list first, and the feed then contributed no stops at all.
    """
    matches = [n for n in names if posixpath.basename(n) == basename]
    if not matches:
        return None
    root = [n for n in matches if "/" not in n.strip("/")]
    return (root or matches)[0]


def feed_stop_services(z: zipfile.ZipFile) -> dict[str, str]:
    """{stop_id: service} for one GTFS feed, from stop_times.txt (GTFS-Flex aware)."""
    names = z.namelist()

    def rows(name):
        member = gtfs_member(names, name)
        if member is None:
            return iter(())
        return csv.DictReader(io.TextIOWrapper(z.open(member), encoding="utf-8-sig"))

    groups: dict[str, set[str]] = {}
    for r in rows("location_group_stops.txt"):
        g, s = (r.get("location_group_id") or "").strip(), (r.get("stop_id") or "").strip()
        if g and s:
            groups.setdefault(g, set()).add(s)
    # The older Flex draft listed members in location_groups.txt (location_id).
    for r in rows("location_groups.txt"):
        g, s = (r.get("location_group_id") or "").strip(), (r.get("location_id") or "").strip()
        if g and s:
            groups.setdefault(g, set()).add(s)

    fixed: set[str] = set()
    demand: set[str] = set()
    windowed_rows = 0
    for r in rows("stop_times.txt"):
        windowed = any((r.get(c) or "").strip() for c in FLEX_WINDOW_COLUMNS)
        windowed_rows += windowed
        refs = set()
        stop_id = (r.get("stop_id") or "").strip()
        if stop_id:
            refs.add(stop_id)
        for key in ("location_group_id", "stop_id"):
            refs |= groups.get((r.get(key) or "").strip(), set())
        if windowed:
            demand |= refs
        elif stop_id:
            fixed.add(stop_id)
    out = {s: SERVICE_DEMAND for s in demand}
    out.update({s: SERVICE_FIXED for s in fixed})
    if demand_only_feed(fixed, windowed_rows):
        # A feed whose every trip is on-demand publishes no scheduled service,
        # so a stop it lists (often a placeholder such as "Baca County, CO,
        # USA" for a zone) is served on demand if at all.
        for r in rows("stops.txt"):
            sid = (r.get("stop_id") or "").strip()
            if sid:
                out.setdefault(sid, SERVICE_DEMAND)
    return out


def demand_only_feed(fixed_stop_ids, windowed_rows: int) -> bool:
    """True when a feed has on-demand trips and not one scheduled stop call."""
    return windowed_rows > 0 and not fixed_stop_ids

# One name per agency, whichever source spelled it. Keys are lower-cased,
# parenthetical suffixes removed, whitespace collapsed.
AGENCY_ALIASES = {
    "rtd": "RTD",
    "regional transportation district": "RTD",
    "rtd denver": "RTD",
    "gvt": "Grand Valley Transit",
    "grand valley transit": "Grand Valley Transit",
    "get": "Greeley-Evans Transit",
    "greeley-evans transit": "Greeley-Evans Transit",
    "mountain metro transit": "Mountain Metropolitan Transit",
    "mountain metropolitan transit": "Mountain Metropolitan Transit",
    "rfta": "Roaring Fork Transportation Authority",
    "roaring fork transportation authority": "Roaring Fork Transportation Authority",
    "smart": "San Miguel Authority for Regional Transportation",
    "san miguel authority for regional transportation": "San Miguel Authority for Regional Transportation",
    "road runner": "Road Runner Transit",
    "road runner transit": "Road Runner Transit",
    "roadrunnertransit": "Road Runner Transit",
    "clear creek transit": "Clear Creek County Transit",
    "clear creek county transit": "Clear Creek County Transit",
    "via transit": "Via Mobility Services",
    "via mobility": "Via Mobility Services",
    "via mobility services": "Via Mobility Services",
    "transfort": "Transfort",
    "transfort – city of fort collins": "Transfort",
    "all points": "All Points Transit",
    "all points transit": "All Points Transit",
    "cripple creek transit": "Cripple Creek Transportation",
    "cripple creek transportation": "Cripple Creek Transportation",
    "estes transit": "Estes Transit",
    "town of estes park": "Estes Transit",
    "rmnp shuttle": "Rocky Mountain National Park Shuttles",
    "rocky mountain national park shuttles": "Rocky Mountain National Park Shuttles",
    "snowmass village shuttle": "Snowmass Village Transportation",
    "snowmass village transportation": "Snowmass Village Transportation",
    "bent county transportation": "Bent County Transit",
    "bent county transit": "Bent County Transit",
    "prairie express": "Prairie Express Transit",
    "prairie express transit": "Prairie Express Transit",
    "mountain express": "Mountain Express",
    "mountain express (mtnexp)": "Mountain Express",
    "met": "Mountain Express",
    # CME now publishes as Epic Mountain Express, not the public Mountain
    # Express service in Crested Butte. Keep the private classification on
    # both names: https://www.epicmountainexpress.com/history
    "colorado mountain express": "Epic Mountain Express",
    "epic mountain express": "Epic Mountain Express",
}

# Private shuttle operators: real stops, but not public transit service.
PRIVATE_OPERATORS = {
    "Home James", "Groome Transportation", "Blue Sky Limo LLC",
    "Epic Mountain Express",
}

UNLISTED_AGENCY = "Agency not listed"


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def normalize_agency(name: str | None) -> str:
    raw = (name or "").strip()
    if not raw:
        return UNLISTED_AGENCY
    key = " ".join(raw.lower().split())
    if key in AGENCY_ALIASES:
        return AGENCY_ALIASES[key]
    base = key.split("(")[0].strip()
    if base in AGENCY_ALIASES:
        return AGENCY_ALIASES[base]
    for prefix in ("groome transportation",):
        if key.startswith(prefix):
            return "Groome Transportation"
    return raw


def metres(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    x = (lon2 - lon1) * 111320.0 * math.cos(math.radians((lat1 + lat2) / 2))
    y = (lat2 - lat1) * 110540.0
    return math.hypot(x, y)


class PointIndex:
    """Grid index for 'is there a point within N metres' queries."""

    CELL = 0.005  # degrees; ~450-550 m, larger than any match radius used

    def __init__(self) -> None:
        self.cells: dict[tuple[int, int], list[tuple[float, float, object]]] = {}

    def _key(self, lon: float, lat: float) -> tuple[int, int]:
        return (math.floor(lon / self.CELL), math.floor(lat / self.CELL))

    def add(self, lon: float, lat: float, value=None) -> None:
        self.cells.setdefault(self._key(lon, lat), []).append((lon, lat, value))

    def matches(self, lon: float, lat: float, radius_m: float):
        kx, ky = self._key(lon, lat)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for plon, plat, value in self.cells.get((kx + dx, ky + dy), ()):
                    if metres(lon, lat, plon, plat) <= radius_m:
                        yield value

    def near(self, lon: float, lat: float, radius_m: float) -> bool:
        return any(True for _ in self.matches(lon, lat, radius_m))


# ── Counties ────────────────────────────────────────────────────────────────

def load_counties() -> list[tuple[str, str, list]]:
    feats = json.loads(COUNTIES.read_text())["features"]
    out = []
    for f in feats:
        g = f["geometry"]
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
        geoid = str(f["properties"]["GEOID"]).zfill(5)
        out.append((geoid, f["properties"]["NAME"], polys))
    if len(out) != 64:
        raise SystemExit(f"expected 64 Colorado counties in {COUNTIES}, found {len(out)}")
    return out


def _in_ring(lon: float, lat: float, ring: list) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def county_of(lon: float, lat: float, counties) -> str | None:
    for geoid, _name, polys in counties:
        for poly in polys:
            if _in_ring(lon, lat, poly[0]) and not any(_in_ring(lon, lat, h) for h in poly[1:]):
                return geoid
    return None


def in_colorado_bbox(lon: float, lat: float) -> bool:
    min_lon, min_lat, max_lon, max_lat = gtfs.CO_BBOX
    return min_lon <= lon <= max_lon and min_lat <= lat <= max_lat


# ── Sources ─────────────────────────────────────────────────────────────────

def fetch_cdot() -> list[dict]:
    """All CDOT Statewide Transit Points rows. Raises on any failed page."""
    rows: list[dict] = []
    offset = 0
    while True:
        q = urllib.parse.urlencode({
            "where": "1=1", "outFields": "FID,stop_id,stop_name,location_t,agency_nam",
            "outSR": 4326, "f": "json", "orderByFields": "FID",
            "resultOffset": offset, "resultRecordCount": CDOT_PAGE,
        })
        req = urllib.request.Request(f"{CDOT_URL}?{q}", headers={"User-Agent": "HousingAnalytics/1.0"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        if "error" in payload:
            raise RuntimeError(f"CDOT query error: {payload['error']}")
        feats = payload.get("features")
        if feats is None:
            raise RuntimeError("CDOT response has no 'features' — no usable response")
        for f in feats:
            a = f.get("attributes") or {}
            g = f.get("geometry") or {}
            rows.append({
                "lon": g.get("x"), "lat": g.get("y"),
                "name": (a.get("stop_name") or "").strip(),
                "agency": a.get("agency_nam"),
                "stop_id": a.get("stop_id"),
                # FID is the layer's objectIdField and its only unique key:
                # stop_id is null on every no-location MVT row (#1969).
                "cdot_fid": a.get("FID"),
            })
        offset += len(feats)
        if len(feats) < CDOT_PAGE and not payload.get("exceededTransferLimit"):
            break
        if not feats:
            break
    return rows


def fetch_feed_stops() -> tuple[list[dict], list[dict]]:
    """Stops from every Colorado GTFS feed in the Mobility Database catalog."""
    gtfs.CACHE_DIR.mkdir(parents=True, exist_ok=True)  # fetch_mdb_catalog writes here without creating it
    feeds = gtfs.load_co_feeds(gtfs.fetch_mdb_catalog())
    stops: list[dict] = []
    failed: list[dict] = []
    for i, feed in enumerate(feeds, 1):
        try:
            z = zipfile.ZipFile(io.BytesIO(gtfs.fetch_url(feed["url"], retries=2, timeout=90)))
        except Exception as exc:  # one bad feed must not sink the rest
            failed.append({"agency": feed["agency"], "reason": str(exc)[:160]})
            continue
        names = z.namelist()
        stop_file = gtfs_member(names, "stops.txt")
        if not stop_file:
            failed.append({"agency": feed["agency"], "reason": "no stops.txt"})
            continue
        agency = feed["agency"]
        agency_file = gtfs_member(names, "agency.txt")
        if agency_file:
            try:
                first = next(csv.DictReader(io.TextIOWrapper(z.open(agency_file), encoding="utf-8-sig")))
                agency = (first.get("agency_name") or agency).strip() or agency
            except (StopIteration, UnicodeDecodeError, csv.Error):
                pass
        try:
            services = feed_stop_services(z)
        except (UnicodeDecodeError, csv.Error, KeyError) as exc:
            # No usable stop_times: every stop in this feed is "unknown", never fixed_route.
            log(f"  {agency}: stop_times unreadable ({exc}); service unknown")
            services = {}
        n = 0
        for r in csv.DictReader(io.TextIOWrapper(z.open(stop_file), encoding="utf-8-sig")):
            if (r.get("location_type") or "").strip() in NON_STOP_LOCATION_TYPES:
                continue
            try:
                lat = float(r.get("stop_lat") or "")
                lon = float(r.get("stop_lon") or "")
            except ValueError:
                continue
            stops.append({"lon": lon, "lat": lat, "name": (r.get("stop_name") or "").strip(),
                          "agency": agency, "stop_id": r.get("stop_id"),
                          "service": services.get((r.get("stop_id") or "").strip(), SERVICE_UNKNOWN)})
            n += 1
        log(f"  [{i}/{len(feeds)}] {agency}: {n} stops")
    return stops, failed


def load_osm_stops() -> list[dict]:
    if not OSM_STOPS.exists():
        return []
    feats = json.loads(OSM_STOPS.read_text()).get("features", [])
    out = []
    for f in feats:
        c = (f.get("geometry") or {}).get("coordinates") or []
        if len(c) >= 2:
            out.append({**(f.get("properties") or {}), "lon": c[0], "lat": c[1],
                        "name": (f.get("properties") or {}).get("name") or ""})
    return out


# ── Merge ───────────────────────────────────────────────────────────────────

def merge(cdot_rows, feed_rows, osm_rows, counties):
    """Return (features, report_parts). Pure function over already-fetched rows."""
    features: list[dict] = []
    cdot_features: list[tuple[dict, dict]] = []
    cdot_idx, feed_idx = PointIndex(), PointIndex()
    dropped_cdot = {"no_location": 0, "outside_colorado": 0, "by_agency": {}, "rows": []}

    def drop(r, agency, reason):
        dropped_cdot[reason] += 1
        if reason == "no_location":
            dropped_cdot["by_agency"][agency] = dropped_cdot["by_agency"].get(agency, 0) + 1
        dropped_cdot["rows"].append({
            "cdot_fid": r.get("cdot_fid"), "stop_id": r.get("stop_id"), "name": r.get("name"),
            "agency": r.get("agency"), "coordinates": [r.get("lon"), r.get("lat")],
            "reason": reason,
        })

    def feature(r, agency, sources, reliability, geoid):
        return {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(r["lon"], 6), round(r["lat"], 6)]},
            "properties": {
                "name": r["name"],
                "agency": agency,
                "operator": "private_shuttle" if agency in PRIVATE_OPERATORS else "public",
                "sources": sources,
                "reliability": reliability,
                "county_fips": geoid,
                "service": SERVICE_UNKNOWN,   # set from feed evidence below
            },
        }

    for r in cdot_rows:
        lon, lat = r.get("lon"), r.get("lat")
        agency = normalize_agency(r.get("agency"))
        if not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)) or (lon == 0 and lat == 0):
            drop(r, agency, "no_location")
            continue
        geoid = county_of(lon, lat, counties) if in_colorado_bbox(lon, lat) else None
        if geoid is None:
            drop(r, agency, "outside_colorado")
            continue
        cdot_idx.add(lon, lat)
        f = feature(r, agency, ["cdot"], "confirmed", geoid)
        features.append(f)
        cdot_features.append((f, r))

    # Feed stops: add the ones CDOT lacks; record which confirm a CDOT stop.
    feed_added: dict[str, int] = {}
    seen_feed: set[tuple[float, float]] = set()
    services_at: dict[tuple[float, float], list[str]] = {}
    feed_only: list[tuple[dict, tuple[float, float]]] = []
    for r in feed_rows:
        if not in_colorado_bbox(r["lon"], r["lat"]):
            continue
        agency = normalize_agency(r.get("agency"))
        # Keep every agency in the matching index even when two feeds publish
        # the same point. An unnamed CDOT stop must not inherit an arbitrary
        # agency just because that feed happened to be fetched first.
        feed_idx.add(r["lon"], r["lat"], dict(r, agency=agency))
        key = (round(r["lon"], 5), round(r["lat"], 5))
        services_at.setdefault(key, []).append(r.get("service") or SERVICE_UNKNOWN)
        if key in seen_feed:
            continue  # the same stop published by two catalog entries
        seen_feed.add(key)
        if cdot_idx.near(r["lon"], r["lat"], FEED_MATCH_M):
            continue
        geoid = county_of(r["lon"], r["lat"], counties)
        if geoid is None:
            continue
        f = feature(r, agency, ["agency_feed"], "confirmed", geoid)
        features.append(f)
        feed_only.append((f, key))
        feed_added[agency] = feed_added.get(agency, 0) + 1
    # A feed-only stop's service: every catalog entry that publishes that point.
    for f, key in feed_only:
        f["properties"]["service"] = combine_services(services_at[key])

    # Mark CDOT stops that a feed also publishes.
    for f, cdot_row in cdot_features:
        p = f["properties"]
        if p["sources"] == ["cdot"]:
            lon, lat = f["geometry"]["coordinates"]
            matches = list(feed_idx.matches(lon, lat, FEED_MATCH_M))
            # CDOT has no service-type field: the feed stops at this point decide.
            p["service"] = combine_services(r.get("service") or SERVICE_UNKNOWN for r in matches)
            if matches:
                p["sources"] = ["cdot", "agency_feed"]
                # A shared bus stop can have several agencies within 30 m.
                # Prefer agreement on both source stop_id and stop name;
                # IDs alone are not globally unique between GTFS feeds.
                stop_id = str(cdot_row.get("stop_id") or "").strip()
                stop_name = " ".join((cdot_row.get("name") or "").casefold().split())
                exact = [r for r in matches if stop_id and stop_name
                         and str(r.get("stop_id") or "").strip() == stop_id
                         and " ".join((r.get("name") or "").casefold().split()) == stop_name]
                named = sorted({r["agency"] for r in (exact or matches)} - {UNLISTED_AGENCY})
                if p["agency"] == UNLISTED_AGENCY and len(named) == 1:
                    p["agency"] = named[0]
                    p["operator"] = "private_shuttle" if named[0] in PRIVATE_OPERATORS else "public"
                    p["agency_source"] = "agency_feed"

    osm_added = 0
    osm_rows, dropped_osm = exclude_school_transport(osm_rows)
    for r in osm_rows:
        if cdot_idx.near(r["lon"], r["lat"], OSM_MATCH_M) or feed_idx.near(r["lon"], r["lat"], OSM_MATCH_M):
            continue
        geoid = county_of(r["lon"], r["lat"], counties) if in_colorado_bbox(r["lon"], r["lat"]) else None
        if geoid is None:
            continue
        features.append(feature(r, "OpenStreetMap only", ["osm"], "unconfirmed", geoid))
        osm_added += 1

    return features, {"dropped_cdot": dropped_cdot, "feed_added_by_agency": feed_added,
                      "osm_added": osm_added, "dropped_osm_school_transport": dropped_osm}


def service_totals(features) -> dict[str, int]:
    """Stops per service value, every value always present (0 is a real count here)."""
    out = {SERVICE_FIXED: 0, SERVICE_DEMAND: 0, SERVICE_UNKNOWN: 0}
    for f in features:
        svc = f["properties"].get("service") or SERVICE_UNKNOWN
        out[svc] = out.get(svc, 0) + 1
    return out


def build_report(features, parts, counties, generated, feeds_failed, feeds_used):
    by_county = {geoid: {"county_fips": geoid, "county": name, "cdot": 0, "agency_feed_only": 0,
                         "unconfirmed": 0, "total": 0}
                 for geoid, name, _ in counties}
    by_agency: dict[str, dict] = {}
    for f in features:
        p = f["properties"]
        c = by_county[p["county_fips"]]
        a = by_agency.setdefault(p["agency"], {"agency": p["agency"], "operator": p["operator"],
                                               "cdot": 0, "agency_feed_only": 0, "unconfirmed": 0,
                                               "service": {}})
        svc = p.get("service") or SERVICE_UNKNOWN
        a["service"][svc] = a["service"].get(svc, 0) + 1
        if "cdot" in p["sources"]:
            c["cdot"] += 1
            a["cdot"] += 1
        elif p["sources"] == ["agency_feed"]:
            c["agency_feed_only"] += 1
            a["agency_feed_only"] += 1
        else:
            c["unconfirmed"] += 1
            a["unconfirmed"] += 1
        c["total"] += 1
    for c in by_county.values():
        c["fixed_route_stops_found"] = c["total"] > 0
    no_fixed = sorted((c["county"] for c in by_county.values() if c["total"] == 0))
    return {
        "meta": {
            "generated": generated,
            "source": "scripts/market/build_transit_stops_co.py",
            "note": ("Counts of stops found per source. A county with no stop in any source is "
                     "listed under counties_without_fixed_stops: that means no fixed-route stop "
                     "was found, not that the county has no transit (several run demand-response "
                     "service, which has no stops)."),
            "feed_match_m": FEED_MATCH_M,
            "osm_match_m": OSM_MATCH_M,
            "agency_feeds_used": feeds_used,
            "agency_feeds_failed": feeds_failed,
            "dropped_osm_school_transport": parts["dropped_osm_school_transport"],
        },
        "totals": {
            "stops": len(features),
            "cdot": sum(c["cdot"] for c in by_county.values()),
            "agency_feed_only": sum(c["agency_feed_only"] for c in by_county.values()),
            "unconfirmed": sum(c["unconfirmed"] for c in by_county.values()),
        },
        "counties": sorted(by_county.values(), key=lambda c: c["county_fips"]),
        "agencies": sorted(by_agency.values(), key=lambda a: a["agency"]),
        "counties_without_fixed_stops": no_fixed,
        "cdot_gaps": {
            "rows_without_location": parts["dropped_cdot"]["no_location"],
            "rows_without_location_by_agency": parts["dropped_cdot"]["by_agency"],
            "rows_outside_colorado": parts["dropped_cdot"]["outside_colorado"],
            "dropped_rows": parts["dropped_cdot"]["rows"],
            "stops_in_agency_feeds_not_in_cdot": dict(sorted(parts["feed_added_by_agency"].items())),
        },
    }


# A refresh may lose at most this share of the CDOT stops the last build kept.
# CDOT's layer changes by a few percent a year; a larger drop is a broken
# response (projected coordinates, missing latitudes, a filtered layer), not
# Colorado losing a fifth of its bus stops.
MAX_CDOT_DROP = 0.20


def previous_cdot_count() -> int | None:
    """CDOT stop count in the committed file, or None if there is none."""
    try:
        meta = json.loads(OUT_STOPS.read_text()).get("meta") or {}
        n = (meta.get("totals") or {}).get("cdot")
        return n if isinstance(n, int) and n > 0 else None
    except (OSError, ValueError):
        return None


def cdot_shortfall(features: list[dict], previous: int | None) -> str | None:
    """Why the merged result must not replace the committed file, or None.

    Checked AFTER normalisation and the Colorado/county filter: a response
    can be non-empty and still leave no usable CDOT stop once filtered.
    """
    kept = sum(1 for f in features if "cdot" in f["properties"]["sources"])
    if kept == 0:
        return "No CDOT stop survived the Colorado/county filter (0 kept)."
    if previous and kept < previous * (1 - MAX_CDOT_DROP):
        return (f"CDOT stops kept fell from {previous} to {kept} "
                f"(more than {int(MAX_CDOT_DROP * 100)}%) — no usable response.")
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-feeds", action="store_true", help="CDOT + OSM only (no GTFS downloads)")
    ap.add_argument("--filter-cached", action="store_true",
                    help="Reapply school-transport exclusion to cached OSM-only stops and rebuild coverage offline")
    args = ap.parse_args()
    if args.filter_cached:
        if args.skip_feeds:
            ap.error("--filter-cached cannot be combined with --skip-feeds")
        return filter_cached()

    counties = load_counties()
    generated = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    log("Fetching CDOT Statewide Transit Points…")
    try:
        cdot_rows = fetch_cdot()
    except Exception as exc:
        log(f"CDOT fetch failed: {exc}. Refusing to overwrite {OUT_STOPS.name}; nothing written.")
        return 1
    located = [r for r in cdot_rows if isinstance(r.get("lon"), (int, float)) and r.get("lon")]
    if not located:
        log(f"CDOT returned 0 features with a location. Refusing to overwrite {OUT_STOPS.name}; nothing written.")
        return 1
    log(f"CDOT: {len(cdot_rows)} rows")

    feed_rows, feeds_failed, feeds_used = [], [], 0
    if not args.skip_feeds:
        log("Fetching agency GTFS stops…")
        try:
            feed_rows, feeds_failed = fetch_feed_stops()
            feeds_used = len({r["agency"] for r in feed_rows})
        except Exception as exc:  # the catalog itself failed; CDOT still stands
            feeds_failed = [{"agency": "(Mobility Database catalog)", "reason": str(exc)[:160]}]
    osm_rows = load_osm_stops()

    features, parts = merge(cdot_rows, feed_rows, osm_rows, counties)
    problem = cdot_shortfall(features, previous_cdot_count())
    if problem:
        log(f"{problem} Refusing to overwrite {OUT_STOPS.name}; nothing written.")
        return 1
    report = build_report(features, parts, counties, generated, feeds_failed, feeds_used)

    stops = {
        "type": "FeatureCollection",
        "meta": {
            "generated": generated,
            "state": "Colorado",
            "state_fips": "08",
            "source": ("CDOT Statewide Transit Points (primary); agency GTFS feeds via the Mobility "
                       "Database catalog; OpenStreetMap (unconfirmed)"),
            "cdot_url": CDOT_URL.rsplit("/query", 1)[0],
            "count": len(features),
            "totals": report["totals"],
            "reliability_note": ("'confirmed' = published by CDOT or an agency feed; 'unconfirmed' = "
                                 "OpenStreetMap only. Coverage report: data/market/transit_stops_coverage_co.json"),
            "note": "Rebuild via scripts/market/build_transit_stops_co.py (#1937).",
            "service_basis": SERVICE_BASIS,
            "service_totals": service_totals(features),
            "dropped_osm_school_transport": parts["dropped_osm_school_transport"],
        },
        "features": features,
    }
    OUT_STOPS.write_text(json.dumps(stops, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    OUT_REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    t = report["totals"]
    log(f"Wrote {t['stops']} stops ({t['cdot']} CDOT, {t['agency_feed_only']} agency feed, "
        f"{t['unconfirmed']} unconfirmed) → {OUT_STOPS.relative_to(ROOT)}")
    log(f"Counties with no fixed stop: {len(report['counties_without_fixed_stops'])}")
    return 0


def filter_cached() -> int:
    """Correct an existing snapshot without refreshing or reconstructing feeds.

    Keep confirmed records and source freshness verbatim. Recompute coverage
    using the same report builder as a live fetch, preserving CDOT gap evidence.
    """
    stops = json.loads(OUT_STOPS.read_text(encoding="utf-8"))
    old_report = json.loads(OUT_REPORT.read_text(encoding="utf-8"))
    osm = [f for f in stops["features"] if f["properties"]["sources"] == ["osm"]]
    kept, dropped = exclude_school_transport(osm)
    kept_ids = {id(f) for f in kept}
    features = [f for f in stops["features"]
                if f["properties"]["sources"] != ["osm"] or id(f) in kept_ids]
    prior = (stops["meta"].get("dropped_osm_school_transport") or {}).get("rows", [])
    dropped = exclusion_summary(prior + dropped["rows"])
    gaps = old_report["cdot_gaps"]
    parts = {
        "dropped_cdot": {"no_location": gaps["rows_without_location"],
                         "by_agency": gaps["rows_without_location_by_agency"],
                         "outside_colorado": gaps["rows_outside_colorado"],
                         "rows": gaps["dropped_rows"]},
        "feed_added_by_agency": gaps["stops_in_agency_feeds_not_in_cdot"],
        "dropped_osm_school_transport": dropped,
    }
    meta = old_report["meta"]
    report = build_report(features, parts, load_counties(), meta["generated"],
                          meta["agency_feeds_failed"], meta["agency_feeds_used"])
    stops["features"] = features
    stops["meta"].update(count=len(features), totals=report["totals"],
                         service_totals=service_totals(features), dropped_osm_school_transport=dropped)
    OUT_STOPS.write_text(json.dumps(stops, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    OUT_REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    log(f"Reapplied exclusions: {dropped['count']} OSM school-transport stops removed; {len(features)} retained")
    return 0


if __name__ == "__main__":
    sys.exit(main())
