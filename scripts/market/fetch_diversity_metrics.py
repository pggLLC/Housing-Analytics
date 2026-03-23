#!/usr/bin/env python3
"""
scripts/market/fetch_diversity_metrics.py

Fetches demographic diversity metrics for Colorado census tracts from the
US Census Bureau ACS 5-Year Estimates and writes output suitable for PMA
market demand dimension scoring.

Source:  US Census Bureau ACS 5-Year Estimates (2023)
         Tables: B03001 (Hispanic/Latino origin), B02001 (Race), B16001 (Language)
Output:  data/market/diversity_metrics_co.json

Usage:
    python3 scripts/market/fetch_diversity_metrics.py

Environment variables:
    CENSUS_API_KEY  — optional Census API key for higher rate limits
"""

import json
import os
import sys
import math
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "diversity_metrics_co.json"

STATE_FIPS = "08"
TIMEOUT = 60
ACS_YEAR = 2023
ACS_BASE = f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5"

CENSUS_API_KEY = os.environ.get("CENSUS_API_KEY", "")

# ACS variables for diversity metrics
ACS_VARIABLES = [
    "GEO_ID",
    "B01003_001E",  # Total population
    # Race
    "B02001_002E",  # White alone
    "B02001_003E",  # Black/AA alone
    "B02001_004E",  # AIAN alone
    "B02001_005E",  # Asian alone
    "B02001_006E",  # NHPI alone
    "B02001_007E",  # Some other race alone
    "B02001_008E",  # Two or more races
    # Hispanic origin
    "B03001_003E",  # Hispanic or Latino
    # Language (spoken at home other than English)
    "B16001_002E",  # Speaks English only (universe: 5+)
    "B16001_001E",  # Total 5+ population
]


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def shannon_entropy(counts: list[int], total: int) -> float:
    """Shannon entropy diversity index (higher = more diverse)."""
    if total == 0:
        return 0.0
    h = 0.0
    for c in counts:
        if c > 0:
            p = c / total
            h -= p * math.log2(p)
    # Normalize to 0-1 scale (divide by log2 of number of categories)
    max_h = math.log2(len(counts)) if len(counts) > 1 else 1
    return round(h / max_h, 4) if max_h > 0 else 0.0


def fetch_acs_diversity() -> list[dict]:
    """Fetch ACS diversity variables for all Colorado tracts."""
    vars_str = ",".join(ACS_VARIABLES)
    key_param = f"&key={CENSUS_API_KEY}" if CENSUS_API_KEY else ""
    url = (
        f"{ACS_BASE}?get={vars_str}"
        f"&for=tract:*&in=state:{STATE_FIPS}{key_param}"
    )
    log(f"  Fetching ACS diversity data: {url[:120]}")
    req = urllib.request.Request(url, headers={"User-Agent": "HousingAnalytics-PMA/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            rows = json.loads(resp.read())
    except Exception as e:
        log(f"  ACS fetch failed: {e}")
        return []

    header = rows[0]
    idx = {v: i for i, v in enumerate(header)}

    def safe_int(v):
        try:
            n = int(v)
            return max(0, n)
        except (TypeError, ValueError):
            return 0

    tracts = []
    for row in rows[1:]:
        state = row[idx.get("state", -1)] if "state" in idx else STATE_FIPS
        county = row[idx.get("county", -1)] if "county" in idx else ""
        tract = row[idx.get("tract", -1)] if "tract" in idx else ""
        geoid = state + county + tract
        county_fips = (state + county).zfill(5)

        total_pop = safe_int(row[idx.get("B01003_001E", -1)])
        white = safe_int(row[idx.get("B02001_002E", -1)])
        black = safe_int(row[idx.get("B02001_003E", -1)])
        aian = safe_int(row[idx.get("B02001_004E", -1)])
        asian = safe_int(row[idx.get("B02001_005E", -1)])
        nhpi = safe_int(row[idx.get("B02001_006E", -1)])
        other_race = safe_int(row[idx.get("B02001_007E", -1)])
        two_plus = safe_int(row[idx.get("B02001_008E", -1)])
        hispanic = safe_int(row[idx.get("B03001_003E", -1)])
        eng_only_5plus = safe_int(row[idx.get("B16001_002E", -1)])
        total_5plus = safe_int(row[idx.get("B16001_001E", -1)])

        race_counts = [white, black, aian, asian, nhpi, other_race, two_plus]
        racial_diversity = shannon_entropy(race_counts, total_pop)
        immigrant_pct = round(hispanic / total_pop * 100, 1) if total_pop > 0 else 0.0
        non_eng_pct = round(
            (total_5plus - eng_only_5plus) / total_5plus * 100, 1
        ) if total_5plus > 0 else 0.0

        tracts.append({
            "geoid": geoid,
            "county_fips": county_fips,
            "total_pop": total_pop,
            "white_pct": round(white / total_pop * 100, 1) if total_pop > 0 else 0.0,
            "black_pct": round(black / total_pop * 100, 1) if total_pop > 0 else 0.0,
            "asian_pct": round(asian / total_pop * 100, 1) if total_pop > 0 else 0.0,
            "hispanic_pct": round(hispanic / total_pop * 100, 1) if total_pop > 0 else 0.0,
            "immigrant_pct": immigrant_pct,
            "non_english_pct": non_eng_pct,
            "ethnic_diversity_index": racial_diversity,
            "language_diversity_index": round(non_eng_pct / 100, 4),
            "year": ACS_YEAR,
        })

    return tracts


def main() -> int:
    log("=== Colorado Diversity Metrics Fetch ===")

    try:
        tracts = fetch_acs_diversity()
        log(f"Fetched {len(tracts)} Colorado tract diversity records")
    except Exception as e:
        log(f"ERROR: {e}")
        tracts = []

    output = {
        "meta": {
            "source": f"US Census ACS {ACS_YEAR} 5-Year Estimates (public)",
            "vintage": str(ACS_YEAR),
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": utc_now(),
            "coverage_pct": round(min(len(tracts) / 1300 * 100, 100), 1),
            "fields": {
                "geoid": "11-digit census tract GEOID",
                "county_fips": "5-digit county FIPS",
                "total_pop": "Total population (B01003_001E)",
                "white_pct": "Percent White alone",
                "black_pct": "Percent Black/African American alone",
                "asian_pct": "Percent Asian alone",
                "hispanic_pct": "Percent Hispanic or Latino",
                "immigrant_pct": "Percent Hispanic/Latino (proxy for immigrant share)",
                "non_english_pct": "Percent speaking language other than English at home",
                "ethnic_diversity_index": "Shannon entropy racial diversity index (0-1, higher = more diverse)",
                "language_diversity_index": "Non-English language share (0-1)",
            },
            "note": "Rebuild via scripts/market/fetch_diversity_metrics.py",
        },
        "tracts": tracts,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(output, fh, indent=2, ensure_ascii=False)
    log(f"Wrote {OUT_FILE} ({OUT_FILE.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
