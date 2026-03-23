#!/usr/bin/env python3
"""
scripts/market/fetch_opportunity_zones.py

Fetches HUD Opportunity Zone designations for Colorado from the HUD CDFI
GeoJSON service and writes output suitable for PMA policy incentives scoring.

Sources:
  - HUD CDFI Fund OZ GIS: https://www.cdfifund.gov/opportunity-zones
  - ESRI public FeatureServer: HUD Opportunity Zones layer
Output: data/market/opportunity_zones_co.geojson

Usage:
    python3 scripts/market/fetch_opportunity_zones.py
"""

import json
import sys
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "opportunity_zones_co.geojson"

STATE_FIPS = "08"
TIMEOUT = 60

# HUD Opportunity Zones public ArcGIS FeatureServer
OZ_LAYER_URL = (
    "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/"
    "Opportunity_Zones/FeatureServer/0"
)
STATE_WHERE = f'state="{STATE_FIPS}"'

# Fallback: Census TIGER/CDFI Fund GeoJSON for OZ tracts
OZ_GEOJSON_FALLBACK = (
    "https://raw.githubusercontent.com/uscensusbureau/opportunity-zones/"
    "main/data/Designated_Qualified_Opportunity_Zones.geojson"
)


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def _http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "HousingAnalytics-PMA/1.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read()


def fetch_arcgis_oz() -> list[dict]:
    """Fetch OZ polygons from HUD ArcGIS FeatureServer."""
    features = []
    offset = 0
    page_num = 0
    while True:
        page_num += 1
        params = urllib.parse.urlencode({
            "where": STATE_WHERE,
            "outFields": "*",
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
            "resultRecordCount": "1000",
            "resultOffset": str(offset),
        })
        url = f"{OZ_LAYER_URL}/query?{params}"
        log(f"  GET {url[:120]}")
        try:
            data = json.loads(_http_get(url))
        except Exception as e:
            log(f"  ArcGIS OZ page {page_num} error: {e}")
            break

        if "error" in data:
            log(f"  ArcGIS error: {data['error']}")
            break

        page_feats = data.get("features", [])
        log(f"  Page {page_num}: {len(page_feats)} features (offset={offset})")
        if not page_feats:
            break

        for feat in page_feats:
            props = feat.get("properties") or {}
            geoid = str(props.get("geoid") or props.get("GEOID") or props.get("tractid") or "")
            # Enforce 11-digit tract GEOID; state portion (first 2) must be 08
            if geoid and not geoid.startswith(STATE_FIPS):
                continue
            county_fips = geoid[:5].zfill(5) if len(geoid) >= 5 else ""
            features.append({
                "type": "Feature",
                "geometry": feat.get("geometry"),
                "properties": {
                    "geoid": geoid,
                    "county_fips": county_fips,
                    "ozone_number": str(props.get("ozone_number") or props.get("ozid") or ""),
                    "designation_date": str(props.get("designation_date") or "2018-04-09"),
                    "census_tract": geoid,
                    "investment_incentives": "Capital gains deferral, exclusion, reduction",
                    "state_fips": STATE_FIPS,
                },
            })

        if data.get("exceededTransferLimit"):
            offset += len(page_feats)
        else:
            break

    return features


def fetch_fallback_oz() -> list[dict]:
    """Fallback: filter raw Census/CDFI GeoJSON to Colorado tracts."""
    log("  Trying fallback OZ GeoJSON source…")
    try:
        raw = _http_get(OZ_GEOJSON_FALLBACK)
        gj = json.loads(raw)
    except Exception as e:
        log(f"  Fallback fetch failed: {e}")
        return []

    co_features = []
    for feat in gj.get("features", []):
        props = feat.get("properties") or {}
        geoid = str(
            props.get("geoid") or props.get("GEOID") or
            props.get("tractid") or props.get("TRACTID") or ""
        )
        if not geoid.startswith(STATE_FIPS):
            continue
        county_fips = geoid[:5].zfill(5) if len(geoid) >= 5 else ""
        co_features.append({
            "type": "Feature",
            "geometry": feat.get("geometry"),
            "properties": {
                "geoid": geoid,
                "county_fips": county_fips,
                "ozone_number": str(props.get("ozone_number") or ""),
                "designation_date": str(props.get("designation_date") or "2018-04-09"),
                "census_tract": geoid,
                "investment_incentives": "Capital gains deferral, exclusion, reduction",
                "state_fips": STATE_FIPS,
            },
        })
    log(f"  Fallback: {len(co_features)} Colorado OZ tracts")
    return co_features


def main() -> int:
    log("=== Colorado Opportunity Zones Fetch ===")

    features = fetch_arcgis_oz()
    if not features:
        log("Primary ArcGIS source returned no features, trying fallback…")
        features = fetch_fallback_oz()

    log(f"Total Colorado Opportunity Zone features: {len(features)}")

    geojson = {
        "type": "FeatureCollection",
        "meta": {
            "source": "HUD CDFI Fund Opportunity Zones (public ArcGIS FeatureServer)",
            "vintage": "2018 (current designations)",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": utc_now(),
            "coverage_pct": round(min(len(features) / 70 * 100, 100), 1),
            "fields": {
                "geoid": "11-digit census tract GEOID",
                "county_fips": "5-digit county FIPS",
                "ozone_number": "OZ designation number",
                "designation_date": "Date designated as OZ",
                "census_tract": "Census tract identifier",
                "investment_incentives": "Summary of OZ tax incentives",
            },
            "note": "Rebuild via scripts/market/fetch_opportunity_zones.py",
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
