#!/usr/bin/env python3
"""
scripts/market/fetch_qct_dda_designations.py

Fetches HUD Qualified Census Tract (QCT) and Difficult Development Area (DDA)
designations for Colorado and writes output suitable for PMA development
incentives scoring.

Source:  HUD LIHTC QCT/DDA API + HUD GIS FeatureServer (public)
         https://www.huduser.gov/portal/datasets/qct.html
Output:  data/market/qct_dda_designations_co.json

Usage:
    python3 scripts/market/fetch_qct_dda_designations.py
"""

import json
import sys
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "qct_dda_designations_co.json"

STATE_FIPS = "08"
TIMEOUT = 60

# HUD GIS QCT layer — public ArcGIS FeatureServer
HUD_QCT_URL = (
    "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/"
    "Qualified_Census_Tracts_2025/FeatureServer/0"
)

# HUD GIS DDA layer — public ArcGIS FeatureServer
HUD_DDA_URL = (
    "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/"
    "Difficult_Development_Areas_2025/FeatureServer/0"
)

CO_WHERE = f'STATEFP="{STATE_FIPS}" OR geoid LIKE "{STATE_FIPS}%"'
YEAR = 2025


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def fetch_arcgis_layer(layer_url: str, where: str, label: str) -> list[dict]:
    """Generic paginated ArcGIS layer fetch."""
    results = []
    offset = 0
    page_num = 0

    while True:
        page_num += 1
        params = urllib.parse.urlencode({
            "where": where,
            "outFields": "*",
            "returnGeometry": "false",
            "f": "json",
            "resultRecordCount": "2000",
            "resultOffset": str(offset),
        })
        url = f"{layer_url}/query?{params}"
        log(f"  {label} page {page_num} (offset={offset})")
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
        log(f"  {label}: {len(features)} records")
        if not features:
            break

        results.extend(f.get("attributes") or {} for f in features)

        if data.get("exceededTransferLimit"):
            offset += len(features)
        else:
            break

    return results


def normalize_qct(raw: dict) -> dict:
    geoid = str(raw.get("geoid") or raw.get("GEOID") or raw.get("TRACT") or "")
    if not geoid.startswith(STATE_FIPS) and len(geoid) >= 11:
        return {}
    county_fips = geoid[:5].zfill(5) if len(geoid) >= 5 else ""
    return {
        "tract_geoid": geoid,
        "county_fips": county_fips,
        "qct_status": True,
        "designation_year": YEAR,
        "expiration_date": f"{YEAR}-12-31",
        "eligible_basis_multiplier": 1.30,  # 130% eligible basis for QCTs
        "qct_type": str(raw.get("TYPE") or raw.get("qct_type") or "income"),
    }


def normalize_dda(raw: dict) -> dict:
    geoid = str(raw.get("geoid") or raw.get("GEOID") or raw.get("dda_code") or "")
    county_fips = geoid[:5].zfill(5) if len(geoid) >= 5 else ""
    area_name = str(raw.get("area_name") or raw.get("NAME") or raw.get("AREANAME") or "")
    return {
        "tract_geoid": geoid,
        "county_fips": county_fips,
        "dda_status": True,
        "dda_area_name": area_name,
        "designation_year": YEAR,
        "expiration_date": f"{YEAR}-12-31",
        "eligible_basis_multiplier": 1.30,
    }


def merge_qct_dda(qct_list: list[dict], dda_list: list[dict]) -> list[dict]:
    """Merge QCT and DDA records by tract GEOID."""
    merged: dict[str, dict] = {}

    for qct in qct_list:
        if not qct:
            continue
        geoid = qct["tract_geoid"]
        if not geoid.startswith(STATE_FIPS):
            continue
        merged[geoid] = {
            "tract_geoid": geoid,
            "county_fips": qct["county_fips"],
            "qct_status": True,
            "dda_status": False,
            "dda_area_name": None,
            "designation_year": YEAR,
            "expiration_date": qct["expiration_date"],
            "eligible_basis_multiplier": qct["eligible_basis_multiplier"],
            "qct_type": qct.get("qct_type"),
        }

    for dda in dda_list:
        if not dda:
            continue
        geoid = dda["tract_geoid"]
        if geoid in merged:
            merged[geoid]["dda_status"] = True
            merged[geoid]["dda_area_name"] = dda["dda_area_name"]
        else:
            merged[geoid] = {
                "tract_geoid": geoid,
                "county_fips": dda["county_fips"],
                "qct_status": False,
                "dda_status": True,
                "dda_area_name": dda["dda_area_name"],
                "designation_year": YEAR,
                "expiration_date": dda["expiration_date"],
                "eligible_basis_multiplier": dda["eligible_basis_multiplier"],
                "qct_type": None,
            }

    return sorted(merged.values(), key=lambda r: r["tract_geoid"])


def main() -> int:
    log("=== HUD QCT/DDA Designations Fetch ===")

    log("Fetching QCT designations…")
    raw_qct = fetch_arcgis_layer(HUD_QCT_URL, CO_WHERE, "QCT")
    qct_records = [normalize_qct(r) for r in raw_qct]

    log("Fetching DDA designations…")
    raw_dda = fetch_arcgis_layer(HUD_DDA_URL, CO_WHERE, "DDA")
    dda_records = [normalize_dda(r) for r in raw_dda]

    log(f"QCT raw: {len(raw_qct)}, DDA raw: {len(raw_dda)}")
    tracts = merge_qct_dda(qct_records, dda_records)
    log(f"Merged: {len(tracts)} distinct tracts with QCT/DDA designations")

    output = {
        "meta": {
            "source": "HUD QCT/DDA Designations (public ArcGIS FeatureServer)",
            "vintage": str(YEAR),
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": utc_now(),
            "coverage_pct": round(min(len(tracts) / 200 * 100, 100), 1),
            "fields": {
                "tract_geoid": "11-digit census tract GEOID",
                "county_fips": "5-digit county FIPS",
                "qct_status": "True = Qualified Census Tract",
                "dda_status": "True = Difficult Development Area",
                "dda_area_name": "DDA area name (null if not DDA)",
                "designation_year": "HUD designation year",
                "expiration_date": "Designation expiration date",
                "eligible_basis_multiplier": "LIHTC eligible basis multiplier (1.30 = 130%)",
                "qct_type": "QCT type: income or high_poverty",
            },
            "note": "Rebuild annually via scripts/market/fetch_qct_dda_designations.py",
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
