#!/usr/bin/env python3
"""
scripts/build_realtor_inventory_co.py
=====================================
Colorado for-sale listing metrics from Realtor.com's monthly research files.

Realtor.com publishes these files free. Its only condition is credit to
Realtor.com. There is no listing feed, and its terms forbid scraping, so
these monthly summaries are the only Realtor.com data the site uses.

Sources (no auth):
  https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_County.csv
  https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/RDC_Inventory_Core_Metrics_Zip.csv

Each file carries one month. Year-over-year changes come from Realtor.com's
own *_yy columns, published as fractions and written here as percents.
A blank cell stays null; it is never written as zero. quality_flag = 1 is
Realtor.com's mark for figures "outside of their typical range" that it says
"should be reviewed before reporting". It is kept with the row so the page
can say so.

Output: data/market/realtor_inventory_co.json
  {
    "meta": { source, credit, county_url, zip_url, month, ... },
    "counties": { "08015": { name, active_listings, ..., quality_flag } },
    "zips":     { "80012": { name, active_listings, ..., quality_flag } }
  }

A month that lacks any of the 64 counties, carries far fewer ZIPs than
usual, does not give one and the same month in both files, or is older than
the committed month is treated as a bad file: the script keeps the committed file and exits 1, so the monthly
job fails and opens its issue. Readers still show "No reading" for a county
the file lacks, in case one ever reaches the page.

Usage:
  python3 scripts/build_realtor_inventory_co.py
  python3 scripts/build_realtor_inventory_co.py --county County.csv --zip Zip.csv   # local copies
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT = REPO_ROOT / "data" / "market" / "realtor_inventory_co.json"

BASE = "https://econdata.s3-us-west-2.amazonaws.com/Reports/Core/"
COUNTY_URL = BASE + "RDC_Inventory_Core_Metrics_County.csv"
ZIP_URL = BASE + "RDC_Inventory_Core_Metrics_Zip.csv"
RESEARCH_PAGE = "https://www.realtor.com/research/data/"

# A statewide file carries all 64 Colorado counties (AGENTS.md hard
# constraint 2), so the county file must hold exactly the counties in the
# committed boundary file, by FIPS and name; Realtor.com carried all 64 in
# September 2026. Its ZIP file carried 473 Colorado ZIPs; far fewer means a
# bad extract.
COUNTY_REGISTRY = Path(__file__).resolve().parent.parent / "data" / "co-county-boundaries.json"
CO_COUNTIES = 64
MIN_ZIPS = 400


def canonical_counties() -> dict:
    features = json.loads(COUNTY_REGISTRY.read_text())["features"]
    return {f["properties"]["GEOID"]: f["properties"]["NAMELSAD"] for f in features}

# (output key, csv column, kind). "pct" columns are fractions in the file.
FIELDS = [
    ("active_listings", "active_listing_count", "int"),
    ("active_listings_yy_pct", "active_listing_count_yy", "pct"),
    ("new_listings", "new_listing_count", "int"),
    ("pending_listings", "pending_listing_count", "int"),
    ("median_list_price", "median_listing_price", "int"),
    ("median_list_price_yy_pct", "median_listing_price_yy", "pct"),
    ("median_list_price_per_sqft", "median_listing_price_per_square_foot", "int"),
    ("median_days_on_market", "median_days_on_market", "int"),
    ("median_days_on_market_yy_pct", "median_days_on_market_yy", "pct"),
    ("price_reduced_share_pct", "price_reduced_share", "pct"),
    ("price_reduced_share_yy_pts", "price_reduced_share_yy", "pct"),
]


REQUIRED_COLUMNS = {
    geo: ["month_date_yyyymm", *keys, "quality_flag", *(col for _, col, _ in FIELDS)]
    for geo, keys in (("county", ("county_fips", "county_name")), ("zip", ("postal_code", "zip_name")))
}
# The columns the page shows. Most counties must have each, or the extract is broken.
SHOWN = ("active_listings", "median_days_on_market", "price_reduced_share_pct")


def _fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "COHO-Analytics/1.0 (+market data)"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode("utf-8-sig")


def _num(raw: str | None, kind: str):
    if raw is None or raw.strip() == "":
        return None
    try:
        v = float(raw)
    except ValueError:
        return None
    if math.isnan(v):
        return None
    if kind == "pct":
        return round(v * 100, 1)
    return int(round(v))


def _title(name: str) -> str:
    # "san juan, co" -> "San Juan"
    place = name.rsplit(",", 1)[0].strip()
    return " ".join(w[:1].upper() + w[1:] for w in place.split())


def _row(rec: dict) -> dict:
    out = {key: _num(rec.get(col), kind) for key, col, kind in FIELDS}
    out["quality_flag"] = 1 if (rec.get("quality_flag") or "").strip() == "1" else 0
    return out


def parse(text: str, geo: str) -> tuple[dict, set]:
    rows, months = {}, set()
    reader = csv.DictReader(io.StringIO(text))
    # A renamed or dropped metric column would otherwise read as null in every
    # row and pass the count and month checks.
    missing = [c for c in REQUIRED_COLUMNS[geo] if c not in (reader.fieldnames or [])]
    if missing:
        raise ValueError(f"the {geo} file lacks columns {missing}")
    for rec in reader:
        name = (rec.get("county_name") if geo == "county" else rec.get("zip_name")) or ""
        if not name.strip().lower().endswith(", co"):
            continue
        if geo == "county":
            key = (rec.get("county_fips") or "").zfill(5)
            if not key.startswith("08"):
                continue
            label = _title(name) + " County"
        else:
            key = (rec.get("postal_code") or "").zfill(5)
            label = _title(name)
        month = (rec.get("month_date_yyyymm") or "").strip()
        if not (len(month) == 6 and month.isdigit() and 1 <= int(month[4:]) <= 12):
            raise ValueError(f"the {geo} file gives {month!r} as a month, not YYYYMM")
        months.add(month[:4] + "-" + month[4:])
        rows[key] = {"name": label, **_row(rec)}
    return dict(sorted(rows.items())), months


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--county", help="read the county CSV from this path instead of downloading")
    ap.add_argument("--zip", help="read the ZIP CSV from this path instead of downloading")
    args = ap.parse_args()

    try:
        county_text = Path(args.county).read_text(encoding="utf-8-sig") if args.county else _fetch(COUNTY_URL)
        zip_text = Path(args.zip).read_text(encoding="utf-8-sig") if args.zip else _fetch(ZIP_URL)
    except Exception as exc:  # network or file error: keep the committed file
        print(f"ERROR: could not read the Realtor.com files: {exc}", file=sys.stderr)
        return 1

    try:
        counties, county_months = parse(county_text, "county")
        zips, zip_months = parse(zip_text, "zip")
    except ValueError as exc:
        print(f"ERROR: {exc}; keeping the committed file.", file=sys.stderr)
        return 1

    canon = canonical_counties()
    missing = sorted(set(canon) - set(counties))
    extra = sorted(set(counties) - set(canon))
    renamed = sorted(k for k in set(canon) & set(counties) if counties[k]["name"] != canon[k])
    if missing or extra or renamed:
        print(f"ERROR: the county file does not match Colorado's {len(canon)} counties "
              f"(missing {missing}, unknown {extra}, misnamed {renamed}); keeping the committed file.", file=sys.stderr)
        return 1
    if len(zips) < MIN_ZIPS:
        print(f"ERROR: only {len(zips)} Colorado ZIPs in the file; keeping the committed file.", file=sys.stderr)
        return 1
    if len(county_months) != 1 or zip_months != county_months:
        print(f"ERROR: expected one month in both files, found county {sorted(county_months)}, "
              f"ZIP {sorted(zip_months)}; keeping the committed file.", file=sys.stderr)
        return 1
    empty = [k for k in SHOWN if sum(r[k] is not None for r in counties.values()) < len(counties) / 2]
    if empty:
        print(f"ERROR: most counties have no {', '.join(empty)}; keeping the committed file.", file=sys.stderr)
        return 1
    months = set(county_months)
    try:
        stored = json.loads(OUT.read_text())["meta"]["month"]
    except (OSError, ValueError, KeyError, TypeError):
        stored = None
    if stored and next(iter(months)) < stored:
        print(f"ERROR: the files give {next(iter(months))}, older than the committed {stored}; "
              "keeping the committed file.", file=sys.stderr)
        return 1

    output = {
        "meta": {
            "source": "Realtor.com Residential Data, monthly inventory core metrics",
            "credit": "Realtor.com",
            "url": RESEARCH_PAGE,
            "county_url": COUNTY_URL,
            "zip_url": ZIP_URL,
            "month": months.pop(),
            "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "scope": "Colorado counties and ZIP codes in Realtor.com's files",
            "notes": (
                "Listings of existing and new homes for sale on Realtor.com. Year-over-year changes are "
                "Realtor.com's own (_yy_pct, percent). price_reduced_share_yy_pts is the change in the "
                "share of listings with a price cut, in percentage points. A blank value in the source "
                "is null. quality_flag 1 is Realtor.com's mark for figures outside their typical range, "
                "which it says should be reviewed before reporting."
            ),
            "county_count": len(counties),
            "zip_count": len(zips),
        },
        "counties": counties,
        "zips": zips,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(output, indent=1) + "\n")
    print(f"OK  wrote {OUT.relative_to(REPO_ROOT)}: {output['meta']['month']}, "
          f"{len(counties)} counties, {len(zips)} ZIPs")
    return 0


if __name__ == "__main__":
    sys.exit(main())
