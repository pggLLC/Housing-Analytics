#!/usr/bin/env python3
"""
aggregate-bridge-co.py

Reads Bridge API output files from data/market/bridge/ and aggregates
property assessment and transaction records by Colorado region, computing
summary statistics (median, mean, min, max) for assessed values, land values,
improvement values, and recent sale prices.

Outputs: data/market/bridge_co_market_summary.json
"""

import json
import os
import sys
import statistics
from datetime import date, datetime, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Region definitions
# ---------------------------------------------------------------------------

REGIONS = {
    "front_range_north": {
        "name": "Northern Front Range",
        "counties": ["Larimer", "Weld", "Morgan"],
        "centroid": [40.58, -105.08],
    },
    "denver_metro": {
        "name": "Denver Metro",
        "counties": ["Denver", "Jefferson", "Adams", "Arapahoe", "Douglas", "Broomfield"],
        "centroid": [39.74, -104.99],
    },
    "front_range_south": {
        "name": "Colorado Springs Area",
        "counties": ["El Paso", "Teller", "Fremont"],
        "centroid": [38.83, -104.82],
    },
    "pueblo_south_central": {
        "name": "Pueblo & South Central",
        "counties": ["Pueblo", "Huerfano", "Las Animas", "Otero"],
        "centroid": [38.26, -104.61],
    },
    "western_slope": {
        "name": "Western Slope",
        "counties": ["Mesa", "Delta", "Montrose", "Gunnison", "Ouray"],
        "centroid": [39.06, -108.55],
    },
    "southwest": {
        "name": "Southwest Colorado",
        "counties": ["La Plata", "Montezuma", "Dolores", "San Juan", "Archuleta"],
        "centroid": [37.27, -107.88],
    },
    "northwest": {
        "name": "Northwest Colorado",
        "counties": ["Moffat", "Routt", "Rio Blanco", "Garfield", "Eagle", "Pitkin"],
        "centroid": [40.52, -107.55],
    },
    "san_luis_valley": {
        "name": "San Luis Valley",
        "counties": ["Alamosa", "Conejos", "Costilla", "Saguache", "Rio Grande", "Mineral"],
        "centroid": [37.47, -105.87],
    },
    "eastern_plains_north": {
        "name": "Eastern Plains North",
        "counties": ["Logan", "Sedgwick", "Phillips", "Yuma", "Washington"],
        "centroid": [40.62, -103.21],
    },
    "eastern_plains_central": {
        "name": "Eastern Plains Central",
        "counties": ["Lincoln", "Kit Carson", "Cheyenne", "Elbert"],
        "centroid": [39.26, -103.69],
    },
    "eastern_plains_south": {
        "name": "Eastern Plains South",
        "counties": ["Prowers", "Bent", "Baca", "Kiowa", "Crowley"],
        "centroid": [38.09, -102.62],
    },
    "mountain": {
        "name": "Mountain & Resort",
        "counties": ["Summit", "Eagle", "Pitkin", "Park", "Lake", "Chaffee", "Clear Creek"],
        "centroid": [39.61, -106.09],
    },
    "boulder": {
        "name": "Boulder Area",
        "counties": ["Boulder"],
        "centroid": [40.01, -105.27],
    },
}

RURAL_REGIONS = {
    "san_luis_valley",
    "eastern_plains_north",
    "eastern_plains_central",
    "eastern_plains_south",
    "northwest",
    "southwest",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
BRIDGE_DIR = REPO_ROOT / "data" / "market" / "bridge"
OUTPUT_FILE = REPO_ROOT / "data" / "market" / "bridge_co_market_summary.json"


def _safe_float(val):
    """Convert a value to float, returning None on failure."""
    if val is None:
        return None
    try:
        f = float(val)
        return f if f == f else None  # reject NaN
    except (TypeError, ValueError):
        return None


def _extract_field(record, *keys):
    """
    Search for a field in a Bridge API record.

    Bridge records may store fields at the root level, under a 'fields' dict,
    or inside a 'bundle' list of dicts. Try all three locations.
    """
    # Root level
    for key in keys:
        if key in record:
            return record[key]

    # Under 'fields'
    fields = record.get("fields") or {}
    for key in keys:
        if key in fields:
            return fields[key]

    # Inside 'bundle' list
    bundle = record.get("bundle")
    if isinstance(bundle, list):
        for item in bundle:
            if isinstance(item, dict):
                for key in keys:
                    if key in item:
                        return item[key]

    return None


def _parse_date(val):
    """Parse a date string (YYYY-MM-DD or ISO 8601) returning a date object or None."""
    if not val:
        return None
    if isinstance(val, date):
        return val
    s = str(val).strip()
    # Try ISO date prefix first (handles both "YYYY-MM-DD" and "YYYY-MM-DDTHH:MM:SS...")
    try:
        return datetime.fromisoformat(s[:10]).date()
    except (ValueError, AttributeError):
        pass
    # Try US-style date
    try:
        return datetime.strptime(s[:10], "%m/%d/%Y").date()
    except (ValueError, TypeError):
        pass
    return None


def _median(values):
    clean = [v for v in values if v is not None]
    if not clean:
        return None
    return statistics.median(clean)


def _mean(values):
    clean = [v for v in values if v is not None]
    if not clean:
        return None
    return statistics.mean(clean)


def _stats_block(values):
    clean = [v for v in values if v is not None]
    if not clean:
        return {"count": 0, "median": None, "mean": None, "min": None, "max": None}
    return {
        "count": len(clean),
        "median": statistics.median(clean),
        "mean": round(statistics.mean(clean), 2),
        "min": min(clean),
        "max": max(clean),
    }


def _land_cost_tier(median_land):
    if median_land is None:
        return "unknown"
    if median_land < 50_000:
        return "low"
    if median_land < 150_000:
        return "moderate"
    return "high"


def _price_trend(transactions):
    """
    Compare mean sale price of records from the last 6 months vs 6-12 months ago.
    Returns a percentage change (float) or None if insufficient data.
    """
    today = date.today()
    cutoff_recent = today - timedelta(days=182)
    cutoff_older = today - timedelta(days=365)

    recent_prices = []
    older_prices = []

    for rec in transactions:
        price = _safe_float(_extract_field(rec, "SalePrice", "ClosePrice"))
        rec_date = _parse_date(_extract_field(rec, "RecordingDate", "CloseDate", "SaleDate"))
        if price is None or rec_date is None:
            continue
        if rec_date >= cutoff_recent:
            recent_prices.append(price)
        elif rec_date >= cutoff_older:
            older_prices.append(price)

    if not recent_prices or not older_prices:
        return None

    avg_recent = statistics.mean(recent_prices)
    avg_older = statistics.mean(older_prices)

    if avg_older == 0:
        return None

    pct_change = round((avg_recent - avg_older) / avg_older * 100, 2)
    return pct_change


# ---------------------------------------------------------------------------
# Loading Bridge files
# ---------------------------------------------------------------------------

def load_json_file(path):
    """Load a JSON file, returning a list of records regardless of top-level shape."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        print(f"  [WARN] Could not read {path}: {exc}", file=sys.stderr)
        return []

    # Unwrap common Bridge API response envelopes
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("bundle", "value", "records", "data", "results"):
            if isinstance(data.get(key), list):
                return data[key]
        # Single record dict
        return [data]
    return []


def load_region_files(bridge_dir, region_key):
    """
    Find and load all assessment and transaction JSON files for a region.

    A file is associated with a region if its filename contains the region key.
    Returns (assessments, transactions) as lists of raw records.
    """
    assessments = []
    transactions = []

    bridge_path = Path(bridge_dir)
    if not bridge_path.is_dir():
        return assessments, transactions

    for filepath in sorted(bridge_path.glob("*.json")):
        stem = filepath.stem.lower()
        if region_key not in stem:
            continue
        records = load_json_file(filepath)
        if "assessments_" in stem:
            assessments.extend(records)
        elif "transactions_" in stem:
            transactions.extend(records)
        else:
            # Unknown file type – try to classify by field presence
            for rec in records:
                has_assessed = _extract_field(rec, "AssessedValue") is not None
                has_sale = (
                    _extract_field(rec, "SalePrice") is not None
                    or _extract_field(rec, "ClosePrice") is not None
                )
                if has_assessed:
                    assessments.append(rec)
                elif has_sale:
                    transactions.append(rec)
                else:
                    assessments.append(rec)  # default bucket

    return assessments, transactions


# ---------------------------------------------------------------------------
# Per-region aggregation
# ---------------------------------------------------------------------------

def aggregate_region(region_key, region_meta, bridge_dir):
    assessments, transactions = load_region_files(bridge_dir, region_key)

    total_records = len(assessments) + len(transactions)
    data_available = total_records > 0

    # --- Assessment metrics ---
    assessed_values = []
    land_values = []
    improvement_values = []
    property_types = []

    for rec in assessments:
        av = _safe_float(_extract_field(rec, "AssessedValue", "AssessedTotalValue"))
        lv = _safe_float(_extract_field(rec, "LandValue", "AssessedLandValue"))
        iv = _safe_float(_extract_field(rec, "ImprovementValue", "AssessedImprovementValue"))
        pt = _extract_field(rec, "PropertyType", "PropertyUseType", "LandUse")

        if av is not None:
            assessed_values.append(av)
        if lv is not None:
            land_values.append(lv)
        if iv is not None:
            improvement_values.append(iv)
        if pt is not None:
            property_types.append(str(pt))

    # Also pull property type from transactions
    for rec in transactions:
        pt = _extract_field(rec, "PropertyType", "PropertyUseType", "LandUse")
        if pt is not None:
            property_types.append(str(pt))

    pct_residential = None
    if property_types:
        res_count = sum(1 for pt in property_types if "residential" in pt.lower())
        pct_residential = round(res_count / len(property_types) * 100, 2)

    # --- Transaction metrics ---
    sale_prices = []
    txn_12mo = 0
    cutoff_12mo = date.today() - timedelta(days=365)

    for rec in transactions:
        price = _safe_float(_extract_field(rec, "SalePrice", "ClosePrice"))
        rec_date = _parse_date(_extract_field(rec, "RecordingDate", "CloseDate", "SaleDate"))

        if price is not None:
            sale_prices.append(price)
        if rec_date is not None and rec_date >= cutoff_12mo:
            txn_12mo += 1

    price_trend = _price_trend(transactions)

    # --- Derived ---
    median_land = _median(land_values)
    tier = _land_cost_tier(median_land)

    result = {
        "name": region_meta["name"],
        "counties": region_meta["counties"],
        "is_rural": region_key in RURAL_REGIONS,
        "record_count": total_records,
        "assessment_count": len(assessments),
        "transaction_count": len(transactions),
        "median_assessed_value": _median(assessed_values),
        "median_land_value": median_land,
        "median_improvement_value": _median(improvement_values),
        "median_sale_price": _median(sale_prices),
        "transaction_count_12mo": txn_12mo,
        "price_trend_pct": price_trend,
        "pct_residential": pct_residential,
        "land_cost_tier": tier,
        "data_available": data_available,
    }

    return result, assessments, transactions


# ---------------------------------------------------------------------------
# Statewide rollup
# ---------------------------------------------------------------------------

def compute_statewide(region_results, all_assessments, all_transactions):
    total_records = sum(r["record_count"] for r in region_results.values())
    txn_12mo = sum(r["transaction_count_12mo"] for r in region_results.values())

    all_assessed = []
    all_land = []
    all_improvement = []
    all_sale = []
    cutoff_12mo = date.today() - timedelta(days=365)

    for rec in all_assessments:
        av = _safe_float(_extract_field(rec, "AssessedValue", "AssessedTotalValue"))
        lv = _safe_float(_extract_field(rec, "LandValue", "AssessedLandValue"))
        iv = _safe_float(_extract_field(rec, "ImprovementValue", "AssessedImprovementValue"))
        if av is not None:
            all_assessed.append(av)
        if lv is not None:
            all_land.append(lv)
        if iv is not None:
            all_improvement.append(iv)

    for rec in all_transactions:
        price = _safe_float(_extract_field(rec, "SalePrice", "ClosePrice"))
        if price is not None:
            all_sale.append(price)

    median_land = _median(all_land)

    return {
        "record_count": total_records,
        "median_assessed_value": _median(all_assessed),
        "median_land_value": median_land,
        "median_improvement_value": _median(all_improvement),
        "median_sale_price": _median(all_sale),
        "transaction_count_12mo": txn_12mo,
        "land_cost_tier": _land_cost_tier(median_land),
    }


# ---------------------------------------------------------------------------
# Empty summary builder (used when bridge dir is absent)
# ---------------------------------------------------------------------------

def build_empty_summary():
    today_str = str(date.today())
    regions_out = {}
    for region_key, meta in REGIONS.items():
        regions_out[region_key] = {
            "name": meta["name"],
            "counties": meta["counties"],
            "is_rural": region_key in RURAL_REGIONS,
            "record_count": 0,
            "assessment_count": 0,
            "transaction_count": 0,
            "median_assessed_value": None,
            "median_land_value": None,
            "median_improvement_value": None,
            "median_sale_price": None,
            "transaction_count_12mo": 0,
            "price_trend_pct": None,
            "pct_residential": None,
            "land_cost_tier": "unknown",
            "data_available": False,
        }

    return {
        "generated": today_str,
        "source": "Bridge Data Output Public API",
        "statewide": {
            "record_count": 0,
            "median_assessed_value": None,
            "median_land_value": None,
            "median_improvement_value": None,
            "median_sale_price": None,
            "transaction_count_12mo": 0,
            "land_cost_tier": "unknown",
        },
        "regions": regions_out,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    bridge_dir = BRIDGE_DIR

    if not bridge_dir.is_dir():
        print(
            f"[INFO] Bridge data directory not found: {bridge_dir}\n"
            "       Writing empty summary with data_available=false for all regions.",
            file=sys.stderr,
        )
        summary = build_empty_summary()
        OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(OUTPUT_FILE, "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2)
        print(f"Written: {OUTPUT_FILE}")
        return

    print(f"Reading Bridge data from: {bridge_dir}")

    region_results = {}
    all_assessments_global = []
    all_transactions_global = []

    for region_key, meta in REGIONS.items():
        result, assessments, transactions = aggregate_region(region_key, meta, bridge_dir)
        region_results[region_key] = result
        all_assessments_global.extend(assessments)
        all_transactions_global.extend(transactions)

    # Print per-region summary
    print("\n--- Records per region ---")
    for region_key, result in region_results.items():
        status = "OK" if result["data_available"] else "no data"
        print(
            f"  {region_key:<28}  assessments={result['assessment_count']:>5}  "
            f"transactions={result['transaction_count']:>5}  [{status}]"
        )

    statewide = compute_statewide(region_results, all_assessments_global, all_transactions_global)

    summary = {
        "generated": str(date.today()),
        "source": "Bridge Data Output Public API",
        "statewide": statewide,
        "regions": region_results,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, indent=2)

    print(f"\nTotal records processed: {statewide['record_count']}")
    print(f"Written: {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
