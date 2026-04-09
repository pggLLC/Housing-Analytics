#!/usr/bin/env python3
"""
scripts/market/fetch_opportunity_zones.py

Fetch Colorado Opportunity Zone designations from the HUD CDFI Fund GIS service.

Opportunity Zones are designated census tracts under IRC §1400Z-1/-2 that
provide tax incentives for long-term investment in low-income communities.

Output:
    data/market/opportunity_zones_co.geojson

Usage:
    python3 scripts/market/fetch_opportunity_zones.py

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
OUT_FILE = ROOT / "data" / "market" / "opportunity_zones_co.geojson"

STATE_FIPS = "08"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_oz_cache"
CACHE_TTL_HOURS = 720  # 30 days (OZ designations rarely change)

# HUD CDFI Fund Opportunity Zones — public ArcGIS FeatureServer (v2)
OZ_ARCGIS_URL = (
    "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/"
    "Opportunity_Zones_2/FeatureServer/0"
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


def arcgis_query_oz(layer_url: str, offset: int = 0) -> dict:
    params = urllib.parse.urlencode({
        "where": f"STATEFP='{STATE_FIPS}'",
        "outFields": "*",
        "returnGeometry": "true",
        "f": "geojson",
        "outSR": "4326",
        "resultRecordCount": "2000",
        "resultOffset": str(offset),
    })
    url = f"{layer_url}/query?{params}"
    data = json.loads(fetch_url(url, timeout=90))
    if isinstance(data, dict) and "error" in data:
        err = data["error"]
        raise RuntimeError(f"ArcGIS error {err.get('code')}: {err.get('message')}")
    return data


def build_opportunity_zones() -> dict:
    """Fetch Colorado Opportunity Zone polygons from HUD CDFI Fund ArcGIS service."""
    log("Fetching Colorado Opportunity Zone designations…")
    generated = utc_now()

    all_features = []
    # Fetch from ArcGIS FeatureServer with pagination
    try:
        offset = 0
        while True:
            page = arcgis_query_oz(OZ_ARCGIS_URL, offset=offset)
            page_features = page.get("features", [])
            all_features.extend(page_features)
            if not page_features or not page.get("exceededTransferLimit"):
                break
            offset += len(page_features)
    except Exception as exc:
        log(f"ArcGIS OZ fetch failed: {exc}", level="WARN")

    # Filter to Colorado and normalize
    co_features = []
    for f in all_features:
        props = f.get("properties") or {}
        state_fips = str(
            props.get("STATE_FIPS", props.get("STATEFP", props.get("state", ""))) or ""
        ).zfill(2)
        geoid = str(props.get("GEOID10", props.get("GEOID", props.get("TRACTCE", ""))) or "")

        # Accept if state FIPS matches or GEOID starts with CO FIPS
        if state_fips != STATE_FIPS and not geoid.startswith(STATE_FIPS):
            continue

        # Enforce 5-digit county FIPS from 11-digit tract GEOID (Rule 1)
        county_fips = geoid[:5].zfill(5) if len(geoid) >= 5 else geoid.zfill(5)

        co_features.append({
            "type": "Feature",
            "geometry": f.get("geometry"),
            "properties": {
                "geoid":       geoid,
                "county_fips": county_fips,
                "designated":  bool(props.get("DESIGNATED", props.get("designated", True))),
                "oz_type":     props.get("OZ_TYPE", props.get("oz_type", "QOZ")),
                "state_fips":  STATE_FIPS,
            },
        })

    log(f"Built {len(co_features)} Colorado Opportunity Zone features")
    return {
        "type": "FeatureCollection",
        "meta": {
            "source": "HUD CDFI Fund — Opportunity Zones",
            "url": "https://www.cdfifund.gov/opportunity-zones",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": "2018 designations (permanent)",
            "generated": generated,
            "feature_count": len(co_features),
            "coverage_pct": round(min(len(co_features) / 126, 1.0) * 100, 1),
            "note": "Rebuild via scripts/market/fetch_opportunity_zones.py",
        },
        "features": co_features,
    }


def _empty_geojson(generated: str) -> dict:
    return {
        "type": "FeatureCollection",
        "meta": {
            "source": "HUD CDFI Fund — Opportunity Zones",
            "url": "https://www.cdfifund.gov/opportunity-zones",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": "2018 designations (permanent)",
            "generated": generated,
            "feature_count": 0,
            "coverage_pct": 0.0,
            "note": "Stub — rebuild via scripts/market/fetch_opportunity_zones.py",
        },
        "features": [],
    }


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    try:
        result = build_opportunity_zones()
    except Exception as exc:
        log(f"Opportunity Zones build failed: {exc}", level="ERROR")
        result = _empty_geojson(utc_now())

    # Fallback to existing file
    if not result.get("features") and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text())
        if existing.get("features"):
            log("[fallback] Using existing opportunity_zones_co.geojson")
            result = existing

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    n = len(result.get("features", []))
    log(f"✓ Wrote {n} features to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())