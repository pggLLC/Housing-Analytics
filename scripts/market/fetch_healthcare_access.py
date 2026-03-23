#!/usr/bin/env python3
"""
scripts/market/fetch_healthcare_access.py

Fetches healthcare provider locations for Colorado from HRSA and CMS data
and writes output suitable for PMA neighborhood quality scoring.

Source:  HRSA Health Resources & Services Administration
         Federally Qualified Health Centers (FQHCs) + Rural Health Clinics
         HRSA Data Warehouse: https://data.hrsa.gov/tools/data-reporting
Output:  data/market/healthcare_access_co.json

Usage:
    python3 scripts/market/fetch_healthcare_access.py
"""

import json
import sys
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "healthcare_access_co.json"

STATE_FIPS = "08"
STATE_ABBR = "CO"
TIMEOUT = 60

# HRSA FQHC locations — public data download
HRSA_FQHC_URL = (
    "https://data.hrsa.gov/DataDownload/DD_Files/"
    "Health_Center_Service_Delivery_and_LookAlike_Sites.csv"
)

# HRSA Rural Health Clinic locator API (public)
HRSA_RHC_URL = (
    "https://data.hrsa.gov/api/v2/json/location/fqhclookup"
    f"?StateAbbreviation={STATE_ABBR}&pageSize=500&pageNumber=1"
)

# Hospital locations via HHS / CMS data (public ArcGIS)
CMS_HOSPITAL_URL = (
    "https://services1.arcgis.com/Ua5sjt3LWTPigjyD/arcgis/rest/services/"
    "Hospital_Beds_and_Staff/FeatureServer/0"
)
CO_HOSPITAL_WHERE = f'HQ_STATE="{STATE_ABBR}"'


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def fetch_hrsa_fqhcs() -> list[dict]:
    """Fetch FQHC and Health Center sites for Colorado."""
    log("  Fetching HRSA FQHC locations…")
    providers = []
    req = urllib.request.Request(HRSA_RHC_URL, headers={"User-Agent": "HousingAnalytics-PMA/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read())
        items = data.get("data") or data.get("results") or (data if isinstance(data, list) else [])
        for item in items:
            lat = item.get("lat") or item.get("Latitude") or item.get("latitude")
            lon = item.get("lon") or item.get("Longitude") or item.get("longitude")
            if lat is None or lon is None:
                continue
            providers.append({
                "provider_type": "FQHC",
                "name": str(item.get("site_name") or item.get("name") or ""),
                "address": str(item.get("site_address") or ""),
                "city": str(item.get("city") or ""),
                "state": STATE_ABBR,
                "zip": str(item.get("zip") or item.get("zip_code") or ""),
                "lat": float(lat),
                "lon": float(lon),
                "accepts_medicaid": True,  # FQHCs required to accept Medicaid
                "accepts_uninsured": True,
                "availability": "Scheduled + walk-in",
                "distance_to_site": None,  # Computed at runtime
            })
        log(f"  HRSA FQHC: {len(providers)} sites")
    except Exception as e:
        log(f"  HRSA FQHC fetch failed: {e}")
    return providers


def fetch_cms_hospitals() -> list[dict]:
    """Fetch hospital locations from CMS/HHS ArcGIS layer."""
    log("  Fetching CMS hospital locations…")
    providers = []
    params = urllib.parse.urlencode({
        "where": CO_HOSPITAL_WHERE,
        "outFields": "NAME,ADDRESS,CITY,STATE,ZIP,BEDS,TYPE,TELEPHONE,LATITUDE,LONGITUDE",
        "returnGeometry": "false",
        "f": "json",
        "resultRecordCount": "500",
    })
    url = f"{CMS_HOSPITAL_URL}/query?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "HousingAnalytics-PMA/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            data = json.loads(resp.read())
        if "error" in data:
            log(f"  CMS hospital error: {data['error']}")
            return []
        for feat in data.get("features", []):
            attrs = feat.get("attributes") or {}
            lat = attrs.get("LATITUDE") or attrs.get("lat")
            lon = attrs.get("LONGITUDE") or attrs.get("lon")
            if lat is None or lon is None:
                continue
            try:
                lat, lon = float(lat), float(lon)
            except (TypeError, ValueError):
                continue
            if not (-41 < lat < 41 and -109 < lon < -102):
                # Skip obviously wrong coordinates (Colorado bbox approximate)
                if not (36 < lat < 42 and -109 < lon < -102):
                    continue
            providers.append({
                "provider_type": "Hospital",
                "name": str(attrs.get("NAME") or ""),
                "address": str(attrs.get("ADDRESS") or ""),
                "city": str(attrs.get("CITY") or ""),
                "state": STATE_ABBR,
                "zip": str(attrs.get("ZIP") or ""),
                "lat": lat,
                "lon": lon,
                "beds": int(attrs.get("BEDS") or 0),
                "accepts_medicaid": True,  # Most hospitals accept Medicaid
                "accepts_uninsured": None,
                "availability": "24/7 emergency",
                "distance_to_site": None,
            })
        log(f"  CMS hospitals: {len(providers)} facilities")
    except Exception as e:
        log(f"  CMS hospital fetch failed: {e}")
    return providers


def main() -> int:
    log("=== Colorado Healthcare Access Fetch ===")

    fqhcs = fetch_hrsa_fqhcs()
    hospitals = fetch_cms_hospitals()
    all_providers = fqhcs + hospitals

    log(f"Total healthcare providers: {len(all_providers)}")
    log(f"  FQHCs: {len(fqhcs)}")
    log(f"  Hospitals: {len(hospitals)}")

    output = {
        "meta": {
            "source": "HRSA FQHC Data + CMS Hospital Compare (public)",
            "vintage": "2024",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": utc_now(),
            "coverage_pct": round(min(len(all_providers) / 300 * 100, 100), 1),
            "fields": {
                "provider_type": "FQHC | Hospital | RHC | Clinic",
                "name": "Provider name",
                "address": "Street address",
                "city": "City",
                "zip": "ZIP code",
                "lat": "Latitude",
                "lon": "Longitude",
                "beds": "Licensed beds (hospitals only)",
                "accepts_medicaid": "True = Medicaid accepted",
                "accepts_uninsured": "True = uninsured patients accepted (sliding scale)",
                "availability": "Service availability description",
                "distance_to_site": "Distance from project site (miles) — computed at runtime",
            },
            "note": "Rebuild via scripts/market/fetch_healthcare_access.py",
        },
        "providers": all_providers,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(output, fh, indent=2, ensure_ascii=False)
    log(f"Wrote {OUT_FILE} ({OUT_FILE.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
