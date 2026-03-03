#!/usr/bin/env python3
"""
scripts/amenities/build_osm_amenities.py

Fetches amenity points of interest from OpenStreetMap Overpass API for Colorado
and caches them as GeoJSON files under data/amenities/.

Categories fetched:
  - schools      → data/amenities/schools_co.geojson
  - grocery      → data/amenities/grocery_co.geojson
  - healthcare   → data/amenities/healthcare_co.geojson
  - retail_nodes → data/amenities/retail_nodes_co.geojson

Usage:
    python scripts/amenities/build_osm_amenities.py [--category CATEGORY]

Environment variables (optional):
    OVERPASS_URL  - Override default Overpass endpoint

Notes:
  - Overpass API is rate-limited; this script throttles requests.
  - If a query fails, the existing cached file is preserved (last-known-good).
  - Each output file includes a "generated" timestamp for freshness tracking.
  - Queries are bounding-boxed to Colorado: [36.9,-109.1,41.1,-102.0]
"""

import json
import os
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
import argparse
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = ROOT / "data" / "amenities"

OVERPASS_URL = os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter")

# Colorado bounding box: south, west, north, east
CO_BBOX = "36.9,-109.1,41.1,-102.0"

# Rate-limit delay between requests (seconds)
THROTTLE_S = 3.0

# Timeout for each Overpass request (seconds)
TIMEOUT_S = 60

CATEGORIES = {
    "schools": {
        "query": f"""
[out:json][timeout:{TIMEOUT_S}];
(
  node["amenity"="school"]({CO_BBOX});
  node["amenity"="kindergarten"]({CO_BBOX});
);
out body;
""",
        "output": "schools_co.geojson",
        "name_tag": "name",
    },
    "grocery": {
        "query": f"""
[out:json][timeout:{TIMEOUT_S}];
(
  node["shop"="supermarket"]({CO_BBOX});
  node["shop"="grocery"]({CO_BBOX});
  node["shop"="convenience"]({CO_BBOX});
);
out body;
""",
        "output": "grocery_co.geojson",
        "name_tag": "name",
    },
    "healthcare": {
        "query": f"""
[out:json][timeout:{TIMEOUT_S}];
(
  node["amenity"="hospital"]({CO_BBOX});
  node["amenity"="clinic"]({CO_BBOX});
  node["amenity"="doctors"]({CO_BBOX});
  node["amenity"="pharmacy"]({CO_BBOX});
);
out body;
""",
        "output": "healthcare_co.geojson",
        "name_tag": "name",
    },
    "retail_nodes": {
        "query": f"""
[out:json][timeout:{TIMEOUT_S}];
(
  node["shop"="mall"]({CO_BBOX});
  node["shop"="department_store"]({CO_BBOX});
  node["shop"="clothes"]({CO_BBOX});
  node["amenity"="restaurant"]({CO_BBOX});
  node["amenity"="fast_food"]({CO_BBOX});
);
out body;
""",
        "output": "retail_nodes_co.geojson",
        "name_tag": "name",
    },
}


def overpass_query(query: str) -> dict:
    """Send an Overpass QL query and return the parsed JSON response."""
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(OVERPASS_URL, data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    req.add_header("User-Agent", "HousingAnalytics/1.0 build_osm_amenities.py (public data)")
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
        return json.loads(resp.read().decode("utf-8"))


def osm_to_geojson(osm_result: dict, name_tag: str = "name") -> dict:
    """Convert Overpass JSON (nodes only) to a GeoJSON FeatureCollection."""
    features = []
    for element in osm_result.get("elements", []):
        if element.get("type") != "node":
            continue
        lat = element.get("lat")
        lon = element.get("lon")
        if lat is None or lon is None:
            continue
        tags = element.get("tags", {})
        props = {
            "osm_id": element.get("id"),
            "name": tags.get(name_tag) or tags.get("name") or "",
            "amenity": tags.get("amenity", ""),
            "shop": tags.get("shop", ""),
        }
        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": props,
        })
    return {
        "type": "FeatureCollection",
        "features": features,
    }


def build_category(cat_name: str, cat_cfg: dict, out_dir: Path) -> bool:
    """
    Fetch one category from Overpass and write GeoJSON.
    Returns True on success, False on failure (preserving existing file).
    """
    out_path = out_dir / cat_cfg["output"]
    print(f"  [{cat_name}] Querying Overpass…", flush=True)
    try:
        result = overpass_query(cat_cfg["query"])
    except Exception as exc:
        print(f"  [{cat_name}] ⚠ Overpass query failed: {exc}", file=sys.stderr)
        if out_path.exists():
            print(f"  [{cat_name}] Preserving existing cached file: {out_path}", file=sys.stderr)
        else:
            # Write an empty FeatureCollection so the site doesn't 404
            _write_empty(out_path, cat_name)
        return False

    geojson = osm_to_geojson(result, cat_cfg["name_tag"])
    geojson["meta"] = {
        "source": "OpenStreetMap Overpass API (public)",
        "category": cat_name,
        "state": "Colorado",
        "bbox": CO_BBOX,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(geojson["features"]),
    }
    out_path.write_text(json.dumps(geojson, indent=2), encoding="utf-8")
    print(f"  [{cat_name}] ✅ {len(geojson['features'])} features → {out_path.relative_to(ROOT)}")
    return True


def _write_empty(path: Path, cat_name: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    empty = {
        "type": "FeatureCollection",
        "features": [],
        "meta": {
            "source": "OpenStreetMap Overpass API (public)",
            "category": cat_name,
            "state": "Colorado",
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "note": "Empty — Overpass query failed; re-run script to populate.",
        },
    }
    path.write_text(json.dumps(empty, indent=2), encoding="utf-8")
    print(f"  [{cat_name}] ⚠ Wrote empty placeholder → {path.relative_to(ROOT)}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser(description="Fetch OSM amenities for Colorado")
    parser.add_argument(
        "--category",
        choices=list(CATEGORIES.keys()),
        default=None,
        help="Fetch only this category (default: all)",
    )
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    categories = {args.category: CATEGORIES[args.category]} if args.category else CATEGORIES

    print(f"Fetching {len(categories)} amenity category/categories for Colorado…")
    print(f"Output directory: {OUT_DIR.relative_to(ROOT)}")
    print(f"Overpass endpoint: {OVERPASS_URL}")
    print()

    results = {}
    for idx, (cat_name, cat_cfg) in enumerate(categories.items()):
        if idx > 0:
            print(f"  Throttling {THROTTLE_S}s…")
            time.sleep(THROTTLE_S)
        results[cat_name] = build_category(cat_name, cat_cfg, OUT_DIR)

    print()
    ok = sum(1 for v in results.values() if v)
    fail = len(results) - ok
    print(f"Done: {ok} succeeded, {fail} failed.")
    if fail > 0:
        print("⚠  Some categories failed. Existing cached files were preserved where available.")
    sys.exit(0 if fail == 0 else 1)


if __name__ == "__main__":
    main()
