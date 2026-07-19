#!/usr/bin/env python3
"""
scripts/market/fetch_opportunity_zones.py

Fetch Colorado Opportunity Zone designations from the HUD CDFI Fund GIS service.

Opportunity Zones are designated census tracts under IRC §1400Z-1/-2 that
provide tax incentives for long-term investment in low-income communities.

Output:
    data/market/opportunity_zones_co.geojson

Usage:
    python3 scripts/market/fetch_opportunity_zones.py

All sources are free and publicly accessible without authentication.
"""

import json
import sys
import time
import hashlib
import math
import tempfile
import zipfile
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

try:
    import shapefile  # pyshp
except ImportError as exc:  # pragma: no cover - exercised by operator env
    raise SystemExit(
        "scripts/market/fetch_opportunity_zones.py requires pyshp "
        "(import name: shapefile) to read the official CDFI shapefile archive."
    ) from exc

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "opportunity_zones_co.geojson"

STATE_FIPS = "08"

CACHE_DIR = Path(tempfile.gettempdir()) / "pma_oz_cache"
CACHE_TTL_HOURS = 720  # 30 days (OZ designations rarely change)

# Official CDFI Fund archive of designated QOZ polygons. The prior ArcGIS
# query returned all Colorado tracts and the old normalizer defaulted them to
# designated=true when no designation flag was present.
CDFI_OZ_ZIP_URL = "https://www.cdfifund.gov/system/files/documents/opportunity-zones=8764.-9-10-2019.zip"
CDFI_OZ_PAGE_URL = "https://www.cdfifund.gov/opportunity-zones"
TREASURY_QOZ_PAGE_URL = (
    "https://home.treasury.gov/policy-issues/tax-policy/"
    "data-transparency/qualified-opportunity-zones"
)
EXPECTED_CO_QOZ_COUNT = 126
WEB_MERCATOR_RADIUS = 6378137.0


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def review_by(days: int = 90) -> str:
    return (datetime.now(timezone.utc).date() + timedelta(days=days)).isoformat()


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


def web_mercator_to_lonlat(x: float, y: float) -> list[float]:
    lon = (x / WEB_MERCATOR_RADIUS) * 180.0 / math.pi
    lat = (2.0 * math.atan(math.exp(y / WEB_MERCATOR_RADIUS)) - math.pi / 2.0) * 180.0 / math.pi
    return [round(lon, 12), round(lat, 12)]


def transform_geometry(geometry: dict) -> dict:
    def tx_coords(coords):
        if not coords:
            return coords
        first = coords[0]
        if isinstance(first, (int, float)):
            return web_mercator_to_lonlat(coords[0], coords[1])
        return [tx_coords(child) for child in coords]

    return {
        "type": geometry.get("type"),
        "coordinates": tx_coords(geometry.get("coordinates")),
    }


def build_opportunity_zones() -> dict:
    """Fetch Colorado Opportunity Zone polygons from the official CDFI archive."""
    log("Fetching official CDFI Fund Opportunity Zone shapefile archive…")
    generated = utc_now()

    archive = fetch_url(CDFI_OZ_ZIP_URL, timeout=120)
    co_features = []
    with tempfile.TemporaryDirectory(prefix="cdfi-oz-") as tmp:
        zip_path = Path(tmp) / "opportunity-zones.zip"
        zip_path.write_bytes(archive)
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(tmp)
        reader = shapefile.Reader(str(Path(tmp) / "8764oz.shp"))
        field_names = [field[0] for field in reader.fields[1:]]
        for shape_record in reader.iterShapeRecords():
            props = dict(zip(field_names, shape_record.record))
            geoid = str(props.get("CENSUSTRAC", "")).zfill(11)
            if not geoid.startswith(STATE_FIPS):
                continue
            co_features.append({
                "type": "Feature",
                "geometry": transform_geometry(shape_record.shape.__geo_interface__),
                "properties": {
                    "geoid": geoid,
                    "county_fips": geoid[:5],
                    "county_name": props.get("COUNTYNAME"),
                    "designated": True,
                    "oz_type": "QOZ",
                    "state_fips": STATE_FIPS,
                    "source_vintage": "2018 designations",
                },
            })

    log(f"Built {len(co_features)} Colorado Opportunity Zone features")
    if len(co_features) != EXPECTED_CO_QOZ_COUNT:
        raise RuntimeError(
            f"Expected {EXPECTED_CO_QOZ_COUNT} Colorado designated QOZ tracts; "
            f"built {len(co_features)}"
        )

    return {
        "type": "FeatureCollection",
        "meta": {
            "source": "CDFI Fund — Designated Qualified Opportunity Zones shapefile",
            "url": CDFI_OZ_PAGE_URL,
            "source_url": CDFI_OZ_ZIP_URL,
            "related_source_urls": [
                TREASURY_QOZ_PAGE_URL,
                "https://www.irs.gov/irb/2018-28_IRB#NOT-2018-48",
                "https://www.irs.gov/irb/2019-29_IRB#NOTICE-2019-42",
            ],
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": "2018 designations (Notice 2018-48, amplified by Notice 2019-42)",
            "generated": generated,
            "last_verified": generated[:10],
            "review_by": review_by(),
            "feature_count": len(co_features),
            "designated_count": len(co_features),
            "note": "Rebuild via scripts/market/fetch_opportunity_zones.py",
        },
        "features": co_features,
    }


def _empty_geojson(generated: str) -> dict:
    return {
        "type": "FeatureCollection",
        "meta": {
            "source": "CDFI Fund — Designated Qualified Opportunity Zones shapefile",
            "url": CDFI_OZ_PAGE_URL,
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": "2018 designations (Notice 2018-48, amplified by Notice 2019-42)",
            "generated": generated,
            "feature_count": 0,
            "note": "Stub — rebuild via scripts/market/fetch_opportunity_zones.py",
        },
        "features": [],
    }


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    try:
        result = build_opportunity_zones()
    except Exception as exc:
        log(f"Opportunity Zones build failed: {exc}", level="ERROR")
        result = _empty_geojson(utc_now())

    # Fallback to existing file
    if not result.get("features") and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text())
        if existing.get("features"):
            log("[fallback] Using existing opportunity_zones_co.geojson")
            result = existing

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    n = len(result.get("features", []))
    log(f"✓ Wrote {n} features to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
