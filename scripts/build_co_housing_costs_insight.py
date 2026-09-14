#!/usr/bin/env python3
"""
build_co_housing_costs_insight.py
==================================
Full data pipeline for the Colorado Housing Costs county-level insight article.

Usage
-----
    python scripts/build_co_housing_costs_insight.py [--refresh]

    --refresh   Re-fetch all remote data (default: use cached Parquet if present)

Outputs
-------
    data/co-housing-costs/
        acs_county_latest.parquet
        acs_tract_latest.parquet        (optional, requires CENSUS_API_KEY)
        fhfa_hpi_county_raw.parquet
        bls_series.parquet
        qcew_construction_county.parquet
        permits_county.parquet
        drivers_ranking.csv

    assets/co-housing-costs/
        maps/
            co_county_median_rent_latest.html
            co_county_rent_burden_30_latest.html
            co_county_vacancy_latest.html
            co_county_rent_change_10y_win.html
            co_county_rent_change_15y_win.html
            co_county_fhfa_hpi_change_10y.html
            co_county_construction_wages.html
            co_county_permits_per_capita.html
        charts/
            ppi_construction_inputs.png
        snapshots/
            acs_county_latest.csv
            drivers_ranking.csv

    data/co-housing-costs/README.md     (field documentation)

Attribution
-----------
* This product uses the Census Bureau Data API but is not endorsed or
  certified by the Census Bureau.
* FHFA HPI data: Federal Housing Finance Agency (public domain).
* BLS data: Bureau of Labor Statistics (public domain).
* If Zillow data is used: "Data Provided by Zillow Group."
"""

from __future__ import annotations

import argparse
import datetime
import json
import logging
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Optional heavy dependencies — degrade gracefully if unavailable
# ---------------------------------------------------------------------------
try:
    import pandas as pd
    HAS_PANDAS = True
except ImportError:  # pragma: no cover
    HAS_PANDAS = False

try:
    import geopandas as gpd  # type: ignore
    HAS_GEOPANDAS = True
except ImportError:  # pragma: no cover
    HAS_GEOPANDAS = False

try:
    import folium  # type: ignore
    HAS_FOLIUM = True
except ImportError:  # pragma: no cover
    HAS_FOLIUM = False

try:
    import matplotlib  # type: ignore
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    HAS_MATPLOTLIB = True
except ImportError:  # pragma: no cover
    HAS_MATPLOTLIB = False

try:
    from sklearn.linear_model import ElasticNetCV  # type: ignore
    from sklearn.preprocessing import StandardScaler  # type: ignore
    HAS_SKLEARN = True
except ImportError:  # pragma: no cover
    HAS_SKLEARN = False

try:
    __import__("pyarrow")  # type: ignore
    HAS_PYARROW = True
except ImportError:  # pragma: no cover
    HAS_PYARROW = False

# Prevent unused-variable warnings for optional dependency flags in tools like CodeQL.
# This does not affect runtime behavior but documents their intended presence.
OPTIONAL_DEPENDENCY_FLAGS = {
    "pandas": HAS_PANDAS,
    "geopandas": HAS_GEOPANDAS,
    "folium": HAS_FOLIUM,
    "matplotlib": HAS_MATPLOTLIB,
    "sklearn": HAS_SKLEARN,
    "pyarrow": HAS_PYARROW,
}
_ = (
    HAS_PANDAS,
    HAS_FOLIUM,
    HAS_MATPLOTLIB,
    HAS_SKLEARN,
    HAS_PYARROW,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = REPO_ROOT / "data" / "co-housing-costs"
ASSETS_MAPS = REPO_ROOT / "assets" / "co-housing-costs" / "maps"
ASSETS_CHARTS = REPO_ROOT / "assets" / "co-housing-costs" / "charts"
ASSETS_SNAPSHOTS = REPO_ROOT / "assets" / "co-housing-costs" / "snapshots"


class Config:
    """Central configuration: URLs, FIPS codes, ACS variables."""

    # Colorado state FIPS
    STATE_FIPS: str = "08"

    # ACS 5-year vintages for windowed change (non-overlapping cohorts)
    # 2024 = 2020–2024 survey; 2014 = 2010–2014; 2009 = 2005–2009
    ACS_COHORTS: List[int] = [2024, 2014, 2009]

    # ACS variables to fetch (estimate + MOE)
    ACS_VARS: Dict[str, str] = {
        # Median gross rent
        "B25064_001E": "median_gross_rent",
        "B25064_001M": "median_gross_rent_moe",
        # Median household income
        "B19013_001E": "median_hh_income",
        "B19013_001M": "median_hh_income_moe",
        # Total housing units (for vacancy rate denominator)
        "B25002_001E": "total_housing_units",
        "B25002_001M": "total_housing_units_moe",
        # Vacant units
        "B25002_003E": "vacant_units",
        "B25002_003M": "vacant_units_moe",
        # Rent burden — total renter-occupied with cash rent
        "B25070_001E": "rent_burden_total",
        # Rent burden — paying 30–34.9%
        "B25070_007E": "rent_burden_30_34",
        # Rent burden — paying 35–39.9%
        "B25070_008E": "rent_burden_35_39",
        # Rent burden — paying 40–49.9%
        "B25070_009E": "rent_burden_40_49",
        # Rent burden — paying 50%+
        "B25070_010E": "rent_burden_50plus",
    }

    # Census API base
    CENSUS_API_BASE: str = "https://api.census.gov/data"

    # FHFA HPI county-level (all-transactions, annual).
    # FHFA retired the old DataTools/Downloads BDL path; the current public
    # machine-readable workbook lives under /hpi/download/annual/.
    FHFA_HPI_URL: str = "https://www.fhfa.gov/hpi/download/annual/hpi_at_county.xlsx"

    # BLS API (Public Data API v2 — no key required for <= 25 series / day)
    BLS_API_URL: str = "https://api.bls.gov/publicAPI/v2/timeseries/data/"

    # BLS PPI series IDs for construction inputs
    BLS_PPI_SERIES: Dict[str, str] = {
        "WPUFD4111": "Construction Materials (Nonresidential Building)",
        "WPUIP231120": "Net Inputs to Multifamily Residential Construction",
        "PCU331110331110": "Iron & Steel Mills",
        "PCU331315331315": "Aluminium Sheet/Plate/Foil",
        "PCU327310327310": "Ready-Mix Concrete",
    }

    # BLS QCEW county-level construction wages (NAICS 23).
    #
    # Uses the QCEW Open Data Access single-industry slice, which returns
    # annual-average records for one NAICS code across every published area
    # in ~1 MB.  Do NOT switch this back to the national singlefile ZIP
    # (data.bls.gov/cew/data/files/{year}/csv/{year}_qtrly_singlefile.zip):
    # that archive is ~290 MB compressed / several GB expanded, and reading
    # it with pandas exhausted the GitHub runner, which the OS then killed
    # ("The runner has received a shutdown signal") on every scheduled run
    # from 2026-05-02 onward.  It is also quarterly-only, so it carries
    # neither the `qtr == "A"` annual records nor the `avg_annual_pay`
    # column this pipeline needs.
    QCEW_INDUSTRY_URL: str = (
        "https://data.bls.gov/cew/data/api/{year}/a/industry/{industry}.csv"
    )
    QCEW_INDUSTRY_CODE: str = "23"   # NAICS 23 — Construction
    QCEW_STATE_FIPS: str = "08"      # Colorado
    # A published vintage with fewer usable counties than this is treated as
    # not-yet-final and the previous vintage is used instead.
    QCEW_MIN_COUNTIES: int = 20

    # Census Building Permits Survey — annual county files.
    #
    # Census serves these from www2.census.gov/econ/bps/County as fixed-column
    # .txt (still comma-separated, two header rows). The former path,
    # www.census.gov/construction/bps/csv/co{year}a.csv, 404s for every year;
    # the pipeline had been requesting it with a two-digit year on top of that,
    # so the permits layer fetched nothing and the committed parquet is
    # placeholder data rather than Census figures.
    BPS_BASE_URL: str = "https://www2.census.gov/econ/bps/County/co{year}a.txt"

    # Colorado county GeoJSON (Tiger/Line simplified — already in repo)
    COUNTY_GEOJSON: Path = REPO_ROOT / "data" / "co-county-boundaries.json"

    # Folium map center (Colorado centroid)
    MAP_CENTER: Tuple[float, float] = (39.0, -105.5)
    MAP_ZOOM: int = 6

    # Colorado bounding box for map pan/zoom restriction (WGS84)
    # ~5% padding beyond the true state extent [36.99°N–41.00°N, -109.06°W–-102.04°W]
    CO_BOUNDS: List[List[float]] = [[36.79, -109.42], [41.21, -101.68]]

    # Zillow integration (optional — set env var ZILLOW_DATA_PATH to a CSV)
    ZILLOW_DATA_PATH: Optional[str] = os.environ.get("ZILLOW_DATA_PATH")

    # BLS API key (optional — public tier allows 25 series/day without key)
    BLS_API_KEY: Optional[str] = os.environ.get("BLS_API_KEY")

    # Census API key (required for most county-level queries)
    CENSUS_API_KEY: Optional[str] = os.environ.get("CENSUS_API_KEY")


# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

def _fetch_url(url: str, timeout: int = 60) -> bytes:
    """Fetch URL, return raw bytes."""
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "COHO-Analytics/1.0 (housing-data-pipeline)"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _fetch_json(url: str, timeout: int = 60) -> Any:
    return json.loads(_fetch_url(url, timeout=timeout).decode("utf-8"))


def _fetch_url_with_retry(url: str, timeout: int = 60, retries: int = 3) -> bytes:
    """Fetch URL with exponential-backoff retry on transient failures.

    Args:
        url:     URL to download.
        timeout: Per-attempt socket timeout in seconds.
        retries: Maximum number of attempts (including the initial attempt).
    """
    if retries < 1:
        raise ValueError(f"retries must be >= 1, got {retries}")
    last_exc: Optional[Exception] = None
    for attempt in range(retries):
        try:
            return _fetch_url(url, timeout=timeout)
        except Exception as exc:
            last_exc = exc
            if attempt < retries - 1:
                wait = 2 ** (attempt + 1)  # 2 s, 4 s, …
                log.warning(
                    "Download attempt %d/%d failed: %s — retrying in %ds",
                    attempt + 1, retries, exc, wait,
                )
                time.sleep(wait)
    raise last_exc  # type: ignore[misc]  # last_exc is always set when retries >= 1


def _ensure_dirs() -> None:
    for d in [DATA_DIR, ASSETS_MAPS, ASSETS_CHARTS, ASSETS_SNAPSHOTS]:
        d.mkdir(parents=True, exist_ok=True)


def _to_int(val: Any) -> Optional[int]:
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


def _to_float(val: Any) -> Optional[float]:
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# ACS Fetcher
# ---------------------------------------------------------------------------

def _acs_url(year: int, geo: str, cfg: Config) -> str:
    """Build Census API URL for ACS 5-year county data."""
    vars_param = ",".join(["NAME"] + list(cfg.ACS_VARS.keys()))
    params: Dict[str, str] = {
        "get": vars_param,
        "for": geo,
        "in": f"state:{cfg.STATE_FIPS}",
    }
    if cfg.CENSUS_API_KEY:
        params["key"] = cfg.CENSUS_API_KEY
    base = f"{cfg.CENSUS_API_BASE}/{year}/acs/acs5"
    return base + "?" + urllib.parse.urlencode(params)


def fetch_acs_county(cfg: Config, refresh: bool = False) -> "pd.DataFrame":
    """Fetch ACS 5-year county data for all cohort years."""
    if not HAS_PANDAS:
        log.warning("pandas not available — skipping ACS fetch")
        return None  # type: ignore

    cache_path = DATA_DIR / "acs_county_latest.parquet"
    if not refresh and cache_path.exists():
        log.info("ACS county: loading from cache %s", cache_path)
        return pd.read_parquet(cache_path)

    if not cfg.CENSUS_API_KEY:
        log.warning(
            "CENSUS_API_KEY not set — ACS county fetch will be attempted without a key "
            "(may fail for county-level queries). Set the CENSUS_API_KEY environment variable."
        )

    all_frames: List["pd.DataFrame"] = []

    for year in cfg.ACS_COHORTS:
        log.info("Fetching ACS %d county data …", year)
        try:
            url = _acs_url(year, "county:*", cfg)
            payload = _fetch_json(url)
        except Exception as exc:
            log.warning("ACS %d fetch failed: %s — skipping", year, exc)
            continue

        if not isinstance(payload, list) or len(payload) < 2:
            log.warning("ACS %d: unexpected response shape — skipping", year)
            continue

        header = payload[0]
        idx = {h: i for i, h in enumerate(header)}
        rows = []
        for r in payload[1:]:
            state_val = r[idx.get("state", -1)] if "state" in idx else ""
            county_val = r[idx.get("county", -1)] if "county" in idx else ""
            # Validate and pad components before concatenation (Rule 1)
            state_str = str(state_val).zfill(2) if str(state_val).isdigit() else "00"
            county_str = str(county_val).zfill(3) if str(county_val).isdigit() else "000"
            county_fips = (state_str + county_str).zfill(5)
            rec: Dict[str, Any] = {
                "county_fips": county_fips,
                "county_name": r[idx["NAME"]] if "NAME" in idx else "",
                "acs_year": year,
            }
            for raw_var, friendly in cfg.ACS_VARS.items():
                val = r[idx[raw_var]] if raw_var in idx else None
                rec[friendly] = _to_int(val)
            rows.append(rec)

        if not rows:
            continue

        df_year = pd.DataFrame(rows)
        # Derived: vacancy rate
        df_year["vacancy_rate"] = df_year.apply(
            lambda row: (
                row["vacant_units"] / row["total_housing_units"]
                if (row["total_housing_units"] or 0) > 0
                else None
            ),
            axis=1,
        )
        # Derived: rent-burden share ≥30%
        df_year["rent_burden_30_plus"] = df_year.apply(
            lambda row: (
                (
                    (row.get("rent_burden_30_34") or 0)
                    + (row.get("rent_burden_35_39") or 0)
                    + (row.get("rent_burden_40_49") or 0)
                    + (row.get("rent_burden_50plus") or 0)
                )
                / row["rent_burden_total"]
                if (row["rent_burden_total"] or 0) > 0
                else None
            ),
            axis=1,
        )
        all_frames.append(df_year)
        time.sleep(0.5)  # rate-limit courtesy

    if not all_frames:
        log.error("No ACS data fetched for any cohort year.")
        return pd.DataFrame()

    df = pd.concat(all_frames, ignore_index=True)

    if HAS_PYARROW:
        df.to_parquet(cache_path, index=False)
        log.info("Saved ACS county data to %s", cache_path)
    else:
        log.warning("pyarrow not available — skipping Parquet write")

    # CSV snapshot (public-facing, no raw MOE columns)
    _save_acs_snapshot(df)
    return df


def _save_acs_snapshot(df: "pd.DataFrame") -> None:
    """Save a public CSV snapshot of key ACS metrics (no raw MOE)."""
    keep_cols = [
        "county_fips",
        "county_name",
        "acs_year",
        "median_gross_rent",
        "median_hh_income",
        "vacancy_rate",
        "rent_burden_30_plus",
    ]
    snap_cols = [c for c in keep_cols if c in df.columns]
    snap = df[snap_cols].copy()

    # Latest cohort only -- the file is `_latest` and every consumer keys it by
    # county_fips alone. Writing all three cohorts (2009/2014/2024) gives three
    # rows per county, and build_article_indicator_geojson.mjs indexes
    # last-wins, so the 2009 rows would silently win and the choropleth would
    # render 2009 rents as current (Adams County $869 against 2024's $1,781).
    # build_article_full_indicators.py already filters the parquet this way.
    if "acs_year" in snap.columns and not snap.empty:
        latest_year = snap["acs_year"].max()
        snap = snap[snap["acs_year"] == latest_year].copy()

    out = ASSETS_SNAPSHOTS / "acs_county_latest.csv"
    snap.to_csv(out, index=False)
    log.info("Saved ACS snapshot CSV to %s (%d rows)", out, len(snap))


def _compute_acs_window_change(df: "pd.DataFrame") -> "pd.DataFrame":
    """Compute 10-year and 15-year windowed rent/income change."""
    if df is None or df.empty:
        return pd.DataFrame()

    pivoted = df.pivot_table(
        index="county_fips",
        columns="acs_year",
        values=["median_gross_rent", "median_hh_income", "vacancy_rate", "rent_burden_30_plus"],
    )
    # Flatten multi-index columns
    pivoted.columns = ["_".join(map(str, c)) for c in pivoted.columns]
    pivoted = pivoted.reset_index()

    def _pct_change(new_col: str, base_col: str) -> "pd.Series":
        new_vals = pivoted.get(new_col)
        base_vals = pivoted.get(base_col)
        if new_vals is None or base_vals is None:
            return pd.Series([None] * len(pivoted))
        return (new_vals / base_vals - 1).where((base_vals > 0) & new_vals.notna() & base_vals.notna())

    # 10-year window: 2014 cohort → 2024 cohort
    pivoted["rent_change_10y"] = _pct_change("median_gross_rent_2024", "median_gross_rent_2014")
    pivoted["income_change_10y"] = _pct_change("median_hh_income_2024", "median_hh_income_2014")

    # 15-year window: 2009 cohort → 2024 cohort
    pivoted["rent_change_15y"] = _pct_change("median_gross_rent_2024", "median_gross_rent_2009")
    pivoted["income_change_15y"] = _pct_change("median_hh_income_2024", "median_hh_income_2009")

    return pivoted


# ---------------------------------------------------------------------------
# ACS Tract (optional)
# ---------------------------------------------------------------------------

def fetch_acs_tract(cfg: Config, refresh: bool = False) -> Optional["pd.DataFrame"]:
    """Optionally fetch tract-level ACS data (latest cohort only)."""
    if not HAS_PANDAS:
        return None

    cache_path = DATA_DIR / "acs_tract_latest.parquet"
    if not refresh and cache_path.exists():
        log.info("ACS tract: loading from cache")
        return pd.read_parquet(cache_path)

    if not cfg.CENSUS_API_KEY:
        log.info("Skipping ACS tract fetch (no CENSUS_API_KEY)")
        return None

    latest_year = max(cfg.ACS_COHORTS)
    log.info("Fetching ACS %d tract data for Colorado …", latest_year)
    try:
        url = _acs_url(latest_year, "tract:*", cfg)
        payload = _fetch_json(url)
    except Exception as exc:
        log.warning("ACS tract fetch failed: %s", exc)
        return None

    if not isinstance(payload, list) or len(payload) < 2:
        return None

    header = payload[0]
    idx = {h: i for i, h in enumerate(header)}
    rows = []
    for r in payload[1:]:
        state_val = r[idx["state"]] if "state" in idx else ""
        county_val = r[idx["county"]] if "county" in idx else ""
        tract_val = r[idx["tract"]] if "tract" in idx else ""
        # Validate components before concatenation (Rule 1)
        state_str = str(state_val).zfill(2) if str(state_val).isdigit() else "00"
        county_str = str(county_val).zfill(3) if str(county_val).isdigit() else "000"
        tract_str = str(tract_val).zfill(6) if str(tract_val).replace(".", "").isdigit() else "000000"
        tract_geoid = state_str + county_str + tract_str
        rec: Dict[str, Any] = {
            "tract_geoid": tract_geoid.zfill(11),
            "county_fips": (state_str + county_str).zfill(5),
            "acs_year": latest_year,
        }
        for raw_var, friendly in cfg.ACS_VARS.items():
            val = r[idx[raw_var]] if raw_var in idx else None
            rec[friendly] = _to_int(val)
        rows.append(rec)

    if not rows:
        return None

    df = pd.DataFrame(rows)
    if HAS_PYARROW:
        df.to_parquet(cache_path, index=False)
        log.info("Saved ACS tract data to %s", cache_path)
    return df


# ---------------------------------------------------------------------------
# FHFA HPI Fetcher
# ---------------------------------------------------------------------------

def fetch_fhfa_hpi(cfg: Config, refresh: bool = False) -> Optional["pd.DataFrame"]:
    """
    Download FHFA All-Transactions HPI (county-level).

    The FHFA publishes this as an Excel file. We parse the Colorado rows
    and compute 10-year HPI change.

    TODO: Update FHFA_HPI_URL in Config when FHFA publishes a new vintage.
    """
    if not HAS_PANDAS:
        log.warning("pandas not available — skipping FHFA HPI fetch")
        return None

    cache_path = DATA_DIR / "fhfa_hpi_county_raw.parquet"
    if not refresh and cache_path.exists():
        log.info("FHFA HPI: loading from cache")
        return pd.read_parquet(cache_path)

    log.info("Downloading FHFA HPI county data …")
    try:
        raw = _fetch_url(cfg.FHFA_HPI_URL, timeout=120)
    except Exception as exc:
        log.warning("FHFA HPI download failed: %s — skipping", exc)
        return None

    try:
        import io
        workbook = io.BytesIO(raw)
        df_raw = None
        for header_row in range(0, 12):
            workbook.seek(0)
            candidate = pd.read_excel(workbook, engine="openpyxl", header=header_row)
            cols = [str(c).strip().lower() for c in candidate.columns]
            if any("fips" in c for c in cols) and any(c == "state" for c in cols):
                df_raw = candidate
                break
        if df_raw is None:
            workbook.seek(0)
            df_raw = pd.read_excel(workbook, engine="openpyxl")
    except Exception as exc:
        log.warning("FHFA HPI parse failed: %s — skipping", exc)
        return None

    # FHFA files have varied slightly by vintage, but include a FIPS-like
    # county id, a state/state-abbreviation field, a year field, and an index.
    fips_col = next((c for c in df_raw.columns if "fips" in c.lower()), None)
    state_candidates = [c for c in df_raw.columns if "state" in c.lower()]
    if fips_col is None or not state_candidates:
        log.warning("FHFA HPI: unexpected column structure — skipping; columns=%s", list(df_raw.columns))
        return None

    df = df_raw.copy()
    state_mask = None
    for state_col in state_candidates:
        values = df[state_col].astype(str).str.strip().str.upper()
        mask = values.isin(["CO", "COLORADO", "8", "08"])
        if mask.any():
            state_mask = mask
            break
    if state_mask is None:
        log.warning("FHFA HPI: could not identify Colorado rows — skipping; state columns=%s", state_candidates)
        return None
    df = df[state_mask].copy()
    df["county_fips"] = df[fips_col].astype(str).str.zfill(5)

    # Keep only annual data (quarter == 4 as year-end proxy, or all-quarters mean)
    yr_col = next((c for c in df.columns if c.lower() in ("yr", "year")), None)
    qtr_col = next((c for c in df.columns if c.lower() in ("qtr", "quarter")), None)
    idx_col = next((c for c in df.columns if c.lower() == "hpi"), None)
    if idx_col is None:
        idx_col = next((c for c in df.columns if "nsa" in c.lower() or "index" in c.lower()), None)

    if yr_col is None or idx_col is None:
        log.warning("FHFA HPI: cannot identify year/index columns — skipping")
        return None

    if qtr_col:
        df = df[df[qtr_col] == 4].copy()

    df = df.rename(columns={yr_col: "hpi_year", idx_col: "hpi_value"})
    df["hpi_year"] = pd.to_numeric(df["hpi_year"], errors="coerce")
    df["hpi_value"] = pd.to_numeric(df["hpi_value"], errors="coerce")
    df = df[["county_fips", "hpi_year", "hpi_value"]].dropna()

    # Compute 10-year change (year T vs year T-10)
    latest_yr = int(df["hpi_year"].max())
    base_10y = latest_yr - 10
    base_15y = latest_yr - 15

    hpi_latest = df[df["hpi_year"] == latest_yr][["county_fips", "hpi_value"]].rename(
        columns={"hpi_value": "hpi_latest"}
    )
    hpi_10y = df[df["hpi_year"] == base_10y][["county_fips", "hpi_value"]].rename(
        columns={"hpi_value": "hpi_10y_base"}
    )
    hpi_15y = df[df["hpi_year"] == base_15y][["county_fips", "hpi_value"]].rename(
        columns={"hpi_value": "hpi_15y_base"}
    )

    merged = (
        hpi_latest
        .merge(hpi_10y, on="county_fips", how="left")
        .merge(hpi_15y, on="county_fips", how="left")
    )
    merged["hpi_change_10y"] = (merged["hpi_latest"] / merged["hpi_10y_base"] - 1).where(
        merged["hpi_10y_base"] > 0
    )
    merged["hpi_change_15y"] = (merged["hpi_latest"] / merged["hpi_15y_base"] - 1).where(
        merged["hpi_15y_base"] > 0
    )

    if HAS_PYARROW:
        df.to_parquet(cache_path, index=False)
        log.info("Saved FHFA HPI raw to %s", cache_path)

    return merged


# ---------------------------------------------------------------------------
# BLS PPI Fetcher
# ---------------------------------------------------------------------------

def fetch_bls_ppi(cfg: Config, refresh: bool = False) -> Optional["pd.DataFrame"]:
    """
    Fetch BLS PPI series for construction inputs via the BLS Public Data API v2.
    """
    if not HAS_PANDAS:
        log.warning("pandas not available — skipping BLS PPI fetch")
        return None

    cache_path = DATA_DIR / "bls_series.parquet"
    if not refresh and cache_path.exists():
        log.info("BLS PPI: loading from cache")
        return pd.read_parquet(cache_path)

    series_ids = list(cfg.BLS_PPI_SERIES.keys())
    now = datetime.datetime.utcnow()
    start_year = str(now.year - 15)
    end_year = str(now.year)

    payload: Dict[str, Any] = {
        "seriesid": series_ids,
        "startyear": start_year,
        "endyear": end_year,
        "catalog": False,
        "calculations": False,
        "annualaverage": True,
    }
    if cfg.BLS_API_KEY:
        payload["registrationkey"] = cfg.BLS_API_KEY

    log.info("Fetching BLS PPI series %s …", series_ids)
    try:
        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            cfg.BLS_API_URL,
            data=data_bytes,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        log.warning("BLS PPI fetch failed: %s — skipping", exc)
        return None

    if result.get("status") != "REQUEST_SUCCEEDED":
        log.warning("BLS API returned status %s — skipping", result.get("status"))
        return None

    rows: List[Dict[str, Any]] = []
    for series in result.get("Results", {}).get("series", []):
        sid = series["seriesID"]
        label = cfg.BLS_PPI_SERIES.get(sid, sid)
        for obs in series.get("data", []):
            period = obs.get("period", "")
            year = _to_int(obs.get("year"))
            value = _to_float(obs.get("value"))
            # Annual average has period M13
            is_annual = period == "M13"
            rows.append({
                "series_id": sid,
                "series_label": label,
                "year": year,
                "period": period,
                "is_annual": is_annual,
                "value": value,
            })

    if not rows:
        log.warning("BLS PPI: no observations returned")
        return None

    df = pd.DataFrame(rows)
    if HAS_PYARROW:
        df.to_parquet(cache_path, index=False)
        log.info("Saved BLS series to %s", cache_path)
    return df


# ---------------------------------------------------------------------------
# QCEW Construction Wages
# ---------------------------------------------------------------------------

QCEW_OUTPUT_COLUMNS = ["county_fips", "qcew_year", "avg_annual_wage", "avg_weekly_wage"]


def _parse_qcew_annual_slice(
    df_raw: "pd.DataFrame", year: int, cfg: Config
) -> "pd.DataFrame":
    """Reduce a QCEW annual single-industry slice to Colorado county wage rows.

    The slice covers every published area for one NAICS code, so this keeps
    only real Colorado counties (``08xxx``, excluding the ``08999`` "Unknown
    Or Undefined" pseudo-county), private ownership, at the county-by-NAICS-
    sector aggregation level.
    """
    def col(name: str) -> "pd.Series":
        if name in df_raw.columns:
            return df_raw[name].fillna("").astype(str).str.strip()
        return pd.Series([""] * len(df_raw), index=df_raw.index, dtype=str)

    area = col("area_fips")
    mask = (
        area.str.match(rf"^{cfg.QCEW_STATE_FIPS}\d{{3}}$")
        & (area != f"{cfg.QCEW_STATE_FIPS}999")
        & (col("industry_code") == cfg.QCEW_INDUSTRY_CODE)
        & (col("qtr").str.upper() == "A")      # annual average record
        & (col("agglvl_code") == "74")         # county, by NAICS sector
        & (col("own_code") == "5")             # private ownership
    )

    if not mask.any():
        return pd.DataFrame(columns=QCEW_OUTPUT_COLUMNS)

    annual = pd.to_numeric(col("avg_annual_pay")[mask], errors="coerce")
    weekly_col = (
        "annual_avg_wkly_wage"
        if "annual_avg_wkly_wage" in df_raw.columns
        else "avg_wkly_wage"
    )
    weekly = pd.to_numeric(col(weekly_col)[mask], errors="coerce")

    # BLS publishes disclosure-suppressed rows with a non-empty
    # `disclosure_code` and a *zero* wage rather than a blank.  Left as zeros
    # those counties would enter the ElasticNet drivers model as $0-wage
    # observations, so mark them missing and let the model's dropna() drop
    # them instead.
    usable = (col("disclosure_code")[mask] == "")
    annual = annual.where(usable & (annual > 0))
    weekly = weekly.where(usable & (weekly > 0))

    out = pd.DataFrame(
        {
            "county_fips": area[mask].str.zfill(5),
            "qcew_year": year,
            "avg_annual_wage": annual,
            "avg_weekly_wage": weekly,
        }
    )
    return out.sort_values("county_fips").reset_index(drop=True)[QCEW_OUTPUT_COLUMNS]


def fetch_qcew_construction(cfg: Config, refresh: bool = False) -> Optional["pd.DataFrame"]:
    """
    Fetch QCEW annual-average wages for construction (NAICS 23) by Colorado county.

    Downloads the ~1 MB QCEW Open Data Access slice for one industry and one
    year (see ``Config.QCEW_INDUSTRY_URL`` for why the national singlefile ZIP
    must not be used here).  BLS publishes annual averages several months into
    the following year, so the most recent vintage is tried first and older
    ones are used as fallbacks.
    """
    if not HAS_PANDAS:
        log.warning("pandas not available — skipping QCEW fetch")
        return None

    cache_path = DATA_DIR / "qcew_construction_county.parquet"
    if not refresh and cache_path.exists():
        log.info("QCEW: loading from cache")
        return pd.read_parquet(cache_path)

    now = datetime.datetime.now(datetime.timezone.utc)
    candidate_years = [now.year - 1, now.year - 2, now.year - 3]

    import io

    df: Optional["pd.DataFrame"] = None
    for year in candidate_years:
        url = cfg.QCEW_INDUSTRY_URL.format(
            year=year, industry=cfg.QCEW_INDUSTRY_CODE
        )
        log.info("Downloading QCEW %d annual construction slice from %s …", year, url)
        try:
            raw = _fetch_url_with_retry(url, timeout=120, retries=3)
        except Exception as exc:
            log.warning("QCEW %d download failed: %s", year, exc)
            continue

        try:
            df_raw = pd.read_csv(io.BytesIO(raw), dtype=str)
        except Exception as exc:
            log.warning("QCEW %d parse failed: %s", year, exc)
            continue

        if "area_fips" not in df_raw.columns:
            log.warning(
                "QCEW %d: unexpected schema — first columns %s",
                year, list(df_raw.columns)[:6],
            )
            continue

        parsed = _parse_qcew_annual_slice(df_raw, year, cfg)
        usable = int(parsed["avg_annual_wage"].notna().sum())
        if usable < cfg.QCEW_MIN_COUNTIES:
            log.warning(
                "QCEW %d: only %d CO counties with unsuppressed construction wages "
                "(need >= %d) — falling back to an earlier vintage",
                year, usable, cfg.QCEW_MIN_COUNTIES,
            )
            continue

        log.info(
            "QCEW %d: %d CO county rows, %d with unsuppressed wages",
            year, len(parsed), usable,
        )
        df = parsed
        break

    if df is None or df.empty:
        log.warning("QCEW: no data fetched — returning empty DataFrame")
        return pd.DataFrame(columns=QCEW_OUTPUT_COLUMNS)

    if HAS_PYARROW:
        df.to_parquet(cache_path, index=False)
        log.info("Saved QCEW to %s", cache_path)
    return df


# ---------------------------------------------------------------------------
# Census Building Permits Survey
# ---------------------------------------------------------------------------

BPS_OUTPUT_COLUMNS = ["county_fips", "bps_year", "total_units"]

# Census BPS county files carry two header rows: a group row ("1-unit",
# "2-units", "3-4 units", "5+ units", then the same four as "rep" revisions)
# and a sub-header repeating Bldgs/Units/Value under each group. Columns are
# positional, so these indices are the Units cell of each of the four
# structure-size groups -- deliberately excluding the "rep" duplicates, which
# would double-count.
BPS_UNIT_COLUMNS = (7, 10, 13, 16)
BPS_BLDG_COLUMNS = (6, 9, 12, 15)


def _bps_header_is_expected(rows: List[List[str]]) -> bool:
    """Verify the sub-header still puts Units where BPS_UNIT_COLUMNS expects.

    The columns are positional and unlabelled per-cell, so a reordering
    upstream would silently produce plausible-looking wrong totals. Checking
    the header turns that into a skipped year with a warning instead.
    """
    for row in rows[:3]:
        cells = [c.strip().lower() for c in row]
        if len(cells) <= max(BPS_UNIT_COLUMNS):
            continue
        if all(cells[i] == "units" for i in BPS_UNIT_COLUMNS) and \
           all(cells[i] == "bldgs" for i in BPS_BLDG_COLUMNS):
            return True
    return False


def _parse_bps_county_file(text: str, state_fips: str) -> List[Dict[str, Any]]:
    """Extract one state's county rows from an annual BPS county file."""
    import csv
    import io as _io

    rows = list(csv.reader(_io.StringIO(text)))
    if not _bps_header_is_expected(rows):
        return []

    state_code = int(state_fips)
    out: List[Dict[str, Any]] = []
    for row in rows:
        if len(row) <= max(BPS_UNIT_COLUMNS):
            continue
        survey, st, cty = row[0].strip(), row[1].strip(), row[2].strip()
        if not (survey.isdigit() and st.isdigit() and cty.isdigit()):
            continue
        if int(st) != state_code:
            continue
        try:
            units = sum(int(row[i].strip() or 0) for i in BPS_UNIT_COLUMNS)
        except ValueError:
            continue
        out.append({
            "county_fips": f"{int(st):02d}{int(cty):03d}",
            "bps_year": int(survey),
            "total_units": units,
        })
    return out


def fetch_building_permits(cfg: Config, refresh: bool = False) -> Optional["pd.DataFrame"]:
    """
    Fetch Census BPS annual county-level residential permit data.

    One ~370 KB file per year (see ``Config.BPS_BASE_URL``). Units are summed
    across the four structure-size groups; the "rep" (reported) duplicates of
    those same groups are excluded.
    """
    if not HAS_PANDAS:
        log.warning("pandas not available — skipping BPS fetch")
        return None

    cache_path = DATA_DIR / "permits_county.parquet"
    if not refresh and cache_path.exists():
        log.info("BPS: loading from cache")
        return pd.read_parquet(cache_path)

    now = datetime.datetime.now(datetime.timezone.utc)
    candidate_years = list(range(now.year - 1, now.year - 6, -1))

    rows: List[Dict[str, Any]] = []
    for year in candidate_years:
        url = cfg.BPS_BASE_URL.format(year=year)
        log.info("Fetching BPS %d permits from %s …", year, url)
        try:
            raw = _fetch_url_with_retry(url, timeout=120, retries=3)
        except Exception as exc:
            log.warning("BPS %d fetch failed: %s", year, exc)
            continue

        parsed = _parse_bps_county_file(
            raw.decode("utf-8", errors="replace"), cfg.QCEW_STATE_FIPS
        )
        if not parsed:
            log.warning(
                "BPS %d: no Colorado county rows (schema change or empty file)", year
            )
            continue

        rows.extend(parsed)
        log.info(
            "BPS %d: %d counties, %d total units",
            year, len(parsed), sum(r["total_units"] for r in parsed),
        )

    if not rows:
        log.warning("BPS: no data fetched")
        return pd.DataFrame(columns=BPS_OUTPUT_COLUMNS)

    df = pd.DataFrame(rows)[BPS_OUTPUT_COLUMNS].sort_values(
        ["county_fips", "bps_year"]
    ).reset_index(drop=True)

    if HAS_PYARROW:
        df.to_parquet(cache_path, index=False)
        log.info("Saved BPS to %s", cache_path)
    return df


# ---------------------------------------------------------------------------
# ElasticNetCV Drivers Model
# ---------------------------------------------------------------------------

def run_drivers_model(
    acs_wide: "pd.DataFrame",
    hpi: Optional["pd.DataFrame"],
    qcew: Optional["pd.DataFrame"],
    bps: Optional["pd.DataFrame"],
    cfg: Config,
) -> Optional["pd.DataFrame"]:
    """
    Fit ElasticNetCV to rank drivers of FHFA HPI 10-year change.

    Target  : hpi_change_10y
    Features: income_change_10y, vacancy_rate (2024), rent_burden_30_plus (2024),
              avg_annual_units_5y per capita (BPS), avg_annual_wage (QCEW)
    """
    if not HAS_PANDAS or not HAS_SKLEARN:
        log.warning("pandas or scikit-learn not available — skipping drivers model")
        return None

    if hpi is None or hpi.empty:
        log.warning("No FHFA HPI data — skipping drivers model")
        return None

    # Build a single wide county-level frame
    # Use 2024 ACS cohort for snapshot features
    acs_2024 = None
    if acs_wide is not None and not acs_wide.empty:
        # If pivoted wide, get rent-burden and vacancy from 2024 columns
        if "rent_burden_30_plus_2024" in acs_wide.columns:
            acs_2024 = acs_wide[
                ["county_fips", "income_change_10y", "rent_change_10y",
                 "rent_burden_30_plus_2024", "vacancy_rate_2024"]
            ].copy()
        else:
            acs_2024 = acs_wide[["county_fips"]].copy()

    merged = hpi[["county_fips", "hpi_change_10y"]].copy()

    if acs_2024 is not None:
        merged = merged.merge(acs_2024, on="county_fips", how="left")

    if qcew is not None and not qcew.empty:
        qcew_agg = qcew.groupby("county_fips")["avg_annual_wage"].mean().reset_index()
        merged = merged.merge(qcew_agg, on="county_fips", how="left")

    if bps is not None and not bps.empty:
        bps_agg = (
            bps.groupby("county_fips")["total_units"]
            .mean()
            .reset_index()
            .rename(columns={"total_units": "avg_annual_units_5y"})
        )
        merged = merged.merge(bps_agg, on="county_fips", how="left")

    feature_cols = [
        c for c in [
            "income_change_10y",
            "vacancy_rate_2024",
            "rent_burden_30_plus_2024",
            "avg_annual_units_5y",
            "avg_annual_wage",
        ]
        if c in merged.columns
    ]

    if not feature_cols:
        log.warning("No feature columns available for drivers model")
        return None

    sub = merged[["county_fips", "hpi_change_10y"] + feature_cols].dropna()
    if len(sub) < 5:
        log.warning("Insufficient complete cases (%d) for ElasticNetCV", len(sub))
        return None

    X = sub[feature_cols].values
    y = sub["hpi_change_10y"].values

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    model = ElasticNetCV(cv=5, l1_ratio=[0.1, 0.5, 0.7, 0.9, 1.0], max_iter=10000)
    model.fit(X_scaled, y)

    coefs = model.coef_
    ranking = sorted(
        zip(feature_cols, coefs),
        key=lambda x: abs(x[1]),
        reverse=True,
    )

    # Friendly labels
    friendly_map = {
        "income_change_10y": "Median income growth (10y)",
        "vacancy_rate_2024": "Vacancy rate",
        "rent_burden_30_plus_2024": "Rent burden ≥30% share",
        "avg_annual_units_5y": "Permits per capita (5yr avg)",
        "avg_annual_wage": "Avg construction wages",
    }

    df_ranking = pd.DataFrame(
        [
            {
                "feature": friendly_map.get(feat, feat),
                "coefficient": round(float(coef), 4),
                "source": _feature_source(feat),
            }
            for feat, coef in ranking
        ]
    )

    out_data = DATA_DIR / "drivers_ranking.csv"
    out_snap = ASSETS_SNAPSHOTS / "drivers_ranking.csv"
    df_ranking.to_csv(out_data, index=False)
    df_ranking.to_csv(out_snap, index=False)
    log.info("Saved drivers ranking to %s and %s", out_data, out_snap)
    return df_ranking


def _feature_source(feat: str) -> str:
    mapping = {
        "income_change_10y": "ACS B19013",
        "vacancy_rate_2024": "ACS B25002",
        "rent_burden_30_plus_2024": "ACS B25070",
        "avg_annual_units_5y": "Census BPS",
        "avg_annual_wage": "BLS QCEW NAICS 23",
    }
    return mapping.get(feat, "")


# ---------------------------------------------------------------------------
# Folium Map Generation
# ---------------------------------------------------------------------------

def _load_county_geojson(cfg: Config) -> Optional[Any]:
    """Load Colorado county GeoJSON from repo data directory."""
    path = cfg.COUNTY_GEOJSON
    if not path.exists():
        log.warning("County GeoJSON not found at %s — maps will be skipped", path)
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception as exc:
        log.warning("Failed to load county GeoJSON: %s", exc)
        return None


def _make_choropleth_map(
    geojson: Any,
    data: "pd.DataFrame",
    county_col: str,
    value_col: str,
    title: str,
    out_path: Path,
    fmt: str = "{:.0f}",
    colormap: str = "YlOrRd",
    cfg: Optional[Config] = None,
) -> None:
    """Generate a Folium choropleth map and save as HTML."""
    if not HAS_FOLIUM or not HAS_PANDAS:
        log.warning("folium or pandas not available — skipping map: %s", out_path.name)
        return

    if data is None or data.empty or value_col not in data.columns:
        log.warning("No data for map %s — skipping", out_path.name)
        return

    center = cfg.MAP_CENTER if cfg else (39.0, -105.5)
    zoom = cfg.MAP_ZOOM if cfg else 6
    co_bounds = cfg.CO_BOUNDS if cfg else [[36.79, -109.42], [41.21, -101.68]]

    m = folium.Map(location=list(center), zoom_start=zoom, tiles="CartoDB positron", max_bounds=True)
    m.fit_bounds(co_bounds)

    # Build lookup dict: fips -> value
    valid = data[[county_col, value_col]].dropna()

    # Determine key in GeoJSON features for FIPS
    # Support both "GEOID" and "FIPS" property keys
    feature_key = "properties.GEOID"
    if geojson.get("features"):
        props = geojson["features"][0].get("properties", {})
        if "GEOID" in props:
            feature_key = "properties.GEOID"
        elif "fips" in props:
            feature_key = "properties.fips"
        elif "FIPS" in props:
            feature_key = "properties.FIPS"

    folium.Choropleth(
        geo_data=geojson,
        name=title,
        data=valid,
        columns=[county_col, value_col],
        key_on=feature_key,
        fill_color=colormap,
        fill_opacity=0.75,
        line_opacity=0.4,
        legend_name=title,
        nan_fill_color="white",
        nan_fill_opacity=0.2,
    ).add_to(m)

    # Tooltip
    tooltip_layer = folium.GeoJson(
        geojson,
        tooltip=folium.GeoJsonTooltip(
            fields=list(geojson["features"][0].get("properties", {}).keys())[:3],
            aliases=list(geojson["features"][0].get("properties", {}).keys())[:3],
        ),
        style_function=lambda x: {"fillOpacity": 0, "weight": 0},
    )
    tooltip_layer.add_to(m)

    folium.LayerControl().add_to(m)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    m.save(str(out_path))
    log.info("Saved map: %s", out_path)


def generate_maps(
    acs_df: Optional["pd.DataFrame"],
    acs_wide: Optional["pd.DataFrame"],
    hpi: Optional["pd.DataFrame"],
    qcew: Optional["pd.DataFrame"],
    bps: Optional["pd.DataFrame"],
    cfg: Config,
) -> None:
    """Generate all county-level choropleth maps."""
    geojson = _load_county_geojson(cfg)
    if geojson is None:
        log.warning("No county GeoJSON — skipping all map generation")
        return

    # Current ACS snapshot (latest cohort year)
    if acs_df is not None and not acs_df.empty:
        latest_year = max(cfg.ACS_COHORTS)
        acs_latest = acs_df[acs_df["acs_year"] == latest_year].copy()

        _make_choropleth_map(
            geojson, acs_latest, "county_fips", "median_gross_rent",
            "Median Gross Rent (2020–2024 ACS, $)",
            ASSETS_MAPS / "co_county_median_rent_latest.html",
            fmt="${:,.0f}", colormap="YlOrRd", cfg=cfg,
        )
        _make_choropleth_map(
            geojson, acs_latest, "county_fips", "rent_burden_30_plus",
            "Rent Burden Share ≥30% (2020–2024 ACS)",
            ASSETS_MAPS / "co_county_rent_burden_30_latest.html",
            fmt="{:.1%}", colormap="OrRd", cfg=cfg,
        )
        _make_choropleth_map(
            geojson, acs_latest, "county_fips", "vacancy_rate",
            "Vacancy Rate (2020–2024 ACS)",
            ASSETS_MAPS / "co_county_vacancy_latest.html",
            fmt="{:.1%}", colormap="Blues", cfg=cfg,
        )

    # Windowed change maps
    if acs_wide is not None and not acs_wide.empty:
        _make_choropleth_map(
            geojson, acs_wide, "county_fips", "rent_change_10y",
            "Rent Change: 10-Year Window (2014→2024 Cohorts)",
            ASSETS_MAPS / "co_county_rent_change_10y_win.html",
            fmt="{:.1%}", colormap="RdYlGn_r", cfg=cfg,
        )
        _make_choropleth_map(
            geojson, acs_wide, "county_fips", "rent_change_15y",
            "Rent Change: 15-Year Window (2009→2024 Cohorts)",
            ASSETS_MAPS / "co_county_rent_change_15y_win.html",
            fmt="{:.1%}", colormap="RdYlGn_r", cfg=cfg,
        )

    # FHFA HPI map
    if hpi is not None and not hpi.empty:
        _make_choropleth_map(
            geojson, hpi, "county_fips", "hpi_change_10y",
            "FHFA HPI 10-Year Change",
            ASSETS_MAPS / "co_county_fhfa_hpi_change_10y.html",
            fmt="{:.1%}", colormap="YlOrRd", cfg=cfg,
        )

    # QCEW construction wages map
    if qcew is not None and not qcew.empty:
        qcew_agg = qcew.groupby("county_fips")["avg_annual_wage"].mean().reset_index()
        _make_choropleth_map(
            geojson, qcew_agg, "county_fips", "avg_annual_wage",
            "Avg Annual Construction Wages (QCEW NAICS 23, $)",
            ASSETS_MAPS / "co_county_construction_wages.html",
            fmt="${:,.0f}", colormap="PuBu", cfg=cfg,
        )

    # Building permits per capita map
    if bps is not None and not bps.empty and acs_df is not None and not acs_df.empty:
        bps_agg = (
            bps.groupby("county_fips")["total_units"]
            .mean()
            .reset_index()
            .rename(columns={"total_units": "avg_annual_units_5y"})
        )
        _make_choropleth_map(
            geojson, bps_agg, "county_fips", "avg_annual_units_5y",
            "Avg Annual Residential Permits (5-yr avg, Census BPS)",
            ASSETS_MAPS / "co_county_permits_per_capita.html",
            fmt="{:,.0f}", colormap="YlGn", cfg=cfg,
        )


# ---------------------------------------------------------------------------
# PPI Chart
# ---------------------------------------------------------------------------

def generate_ppi_chart(bls_df: Optional["pd.DataFrame"]) -> None:
    """Generate a PNG line chart of BLS PPI construction input series."""
    if not HAS_MATPLOTLIB:
        log.warning("matplotlib not available — skipping PPI chart")
        return
    if bls_df is None or bls_df.empty:
        log.warning("No BLS data — skipping PPI chart")
        return

    annual = bls_df[bls_df["is_annual"]].copy()
    if annual.empty:
        log.warning("No annual BLS data — skipping PPI chart")
        return

    fig, ax = plt.subplots(figsize=(10, 5))
    for label, grp in annual.groupby("series_label"):
        grp_sorted = grp.sort_values("year")
        ax.plot(grp_sorted["year"], grp_sorted["value"], marker="o", markersize=3, label=label)

    ax.set_title("BLS PPI: Construction Input Costs (Annual Average)", fontsize=13)
    ax.set_xlabel("Year")
    ax.set_ylabel("Index (1982=100)")
    ax.legend(fontsize=8, loc="upper left")
    ax.grid(True, alpha=0.3)
    fig.tight_layout()

    out = ASSETS_CHARTS / "ppi_construction_inputs.png"
    fig.savefig(str(out), dpi=150, bbox_inches="tight")
    plt.close(fig)
    log.info("Saved PPI chart: %s", out)


# ---------------------------------------------------------------------------
# Zillow Integration (optional)
# ---------------------------------------------------------------------------

def load_zillow_data(cfg: Config) -> Optional["pd.DataFrame"]:
    """
    Optionally load Zillow county-level data from a CSV path.

    Attribution requirement: Any use of Zillow data must display:
        "Data Provided by Zillow Group."

    Set env var ZILLOW_DATA_PATH to the local CSV file path.
    """
    if not cfg.ZILLOW_DATA_PATH:
        return None
    if not HAS_PANDAS:
        return None

    path = Path(cfg.ZILLOW_DATA_PATH)
    if not path.exists():
        log.warning("Zillow data file not found at %s", path)
        return None

    log.info("Loading Zillow data from %s  [Data Provided by Zillow Group.]", path)
    try:
        df = pd.read_csv(path, dtype={"fips": str})
        df["county_fips"] = df["fips"].str.zfill(5)
        return df
    except Exception as exc:
        log.warning("Zillow data load failed: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Output Validation & Pipeline Status
# ---------------------------------------------------------------------------

def _collect_source_status(**frames: Optional["pd.DataFrame"]) -> Dict[str, Any]:
    """Summarise what each upstream fetch actually returned.

    Recorded into pipeline-status.json so the published status describes the
    run that produced it rather than restating a hand-written assumption about
    which sources are live.
    """
    out: Dict[str, Any] = {}
    for name, df in frames.items():
        if df is None:
            out[name] = {"status": "unavailable", "rows": 0}
            continue
        rows = int(len(df))
        entry: Dict[str, Any] = {"status": "ok" if rows else "empty", "rows": rows}
        if rows and HAS_PANDAS:
            for year_col in ("qcew_year", "acs_year", "year"):
                if year_col in df.columns:
                    years = pd.to_numeric(df[year_col], errors="coerce").dropna()
                    if not years.empty:
                        entry["vintage"] = int(years.max())
                    break
        out[name] = entry
    return out


def _validate_outputs_and_write_status(
    sources: Optional[Dict[str, Any]] = None,
    run_started: Optional[float] = None,
) -> None:
    """Check that expected pipeline outputs are present AND were written by this run.

    Existence alone is not enough. When a source goes dead the map that depends
    on it is simply not regenerated, and the file left behind from an earlier
    run keeps satisfying an exists() check -- which is how a placeholder
    permits map went on reporting `maps_complete: true` while its source
    fetched nothing. Anything older than this run's start is reported stale.
    """
    expected_maps = [
        "co_county_median_rent_latest.html",
        "co_county_rent_burden_30_latest.html",
        "co_county_vacancy_latest.html",
        "co_county_rent_change_10y_win.html",
        "co_county_rent_change_15y_win.html",
        "co_county_fhfa_hpi_change_10y.html",
        "co_county_construction_wages.html",
        "co_county_permits_per_capita.html",
    ]

    def _written_this_run(path: Path) -> bool:
        if run_started is None:
            return path.exists()
        try:
            # 1s of slack: some filesystems store mtime at second resolution.
            return path.stat().st_mtime >= run_started - 1
        except OSError:
            return False

    maps_present = [f for f in expected_maps if (ASSETS_MAPS / f).exists()]
    maps_missing = [f for f in expected_maps if f not in maps_present]
    maps_stale = [f for f in maps_present if not _written_this_run(ASSETS_MAPS / f)]
    maps_fresh = [f for f in maps_present if f not in maps_stale]

    drivers_path = ASSETS_SNAPSHOTS / "drivers_ranking.csv"
    csv_ok = drivers_path.exists()
    csv_fresh = csv_ok and _written_this_run(drivers_path)

    if maps_missing:
        log.warning(
            "Missing map outputs (%d/%d): %s",
            len(maps_missing), len(expected_maps), maps_missing,
        )
    if maps_stale:
        log.warning(
            "Map outputs left over from an earlier run (%d/%d): %s — the data "
            "behind them was not regenerated, check the `sources` block",
            len(maps_stale), len(expected_maps), maps_stale,
        )
    if not maps_missing and not maps_stale:
        log.info("All %d expected maps regenerated by this run.", len(expected_maps))

    if not csv_ok:
        log.warning("drivers_ranking.csv not present in snapshots.")
    elif not csv_fresh:
        log.warning("drivers_ranking.csv was not regenerated by this run.")

    status = {
        "generated": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "maps_generated": len(maps_fresh),
        "maps_total": len(expected_maps),
        "maps_complete": len(maps_missing) == 0 and len(maps_stale) == 0,
        "drivers_csv_available": csv_ok and csv_fresh,
        "dependencies": OPTIONAL_DEPENDENCY_FLAGS,
        "missing_maps": maps_missing,
        "stale_maps": maps_stale,
        "sources": sources or {},
        "note": (
            "Written by scripts/build_co_housing_costs_insight.py at the end of "
            "every run; each field describes the outputs of that run only. "
            "`generated` is when the pipeline last completed — it is not a "
            "forecast that a future run will succeed."
        ),
    }

    status_path = ASSETS_SNAPSHOTS / "pipeline-status.json"
    status_path.parent.mkdir(parents=True, exist_ok=True)
    status_path.write_text(json.dumps(status, indent=2), encoding="utf-8")
    log.info("Pipeline status written to %s", status_path)


# ---------------------------------------------------------------------------
# README (field documentation)
# ---------------------------------------------------------------------------

README_CONTENT = """\
# data/co-housing-costs — Field Documentation

Generated by `scripts/build_co_housing_costs_insight.py`.

## File Inventory

| File | Description |
|------|-------------|
| `acs_county_latest.parquet` | ACS 5-year county estimates for cohorts 2009, 2014, 2024 |
| `acs_tract_latest.parquet` | ACS 5-year tract estimates (latest cohort only; optional) |
| `fhfa_hpi_county_raw.parquet` | FHFA All-Transactions HPI raw annual values + 10y/15y change |
| `bls_series.parquet` | BLS PPI series observations for construction input commodities |
| `qcew_construction_county.parquet` | BLS QCEW county-level avg wages for NAICS 23 (Construction) |
| `permits_county.parquet` | Census BPS annual residential permit totals by Colorado county |
| `drivers_ranking.csv` | ElasticNetCV feature coefficients ranked by absolute value |

---

## ACS County (`acs_county_latest.parquet`)

| Column | Source | Description |
|--------|--------|-------------|
| `county_fips` | Computed | 5-digit FIPS string (`08001`…`08125`). Always zero-padded. |
| `county_name` | ACS NAME | Full county name with state |
| `acs_year` | Pipeline | ACS vintage year (2009, 2014, or 2024) |
| `median_gross_rent` | B25064_001E | ACS median gross rent ($/month) |
| `median_gross_rent_moe` | B25064_001M | MOE for median gross rent |
| `median_hh_income` | B19013_001E | ACS median household income ($/year) |
| `median_hh_income_moe` | B19013_001M | MOE for median household income |
| `total_housing_units` | B25002_001E | Total housing units |
| `total_housing_units_moe` | B25002_001M | MOE for total housing units |
| `vacant_units` | B25002_003E | Vacant housing units |
| `vacant_units_moe` | B25002_003M | MOE for vacant units |
| `rent_burden_total` | B25070_001E | Total renter-occupied units with cash rent |
| `rent_burden_30_34` | B25070_007E | Renters paying 30–34.9% of income |
| `rent_burden_35_39` | B25070_008E | Renters paying 35–39.9% of income |
| `rent_burden_40_49` | B25070_009E | Renters paying 40–49.9% of income |
| `rent_burden_50plus` | B25070_010E | Renters paying 50%+ of income |
| `vacancy_rate` | Derived | `vacant_units / total_housing_units` |
| `rent_burden_30_plus` | Derived | Share of renters paying ≥30% of income on rent |

### MOE Caution

ACS margins of error can be large for small-population counties. The
coefficient of variation (CV = MOE / (1.645 × estimate)) exceeds 15% for
several variables in counties with fewer than ~5,000 residents. Use with
appropriate statistical caution.

---

## FHFA HPI (`fhfa_hpi_county_raw.parquet`)

| Column | Description |
|--------|-------------|
| `county_fips` | 5-digit FIPS |
| `hpi_year` | Year of the index observation (year-end Q4) |
| `hpi_value` | FHFA All-Transactions HPI (not seasonally adjusted) |
| `hpi_latest` | Most recent year HPI value |
| `hpi_10y_base` | HPI value 10 years prior to latest |
| `hpi_15y_base` | HPI value 15 years prior to latest |
| `hpi_change_10y` | `hpi_latest / hpi_10y_base - 1` |
| `hpi_change_15y` | `hpi_latest / hpi_15y_base - 1` |

Source: FHFA All-Transactions House Price Index (county, annual).
Counties below the minimum transaction threshold are excluded.

---

## BLS PPI Series (`bls_series.parquet`)

| Column | Description |
|--------|-------------|
| `series_id` | BLS series identifier |
| `series_label` | Human-readable label |
| `year` | Year |
| `period` | BLS period code (M13 = annual average) |
| `is_annual` | True when period == M13 |
| `value` | PPI index value |

Series fetched:
- `WPUFD4111` — Construction Materials (Nonresidential Building)
- `WPUIP231120` — Net Inputs to Multifamily Residential Construction
- `PCU331110331110` — Iron & Steel Mills
- `PCU331315331315` — Aluminium Sheet/Plate/Foil
- `PCU327310327310` — Ready-Mix Concrete

---

## QCEW Construction Wages (`qcew_construction_county.parquet`)

| Column | Description |
|--------|-------------|
| `county_fips` | 5-digit county FIPS |
| `qcew_year` | Data year (BLS annual-average vintage) |
| `avg_annual_wage` | Average annual wage for NAICS 23 workers ($); blank where BLS suppresses |
| `avg_weekly_wage` | Average weekly wage for NAICS 23 workers ($); blank where BLS suppresses |

Source: the BLS QCEW Open Data Access annual single-industry slice
(`data.bls.gov/cew/data/api/{year}/a/industry/23.csv`), private ownership,
county-by-NAICS-sector aggregation level. All 64 Colorado counties appear;
the `08999` "Unknown Or Undefined" pseudo-county is excluded.

Note: BLS withholds county wages that would disclose an individual employer
and publishes those rows with a `disclosure_code` and a **zero** wage. The
pipeline stores those as blank/NaN rather than zero, so a suppressed county
is dropped from the drivers model instead of entering it as a $0-wage
observation. Typically 45-55 of the 64 counties carry an unsuppressed wage.

---

## Building Permits (`permits_county.parquet`)

| Column | Description |
|--------|-------------|
| `county_fips` | 5-digit county FIPS |
| `bps_year` | Permit year |
| `total_units` | Total authorized residential units |

Source: Census Bureau Building Permits Survey, annual county files at
`www2.census.gov/econ/bps/County/co{year}a.txt` (the older
`www.census.gov/construction/bps/csv/*.csv` path 404s for every year).

`total_units` sums the Units column of all four structure-size groups
(1-unit, 2-units, 3-4 units, 5+ units). The file repeats those four groups a
second time as "rep" revisions; those are excluded, and including them would
roughly double every count. Columns are positional, so the parser checks the
sub-header row before trusting the indices.

---

## Drivers Ranking (`drivers_ranking.csv`)

| Column | Description |
|--------|-------------|
| `feature` | Predictor variable (friendly name) |
| `coefficient` | Standardized ElasticNetCV coefficient |
| `source` | Data source |

Model: ElasticNetCV (5-fold CV); target = FHFA HPI 10-year change.
Features are z-score standardized before fitting.

---

## Attribution

- **Census Bureau:** This product uses the Census Bureau Data API but is not
  endorsed or certified by the Census Bureau.
- **FHFA:** Federal Housing Finance Agency public data (no endorsement implied).
- **BLS:** Bureau of Labor Statistics public data (no endorsement implied).
- **Zillow (if used):** Data Provided by Zillow Group.
"""


def write_readme() -> None:
    out = DATA_DIR / "README.md"
    out.write_text(README_CONTENT, encoding="utf-8")
    log.info("Wrote README to %s", out)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main(refresh: bool = False) -> None:
    # Captured before anything is written so the status writer can tell an
    # output this run produced from one left behind by an earlier one.
    run_started = time.time()
    log.info("=== Colorado Housing Costs Pipeline ===")
    log.info("refresh=%s", refresh)

    # Log optional dependency status so operators know what will be skipped
    missing_deps = [name for name, avail in OPTIONAL_DEPENDENCY_FLAGS.items() if not avail]
    if missing_deps:
        log.warning("Missing optional dependencies: %s", ", ".join(missing_deps))
        if not HAS_PANDAS:
            log.warning("  → All data fetching and map generation will be skipped")
        elif not HAS_FOLIUM:
            log.warning("  → Map generation will be skipped (install folium)")
        if not HAS_SKLEARN:
            log.warning("  → Drivers regression model will be skipped (install scikit-learn)")
        if not HAS_MATPLOTLIB:
            log.warning("  → PPI chart will be skipped (install matplotlib)")
    else:
        log.info("All optional dependencies present — full pipeline enabled")

    _ensure_dirs()
    cfg = Config()

    # 1. Fetch ACS county data
    log.info("--- ACS county ---")
    acs_df = fetch_acs_county(cfg, refresh=refresh)

    # 2. Compute windowed changes
    acs_wide: Optional["pd.DataFrame"] = None
    if HAS_PANDAS and acs_df is not None and not acs_df.empty:
        log.info("--- Computing ACS window changes ---")
        acs_wide = _compute_acs_window_change(acs_df)

    # 3. Optional: ACS tract
    log.info("--- ACS tract (optional) ---")
    fetch_acs_tract(cfg, refresh=refresh)

    # 4. FHFA HPI
    log.info("--- FHFA HPI ---")
    hpi_df = fetch_fhfa_hpi(cfg, refresh=refresh)

    # 5. BLS PPI
    log.info("--- BLS PPI ---")
    bls_df = fetch_bls_ppi(cfg, refresh=refresh)

    # 6. QCEW construction wages
    log.info("--- QCEW construction wages ---")
    qcew_df = fetch_qcew_construction(cfg, refresh=refresh)

    # 7. Census building permits
    log.info("--- Census BPS permits ---")
    bps_df = fetch_building_permits(cfg, refresh=refresh)

    # 8. Optional: Zillow
    log.info("--- Zillow (optional) ---")
    zillow_df = load_zillow_data(cfg)
    if zillow_df is not None:
        log.info(
            "Zillow data loaded (%d rows). ATTRIBUTION: Data Provided by Zillow Group.",
            len(zillow_df),
        )

    # 9. Drivers model
    log.info("--- Drivers model ---")
    run_drivers_model(acs_wide, hpi_df, qcew_df, bps_df, cfg)

    # 10. Maps
    log.info("--- Map generation ---")
    generate_maps(acs_df, acs_wide, hpi_df, qcew_df, bps_df, cfg)

    # 11. PPI chart
    log.info("--- PPI chart ---")
    generate_ppi_chart(bls_df)

    # 12. README
    write_readme()

    # 13. Output validation and pipeline status
    log.info("--- Output validation ---")
    _validate_outputs_and_write_status(
        _collect_source_status(
            acs=acs_df, fhfa_hpi=hpi_df, bls_ppi=bls_df, qcew=qcew_df, bps=bps_df
        ),
        run_started=run_started,
    )

    log.info("=== Pipeline complete ===")
    log.info("Outputs:")
    log.info("  data/co-housing-costs/")
    log.info("  assets/co-housing-costs/maps/")
    log.info("  assets/co-housing-costs/charts/")
    log.info("  assets/co-housing-costs/snapshots/")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build CO Housing Costs insight data.")
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="Re-fetch all remote data (ignore Parquet cache)",
    )
    args = parser.parse_args()
    main(refresh=args.refresh)
