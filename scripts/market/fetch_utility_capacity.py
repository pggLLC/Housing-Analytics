#!/usr/bin/env python3
"""
scripts/market/fetch_utility_capacity.py

Fetch Colorado utility capacity data (water/sewer service areas) to support
infrastructure feasibility scoring in the PMA engine.

Sources:
  - Colorado Decision Support Systems (CDSS) water district polygons
  - Colorado Division of Water Resources service area GIS data
  - Municipal utility service area boundary layers

Output:
    data/market/utility_capacity_co.geojson

Usage:
    python3 scripts/market/fetch_utility_capacity.py

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
OUT_FILE = ROOT / "data" / "market" / "utility_capacity_co.geojson"

STATE_FIPS = "08"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_utility_cache"
CACHE_TTL_HOURS = 720  # 30 days

# Colorado CDSS / DWR public ArcGIS REST endpoints
SOURCES = [
    {
        "name": "CDSS Water Districts",
        "url": (
            "https://geoserver.state.co.us/geoserver/cwcb/wfs?"
            "service=WFS&version=2.0.0&request=GetFeature"
            "&typeNames=cwcb:water_districts&outputFormat=application/json"
        ),
        "utility_type": "water_district",
    },
    {
        "name": "DOLA Service Areas",
        "url": (
            "https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/"
            "Colorado_Municipal_Boundaries/FeatureServer/0"
        ),
        "utility_type": "municipal_boundary",
    },
]

# Capacity index lookup by utility type (normalized 0–1)
# Higher = more constrained capacity
CAPACITY_CONSTRAINTS = {
    "water_district":    {"constraint_level": "variable", "notes": "Check local tap fees"},
    "municipal_boundary": {"constraint_level": "moderate", "notes": "Refer to capital improvement plan"},
}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)


def _cache_key(url: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.md5(url.encode()).hexdigest()
    return CACHE_DIR / key


def fetch_url(url: str, retries: int = 3, timeout: int = 90) -> bytes:
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
    raise RuntimeError(f"Failed after {retries} attempts: {last_err}")


def arcgis_query_features(layer_url: str, offset: int = 0, limit: int = 2000) -> dict:
    """Query an ArcGIS FeatureServer and return GeoJSON."""
    params = urllib.parse.urlencode({
        "where": "1=1",
        "outFields": "*",
        "returnGeometry": "true",
        "f": "geojson",
        "outSR": "4326",
        "resultRecordCount": str(limit),
        "resultOffset": str(offset),
        "geometryPrecision": "5",
    })
    url = f"{layer_url}/query?{params}"
    raw = fetch_url(url, timeout=90)
    data = json.loads(raw)
    if isinstance(data, dict) and "error" in data:
        err = data["error"]
        raise RuntimeError(f"ArcGIS error {err.get('code')}: {err.get('message')}")
    return data


def fetch_source_features(source: dict) -> list:
    """Fetch features from one utility data source."""
    name = source["name"]
    url = source["url"]
    utility_type = source["utility_type"]
    meta = CAPACITY_CONSTRAINTS.get(utility_type, {})

    log(f"Fetching {name}…")
    features = []
    offset = 0
    page = 0
    while True:
        page += 1
        try:
            if "/query" in url or "FeatureServer" in url:
                data = arcgis_query_features(url, offset=offset)
            else:
                # WFS or direct GeoJSON
                raw = fetch_url(url, timeout=120)
                data = json.loads(raw)
            raw_feats = data.get("features", [])
        except Exception as exc:
            log(f"  ✗ {name} page {page}: {exc}", level="WARN")
            break

        for f in raw_feats:
            props = f.get("properties") or {}
            props["utility_type"] = utility_type
            props["data_source"] = name
            props["constraint_level"] = meta.get("constraint_level", "unknown")
            props["notes"] = meta.get("notes", "")
            features.append(f)

        log(f"  Page {page}: {len(raw_feats)} features (total {len(features)})")
        if not raw_feats or not data.get("exceededTransferLimit"):
            break
        offset += len(raw_feats)

    return features


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    generated = utc_now()

    all_features = []
    sources_ok = []

    for source in SOURCES:
        feats = fetch_source_features(source)
        if feats:
            all_features.extend(feats)
            sources_ok.append(source["name"])
        time.sleep(0.5)

    result = {
        "type": "FeatureCollection",
        "meta": {
            "source": "Colorado CDSS / DWR / DOLA utility service areas (public)",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": generated[:10],
            "generated": generated,
            "feature_count": len(all_features),
            "sources_successful": sources_ok,
            "coverage_pct": round(len(sources_ok) / len(SOURCES) * 100, 1),
            "note": (
                "Water/sewer service area boundaries for infrastructure feasibility. "
                "Rebuild via scripts/market/fetch_utility_capacity.py"
            ),
        },
        "features": all_features,
    }

    # Fallback to existing file
    if not all_features and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text())
        if existing.get("features"):
            log("[fallback] Using existing utility_capacity_co.geojson", level="WARN")
            result = existing

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    n = len(result.get("features", []))
    log(f"✓ Wrote {n} utility service area features to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
