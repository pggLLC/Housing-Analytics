#!/usr/bin/env python3
"""
scripts/market/fetch_health_centers.py

Fetch Colorado community health center sites from HRSA's Health Center
Service Delivery and Look-Alike Sites file (data.hrsa.gov, public domain).
These are the federally funded health centers (and look-alikes) that take
Medicaid and uninsured patients on a sliding fee scale, which a dentist or a
pharmacy does not stand in for.

Kept: active, permanent sites that deliver care (Service Delivery Site or
Administrative/Service Delivery Site), with coordinates. Left out:
administrative-only offices, mobile vans and seasonal sites (no fixed place
to walk to all year), and school-based sites (they mostly serve enrolled
students, not the neighbourhood).

Output:
    data/market/health_centers_co.geojson

Usage:
    python3 scripts/market/fetch_health_centers.py [--csv PATH]

--csv reads an already downloaded copy of the HRSA file instead of fetching.
A failed download exits non-zero and leaves the committed file untouched.
"""

import argparse
import csv
import io
import json
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "health_centers_co.geojson"

HRSA_URL = ("https://data.hrsa.gov/DataDownload/DD_Files/"
            "Health_Center_Service_Delivery_and_LookAlike_Sites.csv")
HRSA_PAGE = "https://data.hrsa.gov/data/download"

KEEP_SITE_TYPES = {"Service Delivery Site", "Administrative/Service Delivery Site"}
KEEP_LOCATION_TYPES = {"Permanent"}
DROP_SETTINGS = {"School"}


def keep(row: dict) -> bool:
    return (row.get("Site State Abbreviation") == "CO"
            and row.get("Site Status Description") == "Active"
            and row.get("Health Center Type Description") in KEEP_SITE_TYPES
            and row.get("Health Center Location Type Description") in KEEP_LOCATION_TYPES
            and row.get("Health Center Service Delivery Site Location Setting Description") not in DROP_SETTINGS)


def to_feature(row: dict):
    try:
        lon = float(row["Geocoding Artifact Address Primary X Coordinate"])
        lat = float(row["Geocoding Artifact Address Primary Y Coordinate"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (36.9 <= lat <= 41.1 and -109.1 <= lon <= -102.0):
        return None
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
        "properties": {
            "name": (row.get("Site Name") or "").strip(),
            "health_center": (row.get("Health Center Name") or "").strip(),
            "address": (row.get("Site Address") or "").strip(),
            "city": (row.get("Site City") or "").strip(),
            "zip": (row.get("Site Postal Code") or "").strip()[:5],
            "county": (row.get("Complete County Name") or "").strip(),
            "phone": (row.get("Site Telephone Number") or "").strip(),
            "hours_per_week": (row.get("Operating Hours per Week") or "").strip(),
            "site_setting": (row.get("Health Center Service Delivery Site Location Setting Description") or "").strip(),
        },
    }


def build(text: str) -> dict:
    rows = list(csv.DictReader(io.StringIO(text)))
    co = [r for r in rows if r.get("Site State Abbreviation") == "CO"]
    kept = [r for r in co if keep(r)]
    features = [f for f in (to_feature(r) for r in kept) if f]
    vintage = max((r.get("Data Warehouse Record Create Date") or "" for r in co), default="")
    return {
        "type": "FeatureCollection",
        "meta": {
            "source": "HRSA Health Center Service Delivery and Look-Alike Sites",
            "url": HRSA_URL,
            "page": HRSA_PAGE,
            "state": "Colorado",
            "hrsa_record_date": vintage,
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "colorado_sites": len(co),
            "feature_count": len(features),
            "kept": ("Active, permanent Service Delivery or Administrative/Service Delivery sites with "
                     "coordinates; not school-based."),
        },
        "features": features,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--csv", help="read this downloaded HRSA CSV instead of fetching")
    args = ap.parse_args()
    try:
        if args.csv:
            text = Path(args.csv).read_text(encoding="utf-8-sig")
        else:
            req = urllib.request.Request(HRSA_URL, headers={"User-Agent": "HousingAnalytics/1.0 (public data)"})
            with urllib.request.urlopen(req, timeout=180) as resp:
                text = resp.read().decode("utf-8-sig")
    except Exception as exc:  # leave the committed file as it is
        print(f"HRSA download failed: {exc}", file=sys.stderr)
        return 1
    doc = build(text)
    if not doc["features"]:
        print("HRSA file had no Colorado sites to keep; leaving the committed file as it is", file=sys.stderr)
        return 1
    OUT_FILE.write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
    print(f"{doc['meta']['feature_count']} of {doc['meta']['colorado_sites']} Colorado sites → {OUT_FILE.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
