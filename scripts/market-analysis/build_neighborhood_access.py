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

Transit (built by scripts/market/build_transit_stops_co.py):
  - data/amenities/transit_stops_statewide_co.geojson → type: "transit_stop"
    Selected by scripts/lib/transit_stops.py, the rule the ranking index
    shares: confirmed public scheduled stops (CDOT and/or an agency GTFS feed;
    no private shuttles, no demand-response). OpenStreetMap-only stops are
    added only around a place whose centroid has no confirmed stop within
    TRANSIT_FALLBACK_RADIUS_MILES but has an OpenStreetMap-only stop there,
    and never within that radius of a place that does have a confirmed stop.
    Every transit record says which it is in "transit_stop_basis", and
    meta.transit lists the fallback places.

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
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts" / "lib"))

import transit_stops  # noqa: E402  (the one statewide stop-selection rule)

TRANSIT_SOURCE = transit_stops.STATEWIDE_STOPS_REL
# OsmAmenities.distanceToScore() gives a transit stop no credit beyond 2 miles,
# so that is the range in which "no confirmed stop" would score a place 0.
# tests/test_transit_stop_selection.py pins this to the connector.
TRANSIT_FALLBACK_RADIUS_MILES = 2.0
CENTROIDS_PATH = REPO_ROOT / "data" / "co-place-centroids.json"
EARTH_RADIUS_MI = 3958.8  # the connector's haversine radius
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
    TRANSIT_SOURCE:                             "transit_stop",
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


def _miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi, dlam = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return EARTH_RADIUS_MI * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _transit_record(feat: dict, basis: str) -> dict:
    """One transit_stop record. Unlike an OSM amenity, an unnamed statewide stop
    is still a stop (CDOT/agency published, or the only one a fallback town
    has), so it is kept under a label that says it has no name."""
    lon, lat = feat["geometry"]["coordinates"][:2]
    props = feat.get("properties") or {}
    name = (props.get("name") or "").strip() or f"Unnamed stop ({props.get('agency') or 'agency not listed'})"
    return {"type": "transit_stop", "name": name, "lat": round(lat, 6), "lon": round(lon, 6),
            "transit_stop_basis": basis}


def load_centroids(path: Path = CENTROIDS_PATH) -> dict[str, dict]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    return {str(g).zfill(7): c for g, c in sorted((doc.get("byGeoid") or {}).items())
            if isinstance(c.get("lat"), (int, float)) and isinstance(c.get("lng"), (int, float))}


def place_transit_bases(stops: dict[str, list[dict]], centroids: dict[str, dict]) -> dict[str, str]:
    """{place geoid: transit_stop_basis} at each place centroid, via the shared rule."""
    confirmed = transit_stops.points(stops[transit_stops.BASIS_CONFIRMED])
    osm = transit_stops.points(stops[transit_stops.BASIS_OSM_FALLBACK])
    return {
        geoid: transit_stops.basis_for_point(c["lat"], c["lng"], TRANSIT_FALLBACK_RADIUS_MILES,
                                             confirmed, osm, _miles)
        for geoid, c in centroids.items()
    }


def load_transit(path: Path, centroids: dict[str, dict]) -> tuple[list[dict], dict]:
    """(transit_stop records, meta.transit). Confirmed stops everywhere;
    OpenStreetMap-only stops only around fallback places, never within range
    of a place that has a confirmed stop."""
    stops = transit_stops.load_stops(path)
    bases = place_transit_bases(stops, centroids)
    fallback = {g: centroids[g] for g, b in bases.items() if b == transit_stops.BASIS_OSM_FALLBACK}
    served = {g: centroids[g] for g, b in bases.items() if b == transit_stops.BASIS_CONFIRMED}

    records = [_transit_record(f, transit_stops.BASIS_CONFIRMED) for f in stops[transit_stops.BASIS_CONFIRMED]]
    per_place: dict[str, int] = {g: 0 for g in fallback}
    blocked_by: dict[str, set[str]] = {g: set() for g in fallback}
    r = TRANSIT_FALLBACK_RADIUS_MILES
    for feat in stops[transit_stops.BASIS_OSM_FALLBACK]:
        lon, lat = feat["geometry"]["coordinates"][:2]
        near_fallback = [g for g, c in fallback.items() if _miles(c["lat"], c["lng"], lat, lon) <= r]
        if not near_fallback:
            continue
        near_served = [g for g, c in served.items() if _miles(c["lat"], c["lng"], lat, lon) <= r]
        if near_served:
            # A place with a confirmed stop never gets OpenStreetMap-only stops,
            # even when that leaves a neighbouring fallback place without one.
            for g in near_fallback:
                blocked_by[g].update(near_served)
            continue
        records.append(_transit_record(feat, transit_stops.BASIS_OSM_FALLBACK))
        for g in near_fallback:
            per_place[g] += 1
    counts = {b: sum(1 for v in bases.values() if v == b) for b in transit_stops.BASES}
    meta = {
        "source": TRANSIT_SOURCE,
        "selection": "scripts/lib/transit_stops.py",
        "rule": ("Confirmed public scheduled stops (reliability confirmed; not private_shuttle; "
                 "not demand_response). OpenStreetMap-only stops only around a place centroid "
                 "with no confirmed stop within fallback_radius_miles, and never within that "
                 "radius of a place centroid that has one."),
        "fallback_radius_miles": TRANSIT_FALLBACK_RADIUS_MILES,
        "places_by_basis": counts,
        "fallback_places": [
            {
                "geoid": g,
                "name": centroids[g].get("name"),
                "openstreetmap_stops": per_place[g],
                # Non-empty only when every in-range OpenStreetMap-only stop is
                # also within range of these places, which have confirmed stops.
                "withheld_because_near": sorted(blocked_by[g]) if not per_place[g] else [],
            }
            for g in sorted(fallback)
        ],
    }
    return records, meta


def build(output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()

    osm_amenities: list[dict] = []
    registry_amenities: list[dict] = []
    sources_used: list[str] = []
    seed_categories_used: list[str] = []

    # Track which categories got live data
    live_types: set[str] = set()
    transit_meta = None

    for rel_path, amenity_type in GEOJSON_SOURCES.items():
        registry = rel_path in REGISTRY_SOURCES
        if rel_path == TRANSIT_SOURCE:
            records, transit_meta = load_transit(REPO_ROOT / rel_path, load_centroids())
        else:
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
                "statewide transit stops (CDOT + agency GTFS; OpenStreetMap-only as a flagged fallback); "
                "HIFLD/CDPHE hospitals; CDHS licensed child care facilities"
            ),
            "sources_detail": sources_used,
            "note": (
                f"Includes {', '.join(amenity_types)}. "
                "Refresh sources with scripts/amenities/build_osm_amenities.py, "
                "scripts/market/build_transit_stops_co.py, "
                "scripts/market/fetch_hospitals.py and scripts/market/fetch_childcare.py, "
                "then rerun this script."
            ),
            "record_count": len(deduped),
            "amenity_types": amenity_types,
            "transit": transit_meta,
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
