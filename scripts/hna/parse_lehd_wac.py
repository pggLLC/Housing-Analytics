#!/usr/bin/env python3
"""
scripts/hna/parse_lehd_wac.py

Enhanced LEHD WAC (Workplace Area Characteristics) file parser.

Downloads annual LEHD WAC public files from the Census FTP and extracts:
  - Total jobs by county (with year-over-year growth)
  - Industry breakdown (CNS01–CNS20 NAICS supersectors)
  - Wage distribution (CE01 low / CE02 medium / CE03 high)
  - Multi-year historical totals (2021, 2022, 2023)

Output: data/hna/lehd/{county_fips5}.json (one file per county)

Usage:
    python scripts/hna/parse_lehd_wac.py

Environment variables:
    LODES_YEAR   - primary year to parse (default: "2023")
    LODES_YEARS  - comma-separated list of years (default: "2021,2022,2023")
    LODES_STATE  - state abbreviation lowercase (default: "co")
"""

from __future__ import annotations

import csv
import gzip
import io
import json
import os
import sys
import time
import hashlib
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent.parent

STATE  = os.environ.get("LODES_STATE", "co").lower()
YEAR   = int(os.environ.get("LODES_YEAR", "2023"))

# Years to parse for historical tracking (parse newest-first so primary year is always included)
_years_env = os.environ.get("LODES_YEARS", "2021,2022,2023")
YEARS = sorted(set(int(y.strip()) for y in _years_env.split(",") if y.strip()))

OUT_DIR   = ROOT / "data" / "hna" / "lehd"
CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "lehd_wac_cache"
CACHE_TTL_HOURS = 72

LODES_BASE = "https://lehd.ces.census.gov/data/lodes/LODES8"
WAC_SEG    = "S000"   # All jobs
WAC_TYPE   = "JT00"   # All job types

# LEHD WAC column definitions
INDUSTRY_COLS = {
    "CNS01": "Agriculture & Forestry",
    "CNS02": "Mining & Oil/Gas",
    "CNS03": "Utilities",
    "CNS04": "Construction",
    "CNS05": "Manufacturing",
    "CNS06": "Wholesale Trade",
    "CNS07": "Retail Trade",
    "CNS08": "Transportation & Warehousing",
    "CNS09": "Information",
    "CNS10": "Finance & Insurance",
    "CNS11": "Real Estate",
    "CNS12": "Professional & Technical Services",
    "CNS13": "Management",
    "CNS14": "Administrative & Support",
    "CNS15": "Educational Services",
    "CNS16": "Health Care & Social Assistance",
    "CNS17": "Arts & Entertainment",
    "CNS18": "Accommodation & Food Services",
    "CNS19": "Other Services",
    "CNS20": "Public Administration",
}

WAGE_COLS = {
    "CE01": "low",     # ≤ $1,250/month
    "CE02": "medium",  # $1,251–$3,333/month
    "CE03": "high",    # ≥ $3,333/month
}

# Total employment column
TOTAL_COL = "C000"


# ── HTTP helper ────────────────────────────────────────────────────────────────

def fetch_url(url: str, retries: int = 3, timeout: int = 120) -> bytes:
    """Fetch URL with retry/backoff and local disk cache."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_key = hashlib.md5(url.encode()).hexdigest()
    cache_file = CACHE_DIR / cache_key

    if cache_file.exists():
        age_h = (time.time() - cache_file.stat().st_mtime) / 3600
        if age_h < CACHE_TTL_HOURS:
            print(f"  [cache] {url[-60:]}", flush=True)
            return cache_file.read_bytes()

    last_err: Optional[Exception] = None
    for attempt in range(retries):
        try:
            print(f"  [fetch] {url[-80:]}", flush=True)
            req = urllib.request.Request(url, headers={"User-Agent": "lehd-wac-parser/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
            cache_file.write_bytes(data)
            return data
        except Exception as exc:
            last_err = exc
            if attempt < retries - 1:
                wait = 2 ** attempt
                print(f"  [retry {attempt + 1}] {exc!r} — waiting {wait}s", flush=True)
                time.sleep(wait)

    raise RuntimeError(f"Failed to fetch {url} after {retries} retries") from last_err


def fetch_wac_file(year: int) -> Optional[bytes]:
    """Download a gzipped LEHD WAC file for the given year.  Returns None on 404."""
    fname = f"{STATE}_wac_{WAC_SEG}_{WAC_TYPE}_{year}_S8.csv.gz"
    url   = f"{LODES_BASE}/{STATE}/wac/{fname}"
    try:
        return fetch_url(url)
    except RuntimeError as exc:
        if "404" in str(exc) or "HTTP Error 404" in str(exc):
            print(f"  WAC file not available for year {year} (404 — may not be published yet)", flush=True)
            return None
        raise


# ── WAC parsing ───────────────────────────────────────────────────────────────

def parse_wac_csv(raw_gz: bytes) -> list[dict]:
    """Decompress and parse a LEHD WAC CSV file.  Returns list of row dicts."""
    with gzip.GzipFile(fileobj=io.BytesIO(raw_gz)) as gz:
        content = gz.read().decode("utf-8", errors="replace")
    reader = csv.DictReader(io.StringIO(content))
    return list(reader)


def aggregate_by_county(rows: list[dict]) -> dict[str, dict]:
    """
    Aggregate WAC rows to county level.

    WAC tract GEOIDs are 15-digit FIPS.  The first 5 digits are the state+county FIPS.
    Returns { county_fips5: { TOTAL, CNS01…CNS20, CE01…CE03 } }
    """
    county_agg: dict[str, dict] = {}

    for row in rows:
        w_geocode = row.get("w_geocode", "")
        if len(w_geocode) < 5:
            continue
        county = w_geocode[:5]
        if not county.startswith("08"):   # Colorado only
            continue

        if county not in county_agg:
            agg: dict = {"C000": 0}
            for col in INDUSTRY_COLS:
                agg[col] = 0
            for col in WAGE_COLS:
                agg[col] = 0
            county_agg[county] = agg

        agg = county_agg[county]

        def add(key: str) -> None:
            try:
                agg[key] += int(row.get(key, 0) or 0)
            except (ValueError, TypeError):
                pass

        add(TOTAL_COL)
        for col in INDUSTRY_COLS:
            add(col)
        for col in WAGE_COLS:
            add(col)

    return county_agg


def validate_county_row(county: str, agg: dict) -> list[str]:
    """Return validation error strings (empty = valid)."""
    errors: list[str] = []

    total = agg.get(TOTAL_COL, 0)
    wage_sum = sum(agg.get(c, 0) for c in WAGE_COLS)
    ind_sum  = sum(agg.get(c, 0) for c in INDUSTRY_COLS)

    if total <= 0:
        errors.append(f"County {county}: total jobs = 0")
    if total > 0 and abs(wage_sum - total) / total > 0.02:
        errors.append(f"County {county}: wage bins sum {wage_sum} differs from total {total} by >2%")
    if total > 0 and ind_sum < total * 0.95:
        errors.append(f"County {county}: industry sum {ind_sum} < 95% of total {total}")

    return errors


# ── Output formatting ─────────────────────────────────────────────────────────

def build_county_record(
    county_fips5: str,
    primary_agg: dict,
    primary_year: int,
    historical: dict[int, dict],
) -> dict:
    """Build the output JSON object for a single county."""
    total = primary_agg.get(TOTAL_COL, 0)

    # Industries sorted by count (descending)
    industries = []
    for col, label in INDUSTRY_COLS.items():
        count = primary_agg.get(col, 0)
        if count > 0:
            pct = round((count / total) * 100, 1) if total > 0 else 0.0
            industries.append({"naics": col, "label": label, "count": count, "pct": pct})
    industries.sort(key=lambda x: x["count"], reverse=True)

    # Wage distribution
    wages = {
        "low":    primary_agg.get("CE01", 0),
        "medium": primary_agg.get("CE02", 0),
        "high":   primary_agg.get("CE03", 0),
    }

    # Historical totals
    hist_years  = sorted(historical.keys())
    hist_totals = [historical[y].get(TOTAL_COL, 0) for y in hist_years]

    # Year-over-year growth (vs. previous year if available)
    prev_year = primary_year - 1
    yoy_growth: Optional[float] = None
    if prev_year in historical:
        prev_total = historical[prev_year].get(TOTAL_COL, 0)
        if prev_total > 0:
            yoy_growth = round(((total - prev_total) / prev_total) * 100, 2)

    return {
        "year":            primary_year,
        "county":          county_fips5,
        "totalJobs":       total,
        "yoyGrowth":       yoy_growth,
        "industries":      industries,
        "wages":           wages,
        "historicalYears": hist_years,
        "historicalTotals": hist_totals,
        "source":          f"LEHD LODES8 WAC {WAC_SEG}/{WAC_TYPE} annual files",
    }


# ── Main ───────────────────────────────────────────────────────────────────────

def build() -> int:
    print("=" * 60)
    print("parse_lehd_wac.py — Phase 3 Enhanced LEHD WAC Parser")
    print("=" * 60)

    # 1. Download WAC files for all years
    print(f"\n1. Downloading LEHD WAC files (state={STATE.upper()}, years={YEARS})…")
    year_rows: dict[int, list[dict]] = {}
    for yr in YEARS:
        raw = fetch_wac_file(yr)
        if raw is None:
            print(f"  Skipping year {yr} (file not available)")
            continue
        rows = parse_wac_csv(raw)
        year_rows[yr] = rows
        print(f"  Year {yr}: {len(rows):,} tract rows parsed")

    if not year_rows:
        print("ERROR: No WAC files could be downloaded.", file=sys.stderr)
        return 1

    # 2. Aggregate by county for each year
    print("\n2. Aggregating to county level…")
    year_county: dict[int, dict[str, dict]] = {}
    for yr, rows in year_rows.items():
        year_county[yr] = aggregate_by_county(rows)
        print(f"  Year {yr}: {len(year_county[yr])} counties")

    # Determine primary year (prefer YEAR if available, else newest)
    primary_year = YEAR if YEAR in year_county else max(year_county.keys())
    print(f"  Primary year: {primary_year}")

    # 3. Validate + write county output files
    print("\n3. Writing county output files…")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    primary_counties = year_county[primary_year]
    all_errors: list[str] = []
    written = 0

    for county_fips5, agg in sorted(primary_counties.items()):
        errs = validate_county_row(county_fips5, agg)
        all_errors.extend(errs)
        for e in errs:
            print(f"  WARN: {e}", flush=True)

        # Build historical map for this county
        historical: dict[int, dict] = {}
        for yr, county_map in year_county.items():
            if county_fips5 in county_map:
                historical[yr] = county_map[county_fips5]

        record = build_county_record(county_fips5, agg, primary_year, historical)
        out_path = OUT_DIR / f"{county_fips5}.json"
        out_path.write_text(json.dumps(record, indent=2, ensure_ascii=False), encoding="utf-8")
        written += 1

    print(f"  Written: {written} county files → {OUT_DIR}")

    # 4. Summary
    print("\n4. Summary")
    print(f"   Counties written:   {written}")
    print(f"   Validation errors:  {len(all_errors)}")
    print(f"   Primary year:       {primary_year}")
    print(f"   Historical years:   {sorted(year_county.keys())}")

    if all_errors:
        print("\nValidation warnings:")
        for e in all_errors[:10]:
            print(f"  {e}")
        if len(all_errors) > 10:
            print(f"  … and {len(all_errors) - 10} more")

    print(f"\n✅ Done.  {written} county LEHD files written.")
    return 0


if __name__ == "__main__":
    sys.exit(build())
