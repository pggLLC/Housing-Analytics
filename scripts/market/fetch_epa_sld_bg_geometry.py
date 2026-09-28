#!/usr/bin/env python3
"""
scripts/market/fetch_epa_sld_bg_geometry.py

Fetch a boundary for every block group in data/market/epa_sld_co.json, so the
EPA walkability connector (js/data-connectors/epa-walkability.js) can find the
block group a site actually sits in.

Why a separate file: epa_sld_co.json carries metrics keyed by GEOID and no
geometry. The EPA Smart Location Database v3 is published on 2010-vintage block
groups (3,532 in Colorado), while the repo's tract boundaries and centroids are
TIGER 2020, so a join through 2020 tracts misses the 667 EPA block groups whose
tracts were split or renumbered in 2020. The Census Bureau's 2010 block-group
layer has exactly the same 3,532 GEOIDs.

Source:
    TIGERweb tigerWMS_Census2010 MapServer, layer 16 (Census Block Groups)

Output:
    data/market/epa_sld_bg_geometry_co.geojson
    FeatureCollection; properties { geoid }; WGS84; simplified server-side
    with maxAllowableOffset (see SIMPLIFY_DEG) and 5-decimal coordinates.

The script refuses to write unless the fetched GEOID set equals the GEOID set
in epa_sld_co.json exactly: a boundary file that silently covers a different
set of block groups would reintroduce the lookup gap it exists to close.

Usage:
    python3 scripts/market/fetch_epa_sld_bg_geometry.py
"""

import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
EPA_FILE = ROOT / "data" / "market" / "epa_sld_co.json"
OUT_FILE = ROOT / "data" / "market" / "epa_sld_bg_geometry_co.geojson"

STATE_FIPS = "08"
LAYER_URL = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
    "tigerWMS_Census2010/MapServer/16"
)
PAGE = 500
SIMPLIFY_DEG = 0.0005  # ~45 m; keeps the statewide file under ~2 MB


def fetch_page(offset):
    params = {
        "where": "STATE='%s'" % STATE_FIPS,
        "outFields": "GEOID",
        "returnGeometry": "true",
        "outSR": "4326",
        "maxAllowableOffset": str(SIMPLIFY_DEG),
        "geometryPrecision": "5",
        "orderByFields": "GEOID",
        "resultOffset": str(offset),
        "resultRecordCount": str(PAGE),
        "f": "geojson",
    }
    url = LAYER_URL + "/query?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=180) as resp:
                data = json.load(resp)
            if "error" in data:
                raise RuntimeError(data["error"])
            return data.get("features", [])
        except Exception as exc:  # noqa: BLE001 - retried, then re-raised
            if attempt == 2:
                raise
            print("retrying offset %d after: %s" % (offset, exc), file=sys.stderr)
            time.sleep(5)
    return []


def main():
    features = {}
    offset = 0
    while True:
        page = fetch_page(offset)
        for f in page:
            geoid = f["properties"]["GEOID"]
            geom = f.get("geometry")
            if not geom or geom.get("type") not in ("Polygon", "MultiPolygon"):
                print("block group %s has no polygon geometry" % geoid, file=sys.stderr)
                sys.exit(1)
            features[geoid] = {"type": "Feature", "properties": {"geoid": geoid}, "geometry": geom}
        if len(page) < PAGE:
            break
        offset += PAGE

    epa_ids = set(json.loads(EPA_FILE.read_text())["blockGroups"].keys())
    got = set(features.keys())
    if got != epa_ids:
        print(
            "GEOID sets differ: %d fetched, %d in EPA file, %d EPA block groups without a boundary, "
            "%d boundaries not in EPA file" % (len(got), len(epa_ids), len(epa_ids - got), len(got - epa_ids)),
            file=sys.stderr,
        )
        sys.exit(1)

    out = {
        "type": "FeatureCollection",
        "meta": {
            "source": "U.S. Census Bureau TIGERweb, Census 2010 block groups (tigerWMS_Census2010 layer 16)",
            "url": LAYER_URL,
            "state_fips": STATE_FIPS,
            "vintage": "2010 block-group geography, the geography EPA Smart Location Database v3 is published on",
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "feature_count": len(features),
            "simplification": "server-side maxAllowableOffset %s degrees, 5-decimal coordinates" % SIMPLIFY_DEG,
            "note": "GEOID set equals data/market/epa_sld_co.json exactly. "
                    "Built by scripts/market/fetch_epa_sld_bg_geometry.py.",
        },
        "features": [features[k] for k in sorted(features)],
    }
    OUT_FILE.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print("wrote %d block-group boundaries to %s" % (len(features), OUT_FILE.relative_to(ROOT)))


if __name__ == "__main__":
    main()
