#!/usr/bin/env python3
"""
scripts/market/fetch_gtfs_transit.py

Fetches and parses GTFS (General Transit Feed Specification) data for major
Colorado transit agencies and writes a GeoJSON output of transit routes and
stop frequency suitable for PMA neighborhood access scoring.

Sources:
  - RTD (Denver metro): https://www.rtd-denver.com/developers/gtfs
  - CDOT FTA GTFS registry for other Front Range agencies
Output: data/market/transit_routes_co.geojson

Usage:
    python3 scripts/market/fetch_gtfs_transit.py
"""

import csv
import io
import json
import sys
import urllib.request
import urllib.error
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "transit_routes_co.geojson"

STATE_FIPS = "08"
TIMEOUT = 120

# Colorado transit agency GTFS feeds (public, no auth required)
GTFS_FEEDS: list[dict] = [
    {
        "agency_id": "RTD",
        "agency_name": "Regional Transportation District (Denver Metro)",
        "url": "https://www.rtd-denver.com/files/gtfs/google_transit.zip",
    },
    {
        "agency_id": "CDOT_BUSTANG",
        "agency_name": "Bustang (Colorado Intercity)",
        "url": "https://www.ridebustang.com/google_transit.zip",
    },
    {
        "agency_id": "MOUNTAIN_METRO",
        "agency_name": "Mountain Metro Transit (Colorado Springs)",
        "url": "https://www.mountainmetro.org/files/gtfs/google_transit.zip",
    },
]


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def fetch_zip(url: str) -> bytes | None:
    """Fetch a GTFS zip file."""
    req = urllib.request.Request(url, headers={"User-Agent": "HousingAnalytics-PMA/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.read()
    except Exception as e:
        log(f"  Fetch failed ({url[:80]}): {e}")
        return None


def parse_gtfs_stops(zip_bytes: bytes, agency_id: str, agency_name: str) -> list[dict]:
    """Parse GTFS stop locations from a zip archive."""
    stops = []
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            # Read stops.txt
            if "stops.txt" not in zf.namelist():
                log(f"  {agency_id}: no stops.txt in archive")
                return []
            with zf.open("stops.txt") as sf:
                reader = csv.DictReader(io.TextIOWrapper(sf, encoding="utf-8-sig"))
                for row in reader:
                    try:
                        lat = float(row.get("stop_lat", 0) or 0)
                        lon = float(row.get("stop_lon", 0) or 0)
                    except (ValueError, TypeError):
                        continue
                    if lat == 0 or lon == 0:
                        continue
                    stops.append({
                        "stop_id": row.get("stop_id", ""),
                        "stop_name": row.get("stop_name", ""),
                        "lat": lat,
                        "lon": lon,
                        "agency_id": agency_id,
                        "agency_name": agency_name,
                    })
    except Exception as e:
        log(f"  GTFS parse error ({agency_id}): {e}")
    return stops


def parse_gtfs_routes(zip_bytes: bytes, agency_id: str) -> list[dict]:
    """Parse route metadata from routes.txt."""
    routes = []
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            if "routes.txt" not in zf.namelist():
                return []
            with zf.open("routes.txt") as rf:
                reader = csv.DictReader(io.TextIOWrapper(rf, encoding="utf-8-sig"))
                for row in reader:
                    routes.append({
                        "route_id": row.get("route_id", ""),
                        "route_short_name": row.get("route_short_name", ""),
                        "route_long_name": row.get("route_long_name", ""),
                        "route_type": int(row.get("route_type", 3) or 3),
                        "agency_id": agency_id,
                    })
    except Exception as e:
        log(f"  Route parse error ({agency_id}): {e}")
    return routes


def build_stop_features(all_stops: list[dict], all_routes: list[dict]) -> list[dict]:
    """Convert stops to GeoJSON features with route context."""
    # Build agency → route count index
    agency_route_counts: dict[str, int] = {}
    for route in all_routes:
        aid = route["agency_id"]
        agency_route_counts[aid] = agency_route_counts.get(aid, 0) + 1

    features = []
    for stop in all_stops:
        agency_id = stop["agency_id"]
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [stop["lon"], stop["lat"]],
            },
            "properties": {
                "stop_id": stop["stop_id"],
                "stop_name": stop["stop_name"],
                "agency_id": agency_id,
                "agency_name": stop["agency_name"],
                "route_count": agency_route_counts.get(agency_id, 0),
                # Stop frequency populated in a subsequent step using stop_times.txt
                "stop_frequency": None,
                "nearest_stop_distance": None,
            },
        })
    return features


def main() -> int:
    log("=== Colorado GTFS Transit Data Fetch ===")

    all_stops: list[dict] = []
    all_routes: list[dict] = []

    for feed in GTFS_FEEDS:
        log(f"\nFetching {feed['agency_name']} GTFS…")
        raw = fetch_zip(feed["url"])
        if raw is None:
            log(f"  Skipping {feed['agency_id']} — fetch failed")
            continue

        stops = parse_gtfs_stops(raw, feed["agency_id"], feed["agency_name"])
        routes = parse_gtfs_routes(raw, feed["agency_id"])
        log(f"  {feed['agency_id']}: {len(stops)} stops, {len(routes)} routes")
        all_stops.extend(stops)
        all_routes.extend(routes)

    log(f"\nTotal: {len(all_stops)} stops, {len(all_routes)} routes")
    features = build_stop_features(all_stops, all_routes)

    geojson = {
        "type": "FeatureCollection",
        "meta": {
            "source": "GTFS feeds: RTD, Bustang, Mountain Metro (public)",
            "vintage": utc_now()[:10],
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": utc_now(),
            "coverage_pct": round(min(len(features) / 5000 * 100, 100), 1),
            "agencies": [f["agency_id"] for f in GTFS_FEEDS],
            "fields": {
                "stop_id": "GTFS stop identifier",
                "stop_name": "Stop name",
                "agency_id": "Transit agency identifier",
                "agency_name": "Full agency name",
                "route_count": "Number of routes served by the agency",
                "stop_frequency": "Peak-hour stop frequency (null = not yet computed)",
                "nearest_stop_distance": "Distance to nearest stop in miles (null = computed at runtime)",
            },
            "note": "Rebuild via scripts/market/fetch_gtfs_transit.py — refresh weekly",
        },
        "features": features,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(geojson, fh, indent=2, ensure_ascii=False)
    log(f"Wrote {OUT_FILE} ({OUT_FILE.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
