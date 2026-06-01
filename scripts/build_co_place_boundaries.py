#!/usr/bin/env python3
"""
scripts/build_co_place_boundaries.py
=====================================
Build a simplified CO incorporated-places + CDPs GeoJSON for use as a
zoom-aware boundary overlay across COHO's Leaflet maps (Opportunity
Finder, PMA, Colorado Deep Dive, etc).

WHY SIMPLIFY
------------
Raw TIGERweb output:
  • Incorporated places (273): ~7.9 MB
  • CDPs (211):                ~3.3 MB
  • Combined:                  ~11.2 MB
That's too heavy for a static-site overlay loaded on every map view.

We use shapely's Douglas-Peucker simplification at 0.0008° tolerance
(~80m at CO latitudes — finer than 1px at most zoom levels we render).
Target output: ~1.5 MB combined, which loads + parses fast.

INPUT
-----
Fetched from Census TIGERweb REST API (no auth):
  - Layer 4: Incorporated Places (cities, towns)
  - Layer 5: Census Designated Places (CDPs, unincorporated)

OUTPUT
------
data/co-place-boundaries.geojson — one FeatureCollection containing
both layers with normalized properties:
  { geoid, name, type: 'place'|'cdp', lsadc }
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    from shapely.geometry import shape, mapping
except ImportError:
    print("ERROR: shapely not installed. Run: pip install shapely", file=sys.stderr)
    sys.exit(1)

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT = REPO_ROOT / "data" / "co-place-boundaries.geojson"

# Simplification tolerance in degrees. 0.0008° ≈ 80m at 40°N.
SIMPLIFY_TOLERANCE = 0.0008

# CO state FIPS
STATE_FIPS = "08"

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 (+COHO build_co_place_boundaries)"

LAYERS = [
    (4, "place"),  # Incorporated Places
    (5, "cdp"),    # Census Designated Places
]


def _fetch_geojson(layer_id: int) -> dict:
    url = (
        "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
        "Places_CouSub_ConCity_SubMCD/MapServer/"
        f"{layer_id}/query?where=STATE='{STATE_FIPS}'"
        "&outFields=NAME,GEOID,LSADC&outSR=4326&f=geojson"
    )
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8"))


def _simplify_geom(geom_dict):
    """Run shapely Douglas-Peucker simplification + drop empty geometries."""
    if not geom_dict:
        return None
    try:
        g = shape(geom_dict)
    except Exception as e:
        print(f"  skip bad geom: {e}", file=sys.stderr)
        return None
    if g.is_empty:
        return None
    simplified = g.simplify(SIMPLIFY_TOLERANCE, preserve_topology=True)
    if simplified.is_empty:
        return None
    return mapping(simplified)


def main() -> int:
    features = []
    for layer_id, type_label in LAYERS:
        print(f"Fetching TIGERweb layer {layer_id} ({type_label})…")
        try:
            gj = _fetch_geojson(layer_id)
        except urllib.error.URLError as e:
            print(f"ERROR: fetch failed for layer {layer_id}: {e}", file=sys.stderr)
            return 1

        raw_features = gj.get("features", [])
        print(f"  {len(raw_features)} raw features")

        for f in raw_features:
            geoid = (f.get("properties") or {}).get("GEOID")
            name = (f.get("properties") or {}).get("NAME")
            lsadc = (f.get("properties") or {}).get("LSADC")
            if not geoid:
                continue
            simplified = _simplify_geom(f.get("geometry"))
            if not simplified:
                continue
            features.append({
                "type": "Feature",
                "properties": {
                    "geoid": geoid,
                    "name": name,
                    "type": type_label,
                    "lsadc": lsadc,
                },
                "geometry": simplified,
            })

    print(f"\nTotal simplified features: {len(features)}")

    out = {
        "type": "FeatureCollection",
        "name": "CO incorporated places + CDPs (simplified)",
        "metadata": {
            "source": "Census TIGERweb — Places_CouSub_ConCity_SubMCD layers 4 (Places) + 5 (CDPs)",
            "state_fips": STATE_FIPS,
            "simplify_tolerance_deg": SIMPLIFY_TOLERANCE,
            "generated_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "feature_count": len(features),
            "notes": (
                f"Geometry simplified with shapely Douglas-Peucker at "
                f"{SIMPLIFY_TOLERANCE}° tolerance (~80m at 40°N). Use for "
                "zoom-aware Leaflet overlays — appearance at very high zoom "
                "(>= 16) may look coarse. For finer detail re-build with "
                "smaller tolerance, accepting larger file size."
            ),
        },
        "features": features,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    # Compact (no indent) for size — the file is data, not human-edited
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    size_mb = OUT.stat().st_size / 1024 / 1024
    print(f"OK  wrote {OUT.relative_to(REPO_ROOT)} ({size_mb:.2f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
