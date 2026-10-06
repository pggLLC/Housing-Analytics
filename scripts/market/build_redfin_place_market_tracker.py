#!/usr/bin/env python3
"""
Build Colorado place-level Redfin market tracker indicators.

Prefer Redfin's published city median (observed). Where unavailable, allocate
ZIP observations with HUD residential-address ratios and Census 2020 block
housing counts (modeled); never weight housing demand by land area.
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
import unicodedata
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "market" / "redfin_place_market_tracker_co.json"
CROSSWALK_PATH = ROOT / "data" / "market" / "hud_zip_tract_crosswalk_co.json"
PLACE_MEMBERSHIP_PATH = ROOT / "data" / "market" / "census2020-place-tract-housing-co.json"

REDFIN_SOURCE_URL = "https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/zip_code_market_tracker.tsv000.gz"
REDFIN_CITY_URL = "https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/city_market_tracker.tsv000.gz"
REDFIN_DATA_CENTER_URL = "https://www.redfin.com/news/data-center/"
REDFIN_METHODOLOGY_URL = "https://www.redfin.com/news/data-center/methodology/"
REDFIN_TERMS_URL = "https://www.redfin.com/about/terms-of-use"

ROLLING_MONTHLY_DURATION = "90"
MIN_ALLOCATED_HOMES_SOLD = 5.0
CITY_OBSERVATIONS_PATH = ROOT / "data/market/redfin-city-observations-co.json"
KEEP_MONTHS = 24
MIN_PLACES = 100
MIN_MONTHS = 12


def utc_today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def review_by(days: int = 90) -> str:
    return (datetime.now(timezone.utc).date() + timedelta(days=days)).isoformat()


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


def source_stream(city=False):
    override = os.environ.get("REDFIN_CITY_TRACKER_PATH" if city else "REDFIN_MARKET_TRACKER_PATH", "").strip()
    if override:
        path = Path(override)
        if not path.exists():
            raise FileNotFoundError(f"REDFIN_MARKET_TRACKER_PATH does not exist: {path}")
        raw = path.open("rb")
        if path.suffix == ".gz":
            return io.TextIOWrapper(gzip.GzipFile(fileobj=raw), encoding="utf-8", newline="")
        return io.TextIOWrapper(raw, encoding="utf-8", newline="")

    req = urllib.request.Request(
        REDFIN_CITY_URL if city else REDFIN_SOURCE_URL,
        headers={"User-Agent": "Housing-Analytics Redfin derived aggregate builder"},
    )
    resp = urllib.request.urlopen(req, timeout=240)
    return io.TextIOWrapper(gzip.GzipFile(fileobj=resp), encoding="utf-8", newline="")


def build_zip_place_weights(crosswalk: dict, membership: dict) -> dict[str, list[dict]]:
    tract_places: dict[str, list[dict]] = defaultdict(list)
    for place_geoid, place in (membership.get("places") or {}).items():
        for overlap in place.get("tracts", []):
            tract = str(overlap.get("tract_geoid", ""))
            units = clean_number(overlap.get("housing_units"))
            tract_units = clean_number(overlap.get("tract_housing_units"))
            share = units / tract_units if units is not None and tract_units and tract_units > 0 else None
            if not tract or share is None or share <= 0:
                continue
            tract_places[tract].append(
                {
                    "geoid": place_geoid,
                    "name": place.get("name"),
                    "share_of_tract_housing": share,
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
            weight = res_ratio * place["share_of_tract_housing"]
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
    return str(row.get("PERIOD_END", ""))[:7]


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


def normalize_place(name):
    bare = re.sub(r"\s*\((?:city|town|cdp)\)\s*$", "", name or "", flags=re.I).strip().casefold()
    return "".join(c for c in unicodedata.normalize("NFD", bare) if not unicodedata.combining(c))


def city_observations(stream, config):
    names = defaultdict(list)
    for g in config['places'] + config['cdps']:
        names[normalize_place(g['label'])].append(g)
    cities = defaultdict(dict)
    absent = {}
    for row in csv.DictReader(stream, delimiter="\t"):
        if row.get('STATE_CODE') != 'CO' or row.get('REGION_TYPE') != 'place' or row.get('PROPERTY_TYPE') != 'All Residential':
            continue
        matches = names.get(normalize_place(row.get('CITY')), [])
        if len(matches) != 1 or row.get('PERIOD_DURATION') not in ('30', '90'):
            continue
        geo = matches[0]
        month = month_key(row)
        if not month:
            continue
        price = clean_number(row.get('MEDIAN_SALE_PRICE'))
        sales = clean_number(row.get('HOMES_SOLD'))
        if sales is not None and sales < MIN_ALLOCATED_HOMES_SOLD:
            absent[geo['geoid']] = 'redfin_city_sales_below_floor'
            continue
        if price is None or price <= 0 or sales is None:
            # A later missing-price row must not erase an observed thin-sales reason.
            absent.setdefault(geo['geoid'], 'redfin_city_sale_price_unavailable')
            continue
        record = {'period': month, 'period_begin': row['PERIOD_BEGIN'], 'period_end': row['PERIOD_END'],
            'source_period_duration_days': int(row['PERIOD_DURATION']), 'source_level': 'redfin_city_observed',
            'median_sale_price': price, 'homes_sold_allocated': sales,
            'inventory_allocated': clean_number(row.get('INVENTORY')),
            'median_days_on_market': clean_number(row.get('MEDIAN_DOM')),
            'sale_to_list_ratio': clean_number(row.get('AVG_SALE_TO_LIST')),
            'source_zip_count': 0, 'source_zips': [], 'redfin_city_id': row.get('TABLE_ID')}
        old = cities[geo['geoid']].get(month)
        # Prefer a published single-month city observation; otherwise retain its
        # actual 90-day window rather than relabelling it as one month.
        if old is None or record['source_period_duration_days'] < old['source_period_duration_days']:
            cities[geo['geoid']][month] = record
    return cities, absent


def latest_real_car():
    for path in sorted((ROOT / 'data').glob('car-market-report-????-??.json'), reverse=True):
        report = load_json(path)
        if report.get('estimated_scopes', {}).get('counties') is False and report.get('counties'):
            return report
    return None


def review_flag(price, county, report):
    sf = (report or {}).get('counties', {}).get(county, {}).get('single_family', {})
    median, sales = sf.get('median_sale_price'), sf.get('closed_sales')
    if not price or not median or not sales or sales < 20 or price <= median * 1.1:
        return None
    gap = (price / median - 1) * 100
    return {'reason': 'modeled_sale_price_above_recent_sales', 'car_median': median,
        'sales_count': sales, 'month': report['month'], 'county_fips': county, 'percentage_gap': gap,
        'source': 'data/car-market-report-' + report['month'] + '.json',
        'note': f'Modeled from ZIP-level medians; {gap:.1f}% above recent county MLS single-family sales ({sales} sales, {report["month"]}). Treat as an upper estimate.'}


def build_artifact() -> dict:
    crosswalk = load_json(CROSSWALK_PATH)
    membership = load_json(PLACE_MEMBERSHIP_PATH)
    zip_place_weights = build_zip_place_weights(crosswalk, membership)
    config = load_json(ROOT / 'data/hna/geo-config.json')
    geography = {g['geoid']: g for g in config['places'] + config['cdps']}
    with source_stream(city=True) as stream:
        city_months, city_absent = city_observations(stream, config)
    supplements = load_json(CITY_OBSERVATIONS_PATH)
    for geoid, row in supplements['places'].items():
        if city_months.get(geoid):
            continue
        if geoid not in geography or row['homes_sold'] < MIN_ALLOCATED_HOMES_SOLD or not (row['median_sale_price'] > 0):
            raise ValueError('Invalid verified city supplement: ' + geoid)
        city_months[geoid][row['period']] = {
            **{k: row[k] for k in ('period', 'period_begin', 'period_end', 'source_period_duration_days',
                                  'median_sale_price', 'median_days_on_market', 'redfin_city_id', 'source_url', 'checked')},
            'source_level': 'redfin_city_observed', 'homes_sold_allocated': row['homes_sold'],
            'inventory_allocated': None, 'sale_to_list_ratio': None, 'source_zip_count': 0, 'source_zips': [],
            'source_record': str(CITY_OBSERVATIONS_PATH.relative_to(ROOT))}


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
        if geoid not in geography:
            continue
        place_meta = (membership.get("places") or {}).get(geoid, {})
        rows = []
        qualifying = sorted(month for month, rec in months.items()
                            if rec['homes_sold_allocated'] >= MIN_ALLOCATED_HOMES_SOLD)
        retained = kept_months
        if qualifying and not any(month in kept_months for month in qualifying):
            # Preserve the last defensible observation as dated history when
            # no recent ZIP window qualifies; the consumer keeps its stale label.
            retained = {qualifying[-1]}
        for month, rec in sorted(months.items()):
            if month not in retained:
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

    # Direct city observations replace the modeled series, never a weighted
    # mean of ZIP medians labelled as the city's observed median.
    for geoid, months in city_months.items():
        rows = [row for _, row in sorted(months.items())][-KEEP_MONTHS:]
        if not rows:
            continue
        latest = rows[-1]
        places[geoid] = {'geoid': geoid, 'name': geography[geoid]['label'],
            'source_level': 'redfin_city_observed', 'latest_period': latest['period'],
            'latest': {'median_sale_price': latest['median_sale_price'], 'inventory': latest['inventory_allocated'],
                'median_days_on_market': latest['median_days_on_market'], 'sale_to_list_ratio': latest['sale_to_list_ratio'],
                'homes_sold_allocated': latest['homes_sold_allocated'], 'source_zip_count': 0,
                'source_period_duration_days': latest['source_period_duration_days'], 'redfin_city_id': latest['redfin_city_id']},
            'source_url': latest.get('source_url', REDFIN_CITY_URL),
            'source_record': latest.get('source_record'), 'monthly': rows}
        latest_period_end = max(latest_period_end or '', latest['period_end'])
    car = latest_real_car()
    for geoid, place in places.items():
        place['county_fips'] = geography.get(geoid, {}).get('containingCounty')
        place['latest'].setdefault('source_period_duration_days', 90)
        if place['source_level'] == 'redfin_zip_to_place_modeled':
            flag = review_flag(place['latest']['median_sale_price'], place['county_fips'], car)
            if flag:
                place['review_flag'] = flag
    # A known city with unavailable sales must not disappear just because its
    # published listings have no closed-sale observations to allocate.
    for geoid in geography:
        if geoid not in places:
            reason = city_absent.get(geoid) or ('redfin_place_sales_below_floor' if geoid in place_months else 'redfin_zip_sales_unavailable')
            places[geoid] = {'geoid': geoid, 'name': geography[geoid]['label'],
                'county_fips': geography[geoid].get('containingCounty'), 'source_level': 'unavailable',
                'latest_period': None, 'latest': {'median_sale_price': None}, 'monthly': [], 'unavailable_reason': reason}

    if len(all_months) < MIN_MONTHS:
        raise ValueError(f"Redfin source yielded only {len(all_months)} Colorado monthly periods")
    if len(places) < MIN_PLACES:
        raise ValueError(f"Derived only {len(places)} place aggregates")

    as_of = latest_period_end or (f"{all_months[-1]}-01" if all_months else None)
    return {
        "meta": {
            "source": "Redfin Data Center city and ZIP-code Market Tracker",
            "source_url": REDFIN_SOURCE_URL,
            "city_source_url": REDFIN_CITY_URL,
            "city_observations_file": str(CITY_OBSERVATIONS_PATH.relative_to(ROOT)),
            "housing_source_url": membership["meta"]["source_url"],
            "source_page_url": REDFIN_DATA_CENTER_URL,
            "methodology_url": REDFIN_METHODOLOGY_URL,
            "terms_url": REDFIN_TERMS_URL,
            "crosswalk_file": str(CROSSWALK_PATH.relative_to(ROOT)),
            "place_membership_file": str(PLACE_MEMBERSHIP_PATH.relative_to(ROOT)),
            "state": "Colorado",
            "state_fips": "08",
            "as_of": as_of,
            "last_verified": utc_today(),
            "review_by": review_by(),
            "latest_redfin_updated": latest_source_updated,
            "period_duration_days": {"zip_model": 90, "city_observed": "published 30 or 90, recorded on each row"},
            "minimum_homes_sold": MIN_ALLOCATED_HOMES_SOLD,
            "months_retained": KEEP_MONTHS,
            "months_available_in_source": len(all_months),
            "source_zip_month_rows_used": source_zip_months,
            "source_zip_month_rows_skipped_thin": skipped_thin,
            "suppressed_place_months_below_floor": suppressed_place_months,
            "place_count": len(places),
            "attribution": "Derived from Redfin Data Center market tracker data. Redfin is the source; Housing-Analytics selects published city metrics or aggregates ZIP rows to Colorado places and does not redistribute raw Redfin rows.",
            "methodology": (
                "Colorado All Residential ZIP-code rows with 90-day rolling monthly periods are allocated "
                "to places using HUD-USPS ZIP-to-tract residential ratios and Census 2020 block housing-unit shares. "
                "Published city medians take precedence and are observed, without ZIP averaging. "
                "Median sale price, median days on market, and average sale-to-list ratio are weighted by allocated homes sold; "
                "inventory and homes sold are allocated counts."
            ),
            "limitations": [
                "Redfin methodology states smaller geographies, including ZIP codes, use rolling three-month windows for monthly data.",
                "Thin ZIP-month rows and place-month aggregates below the allocated homes-sold floor are suppressed.",
                "Where no recent ZIP window qualifies, retain its latest qualifying historical window with the original date and existing stale disclosure.",
                "City observations and ZIP models require at least five sales. Use the latest qualifying city window without pooling months; its published date and sales count remain visible.",
                "ZIP fallback rows are modeled means of medians, not true place medians; observed rows use Redfin city publications.",
                "2020 housing-unit shares do not infer later annexations or construction. HUD residential-address shares within each tract are assumed to follow those housing units.",
                "Known omissions in the bulk city download may use dated observations verified on the public Redfin city page; their source URL and source-record file travel with the row.",
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
