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

# EPA National Walkability Index — public ArcGIS MapServer (confirmed working)
EPA_SLD_URL = (
    "https://geodata.epa.gov/arcgis/rest/services/"
    "OA/WalkabilityIndex/MapServer/0"
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
            "GEOID20,STATEFP,COUNTYFP,TRACTCE,BLKGRPCE,NatWalkInd,"
            "D3B,D3B_Ranked,D4A,D4A_Ranked,D2A_Ranked,D2B_Ranked"
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
        d3b  = float(attrs.get("D3B", 0) or 0)       # intersection density
        d4a  = float(attrs.get("D4A", -99999) or -99999)  # transit distance (m)
        d3b_r = float(attrs.get("D3B_Ranked", 0) or 0)
        d4a_r = float(attrs.get("D4A_Ranked", 0) or 0)
        d2a_r = float(attrs.get("D2A_Ranked", 0) or 0)

        if tract_geoid not in tract_accum:
            tract_accum[tract_geoid] = {
                "county_fips": county_fips,
                "n": 0,
                "walk_sum": 0.0,
                "d3b_sum": 0.0,
                "d4a_vals": [],
                "d3b_rank": [],
                "d4a_rank": [],
                "d2a_rank": [],
            }
        acc = tract_accum[tract_geoid]
        acc["n"] += 1
        if walk > 0:
            acc["walk_sum"] += walk
        if d3b >= 0:
            acc["d3b_sum"] += d3b
        if d4a >= 0:
            acc["d4a_vals"].append(d4a)
        if d3b_r > 0:
            acc["d3b_rank"].append(d3b_r)
        if d4a_r > 0:
            acc["d4a_rank"].append(d4a_r)
        if d2a_r > 0:
            acc["d2a_rank"].append(d2a_r)

    tracts = []
    for geoid, acc in sorted(tract_accum.items()):
        n = acc["n"] or 1
        walk_idx = round(acc["walk_sum"] / n, 2)
        # Map NatWalkInd (1-20) to 0-100 scale for Walk Score equivalent
        walk_score = round((walk_idx - 1) / 19 * 100) if walk_idx > 0 else None
        # Transit: distance to nearest stop, inverted to score
        d4a_avg = round(sum(acc["d4a_vals"]) / len(acc["d4a_vals"])) if acc["d4a_vals"] else None
        transit_score = max(0, min(100, round((1 - d4a_avg / 1600) * 100))) if d4a_avg is not None and d4a_avg >= 0 else None
        # Bike: intersection density rank as proxy
        d3b_r_avg = round(sum(acc["d3b_rank"]) / len(acc["d3b_rank"]), 1) if acc["d3b_rank"] else None
        bike_score = round((d3b_r_avg - 1) / 19 * 100) if d3b_r_avg else None

        tracts.append({
            "geoid":              geoid,
            "county_fips":        acc["county_fips"],
            "walkability_index":  walk_idx,
            "walk_score":         walk_score,
            "transit_score":      transit_score,
            "bike_score":         bike_score,
            "transit_distance_m": d4a_avg,
            "intersection_density": round(acc["d3b_sum"] / n, 2),
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