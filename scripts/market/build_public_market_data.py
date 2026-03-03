#!/usr/bin/env python3
"""
scripts/market/build_public_market_data.py

Fetches and assembles public market data artifacts for the PMA scoring engine:
  - data/market/tract_centroids_co.json   (TIGERweb ArcGIS REST)
  - data/market/acs_tract_metrics_co.json  (Census ACS 5-Year API)
  - data/market/hud_lihtc_co.geojson      (HUD LIHTC public dataset)

Usage:
    python scripts/market/build_public_market_data.py

Environment variables (optional):
    CENSUS_API_KEY  - Census Bureau API key (improves rate limits; not required)

All sources are free and publicly accessible without authentication.
"""

import json
import os
import sys
import time
import hashlib
import urllib.request
import urllib.parse
import urllib.error
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = ROOT / "data" / "market"

STATE_FIPS = "08"
STATE_ABBR = "CO"

CENSUS_API_KEY = os.environ.get("CENSUS_API_KEY", "")

# Cache directory to avoid redundant network calls
CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_build_cache"
CACHE_TTL_HOURS = 24

TIGERWEB_TRACTS = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0"
)
ACS_BASE = "https://api.census.gov/data/2022/acs/acs5"
HUD_LIHTC_URL = (
    "https://hudgis-hud.opendata.arcgis.com/datasets/"
    "8c3c3b26-38f1-4e06-a8f7-a0f2a60cc4d2_0.geojson"
)


# ── HTTP helper ────────────────────────────────────────────────────────────────

def fetch_url(url: str, retries: int = 3, timeout: int = 60) -> bytes:
    """Fetch a URL with retries and optional disk caching."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_key = hashlib.md5(url.encode()).hexdigest()
    cache_file = CACHE_DIR / cache_key
    if cache_file.exists():
        age_hours = (time.time() - cache_file.stat().st_mtime) / 3600
        if age_hours < CACHE_TTL_HOURS:
            print(f"  [cache] {url[:80]}")
            return cache_file.read_bytes()

    last_err = None
    for attempt in range(retries):
        try:
            print(f"  [fetch] {url[:100]}")
            req = urllib.request.Request(url, headers={"User-Agent": "pma-build/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
            cache_file.write_bytes(data)
            return data
        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                wait = 2 ** attempt
                print(f"  [retry {attempt+1}] {e} — waiting {wait}s")
                time.sleep(wait)
    raise RuntimeError(f"Failed after {retries} retries: {last_err}") from last_err


def fetch_json(url: str, **kwargs) -> dict:
    return json.loads(fetch_url(url, **kwargs))


def arcgis_query(layer_url: str, where: str = "1=1", offset: int = 0, limit: int = 5000) -> dict:
    params = urllib.parse.urlencode({
        "where": where,
        "outFields": "*",
        "returnGeometry": "true",
        "f": "geojson",
        "outSR": "4326",
        "resultRecordCount": str(limit),
        "resultOffset": str(offset),
        "returnExceededLimitFeatures": "true",
    })
    return fetch_json(f"{layer_url}/query?{params}")


# ── Tract centroids ────────────────────────────────────────────────────────────

def build_tract_centroids() -> dict:
    print("\n[1/3] Fetching Colorado tract geometries from TIGERweb…")
    tracts = []
    offset = 0
    while True:
        page = arcgis_query(TIGERWEB_TRACTS, where=f"STATEFP='{STATE_FIPS}'", offset=offset)
        features = page.get("features", [])
        for f in features:
            props = f.get("properties", {})
            geoid = props.get("GEOID") or props.get("GEOID10") or props.get("AFFGEOID", "")
            # Compute centroid from bbox or geometry
            geom = f.get("geometry")
            lat, lon = _centroid(geom)
            if lat is None:
                continue
            tracts.append({
                "geoid": str(geoid),
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "county_fips": str(geoid)[:5] if len(str(geoid)) >= 5 else "",
                "county_name": props.get("NAMELSAD", "").replace(" County", ""),
            })
        if len(features) < 5000:
            break
        offset += len(features)

    print(f"  → {len(tracts)} tracts fetched")
    return {
        "meta": {
            "source": "US Census TIGERweb ArcGIS REST (public)",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "note": "Rebuild via scripts/market/build_public_market_data.py",
        },
        "tracts": tracts,
    }


def _centroid(geom: dict | None) -> tuple[float | None, float | None]:
    if not geom:
        return None, None
    gtype = geom.get("type", "")
    coords = geom.get("coordinates")
    if not coords:
        return None, None
    if gtype == "Point":
        return coords[1], coords[0]
    if gtype in ("Polygon", "MultiPolygon"):
        flat = _flatten_coords(coords, gtype)
        if not flat:
            return None, None
        lons = [c[0] for c in flat]
        lats = [c[1] for c in flat]
        return sum(lats) / len(lats), sum(lons) / len(lons)
    return None, None


def _flatten_coords(coords, gtype):
    if gtype == "Polygon":
        return coords[0] if coords else []
    if gtype == "MultiPolygon":
        flat = []
        for poly in coords:
            if poly and poly[0]:
                flat.extend(poly[0])
        return flat
    return []


# ── ACS tract metrics ──────────────────────────────────────────────────────────

ACS_VARIABLES = [
    "GEO_ID",
    "B01003_001E",  # total population
    "B25003_001E",  # total occupied HUs
    "B25003_002E",  # owner-occupied
    "B25003_003E",  # renter-occupied
    "B25004_001E",  # total vacant
    "B25064_001E",  # median gross rent
    "B19013_001E",  # median HH income
    "B25070_007E",  # 30-34.9% income on rent
    "B25070_008E",  # 35-39.9%
    "B25070_009E",  # 40-49.9%
    "B25070_010E",  # 50%+
    "B25070_001E",  # total renter HUs w/ rent
]

def build_acs_metrics(centroids: dict) -> dict:
    print("\n[2/3] Fetching ACS tract metrics from Census API…")
    geoids = {t["geoid"] for t in centroids.get("tracts", [])}

    vars_str = ",".join(ACS_VARIABLES)
    key_param = f"&key={CENSUS_API_KEY}" if CENSUS_API_KEY else ""
    url = (
        f"{ACS_BASE}?get={vars_str}"
        f"&for=tract:*&in=state:{STATE_FIPS}{key_param}"
    )

    try:
        raw = fetch_url(url)
        rows = json.loads(raw)
    except Exception as e:
        print(f"  [warn] ACS fetch failed: {e}. Returning empty metrics.")
        return {"meta": _acs_meta(), "tracts": []}

    header = rows[0]
    idx = {v: i for i, v in enumerate(header)}

    def safe_int(v):
        try:
            n = int(v)
            return max(0, n) if n >= 0 else 0
        except (TypeError, ValueError):
            return 0

    tracts = []
    for row in rows[1:]:
        state_fips = row[idx.get("state", -1)] if "state" in idx else STATE_FIPS
        county_fips_part = row[idx.get("county", -1)] if "county" in idx else ""
        tract_part = row[idx.get("tract", -1)] if "tract" in idx else ""
        geoid = state_fips + county_fips_part + tract_part

        # Skip tracts not in our centroids index (avoid orphan metrics)
        if geoid and geoid not in geoids:
            continue

        total_hh  = safe_int(row[idx.get("B25003_001E", -1)])
        vacant    = safe_int(row[idx.get("B25004_001E", -1)])
        renter_hh = safe_int(row[idx.get("B25003_003E", -1)])
        owner_hh  = safe_int(row[idx.get("B25003_002E", -1)])
        # Cost-burden rate = (30-34.9% + 35-39.9% + 40-49.9% + 50%+) / total w/ rent
        cb_num    = sum(safe_int(row[idx.get(v, -1)]) for v in [
                        "B25070_007E","B25070_008E","B25070_009E","B25070_010E"])
        cb_den    = safe_int(row[idx.get("B25070_001E", -1)])
        cb_rate   = round(cb_num / cb_den, 4) if cb_den > 0 else 0.0

        universe  = total_hh + vacant
        vac_rate  = round(vacant / universe, 4) if universe > 0 else 0.0

        tracts.append({
            "geoid":             geoid,
            "pop":               safe_int(row[idx.get("B01003_001E", -1)]),
            "renter_hh":         renter_hh,
            "owner_hh":          owner_hh,
            "vacant":            vacant,
            "total_hh":          total_hh,
            "median_gross_rent": safe_int(row[idx.get("B25064_001E", -1)]),
            "median_hh_income":  safe_int(row[idx.get("B19013_001E", -1)]),
            "cost_burden_rate":  cb_rate,
            "vacancy_rate":      vac_rate,
        })

    print(f"  → {len(tracts)} tracts with ACS metrics")
    return {"meta": _acs_meta(), "tracts": tracts}


def _acs_meta() -> dict:
    return {
        "source": "US Census ACS 5-Year Estimates (public)",
        "vintage": "2022",
        "state": "Colorado",
        "state_fips": STATE_FIPS,
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "fields": {
            "pop":               "B01003_001E — Total population",
            "renter_hh":         "B25003_003E — Renter-occupied housing units",
            "owner_hh":          "B25003_002E — Owner-occupied housing units",
            "vacant":            "B25004_001E — Vacant housing units (total)",
            "total_hh":          "B25003_001E — Total occupied housing units",
            "median_gross_rent": "B25064_001E — Median gross rent ($)",
            "median_hh_income":  "B19013_001E — Median household income ($)",
            "cost_burden_rate":  "Derived: B25070 pct paying 30%+ of income on rent",
            "vacancy_rate":      "Derived: vacant / (total_hh + vacant)",
        },
        "note": "Rebuild via scripts/market/build_public_market_data.py",
    }


# ── HUD LIHTC ─────────────────────────────────────────────────────────────────

def build_hud_lihtc() -> dict:
    print("\n[3/3] Fetching HUD LIHTC public dataset…")
    try:
        raw = fetch_url(HUD_LIHTC_URL, retries=3, timeout=120)
        data = json.loads(raw)
    except Exception as e:
        print(f"  [warn] HUD LIHTC fetch failed: {e}. Returning empty GeoJSON.")
        return _empty_lihtc_geojson()

    features = data.get("features", [])
    co_features = []
    for f in features:
        props = f.get("properties") or {}
        state = (props.get("STATE") or props.get("hud_state_code") or "").strip().upper()
        if state != STATE_ABBR:
            continue
        # Ensure TOTAL_UNITS is present
        units = (props.get("TOTAL_UNITS") or props.get("total_units") or
                 props.get("LI_UNITS") or props.get("li_units") or 0)
        try:
            units = int(units)
        except (TypeError, ValueError):
            units = 0
        props["TOTAL_UNITS"] = units
        co_features.append({"type": "Feature", "geometry": f.get("geometry"), "properties": props})

    print(f"  → {len(co_features)} Colorado LIHTC projects")
    return {
        "type": "FeatureCollection",
        "meta": {
            "source": "HUD LIHTC Database (public)",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "note": "Rebuild via scripts/market/build_public_market_data.py",
        },
        "features": co_features,
    }


def _empty_lihtc_geojson() -> dict:
    return {
        "type": "FeatureCollection",
        "meta": _acs_meta(),
        "features": [],
    }


# ── Validation ─────────────────────────────────────────────────────────────────

def validate(centroids, acs, lihtc) -> list[str]:
    errors = []
    if not centroids.get("tracts"):
        errors.append("tract_centroids_co.json has no tracts")
    if not acs.get("tracts"):
        errors.append("acs_tract_metrics_co.json has no tracts (may be empty in offline mode)")
    if not isinstance(lihtc.get("features"), list):
        errors.append("hud_lihtc_co.geojson has no features array")
    return errors


# ── Write helpers ──────────────────────────────────────────────────────────────

def write_json(path: Path, obj: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, ensure_ascii=False)
    print(f"  → wrote {path.relative_to(ROOT)} ({path.stat().st_size:,} bytes)")


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print("PMA Market Data Builder")
    print("=" * 60)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Tract centroids
    try:
        centroids = build_tract_centroids()
    except Exception as e:
        print(f"[ERROR] Tract centroids failed: {e}")
        # Fall back to existing file if present
        existing = OUT_DIR / "tract_centroids_co.json"
        if existing.exists():
            centroids = json.loads(existing.read_text())
            print("  [fallback] Using existing tract_centroids_co.json")
        else:
            centroids = {"meta": {}, "tracts": []}

    # 2. ACS metrics
    try:
        acs = build_acs_metrics(centroids)
    except Exception as e:
        print(f"[ERROR] ACS metrics failed: {e}")
        existing = OUT_DIR / "acs_tract_metrics_co.json"
        if existing.exists():
            acs = json.loads(existing.read_text())
            print("  [fallback] Using existing acs_tract_metrics_co.json")
        else:
            acs = {"meta": {}, "tracts": []}

    # 3. HUD LIHTC
    try:
        lihtc = build_hud_lihtc()
    except Exception as e:
        print(f"[ERROR] HUD LIHTC failed: {e}")
        existing = OUT_DIR / "hud_lihtc_co.geojson"
        if existing.exists():
            lihtc = json.loads(existing.read_text())
            print("  [fallback] Using existing hud_lihtc_co.geojson")
        else:
            lihtc = _empty_lihtc_geojson()

    # Write artifacts
    print("\n[Write] Saving artifacts…")
    write_json(OUT_DIR / "tract_centroids_co.json", centroids)
    write_json(OUT_DIR / "acs_tract_metrics_co.json", acs)
    write_json(OUT_DIR / "hud_lihtc_co.geojson", lihtc)

    # Validate
    errors = validate(centroids, acs, lihtc)
    if errors:
        print("\n[VALIDATION ERRORS]")
        for e in errors:
            print(f"  ✗ {e}")
        sys.exit(1)
    else:
        print("\n✓ All artifacts validated successfully.")
        print(f"  Tracts:         {len(centroids.get('tracts', []))}")
        print(f"  ACS records:    {len(acs.get('tracts', []))}")
        print(f"  LIHTC projects: {len(lihtc.get('features', []))}")


if __name__ == "__main__":
    main()
