#!/usr/bin/env python3
"""
scripts/market/fetch_fema_nfhl.py

Fetch FEMA National Flood Hazard Layer (NFHL) tract-level summary for Colorado.

Strategy:
  1. Try the FEMA NFHL ArcGIS REST service using Colorado bounding-box queries,
     aggregating flood zone types per census tract.
  2. If NFHL direct query is too slow or fails, fall back to computing tract-level
     flood stats from the existing flood_zones_co.geojson file.

Output:
    data/market/flood_zones_co.json   (tract-level flood zone summary)

The existing flood_zones_co.geojson (polygon data) remains untouched.

Usage:
    python3 scripts/market/fetch_fema_nfhl.py
"""

import json
import os
import sys
import time
import hashlib
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "flood_zones_co.json"
GEOJSON_FILE = ROOT / "data" / "market" / "flood_zones_co.geojson"
TRACTS_FILE = ROOT / "data" / "market" / "tract_centroids_co.json"

STATE_FIPS = "08"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_flood_cache"
CACHE_TTL_HOURS = 720  # 30 days

# FEMA NFHL ArcGIS REST service — Flood Hazard Zones layer (layer 28)
FEMA_NFHL_URL = (
    "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28"
)

# Colorado bounding box (WGS 84)
CO_BBOX = {
    "minLon": -109.06,
    "minLat": 36.99,
    "maxLon": -102.04,
    "maxLat": 41.00,
}

# High-risk flood zones (Special Flood Hazard Areas)
SFHA_ZONES = {"A", "AE", "AH", "AO", "AR", "A99", "V", "VE"}
# Moderate-risk zones
MODERATE_ZONES = {"X", "D", "B"}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)


def _cache_key(url: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.md5(url.encode()).hexdigest()
    return CACHE_DIR / key


def fetch_url(url: str, retries: int = 3, timeout: int = 120) -> bytes:
    """Fetch URL with caching and retries."""
    cache_file = _cache_key(url)
    if cache_file.exists():
        age_hours = (time.time() - cache_file.stat().st_mtime) / 3600
        if age_hours < CACHE_TTL_HOURS:
            log(f"[cache hit] {url[:80]}")
            return cache_file.read_bytes()

    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(
                url, headers={"User-Agent": "HousingAnalytics/1.0"}
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
            cache_file.write_bytes(data)
            return data
        except Exception as exc:
            last_err = exc
            if attempt < retries - 1:
                wait = 5 * (2 ** attempt)
                log(f"[retry {attempt+1}/{retries-1}] {exc} -- waiting {wait}s", level="WARN")
                time.sleep(wait)
    raise RuntimeError(f"Failed after {retries} attempts: {last_err}")


def classify_zone(zone_code: str) -> str:
    """Classify a FEMA flood zone code into risk category."""
    z = (zone_code or "").strip().upper()
    if z in SFHA_ZONES or z.startswith("A") or z.startswith("V"):
        return "high"
    if z in MODERATE_ZONES:
        return "moderate"
    return "low"


def flood_risk_score(zones: dict) -> int:
    """Compute a 0-100 flood risk score from zone presence flags.
    0 = highest flood risk (worst), 100 = no flood risk (best).
    """
    if zones.get("hasFloodZoneA") or zones.get("hasFloodZoneAE") or zones.get("hasFloodZoneV") or zones.get("hasFloodZoneVE"):
        return 15
    if zones.get("hasFloodZoneAH") or zones.get("hasFloodZoneAO"):
        return 30
    if zones.get("hasFloodZoneX"):
        return 85
    if zones.get("hasFloodZoneD"):
        return 60
    return 95  # No flood zone overlap found


# ---------- Strategy 1: Direct FEMA NFHL query by bbox tile ----------

def query_nfhl_tile(min_lon, min_lat, max_lon, max_lat, offset=0, limit=2000) -> dict:
    """Query NFHL for flood hazard features in a bounding box tile."""
    params = urllib.parse.urlencode({
        "where": "1=1",
        "geometry": f"{min_lon},{min_lat},{max_lon},{max_lat}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "FLD_ZONE,ZONE_SUBTY,DFIRM_ID",
        "returnGeometry": "true",
        "geometryPrecision": "4",
        "f": "geojson",
        "resultRecordCount": str(limit),
        "resultOffset": str(offset),
    })
    url = f"{FEMA_NFHL_URL}/query?{params}"
    raw = fetch_url(url, timeout=180)
    data = json.loads(raw)
    if isinstance(data, dict) and "error" in data:
        err = data["error"]
        raise RuntimeError(f"ArcGIS error {err.get('code')}: {err.get('message')}")
    return data


def point_in_bbox(lat, lon, min_lat, min_lon, max_lat, max_lon) -> bool:
    return min_lat <= lat <= max_lat and min_lon <= lon <= max_lon


def build_tract_flood_from_nfhl(tract_centroids: dict) -> dict:
    """
    Query FEMA NFHL in tiles across Colorado, then for each tract centroid
    determine which flood zones are nearby.

    This is a simplified approach: we check if any flood feature bbox
    overlaps a tract centroid's approximate area.
    """
    log("Attempting direct FEMA NFHL query (bbox approach)...")

    # Test connectivity first
    test_params = urllib.parse.urlencode({
        "where": "1=1",
        "geometry": "-105.5,39.5,-105.0,40.0",
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "FLD_ZONE",
        "returnCountOnly": "true",
        "f": "json",
    })
    test_url = f"{FEMA_NFHL_URL}/query?{test_params}"

    try:
        raw = fetch_url(test_url, retries=2, timeout=60)
        test_data = json.loads(raw)
        count = test_data.get("count", 0)
        log(f"NFHL connectivity test: {count} features in Denver-area tile")
        if count == 0:
            raise RuntimeError("No features returned from NFHL test query")
    except Exception as exc:
        log(f"NFHL direct query not available: {exc}", level="WARN")
        raise

    # Divide Colorado into tiles (0.5 degree grid)
    tiles = []
    lon_step = 0.5
    lat_step = 0.5
    lon = CO_BBOX["minLon"]
    while lon < CO_BBOX["maxLon"]:
        lat = CO_BBOX["minLat"]
        while lat < CO_BBOX["maxLat"]:
            tiles.append((lon, lat, min(lon + lon_step, CO_BBOX["maxLon"]),
                          min(lat + lat_step, CO_BBOX["maxLat"])))
            lat += lat_step
        lon += lon_step

    log(f"Querying {len(tiles)} tiles across Colorado...")

    # For each tile, collect flood zone features
    # Map centroid coords to tract GEOIDs within each tile
    tract_results = {}
    tiles_processed = 0
    tiles_with_data = 0

    for tile_lon_min, tile_lat_min, tile_lon_max, tile_lat_max in tiles:
        tiles_processed += 1

        # Find tracts whose centroids fall in this tile
        tile_tracts = []
        for geoid, info in tract_centroids.items():
            clat = info.get("lat", 0)
            clon = info.get("lon", 0)
            if point_in_bbox(clat, clon, tile_lat_min, tile_lon_min, tile_lat_max, tile_lon_max):
                tile_tracts.append((geoid, clat, clon))

        if not tile_tracts:
            continue

        # Query NFHL for this tile
        try:
            all_features = []
            offset = 0
            while True:
                data = query_nfhl_tile(tile_lon_min, tile_lat_min, tile_lon_max, tile_lat_max,
                                       offset=offset)
                feats = data.get("features", [])
                all_features.extend(feats)
                if not feats or not data.get("exceededTransferLimit"):
                    break
                offset += len(feats)
                time.sleep(0.3)

            if all_features:
                tiles_with_data += 1

            # Collect zone types present in this tile
            zone_types = set()
            for f in all_features:
                props = f.get("properties") or {}
                zone = (props.get("FLD_ZONE") or "").strip().upper()
                if zone:
                    zone_types.add(zone)

            # Assign zone presence to each tract in this tile
            # (simplified: all tracts in a tile share the tile's zone set)
            for geoid, _, _ in tile_tracts:
                if geoid not in tract_results:
                    tract_results[geoid] = set()
                tract_results[geoid].update(zone_types)

        except Exception as exc:
            log(f"Tile ({tile_lon_min},{tile_lat_min}) failed: {exc}", level="WARN")
            continue

        if tiles_processed % 20 == 0:
            log(f"  Progress: {tiles_processed}/{len(tiles)} tiles, {tiles_with_data} with data")
        time.sleep(0.2)  # Be polite to FEMA servers

    log(f"NFHL query complete: {tiles_processed} tiles, {len(tract_results)} tracts with data")
    return tract_results


# ---------- Strategy 2: Derive from existing GeoJSON file ----------

def build_tract_flood_from_geojson(tract_centroids: dict) -> dict:
    """
    Parse the existing flood_zones_co.geojson and derive tract-level
    flood zone presence by checking feature centroids against tract centroids.
    """
    log("Deriving tract flood data from existing flood_zones_co.geojson...")

    if not GEOJSON_FILE.exists():
        log("No flood_zones_co.geojson found", level="WARN")
        return {}

    with open(GEOJSON_FILE, "r") as fh:
        geo = json.load(fh)

    features = geo.get("features", [])
    if not features:
        log("flood_zones_co.geojson has 0 features", level="WARN")
        return {}

    log(f"Processing {len(features)} flood zone features...")

    # Build a simple spatial index: for each feature, get its centroid
    # and the zone type, then find the nearest tract(s)
    from collections import defaultdict
    tract_zones = defaultdict(set)

    # Build a quick lookup of tract centroids
    tract_list = [(geoid, info["lat"], info["lon"]) for geoid, info in tract_centroids.items()]

    for i, feat in enumerate(features):
        props = feat.get("properties") or {}
        zone = (props.get("FLD_ZONE") or props.get("zone") or "").strip().upper()
        if not zone:
            continue

        # Get feature centroid
        geom = feat.get("geometry")
        if not geom:
            continue

        try:
            coords = geom.get("coordinates", [])
            gtype = geom.get("type", "")
            if gtype == "Point":
                flon, flat = coords[0], coords[1]
            elif gtype in ("Polygon",):
                # Use first coordinate of outer ring as approximate centroid
                ring = coords[0] if coords else []
                if ring:
                    flon = sum(c[0] for c in ring) / len(ring)
                    flat = sum(c[1] for c in ring) / len(ring)
                else:
                    continue
            elif gtype in ("MultiPolygon",):
                # Use first polygon's first ring
                if coords and coords[0] and coords[0][0]:
                    ring = coords[0][0]
                    flon = sum(c[0] for c in ring) / len(ring)
                    flat = sum(c[1] for c in ring) / len(ring)
                else:
                    continue
            else:
                continue
        except (IndexError, TypeError, ZeroDivisionError):
            continue

        # Find nearest tract centroid (brute force but workable)
        best_geoid = None
        best_dist = float("inf")
        for geoid, tlat, tlon in tract_list:
            d = (flat - tlat) ** 2 + (flon - tlon) ** 2
            if d < best_dist:
                best_dist = d
                best_geoid = geoid

        if best_geoid and best_dist < 0.01:  # ~1km threshold
            tract_zones[best_geoid].add(zone)

        if (i + 1) % 5000 == 0:
            log(f"  Processed {i+1}/{len(features)} features...")

    log(f"Derived flood zones for {len(tract_zones)} tracts from GeoJSON")
    return dict(tract_zones)


# ---------- Load tract centroids ----------

def load_tract_centroids() -> dict:
    """Load tract centroids from tract_centroids_co.json or ACS data."""
    result = {}

    # Try tract_centroids_co.json first
    if TRACTS_FILE.exists():
        log(f"Loading tract centroids from {TRACTS_FILE.name}...")
        with open(TRACTS_FILE, "r") as fh:
            data = json.load(fh)

        # Handle different formats
        if isinstance(data, dict):
            if "tracts" in data and isinstance(data["tracts"], list):
                for t in data["tracts"]:
                    geoid = t.get("geoid") or t.get("GEOID") or t.get("tractId") or ""
                    lat = float(t.get("lat") or t.get("latitude") or t.get("INTPTLAT") or 0)
                    lon = float(t.get("lon") or t.get("lng") or t.get("longitude") or t.get("INTPTLON") or 0)
                    if geoid and lat and lon:
                        result[geoid] = {"lat": lat, "lon": lon}
            elif "tracts" in data and isinstance(data["tracts"], dict):
                for geoid, info in data["tracts"].items():
                    lat = float(info.get("lat") or info.get("latitude") or 0)
                    lon = float(info.get("lon") or info.get("lng") or info.get("longitude") or 0)
                    if lat and lon:
                        result[geoid] = {"lat": lat, "lon": lon}
            else:
                # Might be a flat dict of geoid -> {lat, lon}
                for geoid, info in data.items():
                    if isinstance(info, dict):
                        lat = float(info.get("lat") or info.get("latitude") or 0)
                        lon = float(info.get("lon") or info.get("lng") or 0)
                        if lat and lon:
                            result[geoid] = {"lat": lat, "lon": lon}
        elif isinstance(data, list):
            for t in data:
                geoid = t.get("geoid") or t.get("GEOID") or ""
                lat = float(t.get("lat") or t.get("latitude") or 0)
                lon = float(t.get("lon") or t.get("lng") or 0)
                if geoid and lat and lon:
                    result[geoid] = {"lat": lat, "lon": lon}

    # Try to extract from tract_boundaries_co.geojson as fallback
    if not result:
        boundaries_file = ROOT / "data" / "market" / "tract_boundaries_co.geojson"
        if boundaries_file.exists():
            log("Falling back to tract_boundaries_co.geojson for centroids...")
            with open(boundaries_file, "r") as fh:
                geo = json.load(fh)
            for feat in geo.get("features", []):
                props = feat.get("properties") or {}
                geoid = props.get("GEOID") or props.get("geoid") or ""
                lat = float(props.get("INTPTLAT") or props.get("lat") or 0)
                lon = float(props.get("INTPTLON") or props.get("lon") or 0)
                if not (lat and lon):
                    # Try computing centroid from geometry
                    geom = feat.get("geometry")
                    if geom and geom.get("type") == "Polygon" and geom.get("coordinates"):
                        ring = geom["coordinates"][0]
                        if ring:
                            lat = sum(c[1] for c in ring) / len(ring)
                            lon = sum(c[0] for c in ring) / len(ring)
                if geoid and lat and lon:
                    result[geoid] = {"lat": lat, "lon": lon}

    log(f"Loaded {len(result)} tract centroids")
    return result


# ---------- Main ----------

def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    generated = utc_now()

    # Load tract centroids
    tract_centroids = load_tract_centroids()
    if not tract_centroids:
        log("No tract centroids available -- generating stub output", level="WARN")
        result = {
            "meta": {
                "source": "FEMA NFHL",
                "fetched": generated,
                "tracts": 0,
                "note": "No tract centroids available; stub output"
            },
            "tracts": {}
        }
        with open(OUT_FILE, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=2, ensure_ascii=False)
        log(f"Wrote stub to {OUT_FILE}")
        return 0

    # Strategy 1: Try direct FEMA NFHL query
    tract_zone_sets = {}
    try:
        tract_zone_sets = build_tract_flood_from_nfhl(tract_centroids)
    except Exception as exc:
        log(f"NFHL direct query failed: {exc}", level="WARN")

    # Strategy 2: Fall back to GeoJSON parsing
    if len(tract_zone_sets) < len(tract_centroids) * 0.1:
        log("Falling back to GeoJSON-based derivation...")
        geojson_zones = build_tract_flood_from_geojson(tract_centroids)
        # Merge: geojson results fill in gaps
        for geoid, zones in geojson_zones.items():
            if geoid not in tract_zone_sets:
                tract_zone_sets[geoid] = zones
            else:
                tract_zone_sets[geoid].update(zones)

    # Build output JSON
    tracts_out = {}
    for geoid in tract_centroids:
        zones = tract_zone_sets.get(geoid, set())
        zone_flags = {
            "hasFloodZoneA": any(z == "A" for z in zones),
            "hasFloodZoneAE": any(z == "AE" for z in zones),
            "hasFloodZoneAH": any(z == "AH" for z in zones),
            "hasFloodZoneAO": any(z == "AO" for z in zones),
            "hasFloodZoneV": any(z == "V" for z in zones),
            "hasFloodZoneVE": any(z == "VE" for z in zones),
            "hasFloodZoneX": any(z in ("X", "X500") for z in zones),
            "hasFloodZoneD": any(z == "D" for z in zones),
        }
        zone_flags["hasSFHA"] = any(
            z in SFHA_ZONES or z.startswith("A") or z.startswith("V")
            for z in zones
        )
        zone_flags["floodRiskScore"] = flood_risk_score(zone_flags)
        zone_flags["zones"] = sorted(zones) if zones else []
        tracts_out[geoid] = zone_flags

    sfha_count = sum(1 for t in tracts_out.values() if t.get("hasSFHA"))

    result = {
        "meta": {
            "source": "FEMA NFHL",
            "fetched": generated,
            "tracts": len(tracts_out),
            "sfha_tracts": sfha_count,
            "note": "Tract-level flood zone summary for Colorado. "
                    "floodRiskScore: 0=highest risk, 100=lowest risk."
        },
        "tracts": tracts_out
    }

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    log(f"Wrote {len(tracts_out)} tracts ({sfha_count} with SFHA) to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
