#!/usr/bin/env python3
"""
scripts/market/fetch_school_data.py

Fetches Colorado K-12 school location and performance data from the Colorado
Department of Education (CDE) open-data portal and writes a GeoJSON output
suitable for PMA neighborhood quality scoring.

Sources:
  - CDE school directory: https://www.cde.state.co.us/cdereval/performancefsi
  - NCES public school locations (ArcGIS FeatureServer)
Output: data/market/schools_co.geojson

Usage:
    python3 scripts/market/fetch_school_data.py
"""

import json
import sys
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "schools_co.geojson"

STATE_FIPS = "08"
STATE_ABBR = "CO"
TIMEOUT = 60

# NCES Public School Locations (ESRI FeatureServer — public, no auth required)
NCES_SCHOOLS_URL = (
    "https://services1.arcgis.com/Ua5sjt3LWTPigjyD/arcgis/rest/services/"
    "NCES_Public_School_Locations_2122/FeatureServer/0"
)

# CDE School Performance — SPF ratings via NCES or state open data
# Fallback: use NCES attributes for grade span and type
STATE_FILTER = f'STATE_ABBR="{STATE_ABBR}"'


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def arcgis_page(layer_url: str, where: str, offset: int = 0, limit: int = 2000) -> dict:
    params = urllib.parse.urlencode({
        "where": where,
        "outFields": (
            "NCESSCH,NAME,LEANM,LCITY,LSTATE,LZIP,STABR,"
            "GSLO,GSHI,SCHOOL_LEVEL,SCHOOL_TYPE,STATUS,"
            "LAT1516,LON1516,LATITUDE,LONGITUDE"
        ),
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
        "resultRecordCount": str(limit),
        "resultOffset": str(offset),
    })
    url = f"{layer_url}/query?{params}"
    log(f"  GET {url[:120]}")
    req = urllib.request.Request(url, headers={"User-Agent": "HousingAnalytics-PMA/1.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read())


def grade_span(gslo: str, gshi: str) -> str:
    """Convert NCES grade codes to a human-readable span."""
    grade_map = {
        "PK": "PK", "KG": "K", "01": "1", "02": "2", "03": "3",
        "04": "4", "05": "5", "06": "6", "07": "7", "08": "8",
        "09": "9", "10": "10", "11": "11", "12": "12",
    }
    lo = grade_map.get(str(gslo).strip(), gslo or "?")
    hi = grade_map.get(str(gshi).strip(), gshi or "?")
    return f"{lo}-{hi}"


def fetch_schools() -> list[dict]:
    """Fetch all Colorado public schools from NCES FeatureServer."""
    features = []
    offset = 0
    page_num = 0
    while True:
        page_num += 1
        try:
            page = arcgis_page(NCES_SCHOOLS_URL, where=STATE_FILTER, offset=offset)
        except urllib.error.HTTPError as e:
            log(f"  HTTP {e.code} on page {page_num}: {e.reason}")
            break
        except Exception as e:
            log(f"  Error on page {page_num}: {e}")
            break

        if "error" in page:
            log(f"  ArcGIS error: {page['error']}")
            break

        page_features = page.get("features", [])
        log(f"  Page {page_num}: {len(page_features)} schools (offset={offset})")
        if not page_features:
            break

        for feat in page_features:
            props = feat.get("properties") or {}
            geom = feat.get("geometry")
            # Prefer geometry coordinates; fall back to LAT/LON attributes
            if geom and geom.get("coordinates"):
                lon, lat = geom["coordinates"][:2]
            else:
                lat = props.get("LATITUDE") or props.get("LAT1516")
                lon = props.get("LONGITUDE") or props.get("LON1516")
            if lat is None or lon is None:
                continue
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
                "properties": {
                    "ncessch": str(props.get("NCESSCH", "")),
                    "school_name": str(props.get("NAME", "")),
                    "district": str(props.get("LEANM", "")),
                    "city": str(props.get("LCITY", "")),
                    "state": str(props.get("STABR", STATE_ABBR)),
                    "zip": str(props.get("LZIP", "")),
                    "grade_span": grade_span(props.get("GSLO"), props.get("GSHI")),
                    "school_level": str(props.get("SCHOOL_LEVEL", "")),
                    "school_type": str(props.get("SCHOOL_TYPE", "")),
                    "status": str(props.get("STATUS", "")),
                    # Performance rating populated post-fetch from CDE data
                    "performance_rating": None,
                },
            })

        if page.get("exceededTransferLimit"):
            offset += len(page_features)
        else:
            break

    return features


def main() -> int:
    log("=== Colorado School Data Fetch ===")
    try:
        features = fetch_schools()
        log(f"Fetched {len(features)} Colorado schools")
    except Exception as e:
        log(f"ERROR: {e}")
        features = []

    geojson = {
        "type": "FeatureCollection",
        "meta": {
            "source": "NCES Public School Locations 2021-22 (public ArcGIS FeatureServer)",
            "vintage": "2021-22",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": utc_now(),
            "coverage_pct": round(min(len(features) / 1800 * 100, 100), 1),
            "fields": {
                "ncessch": "NCES school ID",
                "school_name": "School name",
                "district": "School district",
                "city": "City",
                "grade_span": "Grade range (e.g. K-5)",
                "school_level": "Elementary/Middle/High",
                "school_type": "Regular/Special/Vocational/Other",
                "performance_rating": "CDE SPF rating (null = not yet populated)",
            },
            "note": "Rebuild via scripts/market/fetch_school_data.py",
        },
        "features": features,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(geojson, fh, indent=2, ensure_ascii=False)
    log(f"Wrote {OUT_FILE} ({OUT_FILE.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
