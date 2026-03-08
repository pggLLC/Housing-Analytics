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
import random
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


# ── Logging helper ─────────────────────────────────────────────────────────────

def _ts() -> str:
    """Return a compact UTC timestamp for log prefixes."""
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def log(msg: str, level: str = "INFO") -> None:
    """Print a timestamped log line."""
    print(f"[{_ts()}] [{level}] {msg}", flush=True)


# ── ArcGIS error handler ───────────────────────────────────────────────────────

def arcgis_error_handler(data: dict, url: str) -> None:
    """Inspect a parsed ArcGIS JSON response and raise a descriptive error if it
    contains an error payload.  ArcGIS REST returns HTTP 200 even for errors, so
    HTTP status alone is not sufficient.
    """
    err = data.get("error")
    if not err:
        return
    code = err.get("code", "?")
    message = err.get("message", str(err))
    details = err.get("details") or err.get("messageCode", "")
    detail_str = f" — details: {details}" if details else ""
    raise RuntimeError(
        f"ArcGIS error (code {code}): {message}{detail_str} | URL: {url[:120]}"
    )


# ── HTTP helper ────────────────────────────────────────────────────────────────

# Codes that indicate a transient server-side problem worth retrying.
_TRANSIENT_HTTP_CODES = {429, 500, 502, 503, 504}


def fetch_url(
    url: str,
    retries: int = 4,
    timeout: int = 60,
    backoff_base: float = 5.0,
    max_backoff: float = 60.0,
) -> bytes:
    """Fetch a URL with retries, exponential backoff + jitter, and disk caching.

    Parameters
    ----------
    url:          The URL to fetch.
    retries:      Total number of attempts (including the first).
    timeout:      Per-request socket timeout in seconds.
    backoff_base: Base wait in seconds before the first retry.  Subsequent
                  retries double the wait (+ jitter).  Defaults to 5 s which
                  is more appropriate for rate-limited external APIs than the
                  previous 1 s default.
    max_backoff:  Upper cap on the computed wait interval (seconds).
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_key = hashlib.md5(url.encode()).hexdigest()
    cache_file = CACHE_DIR / cache_key
    if cache_file.exists():
        age_hours = (time.time() - cache_file.stat().st_mtime) / 3600
        if age_hours < CACHE_TTL_HOURS:
            log(f"[cache hit] {url[:100]}")
            return cache_file.read_bytes()

    def _next_wait(attempt: int) -> float:
        """Exponential backoff with +0–20 % jitter."""
        base = min(backoff_base * (2 ** attempt), max_backoff)
        return base + random.uniform(0, base * 0.2)

    last_err: Exception | None = None
    t_start = time.monotonic()
    for attempt in range(retries):
        try:
            log(f"[fetch attempt {attempt + 1}/{retries}] {url[:120]}")
            req = urllib.request.Request(url, headers={"User-Agent": "pma-build/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                status = resp.status
                log(f"[fetch] HTTP {status} in {time.monotonic() - t_start:.1f}s")
                data = resp.read()
            cache_file.write_bytes(data)
            return data
        except urllib.error.HTTPError as e:
            last_err = e
            http_code = e.code
            if http_code not in _TRANSIENT_HTTP_CODES:
                log(
                    f"[fetch] Non-retryable HTTP {http_code} for {url[:100]}",
                    level="ERROR",
                )
                raise RuntimeError(
                    f"HTTP {http_code} (non-retryable) fetching {url[:120]}: {e.reason}"
                ) from e
            if attempt < retries - 1:
                wait = _next_wait(attempt)
                log(
                    f"[retry {attempt + 1}/{retries - 1}] HTTP {http_code} — "
                    f"waiting {wait:.1f}s before next attempt",
                    level="WARN",
                )
                time.sleep(wait)
        except urllib.error.URLError as e:
            last_err = e
            if attempt < retries - 1:
                wait = _next_wait(attempt)
                log(
                    f"[retry {attempt + 1}/{retries - 1}] URLError: {e.reason} — "
                    f"waiting {wait:.1f}s",
                    level="WARN",
                )
                time.sleep(wait)
        except Exception as e:
            last_err = e
            if attempt < retries - 1:
                wait = _next_wait(attempt)
                log(
                    f"[retry {attempt + 1}/{retries - 1}] {type(e).__name__}: {e} — "
                    f"waiting {wait:.1f}s",
                    level="WARN",
                )
                time.sleep(wait)

    raise RuntimeError(
        f"Failed after {retries} attempts ({time.monotonic() - t_start:.1f}s total): "
        f"{last_err} | URL: {url[:120]}"
    ) from last_err


def fetch_json(url: str, **kwargs) -> dict:
    return json.loads(fetch_url(url, **kwargs))


def arcgis_query(layer_url: str, where: str = "1=1", offset: int = 0, limit: int = 5000) -> dict:
    params = urllib.parse.urlencode({
        "where": where,
        "outFields": "*",
        "returnGeometry": "true",
        "f": "json",   # Use ArcGIS native JSON; f=geojson is rejected (400) by some TIGERweb layers
        "outSR": "4326",
        "resultRecordCount": str(limit),
        "resultOffset": str(offset),
        "returnExceededLimitFeatures": "true",
    })
    query_url = f"{layer_url}/query?{params}"
    log(f"[arcgis] layer={layer_url.split('/')[-2]}/{layer_url.split('/')[-1]} "
        f"where={where!r} offset={offset}")
    data = fetch_json(query_url, backoff_base=5.0)
    arcgis_error_handler(data, query_url)
    return data


# ── Tract centroids ────────────────────────────────────────────────────────────

def build_tract_centroids() -> dict:
    log("\n[1/3] Fetching Colorado tract geometries from TIGERweb…")
    tracts = []
    offset = 0
    page_num = 0
    while True:
        page_num += 1
        try:
            page = arcgis_query(TIGERWEB_TRACTS, where=f"STATEFP='{STATE_FIPS}'", offset=offset)
        except RuntimeError as e:
            log(
                f"[arcgis] Page {page_num} failed (offset={offset}): {e}\n"
                "  → Recovery suggestion: check TIGERweb service status at "
                "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer",
                level="ERROR",
            )
            raise
        features = page.get("features", [])
        log(f"[arcgis] Page {page_num}: received {len(features)} features (offset={offset})")
        for f in features:
            # ArcGIS native JSON (f=json) uses "attributes"; GeoJSON uses "properties"
            props = f.get("attributes") or f.get("properties") or {}
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

    log(f"[arcgis] {len(tracts)} tracts fetched total")
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
    # ArcGIS native JSON (f=json) uses "rings" for polygons and "x"/"y" for points
    if "rings" in geom:
        rings = geom["rings"]
        if not rings:
            return None, None
        all_lons: list[float] = []
        all_lats: list[float] = []
        for ring in rings:
            for coord in ring:
                all_lons.append(coord[0])
                all_lats.append(coord[1])
        if not all_lons:
            return None, None
        return (min(all_lats) + max(all_lats)) / 2, (min(all_lons) + max(all_lons)) / 2
    if "x" in geom and "y" in geom:
        return geom["y"], geom["x"]
    # GeoJSON format (f=geojson)
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
    log("\n[2/3] Fetching ACS tract metrics from Census API…")

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
        log(f"ACS fetch failed: {e}. Returning empty metrics.", level="WARN")
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

    log(f"[acs] {len(tracts)} tracts with ACS metrics")
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
    log("\n[3/3] Fetching HUD LIHTC public dataset…")
    try:
        raw = fetch_url(HUD_LIHTC_URL, retries=3, timeout=120)
        data = json.loads(raw)
    except Exception as e:
        log(f"HUD LIHTC fetch failed: {e}. Returning empty GeoJSON.", level="WARN")
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

    log(f"[lihtc] {len(co_features)} Colorado LIHTC projects")
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
        "meta": {
            "source": "HUD LIHTC Database (public)",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "note": "Rebuild via scripts/market/build_public_market_data.py",
        },
        "features": [],
    }


# ── Validation ─────────────────────────────────────────────────────────────────

def validate(centroids, acs, lihtc) -> list[str]:
    errors = []
    if not centroids.get("tracts"):
        errors.append("tract_centroids_co.json has no tracts")
    n_acs = len(acs.get("tracts", []))
    if n_acs == 0:
        errors.append("acs_tract_metrics_co.json has no tracts (may be empty in offline mode)")
    elif n_acs < 100:
        errors.append(
            f"acs_tract_metrics_co.json: only {n_acs} tracts (minimum 100) — "
            "check Census API key and build script"
        )
    if not isinstance(lihtc.get("features"), list):
        errors.append("hud_lihtc_co.geojson has no features array")
    return errors


# ── Write helpers ──────────────────────────────────────────────────────────────

def write_json(path: Path, obj: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, ensure_ascii=False)
    log(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size:,} bytes)")


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("=" * 60)
    print(f"PMA Market Data Builder — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC")
    print("=" * 60)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Tract centroids
    try:
        centroids = build_tract_centroids()
    except Exception as e:
        log(f"Tract centroids failed: {e}", level="ERROR")
        centroids = {"meta": {}, "tracts": []}
    # Fall back to existing file if fetch returned no tracts
    if not centroids.get("tracts"):
        existing = OUT_DIR / "tract_centroids_co.json"
        if existing.exists():
            saved = json.loads(existing.read_text())
            if saved.get("tracts"):
                centroids = saved
                log("[fallback] Using existing tract_centroids_co.json")

    # 2. ACS metrics
    try:
        acs = build_acs_metrics(centroids)
    except Exception as e:
        log(f"ACS metrics failed: {e}", level="ERROR")
        acs = {"meta": {}, "tracts": []}
    # Fall back to existing file if fetch returned too few tracts (< 100 means partial/failed fetch)
    if len(acs.get("tracts", [])) < 100:
        existing = OUT_DIR / "acs_tract_metrics_co.json"
        if existing.exists():
            saved = json.loads(existing.read_text())
            if len(saved.get("tracts", [])) >= 100:
                acs = saved
                log("[fallback] Using existing acs_tract_metrics_co.json")

    # 3. HUD LIHTC
    try:
        lihtc = build_hud_lihtc()
    except Exception as e:
        log(f"HUD LIHTC failed: {e}", level="ERROR")
        lihtc = _empty_lihtc_geojson()
    # Fall back to existing file if fetch returned no features
    if not lihtc.get("features"):
        existing = OUT_DIR / "hud_lihtc_co.geojson"
        if existing.exists():
            saved = json.loads(existing.read_text())
            if saved.get("features"):
                lihtc = saved
                log("[fallback] Using existing hud_lihtc_co.geojson")

    # Write artifacts
    log("[Write] Saving artifacts…")
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
