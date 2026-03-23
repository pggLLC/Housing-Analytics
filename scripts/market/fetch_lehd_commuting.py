#!/usr/bin/env python3
"""
scripts/market/fetch_lehd_commuting.py

Fetches LEHD/LODES On-the-Map commuting flows for Colorado census tracts and
writes a GeoJSON output suitable for PMA workforce availability scoring.

Source: US Census Bureau LODES (Longitudinal Employer-Household Dynamics)
        Origin-Destination Employment Statistics (OD) files
API:    https://lehd.ces.census.gov/data/lodes/LODES8/
Output: data/market/commuting_shed_co.geojson

Usage:
    python3 scripts/market/fetch_lehd_commuting.py

Environment variables:
    CENSUS_API_KEY  — optional Census API key for higher rate limits
"""

import csv
import gzip
import io
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "commuting_shed_co.geojson"

STATE = "co"
YEAR = 2021  # Most recent available LODES8 year for CO

# LODES OD main file (all jobs, primary jobs)
LODES_OD_URL = (
    f"https://lehd.ces.census.gov/data/lodes/LODES8/{STATE}/od/"
    f"{STATE}_od_main_JT00_{YEAR}.csv.gz"
)

# LODES Workplace Area Characteristics (WAC) for job counts by tract
LODES_WAC_URL = (
    f"https://lehd.ces.census.gov/data/lodes/LODES8/{STATE}/wac/"
    f"{STATE}_wac_S000_JT00_{YEAR}.csv.gz"
)

# LODES Residence Area Characteristics (RAC) for worker counts by tract
LODES_RAC_URL = (
    f"https://lehd.ces.census.gov/data/lodes/LODES8/{STATE}/rac/"
    f"{STATE}_rac_S000_JT00_{YEAR}.csv.gz"
)

TIMEOUT = 120
STATE_FIPS = "08"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def fetch_gz_csv(url: str) -> list[dict]:
    """Fetch a gzipped CSV file from LODES and return rows as dicts."""
    log(f"Fetching {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "HousingAnalytics-PMA/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        log(f"  HTTP {e.code}: {e.reason} — {url}")
        return []
    except Exception as e:
        log(f"  Fetch error: {e}")
        return []

    with gzip.open(io.BytesIO(raw), "rt", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    log(f"  Read {len(rows):,} rows")
    return rows


def aggregate_od_flows(od_rows: list[dict]) -> dict:
    """Aggregate OD flows to produce per-tract inbound/outbound job counts."""
    # w_geocode = workplace census block, h_geocode = home census block
    # We roll up to tract level (first 11 digits of block FIPS)
    inbound: dict[str, int] = {}   # tract → total jobs flowing in (workers commuting to)
    outbound: dict[str, int] = {}  # tract → total workers leaving

    for row in od_rows:
        w_block = row.get("w_geocode", "")
        h_block = row.get("h_geocode", "")
        jobs = int(row.get("S000", 0) or 0)

        if len(w_block) >= 11:
            w_tract = w_block[:11]
            inbound[w_tract] = inbound.get(w_tract, 0) + jobs
        if len(h_block) >= 11:
            h_tract = h_block[:11]
            outbound[h_tract] = outbound.get(h_tract, 0) + jobs

    return {"inbound": inbound, "outbound": outbound}


def aggregate_wac(wac_rows: list[dict]) -> dict[str, int]:
    """Aggregate WAC rows: total jobs per tract."""
    totals: dict[str, int] = {}
    for row in wac_rows:
        block = row.get("w_geocode", "")
        if len(block) >= 11:
            tract = block[:11]
            totals[tract] = totals.get(tract, 0) + int(row.get("C000", 0) or 0)
    return totals


def aggregate_rac(rac_rows: list[dict]) -> dict[str, int]:
    """Aggregate RAC rows: total workers residing per tract."""
    totals: dict[str, int] = {}
    for row in rac_rows:
        block = row.get("h_geocode", "")
        if len(block) >= 11:
            tract = block[:11]
            totals[tract] = totals.get(tract, 0) + int(row.get("C000", 0) or 0)
    return totals


def build_features(od_agg: dict, wac_totals: dict, rac_totals: dict) -> list[dict]:
    """Build GeoJSON features for each Colorado tract."""
    all_tracts = set(od_agg["inbound"]) | set(od_agg["outbound"]) | set(wac_totals) | set(rac_totals)
    # Filter to Colorado tracts only
    co_tracts = {t for t in all_tracts if t.startswith(STATE_FIPS)}

    features = []
    for tract in sorted(co_tracts):
        county_fips = tract[:5].zfill(5)
        inbound = od_agg["inbound"].get(tract, 0)
        outbound = od_agg["outbound"].get(tract, 0)
        jobs = wac_totals.get(tract, 0)
        workers = rac_totals.get(tract, 0)
        # Workers-to-jobs ratio: > 1 means bedroom community, < 1 means employment center
        ratio = round(workers / jobs, 3) if jobs > 0 else None
        features.append({
            "type": "Feature",
            "geometry": None,  # Centroids added at runtime from tract_centroids_co.json
            "properties": {
                "geoid": tract,
                "county_fips": county_fips,
                "inbound_workers": inbound,
                "outbound_workers": outbound,
                "total_jobs": jobs,
                "resident_workers": workers,
                "workers_to_jobs_ratio": ratio,
                "year": YEAR,
            },
        })
    return features


def main() -> int:
    log("=== LEHD/LODES Commuting Shed Fetch ===")

    od_rows = fetch_gz_csv(LODES_OD_URL)
    wac_rows = fetch_gz_csv(LODES_WAC_URL)
    rac_rows = fetch_gz_csv(LODES_RAC_URL)

    if not od_rows and not wac_rows:
        log("ERROR: No LODES data fetched. Writing empty GeoJSON.")
        geojson = _empty_geojson()
    else:
        od_agg = aggregate_od_flows(od_rows)
        wac_totals = aggregate_wac(wac_rows)
        rac_totals = aggregate_rac(rac_rows)
        features = build_features(od_agg, wac_totals, rac_totals)
        log(f"Built {len(features)} Colorado tract commuting features")
        geojson = {
            "type": "FeatureCollection",
            "meta": {
                "source": "US Census Bureau LEHD/LODES8 (public)",
                "vintage": str(YEAR),
                "state": "Colorado",
                "state_fips": STATE_FIPS,
                "generated": utc_now(),
                "coverage_pct": round(len(features) / 1300 * 100, 1),
                "note": "Rebuild via scripts/market/fetch_lehd_commuting.py",
            },
            "features": features,
        }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(geojson, fh, indent=2, ensure_ascii=False)
    log(f"Wrote {OUT_FILE} ({OUT_FILE.stat().st_size:,} bytes)")
    log(f"  Features: {len(geojson.get('features', []))}")
    return 0


def _empty_geojson() -> dict:
    return {
        "type": "FeatureCollection",
        "meta": {
            "source": "US Census Bureau LEHD/LODES8 (public)",
            "vintage": str(YEAR),
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": utc_now(),
            "coverage_pct": 0,
            "note": "Empty — fetch failed. Rebuild via scripts/market/fetch_lehd_commuting.py",
        },
        "features": [],
    }


if __name__ == "__main__":
    sys.exit(main())
