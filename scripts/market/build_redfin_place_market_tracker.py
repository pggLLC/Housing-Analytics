#!/usr/bin/env python3
"""
Build Colorado place-level Redfin market tracker indicators.

The Redfin source is a public ZIP-code market tracker download. To avoid raw
row redistribution, this script commits only derived place-month aggregates:
ZIP rows are filtered to Colorado All Residential monthly records, allocated
through the HUD-USPS ZIP-to-tract crosswalk and TIGER place/tract overlaps, and
thin samples are suppressed.
"""

from __future__ import annotations

import csv
import gzip
import io
import json
import math
import os
import re
import sys
import tempfile
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "market" / "redfin_place_market_tracker_co.json"
CROSSWALK_PATH = ROOT / "data" / "market" / "hud_zip_tract_crosswalk_co.json"
PLACE_MEMBERSHIP_PATH = ROOT / "data" / "hna" / "place-tract-membership.json"

REDFIN_SOURCE_URL = "https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz"
REDFIN_DATA_CENTER_URL = "https://www.redfin.com/news/data-center/"
REDFIN_METHODOLOGY_URL = "https://www.redfin.com/news/data-center/methodology/"
REDFIN_TERMS_URL = "https://www.redfin.com/about/terms-of-use"

ROLLING_MONTHLY_DURATION = "90"
MIN_ALLOCATED_HOMES_SOLD = 5.0
KEEP_MONTHS = 24
MIN_PLACES = 100
MIN_MONTHS = 12


def utc_today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def clean_number(raw):
    if raw is None:
        return None
    text = str(raw).strip().strip('"')
    if text == "" or text.upper() == "NA":
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    if not math.isfinite(value):
        return None
    return value


def round_value(value, places=6):
    if value is None:
        return None
    return round(float(value), places)


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def source_stream():
    override = os.environ.get("REDFIN_MARKET_TRACKER_PATH", "").strip()
    if override:
        path = Path(override)
        if not path.exists():
            raise FileNotFoundError(f"REDFIN_MARKET_TRACKER_PATH does not exist: {path}")
        raw = path.open("rb")
        if path.suffix == ".gz":
            return io.TextIOWrapper(gzip.GzipFile(fileobj=raw), encoding="utf-8", newline="")
        return io.TextIOWrapper(raw, encoding="utf-8", newline="")

    req = urllib.request.Request(
        REDFIN_SOURCE_URL,
        headers={"User-Agent": "Housing-Analytics Redfin derived aggregate builder"},
    )
    resp = urllib.request.urlopen(req, timeout=240)
    return io.TextIOWrapper(gzip.GzipFile(fileobj=resp), encoding="utf-8", newline="")


def build_zip_place_weights(crosswalk: dict, membership: dict) -> dict[str, list[dict]]:
    tract_places: dict[str, list[dict]] = defaultdict(list)
    for place_geoid, place in (membership.get("places") or {}).items():
        for overlap in place.get("tracts", []):
            tract = str(overlap.get("tract_geoid", ""))
            share = clean_number(overlap.get("share_of_tract_area"))
            if not tract or share is None or share <= 0:
                continue
            tract_places[tract].append(
                {
                    "geoid": place_geoid,
                    "name": place.get("name"),
                    "share_of_tract_area": share,
                }
            )

    grouped: dict[str, dict[str, dict]] = defaultdict(dict)
    for row in crosswalk.get("rows", []):
        zip_code = str(row.get("zip", "")).zfill(5)
        tract = str(row.get("tract", ""))
        res_ratio = clean_number(row.get("res_ratio"))
        if not zip_code or not tract.startswith("08") or res_ratio is None or res_ratio <= 0:
            continue
        for place in tract_places.get(tract, []):
            weight = res_ratio * place["share_of_tract_area"]
            if weight <= 0:
                continue
            current = grouped[zip_code].setdefault(
                place["geoid"],
                {"geoid": place["geoid"], "name": place["name"], "weight": 0.0},
            )
            current["weight"] += weight

    out = {}
    for zip_code, places in grouped.items():
        rows = [
            {"geoid": rec["geoid"], "name": rec["name"], "weight": round_value(rec["weight"])}
            for rec in places.values()
            if rec["weight"] > 0
        ]
        if rows:
            out[zip_code] = sorted(rows, key=lambda rec: rec["geoid"])
    return dict(sorted(out.items()))


def extract_zip(region):
    match = re.search(r"(\d{5})", region or "")
    return match.group(1) if match else None


def month_key(row: dict) -> str:
    return str(row.get("PERIOD_BEGIN", ""))[:7]


def add_weighted(stats: dict, key: str, value, weight: float):
    number = clean_number(value)
    if number is None or weight <= 0:
        return
    bucket = stats.setdefault(f"_{key}", {"num": 0.0, "den": 0.0})
    bucket["num"] += number * weight
    bucket["den"] += weight


def finalize_metric(stats: dict, key: str, places=6):
    bucket = stats.pop(f"_{key}", None)
    if not bucket or bucket["den"] <= 0:
        stats[key] = None
        return
    stats[key] = round_value(bucket["num"] / bucket["den"], places)


def build_artifact() -> dict:
    crosswalk = load_json(CROSSWALK_PATH)
    membership = load_json(PLACE_MEMBERSHIP_PATH)
    zip_place_weights = build_zip_place_weights(crosswalk, membership)

    place_months: dict[str, dict[str, dict]] = defaultdict(dict)
    source_zip_months = 0
    skipped_thin = 0
    latest_source_updated = None
    latest_period_end = None
    months_seen = set()

    with source_stream() as stream:
        reader = csv.DictReader(stream, delimiter="\t")
        for row in reader:
            if row.get("REGION_TYPE") != "zip code":
                continue
            if row.get("STATE_CODE") != "CO":
                continue
            if row.get("PROPERTY_TYPE") != "All Residential":
                continue
            if str(row.get("PERIOD_DURATION")) != ROLLING_MONTHLY_DURATION:
                continue

            zip_code = extract_zip(row.get("REGION"))
            if not zip_code or zip_code not in zip_place_weights:
                continue

            homes_sold = clean_number(row.get("HOMES_SOLD"))
            if homes_sold is None or homes_sold < MIN_ALLOCATED_HOMES_SOLD:
                skipped_thin += 1
                continue

            month = month_key(row)
            if not month:
                continue
            months_seen.add(month)
            source_zip_months += 1
            latest_source_updated = max(latest_source_updated or "", row.get("LAST_UPDATED") or "")
            latest_period_end = max(latest_period_end or "", row.get("PERIOD_END") or "")

            inventory = clean_number(row.get("INVENTORY"))
            median_sale_price = clean_number(row.get("MEDIAN_SALE_PRICE"))
            median_dom = clean_number(row.get("MEDIAN_DOM"))
            sale_to_list = clean_number(row.get("AVG_SALE_TO_LIST"))

            for place in zip_place_weights[zip_code]:
                allocation = clean_number(place["weight"]) or 0
                if allocation <= 0:
                    continue
                allocated_sales = homes_sold * allocation
                rec = place_months[place["geoid"]].setdefault(
                    month,
                    {
                        "period": month,
                        "period_begin": row.get("PERIOD_BEGIN"),
                        "period_end": row.get("PERIOD_END"),
                        "source_period_duration_days": 90,
                        "homes_sold_allocated": 0.0,
                        "inventory_allocated": 0.0,
                        "source_zip_count": 0,
                        "source_zips": set(),
                    },
                )
                rec["source_zips"].add(zip_code)
                rec["source_zip_count"] = len(rec["source_zips"])
                rec["homes_sold_allocated"] += allocated_sales
                if inventory is not None:
                    rec["inventory_allocated"] += inventory * allocation
                add_weighted(rec, "median_sale_price", median_sale_price, allocated_sales)
                add_weighted(rec, "median_days_on_market", median_dom, allocated_sales)
                add_weighted(rec, "sale_to_list_ratio", sale_to_list, allocated_sales)

    all_months = sorted(months_seen)
    kept_months = set(all_months[-KEEP_MONTHS:])
    places = {}
    suppressed_place_months = 0
    for geoid, months in place_months.items():
        place_meta = (membership.get("places") or {}).get(geoid, {})
        rows = []
        for month, rec in sorted(months.items()):
            if month not in kept_months:
                continue
            sales = rec["homes_sold_allocated"]
            if sales < MIN_ALLOCATED_HOMES_SOLD:
                suppressed_place_months += 1
                continue
            finalize_metric(rec, "median_sale_price", 0)
            finalize_metric(rec, "median_days_on_market", 1)
            finalize_metric(rec, "sale_to_list_ratio", 6)
            rec["homes_sold_allocated"] = round_value(sales, 1)
            rec["inventory_allocated"] = round_value(rec["inventory_allocated"], 1)
            rec["source_zips"] = sorted(rec["source_zips"])
            rows.append(rec)
        if rows:
            latest = rows[-1]
            places[geoid] = {
                "geoid": geoid,
                "name": place_meta.get("name") or rows[-1].get("name"),
                "source_level": "redfin_zip_to_place_modeled",
                "latest_period": latest["period"],
                "latest": {
                    "median_sale_price": latest["median_sale_price"],
                    "inventory": latest["inventory_allocated"],
                    "median_days_on_market": latest["median_days_on_market"],
                    "sale_to_list_ratio": latest["sale_to_list_ratio"],
                    "homes_sold_allocated": latest["homes_sold_allocated"],
                    "source_zip_count": latest["source_zip_count"],
                },
                "monthly": rows,
            }

    if len(all_months) < MIN_MONTHS:
        raise ValueError(f"Redfin source yielded only {len(all_months)} Colorado monthly periods")
    if len(places) < MIN_PLACES:
        raise ValueError(f"Derived only {len(places)} place aggregates")

    as_of = latest_period_end or (f"{all_months[-1]}-01" if all_months else None)
    return {
        "meta": {
            "source": "Redfin Data Center ZIP-code Market Tracker",
            "source_url": REDFIN_SOURCE_URL,
            "source_page_url": REDFIN_DATA_CENTER_URL,
            "methodology_url": REDFIN_METHODOLOGY_URL,
            "terms_url": REDFIN_TERMS_URL,
            "crosswalk_file": str(CROSSWALK_PATH.relative_to(ROOT)),
            "place_membership_file": str(PLACE_MEMBERSHIP_PATH.relative_to(ROOT)),
            "state": "Colorado",
            "state_fips": "08",
            "as_of": as_of,
            "last_verified": utc_today(),
            "review_by": "2026-10-18",
            "latest_redfin_updated": latest_source_updated,
            "period_duration_days": 90,
            "months_retained": KEEP_MONTHS,
            "months_available_in_source": len(all_months),
            "source_zip_month_rows_used": source_zip_months,
            "source_zip_month_rows_skipped_thin": skipped_thin,
            "suppressed_place_months_below_floor": suppressed_place_months,
            "place_count": len(places),
            "attribution": "Derived from Redfin Data Center market tracker data. Redfin is the source; Housing-Analytics aggregates ZIP rows to Colorado places and does not redistribute raw Redfin rows.",
            "methodology": (
                "Colorado All Residential ZIP-code rows with 90-day rolling monthly periods are allocated "
                "to places using HUD-USPS ZIP-to-tract residential ratios and TIGER 2024 tract/place overlaps. "
                "Median sale price, median days on market, and average sale-to-list ratio are weighted by allocated homes sold; "
                "inventory and homes sold are allocated counts."
            ),
            "limitations": [
                "Redfin methodology states smaller geographies, including ZIP codes, use rolling three-month windows for monthly data.",
                "Thin ZIP-month rows and place-month aggregates below the allocated homes-sold floor are suppressed.",
                "Place rows are modeled aggregates from ZIP-level Redfin data, not direct Redfin place publications.",
                "Raw Redfin ZIP rows are not committed or redistributed.",
            ],
        },
        "places": dict(sorted(places.items())),
    }


def main() -> int:
    artifact = build_artifact()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {OUT.relative_to(ROOT)}: "
        f"{artifact['meta']['place_count']} places, "
        f"{artifact['meta']['months_retained']} retained months"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
