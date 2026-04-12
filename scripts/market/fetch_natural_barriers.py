#!/usr/bin/env python3
"""
scripts/market/fetch_natural_barriers.py

Fetch Colorado natural barrier data for PMA boundary delineation:
  1. CDOT Highway Segments (Interstates + US Routes) — barrier to pedestrian access
  2. TIGERweb Areal Hydrography (major lakes/reservoirs) — water body barriers

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

CO_BBOX = "-109.05,36.99,-102.04,41.00"


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
    for route_sign in ("I", "U"):
        offset = 0
        while True:
            params = urllib.parse.urlencode({
                "where": f"ROUTESIGN='{route_sign}'",
                "outFields": "ROUTE,ROUTESIGN,FUNCCLASS,COUNTY,FIPSCOUNTY,AADT,SPEEDLIM,DESCRIPTION",
                "returnGeometry": "true",
                "f": "geojson",
                "outSR": "4326",
                "resultRecordCount": "2000",
                "resultOffset": str(offset),
                "geometryPrecision": "4",
            })
            url = f"{CDOT_URL}/query?{params}"
            try:
                data = json.loads(fetch_url(url))
                if "error" in data:
                    raise RuntimeError(data["error"].get("message", ""))
                feats = data.get("features", [])
                all_features.extend(feats)
                if not feats or not data.get("exceededTransferLimit"):
                    break
                offset += len(feats)
                time.sleep(0.3)
            except Exception as exc:
                log(f"  CDOT {route_sign} offset {offset} failed: {exc}", level="WARN")
                break
        log(f"  CDOT {route_sign} routes: {sum(1 for f in all_features if (f.get('properties') or {}).get('ROUTESIGN') == route_sign)}")

    # Normalize to common schema
    features = []
    for f in all_features:
        p = f.get("properties") or {}
        route = p.get("ROUTE", "")
        sign = p.get("ROUTESIGN", "")
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
                "county_fips": str(p.get("FIPSCOUNTY", "")),
                "aadt": int(p.get("AADT") or 0),
                "speed_limit": int(p.get("SPEEDLIM") or 0),
                "source": "CDOT",
            },
        })
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


def main():
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    generated = utc_now()

    highways = fetch_cdot_highways()
    water = fetch_tiger_water()
    features = highways + water

    log(f"Total barrier features: {len(features)} ({len(highways)} highway, {len(water)} water)")

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
            "water_features": len(water),
            "note": "Rebuild via scripts/market/fetch_natural_barriers.py",
        },
        "features": features,
    }

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    log(f"✓ Wrote {len(features)} barrier features to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
