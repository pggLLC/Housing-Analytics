#!/usr/bin/env python3
"""
Build a Colorado tract-centroid to regional-hub drive-time matrix.

The artifact is context-only infrastructure for future geographic-isolation
and PMA commute work. It must never use proprietary Distance Matrix outputs:
the default router is OSRM over OpenStreetMap data, and callers may point the
builder at a CI-hosted/local OSRM endpoint with TRAVEL_TIME_MATRIX_ROUTER_URL.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
CENTROIDS_PATH = ROOT / "data" / "market" / "tract_centroids_co.json"
OUT_PATH = ROOT / "data" / "market" / "travel_time_matrix_co.json"

DEFAULT_OSRM_TABLE_URL = "https://router.project-osrm.org/table/v1/driving"
STATE_FIPS = "08"
CHUNK_SIZE = 35

REGIONAL_HUBS = [
    {"id": "denver", "name": "Denver", "lat": 39.7392, "lon": -104.9903},
    {"id": "colorado_springs", "name": "Colorado Springs", "lat": 38.8339, "lon": -104.8214},
    {"id": "pueblo", "name": "Pueblo", "lat": 38.2544, "lon": -104.6091},
    {"id": "fort_collins", "name": "Fort Collins", "lat": 40.5853, "lon": -105.0844},
    {"id": "greeley", "name": "Greeley", "lat": 40.4233, "lon": -104.7091},
    {"id": "boulder", "name": "Boulder", "lat": 40.0150, "lon": -105.2705},
    {"id": "grand_junction", "name": "Grand Junction", "lat": 39.0639, "lon": -108.5506},
    {"id": "glenwood_springs", "name": "Glenwood Springs", "lat": 39.5505, "lon": -107.3248},
    {"id": "vail", "name": "Vail", "lat": 39.6403, "lon": -106.3742},
    {"id": "steamboat_springs", "name": "Steamboat Springs", "lat": 40.4850, "lon": -106.8317},
    {"id": "durango", "name": "Durango", "lat": 37.2753, "lon": -107.8801},
    {"id": "montrose", "name": "Montrose", "lat": 38.4783, "lon": -107.8762},
    {"id": "alamosa", "name": "Alamosa", "lat": 37.4694, "lon": -105.8700},
    {"id": "lamar", "name": "Lamar", "lat": 38.0872, "lon": -102.6208},
    {"id": "sterling", "name": "Sterling", "lat": 40.6255, "lon": -103.2077},
]


def iso_today() -> str:
    return date.today().isoformat()


def review_by(days: int = 92) -> str:
    return (date.today() + timedelta(days=days)).isoformat()


def read_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.write("\n")


def request_json(url: str, retries: int = 3, timeout: int = 120):
    last_error = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "HousingAnalytics/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # pragma: no cover - live network failure path
            last_error = exc
            try:
                out = subprocess.check_output(
                    ["curl", "-sS", "--max-time", str(timeout), url],
                    text=True,
                    stderr=subprocess.PIPE,
                )
                return json.loads(out)
            except Exception as curl_exc:
                last_error = curl_exc
            if attempt < retries - 1:
                time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Failed to fetch {url}: {last_error}")


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius_miles = 3958.7613
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return radius_miles * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def osrm_table_url(base_url: str, sources, hubs) -> str:
    coords = [f"{row['lon']:.6f},{row['lat']:.6f}" for row in sources]
    coords.extend(f"{hub['lon']:.6f},{hub['lat']:.6f}" for hub in hubs)
    source_indices = ";".join(str(i) for i in range(len(sources)))
    dest_indices = ";".join(str(len(sources) + i) for i in range(len(hubs)))
    query = urllib.parse.urlencode({
        "sources": source_indices,
        "destinations": dest_indices,
        "annotations": "duration,distance",
    })
    return f"{base_url.rstrip('/')}/{';'.join(coords)}?{query}"


def fetch_osrm_chunk(base_url: str, sources, hubs):
    payload = request_json(osrm_table_url(base_url, sources, hubs))
    if payload.get("code") != "Ok":
        raise RuntimeError(f"OSRM table returned {payload.get('code')}: {payload.get('message')}")
    durations = payload.get("durations") or []
    distances = payload.get("distances") or []
    if len(durations) != len(sources) or len(distances) != len(sources):
        raise RuntimeError("OSRM table response shape did not match source chunk")
    return durations, distances


def clean_tracts(doc):
    rows = []
    for row in doc.get("tracts") or []:
        geoid = str(row.get("geoid") or "")
        if not geoid.startswith(STATE_FIPS) or len(geoid) != 11:
            continue
        lat = float(row.get("lat"))
        lon = float(row.get("lon"))
        rows.append({
            "geoid": geoid,
            "lat": lat,
            "lon": lon,
            "county_fips": row.get("county_fips"),
            "county_name": row.get("county_name"),
            "tract_name": row.get("tract_name"),
            "centroid_source": row.get("centroid_source"),
        })
    return rows


def route_matrix(tracts, router_url: str, sleep_seconds: float):
    rows = {}
    routed_pairs = 0
    null_pairs = 0
    max_drive_minutes = 0
    max_distance_miles = 0

    for offset in range(0, len(tracts), CHUNK_SIZE):
        chunk = tracts[offset:offset + CHUNK_SIZE]
        durations, distances = fetch_osrm_chunk(router_url, chunk, REGIONAL_HUBS)
        for i, tract in enumerate(chunk):
            hub_rows = {}
            nearest = None
            for j, hub in enumerate(REGIONAL_HUBS):
                duration = durations[i][j] if j < len(durations[i]) else None
                distance = distances[i][j] if j < len(distances[i]) else None
                straight = haversine_miles(tract["lat"], tract["lon"], hub["lat"], hub["lon"])
                if duration is None or distance is None:
                    null_pairs += 1
                    entry = {
                        "status": "unrouted",
                        "drive_minutes": None,
                        "distance_miles": None,
                        "straight_line_miles": round(straight, 1),
                    }
                else:
                    minutes = round(float(duration) / 60, 1)
                    miles = round(float(distance) / 1609.344, 1)
                    routed_pairs += 1
                    max_drive_minutes = max(max_drive_minutes, minutes)
                    max_distance_miles = max(max_distance_miles, miles)
                    entry = {
                        "status": "routed",
                        "drive_minutes": minutes,
                        "distance_miles": miles,
                        "straight_line_miles": round(straight, 1),
                    }
                    if nearest is None or minutes < nearest["drive_minutes"]:
                        nearest = {"hub_id": hub["id"], "drive_minutes": minutes, "distance_miles": miles}
                hub_rows[hub["id"]] = entry
            rows[tract["geoid"]] = {
                "geoid": tract["geoid"],
                "county_fips": tract["county_fips"],
                "county_name": tract["county_name"],
                "tract_name": tract["tract_name"],
                "source_point": {
                    "lat": tract["lat"],
                    "lon": tract["lon"],
                    "source": tract["centroid_source"],
                },
                "nearest_hub": nearest,
                "hubs": hub_rows,
                "context_only": True,
                "not_scoring_input": True,
            }
        if offset + CHUNK_SIZE < len(tracts):
            time.sleep(sleep_seconds)

    stats = {
        "routed_pair_count": routed_pairs,
        "null_pair_count": null_pairs,
        "max_drive_minutes": round(max_drive_minutes, 1),
        "max_distance_miles": round(max_distance_miles, 1),
    }
    return rows, stats


def build(router_url: str, sleep_seconds: float):
    centroids = read_json(CENTROIDS_PATH)
    tracts = clean_tracts(centroids)
    if len(tracts) < 1400:
        raise RuntimeError(f"Expected Colorado tract coverage, found {len(tracts)} rows")

    rows, stats = route_matrix(tracts, router_url, sleep_seconds)
    total_pairs = len(tracts) * len(REGIONAL_HUBS)
    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    payload = {
        "meta": {
            "source": "OpenStreetMap-derived Colorado tract-to-regional-hub travel-time matrix",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "as_of": iso_today(),
            "generated": generated_at,
            "last_verified": iso_today(),
            "review_by": review_by(),
            "generated_by": "scripts/market/build_travel_time_matrix.py",
            "tract_centroids_file": "data/market/tract_centroids_co.json",
            "router": {
                "engine": "OSRM Table API",
                "profile": "driving",
                "source_url": router_url,
                "quarterly_refresh_ready": True,
            },
            "osm_extract_source_url": "https://download.geofabrik.de/north-america/us/colorado.html",
            "osm_copyright_url": "https://www.openstreetmap.org/copyright",
            "odbl_notice": "Contains information from OpenStreetMap and OpenStreetMap Foundation, made available under the Open Database License.",
            "context_only": True,
            "not_scoring_input": True,
            "methodology": (
                "Routes each committed Colorado Census tract centroid to fixed Colorado regional hub coordinates "
                "through the OSRM Table API using the driving profile. The committed output stores only derived "
                "duration/distance summaries and hub identifiers, not raw OSM extracts."
            ),
            "limitations": [
                "Regional hubs are screening anchors, not formal market-area definitions.",
                "Centroid-to-hub routing does not replace site-specific market-study drive-time or commute-shed analysis.",
                "No PMA score, tract selection, buffer, or underwriting calculation consumes this artifact in this PR.",
            ],
            "tract_count": len(tracts),
            "hub_count": len(REGIONAL_HUBS),
            "expected_pair_count": total_pairs,
            **stats,
        },
        "hubs": {hub["id"]: hub for hub in REGIONAL_HUBS},
        "tracts": rows,
    }
    return payload


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--router-url", default=os.environ.get("TRAVEL_TIME_MATRIX_ROUTER_URL", DEFAULT_OSRM_TABLE_URL))
    parser.add_argument("--sleep", type=float, default=float(os.environ.get("TRAVEL_TIME_MATRIX_SLEEP", "0.25")))
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    args = parser.parse_args(argv)

    payload = build(args.router_url, args.sleep)
    write_json(args.out, payload)
    print(
        "travel-time-matrix: wrote "
        f"{payload['meta']['tract_count']} tracts x {payload['meta']['hub_count']} hubs "
        f"({payload['meta']['routed_pair_count']} routed pairs)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
