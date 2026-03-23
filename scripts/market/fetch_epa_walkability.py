#!/usr/bin/env python3
"""
scripts/market/fetch_epa_walkability.py

Fetches EPA National Walkability Index scores for Colorado census tracts and
writes output suitable for PMA accessibility dimension scoring.

Source:  EPA Smart Location Database (SLD) — public ArcGIS FeatureServer
         https://www.epa.gov/smartgrowth/smart-location-mapping
Output:  data/market/walkability_scores_co.json

Usage:
    python3 scripts/market/fetch_epa_walkability.py
"""

import json
import sys
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "walkability_scores_co.json"

STATE_FIPS = "08"
TIMEOUT = 90

# EPA Smart Location Database v3 — ArcGIS FeatureServer (public)
EPA_SLD_URL = (
    "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/"
    "EPA_SmartLocationDatabase_V3_basemap/FeatureServer/0"
)

# Filter to Colorado
CO_WHERE = f'STATEFP="{STATE_FIPS}"'


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def arcgis_page(url: str, where: str, offset: int, limit: int = 2000) -> dict:
    params = urllib.parse.urlencode({
        "where": where,
        "outFields": (
            "GEOID10,GEOID20,STATEFP,COUNTYFP,TRACTCE,"
            "NatWalkInd,D3b,D4a,D4c,D2a_JPHH,D2b_E5MIX,D3a,D2A_Ranked,D4A_Ranked"
        ),
        "returnGeometry": "false",
        "outSR": "4326",
        "f": "json",
        "resultRecordCount": str(limit),
        "resultOffset": str(offset),
    })
    query_url = f"{url}/query?{params}"
    log(f"  GET offset={offset}: {query_url[:120]}")
    req = urllib.request.Request(query_url, headers={"User-Agent": "HousingAnalytics-PMA/1.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read())


def fetch_walkability_scores() -> list[dict]:
    """Fetch all Colorado SLD records (block-group level, roll up to tract)."""
    records = []
    offset = 0
    page_num = 0

    while True:
        page_num += 1
        try:
            page = arcgis_page(EPA_SLD_URL, CO_WHERE, offset)
        except urllib.error.HTTPError as e:
            log(f"  HTTP {e.code} on page {page_num}: {e.reason}")
            break
        except Exception as e:
            log(f"  Error on page {page_num}: {e}")
            break

        if "error" in page:
            log(f"  ArcGIS error: {page['error']}")
            break

        features = page.get("features", [])
        log(f"  Page {page_num}: {len(features)} records (offset={offset})")
        if not features:
            break

        for feat in features:
            attrs = feat.get("attributes") or {}
            geoid = str(attrs.get("GEOID20") or attrs.get("GEOID10") or "")
            if not geoid.startswith(STATE_FIPS):
                continue
            # Tract GEOID is first 11 digits of 12-digit block-group GEOID
            tract_geoid = geoid[:11] if len(geoid) >= 11 else geoid
            county_fips = tract_geoid[:5].zfill(5) if len(tract_geoid) >= 5 else ""
            records.append({
                "geoid": tract_geoid,
                "block_group_geoid": geoid,
                "county_fips": county_fips,
                "walk_score": attrs.get("NatWalkInd"),        # National walkability index (1-20)
                "transit_proximity": attrs.get("D4a"),         # Transit trips within 1/4 mile
                "bike_network_density": attrs.get("D3b"),      # Street intersection density
                "job_proximity": attrs.get("D2a_JPHH"),        # Jobs per HH within 45min transit
                "mixed_use_index": attrs.get("D2b_E5MIX"),     # 5-tier employment entropy
                "street_connectivity": attrs.get("D3a"),       # Intersection density
                "walk_rank": attrs.get("D2A_Ranked"),
                "transit_rank": attrs.get("D4A_Ranked"),
                "car_dependent": (attrs.get("NatWalkInd") or 0) < 6,
            })

        if page.get("exceededTransferLimit"):
            offset += len(features)
        else:
            break

    return records


def rollup_to_tract(bg_records: list[dict]) -> list[dict]:
    """Roll up block-group records to tract level by averaging walk scores."""
    from collections import defaultdict
    tract_groups: dict[str, list[dict]] = defaultdict(list)
    for rec in bg_records:
        tract_groups[rec["geoid"]].append(rec)

    tract_records = []
    for tract_geoid, bgs in sorted(tract_groups.items()):
        def avg(field: str) -> float | None:
            vals = [bg[field] for bg in bgs if bg.get(field) is not None]
            return round(sum(vals) / len(vals), 2) if vals else None

        walk = avg("walk_score")
        county_fips = bgs[0]["county_fips"]
        tract_records.append({
            "geoid": tract_geoid,
            "county_fips": county_fips,
            "walk_score": walk,
            "transit_proximity": avg("transit_proximity"),
            "bike_network_density": avg("bike_network_density"),
            "job_proximity": avg("job_proximity"),
            "mixed_use_index": avg("mixed_use_index"),
            "street_connectivity": avg("street_connectivity"),
            "car_dependent": (walk or 0) < 6,
            "block_group_count": len(bgs),
        })
    return tract_records


def main() -> int:
    log("=== EPA Walkability Index Fetch ===")

    try:
        bg_records = fetch_walkability_scores()
        log(f"Fetched {len(bg_records)} block-group records")
    except Exception as e:
        log(f"ERROR: {e}")
        bg_records = []

    tracts = rollup_to_tract(bg_records)
    log(f"Rolled up to {len(tracts)} tract-level records")

    output = {
        "meta": {
            "source": "EPA National Walkability Index v3 (Smart Location Database, public ArcGIS)",
            "vintage": "2021",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": utc_now(),
            "coverage_pct": round(min(len(tracts) / 1300 * 100, 100), 1),
            "fields": {
                "geoid": "11-digit census tract GEOID",
                "county_fips": "5-digit county FIPS",
                "walk_score": "National Walkability Index (1-20; 15+ = walkable)",
                "transit_proximity": "Transit trips within 1/4 mile (D4a)",
                "bike_network_density": "Street intersection density (D3b)",
                "job_proximity": "Jobs per HH accessible within 45min transit (D2a_JPHH)",
                "mixed_use_index": "5-tier employment entropy index (D2b_E5MIX)",
                "street_connectivity": "Intersection density (D3a)",
                "car_dependent": "True if walk_score < 6",
                "block_group_count": "Number of block groups averaged for this tract",
            },
            "note": "Rebuild via scripts/market/fetch_epa_walkability.py — cache 30 days",
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
