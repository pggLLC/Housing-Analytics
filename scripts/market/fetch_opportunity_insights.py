#!/usr/bin/env python3
"""
scripts/market/fetch_opportunity_insights.py

Fetch tract-level economic mobility data from Opportunity Insights
(Chetty/Hendren, Harvard/Brown) for Colorado census tracts.

Output:
    data/market/opportunity_insights_co.json

Usage:
    python3 scripts/market/fetch_opportunity_insights.py

Source:
    https://opportunityinsights.org/data/
    Tract-level outcomes from the Opportunity Atlas

All sources are free and publicly accessible without authentication.
"""

import csv
import io
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "opportunity_insights_co.json"

STATE_FIPS = "08"

# Opportunity Insights tract outcomes — primary and fallback URLs
OI_URLS = [
    # Primary: tract_outcomes_simple (smaller, key metrics)
    "https://opportunityinsights.org/wp-content/uploads/2023/10/tract_outcomes_simple.csv",
    # Fallback: earlier upload path
    "https://opportunityinsights.org/wp-content/uploads/2018/10/tract_outcomes_simple.csv",
    # Fallback: full tract outcomes (larger file)
    "https://opportunityinsights.org/wp-content/uploads/2023/10/tract_outcomes.csv",
]

# Key fields we want to extract (column names in the CSV)
# kfr = kid family rank (expected income percentile for kids)
# jail = incarceration rate
# These columns use the naming convention: metric_gender_race_parentPercentile
DESIRED_FIELDS = {
    "kfr_pooled_pooled_p25":       "upwardMobility25",
    "kfr_pooled_pooled_p75":       "upwardMobility75",
    "jail_pooled_pooled_p25":      "incarcerationRate25",
    "kfr_top20_pooled_pooled_p25": "topQuintileProb25",
    "kfr_top20_pooled_pooled_p75": "topQuintileProb75",
    # Additional useful fields if present
    "kfr_pooled_pooled_p50":       "upwardMobility50",
    "has_dad_pooled_pooled_p25":   "twoParentRate25",
    "has_dad_pooled_pooled_p75":   "twoParentRate75",
    "teenbrth_pooled_pooled_p25":  "teenBirthRate25",
    "college_pooled_pooled_p25":   "collegeRate25",
    "college_pooled_pooled_p75":   "collegeRate75",
}

# Tract FIPS column name (varies between CSV versions)
TRACT_COL_CANDIDATES = ["tract", "cz", "czname", "state", "county"]


def download_csv(url, timeout=120):
    """Download a CSV file and return its text content."""
    print(f"  Trying: {url}")
    req = urllib.request.Request(url, headers={
        "User-Agent": "Housing-Analytics-PMA/1.0 (research; non-commercial)"
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            # Try UTF-8 first, fall back to latin-1
            try:
                return raw.decode("utf-8")
            except UnicodeDecodeError:
                return raw.decode("latin-1")
    except (urllib.error.HTTPError, urllib.error.URLError) as e:
        print(f"    Failed: {e}")
        return None


def find_tract_column(headers):
    """Find the column that contains the 11-digit tract FIPS code."""
    # Exact match first
    if "tract" in headers:
        return "tract"
    # Some versions use 'cz' or composite state+county+tract
    for candidate in ["tract_id", "geo_id", "geoid", "GEOID", "tractid"]:
        if candidate in headers:
            return candidate
    return None


def parse_tract_fips(row, tract_col, headers):
    """
    Extract 11-digit tract FIPS from a row.
    The CSV may store the tract as:
      - A single 11-digit number in a 'tract' column
      - Separate state/county/tract columns that need concatenation
    """
    if tract_col and tract_col in row:
        val = str(row[tract_col]).strip()
        # If it's already 11 digits, use it directly
        if len(val) >= 10:
            return val.zfill(11)

    # Try building from state + county + tract columns
    state = str(row.get("state", "")).strip().zfill(2)
    county = str(row.get("county", "")).strip().zfill(3)
    tract_val = str(row.get("tract", "")).strip().zfill(6)

    if state and county and tract_val and len(state) == 2:
        return state + county + tract_val

    return None


def compute_mobility_index(fields):
    """
    Compute a 0-100 composite mobility index from available metrics.
    Primary driver: upward mobility from 25th percentile (kfr_pooled_pooled_p25).
    The raw kfr value is an expected income percentile rank (0-100).
    """
    m25 = fields.get("upwardMobility25")
    m75 = fields.get("upwardMobility75")
    top20 = fields.get("topQuintileProb25")

    if m25 is not None:
        # kfr_p25 is already on a 0-100 percentile scale
        base = m25 * 100 if m25 <= 1.0 else m25

        # Boost slightly if top-quintile probability is high
        if top20 is not None:
            top20_pct = top20 * 100 if top20 <= 1.0 else top20
            # Blend: 70% base mobility + 30% top-quintile chance (scaled to 0-100)
            base = 0.7 * base + 0.3 * min(top20_pct * 5, 100)  # top20 ~0.20 max -> *5 to scale

        return round(min(max(base, 0), 100), 1)
    elif m75 is not None:
        return round(min(max((m75 * 100 if m75 <= 1.0 else m75), 0), 100), 1)
    return None


def main():
    print("=== Opportunity Insights Tract Outcomes ===")
    print(f"Output: {OUT_FILE}")

    # Try each URL until one works
    csv_text = None
    source_url = None
    for url in OI_URLS:
        csv_text = download_csv(url)
        if csv_text:
            source_url = url
            break

    if not csv_text:
        print("\nERROR: Could not download from any known URL.")
        print("The Opportunity Insights team may have moved the file.")
        print("Check: https://opportunityinsights.org/data/")
        print("Look for 'Neighborhood Characteristics' -> 'Tract Outcomes'")
        print("\nCreating empty output file with error note...")

        result = {
            "meta": {
                "source": "Opportunity Insights, Harvard/Brown",
                "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "tracts": 0,
                "error": "Download failed — URL may need manual update",
                "check_url": "https://opportunityinsights.org/data/"
            },
            "tracts": {}
        }
        OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(OUT_FILE, "w") as f:
            json.dump(result, f, indent=2)
        print(f"Wrote empty result to {OUT_FILE}")
        return 1

    print(f"  Downloaded from: {source_url}")
    print(f"  Size: {len(csv_text):,} bytes")

    # Parse CSV
    reader = csv.DictReader(io.StringIO(csv_text))
    headers = reader.fieldnames or []
    print(f"  Columns ({len(headers)}): {headers[:10]}{'...' if len(headers) > 10 else ''}")

    tract_col = find_tract_column(headers)
    print(f"  Tract column: {tract_col}")

    # Identify which desired fields are actually present
    available_fields = {}
    for csv_col, out_name in DESIRED_FIELDS.items():
        if csv_col in headers:
            available_fields[csv_col] = out_name
    print(f"  Available metrics: {list(available_fields.values())}")

    # Filter to Colorado tracts
    tracts = {}
    total_rows = 0
    co_rows = 0
    parse_errors = 0

    for row in reader:
        total_rows += 1
        fips = parse_tract_fips(row, tract_col, headers)

        if not fips:
            parse_errors += 1
            continue

        # Filter to Colorado (state FIPS 08)
        if not fips.startswith(STATE_FIPS):
            continue

        co_rows += 1

        # Extract available fields
        fields = {}
        for csv_col, out_name in available_fields.items():
            val = row.get(csv_col, "").strip()
            if val and val.lower() not in ("", ".", "na", "nan", "none"):
                try:
                    fields[out_name] = float(val)
                except ValueError:
                    pass

        # Compute composite mobility index
        mobility = compute_mobility_index(fields)
        if mobility is not None:
            fields["mobilityIndex"] = mobility

        if fields:  # Only include tracts with at least some data
            tracts[fips] = fields

    print(f"\n  Total rows: {total_rows:,}")
    print(f"  Colorado rows: {co_rows}")
    print(f"  Tracts with data: {len(tracts)}")
    if parse_errors:
        print(f"  Parse errors: {parse_errors}")

    # Build output
    result = {
        "meta": {
            "source": "Opportunity Insights, Harvard/Brown",
            "sourceUrl": source_url,
            "fetched": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "tracts": len(tracts),
            "metrics": list(set(
                k for t in tracts.values() for k in t.keys()
            )),
            "description": "Tract-level economic mobility metrics from the Opportunity Atlas. "
                           "mobilityIndex is a 0-100 composite score derived from expected "
                           "income rank for children from low-income families."
        },
        "tracts": tracts
    }

    # Write output
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w") as f:
        json.dump(result, f, indent=2)

    size_kb = OUT_FILE.stat().st_size / 1024
    print(f"\nWrote {OUT_FILE} ({size_kb:.1f} KB)")

    # Sample output
    sample_keys = list(tracts.keys())[:3]
    if sample_keys:
        print("\nSample tracts:")
        for k in sample_keys:
            print(f"  {k}: {json.dumps(tracts[k])}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
