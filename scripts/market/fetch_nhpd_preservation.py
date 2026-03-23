#!/usr/bin/env python3
"""
scripts/market/fetch_nhpd_preservation.py

Fetches HUD National Housing Preservation Database (NHPD) properties for
Colorado and writes a GeoJSON output suitable for PMA competitive supply
and pipeline scoring.

This is the market-specific version of the statewide NHPD fetch that targets
the data/market/ directory and includes additional fields for PMA use.

Source:  NHPD API https://preservationdatabase.org/api/properties/
Output:  data/market/nhpd_preservation_co.geojson

Usage:
    python3 scripts/market/fetch_nhpd_preservation.py
"""

import json
import sys
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "nhpd_preservation_co.geojson"

STATE_FIPS = "08"
STATE_ABBR = "CO"
TIMEOUT = 60
PAGE_SIZE = 500


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


NHPD_API_URL = "https://preservationdatabase.org/api/properties/"


def http_get_json(url: str) -> dict | list | None:
    req = urllib.request.Request(url, headers={"User-Agent": "HousingAnalytics-PMA/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read())
    except Exception as exc:
        log(f"  NHPD API error: {exc}")
        return None


def fetch_nhpd_properties() -> list[dict]:
    """Fetch all Colorado NHPD properties via paginated API."""
    features = []
    page = 1

    while True:
        params = urllib.parse.urlencode({
            "state": STATE_ABBR,
            "page": page,
            "page_size": PAGE_SIZE,
            "format": "json",
        })
        url = f"{NHPD_API_URL}?{params}"
        log(f"  Page {page}: {url[:120]}")
        data = http_get_json(url)

        if data is None:
            log(f"  Failed to fetch page {page}, stopping")
            break

        results = data if isinstance(data, list) else data.get("results", data.get("data", []))
        if not results:
            break

        log(f"  Page {page}: {len(results)} properties")

        for prop in results:
            lat = prop.get("lat") or prop.get("latitude")
            lon = prop.get("lon") or prop.get("longitude")
            prop_id = str(prop.get("id") or prop.get("nhpd_id") or "")
            address = str(prop.get("address") or "")
            city = str(prop.get("city") or "")
            county = str(prop.get("county") or "")
            units = int(prop.get("units") or prop.get("total_units") or 0)
            expyr = prop.get("expiration_year") or prop.get("earliest_expiration_year")
            proj_type = str(prop.get("program_type") or prop.get("project_type") or "")
            status = str(prop.get("preservation_status") or prop.get("status") or "")

            geom = None
            if lat is not None and lon is not None:
                try:
                    geom = {"type": "Point", "coordinates": [float(lon), float(lat)]}
                except (TypeError, ValueError):
                    pass

            features.append({
                "type": "Feature",
                "geometry": geom,
                "properties": {
                    "property_id": prop_id,
                    "address": address,
                    "city": city,
                    "county": county,
                    "state": STATE_ABBR,
                    "units": units,
                    "project_type": proj_type,
                    "preservation_status": status,
                    "expiration_year": int(expyr) if expyr else None,
                    "is_expiring_soon": (
                        int(expyr) <= datetime.now().year + 5
                        if expyr else None
                    ),
                },
            })

        if len(results) < PAGE_SIZE:
            break
        page += 1

    return features


def main() -> int:
    log("=== NHPD Preservation Data Fetch (Market) ===")

    try:
        features = fetch_nhpd_properties()
        log(f"Fetched {len(features)} Colorado NHPD properties")
    except Exception as e:
        log(f"ERROR: {e}")
        features = []

    geojson = {
        "type": "FeatureCollection",
        "meta": {
            "source": "HUD National Housing Preservation Database (NHPD) API",
            "vintage": utc_now()[:10],
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": utc_now(),
            "coverage_pct": round(min(len(features) / 800 * 100, 100), 1),
            "fields": {
                "property_id": "NHPD property identifier",
                "address": "Street address",
                "city": "City",
                "county": "County name",
                "units": "Total units",
                "project_type": "Program/project type (LIHTC, Section 8, etc.)",
                "preservation_status": "Active | At Risk | Expired | Converted",
                "expiration_year": "Year subsidy/affordability restriction expires",
                "is_expiring_soon": "True if expiring within 5 years",
            },
            "note": "Rebuild via scripts/market/fetch_nhpd_preservation.py",
        },
        "features": features,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(geojson, fh, indent=2, ensure_ascii=False)
    log(f"Wrote {OUT_FILE} ({OUT_FILE.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
