#!/usr/bin/env python3
"""
scripts/market/build_osm_landuse.py

Fetches land-use polygons from OpenStreetMap Overpass API for Colorado
and outputs a simplified GeoJSON with zoning-proxy classifications.

Output: data/market/landuse_zoning_proxy_co.geojson

Each feature gets a standardized `zone_proxy` classification:
  - multifamily_residential  (apartments, flats, residential + building:levels >= 3)
  - townhome_residential     (terrace/row housing, residential medium density)
  - single_family            (detached residential, low density)
  - mixed_use                (commercial + residential land use overlap)
  - commercial               (retail, commercial)
  - industrial               (industrial)
  - vacant_developable       (brownfield, greenfield, construction sites)

This serves as a FREE proxy for actual zoning data. For authoritative
parcel-level zoning, use the Regrid connector (js/data-connectors/regrid-zoning.js).

Usage:
    python scripts/market/build_osm_landuse.py

Environment:
    OVERPASS_URL  - Override default Overpass endpoint (optional)
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_PATH = ROOT / "data" / "market" / "landuse_zoning_proxy_co.geojson"

OVERPASS_URL = os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter")

# Colorado bounding box: south, west, north, east
CO_BBOX = "36.9,-109.1,41.1,-102.0"
TIMEOUT_S = 300
THROTTLE_S = 5.0


def log(msg):
    print(f"[osm-landuse] {msg}", file=sys.stderr)


def overpass_query(query_body):
    """Execute an Overpass query and return parsed JSON."""
    data = urllib.parse.urlencode({"data": query_body}).encode("utf-8")
    req = urllib.request.Request(OVERPASS_URL, data=data,
                                headers={"User-Agent": "COHO-Housing-Analytics/1.0"})
    try:
        resp = urllib.request.urlopen(req, timeout=TIMEOUT_S)
        return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 429:
            log("Rate-limited (429). Waiting 30s…")
            time.sleep(30)
            resp = urllib.request.urlopen(req, timeout=TIMEOUT_S)
            return json.loads(resp.read().decode("utf-8"))
        raise


import urllib.parse


# ── Queries ──────────────────────────────────────────────────────────────────

QUERIES = {
    "multifamily": f"""
[out:json][timeout:{TIMEOUT_S}];
(
  way["building"="apartments"]({CO_BBOX});
  way["building"="residential"]["building:levels"~"^[3-9]"]({CO_BBOX});
  way["landuse"="residential"]["residential"="apartments"]({CO_BBOX});
  relation["building"="apartments"]({CO_BBOX});
);
out center;
""",
    "townhome": f"""
[out:json][timeout:{TIMEOUT_S}];
(
  way["building"="terrace"]({CO_BBOX});
  way["building"="semidetached_house"]({CO_BBOX});
  way["building"~"^(townhouse|row)$"]({CO_BBOX});
);
out center;
""",
    "mixed_use": f"""
[out:json][timeout:{TIMEOUT_S}];
(
  way["landuse"="mixed"]({CO_BBOX});
  way["building"="commercial"]["building:use"~"residential"]({CO_BBOX});
  way["building:use"="residential"]["shop"]({CO_BBOX});
);
out center;
""",
    "vacant": f"""
[out:json][timeout:{TIMEOUT_S}];
(
  way["landuse"="brownfield"]({CO_BBOX});
  way["landuse"="greenfield"]({CO_BBOX});
  way["landuse"="construction"]({CO_BBOX});
  node["vacant"="yes"]({CO_BBOX});
);
out center;
""",
    "commercial": f"""
[out:json][timeout:{TIMEOUT_S}];
(
  way["landuse"="commercial"]({CO_BBOX});
  way["landuse"="retail"]({CO_BBOX});
);
out center;
""",
    "industrial": f"""
[out:json][timeout:{TIMEOUT_S}];
(
  way["landuse"="industrial"]({CO_BBOX});
);
out center;
""",
}

ZONE_PROXY_MAP = {
    "multifamily": "multifamily_residential",
    "townhome":    "townhome_residential",
    "mixed_use":   "mixed_use",
    "vacant":      "vacant_developable",
    "commercial":  "commercial",
    "industrial":  "industrial",
}


def element_to_feature(elem, zone_proxy):
    """Convert an Overpass element to a GeoJSON Point feature."""
    # Use center for ways/relations, direct coords for nodes
    if "center" in elem:
        lon, lat = elem["center"]["lon"], elem["center"]["lat"]
    elif "lon" in elem and "lat" in elem:
        lon, lat = elem["lon"], elem["lat"]
    else:
        return None

    tags = elem.get("tags", {})
    name = tags.get("name", tags.get("addr:street", ""))
    levels = tags.get("building:levels", "")
    building = tags.get("building", "")
    landuse = tags.get("landuse", "")

    # Suitability score (0-100) based on zone proxy
    suitability = {
        "multifamily_residential": 90,
        "townhome_residential": 85,
        "mixed_use": 75,
        "vacant_developable": 80,
        "commercial": 40,
        "industrial": 20,
    }.get(zone_proxy, 50)

    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lon, 5), round(lat, 5)]},
        "properties": {
            "name": name,
            "zone_proxy": zone_proxy,
            "building": building,
            "landuse": landuse,
            "levels": levels,
            "osm_id": elem.get("id", ""),
            "osm_type": elem.get("type", ""),
            "mf_suitability": suitability,
        },
    }


def main():
    log("Building OSM land-use zoning proxy for Colorado…")
    all_features = []

    for category, query_body in QUERIES.items():
        log(f"  Fetching {category}…")
        try:
            result = overpass_query(query_body)
            elements = result.get("elements", [])
            zone_proxy = ZONE_PROXY_MAP[category]
            count = 0
            for elem in elements:
                feat = element_to_feature(elem, zone_proxy)
                if feat:
                    all_features.append(feat)
                    count += 1
            log(f"    → {count} features")
        except Exception as e:
            log(f"    ⚠ Failed: {e}")
        time.sleep(THROTTLE_S)

    # Deduplicate by osm_id
    seen = set()
    unique = []
    for f in all_features:
        oid = f["properties"].get("osm_id", "")
        if oid and oid in seen:
            continue
        seen.add(oid)
        unique.append(f)

    output = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "OpenStreetMap Overpass API",
            "description": "Land-use zoning proxy for multifamily/townhome suitability",
            "generated": datetime.now(timezone.utc).isoformat(),
            "feature_count": len(unique),
            "note": "Proxy only — for authoritative zoning use Regrid API",
            "categories": list(ZONE_PROXY_MAP.values()),
        },
        "features": unique,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w") as f:
        json.dump(output, f, separators=(",", ":"))

    size_kb = OUT_PATH.stat().st_size / 1024
    log(f"✅ Wrote {len(unique)} features → {OUT_PATH.name} ({size_kb:.0f} KB)")


if __name__ == "__main__":
    main()
