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

# Colorado has exactly 64 counties. Any county-aggregate validation should warn
# if fewer than this number of county summary files are found. (Rule 4)
EXPECTED_CO_COUNTY_COUNT = 64

# ---------------------------------------------------------------------------
# ACS variable lists (mirror county-level build_hna_data.py)
# ---------------------------------------------------------------------------

# Variable codes verified against ACS 2023/2024 profile definitions and
# scripts/hna/build_hna_data.py (county summaries) so statewide semantics
# match county semantics key-for-key.
#
# HISTORY: the original 2026-03 version of this list carried the pre-
# 2026-05-10 mislabeling — it treated DP04_0003E-0010E as "housing units
# by structure type" (structure type actually starts at DP04_0007E; 0003E
# is vacant units and 0004E/0005E are the homeowner/rental VACANCY RATES).
# It also requested DP04_0143PE-0146PE, GRAPI codes that no longer exist
# in ACS 2023+ and 400 the whole request. The committed 08.json was hand-
# seeded with structure counts under those shifted keys, which surfaced as
# the "Observed active-market: 151458.0%" bug (PR #1033).
ACS_PROFILE_VARS = [
    'DP05_0001E',  # Total population
    'DP02_0001E',  # Total households
    'DP03_0062E',  # Median household income
    # Occupancy + vacancy
    'DP04_0001E',  # Total housing units
    'DP04_0002E',  # Occupied housing units (count)
    'DP04_0003E',  # Vacant housing units (count)
    'DP04_0004E',  # Homeowner vacancy rate (PERCENT, e.g. 0.9)
    'DP04_0005E',  # Rental vacancy rate (PERCENT, e.g. 5.4)
    # Tenure
    'DP04_0046E',  # Owner-occupied (count)
    'DP04_0046PE', # Owner-occupied (%)
    'DP04_0047E',  # Renter-occupied (count)
    'DP04_0047PE', # Renter-occupied (%)
    'DP04_0089E',  # Median home value
    'DP04_0134E',  # Median gross rent
    # Units in structure (ACS 2023+: starts at DP04_0007E)
    'DP04_0007E',  # 1-unit detached
    'DP04_0008E',  # 1-unit attached
    'DP04_0009E',  # 2 units
    'DP04_0010E',  # 3 or 4 units
    'DP04_0011E',  # 5 to 9 units
    'DP04_0012E',  # 10 to 19 units
    'DP04_0013E',  # 20 or more units
    'DP04_0014E',  # Mobile home
    # Gross rent as % of household income (GRAPI) — ACS 2023+ codes
    'DP04_0137PE', # <15%
    'DP04_0138PE', # 15-19.9%
    'DP04_0139PE', # 20-24.9%
    'DP04_0140PE', # 25-29.9%
    'DP04_0141PE', # 30-34.9%
    'DP04_0142PE', # 35%+
    'NAME',
]

# Keys from the pre-fix hand-seeded 08.json whose values carry legacy /
# shifted semantics. They are dropped from the merged output: no current
# fetch refreshes them, so leaving them would keep stale garbage alive
# (e.g. rentBurden30Plus falls back to DP04_0145PE/0146PE when the
# current-code GRAPI bins are absent).
LEGACY_PROFILE_KEYS = [
    'DP04_0006E',   # held "3-4 units" count under pre-fix shifted mapping
    'DP04_0143PE', 'DP04_0144PE', 'DP04_0145PE', 'DP04_0146PE',  # removed GRAPI codes
]

ACS_S0801_VARS = [
    'S0801_C01_001E',  # Workers 16+ (count)
    'S0801_C01_002E',  # Car, truck, or van — total parent (drove-alone + carpooled, %)
    'S0801_C01_003E',  # Drove alone (%)
    'S0801_C01_004E',  # Carpooled (%)
    'S0801_C01_005E',  # Public transit (%)
    'S0801_C01_006E',  # Walked (%)
    'S0801_C01_007E',  # Taxicab, motorcycle, bicycle, or other means (%)
    'S0801_C01_008E',  # Worked at home (%)
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

    Tries ACS1/profile → ACS5/profile for each year in
    descending order from *start_year*.
    """
    years = range(start_year, start_year - n_fallback, -1)
    for year in years:
        for series, endpoint in [('acs1', 'profile'), ('acs5', 'profile')]:
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
    Stores ``_acsYear`` and ``_acsSeries`` in the returned dict so callers can
    record which vintage and series were actually used (commuting reliability).
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
                data = {result[0][i]: result[1][i] for i in range(len(result[0]))}
                data['_acsYear'] = year
                data['_acsSeries'] = series
                return data
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


# Census ACS sentinel for "not available" (mirrors build_hna_data.py's
# normalize_acs_value; any numeric at or below this is a sentinel).
ACS_SENTINEL_THRESHOLD = -111111111


def normalize_acs_value(val):
    """Normalize ACS API sentinel values (-666666666 etc.) to None."""
    if val is None:
        return None
    try:
        s = str(val).strip()
        if s in ('', 'NA', 'null', 'None', '-'):
            return None
        f = float(s)
        if f != f or f in (float('inf'), float('-inf')):
            return None
        if f <= ACS_SENTINEL_THRESHOLD:
            return None
        return int(f) if f.is_integer() else f
    except (ValueError, OverflowError):
        return None


def normalize_acs_dict(d: dict | None) -> dict | None:
    """Apply normalize_acs_value to every value; keep non-numeric passthroughs."""
    if not isinstance(d, dict):
        return d
    out = {}
    for k, v in d.items():
        if k in ('NAME', 'state', '_acsSeries'):
            out[k] = v
        else:
            out[k] = normalize_acs_value(v)
    return out


def validate_profile_sanity(profile: dict) -> list[str]:
    """Sanity-check the fetched statewide profile before it is written.

    Guards against the counts-in-rate-fields class of corruption that
    produced the "Observed active-market: 151458.0%" bug (PR #1033):
    a value like 186000 in DP04_0004E must fail the build, not ship.

    Returns a list of human-readable problems (empty = OK).
    """
    problems: list[str] = []

    # Vacancy RATES must be plausible percentages, not unit counts.
    for var, label in (('DP04_0004E', 'homeowner vacancy rate'),
                       ('DP04_0005E', 'rental vacancy rate')):
        v = _safe_float(profile.get(var))
        if v is None:
            problems.append(f'{var} ({label}) is missing/null')
        elif not (0 <= v <= 30):
            problems.append(f'{var} ({label}) = {v} — not a plausible percent (0-30)')

    # Tenure shares must sum to ~100%.
    own = _safe_float(profile.get('DP04_0046PE'))
    rent = _safe_float(profile.get('DP04_0047PE'))
    if own is None or rent is None:
        problems.append('tenure shares DP04_0046PE/DP04_0047PE missing')
    elif not (95 <= own + rent <= 105):
        problems.append(f'tenure shares sum to {own + rent} (expected ~100)')

    # Units-in-structure counts must roughly add up to total housing units.
    total = _safe_float(profile.get('DP04_0001E'))
    struct_vars = ['DP04_0007E', 'DP04_0008E', 'DP04_0009E', 'DP04_0010E',
                   'DP04_0011E', 'DP04_0012E', 'DP04_0013E', 'DP04_0014E']
    struct_vals = [_safe_float(profile.get(v)) for v in struct_vars]
    if total and all(v is not None for v in struct_vals):
        ssum = sum(struct_vals)
        if not (0.9 * total <= ssum <= 1.1 * total):
            problems.append(
                f'structure-type sum {ssum:,.0f} vs total units {total:,.0f} '
                '(off by >10% — shifted/mislabeled keys?)')

    return problems


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
    if loaded < EXPECTED_CO_COUNTY_COUNT:
        print(
            f'  ⚠ Only {loaded} county files found; expected {EXPECTED_CO_COUNTY_COUNT}. '
            'Some counties may be missing from the aggregate.',
        )

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

    acs_profile = normalize_acs_dict(fetch_acs_profile(start_year, n_fallback))
    acs_s0801 = normalize_acs_dict(fetch_acs_s0801(start_year, n_fallback))

    if acs_profile is None and acs_s0801 is None:
        print('✗ Both ACS profile and S0801 fetches failed.', file=sys.stderr)
        return 1

    if acs_profile is None:
        print('⚠ ACS profile missing; writing partial summary', file=sys.stderr)
    if acs_s0801 is None:
        print('⚠ ACS S0801 missing; writing partial summary', file=sys.stderr)

    _warn_null_fields(acs_profile, acs_s0801)

    # Refuse to ship a profile that fails the rates-vs-counts sanity gate.
    # (Do NOT write a partially-wrong file: the previous hand-seeded file
    # survived for 4 months because nothing validated it.)
    if acs_profile is not None:
        problems = validate_profile_sanity(acs_profile)
        if problems:
            print('✗ Statewide ACS profile failed sanity validation:', file=sys.stderr)
            for p in problems:
                print(f'    - {p}', file=sys.stderr)
            return 1

    # Merge over the existing file so keys maintained by other pipelines
    # (backfill_hna_extended_acs_cache.mjs writes DP02/DP03/DP05 extended
    # vars and DP04_0080E-0088E home-value brackets) are preserved.
    # Freshly fetched values win; legacy shifted-semantics keys are dropped.
    existing: dict = {}
    try:
        with open(OUT_FILE, encoding='utf-8') as fh:
            existing = json.load(fh)
    except (OSError, ValueError):
        pass

    merged_profile = dict(existing.get('acsProfile') or {})
    for k in LEGACY_PROFILE_KEYS:
        merged_profile.pop(k, None)
    if acs_profile is not None:
        merged_profile.update(acs_profile)
    elif not merged_profile:
        merged_profile = None

    # Derive the actually-used series/year from the metadata embedded in the
    # returned S0801 dict (commuting reliability: record what was truly used).
    s0801_year = (acs_s0801 or {}).get('_acsYear', start_year)
    s0801_series = (acs_s0801 or {}).get('_acsSeries', 'acs1')

    # Count how many county summary files are already on disk for transparency.
    try:
        county_file_count = sum(
            1 for fn in os.listdir(SUMMARY_DIR)
            if fn.endswith('.json') and len(fn) == 10 and fn.startswith('08') and fn != '08.json'
        )
    except OSError:
        county_file_count = None

    # Start from the existing payload so unknown top-level blocks written by
    # other pipelines survive a refresh.
    payload: dict = dict(existing)
    payload.update({
        'updated': utc_now(),
        'geo': {
            'type': 'state',
            'geoid': STATE_FIPS,
            'label': STATE_LABEL,
        },
        'acsProfile': merged_profile,
        'acsS0801': acs_s0801 if acs_s0801 is not None else existing.get('acsS0801'),
        'source': {
            'acs_profile_endpoint': f'https://api.census.gov/data/{start_year}/acs/acs1/profile',
            'acs_s0801_endpoint': (
                f'https://api.census.gov/data/{s0801_year}/acs/{s0801_series}/subject'
            ),
            'county_coverage': (
                f'{county_file_count} of {EXPECTED_CO_COUNTY_COUNT} Colorado counties'
                if county_file_count is not None else None
            ),
        },
    })

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
