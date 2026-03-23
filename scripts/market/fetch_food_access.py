#!/usr/bin/env python3
"""
scripts/market/fetch_food_access.py

Fetches USDA Food Access Research Atlas data for Colorado census tracts and
writes output suitable for PMA neighborhood quality scoring.

Source:  USDA Economic Research Service Food Access Research Atlas
         https://www.ers.usda.gov/data-products/food-access-research-atlas/
         ArcGIS FeatureServer (public)
Output:  data/market/food_access_co.json

Usage:
    python3 scripts/market/fetch_food_access.py
"""

import json
import sys
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "food_access_co.json"

STATE_FIPS = "08"
TIMEOUT = 90

# USDA Food Access Research Atlas — ArcGIS FeatureServer (public)
USDA_FOOD_URL = (
    "https://services1.arcgis.com/RLQu0rK7h4kbsBq5/arcgis/rest/services/"
    "Food_Access_Research_Atlas/FeatureServer/0"
)
CO_WHERE = f'State="{STATE_FIPS}"'


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def fetch_food_access_tracts() -> list[dict]:
    """Fetch food access metrics for all Colorado tracts."""
    tracts = []
    offset = 0
    page_num = 0

    while True:
        page_num += 1
        params = urllib.parse.urlencode({
            "where": CO_WHERE,
            "outFields": (
                "CensusTract,State,County,Urban,POP2010,"
                "LILATracts_1And10,LILATracts_halfAnd10,LILATracts_1And20,"
                "LA1and10,LA1and20,LAhalfand10,LALOWI1_10,LALOWI1_20,"
                "lasnaps10,lasnaps20,LAPOP1_10,LAPOP1_20"
            ),
            "returnGeometry": "false",
            "f": "json",
            "resultRecordCount": "2000",
            "resultOffset": str(offset),
        })
        url = f"{USDA_FOOD_URL}/query?{params}"
        log(f"  GET page {page_num} (offset={offset}): {url[:120]}")
        req = urllib.request.Request(url, headers={"User-Agent": "HousingAnalytics-PMA/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                data = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            log(f"  HTTP {e.code}: {e.reason}")
            break
        except Exception as e:
            log(f"  Error: {e}")
            break

        if "error" in data:
            log(f"  ArcGIS error: {data['error']}")
            break

        features = data.get("features", [])
        log(f"  Page {page_num}: {len(features)} tracts")
        if not features:
            break

        for feat in features:
            attrs = feat.get("attributes") or {}
            raw_geoid = str(attrs.get("CensusTract") or "")
            # CensusTract may be stored as numeric (e.g. 8001000100); pad to 11 digits
            geoid = raw_geoid.zfill(11) if raw_geoid.isdigit() else raw_geoid
            if not geoid.startswith(STATE_FIPS):
                continue
            county_fips = geoid[:5].zfill(5)

            def flag(v):
                return bool(int(v or 0))

            tracts.append({
                "geoid": geoid,
                "county_fips": county_fips,
                "urban": flag(attrs.get("Urban")),
                "population": int(attrs.get("POP2010") or 0),
                # Low-income low-access flags
                "low_access_flag_1mi": flag(attrs.get("LILATracts_1And10")),
                "low_access_flag_half_mi": flag(attrs.get("LILATracts_halfAnd10")),
                "low_access_flag_20mi": flag(attrs.get("LILATracts_1And20")),
                # Population beyond threshold distance
                "pop_beyond_1mi": int(attrs.get("LAPOP1_10") or 0),
                "pop_beyond_20mi": int(attrs.get("LAPOP1_20") or 0),
                # SNAP-authorized stores
                "snap_authorized_stores_1mi": int(attrs.get("lasnaps10") or 0),
                "snap_authorized_stores_20mi": int(attrs.get("lasnaps20") or 0),
                # Low-income, low-access combined
                "lila_1mi_10mi": flag(attrs.get("LALOWI1_10")),
                "lila_1mi_20mi": flag(attrs.get("LALOWI1_20")),
            })

        if data.get("exceededTransferLimit"):
            offset += len(features)
        else:
            break

    return tracts


def main() -> int:
    log("=== USDA Food Access Research Atlas Fetch ===")

    try:
        tracts = fetch_food_access_tracts()
        log(f"Fetched {len(tracts)} Colorado tract food access records")
    except Exception as e:
        log(f"ERROR: {e}")
        tracts = []

    output = {
        "meta": {
            "source": "USDA Economic Research Service Food Access Research Atlas (public ArcGIS)",
            "vintage": "2019",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": utc_now(),
            "coverage_pct": round(min(len(tracts) / 1300 * 100, 100), 1),
            "fields": {
                "geoid": "11-digit census tract GEOID",
                "county_fips": "5-digit county FIPS",
                "urban": "True = urban tract",
                "low_access_flag_1mi": "Low-income & low-access to store within 1 mile",
                "low_access_flag_half_mi": "Low-income & low-access within 1/2 mile",
                "pop_beyond_1mi": "Population beyond 1 mile from nearest supermarket",
                "snap_authorized_stores_1mi": "SNAP-authorized stores within 1 mile",
                "lila_1mi_10mi": "LILA tract (1mi/10mi thresholds)",
            },
            "note": "Rebuild via scripts/market/fetch_food_access.py",
        },
        "tracts": tracts,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(output, fh, indent=2, ensure_ascii=False)
    log(f"Wrote {OUT_FILE} ({OUT_FILE.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
