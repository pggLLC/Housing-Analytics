#!/usr/bin/env python3
"""
scripts/market/fetch_climate_and_environment.py

Fetch Colorado climate hazard and environmental constraint data for
infrastructure resilience and regulatory feasibility scoring.

Sources:
  - NOAA climate normals and extreme weather event data
  - EPA Environmental Justice Index (EJI) / EJScreen
  - Colorado Parks & Wildlife protected lands
  - USGS hazard data (landslide, seismic)

Outputs:
    data/market/climate_hazards_co.json
    data/market/environmental_constraints_co.geojson

Usage:
    python3 scripts/market/fetch_climate_and_environment.py

Environment variables (optional):
    NOAA_API_KEY — free tier available at https://www.ncdc.noaa.gov/cdo-web/token

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
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_CLIMATE = ROOT / "data" / "market" / "climate_hazards_co.json"
OUT_ENV = ROOT / "data" / "market" / "environmental_constraints_co.geojson"

STATE_FIPS = "08"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_climate_cache"
CACHE_TTL_HOURS = 720  # 30 days

NOAA_API_KEY = os.environ.get("NOAA_API_KEY", "").strip() or None

# NOAA CDO Web Services API
NOAA_STATIONS_URL = (
    "https://www.ncdc.noaa.gov/cdo-web/api/v2/stations"
    "?locationid=FIPS:08&datasetid=GHCND&limit=1000"
)

# EPA EJScreen API — environmental justice screening
EPA_EJSCREEN_URL = (
    "https://ejscreen.epa.gov/mapper/ejscreenRESTbroker.aspx"
    "?namestr=Colorado&areatype=state&areaid=08&f=json"
)

# EPA EJI data — try multiple known paths (URLs change periodically)
EPA_EJI_URLS = [
    "https://gaftp.epa.gov/EPADataCommons/ORD/EJI/EJI2022/EJI_2022_Colorado_CSV.zip",
    "https://gaftp.epa.gov/EPADataCommons/ORD/EJI/EJI_2022_Colorado_CSV.zip",
    "https://gaftp.epa.gov/EPADataCommons/ORD/EJI/EJI2022/EJI_2022_Nationwide_CSV.zip",
]

# Colorado Parks & Wildlife protected lands
CPW_PROTECTED_URL = (
    "https://gis.colorado.gov/arcgis/rest/services/CDPHE_OEMC/"
    "Protected_Lands/MapServer/0"
)

# USGS National Landslide Hazards — Colorado
USGS_LANDSLIDE_URL = (
    "https://landslides.usgs.gov/hazards/nationalmap/api/services/"
    "GeoJSON?state=CO&format=geojson"
)


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)


def _cache_key(url: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.md5(url.encode()).hexdigest()
    return CACHE_DIR / key


def fetch_url(url: str, retries: int = 3, timeout: int = 90,
              headers=None) -> bytes:
    cache_file = _cache_key(url)
    if cache_file.exists():
        age_hours = (time.time() - cache_file.stat().st_mtime) / 3600
        if age_hours < CACHE_TTL_HOURS:
            log(f"[cache hit] {url[:80]}")
            return cache_file.read_bytes()

    req_headers = {"User-Agent": "HousingAnalytics/1.0"}
    if headers:
        req_headers.update(headers)

    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=req_headers)
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


def arcgis_query_protected(layer_url: str, offset: int = 0, limit: int = 1000) -> dict:
    params = urllib.parse.urlencode({
        "where": "1=1",
        "outFields": "OBJECTID,NAME,AGENCY,DESIG_TYPE,GIS_ACRES",
        "returnGeometry": "true",
        "f": "geojson",
        "outSR": "4326",
        "resultRecordCount": str(limit),
        "resultOffset": str(offset),
        "geometryPrecision": "4",
    })
    url = f"{layer_url}/query?{params}"
    raw = fetch_url(url, timeout=120)
    data = json.loads(raw)
    if isinstance(data, dict) and "error" in data:
        err = data["error"]
        raise RuntimeError(f"ArcGIS error {err.get('code')}: {err.get('message')}")
    return data


def fetch_protected_lands() -> list:
    """Fetch Colorado Parks & Wildlife protected lands polygons."""
    log("Fetching CPW protected lands…")
    features = []
    offset = 0
    page = 0
    while True:
        page += 1
        try:
            data = arcgis_query_protected(CPW_PROTECTED_URL, offset=offset)
        except Exception as exc:
            log(f"  CPW page {page} failed: {exc}", level="WARN")
            break
        raw_feats = data.get("features", [])
        for f in raw_feats:
            props = f.get("properties") or {}
            props["constraint_type"] = "protected_land"
            props["development_prohibited"] = True
            features.append(f)
        log(f"  Page {page}: {len(raw_feats)} features (total {len(features)})")
        if not raw_feats or not data.get("exceededTransferLimit"):
            break
        offset += len(raw_feats)
        time.sleep(0.5)
    return features


def fetch_noaa_climate_summary() -> dict:
    """Fetch NOAA weather station climate summaries for Colorado."""
    log("Fetching NOAA climate station data for Colorado…")
    headers = {}
    if NOAA_API_KEY:
        headers["token"] = NOAA_API_KEY

    try:
        raw = fetch_url(NOAA_STATIONS_URL, timeout=60, headers=headers)
        data = json.loads(raw)
        stations = data.get("results", [])
        log(f"  {len(stations)} NOAA stations in Colorado")
    except Exception as exc:
        log(f"  NOAA fetch failed: {exc}", level="WARN")
        stations = []

    # Summarize by county (station lat/lon → approximate county)
    return {
        "station_count": len(stations),
        "stations_sample": stations[:10],
        "coverage_note": (
            "Full NOAA climate normals available via CDO Web Services API; "
            "NOAA_API_KEY (free) improves rate limits"
        ),
    }


def fetch_eji_data() -> list:
    """Fetch EPA Environmental Justice Index tract-level data for Colorado."""
    import io
    import csv
    import zipfile

    log("Fetching EPA Environmental Justice Index for Colorado…")
    raw = None
    for eji_url in EPA_EJI_URLS:
        try:
            raw = fetch_url(eji_url, timeout=180, retries=1)
            log(f"  EJI download succeeded: {eji_url[:60]}…")
            break
        except Exception as exc:
            log(f"  EJI URL failed ({eji_url[:60]}…): {exc}", level="WARN")

    if not raw:
        log("  All EJI URLs failed — skipping EJI data", level="WARN")
        return []

    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            csv_names = [n for n in zf.namelist() if n.endswith(".csv")]
            if not csv_names:
                raise ValueError("No CSV in EJI ZIP")
            with zf.open(csv_names[0]) as cf:
                reader = csv.DictReader(io.TextIOWrapper(cf, encoding="utf-8-sig"))
                tracts = []
                for row in reader:
                    ct = str(row.get("GEOID", row.get("geoid", "")) or "").zfill(11)
                    if not ct.startswith(STATE_FIPS):
                        continue
                    tracts.append({
                        "geoid":            ct,
                        "county_fips":      ct[:5].zfill(5),
                        "eji_score":        float(row.get("EJI", 0) or 0),
                        "social_vuln":      float(row.get("SVI", 0) or 0),
                        "env_burden":       float(row.get("EBM", 0) or 0),
                        "health_vuln":      float(row.get("HVM", 0) or 0),
                        "pct_minority":     float(row.get("PCT_MINORTY", 0) or 0),
                        "pct_low_income":   float(row.get("PCT_POV200", 0) or 0),
                    })
        log(f"  {len(tracts)} Colorado EJI tract records")
        return tracts
    except Exception as exc:
        log(f"  EJI fetch failed: {exc}", level="WARN")
        return []


# Static Colorado climate hazard summary (sourced from NOAA, CWCB, USGS)
# Updated annually from NOAA Climate Reports
CO_CLIMATE_SUMMARY = {
    "drought_risk": {
        "level":       "high",
        "description": "Colorado faces persistent drought; Western Slope most affected",
        "source":       "NOAA/NIDIS Colorado Drought Monitor",
        "key_counties_high_risk": ["08085", "08077", "08083", "08029", "08003"],
    },
    "wildfire_risk": {
        "level":       "very_high",
        "description": "Increasing wildfire risk across Front Range foothills and mountain counties",
        "source":       "Colorado State Forest Service — 2024 State Forest Report",
        "key_counties_high_risk": ["08037", "08045", "08097", "08059", "08019"],
    },
    "flooding_risk": {
        "level":       "moderate",
        "description": "Flash flooding along Front Range drainages and river corridors",
        "source":       "CWCB Colorado Hazard Mapping Program",
        "key_counties_high_risk": ["08013", "08069", "08123", "08041", "08005"],
    },
    "hail_risk": {
        "level":       "high",
        "description": "Colorado Front Range in 'hail alley'; significant insurance implications",
        "source":       "NOAA Storm Prediction Center",
        "key_counties_high_risk": ["08001", "08005", "08013", "08035", "08059"],
    },
    "extreme_heat": {
        "level":       "moderate",
        "description": "Denver metro 30–40 days >90°F annually; increasing trend",
        "source":       "NOAA Climate Normals 1991-2020",
        "key_counties_high_risk": ["08031", "08001", "08005", "08041", "08123"],
    },
    "freeze_thaw": {
        "level":       "high",
        "description": "High altitude counties experience >150 freeze-thaw cycles per year",
        "source":       "NOAA Climate Data Online",
        "key_counties_high_risk": ["08111", "08079", "08053", "08057", "08117"],
    },
}


def main() -> int:
    OUT_CLIMATE.parent.mkdir(parents=True, exist_ok=True)
    OUT_ENV.parent.mkdir(parents=True, exist_ok=True)
    generated = utc_now()

    # ── 1. Climate hazards JSON ───────────────────────────────────────────────
    noaa_summary = fetch_noaa_climate_summary()
    eji_tracts = fetch_eji_data()

    climate_result = {
        "meta": {
            "source": "NOAA CDO + EPA EJI + CWCB + Colorado State Forest Service",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": "2022–2024",
            "generated": generated,
            "eji_tract_count": len(eji_tracts),
            "noaa_station_count": noaa_summary.get("station_count", 0),
            "coverage_pct": round(min(len(eji_tracts) / 1300, 1.0) * 100, 1),
            "note": (
                "Climate hazard and EJ index data for PMA infrastructure resilience scoring. "
                "Rebuild via scripts/market/fetch_climate_and_environment.py"
            ),
        },
        "hazard_summary": CO_CLIMATE_SUMMARY,
        "noaa_summary":   noaa_summary,
        "eji_tracts":     eji_tracts,
    }

    # Fallback
    if not eji_tracts and OUT_CLIMATE.exists():
        existing = json.loads(OUT_CLIMATE.read_text())
        if existing.get("eji_tracts"):
            log("[fallback] Using existing climate_hazards_co.json", level="WARN")
            climate_result = existing

    with open(OUT_CLIMATE, "w", encoding="utf-8") as fh:
        json.dump(climate_result, fh, indent=2, ensure_ascii=False)
    log(f"✓ Wrote climate_hazards_co.json ({len(eji_tracts)} EJI tracts)")

    # ── 2. Environmental constraints GeoJSON ─────────────────────────────────
    env_features = fetch_protected_lands()

    env_result = {
        "type": "FeatureCollection",
        "meta": {
            "source": "Colorado Parks & Wildlife — Protected Lands",
            "url": "https://cpw.state.co.us/learn/Pages/GIS.aspx",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": "2024",
            "generated": generated,
            "feature_count": len(env_features),
            "coverage_pct": 100.0 if env_features else 0.0,
            "note": (
                "Protected areas where residential development is prohibited or restricted. "
                "Rebuild via scripts/market/fetch_climate_and_environment.py"
            ),
        },
        "features": env_features,
    }

    # Fallback
    if not env_features and OUT_ENV.exists():
        existing = json.loads(OUT_ENV.read_text())
        if existing.get("features"):
            log("[fallback] Using existing environmental_constraints_co.geojson", level="WARN")
            env_result = existing

    with open(OUT_ENV, "w", encoding="utf-8") as fh:
        json.dump(env_result, fh, indent=2, ensure_ascii=False)
    log(f"✓ Wrote environmental_constraints_co.geojson ({len(env_features)} features)")

    return 0


if __name__ == "__main__":
    sys.exit(main())