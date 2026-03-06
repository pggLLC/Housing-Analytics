#!/usr/bin/env python3
"""BLS (Bureau of Labor Statistics) data integration for Housing Needs Assessment.

Fetches and caches:
  - LAUS (Local Area Unemployment Statistics) unemployment rates by county
  - QCEW (Quarterly Census of Employment and Wages) employment/wage data

Results are stored as JSON files in data/hna/bls/ for consumption by the
frontend and the economic indicator pipeline.

Usage
-----
    python scripts/hna/bls_integration.py

Environment variables
---------------------
    BLS_API_KEY  — optional BLS API v2 key (allows higher rate limits).
                   Set in the GitHub Actions environment secrets.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parents[2]
CACHE_DIR = ROOT / "data" / "hna" / "bls"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

BLS_API_BASE = "https://api.bls.gov/publicAPI/v2/timeseries/data/"

# Colorado-level series IDs (LAUS state-level)
STATE_SERIES = {
    "co_unemployment_rate": "LASST080000000000003",   # CO unemployment rate
    "co_labor_force":       "LASST080000000000006",   # CO labour force
    "co_employed":          "LASST080000000000005",   # CO employed
}

# County LAUS series prefix template: LAUCN{fips5}0000000000{measure}
# measure: 3=UR, 4=unemployed persons, 5=employed persons, 6=labour force
LAUS_UR_SUFFIX = "0000000000003"


def laus_ur_series_id(county_fips5: str) -> str:
    """Return the BLS LAUS series ID for the unemployment rate of a county."""
    return f"LAUCN{county_fips5}{LAUS_UR_SUFFIX}"


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def utc_now_z() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def http_post_json(url: str, payload: dict, timeout: int = 30) -> Any:
    """POST JSON payload to *url* and return parsed response.  Returns None on error."""
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "HNA-ETL/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8", errors="replace"))
    except Exception as exc:
        print(f"⚠ BLS POST error: {exc}", file=sys.stderr)
        return None


def http_get_json(url: str, timeout: int = 30) -> Any:
    """GET *url* and return parsed JSON.  Returns None on error."""
    req = urllib.request.Request(url, headers={"User-Agent": "HNA-ETL/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8", errors="replace"))
    except Exception as exc:
        print(f"⚠ BLS GET error: {exc}", file=sys.stderr)
        return None


# ---------------------------------------------------------------------------
# BLS API helpers
# ---------------------------------------------------------------------------

def _bls_api_key() -> str:
    return os.environ.get("BLS_API_KEY", "")


def fetch_bls_series(
    series_ids: list[str],
    start_year: int,
    end_year: int,
    catalog: bool = False,
) -> dict[str, Any] | None:
    """Fetch one or more BLS time-series via the v2 API.

    Returns the raw BLS response dict, or None on failure.
    Handles the 25-series-per-request limit by batching.
    """
    if not series_ids:
        return None

    payload: dict[str, Any] = {
        "seriesid": series_ids[:25],  # v2 limit
        "startyear": str(start_year),
        "endyear": str(end_year),
        "catalog": catalog,
    }
    key = _bls_api_key()
    if key:
        payload["registrationkey"] = key

    result = http_post_json(BLS_API_BASE, payload)
    if result and result.get("status") == "REQUEST_SUCCEEDED":
        return result
    if result:
        msg = " | ".join(result.get("message", []) or [])
        print(f"⚠ BLS API returned status={result.get('status')} — {msg}", file=sys.stderr)
    return None


def extract_annual_values(series_data: list[dict]) -> dict[int, float]:
    """Extract annual average values from a BLS series data list.

    BLS LAUS annual data uses period 'M13' (annual average).
    Falls back to simple mean of monthly values if M13 is absent.
    Returns {year: value}.
    """
    annual: dict[int, float] = {}
    monthly: dict[int, list[float]] = {}

    for entry in series_data:
        year = int(entry.get("year", 0))
        period = entry.get("period", "")
        try:
            value = float(entry.get("value", "nan"))
        except ValueError:
            continue

        if period == "M13":  # annual average
            annual[year] = value
        elif period.startswith("M"):
            monthly.setdefault(year, []).append(value)

    # Fill in years that only have monthly data
    for year, vals in monthly.items():
        if year not in annual and vals:
            annual[year] = round(sum(vals) / len(vals), 2)

    return annual


# ---------------------------------------------------------------------------
# County LAUS fetch
# ---------------------------------------------------------------------------

def fetch_county_unemployment(
    county_fips5: str,
    start_year: int = 2019,
    end_year: int = 2023,
) -> dict[str, Any]:
    """Fetch LAUS unemployment rate for a single county.

    Returns a dict suitable for caching to JSON:
    {
      "county": "08077",
      "series_id": "LAUCN080770000000003",
      "annual_ur": {2019: 4.2, 2020: 7.8, ...},
      "fetched_at": "2024-01-01T00:00:00Z",
      "source": "BLS LAUS",
    }
    """
    series_id = laus_ur_series_id(county_fips5)
    result = fetch_bls_series([series_id], start_year, end_year)

    annual_ur: dict[int, float] = {}
    if result:
        for series in result.get("Results", {}).get("series", []):
            if series.get("seriesID") == series_id:
                annual_ur = extract_annual_values(series.get("data", []))
                break

    return {
        "county": county_fips5,
        "series_id": series_id,
        "annual_ur": {str(k): v for k, v in sorted(annual_ur.items())},
        "fetched_at": utc_now_z(),
        "source": "BLS LAUS (Local Area Unemployment Statistics)",
    }


# ---------------------------------------------------------------------------
# State-level context fetch
# ---------------------------------------------------------------------------

def fetch_state_context(
    start_year: int = 2019,
    end_year: int = 2023,
) -> dict[str, Any]:
    """Fetch Colorado statewide labour market indicators from BLS LAUS.

    Returns a cached dict with annual unemployment rate and labour force data.
    """
    series_list = list(STATE_SERIES.values())
    result = fetch_bls_series(series_list, start_year, end_year)

    data: dict[str, dict[int, float]] = {}
    if result:
        for series in result.get("Results", {}).get("series", []):
            sid = series.get("seriesID", "")
            for key, mapped_id in STATE_SERIES.items():
                if sid == mapped_id:
                    data[key] = extract_annual_values(series.get("data", []))

    def _to_str_keys(d: dict) -> dict:
        return {str(k): v for k, v in sorted(d.items())}

    return {
        "state": "CO",
        "annual_unemployment_rate": _to_str_keys(data.get("co_unemployment_rate", {})),
        "annual_labor_force": _to_str_keys(data.get("co_labor_force", {})),
        "annual_employed": _to_str_keys(data.get("co_employed", {})),
        "fetched_at": utc_now_z(),
        "source": "BLS LAUS Colorado statewide series",
    }


# ---------------------------------------------------------------------------
# QCEW wage data
# ---------------------------------------------------------------------------

def fetch_qcew_county_wages(
    county_fips5: str,
    years: list[int] | None = None,
) -> dict[str, Any]:
    """Fetch QCEW average weekly wage data for a county via the BLS QCEW API.

    Uses the BLS QCEW public data API (no key required):
      https://data.bls.gov/cew/data/api/{year}/{qtr}/area/{area}.json

    Returns:
    {
      "county": "08077",
      "annual_avg_weekly_wage": {"2019": 850, "2020": 870, ...},
      "annual_employment": {"2019": 44500, ...},
      "fetched_at": "...",
      "source": "BLS QCEW",
    }
    """
    if years is None:
        years = list(range(2019, 2024))

    # QCEW area code: county FIPS with leading zeros to 5 digits
    area_code = county_fips5.zfill(5)

    annual_wages: dict[str, float] = {}
    annual_emp: dict[str, int] = {}

    for year in years:
        # Annual average: qtr=a1
        url = f"https://data.bls.gov/cew/data/api/{year}/a1/area/{area_code}.json"
        data = http_get_json(url, timeout=20)
        if not data:
            time.sleep(0.5)
            continue

        # QCEW JSON structure: {"annualData": [...rows...]}
        # Each row: {"agglvl_code": "70", "own_code": "0", "avg_wkly_wage": "850", ...}
        # agglvl_code "70" = county, own_code "0" = total all ownerships
        rows = data.get("annualData", [])
        for row in rows:
            if str(row.get("agglvl_code")) == "70" and str(row.get("own_code")) == "0":
                try:
                    wage = float(str(row.get("avg_wkly_wage", "0")).replace(",", ""))
                    estabs = int(str(row.get("annual_avg_estabs_count", "0")).replace(",", "") or 0)
                    annual_wages[str(year)] = wage
                    annual_emp[str(year)] = estabs
                except (ValueError, TypeError):
                    pass
                break
        time.sleep(0.3)  # be polite to the public API

    return {
        "county": county_fips5,
        "annual_avg_weekly_wage": annual_wages,
        "annual_avg_estabs_count": annual_emp,
        "fetched_at": utc_now_z(),
        "source": "BLS QCEW (Quarterly Census of Employment and Wages)",
    }


# ---------------------------------------------------------------------------
# Cache helpers
# ---------------------------------------------------------------------------

def cache_path(name: str) -> Path:
    """Return the local cache file path for a named dataset."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / f"{name}.json"


def write_cache(name: str, data: dict) -> Path:
    """Write *data* to the JSON cache file for *name*."""
    path = cache_path(name)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


def read_cache(name: str) -> dict | None:
    """Read a JSON cache file.  Returns None if the file does not exist."""
    path = cache_path(name)
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


# ---------------------------------------------------------------------------
# Main CLI
# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    """Fetch and cache BLS data for featured Colorado counties."""
    featured_counties = ["08077"]  # Mesa County; extend via CLI or env

    print("BLS Integration — fetching labour market data")
    print(f"Cache directory: {CACHE_DIR}")
    print()

    # State context
    print("Fetching Colorado statewide context…")
    state_data = fetch_state_context()
    path = write_cache("co_state_context", state_data)
    print(f"  Wrote: {path}")

    # County-level LAUS
    for fips in featured_counties:
        print(f"Fetching LAUS for county {fips}…")
        county_data = fetch_county_unemployment(fips)
        path = write_cache(f"laus_{fips}", county_data)
        print(f"  Wrote: {path}")
        time.sleep(0.5)

    # County-level QCEW
    for fips in featured_counties:
        print(f"Fetching QCEW wages for county {fips}…")
        wage_data = fetch_qcew_county_wages(fips)
        path = write_cache(f"qcew_{fips}", wage_data)
        print(f"  Wrote: {path}")
        time.sleep(0.5)

    print("\n✅ BLS integration complete.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
