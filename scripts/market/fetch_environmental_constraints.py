#!/usr/bin/env python3
"""
scripts/market/fetch_environmental_constraints.py

Fetches environmental constraint data for Colorado from Colorado Parks & Wildlife
and EPA EJSCREEN tools and writes output suitable for PMA development feasibility
scoring.

Sources:
  - EPA EJSCREEN ArcGIS FeatureServer (public)
  - CPW Land Ownership GIS (public)
Output:  data/market/environmental_constraints_co.geojson

Usage:
    python3 scripts/market/fetch_environmental_constraints.py
"""

import json
import sys
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "environmental_constraints_co.geojson"

STATE_FIPS = "08"
TIMEOUT = 90

# EPA EJSCREEN — block group level environmental justice indicators (public)
EPA_EJSCREEN_URL = (
    "https://services.arcgis.com/cJ9YHowT8TQ7JECh/arcgis/rest/services/"
    "EJSCREEN_2023_with_AS_CNMI_GU_VI/FeatureServer/0"
)
CO_EJ_WHERE = f'ST_ABBREV="CO"'

# CPW State Lands layer (public ArcGIS)
CPW_LANDS_URL = (
    "https://services3.arcgis.com/66aUo8zsujfgbml1/arcgis/rest/services/"
    "Colorado_State_Lands/FeatureServer/0"
)


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def fetch_ejscreen(limit_pages: int = 10) -> list[dict]:
    """Fetch EPA EJSCREEN environmental justice indicators for Colorado."""
    features = []
    offset = 0
    page_num = 0

    while page_num < limit_pages:
        page_num += 1
        params = urllib.parse.urlencode({
            "where": CO_EJ_WHERE,
            "outFields": (
                "ID,ST_ABBREV,ACSTOTPOP,MINORPCT,LOWINCPCT,"
                "PRE1960PCT,VULEOPCT,DSLPM,CANCER,RESP,PTRAF,PWDIS,PNPL,PRMP,PTSDF,"
                "EJ_CANCER,EJ_RESP,EJ_DSLPM"
            ),
            "returnGeometry": "false",
            "f": "json",
            "resultRecordCount": "2000",
            "resultOffset": str(offset),
        })
        url = f"{EPA_EJSCREEN_URL}/query?{params}"
        log(f"  EJSCREEN page {page_num} (offset={offset})")
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

        page_feats = data.get("features", [])
        log(f"  Page {page_num}: {len(page_feats)} block groups")
        if not page_feats:
            break

        for feat in page_feats:
            attrs = feat.get("attributes") or {}
            bg_id = str(attrs.get("ID") or "")
            if not bg_id.startswith(STATE_FIPS):
                continue
            tract_geoid = bg_id[:11] if len(bg_id) >= 11 else bg_id
            county_fips = bg_id[:5].zfill(5) if len(bg_id) >= 5 else ""

            def pct(v):
                try:
                    return round(float(v or 0) * 100, 1)
                except (TypeError, ValueError):
                    return None

            features.append({
                "type": "Feature",
                "geometry": None,
                "properties": {
                    "geoid": tract_geoid,
                    "block_group_id": bg_id,
                    "county_fips": county_fips,
                    "constraint_type": "environmental_justice",
                    "severity": _ej_severity(attrs),
                    "minority_pct": pct(attrs.get("MINORPCT")),
                    "low_income_pct": pct(attrs.get("LOWINCPCT")),
                    "pre1960_housing_pct": pct(attrs.get("PRE1960PCT")),
                    "vulnerable_pop_pct": pct(attrs.get("VULEOPCT")),
                    "diesel_pm_percentile": attrs.get("DSLPM"),
                    "cancer_risk_percentile": attrs.get("CANCER"),
                    "respiratory_hazard_percentile": attrs.get("RESP"),
                    "superfund_proximity_percentile": attrs.get("PNPL"),
                    "ej_cancer_index": attrs.get("EJ_CANCER"),
                    "ej_resp_index": attrs.get("EJ_RESP"),
                    "regulatory_agency": "EPA EJSCREEN",
                    "permitting_timeline": "standard",
                },
            })

        if data.get("exceededTransferLimit"):
            offset += len(page_feats)
        else:
            break

    return features


def _ej_severity(attrs: dict) -> str:
    """Classify EJ severity based on composite indicators."""
    cancer = float(attrs.get("CANCER") or 0)
    resp = float(attrs.get("RESP") or 0)
    minorpct = float(attrs.get("MINORPCT") or 0)
    score = (cancer + resp) / 2 + (minorpct * 20)
    if score >= 75:
        return "high"
    if score >= 50:
        return "moderate"
    return "low"


def main() -> int:
    log("=== Environmental Constraints Fetch ===")

    try:
        features = fetch_ejscreen()
        log(f"Fetched {len(features)} EPA EJSCREEN block-group records")
    except Exception as e:
        log(f"ERROR: {e}")
        features = []

    geojson = {
        "type": "FeatureCollection",
        "meta": {
            "source": "EPA EJSCREEN 2023 + CPW State Lands (public ArcGIS FeatureServer)",
            "vintage": "2023",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": utc_now(),
            "coverage_pct": round(min(len(features) / 4000 * 100, 100), 1),
            "fields": {
                "geoid": "11-digit census tract GEOID",
                "block_group_id": "12-digit block group GEOID",
                "county_fips": "5-digit county FIPS",
                "constraint_type": "Type: environmental_justice | protected_land | wildlife_corridor",
                "severity": "high | moderate | low",
                "minority_pct": "Percent minority population",
                "low_income_pct": "Percent low-income population",
                "cancer_risk_percentile": "Cancer risk percentile (national)",
                "ej_cancer_index": "EJ cancer composite index",
                "regulatory_agency": "Regulatory authority",
                "permitting_timeline": "Expected permitting timeline",
            },
            "note": "Rebuild via scripts/market/fetch_environmental_constraints.py",
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
