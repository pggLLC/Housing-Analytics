#!/usr/bin/env python3
"""
scripts/market/fetch_lodes.py

Download LEHD LODES 8.x data for Colorado and aggregate to tract-level metrics.

Downloads three gzipped CSV files from the Census Bureau:
  - WAC (Workplace Area Characteristics): jobs located in each block
  - RAC (Residence Area Characteristics): workers living in each block
  - OD  (Origin-Destination): commuting flows between blocks

Aggregates block-level data to census tract level (first 11 digits of
the 15-digit block GEOCODE) and computes per-tract metrics.

Output:
    data/market/lodes_co.json

Usage:
    python3 scripts/market/fetch_lodes.py [--year 2021]
"""

import csv
import gzip
import io
import json
import os
import sys
import time
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "lodes_co.json"

# LODES base URL
LODES_BASE = "https://lehd.ces.census.gov/data/lodes/LODES8/co"

# Try years in descending order until we find one that exists
# LODES 2022 is the latest confirmed release as of April 2026.
# LODES typically has a 2-3 year lag from the reference year.
CANDIDATE_YEARS = [2023, 2022, 2021, 2020]

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_lodes_cache"
CACHE_TTL_HOURS = 720  # 30 days


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)


def block_to_tract(geocode: str) -> str:
    """Extract tract GEOID (11 digits) from block GEOCODE (15 digits)."""
    return geocode[:11]


def download_gz(url: str, description: str) -> bytes:
    """Download a gzipped file with caching and retry."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    # Use URL filename as cache key
    fname = url.split("/")[-1]
    cache_file = CACHE_DIR / fname

    if cache_file.exists():
        age_hours = (time.time() - cache_file.stat().st_mtime) / 3600
        if age_hours < CACHE_TTL_HOURS:
            log(f"[cache hit] {description}: {fname}")
            return cache_file.read_bytes()

    log(f"Downloading {description}: {url}")
    last_err = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "HousingAnalytics/1.0"}
            )
            with urllib.request.urlopen(req, timeout=300) as resp:
                data = resp.read()
            size_mb = len(data) / (1024 * 1024)
            log(f"  Downloaded {size_mb:.1f} MB for {description}")
            cache_file.write_bytes(data)
            return data
        except Exception as exc:
            last_err = exc
            if attempt < 2:
                wait = 10 * (2 ** attempt)
                log(f"  [retry {attempt+1}] {exc} -- waiting {wait}s", level="WARN")
                time.sleep(wait)
    raise RuntimeError(f"Failed to download {description}: {last_err}")


def check_year_available(year: int) -> bool:
    """Check if LODES data is available for the given year."""
    # Try a HEAD request on the WAC file
    url = f"{LODES_BASE}/wac/co_wac_S000_JT00_{year}.csv.gz"
    try:
        req = urllib.request.Request(url, method="HEAD",
                                     headers={"User-Agent": "HousingAnalytics/1.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status == 200
    except Exception:
        return False


def parse_gz_csv(data: bytes) -> list:
    """Decompress gzipped CSV data and parse into list of dicts."""
    decompressed = gzip.decompress(data)
    text = decompressed.decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(text))
    return list(reader)


def process_wac(rows: list) -> dict:
    """
    Aggregate WAC (Workplace Area Characteristics) from block to tract level.

    Key fields:
      w_geocode: workplace block GEOCODE (15 digits)
      C000: total jobs
      CE01: goods-producing jobs (NAICS 11,21,23,31-33)
      CE02: trade/transport/utilities (NAICS 22,42,44-45,48-49)
      CE03: all other services (NAICS 51+)
      CA01: age 29 or younger
      CA02: age 30 to 54
      CA03: age 55 or older
      CS01: $1,250/month or less (low wage)
      CS02: $1,251 to $3,333/month (mid wage)
      CS03: more than $3,333/month (high wage)
    """
    log(f"Processing {len(rows)} WAC block records...")
    tracts = defaultdict(lambda: defaultdict(int))

    fields = ["C000", "CE01", "CE02", "CE03", "CS01", "CS02", "CS03",
              "CA01", "CA02", "CA03"]

    for row in rows:
        geocode = row.get("w_geocode", "")
        if not geocode or len(geocode) < 11:
            continue
        tract = block_to_tract(geocode)
        for f in fields:
            val = int(row.get(f, 0) or 0)
            tracts[tract][f] += val

    log(f"  Aggregated to {len(tracts)} tracts")
    return dict(tracts)


def process_rac(rows: list) -> dict:
    """
    Aggregate RAC (Residence Area Characteristics) from block to tract level.

    Key fields:
      h_geocode: residence block GEOCODE (15 digits)
      C000: total resident workers
      CS01, CS02, CS03: wage categories
    """
    log(f"Processing {len(rows)} RAC block records...")
    tracts = defaultdict(lambda: defaultdict(int))

    fields = ["C000", "CS01", "CS02", "CS03"]

    for row in rows:
        geocode = row.get("h_geocode", "")
        if not geocode or len(geocode) < 11:
            continue
        tract = block_to_tract(geocode)
        for f in fields:
            val = int(row.get(f, 0) or 0)
            tracts[tract][f] += val

    log(f"  Aggregated to {len(tracts)} tracts")
    return dict(tracts)


def process_od(rows: list) -> dict:
    """
    Aggregate OD (Origin-Destination) from block to tract level.

    Computes in-commuters and out-commuters for each tract.
    - In-commuter: works in tract but lives elsewhere
    - Out-commuter: lives in tract but works elsewhere

    Key fields:
      w_geocode: workplace block GEOCODE
      h_geocode: residence (home) block GEOCODE
      S000: total jobs
    """
    log(f"Processing {len(rows)} OD block records...")

    # Aggregate to tract-level OD pairs
    od_tract = defaultdict(int)  # (home_tract, work_tract) -> total jobs

    for row in rows:
        w_geo = row.get("w_geocode", "")
        h_geo = row.get("h_geocode", "")
        jobs = int(row.get("S000", 0) or 0)
        if not w_geo or not h_geo or len(w_geo) < 11 or len(h_geo) < 11:
            continue
        w_tract = block_to_tract(w_geo)
        h_tract = block_to_tract(h_geo)
        od_tract[(h_tract, w_tract)] += jobs

    # Compute in-commuters and out-commuters per tract
    in_commuters = defaultdict(int)   # work_tract: workers from other tracts
    out_commuters = defaultdict(int)  # home_tract: workers going to other tracts

    for (h_tract, w_tract), jobs in od_tract.items():
        if h_tract != w_tract:
            in_commuters[w_tract] += jobs
            out_commuters[h_tract] += jobs

    log(f"  Computed commuting flows for {len(in_commuters)} work tracts, "
        f"{len(out_commuters)} home tracts")
    return {"in_commuters": dict(in_commuters), "out_commuters": dict(out_commuters)}


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    # Parse command line for --year
    year = None
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--year" and i < len(sys.argv) - 1:
            year = int(sys.argv[i + 1])
            break

    # Find available year
    if year:
        candidate_years = [year]
    else:
        candidate_years = CANDIDATE_YEARS

    available_year = None
    for y in candidate_years:
        log(f"Checking LODES availability for year {y}...")
        if check_year_available(y):
            available_year = y
            log(f"  Year {y} is available")
            break
        else:
            log(f"  Year {y} not available, trying next...", level="WARN")

    if not available_year:
        log("No LODES data available for any candidate year", level="ERROR")
        # Write stub so downstream doesn't break
        stub = {
            "meta": {
                "source": "LEHD LODES 8.x",
                "vintage": candidate_years[0],
                "generated": utc_now(),
                "tracts": 0,
                "note": "Failed to download LODES data"
            },
            "tracts": []
        }
        with open(OUT_FILE, "w") as fh:
            json.dump(stub, fh, indent=2)
        return 1

    year = available_year

    # Download the three files
    wac_url = f"{LODES_BASE}/wac/co_wac_S000_JT00_{year}.csv.gz"
    rac_url = f"{LODES_BASE}/rac/co_rac_S000_JT00_{year}.csv.gz"
    od_url = f"{LODES_BASE}/od/co_od_main_JT00_{year}.csv.gz"

    try:
        wac_data = download_gz(wac_url, "WAC (workplace)")
    except Exception as exc:
        log(f"WAC download failed: {exc}", level="ERROR")
        return 1

    try:
        rac_data = download_gz(rac_url, "RAC (residence)")
    except Exception as exc:
        log(f"RAC download failed: {exc}", level="ERROR")
        return 1

    try:
        od_data = download_gz(od_url, "OD (origin-destination)")
    except Exception as exc:
        log(f"OD download failed: {exc}. Continuing without commuting data.", level="WARN")
        od_data = None

    # Parse and aggregate
    log("Parsing WAC...")
    wac_rows = parse_gz_csv(wac_data)
    wac_tracts = process_wac(wac_rows)
    del wac_rows  # Free memory

    log("Parsing RAC...")
    rac_rows = parse_gz_csv(rac_data)
    rac_tracts = process_rac(rac_rows)
    del rac_rows

    od_result = {"in_commuters": {}, "out_commuters": {}}
    if od_data:
        log("Parsing OD (this may take a moment)...")
        od_rows = parse_gz_csv(od_data)
        od_result = process_od(od_rows)
        del od_rows

    # Merge all tracts
    all_geoids = set(wac_tracts.keys()) | set(rac_tracts.keys())
    # Filter to Colorado tracts only (start with '08')
    co_geoids = sorted(g for g in all_geoids if g.startswith("08"))

    log(f"Building output for {len(co_geoids)} Colorado tracts...")

    tracts_out = []
    for geoid in co_geoids:
        wac = wac_tracts.get(geoid, {})
        rac = rac_tracts.get(geoid, {})

        total_jobs = wac.get("C000", 0)
        resident_workers = rac.get("C000", 0)
        in_comm = od_result["in_commuters"].get(geoid, 0)
        out_comm = od_result["out_commuters"].get(geoid, 0)

        # Job-housing ratio
        jh_ratio = round(total_jobs / resident_workers, 3) if resident_workers > 0 else 0.0

        # County FIPS (first 5 digits)
        county_fips = geoid[:5]

        # Wage categories from WAC (jobs at workplace)
        low_wage = wac.get("CS01", 0)
        mid_wage = wac.get("CS02", 0)
        high_wage = wac.get("CS03", 0)

        # Sector breakdown from WAC
        goods_jobs = wac.get("CE01", 0)
        trade_jobs = wac.get("CE02", 0)
        service_jobs = wac.get("CE03", 0)

        tract_record = {
            "geoid": geoid,
            "county_fips": county_fips,
            # Match existing schema expected by lodes-commute.js
            "home_workers": resident_workers,
            "work_workers": total_jobs,
            "low_wage": low_wage,
            "mid_wage": mid_wage,
            "high_wage": high_wage,
            "job_housing_ratio": jh_ratio,
            # Extended fields
            "totalJobs": total_jobs,
            "residentWorkers": resident_workers,
            "inCommuters": in_comm,
            "outCommuters": out_comm,
            "jobsHousingRatio": jh_ratio,
            "goodsJobs": goods_jobs,
            "tradeJobs": trade_jobs,
            "serviceJobs": service_jobs,
            "vintage": year,
        }
        tracts_out.append(tract_record)

    result = {
        "meta": {
            "source": f"LEHD LODES 8.x",
            "vintage": year,
            "generated": utc_now(),
            "tracts": len(tracts_out),
            "note": "Real LODES data aggregated from block to tract level. "
                    "WAC=workplace, RAC=residence, OD=commuting flows."
        },
        "tracts": tracts_out,
    }

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    log(f"Wrote {len(tracts_out)} tracts to {OUT_FILE}")

    # Print summary stats
    total_jobs = sum(t["totalJobs"] for t in tracts_out)
    total_res = sum(t["residentWorkers"] for t in tracts_out)
    total_in = sum(t["inCommuters"] for t in tracts_out)
    total_out = sum(t["outCommuters"] for t in tracts_out)
    log(f"Summary: {total_jobs:,} jobs, {total_res:,} resident workers, "
        f"{total_in:,} in-commuters, {total_out:,} out-commuters")

    return 0


if __name__ == "__main__":
    sys.exit(main())
