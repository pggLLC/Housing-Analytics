#!/usr/bin/env python3
"""
scripts/market/fetch_childcare.py

Fetch Colorado licensed child care facility data from the Colorado
Information Marketplace (Socrata SODA API) and geocode addresses
using the Census Bureau batch geocoder.

Output:
    data/market/childcare_co.geojson

Usage:
    python3 scripts/market/fetch_childcare.py

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
import csv
import io
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "childcare_co.geojson"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_childcare_cache"
CACHE_TTL_HOURS = 720  # 30 days

# Colorado Information Marketplace — Licensed Child Care Facilities
SOCRATA_URL = "https://data.colorado.gov/resource/a9rr-k8mu.json"

# Census Bureau Batch Geocoder
CENSUS_GEOCODER_URL = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch"


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
    raise RuntimeError(f"Failed after {retries} attempts: {last_err}")


def fetch_facilities() -> list:
    """Fetch all Colorado licensed child care facilities from Socrata API."""
    log("Fetching child care facilities from Colorado data portal…")
    all_records = []
    offset = 0
    limit = 5000

    while True:
        params = urllib.parse.urlencode({
            "$limit": str(limit),
            "$offset": str(offset),
            "$order": "provider_id",
        })
        url = f"{SOCRATA_URL}?{params}"
        data = json.loads(fetch_url(url))
        if not data:
            break
        all_records.extend(data)
        log(f"  Fetched {len(data)} records (total: {len(all_records)})")
        if len(data) < limit:
            break
        offset += limit
        time.sleep(0.3)

    log(f"Total child care facilities: {len(all_records)}")
    return all_records


def batch_geocode(records: list) -> dict:
    """Geocode addresses using Census Bureau batch geocoder.

    Returns dict: provider_id -> (lat, lon)
    Max 10,000 per batch. We split into chunks.
    """
    log("Geocoding addresses via Census Bureau batch geocoder…")
    results = {}
    chunk_size = 1000  # Census recommends ≤10K, use 1K for reliability
    addressable = []

    for rec in records:
        pid = rec.get("provider_id", "")
        addr = rec.get("street_address", "").strip()
        city = rec.get("city", "").strip()
        state = rec.get("state", "CO").strip()
        zipcode = str(rec.get("zip", "")).strip()[:5]

        if addr and city:
            addressable.append((pid, addr, city, state, zipcode))

    log(f"  {len(addressable)} facilities have geocodable addresses")

    for i in range(0, len(addressable), chunk_size):
        chunk = addressable[i : i + chunk_size]
        # Build CSV for batch geocoder
        csv_buf = io.StringIO()
        for pid, addr, city, state, zipcode in chunk:
            csv_buf.write(f"{pid},{addr},{city},{state},{zipcode}\n")
        csv_data = csv_buf.getvalue().encode("utf-8")

        # Check cache
        cache_key = hashlib.md5(csv_data).hexdigest()
        cache_file = CACHE_DIR / f"geocode_{cache_key}"
        if cache_file.exists():
            age_hours = (time.time() - cache_file.stat().st_mtime) / 3600
            if age_hours < CACHE_TTL_HOURS:
                log(f"  [cache hit] geocode chunk {i // chunk_size + 1}")
                response_text = cache_file.read_text()
                _parse_geocode_response(response_text, results)
                continue

        # POST to Census geocoder
        boundary = "----FormBoundary7MA4YWxkTrZu0gW"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="addressFile"; filename="addresses.csv"\r\n'
            f"Content-Type: text/csv\r\n\r\n"
            f"{csv_buf.getvalue()}\r\n"
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="benchmark"\r\n\r\n'
            f"Public_AR_Current\r\n"
            f"--{boundary}--\r\n"
        ).encode("utf-8")

        req = urllib.request.Request(
            CENSUS_GEOCODER_URL,
            data=body,
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "User-Agent": "HousingAnalytics/1.0",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                response_text = resp.read().decode("utf-8", errors="replace")
            cache_file.write_text(response_text)
            matched = _parse_geocode_response(response_text, results)
            log(f"  Chunk {i // chunk_size + 1}: geocoded {matched}/{len(chunk)}")
        except Exception as exc:
            log(f"  Chunk {i // chunk_size + 1} geocode failed: {exc}", level="WARN")

        time.sleep(1)  # Rate limit

    log(f"  Geocoded {len(results)} / {len(addressable)} facilities")
    return results


def _parse_geocode_response(text: str, results: dict) -> int:
    """Parse Census batch geocoder CSV response into results dict.

    Response format per row:
    "id","input_address","Match|No_Match","Exact|Non_Exact","matched_address","lon,lat","tiger_id","side"
    Note: coordinates are in a SINGLE field as "lon,lat" (not separate columns).
    """
    matched = 0
    reader = csv.reader(io.StringIO(text))
    for row in reader:
        if len(row) < 6:
            continue
        pid = row[0].strip('"').strip()
        match_type = row[2].strip('"').strip()
        if match_type == "Match":
            try:
                # Coordinates are in field 5 as "lon,lat"
                coord_str = row[5].strip('"').strip()
                lon_str, lat_str = coord_str.split(",")
                lon = float(lon_str)
                lat = float(lat_str)
                # Validate Colorado bounds
                if 36.9 <= lat <= 41.1 and -109.1 <= lon <= -102.0:
                    results[pid] = (lat, lon)
                    matched += 1
            except (ValueError, IndexError):
                pass
    return matched


def build_geojson(records: list, coords: dict) -> dict:
    """Build GeoJSON from facility records + geocoded coordinates."""
    features = []

    for rec in records:
        pid = rec.get("provider_id", "")
        if pid not in coords:
            continue
        lat, lon = coords[pid]

        name = rec.get("provider_name", "").strip()
        if not name:
            continue

        capacity = int(rec.get("total_licensed_capacity") or 0)
        svc_type = rec.get("provider_service_type", "")

        features.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "name": name,
                "provider_id": pid,
                "type": svc_type,
                "capacity": capacity,
                "city": rec.get("city", ""),
                "county": rec.get("county", ""),
                "zip": str(rec.get("zip", ""))[:5],
                "quality_rating": rec.get("quality_rating", ""),
                "infant_capacity": int(rec.get("licensed_infant_capacity") or 0),
                "toddler_capacity": int(rec.get("licensed_toddler_capacity") or 0),
                "preschool_capacity": int(rec.get("licensed_preschool_capacity") or 0),
                "school_age_capacity": int(rec.get("licensed_school_age_capacity") or 0),
                "cccap_status": rec.get("cccap_authorization_status", ""),
                "source": "CO CDHS via data.colorado.gov",
            },
        })

    return features


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    generated = utc_now()

    records = fetch_facilities()
    if not records:
        log("No facilities fetched — writing empty stub", level="WARN")
        result = {
            "type": "FeatureCollection",
            "meta": {"generated": generated, "feature_count": 0},
            "features": [],
        }
        with open(OUT_FILE, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=2)
        return 0

    coords = batch_geocode(records)
    features = build_geojson(records, coords)

    log(f"Total geocoded child care features: {len(features)}")

    # Fallback
    if not features and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text())
        if existing.get("features"):
            log("[fallback] Using existing childcare_co.geojson")
            return 0

    total_capacity = sum(f["properties"]["capacity"] for f in features)
    result = {
        "type": "FeatureCollection",
        "meta": {
            "source": "Colorado CDHS Licensed Child Care Facilities via data.colorado.gov",
            "url": "https://data.colorado.gov/Early-childhood/Colorado-Licensed-Child-Care-Facilities-Report/a9rr-k8mu",
            "state": "Colorado",
            "state_fips": "08",
            "generated": generated,
            "feature_count": len(features),
            "total_facilities_fetched": len(records),
            "geocode_rate": round(len(features) / max(len(records), 1) * 100, 1),
            "total_capacity": total_capacity,
            "note": "Rebuild via scripts/market/fetch_childcare.py",
        },
        "features": features,
    }

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    log(f"✓ Wrote {len(features)} child care features ({total_capacity} total capacity) to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
