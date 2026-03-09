#!/usr/bin/env python3
"""
fetch_census_state_hna.py — Fetch state-level ACS data for Colorado HNA summary.

Queries the Census ACS 1-year Profile and S0801 Subject tables for Colorado
(state FIPS 08) and writes a JSON summary to data/hna/summary/08.json in the
same structure used by county-level summary files.

Optionally compares the state-level Census data against county aggregates
and reports any discrepancies > 5% to stdout for review.

Usage:
    python3 scripts/fetch_census_state_hna.py [--validate-counties]

Environment variables:
    CENSUS_API_KEY  — Census Bureau API key (free at https://api.census.gov/data/key_signup.html)
    ACS_START_YEAR  — ACS vintage year to request (default: 2024)
    ACS_FALLBACK_YEARS — number of prior years to try on failure (default: 3)

Output:
    data/hna/summary/08.json
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
OUT_FILE = os.path.join(ROOT, 'data', 'hna', 'summary', '08.json')
SUMMARY_DIR = os.path.join(ROOT, 'data', 'hna', 'summary')

STATE_FIPS = '08'
STATE_LABEL = 'Colorado'

# ---------------------------------------------------------------------------
# ACS variable lists (mirror county-level build_hna_data.py)
# ---------------------------------------------------------------------------

ACS_PROFILE_VARS = [
    'DP05_0001E',  # Total population
    'DP02_0001E',  # Total households
    'DP03_0062E',  # Median household income
    'DP04_0001E',  # Total housing units
    'DP04_0047PE', # Owner-occupied (%)
    'DP04_0046PE', # Renter-occupied (%)
    'DP04_0089E',  # Median home value
    'DP04_0134E',  # Median gross rent
    # Housing units by structure type
    'DP04_0003E', 'DP04_0004E', 'DP04_0005E', 'DP04_0006E',
    'DP04_0007E', 'DP04_0008E', 'DP04_0009E', 'DP04_0010E',
    # Gross rent as % of household income
    'DP04_0142PE', 'DP04_0143PE', 'DP04_0144PE', 'DP04_0145PE', 'DP04_0146PE',
    'NAME',
]

ACS_S0801_VARS = [
    'S0801_C01_001E',  # Workers 16+
    'S0801_C01_002E',  # Drove alone (%)
    'S0801_C01_003E',  # Car/truck/van (%)
    'S0801_C01_004E',  # Carpooled (%)
    'S0801_C01_005E',  # Public transit (%)
    'S0801_C01_006E',  # Walked (%)
    'S0801_C01_007E',  # Other means (%)
    'S0801_C01_018E',  # Mean travel time to work (minutes)
    'NAME',
]

# Numeric fields that must never be null/missing in output (Rule 2)
REQUIRED_NUMERIC_FIELDS = [
    'DP05_0001E',  # population
    'DP04_0001E',  # housing units
    'S0801_C01_001E',  # workers
]

# Discrepancy threshold for county aggregate validation (5 %)
DISCREPANCY_THRESHOLD = 0.05


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def census_key() -> str | None:
    k = os.environ.get('CENSUS_API_KEY', '').strip()
    return k or None


def acs_start_year() -> int:
    return int(os.environ.get('ACS_START_YEAR', '2024').strip() or '2024')


def http_get_json(url: str, timeout: int = 30, retries: int = 3,
                  backoff: float = 1.7) -> list | dict | None:
    """Fetch *url* and parse as JSON. Returns None on error."""
    wait = 1.0
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'HNA-ETL/1.0'})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read())
        except Exception as exc:
            if attempt < retries - 1:
                time.sleep(wait)
                wait *= backoff
            else:
                # Redact key from error message before printing
                key = census_key() or ''
                msg = str(exc)
                if len(key) >= 8:
                    msg = msg.replace(key, '***')
                print(f'⚠ HTTP error: {msg}', file=sys.stderr)
    return None


# ---------------------------------------------------------------------------
# ACS fetch helpers
# ---------------------------------------------------------------------------

def _build_profile_url(year: int, series: str, endpoint: str) -> str:
    """Build a Census ACS URL for Colorado state-level data."""
    key = census_key()
    base = f'https://api.census.gov/data/{year}/acs/{series}/{endpoint}'
    # Use manual query-string construction to preserve literal colons in
    # Census geography parameters (urlencode encodes ':' as '%3A').
    qs = f"get={','.join(ACS_PROFILE_VARS)}&for=state:{STATE_FIPS}"
    if key:
        qs += f"&key={urllib.parse.quote(key, safe='')}"
    return f"{base}?{qs}"


def _build_s0801_url(year: int, series: str) -> str:
    """Build a Census ACS S0801 URL for Colorado state-level data."""
    key = census_key()
    base = f'https://api.census.gov/data/{year}/acs/{series}/subject'
    qs = f"get={','.join(ACS_S0801_VARS)}&for=state:{STATE_FIPS}"
    if key:
        qs += f"&key={urllib.parse.quote(key, safe='')}"
    return f"{base}?{qs}"


def fetch_acs_profile(start_year: int, n_fallback: int) -> dict | None:
    """Fetch ACS Profile variables for Colorado state level.

    Tries ACS1/profile → ACS1/subject → ACS5/profile for each year in
    descending order from *start_year*.
    """
    years = range(start_year, start_year - n_fallback, -1)
    for year in years:
        for series, endpoint in [('acs1', 'profile'), ('acs1', 'subject'), ('acs5', 'profile')]:
            url = _build_profile_url(year, series, endpoint)
            result = http_get_json(url)
            if result and len(result) > 1:
                if year != start_year:
                    print(
                        f'ℹ ACS profile: resolved via {series}/{endpoint} year={year}',
                        file=sys.stderr,
                    )
                return {result[0][i]: result[1][i] for i in range(len(result[0]))}
    print(
        f'⚠ Could not fetch ACS profile for state:{STATE_FIPS} (tried years {list(years)})',
        file=sys.stderr,
    )
    return None


def fetch_acs_s0801(start_year: int, n_fallback: int) -> dict | None:
    """Fetch ACS S0801 (Commuting) variables for Colorado state level.

    Tries ACS1/subject → ACS5/subject for each year in descending order.
    """
    years = range(start_year, start_year - n_fallback, -1)
    for year in years:
        for series in ('acs1', 'acs5'):
            url = _build_s0801_url(year, series)
            result = http_get_json(url)
            if result and len(result) > 1:
                if year != start_year or series != 'acs1':
                    print(
                        f'ℹ ACS S0801: resolved via {series}/subject year={year}',
                        file=sys.stderr,
                    )
                return {result[0][i]: result[1][i] for i in range(len(result[0]))}
    print(
        f'⚠ Could not fetch ACS S0801 for state:{STATE_FIPS} (tried years {list(years)})',
        file=sys.stderr,
    )
    return None


# ---------------------------------------------------------------------------
# Data quality validation
# ---------------------------------------------------------------------------

def _safe_float(val: object) -> float | None:
    """Convert *val* to float; return None on failure."""
    if val is None:
        return None
    try:
        f = float(val)
        return f if f >= 0 else None
    except (TypeError, ValueError):
        return None


def validate_against_county_aggregates(
    state_profile: dict | None,
    state_s0801: dict | None,
) -> None:
    """Compare state-level Census data against county aggregate totals.

    Loads all county summary files from data/hna/summary/ and sums numeric
    fields that can be aggregated (populations, unit counts, worker totals).
    Reports discrepancies > DISCREPANCY_THRESHOLD (5 %) to stdout.
    """
    print('\n── County aggregate validation ──')

    # Collect county files (5-digit FIPS starting with 08)
    county_files = [
        os.path.join(SUMMARY_DIR, fn)
        for fn in os.listdir(SUMMARY_DIR)
        if fn.endswith('.json')
        and len(fn) == 10  # "08XXX.json" = 5-digit FIPS + .json
        and fn.startswith('08')
        and fn != '08.json'
    ]

    if not county_files:
        print('  ⚠ No county summary files found — skipping validation')
        return

    # Fields to aggregate across counties
    agg_profile_fields = ['DP05_0001E', 'DP04_0001E', 'DP02_0001E']
    agg_s0801_fields = ['S0801_C01_001E']

    county_totals_profile: dict[str, float] = {f: 0.0 for f in agg_profile_fields}
    county_totals_s0801: dict[str, float] = {f: 0.0 for f in agg_s0801_fields}
    loaded = 0

    for fp in county_files:
        try:
            with open(fp, encoding='utf-8') as fh:
                rec = json.load(fh)
            prof = rec.get('acsProfile') or {}
            s08 = rec.get('acsS0801') or {}
            for f in agg_profile_fields:
                v = _safe_float(prof.get(f))
                if v is not None:
                    county_totals_profile[f] += v
            for f in agg_s0801_fields:
                v = _safe_float(s08.get(f))
                if v is not None:
                    county_totals_s0801[f] += v
            loaded += 1
        except Exception as exc:
            print(f'  ⚠ Could not load {fp}: {exc}')

    print(f'  Loaded {loaded} of {len(county_files)} county files')

    def check(label: str, state_val: object, county_agg: float) -> None:
        sv = _safe_float(state_val)
        if sv is None:
            print(f'  ⚠ {label}: state value is null/missing — cannot validate')
            return
        if county_agg <= 0:
            print(f'  ⚠ {label}: county aggregate is zero — cannot validate')
            return
        diff = abs(sv - county_agg) / county_agg
        status = '✓' if diff <= DISCREPANCY_THRESHOLD else '⚠'
        print(
            f'  {status} {label}: state={sv:,.0f}  county_sum={county_agg:,.0f}'
            f'  diff={diff:.1%}'
            + (' ← exceeds 5% threshold' if diff > DISCREPANCY_THRESHOLD else '')
        )

    prof = state_profile or {}
    s08 = state_s0801 or {}

    for f in agg_profile_fields:
        check(f, prof.get(f), county_totals_profile[f])
    for f in agg_s0801_fields:
        check(f, s08.get(f), county_totals_s0801[f])

    print()


def _warn_null_fields(profile: dict | None, s0801: dict | None) -> None:
    """Log warnings for missing or null values in required fields (Rule 2)."""
    all_data = {**(profile or {}), **(s0801 or {})}
    for field in REQUIRED_NUMERIC_FIELDS:
        val = all_data.get(field)
        if val is None or str(val).strip() in ('', 'null', 'None'):
            print(f'⚠ Required field {field!r} is null or missing', file=sys.stderr)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(validate_counties: bool = False) -> int:
    start_year = acs_start_year()
    n_fallback = int(os.environ.get('ACS_FALLBACK_YEARS', '3').strip() or '3')

    print(f'Fetching ACS {start_year} state-level data for Colorado (FIPS {STATE_FIPS})…')

    acs_profile = fetch_acs_profile(start_year, n_fallback)
    acs_s0801 = fetch_acs_s0801(start_year, n_fallback)

    if acs_profile is None and acs_s0801 is None:
        print('✗ Both ACS profile and S0801 fetches failed.', file=sys.stderr)
        return 1

    if acs_profile is None:
        print('⚠ ACS profile missing; writing partial summary', file=sys.stderr)
    if acs_s0801 is None:
        print('⚠ ACS S0801 missing; writing partial summary', file=sys.stderr)

    _warn_null_fields(acs_profile, acs_s0801)

    payload: dict = {
        'updated': utc_now(),
        'geo': {
            'type': 'state',
            'geoid': STATE_FIPS,
            'label': STATE_LABEL,
        },
        'acsProfile': acs_profile,
        'acsS0801': acs_s0801,
        'source': {
            'acs_profile_endpoint': f'https://api.census.gov/data/{start_year}/acs/acs1/profile',
            'acs_s0801_endpoint': f'https://api.census.gov/data/{start_year}/acs/acs1/subject',
        },
    }

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh)

    print(f'✓ Wrote {OUT_FILE}')

    if validate_counties:
        validate_against_county_aggregates(acs_profile, acs_s0801)

    return 0


if __name__ == '__main__':
    validate = '--validate-counties' in sys.argv
    sys.exit(main(validate_counties=validate))
