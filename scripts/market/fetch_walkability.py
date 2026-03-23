#!/usr/bin/env python3
"""
scripts/market/fetch_walkability.py

Fetch EPA Smart Location Database walkability scores for Colorado census tracts.

The EPA Smart Location Database (SLD) provides tract-level walkability index
scores (0–20 scale) integrating density, diversity, design, transit access,
and destination accessibility.

Output:
    data/market/walkability_scores_co.json

Usage:
    python3 scripts/market/fetch_walkability.py

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
OUT_FILE = ROOT / "data" / "market" / "walkability_scores_co.json"

STATE_FIPS = "08"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_walkability_cache"
CACHE_TTL_HOURS = 720  # 30 days (SLD updated annually)

# EPA Smart Location Database ArcGIS REST service (public)
EPA_SLD_URL = (
    "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/"
    "SmartLocationDatabase_v3/FeatureServer/0"
)

# Alternative: EPA SLD bulk download (geodatabase)
EPA_SLD_DOWNLOAD = (
    "https://edg.epa.gov/EPADataCommons/public/OA/SLD/SmartLocationDatabaseV3.zip"
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


def arcgis_query_sld(offset: int = 0, limit: int = 2000) -> dict:
    """Query EPA SLD ArcGIS service for Colorado block-group records."""
    params = urllib.parse.urlencode({
        "where": f"STATEFP='{STATE_FIPS}'",
        "outFields": (
            "GEOID20,STATEFP,COUNTYFP,TRACTCE,NatWalkInd,"
            "D1A,D2A_WRKEMP,D3bpo4,D4a,D5ar,Ac_Total"
        ),
        "returnGeometry": "false",
        "f": "json",
        "resultRecordCount": str(limit),
        "resultOffset": str(offset),
    })
    url = f"{EPA_SLD_URL}/query?{params}"
    raw = fetch_url(url, timeout=90)
    data = json.loads(raw)
    if isinstance(data, dict) and "error" in data:
        err = data["error"]
        raise RuntimeError(f"ArcGIS error {err.get('code')}: {err.get('message')}")
    return data


def build_walkability_scores() -> dict:
    """Aggregate EPA SLD block-group walkability scores to census tract level."""
    log("Fetching EPA Smart Location Database for Colorado…")
    generated = utc_now()

    # Fetch all CO block groups with pagination
    all_features = []
    offset = 0
    page = 0
    while True:
        page += 1
        try:
            data = arcgis_query_sld(offset=offset)
        except Exception as exc:
            log(f"EPA SLD page {page} failed: {exc}", level="WARN")
            break
        feats = data.get("features", [])
        all_features.extend(feats)
        log(f"  Page {page}: {len(feats)} block groups (total {len(all_features)})")
        if not feats or not data.get("exceededTransferLimit"):
            break
        offset += len(feats)

    if not all_features:
        log("No EPA SLD data fetched. Writing empty output.", level="WARN")
        return _empty_output(generated)

    # Aggregate block-group scores to census tract
    tract_accum: dict = {}
    for feat in all_features:
        attrs = feat.get("attributes") or {}
        geoid_bg = str(attrs.get("GEOID20", "") or "")
        # GEOID20 is a 12-digit block-group code; first 11 digits = tract GEOID
        tract_geoid = geoid_bg[:11] if len(geoid_bg) >= 11 else geoid_bg
        county_fips = (
            str(attrs.get("STATEFP", STATE_FIPS)).zfill(2)
            + str(attrs.get("COUNTYFP", "")).zfill(3)
        )

        walk = float(attrs.get("NatWalkInd", 0) or 0)
        d1a  = float(attrs.get("D1A", 0) or 0)   # residential density
        d2a  = float(attrs.get("D2A_WRKEMP", 0) or 0)  # employment mix
        d3b  = float(attrs.get("D3bpo4", 0) or 0)  # street network
        d4a  = float(attrs.get("D4a", 0) or 0)    # transit frequency
        d5ar = float(attrs.get("D5ar", 0) or 0)   # destination accessibility
        ac   = float(attrs.get("Ac_Total", 0) or 0)

        if tract_geoid not in tract_accum:
            tract_accum[tract_geoid] = {
                "county_fips": county_fips,
                "n": 0,
                "walk_sum": 0.0,
                "d1a_sum": 0.0,
                "d2a_sum": 0.0,
                "d3b_sum": 0.0,
                "d4a_sum": 0.0,
                "d5ar_sum": 0.0,
                "ac_sum": 0.0,
            }
        acc = tract_accum[tract_geoid]
        acc["n"] += 1
        acc["walk_sum"] += walk
        acc["d1a_sum"] += d1a
        acc["d2a_sum"] += d2a
        acc["d3b_sum"] += d3b
        acc["d4a_sum"] += d4a
        acc["d5ar_sum"] += d5ar
        acc["ac_sum"] += ac

    tracts = []
    for geoid, acc in sorted(tract_accum.items()):
        n = acc["n"] or 1
        tracts.append({
            "geoid":              geoid,
            "county_fips":        acc["county_fips"],
            "walkability_index":  round(acc["walk_sum"] / n, 2),
            "residential_density": round(acc["d1a_sum"] / n, 2),
            "employment_mix":     round(acc["d2a_sum"] / n, 2),
            "street_network":     round(acc["d3b_sum"] / n, 2),
            "transit_freq":       round(acc["d4a_sum"] / n, 2),
            "destination_access": round(acc["d5ar_sum"] / n, 2),
            "block_groups":       acc["n"],
        })

    log(f"Aggregated {len(tracts)} census tracts from {len(all_features)} block groups")
    return {
        "meta": {
            "source": "EPA Smart Location Database v3.0",
            "url": "https://www.epa.gov/smartgrowth/smart-location-mapping",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": "2021",
            "generated": generated,
            "tract_count": len(tracts),
            "coverage_pct": round(min(len(tracts) / 1300, 1.0) * 100, 1),
            "score_scale": "NatWalkInd: 0–20 (higher = more walkable)",
            "note": "Rebuild via scripts/market/fetch_walkability.py",
        },
        "tracts": tracts,
    }


def _empty_output(generated: str) -> dict:
    return {
        "meta": {
            "source": "EPA Smart Location Database v3.0",
            "url": "https://www.epa.gov/smartgrowth/smart-location-mapping",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": "2021",
            "generated": generated,
            "tract_count": 0,
            "coverage_pct": 0.0,
            "note": "Stub — rebuild via scripts/market/fetch_walkability.py",
        },
        "tracts": [],
    }


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    try:
        result = build_walkability_scores()
    except Exception as exc:
        log(f"Walkability build failed: {exc}", level="ERROR")
        result = _empty_output(utc_now())

    # Fallback to existing file
    if not result.get("tracts") and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text())
        if existing.get("tracts"):
            log("[fallback] Using existing walkability_scores_co.json", level="WARN")
            result = existing

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    n = len(result.get("tracts", []))
    log(f"✓ Wrote {n} tract records to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
