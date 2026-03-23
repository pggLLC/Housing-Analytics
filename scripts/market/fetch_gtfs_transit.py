#!/usr/bin/env python3
"""
scripts/market/fetch_gtfs_transit.py

Fetch Colorado transit route data from GTFS feeds published by Colorado
transit agencies via the National Transit Database (NTD) and agency portals.

Primary sources:
  - RTD (Denver Regional Transit) — GTFS feed
  - Bustang (CDOT intercity bus) — GTFS feed
  - Additional Front Range agencies

Output:
    data/market/transit_routes_co.geojson

Usage:
    python3 scripts/market/fetch_gtfs_transit.py

All sources are free and publicly accessible without authentication.
"""

import csv
import io
import json
import os
import sys
import time
import hashlib
import zipfile
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "transit_routes_co.geojson"

STATE_FIPS = "08"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_gtfs_cache"
CACHE_TTL_HOURS = 168  # 1 week

# Colorado transit agency GTFS feeds (public)
GTFS_FEEDS = [
    {
        "agency": "RTD Denver",
        "agency_id": "rtd",
        "url": "https://www.rtd-denver.com/files/gtfs/google_transit.zip",
    },
    {
        "agency": "Bustang (CDOT)",
        "agency_id": "bustang",
        "url": "https://www.ridebustang.com/wp-content/uploads/2024/gtfs.zip",
    },
    {
        "agency": "Mountain Metropolitan Transit",
        "agency_id": "mountain_metro",
        "url": "https://www.mmtransit.com/files/gtfs.zip",
    },
    {
        "agency": "Transfort (Fort Collins)",
        "agency_id": "transfort",
        "url": "https://www.ridetransfort.com/files/gtfs.zip",
    },
    {
        "agency": "Greeley-Evans Transit",
        "agency_id": "get",
        "url": "https://www.greeleygov.com/government/transit/files/gtfs.zip",
    },
]


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)


def _cache_key(url: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.md5(url.encode()).hexdigest()
    return CACHE_DIR / key


def fetch_url(url: str, retries: int = 3, timeout: int = 120) -> bytes:
    cache_file = _cache_key(url)
    if cache_file.exists():
        age_hours = (time.time() - cache_file.stat().st_mtime) / 3600
        if age_hours < CACHE_TTL_HOURS:
            log(f"[cache hit] {url[:80]}")
            return cache_file.read_bytes()

    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "HousingAnalytics/1.0"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
            cache_file.write_bytes(data)
            return data
        except Exception as exc:
            last_err = exc
            if attempt < retries - 1:
                wait = 10 * (2 ** attempt)
                log(f"[retry {attempt+1}/{retries-1}] {exc} — waiting {wait}s", level="WARN")
                time.sleep(wait)
    raise RuntimeError(f"Failed after {retries} attempts: {last_err}")


def parse_gtfs_shapes(zip_bytes: bytes, agency_id: str, agency_name: str) -> list:
    """Extract route LineString features from a GTFS ZIP file's shapes.txt."""
    features = []
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = zf.namelist()

            # Load routes for metadata
            routes_map = {}
            if "routes.txt" in names:
                with zf.open("routes.txt") as rf:
                    reader = csv.DictReader(io.TextIOWrapper(rf, encoding="utf-8-sig"))
                    for row in reader:
                        routes_map[row.get("route_id", "")] = {
                            "short_name": row.get("route_short_name", ""),
                            "long_name":  row.get("route_long_name", ""),
                            "route_type": int(row.get("route_type", 3) or 3),
                            "color":      row.get("route_color", ""),
                        }

            # Load shapes grouped by shape_id
            if "shapes.txt" not in names:
                log(f"  ⚠ No shapes.txt in {agency_id} GTFS", level="WARN")
                return features

            shapes: dict = {}
            with zf.open("shapes.txt") as sf:
                reader = csv.DictReader(io.TextIOWrapper(sf, encoding="utf-8-sig"))
                for row in reader:
                    sid = row.get("shape_id", "")
                    seq = int(row.get("shape_pt_sequence", 0) or 0)
                    lat = float(row.get("shape_pt_lat", 0) or 0)
                    lon = float(row.get("shape_pt_lon", 0) or 0)
                    if sid not in shapes:
                        shapes[sid] = []
                    shapes[sid].append((seq, lon, lat))

            # Build LineString features (one per shape)
            for shape_id, pts in shapes.items():
                pts.sort(key=lambda x: x[0])
                coords = [[p[1], p[2]] for p in pts]
                if len(coords) < 2:
                    continue
                features.append({
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": coords},
                    "properties": {
                        "shape_id":   shape_id,
                        "agency_id":  agency_id,
                        "agency":     agency_name,
                        "route_type": 3,  # default bus
                    },
                })

    except Exception as exc:
        log(f"  ✗ GTFS parse error for {agency_id}: {exc}", level="WARN")

    return features


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    generated = utc_now()
    all_features = []
    agencies_ok = []

    for feed in GTFS_FEEDS:
        agency_id = feed["agency_id"]
        agency_name = feed["agency"]
        url = feed["url"]
        log(f"Fetching GTFS for {agency_name}…")
        try:
            zip_bytes = fetch_url(url)
            features = parse_gtfs_shapes(zip_bytes, agency_id, agency_name)
            all_features.extend(features)
            agencies_ok.append(agency_name)
            log(f"  ✓ {agency_name}: {len(features)} shapes")
        except Exception as exc:
            log(f"  ✗ {agency_name}: {exc}", level="WARN")
        time.sleep(1.0)

    result = {
        "type": "FeatureCollection",
        "meta": {
            "source": "Colorado Transit Agency GTFS Feeds (public)",
            "agencies": agencies_ok,
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": generated[:10],
            "generated": generated,
            "feature_count": len(all_features),
            "coverage_pct": round(len(agencies_ok) / len(GTFS_FEEDS) * 100, 1),
            "note": "Rebuild via scripts/market/fetch_gtfs_transit.py",
        },
        "features": all_features,
    }

    # Fallback to existing file
    if not all_features and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text())
        if existing.get("features"):
            log("[fallback] Using existing transit_routes_co.geojson", level="WARN")
            result = existing

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    n = len(result.get("features", []))
    log(f"✓ Wrote {n} transit route features to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
