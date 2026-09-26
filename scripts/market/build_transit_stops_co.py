#!/usr/bin/env python3
"""
scripts/market/build_transit_stops_co.py

Build one statewide Colorado transit-stop file, CDOT first (#1937 Phase 1).

Sources, in priority order
--------------------------
1. CDOT Statewide Transit Points (ArcGIS feature service). Primary. Every row
   with a real location inside Colorado is kept, whatever CDOT's own type or
   station fields say. Rows at 0,0 or outside Colorado are dropped and listed
   in the coverage report so they can be sent to CDOT.
2. Agency GTFS feeds (the same feeds agencies publish to Google Maps), from
   the Mobility Database catalog that scripts/market/fetch_gtfs_transit.py
   already uses. A feed stop is added only when no CDOT stop is within
   ``FEED_MATCH_M`` metres. Entrances, generic nodes and boarding areas
   (GTFS location_type 2/3/4) are skipped: they are not stops.
3. OpenStreetMap stops (data/amenities/transit_stops_co.geojson, written by
   scripts/amenities/build_osm_amenities.py). Added only when nothing above is
   within ``OSM_MATCH_M`` metres, and marked ``reliability: "unconfirmed"``.

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
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import sys
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

import fetch_gtfs_transit as gtfs  # noqa: E402  (shared catalog, fetch and CO_BBOX)

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
}

# Private shuttle operators: real stops, but not public transit service.
PRIVATE_OPERATORS = {
    "Home James", "Groome Transportation", "Blue Sky Limo LLC",
    "Colorado Mountain Express",
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
        self.cells: dict[tuple[int, int], list[tuple[float, float]]] = {}

    def _key(self, lon: float, lat: float) -> tuple[int, int]:
        return (math.floor(lon / self.CELL), math.floor(lat / self.CELL))

    def add(self, lon: float, lat: float) -> None:
        self.cells.setdefault(self._key(lon, lat), []).append((lon, lat))

    def near(self, lon: float, lat: float, radius_m: float) -> bool:
        kx, ky = self._key(lon, lat)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for plon, plat in self.cells.get((kx + dx, ky + dy), ()):
                    if metres(lon, lat, plon, plat) <= radius_m:
                        return True
        return False


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
            "where": "1=1", "outFields": "stop_id,stop_name,location_t,agency_nam",
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
        stop_file = next((n for n in names if n.endswith("stops.txt")), None)
        if not stop_file:
            failed.append({"agency": feed["agency"], "reason": "no stops.txt"})
            continue
        agency = feed["agency"]
        agency_file = next((n for n in names if n.endswith("agency.txt")), None)
        if agency_file:
            try:
                first = next(csv.DictReader(io.TextIOWrapper(z.open(agency_file), encoding="utf-8-sig")))
                agency = (first.get("agency_name") or agency).strip() or agency
            except (StopIteration, UnicodeDecodeError, csv.Error):
                pass
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
                          "agency": agency, "stop_id": r.get("stop_id")})
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
            out.append({"lon": c[0], "lat": c[1], "name": (f.get("properties") or {}).get("name") or "",
                        "osm_id": (f.get("properties") or {}).get("osm_id")})
    return out


# ── Merge ───────────────────────────────────────────────────────────────────

def merge(cdot_rows, feed_rows, osm_rows, counties):
    """Return (features, report_parts). Pure function over already-fetched rows."""
    features: list[dict] = []
    cdot_idx, feed_idx = PointIndex(), PointIndex()
    dropped_cdot = {"no_location": 0, "outside_colorado": 0, "by_agency": {}}

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
            },
        }

    for r in cdot_rows:
        lon, lat = r.get("lon"), r.get("lat")
        agency = normalize_agency(r.get("agency"))
        if not isinstance(lon, (int, float)) or not isinstance(lat, (int, float)) or (lon == 0 and lat == 0):
            dropped_cdot["no_location"] += 1
            dropped_cdot["by_agency"][agency] = dropped_cdot["by_agency"].get(agency, 0) + 1
            continue
        geoid = county_of(lon, lat, counties) if in_colorado_bbox(lon, lat) else None
        if geoid is None:
            dropped_cdot["outside_colorado"] += 1
            continue
        cdot_idx.add(lon, lat)
        features.append(feature(r, agency, ["cdot"], "confirmed", geoid))

    # Feed stops: add the ones CDOT lacks; record which confirm a CDOT stop.
    feed_added: dict[str, int] = {}
    seen_feed: set[tuple[float, float]] = set()
    for r in feed_rows:
        key = (round(r["lon"], 5), round(r["lat"], 5))
        if key in seen_feed:
            continue  # the same stop published by two catalog entries
        seen_feed.add(key)
        if not in_colorado_bbox(r["lon"], r["lat"]):
            continue
        feed_idx.add(r["lon"], r["lat"])
        if cdot_idx.near(r["lon"], r["lat"], FEED_MATCH_M):
            continue
        geoid = county_of(r["lon"], r["lat"], counties)
        if geoid is None:
            continue
        agency = normalize_agency(r.get("agency"))
        features.append(feature(r, agency, ["agency_feed"], "confirmed", geoid))
        feed_added[agency] = feed_added.get(agency, 0) + 1

    # Mark CDOT stops that a feed also publishes.
    for f in features:
        p = f["properties"]
        if p["sources"] == ["cdot"]:
            lon, lat = f["geometry"]["coordinates"]
            if feed_idx.near(lon, lat, FEED_MATCH_M):
                p["sources"] = ["cdot", "agency_feed"]

    osm_added = 0
    for r in osm_rows:
        if cdot_idx.near(r["lon"], r["lat"], OSM_MATCH_M) or feed_idx.near(r["lon"], r["lat"], OSM_MATCH_M):
            continue
        geoid = county_of(r["lon"], r["lat"], counties) if in_colorado_bbox(r["lon"], r["lat"]) else None
        if geoid is None:
            continue
        features.append(feature(r, "OpenStreetMap only", ["osm"], "unconfirmed", geoid))
        osm_added += 1

    return features, {"dropped_cdot": dropped_cdot, "feed_added_by_agency": feed_added, "osm_added": osm_added}


def build_report(features, parts, counties, generated, feeds_failed, feeds_used):
    by_county = {geoid: {"county_fips": geoid, "county": name, "cdot": 0, "agency_feed_only": 0,
                         "unconfirmed": 0, "total": 0}
                 for geoid, name, _ in counties}
    by_agency: dict[str, dict] = {}
    for f in features:
        p = f["properties"]
        c = by_county[p["county_fips"]]
        a = by_agency.setdefault(p["agency"], {"agency": p["agency"], "operator": p["operator"],
                                               "cdot": 0, "agency_feed_only": 0, "unconfirmed": 0})
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
            "stops_in_agency_feeds_not_in_cdot": dict(sorted(parts["feed_added_by_agency"].items())),
        },
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-feeds", action="store_true", help="CDOT + OSM only (no GTFS downloads)")
    args = ap.parse_args()

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


if __name__ == "__main__":
    sys.exit(main())
