#!/usr/bin/env python3
"""
scripts/market/fetch_cdphe_county_boundaries.py

Fetch Colorado county boundaries from the CDPHE (Colorado Department of
Public Health and Environment) Open Data Portal.

Why CDPHE in addition to TIGER?
-------------------------------
The repo already has TIGER-derived county boundaries at
``data/co-county-boundaries.json`` and ``data/boundaries/counties_co.geojson``.
CDPHE's version is provided here as a SECOND, INDEPENDENT source for two
purposes:

  1. **Cross-validation** — when a CHAS / ACS / DOLA build produces
     unexpected county aggregates, having two independent boundary files
     lets us bisect: "is the discrepancy in the data, or in the geometry?"
     A CDPHE boundary that disagrees with TIGER is a strong signal that
     a county-level join is mis-keyed.

  2. **Health-region attributes** — CDPHE's feature class carries
     additional attributes (CENT_LAT, CENT_LONG centroid coords; the
     ability to join to CDPHE's Health Statistics Regions) not present
     in TIGER. Useful for healthcare-access proxies in PMA scoring.

Output
------
    data/market/cdphe_county_boundaries_co.geojson  — 64 CO counties

Source
------
CDPHE Open Data Portal — "Colorado County Boundaries" feature class.
Resolved via ArcGIS ItemID 66c2642209684b90af84afcc559a5a02 to the
authoritative MapServer at:

    https://www.cohealthmaps.dphe.state.co.us/arcgis/rest/services/
    OPEN_DATA/cdphe_geographic_analysis_boundaries/MapServer/5

Usage
-----
    python3 scripts/market/fetch_cdphe_county_boundaries.py
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "cdphe_county_boundaries_co.geojson"

# Resolved from ArcGIS Item 66c2642209684b90af84afcc559a5a02
CDPHE_BOUNDARIES_URL = (
    "https://www.cohealthmaps.dphe.state.co.us/arcgis/rest/services/"
    "OPEN_DATA/cdphe_geographic_analysis_boundaries/MapServer/5/query"
    "?where=1=1&outFields=*&f=geojson"
)
TIMEOUT = 60
EXPECTED_COUNT = 64  # All CO counties; deviation = upstream issue

USER_AGENT = "HousingAnalytics/1.0 fetch_cdphe_county_boundaries.py"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def http_get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main() -> int:
    print(f"Fetching CDPHE county boundaries from {CDPHE_BOUNDARIES_URL}...")
    try:
        raw = http_get_json(CDPHE_BOUNDARIES_URL)
    except Exception as err:  # noqa: BLE001
        print(f"✗ Fetch failed: {err}", file=sys.stderr)
        return 1

    features = raw.get("features", [])
    print(f"  Got {len(features)} features")
    if len(features) != EXPECTED_COUNT:
        print(
            f"⚠ Expected {EXPECTED_COUNT} CO counties; got {len(features)}. "
            f"Check upstream for boundary changes.",
            file=sys.stderr,
        )

    # Normalize: ensure each feature carries a 5-digit county FIPS as
    # `properties.county_fips5`. CDPHE ships US_FIPS as 5-digit string,
    # but we set the canonical key explicitly so downstream consumers
    # don't have to know the upstream column naming.
    for f in features:
        props = f.setdefault("properties", {})
        us_fips = str(props.get("US_FIPS", "")).strip().zfill(5)
        props["county_fips5"] = us_fips
        # Stable name fallback chain
        props["county_name"] = (
            props.get("FULL")
            or props.get("LABEL")
            or props.get("COUNTY")
            or ""
        )

    # Sort by FIPS for deterministic output (helps git diff readability)
    features.sort(key=lambda f: f.get("properties", {}).get("county_fips5", ""))

    output = {
        "type": "FeatureCollection",
        "meta": {
            "source": "CDPHE Open Data Portal — Colorado County Boundaries",
            "url": CDPHE_BOUNDARIES_URL,
            "arcgis_item_id": "66c2642209684b90af84afcc559a5a02",
            "owner": "CDPHE_user_community",
            "generated": utc_now(),
            "feature_count": len(features),
            "note": (
                "Independent county boundary source for cross-validation. "
                "Primary boundary file is data/co-county-boundaries.json "
                "(TIGER-derived). Use this file for: (1) cross-checking "
                "county-level join results, (2) accessing CDPHE-specific "
                "attributes (CENT_LAT/LONG centroids, link to Health "
                "Statistics Regions)."
            ),
        },
        "features": features,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False)
    print(f"✓ Wrote {len(features)} county boundaries to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
