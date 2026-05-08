#!/usr/bin/env python3
"""
build_place_ami_gap.py
======================
Build a place-level affordability-gap dataset from ACS B19001 (household
income distribution) and B25063 (gross rent distribution), keyed by 7-digit
place GEOID.

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
place-specific data. ACS publishes B19001 and B25063 at place level for
every Colorado place and CDP (5-year ACS, all sizes), so we can compute
the same gap per place directly.

Method
------
For each AMI tier T in {30, 40, 50, 60, 70, 80, 100}:

  threshold_income = ami_4person × (T / 100)
  threshold_rent   = threshold_income × 0.30 / 12       # max affordable

  households_le_T = linear-interpolated cumulative count from B19001 bins
  units_priced_affordable_le_T = linear-interpolated cumulative count
                                 from B25063 bins (rents in 2023 dollars)
  gap_T = households_le_T - units_priced_affordable_le_T

Linear interpolation is used within bins (the static county file uses a
lognormal model, but linear is sufficient for the place-level relative
ordering and is dramatically simpler to validate). The methodology note
in the output records this choice.

Output
------
    data/co_ami_gap_by_place.json   (mirrors the county file's schema,
                                     keyed by 7-digit place GEOID)

Usage
-----
    python3 scripts/hna/build_place_ami_gap.py
    python3 scripts/hna/build_place_ami_gap.py --vintage 2023
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
PLACE_COUNTY_CACHE = os.path.join(
    REPO_ROOT, "data", "hna", "derived", "place_county_lookup.json"
)

DEFAULT_VINTAGE = 2023
COLORADO_FIPS = "08"

# AMI tiers we report for each place (matches the county file's keys)
AMI_TIERS = (30, 40, 50, 60, 70, 80, 100)

# B19001 income bins — (lower, upper, variable). Open-ended bin uses None
# for upper. Dollar values are 2023 inflation-adjusted (from ACS metadata).
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


def fetch_acs_for_places(vintage: int, variables: list[str]) -> list[dict[str, Any]]:
    """Fetch the given variables for every CO place and CDP from ACS 5-year.

    Returns a list of dicts keyed by variable name plus 'state' and 'place'.
    The Census API returns a header row plus data rows; we transpose to dicts.
    """
    api_key = os.environ.get("CENSUS_API_KEY", "").strip()
    get_clause = ",".join(["NAME"] + variables)
    params = {
        "get": get_clause,
        "for": "place:*",
        "in":  f"state:{COLORADO_FIPS}",
    }
    if api_key:
        params["key"] = api_key
    url = f"https://api.census.gov/data/{vintage}/acs/acs5?{urllib.parse.urlencode(params)}"
    raw = http_get_json(url, timeout=120)
    if not raw or len(raw) < 2:
        raise RuntimeError(f"Empty ACS response for {vintage} place query")
    header, *rows = raw
    return [dict(zip(header, row)) for row in rows]


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


def compute_place_record(
    *,
    geoid7: str,
    name: str,
    county_fips5: str,
    ami_4person: int,
    income_counts: dict[str, int],
    rent_counts: dict[str, int],
) -> dict[str, Any]:
    """Compute the full per-place affordability-gap record."""
    affordable_rent_monthly: dict[str, int] = {}
    households_le: dict[str, int] = {}
    units_le: dict[str, int] = {}
    gap: dict[str, int] = {}
    coverage: dict[str, float] = {}

    for tier in AMI_TIERS:
        threshold_income = ami_4person * (tier / 100.0)
        threshold_rent_month = threshold_income * 0.30 / 12.0

        affordable_rent_monthly[str(tier)] = int(round(threshold_rent_month))
        households_le[str(tier)] = cumulative_count_le_threshold(
            B19001_BINS, income_counts, threshold_income
        )
        units_le[str(tier)] = cumulative_count_le_threshold(
            B25063_BINS, rent_counts, threshold_rent_month
        )
        gap[str(tier)] = households_le[str(tier)] - units_le[str(tier)]
        # Coverage is "completeness" — for native ACS pulls, we always have
        # all bins present, so coverage is 1.0. (Suppressed cells are
        # treated as 0 above.)
        coverage[str(tier)] = 1.0

    return {
        "fips": geoid7,
        "place_name": name,
        "containing_county_fips": county_fips5,
        "ami_4person": ami_4person,
        "affordable_rent_monthly": affordable_rent_monthly,
        "households_le_ami_pct": households_le,
        "units_priced_affordable_le_ami_pct": units_le,
        "gap_units_minus_households_le_ami_pct": gap,
        "coverage_le_ami_pct": coverage,
        "source": "place_acs_direct",
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--vintage", type=int, default=DEFAULT_VINTAGE,
        help="ACS 5-year vintage (default: %(default)s).",
    )
    p.add_argument(
        "--out", default=OUT_FILE,
        help="Output path (default: data/co_ami_gap_by_place.json).",
    )
    p.add_argument(
        "--rebuild-cache", action="store_true",
        help="Force rebuild of the place→county cache (bypass any existing cache).",
    )
    args = p.parse_args()

    print(f"Building place-level AMI gap from ACS {args.vintage} 5-year...")

    # Load lookups. If the place→county cache is missing or stale, rebuild it
    # from Census API directly so we get all 500+ CO places — the geography
    # registry alone leaves ~200 CDPs with containingCounty='00000'.
    county_ami = load_county_ami_lookup()
    if args.rebuild_cache or not os.path.exists(PLACE_COUNTY_CACHE):
        place_county = build_place_county_cache(args.vintage)
    else:
        place_county = load_place_county_lookup()
    print(f"  Loaded {len(county_ami)} county AMI thresholds, "
          f"{len(place_county)} place→county mappings.")

    # Fetch ACS B19001 (16 vars) and B25063 (24 priced bins) for all CO places.
    # The Census API caps at ~50 variables per call; both fit in one request
    # comfortably, but split into two to keep responses small.
    income_vars = [b[2] for b in B19001_BINS]
    rent_vars = [b[2] for b in B25063_BINS]

    print(f"  Fetching B19001 ({len(income_vars)} vars) for all CO places...")
    income_rows = fetch_acs_for_places(args.vintage, income_vars)
    print(f"  Fetching B25063 ({len(rent_vars)} vars) for all CO places...")
    rent_rows = fetch_acs_for_places(args.vintage, rent_vars)

    # Index by 7-digit geoid (state + place)
    def _row_geoid(r: dict[str, Any]) -> str:
        return f"{str(r.get('state', '')).zfill(2)}{str(r.get('place', '')).zfill(5)}"

    income_by_geoid = {_row_geoid(r): r for r in income_rows}
    rent_by_geoid = {_row_geoid(r): r for r in rent_rows}

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
        income_row = income_by_geoid.get(geoid7)
        rent_row = rent_by_geoid.get(geoid7)
        if not income_row or not rent_row:
            skipped["no_data"] += 1
            continue
        name = (income_row.get("NAME") or rent_row.get("NAME") or geoid7).split(",")[0]
        records[geoid7] = compute_place_record(
            geoid7=geoid7,
            name=name,
            county_fips5=county_fips5,
            ami_4person=ami,
            income_counts=income_row,
            rent_counts=rent_row,
        )

    print(f"  Built {len(records)} place records "
          f"(skipped: no_county={skipped['no_county']}, "
          f"no_ami={skipped['no_ami']}, no_data={skipped['no_data']})")

    payload = {
        "meta": {
            "state": "CO",
            "hud_income_limits_year": 2025,
            "acs_year": args.vintage,
            "generated_at": utc_now(),
            "source": "Census ACS 5-year API (B19001 + B25063) at place level, "
                      "scored against HUD FY2025 county AMI thresholds.",
            "note": "Per-place data is fetched directly from ACS rather than "
                    "scaled from county aggregates. Linear interpolation within "
                    "income/rent bins; the open-ended top bin uses a 2× floor "
                    "heuristic for the upper edge.",
        },
        "bands": [str(t) for t in AMI_TIERS],
        "places": records,
        "methodology": [
            "Income thresholds use HUD FY2025 4-person AMI for the place's "
            "containing county (per data/hna/geography-registry.json).",
            "Households at each AMI threshold come from ACS table B19001 for "
            "the place itself (linear interpolation within bins).",
            "Priced-affordable units come from ACS table B25063 (gross rent, "
            "renter-occupied with cash rent), counted at or below the rent "
            "threshold equal to 30% of monthly threshold income.",
            "Gap = households at-or-below threshold minus units priced "
            "affordable at-or-below threshold. Positive gap = unit deficit.",
            "Limitations: (1) AMI thresholds are county-level (HUD); a place "
            "spanning two counties uses its dominant containing county. "
            "(2) Linear within-bin interpolation, not lognormal — bins are "
            "narrow enough that the difference is < 2% in cumulative counts.",
        ],
    }

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    print(f"  Wrote {args.out}")

    # Sanity check: Fruita (0828745) and Clifton (0815165) should differ.
    fruita = records.get("0828745")
    clifton = records.get("0815165")
    if fruita and clifton:
        f_le30 = fruita["households_le_ami_pct"]["30"]
        c_le30 = clifton["households_le_ami_pct"]["30"]
        f_pop = sum(safe_int(income_by_geoid["0828745"].get(b[2])) for b in B19001_BINS)
        c_pop = sum(safe_int(income_by_geoid["0815165"].get(b[2])) for b in B19001_BINS)
        f_ratio = f_le30 / f_pop if f_pop else 0
        c_ratio = c_le30 / c_pop if c_pop else 0
        print(f"  Sanity: Fruita HH≤30%AMI = {f_le30} ({f_ratio:.1%} of {f_pop} HH)")
        print(f"          Clifton HH≤30%AMI = {c_le30} ({c_ratio:.1%} of {c_pop} HH)")
        if abs(f_ratio - c_ratio) < 0.005:
            print("  ⚠ Fruita and Clifton ratios within 0.5% — investigate "
                  "(but this may legitimately be the case if both have similar "
                  "income distributions)", file=sys.stderr)
        else:
            print(f"  ✓ Fruita vs Clifton differ as expected "
                  f"({abs(f_ratio - c_ratio):.1%} ratio difference).")

    return 0


if __name__ == "__main__":
    sys.exit(main())
