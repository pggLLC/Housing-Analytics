"""
scripts/market-analysis/build_neighborhood_access.py

Generates data/derived/market-analysis/neighborhood_access.json by merging
Colorado amenity GeoJSON files into the unified format expected by the
OsmAmenities JS connector (js/data-connectors/osm-amenities.js).

OSM sources (built by scripts/amenities/build_osm_amenities.py):
  - data/amenities/grocery_co.geojson       → type: "grocery"
  - data/amenities/healthcare_co.geojson    → type: "healthcare"
  - data/amenities/schools_co.geojson       → type: "school"
  - data/amenities/parks_co.geojson         → type: "park"
  - data/amenities/transit_stops_co.geojson → type: "transit_stop"

State registry sources:
  - data/market/hospitals_co.geojson        → type: "hospital"
    (HIFLD + CDPHE, scripts/market/fetch_hospitals.py)
  - data/market/childcare_co.geojson        → type: "childcare"
    (CDHS licensed facilities, scripts/market/fetch_childcare.py)

OSM records are rounded to 6 dp and deduplicated on (type, name, ~11 m), which
removes OSM double-mapping. Registry records are kept one per feature, as
published: one registry feature is one licensed facility, and co-located
programs (a child care center and a school-age center in the same building)
are separate licences with separate capacity.

Falls back to representative seed data for an OSM category whose GeoJSON file
is missing or empty. A missing registry source is an error: it has no seed,
and dropping it would silently remove the type from site scoring.

Writes: data/derived/market-analysis/neighborhood_access.json
"""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = REPO_ROOT / "data" / "derived" / "market-analysis"
OUTPUT_PATH = OUTPUT_DIR / "neighborhood_access.json"

# Mapping from repo-relative GeoJSON path → amenity type in the output.
# Output order follows this order. Every type OsmAmenities scores must be
# produced here — tests/test_neighborhood_access_builder.py enforces it.
GEOJSON_SOURCES = {
    "data/amenities/grocery_co.geojson":        "grocery",
    "data/amenities/healthcare_co.geojson":     "healthcare",
    "data/amenities/schools_co.geojson":        "school",
    "data/amenities/parks_co.geojson":          "park",
    "data/amenities/transit_stops_co.geojson":  "transit_stop",
    "data/market/hospitals_co.geojson":         "hospital",
    "data/market/childcare_co.geojson":         "childcare",
}

# Registry sources: kept one record per feature (no rounding, no dedup) and
# required to exist (no seed fallback). See the module docstring.
REGISTRY_SOURCES = {
    "data/market/hospitals_co.geojson",
    "data/market/childcare_co.geojson",
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


def load_geojson(filepath: Path, amenity_type: str, registry: bool = False) -> list[dict]:
    """Load a GeoJSON FeatureCollection and return amenity records.

    Registry records keep their published coordinates; OSM records are
    rounded to 6 dp (~0.1 m).
    """
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
            "lat": lat if registry else round(lat, 6),
            "lon": lon if registry else round(lon, 6),
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

    osm_amenities: list[dict] = []
    registry_amenities: list[dict] = []
    sources_used: list[str] = []
    seed_categories_used: list[str] = []

    # Track which categories got live data
    live_types: set[str] = set()

    for rel_path, amenity_type in GEOJSON_SOURCES.items():
        registry = rel_path in REGISTRY_SOURCES
        records = load_geojson(REPO_ROOT / rel_path, amenity_type, registry=registry)
        if records:
            (registry_amenities if registry else osm_amenities).extend(records)
            live_types.add(amenity_type)
            sources_used.append(f"{Path(rel_path).name}: {len(records)} features")
            print(f"  ✅ {rel_path}: {len(records)} {amenity_type} records")
        elif registry:
            raise SystemExit(
                f"  ✖ {rel_path}: missing or empty — {amenity_type} has no seed "
                "fallback, and writing without it would drop the type from site scoring"
            )
        else:
            print(f"  ⚠ {rel_path}: missing or empty — will use seed data for {amenity_type}")

    # Fill in seed data for any category that had no live data
    for seed in SEED_AMENITIES:
        if seed["type"] not in live_types:
            osm_amenities.append(seed)
            if seed["type"] not in seed_categories_used:
                seed_categories_used.append(seed["type"])

    if seed_categories_used:
        sources_used.append(f"Seed fallback for: {', '.join(seed_categories_used)}")
        print(f"  📌 Seed fallback used for: {', '.join(seed_categories_used)}")

    # Deduplicate OSM/seed records by (type, name, rounded coordinates).
    # Registry records are appended as published (see module docstring).
    seen = set()
    deduped = []
    for a in osm_amenities:
        key = (a["type"], a["name"], round(a["lat"], 4), round(a["lon"], 4))
        if key not in seen:
            seen.add(key)
            deduped.append(a)
    deduped.extend(registry_amenities)

    amenity_types = list(dict.fromkeys(a["type"] for a in deduped))

    result = {
        "meta": {
            "generated": now,
            "source": (
                "OpenStreetMap Overpass API + seed fallback; "
                "HIFLD/CDPHE hospitals; CDHS licensed child care facilities"
            ),
            "sources_detail": sources_used,
            "note": (
                f"Includes {', '.join(amenity_types)}. "
                "Refresh sources with scripts/amenities/build_osm_amenities.py, "
                "scripts/market/fetch_hospitals.py and scripts/market/fetch_childcare.py, "
                "then rerun this script."
            ),
            "record_count": len(deduped),
            "amenity_types": amenity_types,
        },
        "amenities": deduped,
    }

    output_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"\n  Wrote {len(deduped)} amenity records → {output_path}")


if __name__ == "__main__":
    print("Building neighborhood_access.json …")
    build(OUTPUT_PATH)
    print("Done.")
    sys.exit(0)
