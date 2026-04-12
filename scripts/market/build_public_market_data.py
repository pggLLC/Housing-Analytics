#!/usr/bin/env python3
"""
scripts/market/build_public_market_data.py

Fetches and assembles public market data artifacts for the PMA scoring engine:
  - data/market/tract_centroids_co.json      (TIGERweb ArcGIS REST)
  - data/market/acs_tract_metrics_co.json    (Census ACS 5-Year API)
  - data/market/hud_lihtc_co.geojson        (HUD LIHTC public dataset)
  - data/market/tract_boundaries_co.geojson  (TIGERweb ArcGIS REST)

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
# Census Cartographic Boundary GeoJSON — used as fallback when TIGERweb returns 0 features.
# 500k-resolution polygon file for Colorado tracts (≈3 MB, one request, no pagination).
CENSUS_CB_TRACTS_URL = os.environ.get("CENSUS_CB_URL") or (
    "https://www2.census.gov/geo/tiger/GENZ2024/json/cb_2024_08_tract_500k.json"
)
# Ordered fallback list (newest-first) used when the primary URL fails.
# The build script tries these in order until one succeeds.
_CENSUS_CB_FALLBACK_URLS = [
    "https://www2.census.gov/geo/tiger/GENZ2024/json/cb_2024_08_tract_500k.json",
    "https://www2.census.gov/geo/tiger/GENZ2023/json/cb_2023_08_tract_500k.json",
    "https://www2.census.gov/geo/tiger/GENZ2022/json/cb_2022_08_tract_500k.json",
]
ACS_BASE = "https://api.census.gov/data/2023/acs/acs5"
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
# 400: TIGERweb/ArcGIS is known to return spurious Bad Request responses when
#      its tile cache or query planner is under load, even for syntactically
#      correct queries.  The response body typically contains
#      "Failed to execute query" without any client-side fix possible.  Retry
#      with backoff; the service usually recovers within a few seconds.
# 403: HUD OpenData (hudgis-hud.opendata.arcgis.com) occasionally returns a
#      temporary 403 Forbidden during high-traffic periods or brief maintenance
#      windows — not a permanent credential requirement.  Retry with backoff
#      before treating the failure as permanent.
_TRANSIENT_HTTP_CODES = {400, 403, 429, 500, 502, 503, 504}


def fetch_url(
    url: str,
    retries: int = 6,
    timeout: int = 120,
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
                if http_code == 401:
                    detail = "authentication required — check credentials"
                elif http_code == 404:
                    detail = "URL not found — endpoint may have moved or been removed"
                else:
                    detail = e.reason
                log(
                    f"[fetch] Non-retryable HTTP {http_code} for {url[:100]} — {detail}",
                    level="ERROR",
                )
                raise RuntimeError(
                    f"HTTP {http_code} (non-retryable) fetching {url[:120]}: {detail}"
                ) from e
            if attempt < retries - 1:
                wait = _next_wait(attempt)
                if http_code == 400:
                    # Log the response body so operators can confirm the error
                    # is the known TIGERweb "Failed to execute query" transient,
                    # not a permanently malformed URL.
                    try:
                        body_snippet = e.read(300).decode(errors="replace").strip()
                    except Exception:
                        body_snippet = "<unreadable>"
                    note = f" (transient ArcGIS/TIGERweb Bad Request — body: {body_snippet!r})"
                elif http_code == 403:
                    note = " (temporary access denial — will retry with backoff)"
                else:
                    note = ""
                log(
                    f"[retry {attempt + 1}/{retries - 1}] HTTP {http_code}{note} — "
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
                f"  → Stopping pagination with {len(tracts)} tract(s) collected so far.\n"
                "  → Recovery suggestion: check TIGERweb service status at "
                "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer",
                level="ERROR",
            )
            break
        features = page.get("features", [])
        log(f"[arcgis] Page {page_num}: received {len(features)} features (offset={offset})")
        for f in features:
            # ArcGIS native JSON (f=json) uses "attributes"; GeoJSON uses "properties"
            props = f.get("attributes") or f.get("properties") or {}
            geoid = props.get("GEOID") or props.get("GEOID10") or props.get("AFFGEOID", "")
            # Compute centroid and bounding box from polygon geometry
            geom = f.get("geometry")
            lat, lon = _centroid(geom)
            if lat is None:
                continue
            bbox = _bbox(geom)
            tract = {
                "geoid": str(geoid),
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "county_fips": str(geoid)[:5] if len(str(geoid)) >= 5 else "",
                "county_name": props.get("NAMELSAD", "").replace(" County", ""),
            }
            if bbox:
                tract["bbox"] = bbox
            tracts.append(tract)
        # ArcGIS signals "more pages available" via exceededTransferLimit.
        # Stopping on feature count alone (< 5000) fails when the server's
        # maxRecordCount is lower than the requested limit (e.g. 205 or 1000).
        # Also stop if features is empty to guard against an infinite loop.
        if not features or not page.get("exceededTransferLimit"):
            break
        offset += len(features)

    log(f"[arcgis] {len(tracts)} tracts fetched total")
    return {
        "meta": {
            "source": "US Census TIGERweb ArcGIS REST (public)",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": datetime.now(timezone.utc).isoformat(),
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


def _bbox(geom: dict | None) -> list[float] | None:
    """Return the polygon bounding box as [min_lon, min_lat, max_lon, max_lat].

    Used to enable circle-bbox intersection testing in the PMA engine, which
    includes tracts that straddle the buffer boundary even when their centroid
    lies outside the radius.  Returns None when geometry is unavailable.
    """
    if not geom:
        return None
    all_lons: list[float] = []
    all_lats: list[float] = []
    # ArcGIS native JSON (rings)
    if "rings" in geom:
        for ring in geom["rings"]:
            for coord in ring:
                all_lons.append(coord[0])
                all_lats.append(coord[1])
    elif "x" in geom and "y" in geom:
        # Point geometry — bbox degenerates to a single point
        return [geom["x"], geom["y"], geom["x"], geom["y"]]
    else:
        gtype = geom.get("type", "")
        coords = geom.get("coordinates")
        if not coords:
            return None
        if gtype == "Point":
            return [coords[0], coords[1], coords[0], coords[1]]
        if gtype in ("Polygon", "MultiPolygon"):
            flat = _flatten_coords(coords, gtype)
            for coord in flat:
                all_lons.append(coord[0])
                all_lats.append(coord[1])
    if not all_lons:
        return None
    return [
        round(min(all_lons), 6),
        round(min(all_lats), 6),
        round(max(all_lons), 6),
        round(max(all_lats), 6),
    ]


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


def _rings_to_geojson_geometry(rings: list) -> dict | None:
    """Convert ArcGIS native JSON rings to a GeoJSON geometry dict.

    ArcGIS uses a flat list of rings where the first ring is the exterior
    boundary and any additional rings are interior holes or disconnected parts.
    For census tracts (which rarely have interior holes), we treat each ring
    as a separate exterior polygon element:
      - Single ring  → GeoJSON Polygon
      - Multiple rings → GeoJSON MultiPolygon (each ring becomes a polygon)

    All coordinates are assumed to be in WGS84 [lon, lat] order, which is
    correct when the ArcGIS query includes outSR=4326.
    """
    if not rings:
        return None
    if len(rings) == 1:
        return {"type": "Polygon", "coordinates": rings}
    return {"type": "MultiPolygon", "coordinates": [[ring] for ring in rings]}


# ── Tract boundary GeoJSON ─────────────────────────────────────────────────────

def build_tract_boundaries() -> dict:
    """Fetch Colorado tract polygon geometries from TIGERweb and return a
    GeoJSON FeatureCollection suitable for choropleth rendering.

    Each feature carries the following properties:
      GEOID       — 11-digit census tract GEOID (e.g. "08031001301")
      geoid       — same value, lowercase key for JS convenience
      NAME        — human-readable tract label from NAMELSAD
      county_fips — 5-digit county FIPS (e.g. "08031"), zero-padded per Rule 1
    """
    log("\n[4/4] Building tract boundary GeoJSON from TIGERweb…")
    features: list[dict] = []
    offset = 0
    page_num = 0
    while True:
        page_num += 1
        try:
            page = arcgis_query(TIGERWEB_TRACTS, where=f"STATEFP='{STATE_FIPS}'", offset=offset)
        except RuntimeError as e:
            log(
                f"[arcgis] Boundaries page {page_num} failed (offset={offset}): {e}\n"
                f"  → Stopping pagination with {len(features)} boundary feature(s) collected so far.\n"
                "  → Recovery suggestion: check TIGERweb service status at "
                "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer",
                level="ERROR",
            )
            break
        raw_features = page.get("features", [])
        log(f"[arcgis] Boundaries page {page_num}: received {len(raw_features)} features "
            f"(offset={offset})")
        for f in raw_features:
            props = f.get("attributes") or f.get("properties") or {}
            geoid = str(props.get("GEOID") or props.get("GEOID10") or props.get("AFFGEOID", ""))
            geom = f.get("geometry")
            if not geom:
                continue
            rings = geom.get("rings")
            if not rings:
                continue
            geojson_geom = _rings_to_geojson_geometry(rings)
            if not geojson_geom:
                continue
            # Enforce 5-digit county FIPS (Rule 1)
            county_fips = geoid[:5].zfill(5) if len(geoid) >= 5 else ""
            features.append({
                "type": "Feature",
                "geometry": geojson_geom,
                "properties": {
                    "GEOID": geoid,
                    "geoid": geoid,
                    "NAME": props.get("NAMELSAD", f"Tract {geoid[-6:]}"),
                    "county_fips": county_fips,
                },
            })
        if not raw_features or not page.get("exceededTransferLimit"):
            break
        offset += len(raw_features)

    log(f"[arcgis] {len(features)} tract boundary features built")

    # ── Census Cartographic Boundary fallback ─────────────────────────────────
    # TIGERweb's Tracts_Blocks/MapServer/0 endpoint has intermittently returned
    # 0 features.  When that happens, fetch the pre-built 500k-resolution
    # polygon file from Census FTP — a single GeoJSON, no pagination required.
    # Try candidate URLs newest-first (GENZ2024 → GENZ2023 → GENZ2022) so the
    # pipeline is not broken by a stale hardcoded URL.
    if not features:
        log(
            "[boundary-fallback] TIGERweb returned 0 features; "
            "trying Census Cartographic Boundary GeoJSON (newest vintage first)…",
            level="WARN",
        )
        # Build the ordered candidate list: env-override first, then the standard
        # fallback list (deduped so the env URL is not attempted twice).
        cb_candidates = [CENSUS_CB_TRACTS_URL] + [
            u for u in _CENSUS_CB_FALLBACK_URLS if u != CENSUS_CB_TRACTS_URL
        ]
        source_note = "US Census TIGERweb ArcGIS REST (public) — unavailable"
        for cb_url in cb_candidates:
            if features:
                break
            try:
                log(f"[boundary-fallback] Trying {cb_url} …")
                raw_cb = fetch_url(cb_url)
                cb = json.loads(raw_cb)
                cb_features = cb.get("features", [])
                for f in cb_features:
                    props = f.get("properties") or {}
                    geoid = str(props.get("GEOID") or props.get("GEOID20") or "")
                    geom = f.get("geometry")
                    if not geoid or not geom:
                        continue
                    county_fips = geoid[:5].zfill(5) if len(geoid) >= 5 else ""
                    features.append({
                        "type": "Feature",
                        "geometry": geom,
                        "properties": {
                            "GEOID": geoid,
                            "geoid": geoid,
                            "NAME": props.get("NAMELSAD", f"Tract {geoid[-6:]}"),
                            "county_fips": county_fips,
                        },
                    })
                if features:
                    cb_filename = cb_url.split("/")[-1]
                    log(
                        f"[boundary-fallback] Census Cartographic Boundary: "
                        f"{len(features)} features loaded from {cb_filename}",
                    )
                    source_note = f"Census Cartographic Boundary 500k ({cb_filename}) — fallback"
                else:
                    log(f"[boundary-fallback] {cb_url} returned 0 features", level="WARN")
            except Exception as cb_exc:
                log(
                    f"[boundary-fallback] {cb_url} failed: {cb_exc}",
                    level="WARN",
                )
        if not features:
            log(
                "[boundary-fallback] All Census CB candidates exhausted with no features",
                level="ERROR",
            )
    else:
        source_note = "US Census TIGERweb ArcGIS REST (public)"

    return {
        "type": "FeatureCollection",
        "meta": {
            "source": source_note,
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": datetime.now(timezone.utc).isoformat(),
            "note": "Rebuild via scripts/market/build_public_market_data.py",
        },
        "features": features,
    }


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
    "B17001_001E",  # poverty universe (population for whom poverty status is determined)
    "B17001_002E",  # below poverty level
    "B23025_003E",  # in labor force
    "B23025_005E",  # unemployed
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

        # Severe cost burden (50%+ of income on rent)
        severe_num = safe_int(row[idx.get("B25070_010E", -1)])
        severe_rate = round(severe_num / cb_den, 4) if cb_den > 0 else 0.0

        # Poverty rate
        pov_universe = safe_int(row[idx.get("B17001_001E", -1)])
        pov_below    = safe_int(row[idx.get("B17001_002E", -1)])
        pov_rate     = round(pov_below / pov_universe, 4) if pov_universe > 0 else 0.0

        # Unemployment rate
        labor_force = safe_int(row[idx.get("B23025_003E", -1)])
        unemployed  = safe_int(row[idx.get("B23025_005E", -1)])
        unemp_rate  = round(unemployed / labor_force, 4) if labor_force > 0 else 0.0

        tracts.append({
            "geoid":                geoid,
            "pop":                  safe_int(row[idx.get("B01003_001E", -1)]),
            "renter_hh":            renter_hh,
            "owner_hh":             owner_hh,
            "vacant":               vacant,
            "total_hh":             total_hh,
            "median_gross_rent":    safe_int(row[idx.get("B25064_001E", -1)]),
            "median_hh_income":     safe_int(row[idx.get("B19013_001E", -1)]),
            "cost_burden_rate":     cb_rate,
            "severe_cost_burden_rate": severe_rate,
            "poverty_rate":         pov_rate,
            "unemployment_rate":    unemp_rate,
            "vacancy_rate":         vac_rate,
        })

    log(f"[acs] {len(tracts)} tracts with ACS metrics")
    return {"meta": _acs_meta(), "tracts": tracts}


def _acs_meta() -> dict:
    return {
        "source": "US Census ACS 5-Year Estimates (public)",
        "vintage": "2023",
        "state": "Colorado",
        "state_fips": STATE_FIPS,
        "generated": datetime.now(timezone.utc).isoformat(),
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
        raw = fetch_url(HUD_LIHTC_URL, retries=6, timeout=120, backoff_base=10.0)
        data = json.loads(raw)
    except Exception as e:
        log(f"HUD LIHTC fetch failed: {e}. Returning empty GeoJSON.", level="WARN")
        return _empty_lihtc_geojson()

    features = data.get("features", [])
    co_features = []
    for f in features:
        props = f.get("properties") or {}
        state_fields = ["STATE", "hud_state_code", "Proj_St", "STATE_ABBR", "state"]
        state = next((props.get(fld) for fld in state_fields if props.get(fld)), "").strip().upper()
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
            "generated": datetime.now(timezone.utc).isoformat(),
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
            "generated": datetime.now(timezone.utc).isoformat(),
            "note": "Rebuild via scripts/market/build_public_market_data.py",
        },
        "features": [],
    }


# ── Validation ─────────────────────────────────────────────────────────────────

def validate(centroids, acs, lihtc, boundaries) -> tuple[list[str], list[str]]:
    """Validate build artifacts.

    Returns a tuple of ``(critical_errors, warnings)``.

    ``critical_errors`` — failures in core data that always cause a non-zero
        exit code regardless of ``--allow-partial`` (e.g. no tract centroids).

    ``warnings`` — degraded-but-recoverable conditions (e.g. empty boundary
        file because TIGERweb is temporarily unavailable).  With
        ``--allow-partial`` these do not cause exit code 1.
    """
    errors: list[str] = []
    warnings: list[str] = []
    tracts = centroids.get("tracts", [])
    if not tracts:
        errors.append("tract_centroids_co.json has no tracts")
    else:
        # Flag tracts missing bbox — the PMA engine falls back to centroid-only
        # distance for these, which can miss edge tracts that straddle the buffer
        # boundary.  Re-running build_public_market_data.py (or
        # generate_tract_centroids.py) against TIGERweb will populate the field.
        missing_iter = (t.get("geoid", "<unknown>") for t in tracts if not t.get("bbox"))
        sample: list[str] = []
        total_missing = 0
        for geoid in missing_iter:
            total_missing += 1
            if len(sample) < 5:
                sample.append(geoid)
        if total_missing:
            log(
                f"[validate] {total_missing} tract(s) missing 'bbox' field "
                f"(e.g. {sample}). These will use centroid-only distance fallback. "
                "Rebuild data to enable polygon-aware buffer intersection.",
                level="WARN",
            )
    n_acs = len(acs.get("tracts", []))
    if n_acs == 0:
        errors.append("acs_tract_metrics_co.json has no tracts (may be empty in offline mode)")
    elif n_acs < 1000:
        errors.append(
            f"acs_tract_metrics_co.json: only {n_acs} tracts (minimum 1000) — "
            "check Census API key and build script"
        )
    if not isinstance(lihtc.get("features"), list):
        warnings.append("hud_lihtc_co.geojson has no features array")
    n_bounds = len(boundaries.get("features", []))
    if n_bounds == 0:
        warnings.append(
            "tract_boundaries_co.geojson has no features (TIGERweb may be temporarily "
            "unavailable - choropleth rendering will be degraded)"
        )
    elif n_bounds < 1000:
        warnings.append(
            f"tract_boundaries_co.geojson: only {n_bounds} features (minimum 1000) — "
            "check TIGERweb availability"
        )
    return errors, warnings


# ── Write helpers ──────────────────────────────────────────────────────────────

def write_json(path: Path, obj: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=2, ensure_ascii=False)
    try:
        size = path.stat().st_size
    except OSError:
        size = 0
    if size == 0:
        raise RuntimeError(f"Failed to write {path}: file is missing or empty after write")
    log(f"wrote {path.relative_to(ROOT)} ({size:,} bytes)")


# ── Orchestration helpers ──────────────────────────────────────────────────────

# Map of supplemental data source scripts to their output files.
# Each entry: (script_path, output_file, phase)
# Phases: 1=critical, 2=high-priority, 3=policy-overlays
SUPPLEMENTAL_SOURCES = [
    # Phase 1
    ("scripts/market/fetch_schools.py",            "schools_co.geojson",              1),
    ("scripts/market/fetch_opportunity_zones.py",  "opportunity_zones_co.geojson",    1),
    ("scripts/market/fetch_parcel_data.py",        "parcel_aggregates_co.json",       1),
    # Phase 2
    ("scripts/market/fetch_gtfs_transit.py",       "transit_routes_co.geojson",       2),
    ("scripts/market/fetch_walkability.py",         "walkability_scores_co.json",      2),
    ("scripts/market/fetch_flood_zones.py",         "flood_zones_co.geojson",          2),
    ("scripts/market/fetch_food_access.py",         "food_access_co.json",             2),
    ("scripts/market/fetch_qct_dda.py",             "qct_dda_designations_co.json",    2),
    ("scripts/market/fetch_utility_capacity.py",    "utility_capacity_co.geojson",     2),
    ("scripts/market/fetch_zoning.py",              "zoning_compat_index_co.json",     2),
    # Phase 3
    ("scripts/market/fetch_chfa_programs.py",       "chfa_programs_co.json",           3),
    ("scripts/market/fetch_inclusionary_zoning.py", "inclusionary_zoning_co.json",     3),
    ("scripts/market/fetch_climate_and_environment.py",
                                                    "climate_hazards_co.json",         3),
]


def run_supplemental_sources(phase: int | None = None, dry_run: bool = False) -> list[str]:
    """Invoke supplemental data source scripts as subprocesses.

    Parameters
    ----------
    phase:    If set, only run scripts for this phase (1, 2, or 3).
              If None, run all phases.
    dry_run:  If True, log which scripts would run without executing them.

    Returns a list of scripts that failed (empty = all OK).
    """
    import subprocess

    failed = []
    for script_rel, output_file, script_phase in SUPPLEMENTAL_SOURCES:
        if phase is not None and script_phase != phase:
            continue
        script_path = ROOT / script_rel
        if not script_path.exists():
            log(f"[supplemental] Script not found: {script_rel}", level="WARN")
            continue
        output_path = OUT_DIR / output_file
        if dry_run:
            log(f"[dry-run] Would run: {script_rel} → {output_file}")
            continue
        log(f"[supplemental] Running phase {script_phase}: {script_rel}")
        try:
            result = subprocess.run(
                [sys.executable, str(script_path)],
                capture_output=True,
                text=True,
                timeout=300,
            )
            if result.returncode == 0:
                n_bytes = output_path.stat().st_size if output_path.exists() else 0
                log(f"  ✓ {output_file} ({n_bytes:,} bytes)")
            else:
                log(f"  ✗ {script_rel} exited {result.returncode}: "
                    f"{result.stderr.strip()[-200:]}", level="WARN")
                failed.append(script_rel)
        except Exception as exc:
            log(f"  ✗ {script_rel} exception: {exc}", level="WARN")
            failed.append(script_rel)

    return failed


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    import argparse
    parser = argparse.ArgumentParser(description="PMA Market Data Builder")
    parser.add_argument(
        "--phase", type=int, choices=[1, 2, 3], default=None,
        help="Run supplemental sources for a specific phase only (1/2/3)",
    )
    parser.add_argument(
        "--supplemental-only", action="store_true",
        help="Skip core TIGERweb/ACS/LIHTC build; only run supplemental sources",
    )
    parser.add_argument(
        "--supplemental", action="store_true",
        help="Also run supplemental data source scripts after core build",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Log what would run without executing supplemental scripts",
    )
    parser.add_argument(
        "--allow-partial", action="store_true",
        help=(
            "Allow build to exit 0 even when non-core sources (TIGERweb boundaries, "
            "HUD LIHTC) are unavailable.  Critical failures (empty centroids or ACS) "
            "still cause exit code 1.  This flag is also auto-enabled when core data "
            "(centroids + ACS) is present, so transient API outages do not block CI."
        ),
    )
    args = parser.parse_args()

    print("=" * 60)
    print(f"PMA Market Data Builder — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC")
    print("=" * 60)

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    if not args.supplemental_only:
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
        # Fall back to existing file if fetch returned too few tracts (< 1000 means partial/failed fetch)
        if len(acs.get("tracts", [])) < 1000:
            existing = OUT_DIR / "acs_tract_metrics_co.json"
            if existing.exists():
                saved = json.loads(existing.read_text())
                if len(saved.get("tracts", [])) >= 1000:
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

        # 4. Tract boundary GeoJSON (for choropleth map)
        try:
            boundaries = build_tract_boundaries()
        except Exception as e:
            log(f"Tract boundaries failed: {e}", level="ERROR")
            boundaries = {"type": "FeatureCollection", "meta": {}, "features": []}
        # Fall back to existing file if fetch returned no features
        if not boundaries.get("features"):
            existing = OUT_DIR / "tract_boundaries_co.geojson"
            if existing.exists():
                saved = json.loads(existing.read_text())
                if saved.get("features"):
                    boundaries = saved
                    log("[fallback] Using existing tract_boundaries_co.geojson")

        # Write artifacts
        log("[Write] Saving artifacts…")
        write_json(OUT_DIR / "tract_centroids_co.json", centroids)
        write_json(OUT_DIR / "acs_tract_metrics_co.json", acs)
        write_json(OUT_DIR / "hud_lihtc_co.geojson", lihtc)
        write_json(OUT_DIR / "tract_boundaries_co.geojson", boundaries)

        # Validate
        errors, warnings = validate(centroids, acs, lihtc, boundaries)

        # Auto-enable partial mode when core data (centroids + ACS) is present
        # but non-core sources (TIGERweb boundaries, HUD LIHTC) are unavailable.
        # This allows the build to succeed gracefully during transient API outages.
        core_present = bool(centroids.get("tracts")) and bool(acs.get("tracts"))
        effective_allow_partial = args.allow_partial or core_present

        if warnings:
            print("\n[VALIDATION WARNINGS]")
            for w in warnings:
                print(f"  ⚠ {w}")
        if errors:
            print("\n[VALIDATION ERRORS]")
            for e in errors:
                print(f"  ✗ {e}")
            if not (args.supplemental or args.supplemental_only):
                sys.exit(1)
        elif warnings and not effective_allow_partial and not (args.supplemental or args.supplemental_only):
            print(
                "\n[PARTIAL BUILD] Some non-core data is unavailable (see warnings above)."
                "\n  Re-run with --allow-partial to suppress this exit code, or"
                "\n  wait for external services to recover and rebuild."
            )
            sys.exit(1)
        else:
            if warnings:
                print(
                    "\n✓ Core artifacts validated successfully (degraded: non-core sources unavailable)."
                )
            else:
                print("\n✓ All core artifacts validated successfully.")
            print(f"  Tracts:            {len(centroids.get('tracts', []))}")
            print(f"  ACS records:       {len(acs.get('tracts', []))}")
            print(f"  LIHTC projects:    {len(lihtc.get('features', []))}")
            print(f"  Boundary features: {len(boundaries.get('features', []))}")

    # ── Supplemental sources ──────────────────────────────────────────────────
    if args.supplemental or args.supplemental_only:
        print(f"\n{'=' * 60}")
        phase_label = f"phase {args.phase}" if args.phase else "all phases"
        print(f"[Supplemental] Running {phase_label} data sources…")
        print("=" * 60)
        failed = run_supplemental_sources(phase=args.phase, dry_run=args.dry_run)

        if failed:
            log(f"[Supplemental] {len(failed)} script(s) failed: {failed}", level="WARN")
        else:
            log(f"[Supplemental] All supplemental scripts completed successfully")

        # Run data quality validator
        if not args.dry_run:
            validator = ROOT / "scripts" / "market" / "data_quality_validator.py"
            if validator.exists():
                import subprocess
                log("[Supplemental] Running data quality validator…")
                subprocess.run(
                    [sys.executable, str(validator), "--warn-only"],
                    capture_output=False,
                    timeout=60,
                )



if __name__ == "__main__":
    main()
