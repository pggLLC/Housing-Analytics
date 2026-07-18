#!/usr/bin/env python3
"""
scripts/market/fetch_natural_barriers.py

Fetch Colorado natural barrier data for PMA boundary delineation:
  1. CDOT Highway Segments (Interstates + US Routes) — barrier to pedestrian access
  2. TIGERweb Areal Hydrography (major lakes/reservoirs) — water body barriers
  3. TIGERweb Linear Hydrography (named rivers) — linear water barriers

Output:
    data/market/natural_barriers_co.geojson

Usage:
    python3 scripts/market/fetch_natural_barriers.py

All sources are free and publicly accessible without authentication.
"""

import json
import os
import sys
import time
import hashlib
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "natural_barriers_co.geojson"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_barriers_cache"
CACHE_TTL_HOURS = 720  # 30 days

# CDOT Highway Segments — public ArcGIS MapServer
CDOT_URL = (
    "https://dtdapps.coloradodot.info/arcgis/rest/services/"
    "CPLAN/HighwaySegments/MapServer/2"
)

# TIGERweb Areal Hydrography — Census public MapServer
TIGER_HYDRO_URL = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/"
    "TIGERweb/Hydro/MapServer/1"
)

TIGER_LINEAR_HYDRO_URL = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/"
    "TIGERweb/Hydro/MapServer/0"
)

CO_BBOX = "-109.05,36.99,-102.04,41.00"
CDOT_ROUTE_SIGNS = {
    "I": "I",
    # CDOT's current service stores U.S. highways as "U.S."; normalize to
    # "U" in the committed artifact so downstream guards can assert I/U
    # route-sign diversity independent of the service's display spelling.
    "U.S.": "U",
}
RIVER_WHERE = "SUFTYPEABRV='Riv'"
MIN_PRIOR_HIGHWAY_FEATURES = 10084
MIN_PRIOR_AREAL_WATER_FEATURES = 1091
SHRINK_GUARD_TOLERANCE = 0.05


def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg, level="INFO"):
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)


def _cache_key(url):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / hashlib.md5(url.encode()).hexdigest()


def fetch_url(url, retries=3, timeout=90):
    cache_file = _cache_key(url)
    if cache_file.exists():
        age = (time.time() - cache_file.stat().st_mtime) / 3600
        if age < CACHE_TTL_HOURS:
            log(f"[cache hit] {url[:80]}")
            return cache_file.read_bytes()
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "HousingAnalytics/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
            cache_file.write_bytes(data)
            return data
        except Exception as exc:
            last_err = exc
            if attempt < retries - 1:
                wait = 5 * (2 ** attempt)
                log(f"[retry {attempt+1}/{retries-1}] {exc} — waiting {wait}s", level="WARN")
                time.sleep(wait)
    raise RuntimeError(f"Failed after {retries} attempts: {last_err}")


def fetch_cdot_highways():
    """Fetch interstate and US route highway segments from CDOT."""
    log("Fetching CDOT highway segments (I + U routes)…")
    all_features = []
    for query_sign, output_sign in CDOT_ROUTE_SIGNS.items():
        offset = 0
        while True:
            params = urllib.parse.urlencode({
                "where": f"ROUTESIGN='{query_sign}'",
                "outFields": "ROUTE,ROUTESIGN,FUNCCLASS,COUNTY,FIPSCOUNTY,AADT,SPEEDLIM,DESCRIPTION",
                "returnGeometry": "true",
                "f": "geojson",
                "outSR": "4326",
                "resultRecordCount": "2000",
                "resultOffset": str(offset),
                "geometryPrecision": "4",
            })
            url = f"{CDOT_URL}/query?{params}"
            data = json.loads(fetch_url(url))
            if "error" in data:
                raise RuntimeError(data["error"].get("message", ""))
            feats = data.get("features", [])
            for feat in feats:
                props = feat.setdefault("properties", {})
                props["_NORMALIZED_ROUTESIGN"] = output_sign
                props["_SOURCE_ROUTESIGN"] = query_sign
            all_features.extend(feats)
            if not feats or not data.get("exceededTransferLimit"):
                break
            offset += len(feats)
            time.sleep(0.3)
        log(f"  CDOT {output_sign} routes: {sum(1 for f in all_features if (f.get('properties') or {}).get('_NORMALIZED_ROUTESIGN') == output_sign)}")

    # Normalize to common schema
    features = []
    for f in all_features:
        p = f.get("properties") or {}
        route = p.get("ROUTE", "")
        sign = p.get("_NORMALIZED_ROUTESIGN") or p.get("ROUTESIGN", "")
        desc = p.get("DESCRIPTION", "")
        name = f"{sign}-{route}" if sign and route else desc
        features.append({
            "type": "Feature",
            "geometry": f.get("geometry"),
            "properties": {
                "name": name,
                "barrier_type": "highway",
                "sub_type": "interstate" if sign == "I" else "us_route",
                "route": route,
                "route_sign": sign,
                "source_route_sign": p.get("_SOURCE_ROUTESIGN") or p.get("ROUTESIGN", ""),
                "county_fips": str(p.get("FIPSCOUNTY", "")),
                "aadt": int(p.get("AADT") or 0),
                "speed_limit": int(p.get("SPEEDLIM") or 0),
                "source": "CDOT",
            },
        })
    return features


def fetch_tiger_rivers():
    """Fetch named linear river features from TIGERweb linear hydrography."""
    log("Fetching TIGERweb linear hydrography (named rivers)…")
    all_features = []

    tiles = []
    lon = -109.05
    while lon < -102.04:
        lat = 36.99
        while lat < 41.00:
            tiles.append(f"{lon},{lat},{min(lon+2.0, -102.04)},{min(lat+2.0, 41.00)}")
            lat += 2.0
        lon += 2.0

    for ti, bbox in enumerate(tiles, 1):
        offset = 0
        tile_count = 0
        while True:
            params = urllib.parse.urlencode({
                "where": RIVER_WHERE,
                "geometry": bbox,
                "geometryType": "esriGeometryEnvelope",
                "inSR": "4326",
                "spatialRel": "esriSpatialRelIntersects",
                "outFields": "NAME,MTFCC,BASENAME,SUFTYPEABRV,OID",
                "returnGeometry": "true",
                "f": "geojson",
                "outSR": "4326",
                "resultRecordCount": "2000",
                "resultOffset": str(offset),
                "geometryPrecision": "4",
            })
            url = f"{TIGER_LINEAR_HYDRO_URL}/query?{params}"
            data = json.loads(fetch_url(url, timeout=120))
            if "error" in data:
                raise RuntimeError(data["error"].get("message", ""))
            feats = data.get("features", [])
            all_features.extend(feats)
            tile_count += len(feats)
            if not feats or not data.get("exceededTransferLimit"):
                break
            offset += len(feats)
            time.sleep(0.3)
        if tile_count:
            log(f"  Tile {ti}/{len(tiles)}: {tile_count} named river features")
        time.sleep(0.2)

    seen = set()
    features = []
    for f in all_features:
        p = f.get("properties") or {}
        name = p.get("NAME") or p.get("BASENAME") or ""
        oid = p.get("OID") or ""
        geom = f.get("geometry") or {}
        key = f"{oid}_{name}_{json.dumps(geom.get('coordinates', []), separators=(',', ':'))[:120]}"
        if key in seen:
            continue
        seen.add(key)
        features.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {
                "name": name or "Unnamed river",
                "barrier_type": "water",
                "sub_type": "river",
                "linear_id": oid,
                "mtfcc": p.get("MTFCC") or "",
                "source": "TIGERweb Linear Hydrography",
            },
        })

    log(f"  Total named river line features: {len(features)}")
    return features


def fetch_tiger_water():
    """Fetch major water bodies from TIGERweb areal hydrography using tiled bbox."""
    log("Fetching TIGERweb areal hydrography (major water bodies)…")
    all_features = []

    # Split Colorado into tiles to avoid server limits
    tiles = []
    lon = -109.05
    while lon < -102.04:
        lat = 36.99
        while lat < 41.00:
            tiles.append(f"{lon},{lat},{min(lon+2.0, -102.04)},{min(lat+2.0, 41.00)}")
            lat += 2.0
        lon += 2.0

    for ti, bbox in enumerate(tiles, 1):
        offset = 0
        tile_count = 0
        while True:
            params = urllib.parse.urlencode({
                "where": "1=1",
                "geometry": bbox,
                "geometryType": "esriGeometryEnvelope",
                "inSR": "4326",
                "spatialRel": "esriSpatialRelIntersects",
                "outFields": "NAME,MTFCC,BASENAME,AREAWATER",
                "returnGeometry": "true",
                "f": "geojson",
                "outSR": "4326",
                "resultRecordCount": "1000",
                "resultOffset": str(offset),
                "geometryPrecision": "4",
            })
            url = f"{TIGER_HYDRO_URL}/query?{params}"
            try:
                data = json.loads(fetch_url(url, timeout=120))
                if "error" in data:
                    raise RuntimeError(data["error"].get("message", ""))
                feats = data.get("features", [])
                # Filter to significant water bodies (area > 100,000 sq meters)
                sig = [f for f in feats if int((f.get("properties") or {}).get("AREAWATER", 0) or 0) > 100000]
                all_features.extend(sig)
                tile_count += len(sig)
                if not feats or not data.get("exceededTransferLimit"):
                    break
                offset += len(feats)
                time.sleep(0.3)
            except Exception as exc:
                log(f"  Tile {ti}/{len(tiles)} failed: {exc}", level="WARN")
                break
        if tile_count:
            log(f"  Tile {ti}/{len(tiles)}: {tile_count} significant water features")
        time.sleep(0.2)

    # Deduplicate by name + area
    seen = set()
    features = []
    for f in all_features:
        p = f.get("properties") or {}
        name = p.get("NAME") or p.get("BASENAME") or ""
        area = int(p.get("AREAWATER", 0) or 0)
        key = f"{name}_{area}"
        if key in seen:
            continue
        seen.add(key)
        features.append({
            "type": "Feature",
            "geometry": f.get("geometry"),
            "properties": {
                "name": name or "Unnamed water body",
                "barrier_type": "water",
                "sub_type": "lake" if p.get("MTFCC", "").startswith("H2") else "water",
                "area_sqm": area,
                "source": "TIGERweb",
            },
        })

    log(f"  Total significant water bodies: {len(features)}")
    return features


def validate_features(highways, areal_water, rivers):
    by_sign = {}
    for feature in highways:
        sign = (feature.get("properties") or {}).get("route_sign")
        by_sign[sign] = by_sign.get(sign, 0) + 1
    if by_sign.get("I", 0) <= 0 or by_sign.get("U", 0) <= 0:
        raise RuntimeError(f"CDOT highway fetch is partial: expected I and U route signs, got {by_sign}")

    line_rivers = [
        f for f in rivers
        if (f.get("geometry") or {}).get("type") in ("LineString", "MultiLineString")
    ]
    if not line_rivers:
        raise RuntimeError("TIGER linear hydrography fetch is partial: zero river LineStrings")

    min_highways = int(MIN_PRIOR_HIGHWAY_FEATURES * (1 - SHRINK_GUARD_TOLERANCE))
    min_areal = int(MIN_PRIOR_AREAL_WATER_FEATURES * (1 - SHRINK_GUARD_TOLERANCE))
    if len(highways) < min_highways:
        raise RuntimeError(f"CDOT highway feature count shrank below guard: {len(highways)} < {min_highways}")
    if len(areal_water) < min_areal:
        raise RuntimeError(f"TIGER areal-water feature count shrank below guard: {len(areal_water)} < {min_areal}")


def main():
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    generated = utc_now()

    highways = fetch_cdot_highways()
    areal_water = fetch_tiger_water()
    rivers = fetch_tiger_rivers()
    validate_features(highways, areal_water, rivers)
    water = areal_water + rivers
    features = highways + water

    log(f"Total barrier features: {len(features)} ({len(highways)} highway, {len(areal_water)} areal water, {len(rivers)} river lines)")

    if not features and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text())
        if existing.get("features"):
            log("[fallback] Using existing natural_barriers_co.geojson")
            return 0

    result = {
        "type": "FeatureCollection",
        "meta": {
            "source": "CDOT Highway Segments + Census TIGERweb Hydro",
            "urls": [
                "https://dtdapps.coloradodot.info/arcgis/rest/services/CPLAN/HighwaySegments/MapServer",
                "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Hydro/MapServer"
            ],
            "state": "Colorado",
            "generated": generated,
            "feature_count": len(features),
            "highway_features": len(highways),
            "route_sign_counts": {
                sign: sum(1 for f in highways if (f.get("properties") or {}).get("route_sign") == sign)
                for sign in sorted({(f.get("properties") or {}).get("route_sign") for f in highways})
            },
            "water_features": len(water),
            "areal_water_features": len(areal_water),
            "river_line_features": len(rivers),
            "river_filter": RIVER_WHERE,
            "shrink_guard": {
                "prior_highway_features": MIN_PRIOR_HIGHWAY_FEATURES,
                "prior_areal_water_features": MIN_PRIOR_AREAL_WATER_FEATURES,
                "tolerance": SHRINK_GUARD_TOLERANCE,
            },
            "note": "Rebuild via scripts/market/fetch_natural_barriers.py",
        },
        "features": features,
    }

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, separators=(",", ":"))

    log(f"✓ Wrote {len(features)} barrier features to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
