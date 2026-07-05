#!/usr/bin/env python3
"""
build_place_ami_gap.py
======================
Build the affordability-gap datasets from ACS tenure-aware tables, keyed by
7-digit place GEOID (place file) and 5-digit county FIPS (county file).

Background
----------
The repo previously held only ``data/co_ami_gap_by_county.json`` — a
county-level estimate of the housing-unit deficit at each AMI threshold.
``build_ranking_index.py`` then derived per-place values by *proportionally
scaling the county aggregate by population share*. That meant any two
places in the same county produced **identical per-capita AMI mix
profiles**: Fruita and Clifton (both Mesa County) showed the same shape
of housing-unit deficit, with only the absolute counts differing by
population share. That was the smoking-gun bug behind issue #761.

This script replaces the proportional-scaling hack with genuinely
place-specific data, and (since methodology v2) also regenerates the
county file so both stay in lockstep.

Methodology v2 — renter-household demand
----------------------------------------
Methodology v1 compared ALL-tenure household demand (ACS B19001, owners
included) against renter-only supply (ACS B25063 gross-rent distribution).
That construction structurally inflates gaps ~2.5–4× versus professional
HNA practice (e.g. Root Policy Research's SB24-174-aligned county HNAs),
which compute the rental gap as RENTER households below the income
threshold vs rental units priced affordable at that threshold.

v2 switches the demand side to renter households from ACS B25118
(Tenure × Household Income). For each AMI tier T in
{30, 40, 50, 60, 70, 80, 100}:

  threshold_income = ami_4person × (T / 100)
  threshold_rent   = threshold_income × 0.30 / 12       # max affordable

  households_le_T  = renter households ≤ threshold_income
                     (linear-interpolated cumulative count, B25118 bins)
                     clamped to all-tenure households ≤ threshold_income
                     (B19001) to absorb ACS cross-table sampling noise
  units_priced_affordable_le_T = linear-interpolated cumulative count
                     from B25063 bins
  gap_T            = households_le_T − units_priced_affordable_le_T

The v1 all-tenure series is retained in each record as
``all_households_le_ami_pct`` (from B19001) so history stays explainable
and consumers that use it as a population proxy keep working.

Linear interpolation is used within bins for both files. (The pre-v2
static county file used a lognormal model; linear is sufficient for
relative ordering, is identical between the two files, and is dramatically
simpler to validate. The methodology note in the output records this.)

Data sources
------------
Primary: Census ACS 5-year API (needs CENSUS_API_KEY — the API rejects
keyless requests). Fallback: the Census Reporter API
(api.censusreporter.org), which serves the same ACS releases without a
key; used automatically when no key is configured (e.g. local runs).

Output
------
    data/co_ami_gap_by_place.json    (keyed by 7-digit place GEOID;
                                      gap stored as households − units,
                                      positive = deficit)
    data/co_ami_gap_by_county.json   (counties list + statewide record;
                                      gap stored as units − households,
                                      negative = deficit, and coverage =
                                      units/households — both preserved
                                      from the original county file's
                                      conventions, which js/co-ami-gap.js
                                      and colorado-deep-dive.js rely on)

Usage
-----
    python3 scripts/hna/build_place_ami_gap.py                # both files
    python3 scripts/hna/build_place_ami_gap.py --geo place
    python3 scripts/hna/build_place_ami_gap.py --geo county
    python3 scripts/hna/build_place_ami_gap.py --vintage 2024
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
HUD_FILE = os.path.join(REPO_ROOT, "data", "hud-fmr-income-limits.json")
GEO_REGISTRY = os.path.join(REPO_ROOT, "data", "hna", "geography-registry.json")
OUT_FILE = os.path.join(REPO_ROOT, "data", "co_ami_gap_by_place.json")
COUNTY_OUT_FILE = os.path.join(REPO_ROOT, "data", "co_ami_gap_by_county.json")
PLACE_COUNTY_CACHE = os.path.join(
    REPO_ROOT, "data", "hna", "derived", "place_county_lookup.json"
)

DEFAULT_VINTAGE = 2024
COLORADO_FIPS = "08"

METHODOLOGY_VERSION = 2

# HUD FY2025 Colorado state median family income (4-person). The HUD income
# limits file only carries county rows, so the statewide record's AMI is
# pinned here. scripts/qa_stage1.py asserts this exact value.
STATEWIDE_AMI_4PERSON = 107_200

# AMI tiers we report for each geography (matches the county file's keys)
AMI_TIERS = (30, 40, 50, 60, 70, 80, 100)

# B19001 income bins — (lower, upper, variable). ALL households (owners +
# renters). Open-ended bin uses None for upper. Retained as the legacy
# all-tenure series (all_households_le_ami_pct); NOT the gap demand side
# since methodology v2.
B19001_BINS: list[tuple[int, int | None, str]] = [
    (0,       9_999,   "B19001_002E"),
    (10_000,  14_999,  "B19001_003E"),
    (15_000,  19_999,  "B19001_004E"),
    (20_000,  24_999,  "B19001_005E"),
    (25_000,  29_999,  "B19001_006E"),
    (30_000,  34_999,  "B19001_007E"),
    (35_000,  39_999,  "B19001_008E"),
    (40_000,  44_999,  "B19001_009E"),
    (45_000,  49_999,  "B19001_010E"),
    (50_000,  59_999,  "B19001_011E"),
    (60_000,  74_999,  "B19001_012E"),
    (75_000,  99_999,  "B19001_013E"),
    (100_000, 124_999, "B19001_014E"),
    (125_000, 149_999, "B19001_015E"),
    (150_000, 199_999, "B19001_016E"),
    (200_000, None,    "B19001_017E"),  # open-ended top bin
]

# B25118 renter-household income bins — (lower, upper, variable). RENTER
# households only (Tenure × Household Income). This is the gap demand side
# since methodology v2. Coarser than B19001 (11 bins vs 16) but tenure-
# correct; linear within-bin interpolation applies as elsewhere.
B25118_RENTER_BINS: list[tuple[int, int | None, str]] = [
    (0,       4_999,   "B25118_015E"),
    (5_000,   9_999,   "B25118_016E"),
    (10_000,  14_999,  "B25118_017E"),
    (15_000,  19_999,  "B25118_018E"),
    (20_000,  24_999,  "B25118_019E"),
    (25_000,  34_999,  "B25118_020E"),
    (35_000,  49_999,  "B25118_021E"),
    (50_000,  74_999,  "B25118_022E"),
    (75_000,  99_999,  "B25118_023E"),
    (100_000, 149_999, "B25118_024E"),
    (150_000, None,    "B25118_025E"),  # open-ended top bin
]

B25118_RENTER_TOTAL = "B25118_014E"

# B25063 gross-rent bins — (lower, upper, variable). Renter-occupied units
# only. Variables 003E..026E. "No cash rent" (027E) is excluded since those
# units are not market-rate priced. "With cash rent" (002E) is the divisor.
B25063_BINS: list[tuple[int, int | None, str]] = [
    (0,     99,    "B25063_003E"),
    (100,   149,   "B25063_004E"),
    (150,   199,   "B25063_005E"),
    (200,   249,   "B25063_006E"),
    (250,   299,   "B25063_007E"),
    (300,   349,   "B25063_008E"),
    (350,   399,   "B25063_009E"),
    (400,   449,   "B25063_010E"),
    (450,   499,   "B25063_011E"),
    (500,   549,   "B25063_012E"),
    (550,   599,   "B25063_013E"),
    (600,   649,   "B25063_014E"),
    (650,   699,   "B25063_015E"),
    (700,   749,   "B25063_016E"),
    (750,   799,   "B25063_017E"),
    (800,   899,   "B25063_018E"),
    (900,   999,   "B25063_019E"),
    (1_000, 1_249, "B25063_020E"),
    (1_250, 1_499, "B25063_021E"),
    (1_500, 1_999, "B25063_022E"),
    (2_000, 2_499, "B25063_023E"),
    (2_500, 2_999, "B25063_024E"),
    (3_000, 3_499, "B25063_025E"),
    (3_500, None,  "B25063_026E"),  # open-ended top bin
]

METHODOLOGY_NOTES = [
    "Methodology v2 (2026-07): the gap's demand side is RENTER households "
    "(ACS B25118, Tenure × Household Income) at or below each income "
    "threshold — matching professional HNA practice (renter households vs "
    "rental units). v1 used ALL households (B19001, owners included) "
    "against renter-only supply, which structurally inflated gaps ~2.5-4x. "
    "The v1 all-tenure series is retained as all_households_le_ami_pct.",
    "Income thresholds use HUD FY2025 4-person AMI for the geography's "
    "county (statewide record uses the HUD FY2025 Colorado state median).",
    "Priced-affordable units come from ACS table B25063 (gross rent, "
    "renter-occupied with cash rent), counted at or below the rent "
    "threshold equal to 30% of monthly threshold income.",
    "Gap = renter households at-or-below threshold minus units priced "
    "affordable at-or-below threshold.",
    "Per-tier renter-household demand is clamped to the corresponding "
    "all-household cumulative count from B19001. This prevents small-place "
    "ACS cross-table sampling noise from reporting more renter households "
    "than total households at the same AMI threshold.",
    "Linear interpolation within income/rent bins; the open-ended top bin "
    "uses a 2x-floor heuristic for the upper edge (it never binds at "
    "tiers <= 100% AMI). The pre-v2 county file used a lognormal model; "
    "both files now share the linear method so place and county figures "
    "are directly comparable.",
    "Limitations: (1) AMI thresholds are county-level (HUD); a place "
    "spanning two counties uses its dominant containing county. "
    "(2) Units are priced-affordable, not guaranteed vacant/available, "
    "and some are occupied by higher-income households. (3) B25118 bins "
    "are coarser than B19001; within-bin linear interpolation is the "
    "main approximation at low tiers.",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def http_get_json(url: str, *, timeout: int = 60, retries: int = 3) -> Any:
    """Fetch JSON with simple retry/backoff on transient errors."""
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "HousingAnalytics/1.0 build_place_ami_gap.py"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as err:  # noqa: BLE001
            last_err = err
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"GET {url} failed after {retries} attempts: {last_err}")


# ---------------------------------------------------------------------------
# ACS fetch layer — Census API (keyed) with Census Reporter fallback
# ---------------------------------------------------------------------------

# geo level → (Census API for/in clauses, Census Reporter geo_ids expression)
_GEO_LEVELS = {
    "place":  ({"for": "place:*", "in": f"state:{COLORADO_FIPS}"},
               f"160|04000US{COLORADO_FIPS}"),
    "county": ({"for": "county:*", "in": f"state:{COLORADO_FIPS}"},
               f"050|04000US{COLORADO_FIPS}"),
    "state":  ({"for": f"state:{COLORADO_FIPS}"},
               f"04000US{COLORADO_FIPS}"),
}


def _row_geoid(level: str, r: dict[str, Any]) -> str:
    if level == "place":
        return f"{str(r.get('state', '')).zfill(2)}{str(r.get('place', '')).zfill(5)}"
    if level == "county":
        return f"{str(r.get('state', '')).zfill(2)}{str(r.get('county', '')).zfill(3)}"
    return str(r.get("state", "")).zfill(2)


def fetch_acs_census_api(
    vintage: int, variables: list[str], level: str, api_key: str
) -> dict[str, dict[str, Any]]:
    """Fetch from the official Census ACS 5-year API. Returns {geoid: row}."""
    geo_params, _ = _GEO_LEVELS[level]
    params = {"get": ",".join(["NAME"] + variables), **geo_params, "key": api_key}
    url = f"https://api.census.gov/data/{vintage}/acs/acs5?{urllib.parse.urlencode(params)}"
    raw = http_get_json(url, timeout=120)
    if not raw or len(raw) < 2:
        raise RuntimeError(f"Empty ACS response for {vintage} {level} query")
    header, *rows = raw
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        rec = dict(zip(header, row))
        out[_row_geoid(level, rec)] = rec
    return out


def fetch_acs_censusreporter(
    vintage: int, tables: list[str], level: str
) -> dict[str, dict[str, Any]]:
    """Fetch whole ACS tables from Census Reporter (keyless mirror).

    Translates Census Reporter's variable naming ('B25118014') back to the
    Census API's ('B25118_014E') so downstream code sees one row shape.
    Raises if the requested vintage's release isn't served.
    """
    _, geo_ids = _GEO_LEVELS[level]
    url = (
        f"https://api.censusreporter.org/1.0/data/show/acs{vintage}_5yr"
        f"?table_ids={','.join(tables)}&geo_ids={urllib.parse.quote(geo_ids, safe='|,')}"
    )
    raw = http_get_json(url, timeout=120)
    if "error" in raw:
        raise RuntimeError(f"Census Reporter: {raw['error']}")
    geo_names = {k: v.get("name", "") for k, v in raw.get("geography", {}).items()}
    out: dict[str, dict[str, Any]] = {}
    for cr_geoid, table_data in raw.get("data", {}).items():
        # Census Reporter geoids look like 16000US0801090 / 05000US08067 /
        # 04000US08 — the FIPS follows the 'US' separator.
        fips = cr_geoid.split("US", 1)[-1]
        row: dict[str, Any] = {"NAME": geo_names.get(cr_geoid, fips)}
        for table_id, blocks in table_data.items():
            for cr_var, val in (blocks.get("estimate") or {}).items():
                # 'B25118014' → 'B25118_014E'
                row[f"{table_id}_{cr_var[len(table_id):]}E"] = val
        out[fips] = row
    return out


def fetch_acs_rows(
    vintage: int, variables: list[str], tables: list[str], level: str
) -> dict[str, dict[str, Any]]:
    """Fetch ACS rows for every CO geography at *level*. Returns {geoid: row}.

    Prefers the official Census API when CENSUS_API_KEY is set (CI); falls
    back to Census Reporter otherwise (the Census API rejects keyless
    requests with a redirect to missing_key.html).
    """
    api_key = os.environ.get("CENSUS_API_KEY", "").strip()
    if api_key:
        return fetch_acs_census_api(vintage, variables, level, api_key)
    print(f"  [info] CENSUS_API_KEY not set — fetching {level} data via "
          f"Census Reporter (acs{vintage}_5yr)")
    return fetch_acs_censusreporter(vintage, tables, level)


def safe_int(v: Any) -> int:
    """Parse an ACS cell. Negative values (annotation codes like -666666666)
    indicate suppressed data and are mapped to 0."""
    try:
        n = int(float(v))
        return n if n >= 0 else 0
    except (ValueError, TypeError):
        return 0


def cumulative_count_le_threshold(
    bins: list[tuple[int, int | None, str]],
    counts: dict[str, int],
    threshold: float,
) -> int:
    """Compute the cumulative count of items in bins whose upper edge is at
    or below `threshold`, plus a linear-interpolated portion of the bin
    that contains the threshold.

    The open-ended top bin (upper=None) is treated as having a "virtual
    upper" equal to lower × 2 for interpolation purposes; thresholds above
    the top bin's lower contribute proportionally up to that virtual cap.
    """
    total = 0
    for lower, upper, var in bins:
        n = safe_int(counts.get(var, 0))
        if n <= 0:
            continue
        if upper is None:
            # Open-ended top bin — only contribute if threshold exceeds lower
            if threshold <= lower:
                continue
            virtual_upper = lower * 2  # heuristic: doubles the floor
            frac = min(1.0, (threshold - lower) / (virtual_upper - lower))
            total += int(round(n * frac))
        elif threshold >= upper:
            total += n
        elif threshold <= lower:
            continue
        else:
            # Threshold falls inside this bin → linear interpolation
            frac = (threshold - lower) / (upper - lower)
            total += int(round(n * max(0.0, min(1.0, frac))))
    return total


def load_county_ami_lookup() -> dict[str, int]:
    """Return a {county_fips5: ami_4person} dict from HUD income limits."""
    with open(HUD_FILE, "r", encoding="utf-8") as f:
        d = json.load(f)
    counties = d.get("counties", [])
    out: dict[str, int] = {}
    for c in counties:
        fips = str(c.get("fips", "")).zfill(5)
        ami = int(c.get("income_limits", {}).get("ami_4person", 0) or 0)
        if fips and ami > 0:
            out[fips] = ami
    return out


def load_place_county_lookup() -> dict[str, str]:
    """Return a {place_geoid7: county_fips5} dict.

    Prefers a cached lookup at data/hna/derived/place_county_lookup.json. Falls
    back to the geography registry if cache is absent. The geography registry
    has many CDPs with containingCounty='00000' (unfilled), so we filter those
    out — callers should regenerate the cache via build_place_county_cache().
    """
    if os.path.exists(PLACE_COUNTY_CACHE):
        with open(PLACE_COUNTY_CACHE, "r", encoding="utf-8") as f:
            cached = json.load(f)
        # Cache may store either a flat dict or {meta, places: {...}}
        return cached.get("places", cached) if isinstance(cached, dict) else {}
    # Registry fallback
    with open(GEO_REGISTRY, "r", encoding="utf-8") as f:
        g = json.load(f)
    out: dict[str, str] = {}
    for x in g.get("geographies", []):
        if x.get("type") in ("place", "cdp"):
            geoid = str(x.get("geoid", "")).zfill(7)
            cc = str(x.get("containingCounty", "")).zfill(5)
            if geoid and cc and cc != "00000":
                out[geoid] = cc
    return out


def _query_county_for_place(vintage: int, place_code5: str) -> str | None:
    """Look up a single place's primary containing county via Census API.

    Uses `for=county (or part):*&in=state:08+place:NNNNN`, which is the only
    hierarchy Census ACS exposes for place→county lookup. Returns the 5-digit
    county FIPS, or None on error. Spaces in 'county (or part)' get URL-
    encoded as %20 (the literal '+' separates hierarchy levels in `in`).
    """
    api_key = os.environ.get("CENSUS_API_KEY", "").strip()
    qs = (
        f"get=NAME"
        f"&for=county%20(or%20part):*"
        f"&in=state:{COLORADO_FIPS}+place:{place_code5}"
    )
    if api_key:
        qs += f"&key={urllib.parse.quote(api_key, safe='')}"
    url = f"https://api.census.gov/data/{vintage}/acs/acs5?{qs}"
    try:
        arr = http_get_json(url, timeout=30, retries=2)
    except Exception:  # noqa: BLE001
        return None
    if not arr or len(arr) < 2:
        return None
    header = arr[0]
    try:
        county_idx = header.index("county (or part)")
    except ValueError:
        return None
    # First row wins → primary containing county (lowest county GEOID).
    # Census returns rows sorted by county code ascending.
    row = arr[1]
    cc3 = str(row[county_idx]).zfill(3)
    return f"{COLORADO_FIPS}{cc3}"


def build_place_county_cache(vintage: int) -> dict[str, str]:
    """Build a complete place→county lookup, persisted at PLACE_COUNTY_CACHE.

    Strategy: seed from the geography registry's already-populated entries
    (those with containingCounty != '00000'), then call the Census API once
    per remaining place to fill the gap. Total external calls = number of
    places with unfilled containingCounty (~200 for CO, runs in ~1 minute).
    """
    # 1. Seed from geography registry
    seed: dict[str, str] = {}
    unfilled: list[str] = []
    if os.path.exists(GEO_REGISTRY):
        with open(GEO_REGISTRY, "r", encoding="utf-8") as f:
            g = json.load(f)
        for x in g.get("geographies", []):
            if x.get("type") not in ("place", "cdp"):
                continue
            geoid7 = str(x.get("geoid", "")).zfill(7)
            cc = str(x.get("containingCounty", "")).zfill(5)
            if not geoid7:
                continue
            if cc and cc != "00000":
                seed[geoid7] = cc
            else:
                unfilled.append(geoid7)

    print(f"  Seeded {len(seed)} place→county mappings from registry; "
          f"{len(unfilled)} unfilled places need Census API lookup.")

    # 2. Look up each unfilled place via Census API
    out = dict(seed)
    api_failures = 0
    for i, geoid7 in enumerate(unfilled, 1):
        place_code5 = geoid7[2:]  # strip state prefix
        cc = _query_county_for_place(vintage, place_code5)
        if cc:
            out[geoid7] = cc
        else:
            api_failures += 1
        if i % 50 == 0:
            print(f"    looked up {i}/{len(unfilled)} ({api_failures} failures)")
        time.sleep(0.08)  # polite pacing for Census API

    print(f"  Final: {len(out)} place→county mappings "
          f"(seeded {len(seed)}, looked up {len(unfilled) - api_failures}, "
          f"{api_failures} unresolved)")

    # 3. Persist cache
    os.makedirs(os.path.dirname(PLACE_COUNTY_CACHE), exist_ok=True)
    payload = {
        "meta": {
            "generated_at": utc_now(),
            "source": (
                f"Census ACS {vintage} place→county lookup (county (or part) "
                f"hierarchy), seeded from geography-registry.json"
            ),
            "count": len(out),
            "api_failures": api_failures,
        },
        "places": out,
    }
    with open(PLACE_COUNTY_CACHE, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, sort_keys=True)
    print(f"  Cached {len(out)} place→county mappings to {PLACE_COUNTY_CACHE}")
    return out


def compute_tier_series(
    ami_4person: int,
    row: dict[str, Any],
) -> dict[str, dict[str, int]]:
    """Compute all per-tier series for one geography from its ACS row
    (which carries B19001 + B25118 + B25063 variables side by side).

    Returns dict with keys: affordable_rent_monthly, households_le (renter),
    all_households_le, units_le, each mapping tier-string → count.
    """
    affordable_rent_monthly: dict[str, int] = {}
    households_le: dict[str, int] = {}
    all_households_le: dict[str, int] = {}
    units_le: dict[str, int] = {}

    for tier in AMI_TIERS:
        threshold_income = ami_4person * (tier / 100.0)
        threshold_rent_month = threshold_income * 0.30 / 12.0
        key = str(tier)

        affordable_rent_monthly[key] = int(round(threshold_rent_month))
        renter_households = cumulative_count_le_threshold(
            B25118_RENTER_BINS, row, threshold_income
        )
        all_households = cumulative_count_le_threshold(
            B19001_BINS, row, threshold_income
        )
        households_le[key] = min(renter_households, all_households)
        all_households_le[key] = all_households
        units_le[key] = cumulative_count_le_threshold(
            B25063_BINS, row, threshold_rent_month
        )

    return {
        "affordable_rent_monthly": affordable_rent_monthly,
        "households_le": households_le,
        "all_households_le": all_households_le,
        "units_le": units_le,
    }


def compute_place_record(
    *,
    geoid7: str,
    name: str,
    county_fips5: str,
    ami_4person: int,
    row: dict[str, Any],
) -> dict[str, Any]:
    """Compute the full per-place affordability-gap record.

    Place-file conventions (preserved from v1): gap is stored as
    households − units (positive = deficit); coverage is data
    completeness (1.0 for native ACS pulls — build_ranking_index.py
    treats coverage < 0.75 as a missing tier).
    """
    series = compute_tier_series(ami_4person, row)
    gap: dict[str, int] = {}
    coverage: dict[str, float] = {}
    for tier in AMI_TIERS:
        key = str(tier)
        gap[key] = series["households_le"][key] - series["units_le"][key]
        coverage[key] = 1.0

    return {
        "fips": geoid7,
        "place_name": name,
        "containing_county_fips": county_fips5,
        "ami_4person": ami_4person,
        "affordable_rent_monthly": series["affordable_rent_monthly"],
        "households_le_ami_pct": series["households_le"],
        "all_households_le_ami_pct": series["all_households_le"],
        "renter_households_total": safe_int(row.get(B25118_RENTER_TOTAL, 0)),
        "units_priced_affordable_le_ami_pct": series["units_le"],
        "gap_units_minus_households_le_ami_pct": gap,
        "coverage_le_ami_pct": coverage,
        "source": "place_acs_direct",
        "demand_tenure": "renter",
    }


def compute_county_record(
    *,
    fips: str,
    county_name: str,
    ami_4person: int,
    row: dict[str, Any],
) -> dict[str, Any]:
    """Compute a county-file record.

    County-file conventions (preserved from the original static file):
    gap is stored as units − households (negative = deficit) and
    coverage is the supply ratio units/households — js/co-ami-gap.js
    color-codes it and colorado-deep-dive.js sorts "most negative first".
    """
    series = compute_tier_series(ami_4person, row)
    gap: dict[str, int] = {}
    coverage: dict[str, float] = {}
    for tier in AMI_TIERS:
        key = str(tier)
        hh = series["households_le"][key]
        un = series["units_le"][key]
        gap[key] = un - hh
        coverage[key] = round(un / hh, 4) if hh > 0 else None

    return {
        "fips": fips,
        "county_name": county_name,
        "ami_4person": ami_4person,
        "affordable_rent_monthly": series["affordable_rent_monthly"],
        "households_le_ami_pct": series["households_le"],
        "all_households_le_ami_pct": series["all_households_le"],
        "renter_households_total": safe_int(row.get(B25118_RENTER_TOTAL, 0)),
        "units_priced_affordable_le_ami_pct": series["units_le"],
        "gap_units_minus_households_le_ami_pct": gap,
        "coverage_le_ami_pct": coverage,
        "demand_tenure": "renter",
    }


def _sources(vintage: int) -> list[dict[str, str]]:
    return [
        {"name": "HUD FY2025 Income Limits",
         "url": "https://www.huduser.gov/portal/datasets/il.html"},
        {"name": "Census ACS 5-year B25118 (Tenure by Household Income)",
         "url": f"https://data.census.gov/table/ACSDT5Y{vintage}.B25118"},
        {"name": "Census ACS 5-year B25063 (Gross Rent)",
         "url": f"https://data.census.gov/table/ACSDT5Y{vintage}.B25063"},
        {"name": "Census ACS 5-year B19001 (Household Income, all tenures — "
                 "legacy series)",
         "url": f"https://data.census.gov/table/ACSDT5Y{vintage}.B19001"},
        {"name": "Colorado Division of Housing",
         "url": "https://cdola.colorado.gov/housing"},
    ]


ALL_VARIABLES = (
    [b[2] for b in B19001_BINS]
    + [b[2] for b in B25118_RENTER_BINS]
    + [B25118_RENTER_TOTAL]
    + [b[2] for b in B25063_BINS]
)
ALL_TABLES = ["B19001", "B25118", "B25063"]


def build_place_file(vintage: int, out_path: str, rebuild_cache: bool) -> int:
    print(f"Building place-level AMI gap from ACS {vintage} 5-year...")

    # Load lookups. If the place→county cache is missing or stale, rebuild it
    # from Census API directly so we get all 500+ CO places — the geography
    # registry alone leaves ~200 CDPs with containingCounty='00000'.
    county_ami = load_county_ami_lookup()
    if rebuild_cache or not os.path.exists(PLACE_COUNTY_CACHE):
        place_county = build_place_county_cache(vintage)
    else:
        place_county = load_place_county_lookup()
    print(f"  Loaded {len(county_ami)} county AMI thresholds, "
          f"{len(place_county)} place→county mappings.")

    print(f"  Fetching B19001 + B25118 + B25063 for all CO places...")
    rows_by_geoid = fetch_acs_rows(vintage, ALL_VARIABLES, ALL_TABLES, "place")

    # Build records
    records: dict[str, Any] = {}
    skipped = {"no_county": 0, "no_ami": 0, "no_data": 0}
    for geoid7, county_fips5 in place_county.items():
        ami = county_ami.get(county_fips5)
        if not county_fips5:
            skipped["no_county"] += 1
            continue
        if not ami:
            skipped["no_ami"] += 1
            continue
        row = rows_by_geoid.get(geoid7)
        if not row:
            skipped["no_data"] += 1
            continue
        name = (row.get("NAME") or geoid7).split(",")[0]
        records[geoid7] = compute_place_record(
            geoid7=geoid7,
            name=name,
            county_fips5=county_fips5,
            ami_4person=ami,
            row=row,
        )

    print(f"  Built {len(records)} place records "
          f"(skipped: no_county={skipped['no_county']}, "
          f"no_ami={skipped['no_ami']}, no_data={skipped['no_data']})")

    payload = {
        "meta": {
            "state": "CO",
            "hud_income_limits_year": 2025,
            "acs_year": vintage,
            "generated_at": utc_now(),
            "methodology_version": METHODOLOGY_VERSION,
            "demand_tenure": "renter",
            "source": "Census ACS 5-year API (B25118 + B19001 + B25063) at "
                      "place level, scored against HUD FY2025 county AMI "
                      "thresholds.",
            "note": "Methodology v2: gap demand side is renter households "
                    "(B25118); the all-tenure B19001 series is retained as "
                    "all_households_le_ami_pct. Per-place data is fetched "
                    "directly from ACS rather than scaled from county "
                    "aggregates. Linear interpolation within income/rent "
                    "bins; the open-ended top bin uses a 2x floor heuristic "
                    "for the upper edge. Per-tier renter demand is clamped "
                    "to all_households_le_ami_pct to absorb ACS cross-table "
                    "sampling noise.",
        },
        "bands": [str(t) for t in AMI_TIERS],
        "places": records,
        "methodology": METHODOLOGY_NOTES,
        "sources": _sources(vintage),
    }

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"  Wrote {out_path}")

    # Sanity check: Fruita (0828745) and Clifton (0815165) should differ.
    fruita = records.get("0828745")
    clifton = records.get("0815165")
    if fruita and clifton:
        f_le30 = fruita["households_le_ami_pct"]["30"]
        c_le30 = clifton["households_le_ami_pct"]["30"]
        f_renters = fruita["renter_households_total"]
        c_renters = clifton["renter_households_total"]
        f_ratio = f_le30 / f_renters if f_renters else 0
        c_ratio = c_le30 / c_renters if c_renters else 0
        print(f"  Sanity: Fruita renter HH≤30%AMI = {f_le30} "
              f"({f_ratio:.1%} of {f_renters} renter HH)")
        print(f"          Clifton renter HH≤30%AMI = {c_le30} "
              f"({c_ratio:.1%} of {c_renters} renter HH)")
        if abs(f_ratio - c_ratio) < 0.005:
            print("  ⚠ Fruita and Clifton ratios within 0.5% — investigate "
                  "(but this may legitimately be the case if both have similar "
                  "income distributions)", file=sys.stderr)
        else:
            print(f"  ✓ Fruita vs Clifton differ as expected "
                  f"({abs(f_ratio - c_ratio):.1%} ratio difference).")

    return 0


def build_county_file(vintage: int, out_path: str) -> int:
    print(f"Building county-level AMI gap from ACS {vintage} 5-year...")

    county_ami = load_county_ami_lookup()
    print(f"  Loaded {len(county_ami)} county AMI thresholds.")

    print(f"  Fetching B19001 + B25118 + B25063 for all CO counties...")
    county_rows = fetch_acs_rows(vintage, ALL_VARIABLES, ALL_TABLES, "county")
    print(f"  Fetching statewide totals...")
    state_rows = fetch_acs_rows(vintage, ALL_VARIABLES, ALL_TABLES, "state")

    records: list[dict[str, Any]] = []
    skipped = {"no_ami": 0, "no_data": 0}
    for fips in sorted(county_ami):
        row = county_rows.get(fips)
        if not row:
            skipped["no_data"] += 1
            continue
        name = (row.get("NAME") or fips).split(",")[0]
        records.append(compute_county_record(
            fips=fips,
            county_name=name,
            ami_4person=county_ami[fips],
            row=row,
        ))
    for fips in county_rows:
        if fips not in county_ami:
            skipped["no_ami"] += 1

    state_row = state_rows.get(COLORADO_FIPS)
    if not state_row:
        raise RuntimeError("Statewide ACS row missing — refusing to write a "
                           "county file without the statewide record.")
    statewide = compute_county_record(
        fips=COLORADO_FIPS,
        county_name="Colorado (statewide)",
        ami_4person=STATEWIDE_AMI_4PERSON,
        row=state_row,
    )

    print(f"  Built {len(records)} county records + statewide "
          f"(skipped: no_ami={skipped['no_ami']}, no_data={skipped['no_data']})")

    payload = {
        "meta": {
            "state": "CO",
            "hud_income_limits_year": 2025,
            "acs_year": vintage,
            "generated_at": utc_now(),
            "methodology_version": METHODOLOGY_VERSION,
            "demand_tenure": "renter",
            "note": "Methodology v2: gap demand side is renter households "
                    "(ACS B25118); the all-tenure B19001 series is retained "
                    "as all_households_le_ami_pct. Counts come directly from "
                    "ACS with linear within-bin interpolation (the pre-v2 "
                    "file used a lognormal income model). Gap sign convention "
                    "unchanged: units minus households, negative = deficit. "
                    "Per-tier renter demand is clamped to "
                    "all_households_le_ami_pct to absorb ACS cross-table "
                    "sampling noise.",
        },
        "bands": list(AMI_TIERS),
        "statewide": statewide,
        "counties": records,
        "methodology": METHODOLOGY_NOTES,
        "sources": _sources(vintage),
    }

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"  Wrote {out_path}")

    # Benchmark check: La Plata County vs Root Policy Research's Feb 2025
    # SB24-174-aligned HNA (2,715 renters <50% AMI vs 1,752 units = 963 gap,
    # on 2018-2022 CHAS). Our ACS construction should land in the same
    # ballpark — hundreds, not thousands.
    lp = next((c for c in records if c["fips"] == "08067"), None)
    if lp:
        print(f"  Benchmark La Plata ≤50% AMI: renter HH = "
              f"{lp['households_le_ami_pct']['50']}, units = "
              f"{lp['units_priced_affordable_le_ami_pct']['50']}, gap = "
              f"{lp['gap_units_minus_households_le_ami_pct']['50']} "
              f"(Root Policy 2025: 2,715 vs 1,752 = -963)")

    return 0


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--vintage", type=int, default=DEFAULT_VINTAGE,
        help="ACS 5-year vintage (default: %(default)s).",
    )
    p.add_argument(
        "--geo", choices=("place", "county", "both"), default="both",
        help="Which file(s) to build (default: %(default)s).",
    )
    p.add_argument(
        "--out", default=OUT_FILE,
        help="Place-file output path (default: data/co_ami_gap_by_place.json).",
    )
    p.add_argument(
        "--county-out", default=COUNTY_OUT_FILE,
        help="County-file output path (default: data/co_ami_gap_by_county.json).",
    )
    p.add_argument(
        "--rebuild-cache", action="store_true",
        help="Force rebuild of the place→county cache (bypass any existing cache).",
    )
    args = p.parse_args()

    rc = 0
    if args.geo in ("place", "both"):
        rc = build_place_file(args.vintage, args.out, args.rebuild_cache) or rc
    if args.geo in ("county", "both"):
        rc = build_county_file(args.vintage, args.county_out) or rc
    return rc


if __name__ == "__main__":
    sys.exit(main())
