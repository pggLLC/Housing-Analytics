#!/usr/bin/env python3
"""
scripts/market/fetch_parcel_data.py

Aggregate county assessor parcel data for Colorado to support land feasibility
and supply assessment in the PMA scoring engine.

Data sources:
  - Colorado counties with open parcel data APIs (Jefferson, Denver, Arapahoe,
    Adams, Boulder via ArcGIS REST FeatureServers)
  - Statewide: Colorado Division of Property Taxation public records

Output:
    data/market/parcel_aggregates_co.json

Usage:
    python3 scripts/market/fetch_parcel_data.py

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
OUT_FILE = ROOT / "data" / "market" / "parcel_aggregates_co.json"

STATE_FIPS = "08"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_parcel_cache"
CACHE_TTL_HOURS = 168  # 1 week

# County assessor ArcGIS FeatureServer endpoints (public)
# Each entry: (county_fips, county_name, layer_url, key_field)
COUNTY_SOURCES = [
    (
        "08059",
        "Jefferson",
        "https://maps.jeffco.us/arcgis/rest/services/Assessor/PublicParcels/MapServer/0",
        "ZONE_CODE",
    ),
    (
        "08031",
        "Denver",
        "https://www.denvergov.org/arcgis/rest/services/OpenData/mapa_assessment/MapServer/0",
        "ZONE_DESC",
    ),
    (
        "08005",
        "Arapahoe",
        "https://gis.arapahoegov.com/arcgis/rest/services/OpenData/Parcels/FeatureServer/0",
        "ZONE_TYPE",
    ),
    (
        "08001",
        "Adams",
        "https://gis.adcogov.com/arcgis/rest/services/Assessor/Parcels/FeatureServer/0",
        "ZONE_CODE",
    ),
    (
        "08013",
        "Boulder",
        "https://gisweb.bouldercounty.org/arcgis/rest/services/Assessor/Parcels/FeatureServer/0",
        "ZONING",
    ),
    (
        "08041",
        "El Paso",
        "https://gis.elpasoco.com/arcgis/rest/services/Assessor/Parcels/FeatureServer/0",
        "ZONE_CODE",
    ),
    (
        "08123",
        "Weld",
        "https://gis.weldgov.com/arcgis/rest/services/Assessor/Parcels/FeatureServer/0",
        "ZONE_TYPE",
    ),
    (
        "08069",
        "Larimer",
        "https://gis.larimer.org/arcgis/rest/services/Assessor/Parcels/FeatureServer/0",
        "ZONE_CODE",
    ),
]

# Land use codes indicating residential development potential
RESIDENTIAL_ZONE_PREFIXES = ("R", "MF", "MU", "RES", "RS", "RM", "RH", "RR")


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)


def _cache_key(url: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.md5(url.encode()).hexdigest()
    return CACHE_DIR / key


def fetch_url(url: str, retries: int = 3, timeout: int = 60) -> bytes:
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
                log(f"[retry {attempt+1}/{retries-1}] {exc} — waiting {wait}s", level="WARN")
                time.sleep(wait)
    raise RuntimeError(f"Failed after {retries} attempts: {last_err} | URL: {url[:120]}")


def query_county_parcels(layer_url: str, zone_field: str) -> list:
    """Query a county ArcGIS parcel FeatureServer for aggregate statistics."""
    params = urllib.parse.urlencode({
        "where": "1=1",
        "outFields": f"OBJECTID,{zone_field},Shape_Area",
        "returnGeometry": "false",
        "f": "json",
        "outSR": "4326",
        "resultRecordCount": "5000",
        "returnCountOnly": "false",
    })
    url = f"{layer_url}/query?{params}"
    raw = fetch_url(url, timeout=60)
    data = json.loads(raw)

    if isinstance(data, dict) and "error" in data:
        err = data["error"]
        raise RuntimeError(f"ArcGIS error {err.get('code')}: {err.get('message')}")

    return data.get("features", [])


def aggregate_county(
    county_fips: str,
    county_name: str,
    layer_url: str,
    zone_field: str,
) -> dict:
    """Return aggregate parcel statistics for one county."""
    log(f"Fetching parcel data for {county_name} County ({county_fips})…")
    try:
        features = query_county_parcels(layer_url, zone_field)
    except Exception as exc:
        log(f"  ✗ {county_name}: {exc}", level="WARN")
        return _empty_county_record(county_fips, county_name)

    total = len(features)
    residential = 0
    vacant_res = 0
    total_area_sqft = 0.0

    for feat in features:
        attrs = feat.get("attributes") or {}
        zone = str(attrs.get(zone_field, "") or "").upper()
        area = float(attrs.get("Shape_Area", 0) or 0)
        total_area_sqft += area

        if any(zone.startswith(pfx) for pfx in RESIDENTIAL_ZONE_PREFIXES):
            residential += 1
            if "VAC" in zone or "VACANT" in zone or "UNDEVELOPED" in zone:
                vacant_res += 1

    log(f"  ✓ {county_name}: {total} parcels, {residential} residential")
    return {
        "county_fips":       county_fips,
        "county_name":       county_name,
        "total_parcels":     total,
        "residential_parcels": residential,
        "vacant_residential": vacant_res,
        "pct_residential":   round(residential / total, 4) if total else 0.0,
        "avg_area_sqft":     round(total_area_sqft / total, 1) if total else 0.0,
        "data_source":       layer_url,
    }


def _empty_county_record(county_fips: str, county_name: str) -> dict:
    return {
        "county_fips":        county_fips,
        "county_name":        county_name,
        "total_parcels":      0,
        "residential_parcels": 0,
        "vacant_residential":  0,
        "pct_residential":    0.0,
        "avg_area_sqft":      0.0,
        "data_source":        None,
        "note":               "fetch failed — check county ArcGIS endpoint",
    }


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    generated = utc_now()

    counties = []
    successful = 0
    for county_fips, county_name, layer_url, zone_field in COUNTY_SOURCES:
        record = aggregate_county(county_fips, county_name, layer_url, zone_field)
        counties.append(record)
        if record["total_parcels"] > 0:
            successful += 1
        time.sleep(0.5)  # gentle rate-limit

    result = {
        "meta": {
            "source": "County Assessor ArcGIS FeatureServers (public)",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": "2025",
            "generated": generated,
            "counties_attempted": len(COUNTY_SOURCES),
            "counties_successful": successful,
            "coverage_pct": round(successful / len(COUNTY_SOURCES) * 100, 1),
            "note": (
                "Aggregated parcel statistics per county. "
                "Rebuild via scripts/market/fetch_parcel_data.py"
            ),
        },
        "counties": counties,
    }

    # Fallback to existing file if no data fetched
    if successful == 0 and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text())
        if existing.get("counties"):
            log("[fallback] Using existing parcel_aggregates_co.json", level="WARN")
            result = existing

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    log(f"✓ Wrote {len(counties)} county records to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
