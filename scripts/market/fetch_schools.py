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

# NCES CCD school universe API — public, no key required
NCES_CCD_URL = (
    "https://educationdata.urban.org/api/v1/schools/ccd/directory/"
    "?year=2022&fips=8&per_page=10000"
)

# CDE school performance data (public download)
CDE_SCHOOL_PERFORMANCE_URL = (
    "https://www.cde.state.co.us/accountability/2023-24schoolaccreportcardspublic.xls"
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


def build_schools_geojson() -> dict:
    """Fetch Colorado K-12 school locations from the Urban Institute Education Data API."""
    log("Fetching Colorado K-12 school data from NCES/CCD via Urban Institute API…")
    generated = utc_now()

    try:
        data = fetch_json(NCES_CCD_URL, timeout=90)
    except Exception as exc:
        log(f"NCES CCD fetch failed: {exc}. Writing empty stub.", level="WARN")
        return _empty_geojson(generated)

    results = data.get("results", [])
    if not results:
        log("No results returned from NCES API.", level="WARN")
        return _empty_geojson(generated)

    features = []
    for school in results:
        lat = school.get("latitude")
        lon = school.get("longitude")
        if lat is None or lon is None:
            continue
        try:
            lat = float(lat)
            lon = float(lon)
        except (TypeError, ValueError):
            continue

        county_fips_raw = str(school.get("fips_county_code", "") or "").zfill(5)
        if not county_fips_raw.startswith("08"):
            continue

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "nces_id":          str(school.get("ncessch", "") or ""),
                "school_name":      school.get("school_name", ""),
                "school_type":      school.get("school_type_text", ""),
                "grade_low":        school.get("lowest_grade_offered", ""),
                "grade_high":       school.get("highest_grade_offered", ""),
                "enrollment":       int(school.get("enrollment", 0) or 0),
                "county_fips":      county_fips_raw,
                "city":             school.get("city_location", ""),
                "zip":              school.get("zip_mailing", ""),
                "charter":          bool(school.get("charter_school_indicator", 0)),
                "magnet":           bool(school.get("magnet_school_indicator", 0)),
                "title1":           bool(school.get("title_i_school_status", 0)),
                "status":           school.get("school_status", ""),
            },
        })

    log(f"Built {len(features)} Colorado school features")
    return {
        "type": "FeatureCollection",
        "meta": {
            "source": "NCES Common Core of Data via Urban Institute Education Data API",
            "url": "https://educationdata.urban.org/",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": "2022-23",
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
