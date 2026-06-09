#!/usr/bin/env python3
"""F214 — Publish the full 7-indicator article snapshot CSV.

The existing snapshot CSV (assets/co-housing-costs/snapshots/acs_county_latest.csv)
only carries the four ACS-derived fields (median rent, vacancy, rent burden,
median income). The article page also visualises three more indicators that
live in the data-cache parquets but never made it to a public CSV:

  - FHFA HPI 10-year change (decimal)        ← fhfa_hpi_county_raw.parquet
  - QCEW avg annual construction wage (USD)  ← qcew_construction_county.parquet
  - BPS permits per capita 5-year avg        ← permits_county.parquet × ACS pop

Writes assets/co-housing-costs/snapshots/co_county_indicators_full.csv —
the input that scripts/build_article_indicator_geojson.mjs reads to join all
seven indicators onto the TIGER county polygons, so the data map browser can
expose them as toggleable choropleths.

Run after the article pipeline regenerates the parquets (or whenever those
caches are refreshed). Idempotent.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

REPO = Path(__file__).resolve().parent.parent
CACHE = REPO / "data" / "co-housing-costs"
RANKING_INDEX = REPO / "data" / "hna" / "ranking-index.json"
OUT = REPO / "assets" / "co-housing-costs" / "snapshots" / "co_county_indicators_full.csv"


def _load_county_population() -> dict[str, int]:
    """Read latest county population from ranking-index.json (vintage 2024
    Census estimates, kept fresh by the ranking-index workflow). Returns a
    dict keyed by 5-digit FIPS."""
    try:
        j = json.loads(RANKING_INDEX.read_text())
    except Exception as exc:
        print(f"[warn] could not read {RANKING_INDEX}: {exc}")
        return {}
    rows = j.get("rankings") or []
    if isinstance(rows, dict):
        rows = list(rows.values())
    out: dict[str, int] = {}
    for r in rows:
        geoid = r.get("geoid")
        if not geoid or len(str(geoid)) != 5:
            continue
        pop = (r.get("metrics") or {}).get("population")
        if pop is not None:
            out[str(geoid)] = int(pop)
    return out


def num(x):
    if pd.isna(x):
        return None
    return x


def main() -> None:
    acs = pd.read_parquet(CACHE / "acs_county_latest.parquet")
    fhfa = pd.read_parquet(CACHE / "fhfa_hpi_county_raw.parquet")
    qcew = pd.read_parquet(CACHE / "qcew_construction_county.parquet")
    permits = pd.read_parquet(CACHE / "permits_county.parquet")

    # acs_county_latest.parquet ships multiple cohorts (2024, 2014, 2009).
    # Keep only the latest (2024 = 2020–2024 ACS 5-year).
    if "acs_year" in acs.columns:
        acs = acs[acs["acs_year"] == acs["acs_year"].max()].copy()

    # ACS snapshot columns vary by run; pick the canonical four if present
    keep = [c for c in ["county_fips", "county_name", "acs_year",
                        "median_gross_rent", "median_hh_income",
                        "vacancy_rate", "rent_burden_30_plus",
                        "population"] if c in acs.columns]
    base = acs[keep].copy()

    # If ACS parquet doesn't ship population, layer in from ranking-index.json
    if "population" not in base.columns:
        pops = _load_county_population()
        base["population"] = base["county_fips"].map(pops)

    # FHFA 10-year HPI change (stored as decimal multiplier — e.g. 1.06 = +106%)
    fhfa_slim = fhfa[["county_fips", "hpi_change_10y"]].rename(
        columns={"hpi_change_10y": "fhfa_hpi_change_10y"}
    )
    base = base.merge(fhfa_slim, on="county_fips", how="left")

    # QCEW average annual construction wage (NAICS 23, latest year)
    qcew_slim = qcew[["county_fips", "avg_annual_wage", "qcew_year"]].rename(
        columns={"avg_annual_wage": "qcew_avg_annual_wage"}
    )
    base = base.merge(qcew_slim, on="county_fips", how="left")

    # BPS permits per capita — 5-year average / population (per 1,000 people)
    permits_5yr = (
        permits.sort_values("bps_year")
        .groupby("county_fips")["total_units"]
        .apply(lambda s: s.tail(5).mean())
        .reset_index(name="bps_permits_5yr_avg_units")
    )
    base = base.merge(permits_5yr, on="county_fips", how="left")

    # Per-capita permits (units per 1,000 people, 5-yr trailing average).
    if "population" in base.columns and base["population"].notna().any():
        base["bps_permits_per_1k_5yr_avg"] = (
            base["bps_permits_5yr_avg_units"] / base["population"] * 1000
        ).round(3)
    else:
        print("[warn] no population column available; "
              "publishing absolute 5yr permit averages only.")
        base["bps_permits_per_1k_5yr_avg"] = None

    OUT.parent.mkdir(parents=True, exist_ok=True)
    base.to_csv(OUT, index=False)
    print(f"[F214] wrote {OUT}")
    print(f"  · counties: {len(base)}")
    print(f"  · columns:  {list(base.columns)}")


if __name__ == "__main__":
    main()
