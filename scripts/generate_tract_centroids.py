#!/usr/bin/env python3
"""
scripts/generate_tract_centroids.py

Generate a census-tract centroid file for Colorado.

Data source: US Census TIGERweb ArcGIS REST service (public, no key required).
Output:      data/tract-centroids.json  (Phase 3 spec format)
Also writes: data/market/tract_centroids_co.json  (internal format used by PMA engine)

Usage:
    python scripts/generate_tract_centroids.py

Environment variables:
    CENSUS_API_KEY  - optional; improves rate limits for ancillary Census API calls
    FORCE_REBUILD   - set to "1" to ignore cached intermediate files
"""

import json
import os
import sys
import time
import hashlib
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

ROOT    = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data"
MKT_DIR = OUT_DIR / "market"

STATE_FIPS = "08"
SCRIPT_VER = "1.0"

# Colorado bounding box (approximate)
CO_LAT_MIN, CO_LAT_MAX = 36.9, 41.1
CO_LON_MIN, CO_LON_MAX = -109.1, -101.9

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "tract_centroids_cache"
CACHE_TTL_HOURS = 48
FORCE_REBUILD = os.environ.get("FORCE_REBUILD", "") == "1"

TIGERWEB_TRACTS_URL = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb"
    "/Tracts_Blocks/MapServer/0/query"
)

# ── HTTP helper ────────────────────────────────────────────────────────────────

def fetch_url(url: str, retries: int = 3, timeout: int = 90) -> bytes:
    """Fetch URL with retry/backoff and local disk cache."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_key = hashlib.md5(url.encode()).hexdigest()
    cache_file = CACHE_DIR / cache_key

    if not FORCE_REBUILD and cache_file.exists():
        age_hours = (time.time() - cache_file.stat().st_mtime) / 3600
        if age_hours < CACHE_TTL_HOURS:
            return cache_file.read_bytes()

    last_err: Optional[Exception] = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": f"tract-centroids/{SCRIPT_VER}"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
            cache_file.write_bytes(data)
            return data
        except Exception as exc:
            last_err = exc
            if attempt < retries - 1:
                wait = 2 ** attempt
                print(f"  [retry {attempt + 1}] {exc!r} — waiting {wait}s", flush=True)
                time.sleep(wait)
    raise RuntimeError(f"Failed to fetch {url[:100]} after {retries} retries") from last_err


# ── TIGERweb pagination ────────────────────────────────────────────────────────

def fetch_tigerweb_page(result_offset: int, result_record_count: int = 1000) -> dict:
    """Fetch one page of Colorado census tract features from TIGERweb."""
    import urllib.parse

    params = urllib.parse.urlencode({
        "where":          f"STATEFP='{STATE_FIPS}'",
        "outFields":      "GEOID,NAMELSAD,COUNTYFP,ALAND,AWATER",
        "returnGeometry": "true",
        "outSR":          "4326",
        "geometryType":   "esriGeometryPolygon",
        "f":              "json",
        "resultOffset":   result_offset,
        "resultRecordCount": result_record_count,
    })
    url = f"{TIGERWEB_TRACTS_URL}?{params}"
    raw = fetch_url(url)
    return json.loads(raw)


def fetch_all_co_tracts() -> list:
    """Paginate TIGERweb until all Colorado census tracts are retrieved."""
    all_features: list = []
    offset = 0
    page_size = 1000
    max_pages = 10  # safety limit (~3,048 tracts / 1,000 = 4 pages needed)

    for page in range(max_pages):
        print(f"  Fetching page {page + 1} (offset={offset})…", flush=True)
        result = fetch_tigerweb_page(offset, page_size)
        features = result.get("features", [])
        if not features:
            break
        all_features.extend(features)
        print(f"  → {len(features)} features (total so far: {len(all_features)})", flush=True)

        exceeded = result.get("exceededTransferLimit", False)
        if not exceeded:
            break
        offset += page_size

    return all_features


# ── Centroid calculation ───────────────────────────────────────────────────────

def compute_centroid(geometry: dict) -> Optional[tuple]:
    """
    Compute approximate centroid of an esriGeometryPolygon.
    Uses simple bounding-box centroid for speed; sufficient for mapping use.
    Returns (lat, lon) or None on error.
    """
    try:
        geo_type = geometry.get("type") or geometry.get("geometryType") or ""
        rings = (
            geometry.get("rings")           # esri JSON: list of rings
            or geometry.get("coordinates")  # GeoJSON: list of rings or coords
        )
        if not rings:
            return None

        all_x: list = []
        all_y: list = []

        # Flatten rings (esri) or coordinates (GeoJSON Polygon/MultiPolygon)
        if isinstance(rings[0][0], (int, float)):
            # Flat coordinate list [x, y, ...]
            for i in range(0, len(rings[0]), 2):
                all_x.append(rings[0][i])
                all_y.append(rings[0][i + 1])
        elif isinstance(rings[0][0], (list, tuple)):
            for ring in rings:
                for coord in ring:
                    all_x.append(coord[0])
                    all_y.append(coord[1])

        if not all_x:
            return None

        lon = (min(all_x) + max(all_x)) / 2
        lat = (min(all_y) + max(all_y)) / 2
        return (lat, lon)
    except Exception:
        return None


def sqm_to_sqmiles(sqm: float) -> float:
    """Convert square metres to square miles."""
    return sqm / 2_589_988.0


# ── Validation ────────────────────────────────────────────────────────────────

def validate_tract(tract: dict) -> list:
    """Return list of validation error strings (empty = valid)."""
    errors: list = []
    geoid = tract.get("geoid", "")
    if not geoid or len(geoid) != 11 or not geoid.isdigit():
        errors.append(f"Invalid GEOID '{geoid}' (expected 11-digit FIPS)")

    lat = tract.get("lat")
    lon = tract.get("lon")
    if lat is None or not (CO_LAT_MIN <= lat <= CO_LAT_MAX):
        errors.append(f"Latitude {lat} outside Colorado bounds [{CO_LAT_MIN}, {CO_LAT_MAX}]")
    if lon is None or not (CO_LON_MIN <= lon <= CO_LON_MAX):
        errors.append(f"Longitude {lon} outside Colorado bounds [{CO_LON_MIN}, {CO_LON_MAX}]")

    return errors


# ── Main build ────────────────────────────────────────────────────────────────

def build() -> int:
    """Build tract centroid files.  Returns exit code (0 = success)."""
    print("=" * 60)
    print("generate_tract_centroids.py — Phase 3")
    print("=" * 60)

    print("\n1. Fetching Colorado census tracts from TIGERweb…")
    features = fetch_all_co_tracts()
    if not features:
        print("ERROR: No features returned from TIGERweb.", file=sys.stderr)
        return 1
    print(f"   Total features fetched: {len(features)}")

    print("\n2. Computing centroids…")
    tracts_phase3: list = []   # Phase 3 format (data/tract-centroids.json)
    tracts_market: list = []   # PMA engine format (data/market/tract_centroids_co.json)
    errors_total  = 0
    skipped       = 0
    seen_geoids: set = set()

    for feat in features:
        attrs = feat.get("attributes", {})
        geom  = feat.get("geometry")

        geoid = str(attrs.get("GEOID", "")).strip().zfill(11)
        name  = str(attrs.get("NAMELSAD", "")).strip()
        county_fips = STATE_FIPS + str(attrs.get("COUNTYFP", "")).strip().zfill(3)
        aland  = attrs.get("ALAND",  0) or 0
        awater = attrs.get("AWATER", 0) or 0
        area_sqm = (aland + awater)

        if geoid in seen_geoids:
            skipped += 1
            continue
        seen_geoids.add(geoid)

        centroid = compute_centroid(geom) if geom else None
        if centroid is None:
            print(f"  WARN: Could not compute centroid for {geoid} ({name})", flush=True)
            skipped += 1
            continue

        lat, lon = centroid

        tract_p3 = {
            "geoid":         geoid,
            "county_geoid":  county_fips,
            "name":          name,
            "lat":           round(lat, 4),
            "lon":           round(lon, 4),
            "area_sqmiles":  round(sqm_to_sqmiles(area_sqm), 2),
        }
        tract_mkt = {
            "geoid":        geoid,
            "lat":          round(lat, 4),
            "lon":          round(lon, 4),
            "county_fips":  county_fips,
            "county_name":  county_fips,  # updated below if possible
        }

        errs = validate_tract(tract_p3)
        if errs:
            for e in errs:
                print(f"  WARN [{geoid}]: {e}", flush=True)
            errors_total += len(errs)
        else:
            tracts_phase3.append(tract_p3)
            tracts_market.append(tract_mkt)

    print(f"   Valid tracts:   {len(tracts_phase3)}")
    print(f"   Skipped:        {skipped}")
    print(f"   Validation errs:{errors_total}")

    # Sort by GEOID for deterministic output
    tracts_phase3.sort(key=lambda t: t["geoid"])
    tracts_market.sort(key=lambda t: t["geoid"])

    generated_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # ── Phase 3 output format (data/tract-centroids.json) ──────────────────
    print("\n3. Writing data/tract-centroids.json…")
    out_p3 = {
        "meta": {
            "generated": generated_ts,
            "count":     len(tracts_phase3),
            "source":    "US Census TIGERweb ArcGIS REST (public) — generate_tract_centroids.py",
            "state":     "Colorado",
            "state_fips": STATE_FIPS,
        },
        "tracts": tracts_phase3,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "tract-centroids.json").write_text(
        json.dumps(out_p3, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"   Written: {OUT_DIR / 'tract-centroids.json'}  ({len(tracts_phase3)} tracts)")

    # ── PMA engine format (data/market/tract_centroids_co.json) ────────────
    print("\n4. Writing data/market/tract_centroids_co.json…")
    out_mkt = {
        "meta": {
            "source":     "US Census TIGERweb ArcGIS REST (public)",
            "state":      "Colorado",
            "state_fips": STATE_FIPS,
            "generated":  generated_ts,
            "note":       "Rebuild via scripts/generate_tract_centroids.py",
        },
        "tracts": tracts_market,
    }
    MKT_DIR.mkdir(parents=True, exist_ok=True)
    (MKT_DIR / "tract_centroids_co.json").write_text(
        json.dumps(out_mkt, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"   Written: {MKT_DIR / 'tract_centroids_co.json'}  ({len(tracts_market)} tracts)")

    print("\n5. Checking for duplicate GEOIDs…")
    all_geoids = [t["geoid"] for t in tracts_phase3]
    unique_geoids = set(all_geoids)
    if len(all_geoids) != len(unique_geoids):
        dups = len(all_geoids) - len(unique_geoids)
        print(f"  ERROR: {dups} duplicate GEOID(s) found!", file=sys.stderr)
        return 1
    print(f"   ✅ No duplicates ({len(unique_geoids)} unique GEOIDs)")

    print(f"\n✅ Done.  {len(tracts_phase3)} tract centroids written.")
    return 0


if __name__ == "__main__":
    sys.exit(build())
