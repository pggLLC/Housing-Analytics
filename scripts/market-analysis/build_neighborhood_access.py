"""
scripts/market-analysis/build_neighborhood_access.py

Generates data/derived/market-analysis/neighborhood_access.json by merging
live OSM GeoJSON files from data/amenities/ into the unified format expected
by the OsmAmenities JS connector.

GeoJSON sources (built by scripts/amenities/build_osm_amenities.py):
  - data/amenities/grocery_co.geojson       → type: "grocery"
  - data/amenities/healthcare_co.geojson    → type: "healthcare"
  - data/amenities/schools_co.geojson       → type: "school"
  - data/amenities/parks_co.geojson         → type: "park"
  - data/amenities/transit_stops_co.geojson → type: "transit_stop"

Falls back to representative seed data for any category whose GeoJSON file
is missing or empty.

Writes: data/derived/market-analysis/neighborhood_access.json
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
AMENITY_DIR = REPO_ROOT / "data" / "amenities"
OUTPUT_DIR = REPO_ROOT / "data" / "derived" / "market-analysis"
OUTPUT_PATH = OUTPUT_DIR / "neighborhood_access.json"

# Mapping from GeoJSON filename → amenity type in the output
GEOJSON_SOURCES = {
    "grocery_co.geojson":        "grocery",
    "healthcare_co.geojson":     "healthcare",
    "schools_co.geojson":        "school",
    "parks_co.geojson":          "park",
    "transit_stops_co.geojson":  "transit_stop",
}

# ---------------------------------------------------------------------------
# Seed data: fallback for categories without live GeoJSON.
# ---------------------------------------------------------------------------
SEED_AMENITIES = [
    # ── Grocery ──────────────────────────────────────────────────────────
    {"type": "grocery", "name": "King Soopers", "lat": 39.7392, "lon": -104.9903},
    {"type": "grocery", "name": "Safeway – Capitol Hill", "lat": 39.7340, "lon": -104.9775},
    {"type": "grocery", "name": "King Soopers – CO Springs N", "lat": 38.9071, "lon": -104.8026},
    {"type": "grocery", "name": "King Soopers – Pueblo", "lat": 38.2681, "lon": -104.6126},
    {"type": "grocery", "name": "King Soopers – Fort Collins", "lat": 40.5741, "lon": -105.0847},
    {"type": "grocery", "name": "King Soopers – Greeley", "lat": 40.4069, "lon": -104.7074},
    {"type": "grocery", "name": "City Market – Grand Junction", "lat": 39.0744, "lon": -108.5506},
    {"type": "grocery", "name": "City Market – Steamboat Springs", "lat": 40.4786, "lon": -106.8322},
    # ── Transit stops ────────────────────────────────────────────────────
    {"type": "transit_stop", "name": "RTD Union Station", "lat": 39.7529, "lon": -105.0002},
    {"type": "transit_stop", "name": "RTD Civic Center", "lat": 39.7369, "lon": -104.9883},
    {"type": "transit_stop", "name": "RTD Alameda Station", "lat": 39.7148, "lon": -104.9945},
    {"type": "transit_stop", "name": "Mountain Metropolitan Transit", "lat": 38.8316, "lon": -104.8183},
    {"type": "transit_stop", "name": "Pueblo Transit", "lat": 38.2551, "lon": -104.6126},
    {"type": "transit_stop", "name": "Transfort – Downtown FC", "lat": 40.5890, "lon": -105.0755},
    {"type": "transit_stop", "name": "Mesa County Rural Transit", "lat": 39.0744, "lon": -108.5506},
    # ── Parks ────────────────────────────────────────────────────────────
    {"type": "park", "name": "City Park", "lat": 39.7490, "lon": -104.9502},
    {"type": "park", "name": "Washington Park", "lat": 39.7002, "lon": -104.9617},
    {"type": "park", "name": "Prospect Lake – Memorial Park", "lat": 38.8417, "lon": -104.8137},
    {"type": "park", "name": "Pueblo City Park", "lat": 38.2628, "lon": -104.6126},
    {"type": "park", "name": "Lee Martinez Park – Ft Collins", "lat": 40.5983, "lon": -105.0836},
    {"type": "park", "name": "Riverside Park – Grand Junction", "lat": 39.0639, "lon": -108.5598},
    # ── Healthcare ───────────────────────────────────────────────────────
    {"type": "healthcare", "name": "Denver Health Medical Center", "lat": 39.7240, "lon": -104.9968},
    {"type": "healthcare", "name": "UCHealth – CO Springs", "lat": 38.9285, "lon": -104.7831},
    {"type": "healthcare", "name": "Parkview Medical Center", "lat": 38.2691, "lon": -104.5906},
    {"type": "healthcare", "name": "UCHealth – Poudre Valley", "lat": 40.5758, "lon": -105.0671},
    {"type": "healthcare", "name": "Community Hospital – Grand Junction", "lat": 39.0741, "lon": -108.5502},
    # ── Schools ──────────────────────────────────────────────────────────
    {"type": "school", "name": "East High School", "lat": 39.7371, "lon": -104.9447},
    {"type": "school", "name": "Palmer High School", "lat": 38.8379, "lon": -104.8252},
    {"type": "school", "name": "Pueblo Central High", "lat": 38.2705, "lon": -104.6146},
    {"type": "school", "name": "Poudre High School", "lat": 40.5940, "lon": -105.1078},
    {"type": "school", "name": "Grand Junction High School", "lat": 39.0678, "lon": -108.5518},
]


def load_geojson(filepath: Path, amenity_type: str) -> list[dict]:
    """Load a GeoJSON FeatureCollection and return amenity records."""
    if not filepath.exists():
        return []
    try:
        data = json.loads(filepath.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        print(f"  ⚠ Could not read {filepath.name}: {exc}", file=sys.stderr)
        return []

    features = data.get("features", [])
    records = []
    for feat in features:
        geom = feat.get("geometry", {})
        coords = geom.get("coordinates", [])
        props = feat.get("properties", {})
        if len(coords) < 2:
            continue
        lon, lat = coords[0], coords[1]
        name = props.get("name", "") or ""
        if not name:
            continue  # Skip unnamed amenities — they add noise without value
        record = {
            "type": amenity_type,
            "name": name,
            "lat": round(lat, 6),
            "lon": round(lon, 6),
        }
        # Preserve transit subtype if available (rail_station, tram_stop, bus_stop, etc.)
        transit_type = props.get("transit_type", "")
        if transit_type:
            record["transit_type"] = transit_type
        records.append(record)
    return records


def build(output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()

    all_amenities: list[dict] = []
    sources_used: list[str] = []
    seed_categories_used: list[str] = []

    # Track which categories got live data
    live_types: set[str] = set()

    for filename, amenity_type in GEOJSON_SOURCES.items():
        filepath = AMENITY_DIR / filename
        records = load_geojson(filepath, amenity_type)
        if records:
            all_amenities.extend(records)
            live_types.add(amenity_type)
            sources_used.append(f"{filename}: {len(records)} features")
            print(f"  ✅ {filename}: {len(records)} {amenity_type} records")
        else:
            print(f"  ⚠ {filename}: missing or empty — will use seed data for {amenity_type}")

    # Fill in seed data for any category that had no live data
    for seed in SEED_AMENITIES:
        if seed["type"] not in live_types:
            all_amenities.append(seed)
            if seed["type"] not in seed_categories_used:
                seed_categories_used.append(seed["type"])

    if seed_categories_used:
        sources_used.append(f"Seed fallback for: {', '.join(seed_categories_used)}")
        print(f"  📌 Seed fallback used for: {', '.join(seed_categories_used)}")

    # Deduplicate by (type, name, rounded coordinates)
    seen = set()
    deduped = []
    for a in all_amenities:
        key = (a["type"], a["name"], round(a["lat"], 4), round(a["lon"], 4))
        if key not in seen:
            seen.add(key)
            deduped.append(a)

    result = {
        "meta": {
            "generated": now,
            "source": "OpenStreetMap Overpass API + seed fallback",
            "sources_detail": sources_used,
            "note": (
                "Colorado amenity points merged from OSM GeoJSON files. "
                "Run scripts/amenities/build_osm_amenities.py first to refresh source data."
            ),
            "record_count": len(deduped),
        },
        "amenities": deduped,
    }

    output_path.write_text(json.dumps(result, indent=2))
    print(f"\n  Wrote {len(deduped)} amenity records → {output_path.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    print("Building neighborhood_access.json …")
    build(OUTPUT_PATH)
    print("Done.")
    sys.exit(0)
