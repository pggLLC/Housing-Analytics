#!/usr/bin/env python3
"""
F246 — Fetch Regrid parcels for every IndiBuild pipeline jurisdiction.

Runs server-side from .github/workflows/fetch-parcel-zoning-data.yml (Sundays
02:00 UTC) so the IndiBuild Brief's "Scan parcels" UX requires zero per-browser
API-key setup.

Input:
    docs/indibuild-pipeline-prototype/02-pipeline.csv  (jurisdiction list)
    data/co-place-centroids.json                       (geoid → lat/lng)
    env REGRID_API_KEY                                 (from repo secrets)

Output:
    data/affordable-housing/regrid-parcels-by-place.json
        {
          "meta": {
            "generated":          "2026-06-10T02:00:00Z",
            "source":             "Regrid v2 Parcels API",
            "radius_miles":       3.0,
            "jurisdiction_count": <N>,
            "total_parcels":      <int>,
            "api_calls":          <int>,
            "next_refresh":       "next Sunday at 02:00 UTC"
          },
          "byGeoid": {
              "0867280": {
                  "jurisdiction": "Salida",
                  "centroid":     {"lat": 38.5345, "lng": -105.9989},
                  "fetched_at":   "2026-06-10T02:00:00Z",
                  "parcel_count": <int>,
                  "parcels":      [{ <GeoJSON Feature>, ... }]
              },
              ...
          }
        }

Budget protection: writes a stub (empty parcels[] per jurisdiction, with an
explicit reason field) when REGRID_API_KEY is missing. The frontend can then
display "live API not configured" + the date the key was last seen.
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

import requests

ROOT = Path(__file__).resolve().parents[2]
PIPELINE_CSV = ROOT / "docs" / "indibuild-pipeline-prototype" / "02-pipeline.csv"
CENTROIDS_PATH = ROOT / "data" / "co-place-centroids.json"
OUTPUT_PATH = ROOT / "data" / "affordable-housing" / "regrid-parcels-by-place.json"

REGRID_BASE = "https://app.regrid.com/api/v2"
RADIUS_MILES = float(os.environ.get("REGRID_RADIUS_MILES", "3.0"))
PER_CALL_LIMIT = int(os.environ.get("REGRID_LIMIT", "500"))
REQUEST_TIMEOUT_SEC = 30
INTER_CALL_DELAY_SEC = float(os.environ.get("REGRID_DELAY_SEC", "0.4"))

# Mirror js/data-connectors/regrid-parcels.js FIELD_MAP so the cached
# payload uses the same schema as the live API path.
REGRID_FIELDS = [
    "address", "owner", "parcelnumb", "ll_gisacre", "usedesc", "zoning",
    "owner_type", "vacant", "yearbuilt", "county", "state",
]


def utcnow_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_pipeline() -> List[Dict[str, str]]:
    if not PIPELINE_CSV.exists():
        raise FileNotFoundError(f"Pipeline CSV not found: {PIPELINE_CSV}")
    with PIPELINE_CSV.open("r", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def load_centroids() -> Dict[str, Dict[str, Any]]:
    if not CENTROIDS_PATH.exists():
        raise FileNotFoundError(f"Centroids file not found: {CENTROIDS_PATH}")
    with CENTROIDS_PATH.open("r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("byGeoid", {})


def normalize_feature(feature: Dict[str, Any]) -> Dict[str, Any]:
    """Match the schema produced by js/data-connectors/regrid-parcels.js _normalizeFeature."""
    props = feature.get("properties") or {}
    return {
        "type": "Feature",
        "geometry": feature.get("geometry"),
        "properties": {
            "address":     props.get("address"),
            "owner":       props.get("owner"),
            "parcelId":    props.get("parcelnumb"),
            "acres":       props.get("ll_gisacre"),
            "landUseCode": props.get("usedesc"),
            "zoning":      props.get("zoning"),
            "ownerType":   props.get("owner_type"),
            "vacant":      props.get("vacant"),
            "year_built":  props.get("yearbuilt"),
            "county":      props.get("county"),
            "state":       props.get("state"),
        },
    }


def fetch_regrid_parcels(lat: float, lng: float, miles: float, token: str) -> List[Dict[str, Any]]:
    """Single Regrid API call for a point + radius."""
    params = {
        "lat":    lat,
        "lon":    lng,
        "radius": miles,
        "token":  token,
        "fields": ",".join(REGRID_FIELDS),
        "limit":  PER_CALL_LIMIT,
    }
    url = f"{REGRID_BASE}/parcels/point?{urlencode(params)}"
    resp = requests.get(url, timeout=REQUEST_TIMEOUT_SEC)
    resp.raise_for_status()
    payload = resp.json()
    parcels = payload.get("parcels") or {}
    features = parcels.get("features") or payload.get("features") or []
    return [normalize_feature(f) for f in features]


def main() -> int:
    token = (os.environ.get("REGRID_API_KEY") or "").strip()
    pipeline_rows = load_pipeline()
    centroids = load_centroids()

    by_geoid: Dict[str, Dict[str, Any]] = {}
    total_parcels = 0
    api_calls = 0
    skipped: List[Dict[str, Any]] = []

    for row in pipeline_rows:
        geoid = (row.get("geoid") or "").strip()
        jurisdiction = (row.get("jurisdiction") or "").strip()
        if not geoid:
            skipped.append({"jurisdiction": jurisdiction, "reason": "no geoid in pipeline row"})
            continue
        centroid = centroids.get(geoid)
        if not centroid or centroid.get("lat") is None or centroid.get("lng") is None:
            skipped.append({"geoid": geoid, "jurisdiction": jurisdiction, "reason": "no centroid"})
            continue

        record: Dict[str, Any] = {
            "jurisdiction": jurisdiction,
            "centroid":     {"lat": centroid["lat"], "lng": centroid["lng"]},
            "fetched_at":   utcnow_iso(),
            "parcel_count": 0,
            "parcels":      [],
        }

        if not token:
            record["error"] = "REGRID_API_KEY not set; cached stub written without parcels"
            by_geoid[geoid] = record
            continue

        try:
            features = fetch_regrid_parcels(centroid["lat"], centroid["lng"], RADIUS_MILES, token)
            record["parcels"] = features
            record["parcel_count"] = len(features)
            total_parcels += len(features)
            api_calls += 1
        except requests.HTTPError as e:
            record["error"] = f"HTTP {e.response.status_code}: {e.response.text[:200]}"
        except Exception as e:  # pylint: disable=broad-except
            record["error"] = f"{type(e).__name__}: {e}"

        by_geoid[geoid] = record
        # Be polite to the API — free tier is rate-limited.
        time.sleep(INTER_CALL_DELAY_SEC)

    out = {
        "meta": {
            "generated":          utcnow_iso(),
            "source":             "Regrid v2 Parcels API" if token else "stub (no API key)",
            "radius_miles":       RADIUS_MILES,
            "jurisdiction_count": len(by_geoid),
            "total_parcels":      total_parcels,
            "api_calls":          api_calls,
            "skipped":            skipped,
            "next_refresh":       "next scheduled run of .github/workflows/fetch-parcel-zoning-data.yml (Sundays 02:00 UTC)",
        },
        "byGeoid": by_geoid,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)

    print(
        f"[F246] Wrote {OUTPUT_PATH.relative_to(ROOT)}: "
        f"{len(by_geoid)} jurisdictions, {total_parcels} parcels, {api_calls} Regrid API calls"
        + (f", {len(skipped)} skipped" if skipped else ""),
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
