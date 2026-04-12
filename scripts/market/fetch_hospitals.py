#!/usr/bin/env python3
"""
scripts/market/fetch_hospitals.py

Fetch Colorado hospital and medical facility data from public sources:
  1. CDPHE Trauma Center Designation (ArcGIS MapServer — geocoded, reliable)
  2. HIFLD Hospitals via NASA NCCS FeatureServer (comprehensive, slower)

Output:
    data/market/hospitals_co.geojson

Usage:
    python3 scripts/market/fetch_hospitals.py

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
OUT_FILE = ROOT / "data" / "market" / "hospitals_co.geojson"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_hospitals_cache"
CACHE_TTL_HOURS = 720  # 30 days

# CDPHE Trauma Center Designation — public ArcGIS MapServer
CDPHE_TRAUMA_URL = (
    "https://www.cohealthmaps.dphe.state.co.us/arcgis/rest/services/"
    "OPEN_DATA/cdphe_trauma_center_designation/MapServer/0"
)

# HIFLD Hospitals via NASA NCCS — public FeatureServer
HIFLD_URL = (
    "https://maps.nccs.nasa.gov/mapping/rest/services/"
    "hifld_open/public_health/FeatureServer/0"
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


def fetch_cdphe_trauma() -> list:
    """Fetch Colorado trauma centers from CDPHE ArcGIS MapServer."""
    log("Fetching CDPHE trauma center data…")
    params = urllib.parse.urlencode({
        "where": "1=1",
        "outFields": "*",
        "returnGeometry": "true",
        "f": "geojson",
        "outSR": "4326",
    })
    url = f"{CDPHE_TRAUMA_URL}/query?{params}"
    try:
        data = json.loads(fetch_url(url))
        if isinstance(data, dict) and "error" in data:
            raise RuntimeError(data["error"].get("message", "Unknown error"))
        features = data.get("features", [])
        log(f"  CDPHE trauma centers: {len(features)} features")
        return features
    except Exception as exc:
        log(f"  CDPHE fetch failed: {exc}", level="WARN")
        return []


def fetch_hifld_hospitals() -> list:
    """Fetch Colorado hospitals from HIFLD via NASA NCCS FeatureServer."""
    log("Fetching HIFLD hospital data (may be slow)…")
    params = urllib.parse.urlencode({
        "where": "STATE='CO'",
        "outFields": "NAME,ADDRESS,CITY,STATE,ZIP,COUNTY,COUNTYFIPS,TYPE,STATUS,"
                     "BEDS,TRAUMA,HELIPAD,OWNER,TELEPHONE,WEBSITE,LATITUDE,LONGITUDE",
        "returnGeometry": "true",
        "f": "geojson",
        "outSR": "4326",
        "resultRecordCount": "2000",
    })
    url = f"{HIFLD_URL}/query?{params}"
    try:
        data = json.loads(fetch_url(url, timeout=120))
        if isinstance(data, dict) and "error" in data:
            raise RuntimeError(data["error"].get("message", "Unknown error"))
        features = data.get("features", [])
        log(f"  HIFLD hospitals: {len(features)} features")
        return features
    except Exception as exc:
        log(f"  HIFLD fetch failed: {exc}", level="WARN")
        return []


def normalize_features(cdphe: list, hifld: list) -> list:
    """Merge and deduplicate hospital features from multiple sources."""
    features = []
    seen_names = set()

    # HIFLD features first (richer data)
    for f in hifld:
        props = f.get("properties") or {}
        name = (props.get("NAME") or "").strip()
        if not name:
            continue
        norm = name.upper().replace("THE ", "").strip()
        if norm in seen_names:
            continue
        seen_names.add(norm)

        geom = f.get("geometry")
        if not geom:
            lat = props.get("LATITUDE")
            lon = props.get("LONGITUDE")
            if lat and lon:
                try:
                    geom = {"type": "Point", "coordinates": [float(lon), float(lat)]}
                except (TypeError, ValueError):
                    continue
            else:
                continue

        features.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "name": name,
                "address": props.get("ADDRESS", ""),
                "city": props.get("CITY", ""),
                "zip": str(props.get("ZIP", "")),
                "county": props.get("COUNTY", ""),
                "county_fips": str(props.get("COUNTYFIPS", "")),
                "type": props.get("TYPE", ""),
                "status": props.get("STATUS", ""),
                "beds": int(props.get("BEDS") or 0),
                "trauma": props.get("TRAUMA", ""),
                "helipad": props.get("HELIPAD", ""),
                "owner": props.get("OWNER", ""),
                "phone": props.get("TELEPHONE", ""),
                "website": props.get("WEBSITE", ""),
                "source": "HIFLD",
            },
        })

    # Add CDPHE trauma centers not already in HIFLD
    for f in cdphe:
        props = f.get("properties") or {}
        name = (props.get("HOSPITAL_NAME") or "").strip()
        if not name:
            continue
        norm = name.upper().replace("THE ", "").strip()
        if norm in seen_names:
            # Update trauma level if we already have this hospital
            for existing in features:
                if existing["properties"]["name"].upper().replace("THE ", "").strip() == norm:
                    existing["properties"]["trauma"] = props.get("TRAUMA_LEVEL", "")
                    break
            continue
        seen_names.add(norm)

        geom = f.get("geometry")
        if not geom:
            lat = props.get("LATITUDE")
            lon = props.get("LONGITUDE")
            if lat and lon:
                try:
                    geom = {"type": "Point", "coordinates": [float(lon), float(lat)]}
                except (TypeError, ValueError):
                    continue
            else:
                continue

        features.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "name": name,
                "address": props.get("ADDRESS", ""),
                "city": props.get("CITY", ""),
                "zip": str(props.get("ZIP", "")),
                "county": props.get("COUNTY", ""),
                "county_fips": "",
                "type": props.get("LICENSE_TYPE", "Hospital"),
                "status": "OPEN",
                "beds": 0,
                "trauma": props.get("TRAUMA_LEVEL", ""),
                "helipad": "",
                "owner": "",
                "phone": "",
                "website": "",
                "source": "CDPHE",
            },
        })

    return features


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    generated = utc_now()

    cdphe = fetch_cdphe_trauma()
    hifld = fetch_hifld_hospitals()

    features = normalize_features(cdphe, hifld)
    log(f"Total merged hospital features: {len(features)}")

    if not features and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text())
        if existing.get("features"):
            log("[fallback] Using existing hospitals_co.geojson")
            return 0

    result = {
        "type": "FeatureCollection",
        "meta": {
            "source": "HIFLD (NASA NCCS) + CDPHE Trauma Center Designation",
            "urls": [
                "https://hifld-geoplatform.opendata.arcgis.com/datasets/hospitals",
                "https://data-cdphe.opendata.arcgis.com/"
            ],
            "state": "Colorado",
            "state_fips": "08",
            "generated": generated,
            "feature_count": len(features),
            "note": "Rebuild via scripts/market/fetch_hospitals.py",
        },
        "features": features,
    }

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    log(f"✓ Wrote {len(features)} hospital features to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
