#!/usr/bin/env python3
"""
scripts/market/fetch_fema_flood_data.py

Fetches FEMA National Flood Hazard Layer (NFHL) flood zone designations for
Colorado and writes a GeoJSON output suitable for PMA infrastructure risk
scoring.

Source:  FEMA NFHL ArcGIS REST services (public)
         https://msc.fema.gov/arcgis/rest/services/National_Flood_Hazard_Layer_Effective/
Output:  data/market/flood_zones_co.geojson

Usage:
    python3 scripts/market/fetch_fema_flood_data.py
"""

import json
import sys
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "flood_zones_co.geojson"

STATE_FIPS = "08"
STATE_ABBR = "CO"
TIMEOUT = 90

# FEMA National Flood Hazard Layer — Flood Hazard Areas layer
FEMA_NFHL_URL = (
    "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/"
    "MapServer/28"
)

# Filter to Colorado (NFHL uses STATE_NAME or DFIRM_ID prefix)
CO_WHERE = f'STATE_NAME="{STATE_ABBR}" OR DFIRM_ID LIKE "08%"'

# High-risk zone designations (100-year flood plain = AE, A, AO, AH, etc.)
HIGH_RISK_ZONES = {"A", "AE", "AO", "AH", "A99", "AR", "AR/AE", "AR/AO",
                   "AR/AH", "AR/A", "A1-A30", "V", "VE", "V1-V30"}
MODERATE_RISK_ZONES = {"B", "X500", "0.2 PCT ANNUAL CHANCE FLOOD HAZARD"}
LOW_RISK_ZONES = {"C", "X"}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def risk_level(zone: str) -> str:
    z = (zone or "").strip().upper()
    if z in HIGH_RISK_ZONES or z.startswith("A") or z.startswith("V"):
        return "high"
    if z in MODERATE_RISK_ZONES or "0.2" in z:
        return "moderate"
    if z in LOW_RISK_ZONES:
        return "low"
    return "unknown"


def fetch_flood_zones() -> list[dict]:
    """Fetch FEMA flood hazard areas for Colorado."""
    features = []
    offset = 0
    page_num = 0

    while True:
        page_num += 1
        params = urllib.parse.urlencode({
            "where": CO_WHERE,
            "outFields": (
                "FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,V_DATUM,"
                "AR_REVERT,BFE_REVERT,STUDY_TYP,DFIRM_ID"
            ),
            "returnGeometry": "true",
            "outSR": "4326",
            "f": "geojson",
            "resultRecordCount": "1000",
            "resultOffset": str(offset),
        })
        url = f"{FEMA_NFHL_URL}/query?{params}"
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

        page_features = data.get("features", [])
        log(f"  Page {page_num}: {len(page_features)} features")
        if not page_features:
            break

        for feat in page_features:
            props = feat.get("properties") or {}
            zone = str(props.get("FLD_ZONE") or "")
            sfha = str(props.get("SFHA_TF") or "").upper() == "T"
            bfe = props.get("STATIC_BFE")
            features.append({
                "type": "Feature",
                "geometry": feat.get("geometry"),
                "properties": {
                    "zone_designation": zone,
                    "zone_subtype": str(props.get("ZONE_SUBTY") or ""),
                    "special_flood_hazard_area": sfha,
                    "base_flood_elevation": float(bfe) if bfe is not None else None,
                    "vertical_datum": str(props.get("V_DATUM") or "NAVD88"),
                    "study_type": str(props.get("STUDY_TYP") or ""),
                    "dfirm_id": str(props.get("DFIRM_ID") or ""),
                    "risk_level": risk_level(zone),
                    "annual_exceedance_prob": (
                        0.01 if sfha else
                        0.002 if "0.2" in zone else
                        None
                    ),
                },
            })

        if data.get("exceededTransferLimit"):
            offset += len(page_features)
        else:
            break

    return features


def main() -> int:
    log("=== FEMA Flood Zone Data Fetch ===")

    try:
        features = fetch_flood_zones()
        log(f"Fetched {len(features)} flood zone features")
    except Exception as e:
        log(f"ERROR: {e}")
        features = []

    geojson = {
        "type": "FeatureCollection",
        "meta": {
            "source": "FEMA National Flood Hazard Layer (NFHL) — public ArcGIS MapServer",
            "vintage": "Current effective (quarterly updates)",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": utc_now(),
            "coverage_pct": round(min(len(features) / 5000 * 100, 100), 1),
            "fields": {
                "zone_designation": "FEMA flood zone code (AE, X, etc.)",
                "zone_subtype": "Zone sub-classification",
                "special_flood_hazard_area": "True = SFHA (100-year floodplain)",
                "base_flood_elevation": "Base flood elevation in feet (NAVD88)",
                "vertical_datum": "Vertical datum reference",
                "risk_level": "high | moderate | low | unknown",
                "annual_exceedance_prob": "Annual probability of flooding (0.01 = 1%)",
                "dfirm_id": "Digital Flood Insurance Rate Map identifier",
            },
            "note": "Rebuild via scripts/market/fetch_fema_flood_data.py — refresh quarterly",
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
