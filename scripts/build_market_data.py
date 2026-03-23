#!/usr/bin/env python3
"""
scripts/build_market_data.py
============================
Build or refresh the three core market-analysis data files:

  data/market/acs_tract_metrics_co.json  — ACS 5-year tract-level metrics
  data/market/tract_centroids_co.json    — Census tract centroids for CO
  data/market/hud_lihtc_co.geojson       — HUD LIHTC features for Colorado

Minimum validation thresholds (warnings, not hard failures):
  ACS tract metrics  : 500 records
  Tract centroids    : 500 records
  LIHTC features     : 100 features

The script FAILS with exit code 1 only if a result file is empty, invalid,
or cannot be written.  Below-threshold counts produce a WARNING and exit 0.

Usage:
  python3 scripts/build_market_data.py [--skip-acs] [--skip-lihtc] [--skip-centroids]

Environment / config:
  CENSUS_API_KEY — optional Census API key for higher rate limits.
  All outputs are cached to disk; re-running is idempotent.
"""

import argparse
import json
import math
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# ── paths ────────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent
DATA_MARKET = REPO_ROOT / "data" / "market"
ACS_OUT = DATA_MARKET / "acs_tract_metrics_co.json"
CENTROIDS_OUT = DATA_MARKET / "tract_centroids_co.json"
LIHTC_OUT = DATA_MARKET / "hud_lihtc_co.geojson"

# ── thresholds ───────────────────────────────────────────────────────────────
MIN_ACS = 500
MIN_CENTROIDS = 500
MIN_LIHTC = 100

# ── Census ACS variables ─────────────────────────────────────────────────────
# B25003_001E = total occupied housing units (tenure denominator)
# B25003_002E = owner-occupied units
# B25003_003E = renter-occupied units
# B25064_001E = median gross rent ($)
# B25070_001E = gross rent as % of household income (total)
# B25070_010E = gross rent >= 35% of income (cost-burdened threshold)
# B19013_001E = median household income ($)
ACS_VARS = "B25003_001E,B25003_002E,B25003_003E,B25064_001E,B25070_001E,B25070_010E,B19013_001E"
ACS_YEAR = 2022
CO_FIPS = "08"

WARNINGS = []
ERRORS = []


def _log(msg):
    print(msg, flush=True)


def _warn(msg):
    WARNINGS.append(msg)
    print(f"WARN  {msg}", flush=True)


def _error(msg):
    ERRORS.append(msg)
    print(f"ERROR {msg}", file=sys.stderr, flush=True)


def _fetch_url(url, retries=3, delay=2):
    """Fetch URL with simple retry logic. Returns bytes or raises."""
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                return resp.read()
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                wait = delay * (2 ** attempt)
                _log(f"  Rate-limited (429); waiting {wait}s …")
                time.sleep(wait)
            else:
                raise
        except Exception:
            if attempt < retries - 1:
                time.sleep(delay)
            else:
                raise
    raise RuntimeError(f"Failed to fetch {url} after {retries} attempts")


def _write_json(path, obj, indent=2):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(obj, fh, indent=indent, ensure_ascii=False)
    _log(f"  Wrote {path} ({path.stat().st_size:,} bytes)")


# ── ACS tract metrics ────────────────────────────────────────────────────────

def build_acs_tract_metrics():
    _log("\n=== ACS tract metrics ===")
    api_key = os.environ.get("CENSUS_API_KEY", "")
    key_param = f"&key={api_key}" if api_key else ""

    url = (
        f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5"
        f"?get=GEO_ID,NAME,{ACS_VARS}"
        f"&for=tract:*"
        f"&in=state:{CO_FIPS}"
        f"{key_param}"
    )
    _log(f"  Fetching ACS {ACS_YEAR} 5-year data for all Colorado tracts …")
    try:
        raw = _fetch_url(url)
    except Exception as exc:
        _error(f"ACS fetch failed: {exc}")
        return False

    try:
        rows = json.loads(raw)
    except json.JSONDecodeError as exc:
        _error(f"ACS response is not valid JSON: {exc}")
        return False

    if not rows or len(rows) < 2:
        _error("ACS response has no data rows")
        return False

    headers = rows[0]
    records = []
    for row in rows[1:]:
        d = dict(zip(headers, row))
        # Build a GEOID in the standard 11-character format (state+county+tract)
        geoid = (
            d.get("GEO_ID", "")
            .replace("1400000US", "")
        )
        if not geoid:
            geoid = d.get("state", "") + d.get("county", "") + d.get("tract", "")

        def _int(k):
            v = d.get(k, "-1")
            try:
                return int(v) if v not in (None, "", "-1", "-666666666") else None
            except ValueError:
                return None

        rec = {
            "geoid": geoid,
            "name": d.get("NAME", ""),
            "state": d.get("state", CO_FIPS),
            "county": d.get("county", ""),
            "tract": d.get("tract", ""),
            "total_units": _int("B25003_001E"),
            "owner_units": _int("B25003_002E"),
            "renter_units": _int("B25003_003E"),
            "median_gross_rent": _int("B25064_001E"),
            "rent_burden_total": _int("B25070_001E"),
            "rent_burden_35pct": _int("B25070_010E"),
            "median_hh_income": _int("B19013_001E"),
        }
        records.append(rec)

    n = len(records)
    _log(f"  {n} tract records retrieved")
    if n == 0:
        _error("ACS returned zero records — aborting")
        return False
    if n < MIN_ACS:
        _warn(f"ACS tract count {n} is below minimum threshold {MIN_ACS}")

    output = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "source": f"Census ACS {ACS_YEAR} 5-year — api.census.gov",
        "state": "Colorado",
        "statefp": CO_FIPS,
        "variables": {
            "B25003_001E": "Total occupied housing units",
            "B25003_002E": "Owner-occupied units",
            "B25003_003E": "Renter-occupied units",
            "B25064_001E": "Median gross rent ($)",
            "B25070_001E": "Gross rent as pct of income (total)",
            "B25070_010E": "Gross rent >= 35% of income",
            "B19013_001E": "Median household income ($)",
        },
        "count": n,
        "features": records,
    }
    _write_json(ACS_OUT, output)
    return True


# ── Tract centroids ──────────────────────────────────────────────────────────

def build_tract_centroids():
    _log("\n=== Tract centroids ===")

    # Prefer Census TIGERweb cartographic boundary files (small GeoJSON).
    # We use the ACS internal point file for centroid coordinates.
    # Fallback: compute centroids from the ACS tract list already built.
    if ACS_OUT.exists():
        try:
            with open(ACS_OUT, encoding="utf-8") as fh:
                acs_data = json.load(fh)
        except Exception as exc:
            _warn(f"Could not load ACS output to derive centroids: {exc}")
            acs_data = None
    else:
        acs_data = None

    # Try Census TIGERweb internal-point API for tract centroids
    _log("  Fetching tract internal-points from Census TIGERweb …")
    tiger_url = (
        "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2022/MapServer/14/query"
        "?where=STATE%3D%2208%22"
        "&outFields=GEOID,CENTLAT,CENTLON,NAME"
        "&f=json"
        "&outSR=4326"
        "&resultRecordCount=2000"
        "&returnGeometry=false"
    )
    centroids = []
    try:
        raw = _fetch_url(tiger_url)
        tj = json.loads(raw)
        if "error" in tj:
            err = tj["error"]
            raise RuntimeError(
                f"ArcGIS error (code {err.get('code', '?')}): {err.get('message', str(err))}"
            )
        features = tj.get("features", [])
        for feat in features:
            attrs = feat.get("attributes", {})
            geoid = attrs.get("GEOID", "")
            lat = attrs.get("CENTLAT")
            lon = attrs.get("CENTLON")
            if geoid and lat is not None and lon is not None:
                centroids.append({
                    "geoid": geoid,
                    "name": attrs.get("NAME", ""),
                    "lat": float(lat),
                    "lon": float(lon),
                })
        _log(f"  {len(centroids)} centroids from TIGERweb")
    except Exception as exc:
        _warn(f"TIGERweb centroid fetch failed ({exc}); deriving from ACS list")

    # If TIGERweb returned nothing, derive approximate centroids from GEOID geometry
    if not centroids and acs_data:
        _log("  Deriving centroids from ACS tract list (placeholder coordinates) …")
        for rec in acs_data.get("features", []):
            # Without geometry we cannot compute true centroids; emit nulls so
            # downstream code can detect the gap and handle gracefully.
            centroids.append({
                "geoid": rec["geoid"],
                "name": rec.get("name", ""),
                "lat": None,
                "lon": None,
            })

    n = len(centroids)
    if n == 0:
        _error("No tract centroids produced — aborting centroid output")
        return False
    if n < MIN_CENTROIDS:
        _warn(f"Centroid count {n} is below minimum threshold {MIN_CENTROIDS}")

    output = {
        "generated": datetime.now(timezone.utc).isoformat(),
        "source": "Census TIGERweb ACS 2022 internal points — tigerweb.geo.census.gov",
        "state": "Colorado",
        "statefp": CO_FIPS,
        "count": n,
        "features": centroids,
    }
    _write_json(CENTROIDS_OUT, output)
    return True


# ── HUD LIHTC features ───────────────────────────────────────────────────────

def build_lihtc():
    _log("\n=== HUD LIHTC features ===")

    # HUD eGIS LIHTC FeatureServer (public, no key required)
    base_url = (
        "https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services"
        "/LIHTC_Properties/FeatureServer/0/query"
    )
    where = 'Proj_St="CO" OR Proj_St="08" OR Proj_St="Colorado"'
    params = (
        f"?where={urllib.request.quote(where)}"
        "&outFields=*"
        "&f=geojson"
        "&outSR=4326"
        "&resultRecordCount=2000"
    )

    _log("  Fetching LIHTC features from HUD eGIS …")
    all_features = []
    offset = 0
    page = 0
    while True:
        paged_url = base_url + params + f"&resultOffset={offset}"
        try:
            raw = _fetch_url(paged_url)
            gj = json.loads(raw)
            if "error" in gj:
                err = gj["error"]
                raise RuntimeError(
                    f"ArcGIS error (code {err.get('code', '?')}): {err.get('message', str(err))}"
                )
        except Exception as exc:
            if page == 0:
                _error(f"HUD LIHTC fetch failed: {exc}")
                return False
            _warn(f"LIHTC page {page} fetch failed: {exc}; using {len(all_features)} features so far")
            break

        batch = gj.get("features", [])
        all_features.extend(batch)
        _log(f"  Page {page}: {len(batch)} features (total {len(all_features)})")

        # HUD returns `exceededTransferLimit: true` when there are more pages
        if not gj.get("exceededTransferLimit"):
            break
        offset += len(batch)
        page += 1
        time.sleep(0.5)  # be polite to the service

    # Normalise YR_PIS: replace HUD sentinel 8888 with None (BUG-MAP-04).
    # Rule 18: preserve all other top-level sentinel metadata keys verbatim.
    for feat in all_features:
        props = feat.get("properties") or {}
        if props.get("YR_PIS") == 8888:
            props["YR_PIS"] = None

    n = len(all_features)
    _log(f"  {n} LIHTC features retrieved")
    if n == 0:
        _error("HUD LIHTC returned zero features — aborting")
        return False
    if n < MIN_LIHTC:
        _warn(f"LIHTC feature count {n} is below minimum threshold {MIN_LIHTC}")

    geojson = {
        "type": "FeatureCollection",
        "generated": datetime.now(timezone.utc).isoformat(),
        "source": "HUD eGIS LIHTC Properties FeatureServer — services.arcgis.com",
        "count": n,
        "features": all_features,
    }
    _write_json(LIHTC_OUT, geojson, indent=None)  # compact for large file
    return True


# ── main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Build Colorado market data files")
    parser.add_argument("--skip-acs", action="store_true", help="Skip ACS tract metrics")
    parser.add_argument("--skip-centroids", action="store_true", help="Skip tract centroids")
    parser.add_argument("--skip-lihtc", action="store_true", help="Skip HUD LIHTC features")
    args = parser.parse_args()

    DATA_MARKET.mkdir(parents=True, exist_ok=True)
    ok = True

    if not args.skip_acs:
        if not build_acs_tract_metrics():
            ok = False

    if not args.skip_centroids:
        if not build_tract_centroids():
            ok = False

    if not args.skip_lihtc:
        if not build_lihtc():
            ok = False

    print("\n" + "=" * 60)
    if WARNINGS:
        print(f"Completed with {len(WARNINGS)} warning(s):")
        for w in WARNINGS:
            print(f"  WARN  {w}")
    if ERRORS:
        print(f"Completed with {len(ERRORS)} error(s):")
        for e in ERRORS:
            print(f"  ERROR {e}")
    if not WARNINGS and not ERRORS:
        print("All market data files built successfully.")

    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
