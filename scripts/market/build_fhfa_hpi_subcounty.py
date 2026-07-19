#!/usr/bin/env python3
"""
Build Colorado sub-county FHFA HPI indicators from FHFA tract HPI.

The FHFA annual Census-tract file is the source for tract-level home-price
movement. TIGER place→tract membership aggregates those tract indicators to
places. County rows remain direct anchors from the existing FHFA county parquet.
"""

from __future__ import annotations

import json
import math
import os
import sys
import tempfile
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

import pandas as pd


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "market" / "fhfa_hpi_subcounty_co.json"
COUNTY_HPI_PATH = ROOT / "data" / "co-housing-costs" / "fhfa_hpi_county_raw.parquet"
PLACE_MEMBERSHIP_PATH = ROOT / "data" / "hna" / "place-tract-membership.json"

FHFA_HPI_PAGE = "https://www.fhfa.gov/house-price-index"
FHFA_TRACT_URL = "https://www.fhfa.gov/hpi/download/annual/hpi_at_tract.csv"
FHFA_COUNTY_URL = "https://www.fhfa.gov/hpi/download/annual/hpi_at_county.xlsx"

METRIC_KEYS = [
    "hpi_2000_base_latest",
    "annual_change_latest",
    "change_5y",
    "change_10y",
]

MIN_TRACTS = 900
MIN_PLACES = 300


def utc_today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def review_by(days: int = 90) -> str:
    return (datetime.now(timezone.utc).date() + timedelta(days=days)).isoformat()


def clean_number(value):
    if value is None:
        return None
    if isinstance(value, str) and value.strip() in {"", "."}:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(out):
        return None
    return out


def round_value(value, places=6):
    if value is None:
        return None
    return round(float(value), places)


def weighted_average(rows: Iterable[dict], weight_key: str, metric_key: str):
    num = 0.0
    den = 0.0
    for row in rows:
        value = clean_number(row.get(metric_key))
        weight = clean_number(row.get(weight_key))
        if value is None or weight is None or weight <= 0:
            continue
        num += value * weight
        den += weight
    if den <= 0:
        return None, 0.0
    return num / den, den


def source_tract_csv() -> Path:
    override = os.environ.get("FHFA_TRACT_HPI_PATH", "").strip()
    if override:
        path = Path(override)
        if not path.exists():
            raise FileNotFoundError(f"FHFA_TRACT_HPI_PATH does not exist: {path}")
        return path

    target = Path(tempfile.gettempdir()) / "fhfa_hpi_at_tract.csv"
    req = urllib.request.Request(
        FHFA_TRACT_URL,
        headers={"User-Agent": "Housing-Analytics FHFA HPI subcounty builder"},
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        body = resp.read()
    if len(body) < 10_000_000:
        raise RuntimeError(f"FHFA tract CSV download was unexpectedly small ({len(body)} bytes)")
    target.write_bytes(body)
    return target


def load_tract_metrics(path: Path) -> tuple[dict[str, dict], int]:
    df = pd.read_csv(
        path,
        dtype={"tract": str, "state_abbr": str},
        usecols=["tract", "state_abbr", "year", "annual_change", "hpi", "hpi2000"],
    )
    df["tract"] = df["tract"].astype(str).str.extract(r"(\d{11})", expand=False)
    df["year"] = pd.to_numeric(df["year"], errors="coerce")
    for col in ["annual_change", "hpi", "hpi2000"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["tract", "year"])
    df = df[(df["state_abbr"] == "CO") & (df["tract"].str.startswith("08"))]
    df["year"] = df["year"].astype(int)
    latest_year = int(df["year"].max())
    by_tract_year = {
        (row.tract, int(row.year)): row
        for row in df.itertuples(index=False)
    }

    tracts: dict[str, dict] = {}
    for tract, group in df.groupby("tract"):
        latest = by_tract_year.get((tract, latest_year))
        if latest is None or pd.isna(latest.hpi):
            continue
        hpi_latest = clean_number(latest.hpi)
        hpi_2000_base_latest = clean_number(latest.hpi2000)
        annual_change_latest = clean_number(latest.annual_change)
        annual_change_latest = annual_change_latest / 100 if annual_change_latest is not None else None

        def change_since(years: int):
            base = by_tract_year.get((tract, latest_year - years))
            if base is None:
                return None
            base_hpi = clean_number(base.hpi)
            if hpi_latest is None or base_hpi is None or base_hpi <= 0:
                return None
            return (hpi_latest / base_hpi) - 1

        tracts[tract] = {
            "tract": tract,
            "county_fips": tract[:5],
            "source_level": "fhfa_tract_direct",
            "latest_year": latest_year,
            "year_count": int(group["year"].nunique()),
            "hpi_2000_base_latest": round_value(hpi_2000_base_latest, 4),
            "annual_change_latest": round_value(annual_change_latest),
            "change_5y": round_value(change_since(5)),
            "change_10y": round_value(change_since(10)),
        }
    return dict(sorted(tracts.items())), latest_year


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_counties() -> dict[str, dict]:
    df = pd.read_parquet(COUNTY_HPI_PATH)
    counties = {}
    for row in df.itertuples(index=False):
        fips = str(row.county_fips).zfill(5)
        counties[fips] = {
            "county_fips": fips,
            "source_level": "fhfa_county_direct",
            "hpi_latest": round_value(clean_number(row.hpi_latest), 4),
            "hpi_10y_base": round_value(clean_number(row.hpi_10y_base), 4),
            "hpi_15y_base": round_value(clean_number(row.hpi_15y_base), 4),
            "change_10y": round_value(clean_number(row.hpi_change_10y)),
            "change_15y": round_value(clean_number(row.hpi_change_15y)),
        }
    return dict(sorted(counties.items()))


def build_places(tracts: dict[str, dict], membership: dict) -> dict[str, dict]:
    places = {}
    for place_geoid, place in (membership.get("places") or {}).items():
        rows = []
        total_share = 0.0
        for overlap in place.get("tracts", []):
            share = clean_number(overlap.get("share_of_place_area")) or 0
            total_share += share
            tract = tracts.get(str(overlap.get("tract_geoid", "")))
            if not tract:
                continue
            rows.append({**tract, "place_area_weight": share})
        if not rows:
            continue
        coverage = sum(clean_number(row.get("place_area_weight")) or 0 for row in rows)
        out = {
            "geoid": place_geoid,
            "name": place.get("name"),
            "source_level": "modeled_fhfa_tract_to_place",
            "tract_count": len({row["tract"] for row in rows}),
            "membership_tract_count": len(place.get("tracts", [])),
            "coverage_share_of_place_area": round_value(coverage),
            "membership_share_of_place_area": round_value(total_share),
        }
        metric_weight = {}
        for metric in METRIC_KEYS:
            avg, den = weighted_average(rows, "place_area_weight", metric)
            out[metric] = round_value(avg, 6 if metric != "hpi_2000_base_latest" else 4)
            metric_weight[metric] = round_value(den)
        out["metric_weight_sum"] = metric_weight
        places[place_geoid] = out
    return dict(sorted(places.items()))


def build_artifact():
    tract_path = source_tract_csv()
    tracts, latest_year = load_tract_metrics(tract_path)
    membership = load_json(PLACE_MEMBERSHIP_PATH)
    counties = load_counties()
    places = build_places(tracts, membership)
    if len(tracts) < MIN_TRACTS:
        raise ValueError(f"Derived only {len(tracts)} tract HPI records")
    if len(places) < MIN_PLACES:
        raise ValueError(f"Derived only {len(places)} place HPI records")

    return {
        "meta": {
            "source": "FHFA annual Census-tract House Price Index",
            "source_url": FHFA_TRACT_URL,
            "source_page_url": FHFA_HPI_PAGE,
            "county_source_url": FHFA_COUNTY_URL,
            "place_membership_file": str(PLACE_MEMBERSHIP_PATH.relative_to(ROOT)),
            "county_parquet_file": str(COUNTY_HPI_PATH.relative_to(ROOT)),
            "state": "Colorado",
            "state_fips": "08",
            "as_of": f"{latest_year}-12-31",
            "last_verified": utc_today(),
            "review_by": review_by(),
            "latest_year": latest_year,
            "county_count": len(counties),
            "tract_count": len(tracts),
            "place_count": len(places),
            "methodology": (
                "FHFA annual tract HPI rows are filtered to Colorado Census tracts. "
                "Place indicators are area-weighted from direct FHFA tract indicators using TIGER 2024 "
                "place-to-tract membership. County rows are direct existing FHFA county HPI anchors."
            ),
            "limitations": [
                "Tract rows are direct FHFA tract HPI observations; place rows are modeled area-weighted aggregations from those tracts.",
                "FHFA suppresses tract-year values where its publication criteria are not met; suppressed tracts remain absent from the place average for that metric.",
                "HPI levels use the FHFA 2000-base tract series where available; change metrics use each tract's native annual index ratios.",
            ],
        },
        "counties": counties,
        "tracts": tracts,
        "places": places,
    }


def main() -> int:
    artifact = build_artifact()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {OUT.relative_to(ROOT)}: "
        f"{artifact['meta']['county_count']} counties, "
        f"{artifact['meta']['tract_count']} tracts, "
        f"{artifact['meta']['place_count']} places"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
