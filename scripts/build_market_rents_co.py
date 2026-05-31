#!/usr/bin/env python3
"""
scripts/build_market_rents_co.py
=================================
Build Colorado market-rent snapshot from Zillow Observed Rent Index (ZORI).

ZORI is Zillow's smoothed, seasonally-adjusted index of asking rents from
their listing platform. It tracks the typical rent for a 35th–65th percentile
property — a closer proxy to "median market rent" than HUD FMR (which is a
40th-percentile floor) or the LIHTC §42 ceiling.

For the Opportunity Finder and Deal Calculator, ZORI fills the gap that
the audit's MARKET-RENT-AND-KALSHI.md flagged: HUD FMR is a 2-3-year-lagged
40th-percentile floor; ZORI is monthly and tracks closer to the median.
Negative OF "Capture" using FMR doesn't necessarily mean the deal is dead
— if ZORI for that jurisdiction shows market rent ABOVE the LIHTC ceiling,
the deal still pencils.

Sources (all free, no auth):
  • City-level ZORI: https://files.zillowstatic.com/research/public_csvs/zori/City_zori_uc_sfrcondomfr_sm_sa_month.csv
  • County ZORI:     https://files.zillowstatic.com/research/public_csvs/zori/County_zori_uc_sfrcondomfr_sm_sa_month.csv

Output: data/market/zori_rents_co.json with:
  {
    "meta": { source, vintage_month, generated_at, ... },
    "cities":   { "place_lookup_key": { name, rent, yoy_change_pct } },
    "counties": { "08001": { name, rent, yoy_change_pct } },
    "statewide_median": <number>
  }
"""

from __future__ import annotations

import csv
import io
import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT = REPO_ROOT / "data" / "market" / "zori_rents_co.json"

ZORI_CITY_URL = "https://files.zillowstatic.com/research/public_csvs/zori/City_zori_uc_sfrcondomfr_sm_sa_month.csv"
ZORI_COUNTY_URL = "https://files.zillowstatic.com/research/public_csvs/zori/County_zori_uc_sfrcondomfr_sm_sa_month.csv"

CO_STATE = "CO"


def _fetch(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "COHO-Analytics/1.0 (+market rent integration)"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def _parse_zori(text: str) -> tuple[list[str], list[dict]]:
    rdr = csv.reader(io.StringIO(text))
    rows = list(rdr)
    if not rows:
        return [], []
    header = rows[0]
    out = []
    for r in rows[1:]:
        if len(r) < len(header):
            continue
        rec = dict(zip(header, r))
        out.append(rec)
    return header, out


def _latest_value(rec: dict, month_cols: list[str]) -> tuple[float | None, str | None]:
    """Return the most recent non-empty rent + the month it represents."""
    for col in reversed(month_cols):
        v = rec.get(col)
        try:
            if v not in (None, "", "NA"):
                fv = float(v)
                if fv > 0:
                    return fv, col
        except (TypeError, ValueError):
            continue
    return None, None


def _yoy_change(rec: dict, month_cols: list[str]) -> float | None:
    """Latest vs 12 months prior."""
    latest, col = _latest_value(rec, month_cols)
    if not latest or not col:
        return None
    # Walk back 12 months
    idx = month_cols.index(col)
    if idx < 12:
        return None
    prior = rec.get(month_cols[idx - 12])
    try:
        prior_v = float(prior)
        if prior_v > 0:
            return round(((latest - prior_v) / prior_v) * 100, 1)
    except (TypeError, ValueError):
        return None
    return None


def _normalize_place_key(name: str) -> str:
    """Apartment List / ZORI city names → match COHO's place lookup."""
    return (
        (name or "")
        .strip()
        .lower()
        .replace(", co", "")
        .replace(",co", "")
        .strip()
    )


def main() -> int:
    print("Fetching ZORI city-level…")
    try:
        city_text = _fetch(ZORI_CITY_URL)
    except urllib.error.URLError as e:
        print(f"ERROR: city fetch failed: {e}", file=sys.stderr)
        return 1
    city_hdr, city_rows = _parse_zori(city_text)

    print("Fetching ZORI county-level…")
    try:
        county_text = _fetch(ZORI_COUNTY_URL)
    except urllib.error.URLError as e:
        print(f"ERROR: county fetch failed: {e}", file=sys.stderr)
        return 1
    county_hdr, county_rows = _parse_zori(county_text)

    # Month columns are at the end (YYYY-MM-DD)
    city_months = [c for c in city_hdr if c[:2].isdigit() or c[:4].isdigit()]
    city_months.sort()
    county_months = [c for c in county_hdr if c[:2].isdigit() or c[:4].isdigit()]
    county_months.sort()

    # Cities: filter to CO
    co_cities = {}
    for rec in city_rows:
        if rec.get("State") != CO_STATE:
            continue
        rent, month = _latest_value(rec, city_months)
        if rent is None:
            continue
        yoy = _yoy_change(rec, city_months)
        name = rec.get("RegionName", "")
        if not name:
            continue
        key = _normalize_place_key(name)
        co_cities[key] = {
            "name": name,
            "metro": rec.get("Metro", ""),
            "rent": round(rent),
            "yoy_change_pct": yoy,
            "vintage_month": month,
            "rank": int(rec.get("SizeRank", 0) or 0),
        }

    # Counties: filter to CO (StateName column may also be "Colorado")
    co_counties = {}
    for rec in county_rows:
        if rec.get("State") != CO_STATE and rec.get("StateName") != "Colorado":
            continue
        rent, month = _latest_value(rec, county_months)
        if rent is None:
            continue
        yoy = _yoy_change(rec, county_months)
        # County code: SizeRank doesn't give FIPS. RegionName looks like "Adams County".
        # Try multiple ID columns: StateCodeFIPS + MunicipalCodeFIPS, or RegionID.
        fips5 = None
        state_fips = (rec.get("StateCodeFIPS") or "").zfill(2)
        muni_fips = (rec.get("MunicipalCodeFIPS") or "").zfill(3)
        if state_fips == "08" and len(muni_fips) == 3:
            fips5 = state_fips + muni_fips
        if not fips5:
            continue
        co_counties[fips5] = {
            "name": rec.get("RegionName", ""),
            "metro": rec.get("Metro", ""),
            "rent": round(rent),
            "yoy_change_pct": yoy,
            "vintage_month": month,
        }

    # Statewide statistic: simple median across CO cities
    if co_cities:
        sorted_rents = sorted(rec["rent"] for rec in co_cities.values())
        mid = len(sorted_rents) // 2
        statewide_median = (
            sorted_rents[mid] if len(sorted_rents) % 2 == 1
            else round((sorted_rents[mid - 1] + sorted_rents[mid]) / 2)
        )
    else:
        statewide_median = None

    latest_city_month = max((c["vintage_month"] for c in co_cities.values()), default=None)
    latest_county_month = max((c["vintage_month"] for c in co_counties.values()), default=None)
    vintage = latest_city_month or latest_county_month or "unknown"

    output = {
        "meta": {
            "source": "Zillow Observed Rent Index (ZORI) — smoothed, seasonally adjusted",
            "city_url": ZORI_CITY_URL,
            "county_url": ZORI_COUNTY_URL,
            "vintage_month": vintage,
            "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "scope": "Colorado: cities + counties from ZORI public data",
            "notes": (
                "ZORI tracks 35-65th percentile rents from Zillow's listing platform. "
                "Closer to median market rent than HUD FMR (40th-pctile floor) and "
                "more current (monthly vs FMR annual + 2-3yr ACS lag). Useful for "
                "validating OF 'Capture' column results, especially in rural / "
                "off-metro markets where HUD FMR understates actual rents."
            ),
        },
        "statewide_median": statewide_median,
        "cities": co_cities,
        "counties": co_counties,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(output, indent=2) + "\n")
    print(f"OK  wrote {OUT.relative_to(REPO_ROOT)}")
    print(f"    cities:   {len(co_cities)} CO cities tracked, vintage {vintage}")
    print(f"    counties: {len(co_counties)} CO counties tracked")
    print(f"    statewide median: ${statewide_median}/mo" if statewide_median else "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
