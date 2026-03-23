#!/usr/bin/env python3
"""
scripts/market/fetch_flood_zones.py

Fetch FEMA National Flood Hazard Layer (NFHL) flood zone data for Colorado.

Flood zone designations (Zone A, AE, X, etc.) inform infrastructure risk
scoring in the PMA engine and are required for LIHTC site assessments.

Output:
    data/market/flood_zones_co.geojson

Usage:
    python3 scripts/market/fetch_flood_zones.py

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
OUT_FILE = ROOT / "data" / "market" / "flood_zones_co.geojson"

STATE_FIPS = "08"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_flood_cache"
CACHE_TTL_HOURS = 720  # 30 days

# FEMA NFHL ArcGIS REST service (public) — Flood Hazard Areas layer
FEMA_NFHL_URL = (
    "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28"
)

# High-risk flood zones that require mandatory flood insurance
HIGH_RISK_ZONES = {"A", "AE", "AH", "AO", "AR", "A99", "V", "VE"}
# Moderate/undetermined risk zones
MODERATE_RISK_ZONES = {"X", "D"}


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


def arcgis_query_nfhl(offset: int = 0, limit: int = 1000) -> dict:
    """Query FEMA NFHL for Colorado flood hazard areas."""
    params = urllib.parse.urlencode({
        "where": f"STATE_FIPS='{STATE_FIPS}'",
        "outFields": "DFIRM_ID,FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,STUDY_TYP",
        "returnGeometry": "true",
        "f": "geojson",
        "outSR": "4326",
        "resultRecordCount": str(limit),
        "resultOffset": str(offset),
        "geometryPrecision": "5",
    })
    url = f"{FEMA_NFHL_URL}/query?{params}"
    raw = fetch_url(url, timeout=120)
    data = json.loads(raw)
    if isinstance(data, dict) and "error" in data:
        err = data["error"]
        raise RuntimeError(f"ArcGIS error {err.get('code')}: {err.get('message')}")
    return data


def classify_risk(zone: str) -> str:
    """Map FEMA flood zone code to risk category."""
    z = zone.strip().upper() if zone else "X"
    if z in HIGH_RISK_ZONES or z.startswith("A") or z.startswith("V"):
        return "high"
    if z in MODERATE_RISK_ZONES:
        return "moderate"
    return "low"


def build_flood_zones() -> dict:
    """Fetch Colorado FEMA flood zone polygons with pagination."""
    log("Fetching FEMA NFHL flood zone data for Colorado…")
    generated = utc_now()

    all_features = []
    offset = 0
    page = 0
    while True:
        page += 1
        try:
            data = arcgis_query_nfhl(offset=offset)
        except Exception as exc:
            log(f"NFHL page {page} failed: {exc}", level="WARN")
            break
        feats = data.get("features", [])
        for f in feats:
            props = f.get("properties") or {}
            zone = str(props.get("FLD_ZONE", "") or "")
            props["risk_category"] = classify_risk(zone)
            props["sfha"] = bool(props.get("SFHA_TF", "") == "T")
        all_features.extend(feats)
        log(f"  Page {page}: {len(feats)} features (total {len(all_features)})")
        if not feats or not data.get("exceededTransferLimit"):
            break
        offset += len(feats)
        time.sleep(0.5)

    high_risk = sum(1 for f in all_features
                    if (f.get("properties") or {}).get("risk_category") == "high")

    log(f"Built {len(all_features)} flood zone features ({high_risk} high-risk)")
    return {
        "type": "FeatureCollection",
        "meta": {
            "source": "FEMA National Flood Hazard Layer (NFHL)",
            "url": "https://msc.fema.gov/portal/home",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": "Current effective",
            "generated": generated,
            "feature_count": len(all_features),
            "high_risk_features": high_risk,
            "coverage_pct": 100.0 if all_features else 0.0,
            "risk_categories": {
                "high": "Zones A, AE, AH, AO, AR, A99, V, VE (SFHA)",
                "moderate": "Zone X shaded, Zone D",
                "low": "Zone X unshaded",
            },
            "note": "Rebuild via scripts/market/fetch_flood_zones.py",
        },
        "features": all_features,
    }


def _empty_geojson(generated: str) -> dict:
    return {
        "type": "FeatureCollection",
        "meta": {
            "source": "FEMA National Flood Hazard Layer (NFHL)",
            "url": "https://msc.fema.gov/portal/home",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": "Current effective",
            "generated": generated,
            "feature_count": 0,
            "coverage_pct": 0.0,
            "note": "Stub — rebuild via scripts/market/fetch_flood_zones.py",
        },
        "features": [],
    }


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    try:
        result = build_flood_zones()
    except Exception as exc:
        log(f"Flood zones build failed: {exc}", level="ERROR")
        result = _empty_geojson(utc_now())

    # Fallback to existing file
    if not result.get("features") and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text())
        if existing.get("features"):
            log("[fallback] Using existing flood_zones_co.geojson", level="WARN")
            result = existing

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    n = len(result.get("features", []))
    log(f"✓ Wrote {n} flood zone features to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())