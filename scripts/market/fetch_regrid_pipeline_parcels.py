#!/usr/bin/env python3
"""
F246 — Fetch Regrid parcels for every IndiBuild pipeline jurisdiction.

Runs server-side from .github/workflows/fetch-parcel-zoning-data.yml only when
the optional paid source is explicitly enabled. Scheduled access is deferred
for cost under #1612; the browser may still use a user's own key.

Input:
    docs/indibuild-pipeline-prototype/02-pipeline.csv  (jurisdiction list)
    data/co-place-centroids.json                       (geoid → lat/lng)
    env REGRID_API_KEY                                 (from repo secrets)

Output:
    data/affordable-housing/regrid-parcels-by-place.json
        {
          "meta": {
            "generated":          "2026-06-10T02:00:00Z",
            "source":             "deferred (Regrid access not funded)",
            "availability":       "deferred",
            "is_current_coverage": false,
            "unavailableReason":  "<reason carried with the data>",
            "radius_miles":       3.0,
            "jurisdiction_count": <N>,
            "total_parcels":      null,
            "api_calls":          0,
            "next_refresh":       "none scheduled — Regrid deferred (#1612); ..."
          },
          "byGeoid": {
              "0867280": {
                  "jurisdiction": "Salida",
                  "centroid":     {"lat": 38.5345, "lng": -105.9989},
                  "fetched_at":   "2026-06-10T02:00:00Z",
                  "parcel_count": null,
                  "parcels":      [],
                  "error":        "Regrid access not funded ..."
              },
              ...
          }
        }

Budget protection: writes a deferred record (empty parcels[] and null counts,
with one explicit reason) when REGRID_API_KEY is missing. Null means no parcel
measurement was made; it must never be rendered as a confident zero.
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
PIPELINE_CSV = Path(os.environ.get("REGRID_PIPELINE_CSV") or ROOT / "docs" / "indibuild-pipeline-prototype" / "02-pipeline.csv")
CENTROIDS_PATH = Path(os.environ.get("REGRID_CENTROIDS_PATH") or ROOT / "data" / "co-place-centroids.json")
OUTPUT_PATH = Path(os.environ.get("REGRID_OUTPUT_PATH") or ROOT / "data" / "affordable-housing" / "regrid-parcels-by-place.json")

REGRID_BASE = "https://app.regrid.com/api/v2"
RADIUS_MILES = float(os.environ.get("REGRID_RADIUS_MILES", "3.0"))
PER_CALL_LIMIT = int(os.environ.get("REGRID_LIMIT", "500"))
REQUEST_TIMEOUT_SEC = 30
INTER_CALL_DELAY_SEC = float(os.environ.get("REGRID_DELAY_SEC", "0.4"))

DEFERRED_REASON = (
    "Regrid is an optional licensed parcel source. CoHO has not funded a paid Regrid "
    "subscription (owner decision 2026-09-12, #1612), so no Regrid request was made and "
    "this file carries no parcel measurements. This is a cost decision, not a technical "
    "failure: the integration is intact and can be re-enabled by funding access, setting "
    "the REGRID_API_KEY secret, and running fetch-parcel-zoning-data.yml with regrid_enabled=true."
)

NEXT_REFRESH = (
    "none scheduled — Regrid deferred (#1612); manual: dispatch "
    "fetch-parcel-zoning-data.yml with regrid_enabled=true, or set repository variable "
    "REGRID_ENABLED=true"
)

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
    # F248 — Diagnostic: log whether the env var was seen + its length,
    # WITHOUT echoing the key itself. This surfaces "secret not configured
    # in this workflow context" vs "secret present but Regrid returns 401"
    # in subsequent runs. The Jun 10 dispatch produced 0 parcels because
    # `os.environ.get('REGRID_API_KEY')` returned an empty string — the
    # secret either wasn't set, was blank, or wasn't passed through to the
    # workflow context. This print is the diagnostic the user can read.
    print(
        f"[F246] REGRID_API_KEY env presence: {'YES' if token else 'NO'} "
        f"(length: {len(token)})",
        file=sys.stderr,
    )
    try:
        pipeline_rows = load_pipeline()
        centroids = load_centroids()
    except FileNotFoundError as exc:
        print(f"[F246] {exc}; nothing written", file=sys.stderr)
        raise

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
            "parcel_count": None,
            "parcels":      [],
        }

        if not token:
            record["error"] = "Regrid access not funded (deferred, #1612); no request made"
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
        # Be polite to the API — access is rate-limited.
        time.sleep(INTER_CALL_DELAY_SEC)

    if not token:
        availability = "deferred"
        is_current_coverage = False
        measured_total = None
        source = "deferred (Regrid access not funded)"
        unavailable_reason: Optional[str] = DEFERRED_REASON
    elif api_calls == 0:
        availability = "failed"
        is_current_coverage = False
        measured_total = None
        source = "Regrid v2 Parcels API (all requests failed)"
        first_error = next(
            (record.get("error") for record in by_geoid.values() if record.get("error")),
            "no successful response",
        )
        unavailable_reason = (
            f"Regrid requests failed for all {len(by_geoid)} jurisdictions; "
            f"first error: {first_error}"
        )
    else:
        availability = "active"
        is_current_coverage = True
        measured_total = total_parcels
        source = "Regrid v2 Parcels API"
        unavailable_reason = None

    out = {
        "meta": {
            "generated":          utcnow_iso(),
            "source":             source,
            "availability":       availability,
            "is_current_coverage": is_current_coverage,
            "radius_miles":       RADIUS_MILES,
            "jurisdiction_count": len(by_geoid),
            "total_parcels":      measured_total,
            "api_calls":          api_calls,
            "skipped":            skipped,
            "next_refresh":       NEXT_REFRESH,
        },
        "byGeoid": by_geoid,
    }
    if unavailable_reason:
        out["meta"]["unavailableReason"] = unavailable_reason

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)

    output_label = OUTPUT_PATH.relative_to(ROOT) if OUTPUT_PATH.is_relative_to(ROOT) else OUTPUT_PATH
    print(
        f"[F246] Wrote {output_label}: "
        f"{len(by_geoid)} jurisdictions, {measured_total} parcels, {api_calls} Regrid API calls"
        + (f", {len(skipped)} skipped" if skipped else ""),
        file=sys.stderr,
    )

    errors_seen = [(g, r.get("jurisdiction"), r.get("error")) for g, r in by_geoid.items() if r.get("error")]
    if errors_seen:
        print(f"[F246] Per-jurisdiction errors: {len(errors_seen)}", file=sys.stderr)
        for geoid, juris, err in errors_seen[:5]:
            print(f"  - {geoid} ({juris}): {err}", file=sys.stderr)
        if len(errors_seen) > 5:
            print(f"  ...and {len(errors_seen) - 5} more (see {output_label} for full list)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
