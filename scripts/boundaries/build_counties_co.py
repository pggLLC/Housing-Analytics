#!/usr/bin/env python3
"""
scripts/boundaries/build_counties_co.py

Fetches the 64 Colorado county boundary polygons from the US Census TIGERweb
ArcGIS REST service and writes them to two local GeoJSON files:

  - data/co-county-boundaries.json      (used by co-lihtc-map.js and market-analysis.js)
  - data/boundaries/counties_co.geojson (canonical boundary file for amenity/overlay scripts)

Usage:
    python scripts/boundaries/build_counties_co.py

Environment variables (optional):
    TIGERWEB_PAGE_SIZE  Override features-per-request (default: 100)
    TIGERWEB_TIMEOUT    Override request timeout in seconds (default: 30)

Source:
    US Census TIGERweb ArcGIS REST — State_County layer 1 (current vintage)
    https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1/query

All requests are public; no API key is required.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

OUT_BOUNDARIES = ROOT / "data" / "co-county-boundaries.json"
OUT_COUNTIES_CO = ROOT / "data" / "boundaries" / "counties_co.geojson"

TIGERWEB_BASE = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
    "State_County/MapServer/1/query"
)

STATE_FIPS = "08"       # Colorado
EXPECTED   = 64         # Colorado has 64 counties
PAGE_SIZE  = int(os.environ.get("TIGERWEB_PAGE_SIZE", "100"))
TIMEOUT    = int(os.environ.get("TIGERWEB_TIMEOUT", "30"))

# TIGERweb field name for the state FIPS code has varied over service versions.
# Try each candidate in order; the first one that returns ≥1 feature wins.
WHERE_CANDIDATES = [
    f"STATEFP='{STATE_FIPS}'",
    f"STATE='{STATE_FIPS}'",
    f"GEOID LIKE '{STATE_FIPS}%'",
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds').replace("+00:00", "Z")


def http_get_json(url: str, timeout: int = TIMEOUT) -> dict:
    """Fetch ``url``, parse as JSON, and return the dict."""
    req = urllib.request.Request(url, headers={"User-Agent": "housing-analytics-build/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
    return json.loads(body)


def fetch_all_pages(base_url: str, base_params: dict) -> list[dict]:
    """
    Retrieve all features from a TIGERweb feature layer using offset-based
    pagination.  Returns a flat list of GeoJSON Feature dicts.
    """
    features: list[dict] = []
    offset = 0

    while True:
        params = dict(base_params)
        params["resultOffset"] = str(offset)
        params["resultRecordCount"] = str(PAGE_SIZE)
        url = base_url + "?" + urllib.parse.urlencode(params)

        print(f"  → GET {url[:120]}…")
        attempt = 0
        data = None
        while attempt < 3:
            try:
                data = http_get_json(url)
                break
            except (urllib.error.URLError, OSError) as exc:
                attempt += 1
                wait = 2 ** attempt
                print(f"    ⚠ attempt {attempt} failed ({exc}); retrying in {wait}s…", file=sys.stderr)
                time.sleep(wait)

        if data is None:
            raise RuntimeError(f"All retries exhausted for offset {offset}")

        # ArcGIS REST returns {"error": {"code": N, "message": "..."}} on failure
        # instead of raising an HTTP error.  Surface it so callers can react.
        if "error" in data:
            err = data["error"]
            code = err.get("code", "?")
            msg  = err.get("message", str(err))
            raise RuntimeError(f"ArcGIS error (code {code}): {msg}")

        page_features = data.get("features", [])
        features.extend(page_features)
        print(f"    page offset={offset}: {len(page_features)} features (total so far: {len(features)})")

        # TIGERweb signals end-of-results with an empty page or
        # by returning fewer records than PAGE_SIZE.
        if len(page_features) < PAGE_SIZE:
            break
        offset += PAGE_SIZE

    return features


def build_geojson(features: list[dict], generated: str) -> dict:
    return {
        "type": "FeatureCollection",
        "meta": {
            "source": "US Census TIGERweb ArcGIS REST (public)",
            "layer": "State_County / layer 1",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": generated,
        },
        "features": features,
    }


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"))
    size_kb = path.stat().st_size / 1024
    print(f"  ✅ Wrote {path.relative_to(ROOT)}  ({size_kb:.1f} KB)")


def main() -> int:
    print("=== build_counties_co.py — Colorado county boundaries ===")
    generated = utc_now()

    base_params = {
        "outFields": "NAME,NAMELSAD,STATEFP,COUNTYFP,GEOID",
        "f": "geojson",
        "outSR": "4326",
    }

    print(f"\nFetching Colorado counties from TIGERweb (STATEFP='{STATE_FIPS}')…")

    features: list[dict] = []
    last_error: Exception | None = None
    for where in WHERE_CANDIDATES:
        params = dict(base_params)
        params["where"] = where
        print(f"  Trying WHERE: {where}")
        try:
            features = fetch_all_pages(TIGERWEB_BASE, params)
        except RuntimeError as exc:
            last_error = exc
            print(f"  ✗ Failed ({exc}); trying next candidate…", file=sys.stderr)
            continue
        if features:
            print(f"  ✓ {len(features)} features with WHERE: {where}")
            break
        print(f"  ✗ WHERE '{where}' returned 0 features; trying next candidate…",
              file=sys.stderr)

    n = len(features)
    print(f"\nReceived {n} features.")

    if n == 0:
        # API is temporarily unavailable or all WHERE candidates failed.
        # If both output files already exist, preserve them and exit cleanly so
        # the workflow doesn't block on a transient upstream outage.
        if OUT_BOUNDARIES.exists() and OUT_COUNTIES_CO.exists():
            print(
                "⚠ TIGERweb returned no features; preserving existing cached files.",
                file=sys.stderr,
            )
            return 0
        if last_error:
            print(f"\n❌ Failed to fetch county boundaries: {last_error}", file=sys.stderr)
        else:
            print("❌ Zero features returned — nothing to write.", file=sys.stderr)
        return 1

    if n != EXPECTED:
        print(
            f"⚠ Expected {EXPECTED} counties but got {n}. "
            "Writing anyway; check TIGERweb for data completeness.",
            file=sys.stderr,
        )

    geojson = build_geojson(features, generated)

    print("\nWriting output files…")
    write_json(OUT_BOUNDARIES, geojson)
    write_json(OUT_COUNTIES_CO, geojson)

    print(f"\n✅ Done — {n} county features written.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
