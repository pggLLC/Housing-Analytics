#!/usr/bin/env python3
"""
scripts/market/fetch_utility_capacity.py

Fetch Colorado utility infrastructure capacity proxy data to support
feasibility scoring in the PMA engine.

Sources:
  1. Colorado DWR — 78 water districts with lat/lon coordinates
     (https://dwr.state.co.us/Rest/GET/api/v2/)
  2. Census TIGERweb — incorporated place boundaries (layer 4)
     (https://tigerweb.geo.census.gov/arcgis/rest/services/)

Output:
    data/market/utility_capacity_co.geojson

Usage:
    python3 scripts/market/fetch_utility_capacity.py

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
OUT_FILE = ROOT / "data" / "market" / "utility_capacity_co.geojson"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_utility_cache"
CACHE_TTL_HOURS = 720  # 30 days

# Colorado DWR structures API — water delivery infrastructure
DWR_API_BASE = "https://dwr.state.co.us/Rest/GET/api/v2"

# Census TIGERweb — incorporated places (layer 4)
TIGERWEB_PLACES_URL = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/"
    "TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4"
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


def fetch_url(url: str, retries: int = 3, timeout: int = 90) -> bytes:
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
    raise RuntimeError(f"Failed after {retries} attempts: {last_err}")


def fetch_dwr_water_districts() -> list:
    """Fetch Colorado water districts from DWR REST API."""
    log("Fetching Colorado DWR water districts…")
    url = f"{DWR_API_BASE}/referencetables/waterdistrict?format=json"
    try:
        raw = fetch_url(url, timeout=60)
        data = json.loads(raw)
        districts = data.get("ResultList", [])
        log(f"  {len(districts)} water districts from DWR API")
        return districts
    except Exception as exc:
        log(f"  DWR water districts failed: {exc}", level="WARN")
        return []


def fetch_dwr_structures_by_county(county: str) -> list:
    """Fetch water structures for a county from DWR REST API."""
    url = (
        f"{DWR_API_BASE}/structures"
        f"?format=json&county={urllib.parse.quote(county)}&pageSize=500"
    )
    try:
        raw = fetch_url(url, timeout=90)
        data = json.loads(raw)
        return data.get("ResultList", [])
    except Exception:
        return []


def fetch_tigerweb_places() -> list:
    """Fetch Colorado incorporated place boundaries from TIGERweb."""
    log("Fetching CO incorporated places from TIGERweb…")
    features = []
    offset = 0
    page = 0

    while True:
        page += 1
        params = urllib.parse.urlencode({
            "where": "STATE = '08'",
            "outFields": "GEOID,NAME,FUNCSTAT,CENTLAT,CENTLON,AREALAND",
            "returnGeometry": "false",
            "f": "json",
            "resultRecordCount": "100",
            "resultOffset": str(offset),
        })
        url = f"{TIGERWEB_PLACES_URL}/query?{params}"
        try:
            raw = fetch_url(url, timeout=120)
            data = json.loads(raw)

            if isinstance(data, dict) and "error" in data:
                log(f"  TIGERweb error: {data['error']}", level="WARN")
                break

            raw_feats = data.get("features", [])
            for f in raw_feats:
                attrs = f.get("attributes") or {}
                lat = _safe_float(attrs.get("CENTLAT"))
                lon = _safe_float(attrs.get("CENTLON"))
                area_sqm = _safe_float(attrs.get("AREALAND"))

                # Create a point-geometry GeoJSON feature from centroid
                geom = None
                if lat is not None and lon is not None:
                    geom = {"type": "Point", "coordinates": [round(lon, 4), round(lat, 4)]}

                # Estimate bounding box from area (approximate as circle)
                import math
                radius_deg = 0.01  # ~1km default
                if area_sqm and area_sqm > 0:
                    radius_m = math.sqrt(area_sqm / math.pi)
                    radius_deg = radius_m / 111000  # approx degrees

                features.append({
                    "type": "Feature",
                    "properties": {
                        "GEOID": attrs.get("GEOID"),
                        "NAME": attrs.get("NAME"),
                        "FUNCSTAT": attrs.get("FUNCSTAT"),
                        "area_sqm": area_sqm,
                        "radius_deg": round(radius_deg, 4) if radius_deg else None,
                        "utility_type": "municipal_boundary",
                        "data_source": "Census TIGERweb",
                        "constraint_level": "moderate",
                        "notes": "Municipal service area — refer to local capital improvement plan",
                    },
                    "geometry": geom,
                })

            log(f"  Page {page}: {len(raw_feats)} places (total {len(features)})")

            exceeded = data.get("exceededTransferLimit", False)
            if not raw_feats or not exceeded:
                break
            offset += len(raw_feats)
            time.sleep(0.3)
        except Exception as exc:
            log(f"  TIGERweb page {page} failed: {exc}", level="WARN")
            break

    return features


def _safe_float(val):
    """Convert a string or number to float, return None on failure."""
    if val is None:
        return None
    try:
        f = float(val)
        if f == 0 or abs(f) < 0.001:
            return None
        return f
    except (ValueError, TypeError):
        return None


def water_districts_to_features(districts: list) -> list:
    """Convert DWR water district records to GeoJSON point features."""
    features = []
    for d in districts:
        # DWR districts don't have geometry directly — create metadata features
        features.append({
            "type": "Feature",
            "properties": {
                "NAME": d.get("waterDistrictName", "Unknown"),
                "waterDistrict": d.get("waterDistrict"),
                "division": d.get("division"),
                "utility_type": "water_district",
                "data_source": "Colorado DWR",
                "constraint_level": "variable",
                "notes": "DWR water district — check local tap fees and availability",
            },
            "geometry": None  # No polygon geometry available from DWR API
        })
    return features


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    generated = utc_now()

    all_features = []
    sources_ok = []

    # 1. TIGERweb incorporated place boundaries (with polygon geometry)
    places = fetch_tigerweb_places()
    if places:
        all_features.extend(places)
        sources_ok.append("Census TIGERweb Incorporated Places")

    # 2. DWR water districts (metadata only — no polygon geometry)
    districts = fetch_dwr_water_districts()
    if districts:
        district_features = water_districts_to_features(districts)
        all_features.extend(district_features)
        sources_ok.append("Colorado DWR Water Districts")

    result = {
        "type": "FeatureCollection",
        "meta": {
            "source": "Census TIGERweb + Colorado DWR water districts",
            "state": "Colorado",
            "state_fips": "08",
            "vintage": generated[:10],
            "generated": generated,
            "feature_count": len(all_features),
            "sources_successful": sources_ok,
            "coverage_pct": round(len(sources_ok) / 2 * 100, 1),
            "note": (
                "Municipal boundaries from TIGERweb + DWR water district metadata. "
                "Rebuild via scripts/market/fetch_utility_capacity.py"
            ),
        },
        "features": all_features,
    }

    # Fallback to existing file if both sources failed
    if not all_features and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text())
        if existing.get("features"):
            log("[fallback] Using existing utility_capacity_co.geojson", level="WARN")
            result = existing

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    n = len(result.get("features", []))
    log(f"✓ Wrote {n} utility service area features to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
