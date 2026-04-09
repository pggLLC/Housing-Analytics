#!/usr/bin/env python3
"""
scripts/market/fetch_schools.py

Fetch Colorado school boundary and performance data from public sources:
  - Colorado Department of Education (CDE) public data portal
  - NCES Common Core of Data (CCD) school universe API

Output:
    data/market/schools_co.geojson

Usage:
    python3 scripts/market/fetch_schools.py

Environment variables (optional):
    CENSUS_API_KEY  — improves Census rate limits (not required here)

All sources are free and publicly accessible without authentication.
"""

import json
import os
import sys
import time
import hashlib
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "schools_co.geojson"

STATE_FIPS = "08"
STATE_ABBR = "CO"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_schools_cache"
CACHE_TTL_HOURS = 168  # 1 week

# NCES CCD school locations — official ArcGIS MapServer (public, no key required)
NCES_ARCGIS_URL = (
    "https://nces.ed.gov/opengis/rest/services/K12_School_Locations/"
    "EDGE_ADMINDATA_PUBLICSCH_2122/MapServer/0"
)


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)


def _cache_key(url: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.md5(url.encode()).hexdigest()
    return CACHE_DIR / key


def fetch_url(url: str, retries: int = 3, timeout: int = 60) -> bytes:
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
                wait = 5 * (2 ** attempt)
                log(f"[retry {attempt+1}/{retries-1}] {exc} — waiting {wait}s", level="WARN")
                time.sleep(wait)
    raise RuntimeError(f"Failed after {retries} attempts: {last_err} | URL: {url[:120]}")


def fetch_json(url: str, **kw) -> dict:
    return json.loads(fetch_url(url, **kw))


def arcgis_query_schools(offset: int = 0) -> dict:
    """Query NCES ArcGIS MapServer for Colorado public schools.

    Note: NCES MapServer does not support f=geojson, so we use f=json
    and convert to GeoJSON features manually.
    """
    params = urllib.parse.urlencode({
        "where": "LSTATE='CO'",
        "outFields": "NCESSCH,SCH_NAME,SCHOOL_TYPE_TEXT,GSLO,GSHI,TOTAL,"
                     "NMCNTY,LCITY,LZIP,CHARTER_TEXT,MAGNET_TEXT,"
                     "TITLEI_TEXT,SY_STATUS_TEXT,LATCOD,LONCOD",
        "returnGeometry": "true",
        "f": "json",
        "outSR": "4326",
        "resultRecordCount": "2000",
        "resultOffset": str(offset),
    })
    url = f"{NCES_ARCGIS_URL}/query?{params}"
    data = json.loads(fetch_url(url, timeout=90))
    if isinstance(data, dict) and "error" in data:
        err = data["error"]
        raise RuntimeError(f"ArcGIS error {err.get('code')}: {err.get('message')}")
    return data


def build_schools_geojson() -> dict:
    """Fetch Colorado K-12 school locations from NCES ArcGIS MapServer."""
    log("Fetching Colorado K-12 school data from NCES ArcGIS MapServer…")
    generated = utc_now()

    all_records = []
    try:
        offset = 0
        page = 0
        while True:
            page += 1
            data = arcgis_query_schools(offset=offset)
            records = data.get("features", [])
            all_records.extend(records)
            log(f"  Page {page}: {len(records)} records (total {len(all_records)})")
            if not records or not data.get("exceededTransferLimit"):
                break
            offset += len(records)
            time.sleep(0.3)
    except Exception as exc:
        log(f"NCES ArcGIS fetch failed: {exc}. Writing empty stub.", level="WARN")
        if not all_records:
            return _empty_geojson(generated)

    # Convert ArcGIS JSON to GeoJSON features
    features = []
    for rec in all_records:
        attrs = rec.get("attributes") or {}
        geom = rec.get("geometry")
        lat = attrs.get("LATCOD")
        lon = attrs.get("LONCOD")

        # Build GeoJSON point from geometry or lat/lon attributes
        if geom and "x" in geom and "y" in geom:
            point = {"type": "Point", "coordinates": [geom["x"], geom["y"]]}
        elif lat and lon:
            try:
                point = {"type": "Point", "coordinates": [float(lon), float(lat)]}
            except (TypeError, ValueError):
                continue
        else:
            continue

        features.append({
            "type": "Feature",
            "geometry": point,
            "properties": {
                "nces_id":      str(attrs.get("NCESSCH", "") or ""),
                "school_name":  attrs.get("SCH_NAME", ""),
                "school_type":  attrs.get("SCHOOL_TYPE_TEXT", ""),
                "grade_low":    attrs.get("GSLO", ""),
                "grade_high":   attrs.get("GSHI", ""),
                "enrollment":   int(attrs.get("TOTAL", 0) or 0),
                "county_name":  attrs.get("NMCNTY", ""),
                "city":         attrs.get("LCITY", ""),
                "zip":          attrs.get("LZIP", ""),
                "charter":      str(attrs.get("CHARTER_TEXT", "")).lower().startswith("yes"),
                "magnet":       str(attrs.get("MAGNET_TEXT", "")).lower().startswith("yes"),
                "title1":       str(attrs.get("TITLEI_TEXT", "")).lower().startswith("yes"),
                "status":       attrs.get("SY_STATUS_TEXT", ""),
            },
        })

    log(f"Built {len(features)} Colorado school features")
    return {
        "type": "FeatureCollection",
        "meta": {
            "source": "NCES Common Core of Data — School Locations 2021-22",
            "url": "https://nces.ed.gov/programs/edge/Geographic/SchoolLocations",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": "2021-22",
            "generated": generated,
            "feature_count": len(features),
            "coverage_pct": round(min(len(features) / 1800, 1.0) * 100, 1),
            "note": "Rebuild via scripts/market/fetch_schools.py",
        },
        "features": features,
    }


def _empty_geojson(generated: str) -> dict:
    return {
        "type": "FeatureCollection",
        "meta": {
            "source": "NCES Common Core of Data via Urban Institute Education Data API",
            "url": "https://educationdata.urban.org/",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": "2022-23",
            "generated": generated,
            "feature_count": 0,
            "coverage_pct": 0.0,
            "note": "Stub — rebuild via scripts/market/fetch_schools.py",
        },
        "features": [],
    }


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    # Fall back to existing file if network unavailable
    result = build_schools_geojson()
    if not result.get("features") and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text())
        if existing.get("features"):
            log("[fallback] Using existing schools_co.geojson")
            result = existing

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    n = len(result.get("features", []))
    log(f"✓ Wrote {n} features to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())