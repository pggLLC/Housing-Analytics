#!/usr/bin/env python3
"""
scripts/fetch_county_economic_indicators.py

Fetches and writes data/co-county-economic-indicators.json with current data from:
  - BLS LAUS v2 API  : annual unemployment rate per county (most recent annual average)
  - BLS QCEW API     : employment counts for 5-year job-growth calculation
  - Census ACS 5-year: median household income, median home value, population

All sources are freely accessible without authentication (though BLS_API_KEY and
CENSUS_API_KEY increase rate limits when provided).

Output schema (co-county-economic-indicators.json):
{
  "updated": "<ISO-8601 UTC date>",
  "source": "BLS LAUS (unemployment), BLS QCEW (job growth), ACS <year> (income, home price, population)",
  "note": "...",
  "counties": {
    "<county name>": {
      "unemployment_rate": <float>,     // most recent BLS LAUS annual average (%)
      "job_growth_5yr_pct": <float>,    // BLS QCEW 5-year employment % change
      "affordability_index": <float>,   // median_home_price / median_hh_income
      "population_growth_5yr_pct": <float>, // ACS 5-year population growth (%)
      "median_home_price": <int>,       // ACS median home value ($)
      "median_hh_income": <int>         // ACS median household income ($)
    },
    ...
  }
}

Usage:
    python3 scripts/fetch_county_economic_indicators.py
    BLS_API_KEY=<key> CENSUS_API_KEY=<key> python3 scripts/fetch_county_economic_indicators.py
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
OUT_FILE = ROOT / "data" / "co-county-economic-indicators.json"
BOUNDARIES_FILE = ROOT / "data" / "co-county-boundaries.json"

STATE_FIPS = "08"

BLS_API_BASE = "https://api.bls.gov/publicAPI/v2/timeseries/data/"
# BLS LAUS county series: LAUCN{fips5}0000000000003 = unemployment rate
LAUS_SUFFIX = "0000000000003"

# BLS QCEW public data API — annual totals
QCEW_API = "https://data.bls.gov/cew/data/api/{year}/a1/area/{area}.json"

# ACS candidate years (newest first; try until one succeeds)
ACS_CANDIDATES = [2025, 2024, 2023]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _log(msg: str) -> None:
    print(msg, flush=True)


def _warn(msg: str) -> None:
    print(f"WARN  {msg}", flush=True)


def _http_get(url: str, timeout: int = 30) -> bytes | None:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "HousingAnalytics-ETL/1.0"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        _warn(f"HTTP {exc.code} fetching {url}")
        return None
    except Exception as exc:
        _warn(f"Fetch error for {url}: {exc}")
        return None


def _http_post_json(url: str, payload: dict, timeout: int = 30) -> Any:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "HousingAnalytics-ETL/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8", errors="replace"))
    except Exception as exc:
        _warn(f"POST error for {url}: {exc}")
        return None


def _parse_num(v: Any) -> float | None:
    """Parse Census/BLS numeric strings; return None for suppressed values."""
    if v is None or v == "" or v == "N" or v == "(D)":
        return None
    try:
        n = float(v)
        # Census uses -666666666 for suppressed; BLS uses negative sentinel values
        if n < -99000:
            return None
        return n
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# Load county FIPS mapping
# ---------------------------------------------------------------------------

def load_county_fips() -> dict[str, str]:
    """Return {county_name: '08XXX'} for all 64 CO counties."""
    if not BOUNDARIES_FILE.exists():
        _warn(f"Boundaries file not found: {BOUNDARIES_FILE}")
        return {}
    with open(BOUNDARIES_FILE, encoding="utf-8") as fh:
        data = json.load(fh)
    result: dict[str, str] = {}
    for feat in data.get("features", []):
        props = feat.get("properties", {})
        name = props.get("NAME", "").strip()
        geoid = props.get("GEOID", "").strip()
        if name and geoid:
            result[name] = geoid
    return result


# ---------------------------------------------------------------------------
# BLS LAUS — unemployment rates for all CO counties
# ---------------------------------------------------------------------------

def fetch_laus_unemployment(county_fips_map: dict[str, str]) -> dict[str, float]:
    """Fetch most-recent annual unemployment rate per county via BLS LAUS v2 API.

    Returns {county_name: unemployment_rate_pct}.
    """
    api_key = os.environ.get("BLS_API_KEY", "").strip()

    # Build LAUS series IDs for all 64 counties
    fips_to_name: dict[str, str] = {v: k for k, v in county_fips_map.items()}
    series_map: dict[str, str] = {}  # series_id -> county_fips
    for fips in county_fips_map.values():
        series_id = f"LAUCN{fips}{LAUS_SUFFIX}"
        series_map[series_id] = fips

    all_series_ids = list(series_map.keys())
    _log(f"  Fetching BLS LAUS for {len(all_series_ids)} Colorado counties …")

    # Determine year range: most recent 6 years for resilience
    current_year = datetime.now(timezone.utc).year
    start_year = current_year - 6
    end_year = current_year - 1  # BLS LAUS annual averages lag ~2 months

    county_ur: dict[str, float] = {}

    # BLS v2 API: max 25 series per request
    batch_size = 25
    for i in range(0, len(all_series_ids), batch_size):
        batch = all_series_ids[i : i + batch_size]
        payload: dict[str, Any] = {
            "seriesid": batch,
            "startyear": str(start_year),
            "endyear": str(end_year),
        }
        if api_key:
            payload["registrationkey"] = api_key

        _log(f"    BLS LAUS batch {i // batch_size + 1}: {len(batch)} series")
        result = _http_post_json(BLS_API_BASE, payload)
        if not result or result.get("status") != "REQUEST_SUCCEEDED":
            msgs = " | ".join(result.get("message", []) or []) if result else "no response"
            _warn(f"    BLS LAUS batch {i // batch_size + 1} failed: {msgs}")
            time.sleep(1)
            continue

        for series in result.get("Results", {}).get("series", []):
            sid = series.get("seriesID", "")
            fips = series_map.get(sid)
            if not fips:
                continue
            county_name = fips_to_name.get(fips, fips)

            # Find the most recent annual average (period M13)
            best_year = 0
            best_ur = None
            for obs in series.get("data", []):
                if obs.get("period") == "M13":  # M13 = annual average
                    yr = int(obs.get("year", 0))
                    val = _parse_num(obs.get("value"))
                    if val is not None and yr > best_year:
                        best_year = yr
                        best_ur = val

            if best_ur is not None:
                county_ur[county_name] = round(best_ur, 2)

        time.sleep(0.5)  # Be polite to BLS API

    _log(f"  BLS LAUS: received data for {len(county_ur)} / {len(county_fips_map)} counties")
    return county_ur


# ---------------------------------------------------------------------------
# BLS QCEW — 5-year employment change
# ---------------------------------------------------------------------------

def _fetch_qcew_county_employment(area_code: str, year: int) -> int | None:
    """Fetch all-sector all-ownership total employment for a county from QCEW.

    Returns integer employment count or None on failure.
    QCEW area code = 5-digit county FIPS.
    agglvl_code "70" = county total; own_code "0" = all ownership.
    """
    url = QCEW_API.format(year=year, area=area_code)
    raw = _http_get(url, timeout=20)
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None

    rows = data.get("annualData", [])
    for row in rows:
        if row.get("agglvl_code") == "70" and row.get("own_code") == "0":
            emp = _parse_num(row.get("annual_avg_emplvl"))
            if emp is not None:
                return int(emp)
    return None


def fetch_qcew_job_growth(county_fips_map: dict[str, str]) -> dict[str, float]:
    """Compute 5-year job growth % per county from BLS QCEW.

    Returns {county_name: job_growth_pct}.
    """
    current_year = datetime.now(timezone.utc).year
    # Try recent year first (QCEW lags ~6 months)
    end_year = current_year - 1
    start_year = end_year - 5

    _log(f"  Fetching BLS QCEW employment: {start_year} → {end_year} …")

    result: dict[str, float] = {}
    total = len(county_fips_map)
    done = 0
    for county_name, fips in county_fips_map.items():
        done += 1
        emp_end = _fetch_qcew_county_employment(fips, end_year)
        if emp_end is None:
            # Try one year earlier
            emp_end = _fetch_qcew_county_employment(fips, end_year - 1)
            if emp_end is not None:
                start_year_adj = start_year - 1
            else:
                if done % 10 == 0:
                    _log(f"    QCEW: {done}/{total} …")
                time.sleep(0.2)
                continue
        else:
            start_year_adj = start_year

        emp_start = _fetch_qcew_county_employment(fips, start_year_adj)
        if emp_start and emp_start > 0:
            pct = round(((emp_end - emp_start) / emp_start) * 100, 2)
            result[county_name] = pct

        if done % 10 == 0:
            _log(f"    QCEW: {done}/{total} …")
        time.sleep(0.2)

    _log(f"  QCEW job growth: computed for {len(result)} / {total} counties")
    return result


# ---------------------------------------------------------------------------
# Census ACS — income, home value, population
# ---------------------------------------------------------------------------

def fetch_acs_county_data(acs_year: int) -> dict[str, dict] | None:
    """Fetch ACS 5-year county data for CO.

    Returns {county_name: {median_hh_income, median_home_value, population,
                           pop_prior, acs_year}} or None on failure.
    """
    api_key = os.environ.get("CENSUS_API_KEY", "").strip()
    key_param = f"&key={api_key}" if api_key else ""

    # B19013_001E = median HH income
    # B25077_001E = median home value
    # B01003_001E = total population
    vars_str = "NAME,B19013_001E,B25077_001E,B01003_001E"
    url = (
        f"https://api.census.gov/data/{acs_year}/acs/acs5"
        f"?get={vars_str}&for=county:*&in=state:{STATE_FIPS}{key_param}"
    )

    _log(f"  Fetching ACS {acs_year} county data …")
    raw = _http_get(url, timeout=30)
    if not raw:
        return None

    try:
        rows = json.loads(raw)
    except json.JSONDecodeError as exc:
        _warn(f"ACS {acs_year} JSON decode error: {exc}")
        return None

    if not isinstance(rows, list) or len(rows) < 2:
        _warn(f"ACS {acs_year} returned unexpected response shape")
        return None

    header = rows[0]
    result: dict[str, dict] = {}
    for row in rows[1:]:
        d = dict(zip(header, row))
        full_name = d.get("NAME", "")
        m_name = full_name.split(" County")[0].strip() if " County" in full_name else ""
        if not m_name:
            continue
        income = _parse_num(d.get("B19013_001E"))
        home_val = _parse_num(d.get("B25077_001E"))
        pop = _parse_num(d.get("B01003_001E"))
        result[m_name] = {
            "median_hh_income": int(income) if income else None,
            "median_home_value": int(home_val) if home_val else None,
            "population": int(pop) if pop else None,
            "acs_year": acs_year,
        }
    _log(f"  ACS {acs_year}: {len(result)} counties")
    return result if result else None


def fetch_acs_prior_population(acs_year: int) -> dict[str, int]:
    """Fetch prior-5-year population to compute growth rate.

    Uses ACS (acs_year - 5) for the base population.
    Returns {county_name: population} or empty dict.
    """
    prior_year = acs_year - 5
    api_key = os.environ.get("CENSUS_API_KEY", "").strip()
    key_param = f"&key={api_key}" if api_key else ""

    url = (
        f"https://api.census.gov/data/{prior_year}/acs/acs5"
        f"?get=NAME,B01003_001E&for=county:*&in=state:{STATE_FIPS}{key_param}"
    )
    _log(f"  Fetching prior-period population (ACS {prior_year}) …")
    raw = _http_get(url, timeout=30)
    if not raw:
        return {}

    try:
        rows = json.loads(raw)
    except json.JSONDecodeError:
        return {}

    if not isinstance(rows, list) or len(rows) < 2:
        return {}

    header = rows[0]
    result: dict[str, int] = {}
    for row in rows[1:]:
        d = dict(zip(header, row))
        full_name = d.get("NAME", "")
        m_name = full_name.split(" County")[0].strip() if " County" in full_name else ""
        pop = _parse_num(d.get("B01003_001E"))
        if m_name and pop is not None:
            result[m_name] = int(pop)
    _log(f"  Prior population (ACS {prior_year}): {len(result)} counties")
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    _log("=== Fetch Colorado County Economic Indicators ===")
    _log(f"  Run at: {datetime.now(timezone.utc).isoformat()}")
    _log("")

    # Load county FIPS
    county_fips = load_county_fips()
    if not county_fips:
        _warn("No county FIPS data — cannot proceed")
        return 1
    _log(f"Loaded {len(county_fips)} CO county FIPS codes")

    # ── ACS data ──────────────────────────────────────────────────────────────
    acs_data: dict[str, dict] | None = None
    acs_year_used = 0
    for year in ACS_CANDIDATES:
        acs_data = fetch_acs_county_data(year)
        if acs_data:
            acs_year_used = year
            break
        time.sleep(1)

    if not acs_data:
        _warn("Failed to fetch ACS data from any candidate year; retaining existing file")
        return 0

    # Prior population for growth rate
    prior_pop = fetch_acs_prior_population(acs_year_used)

    # ── BLS LAUS ──────────────────────────────────────────────────────────────
    laus_ur = fetch_laus_unemployment(county_fips)

    # ── BLS QCEW ──────────────────────────────────────────────────────────────
    qcew_growth = fetch_qcew_job_growth(county_fips)

    # ── Assemble output ───────────────────────────────────────────────────────
    counties_out: dict[str, dict] = {}
    for county_name in sorted(county_fips.keys()):
        acs = acs_data.get(county_name, {})
        income = acs.get("median_hh_income")
        home_val = acs.get("median_home_value")
        pop_cur = acs.get("population")
        pop_base = prior_pop.get(county_name)

        # Affordability index = home price / annual income (lower = more affordable)
        afford_idx = (
            round(home_val / income, 2)
            if (income and income > 0 and home_val and home_val > 0)
            else None
        )

        # 5-year population growth %
        pop_growth = (
            round(((pop_cur - pop_base) / pop_base) * 100, 2)
            if (pop_cur and pop_base and pop_base > 0)
            else None
        )

        counties_out[county_name] = {
            "unemployment_rate":          laus_ur.get(county_name),
            "job_growth_5yr_pct":         qcew_growth.get(county_name),
            "affordability_index":        afford_idx,
            "population_growth_5yr_pct":  pop_growth,
            "median_home_price":          home_val,
            "median_hh_income":           income,
        }

    laus_year = datetime.now(timezone.utc).year - 1
    source_str = (
        f"BLS LAUS (unemployment {laus_year} annual avg), "
        f"BLS QCEW (job growth 5-yr), "
        f"ACS {acs_year_used} 5-year (home price, income, population)"
    )

    output = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "source": source_str,
        "note": (
            "Affordability index = median home price / median household income. "
            "Values refreshed weekly by CI workflow."
        ),
        "counties": counties_out,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(output, fh, indent=2, ensure_ascii=False)
    _log(f"\nWrote {OUT_FILE} ({OUT_FILE.stat().st_size:,} bytes)")
    _log(f"  Counties: {len(counties_out)}")
    _log(f"  LAUS coverage:  {sum(1 for v in counties_out.values() if v.get('unemployment_rate') is not None)} / {len(counties_out)}")
    _log(f"  QCEW coverage:  {sum(1 for v in counties_out.values() if v.get('job_growth_5yr_pct') is not None)} / {len(counties_out)}")
    _log(f"  ACS coverage:   {sum(1 for v in counties_out.values() if v.get('median_hh_income') is not None)} / {len(counties_out)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
