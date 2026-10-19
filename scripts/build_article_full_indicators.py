#!/usr/bin/env python3
"""F214 — Publish the full 7-indicator article snapshot CSV.

The existing snapshot CSV (assets/co-housing-costs/snapshots/acs_county_latest.csv)
only carries the four ACS-derived fields (median rent, vacancy, rent burden,
median income). The article page also visualises three more indicators that
live in the data-cache parquets but never made it to a public CSV:

  - FHFA HPI 10-year change (decimal)        ← fhfa_hpi_county_raw.parquet
  - QCEW avg annual construction wage (USD)  ← qcew_construction_county.parquet
  - BPS permits per 1,000 people, 5-year avg ← permits_county.parquet × ACS pop

Writes assets/co-housing-costs/snapshots/co_county_indicators_full.csv —
the input that scripts/build_article_indicator_geojson.mjs reads to join all
seven indicators onto the TIGER county polygons, so the data map browser can
expose them as toggleable choropleths.

update-co-housing-costs.yml runs this, then the GeoJSON joiner, after every
refresh of the parquets. Until 2026-10 nothing did: the CSV was written once,
in June 2026, from caches that still held placeholder values, and the map
showed them for four months (Summit vacancy 9% against ACS 61%, Denver income
$69,000 against $94,718). Idempotent.

Population for the per-capita permit rate comes from
data/co-county-demographics.json (Census API, ACS 5-year), and only when its
vintage matches the ACS cache: mixing vintages would divide one year's permits
by another survey's population, so a mismatch stops the build. The same file
is the check on the ACS fields: every county's rent, income, vacancy and rent
burden must agree with it, or the build stops rather than publish a map that
disagrees with the rest of the site. Either stop fails the monthly workflow,
which opens an issue and leaves the published layer as it was.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import pandas as pd

REPO = Path(__file__).resolve().parent.parent
CACHE = REPO / "data" / "co-housing-costs"
DEMOGRAPHICS = REPO / "data" / "co-county-demographics.json"
BOUNDARIES = REPO / "data" / "co-county-boundaries.json"
OUT = REPO / "assets" / "co-housing-costs" / "snapshots" / "co_county_indicators_full.csv"

PERMIT_YEARS = 5
HPI_YEARS = 10

# How far a cache value may sit from the Census API file before the build
# stops. Dollars are whole numbers in both; shares are rounded to four places
# in the demographics file.
TOLERANCE = {"median_gross_rent": 0.5, "median_hh_income": 0.5,
             "vacancy_rate": 0.00051, "rent_burden_30_plus": 0.00051}
DEMOGRAPHICS_FIELD = {"median_gross_rent": "median_gross_rent",
                      "median_hh_income": "median_hh_income",
                      "vacancy_rate": "vacancy_rate",
                      "rent_burden_30_plus": "cost_burden_share"}

COLUMNS = ["county_fips", "county_name", "acs_year",
           "median_gross_rent", "median_hh_income", "vacancy_rate",
           "rent_burden_30_plus", "renter_households", "renters_burdened_30_plus",
           "population",
           "fhfa_hpi_change_10y", "fhfa_base_year", "fhfa_latest_year",
           "qcew_avg_annual_wage", "qcew_year",
           "bps_permits_5yr_avg_units", "bps_first_year", "bps_last_year",
           "bps_permits_per_1k_5yr_avg"]

BURDEN_BANDS = ["rent_burden_30_34", "rent_burden_35_39",
                "rent_burden_40_49", "rent_burden_50plus"]


def _present(x) -> bool:
    return x is not None and not (isinstance(x, float) and math.isnan(x))


def _positive(x):
    """A rent, income, population or index of 0 means unknown, never free."""
    return float(x) if _present(x) and float(x) > 0 else None


def _county_names_to_fips() -> dict[str, str]:
    feats = json.loads(BOUNDARIES.read_text())["features"]
    return {f["properties"]["NAME"]: f["properties"]["GEOID"] for f in feats}


def _load_demographics(acs_year: int) -> dict[str, dict]:
    """County rows of the Census API file, keyed by FIPS, for one vintage."""
    d = json.loads(DEMOGRAPHICS.read_text())
    fips = _county_names_to_fips()
    out: dict[str, dict] = {}
    for name, row in (d.get("counties") or {}).items():
        if row.get("acs_year") != acs_year or name not in fips:
            continue
        out[fips[name]] = row
    return out


def _acs(acs: pd.DataFrame) -> pd.DataFrame:
    # acs_county_latest.parquet ships three cohorts (2024, 2014, 2009).
    # Keep only the latest (2024 = 2020–2024 ACS 5-year).
    acs = acs[acs["acs_year"] == acs["acs_year"].max()].copy()
    burdened = acs[BURDEN_BANDS]
    acs["renters_burdened_30_plus"] = burdened.sum(axis=1, min_count=len(BURDEN_BANDS)).where(
        burdened.notna().all(axis=1))
    acs["renter_households"] = acs["rent_burden_total"].where(acs["rent_burden_total"] > 0)
    for col in ("median_gross_rent", "median_hh_income"):
        acs[col] = acs[col].map(_positive)
    return acs[["county_fips", "county_name", "acs_year",
                "median_gross_rent", "median_hh_income",
                "vacancy_rate", "rent_burden_30_plus",
                "renter_households", "renters_burdened_30_plus"]]


def _fhfa_change(fhfa: pd.DataFrame) -> tuple[pd.DataFrame, int, int]:
    """10-year change in the FHFA all-transactions county index.

    The cache holds the raw annual series (county_fips, hpi_year, hpi_value).
    A county without an index in both end years gets no change: FHFA does not
    publish an index where sales are too few, and a gap is not a zero.
    """
    latest = int(fhfa["hpi_year"].max())
    base = latest - HPI_YEARS
    wide = fhfa.pivot_table(index="county_fips", columns="hpi_year", values="hpi_value")
    end = wide.get(latest).map(_positive) if latest in wide else None
    start = wide.get(base).map(_positive) if base in wide else None
    out = pd.DataFrame({"county_fips": wide.index})
    if end is None or start is None:
        out["fhfa_hpi_change_10y"] = None
    else:
        out["fhfa_hpi_change_10y"] = [
            round(e / s - 1, 4) if _present(e) and _present(s) else None
            for e, s in zip(end.values, start.values)
        ]
    return out, base, latest


def _permits(permits: pd.DataFrame) -> tuple[pd.DataFrame, int, int]:
    """Average annual units over the last five survey years.

    Only a county with a record in every one of those years gets an average:
    dividing by five over four years understates it, and dividing by four
    would make the window differ from county to county.
    """
    last = int(permits["bps_year"].max())
    first = last - PERMIT_YEARS + 1
    window = permits[permits["bps_year"].between(first, last)]
    rows = []
    for fips, g in window.groupby("county_fips"):
        years = set(g["bps_year"].astype(int))
        complete = years == set(range(first, last + 1)) and g["total_units"].notna().all()
        rows.append({"county_fips": fips,
                     "bps_permits_5yr_avg_units": round(g["total_units"].mean(), 1) if complete else None})
    return pd.DataFrame(rows), first, last


def _check_against_census(base: pd.DataFrame, census: dict[str, dict]) -> list[str]:
    problems = []
    for row in base.itertuples():
        ref = census.get(row.county_fips)
        if ref is None:
            problems.append(f"{row.county_fips}: missing from {DEMOGRAPHICS.name}")
            continue
        for field, tol in TOLERANCE.items():
            mine, theirs = getattr(row, field), ref.get(DEMOGRAPHICS_FIELD[field])
            if not _present(mine) and theirs is None:
                continue
            if not _present(mine) or theirs is None or abs(float(mine) - float(theirs)) > tol:
                problems.append(f"{row.county_fips} {field}: cache {mine} vs Census API {theirs}")
    return problems


def build() -> pd.DataFrame:
    acs = _acs(pd.read_parquet(CACHE / "acs_county_latest.parquet"))
    acs_year = int(acs["acs_year"].max())
    census = _load_demographics(acs_year)

    if not census:
        # fetch-county-demographics.js moves to a new ACS release on its own;
        # this pipeline's cohorts are pinned in Config.ACS_COHORTS. Publishing
        # anyway would blank all 64 permit rates and leave the ACS fields
        # unchecked, so stop and keep the layer already published.
        found = sorted({r.get("acs_year") for r in
                        (json.loads(DEMOGRAPHICS.read_text()).get("counties") or {}).values()},
                       key=str)
        sys.exit(f"{DEMOGRAPHICS.name} holds ACS {found}, the housing-cost caches ACS {acs_year}. "
                 "Move Config.ACS_COHORTS in scripts/build_co_housing_costs_insight.py to the "
                 "Census file's vintage (and the article's Key Findings with it), then re-run.")
    problems = _check_against_census(acs, census)
    if problems:
        sys.exit("ACS cache disagrees with the Census API file:\n  " + "\n  ".join(problems))
    pops = {f: _positive(r.get("population")) for f, r in census.items()}
    base = acs.copy()
    base["population"] = base["county_fips"].map(pops)

    qcew = pd.read_parquet(CACHE / "qcew_construction_county.parquet")
    qcew_year = int(qcew["qcew_year"].max())
    qcew = qcew[qcew["qcew_year"] == qcew_year]
    qcew_slim = qcew[["county_fips", "avg_annual_wage"]].rename(
        columns={"avg_annual_wage": "qcew_avg_annual_wage"})
    # BLS publishes a suppressed county with a zero wage; the fetcher already
    # nulls those, and this keeps a zero from ever reaching the map.
    qcew_slim["qcew_avg_annual_wage"] = qcew_slim["qcew_avg_annual_wage"].map(_positive)

    hpi, hpi_base, hpi_latest = _fhfa_change(pd.read_parquet(CACHE / "fhfa_hpi_county_raw.parquet"))
    permits, bps_first, bps_last = _permits(pd.read_parquet(CACHE / "permits_county.parquet"))
    base = (base
            .merge(hpi, on="county_fips", how="left")
            .merge(qcew_slim, on="county_fips", how="left")
            .merge(permits, on="county_fips", how="left"))

    # Each window applies to every county, including the four FHFA has no
    # series for at all, so the map can say which years a gap is a gap in.
    base["fhfa_base_year"] = hpi_base
    base["fhfa_latest_year"] = hpi_latest
    base["qcew_year"] = qcew_year
    base["bps_first_year"] = bps_first
    base["bps_last_year"] = bps_last

    base["bps_permits_per_1k_5yr_avg"] = [
        round(u / p * 1000, 3) if _present(u) and _present(p) else None
        for u, p in zip(base["bps_permits_5yr_avg_units"], base["population"])
    ]
    for col in ("vacancy_rate", "rent_burden_30_plus"):
        base[col] = base[col].round(4)
    return base[COLUMNS]


def main() -> None:
    base = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    int_cols = ["acs_year", "median_gross_rent", "median_hh_income", "renter_households", "renters_burdened_30_plus", "population",
                "fhfa_base_year", "fhfa_latest_year", "qcew_avg_annual_wage", "qcew_year",
                "bps_first_year", "bps_last_year"]
    for col in int_cols:
        base[col] = base[col].astype("Int64")
    base.to_csv(OUT, index=False)
    print(f"[F214] wrote {OUT}")
    print(f"  · counties: {len(base)}")
    for col in ("fhfa_hpi_change_10y", "qcew_avg_annual_wage", "bps_permits_per_1k_5yr_avg"):
        print(f"  · {col}: {int(base[col].notna().sum())} of {len(base)} counties")


if __name__ == "__main__":
    main()
