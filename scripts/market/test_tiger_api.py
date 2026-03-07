#!/usr/bin/env python3
"""
scripts/market/test_tiger_api.py

Standalone script to verify TIGERweb ArcGIS REST API connectivity and
validate common query parameters used by the market-data build pipeline.

Usage:
    python scripts/market/test_tiger_api.py

Exit codes:
    0 — all checks passed
    1 — one or more checks failed
"""

import json
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone

# ── Endpoints under test ───────────────────────────────────────────────────────

TIGERWEB_TRACTS = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer/0"
)
TIGERWEB_COUNTIES = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1"
)

STATE_FIPS = "08"  # Colorado


# ── Helpers ────────────────────────────────────────────────────────────────────

def _ts() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def log(msg: str, level: str = "INFO") -> None:
    print(f"[{_ts()}] [{level}] {msg}", flush=True)


def _fetch(url: str, timeout: int = 30) -> tuple[dict, float]:
    """Fetch a URL and return (parsed JSON, elapsed seconds)."""
    t0 = time.monotonic()
    req = urllib.request.Request(url, headers={"User-Agent": "pma-test/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read())
    elapsed = time.monotonic() - t0
    return data, elapsed


def arcgis_get(layer_url: str, where: str, out_fields: str = "*",
               limit: int = 1, timeout: int = 30) -> tuple[dict, float]:
    """Run a minimal ArcGIS REST query and return the result + elapsed time."""
    params = urllib.parse.urlencode({
        "where": where,
        "outFields": out_fields,
        "returnGeometry": "false",
        "f": "json",
        "resultRecordCount": str(limit),
    })
    url = f"{layer_url}/query?{params}"
    log(f"GET {url[:120]}")
    return _fetch(url, timeout=timeout)


# ── Individual checks ──────────────────────────────────────────────────────────

def check_tracts_layer() -> bool:
    """Verify the Tracts_Blocks layer responds and has Colorado tracts."""
    log("── Check 1: Tracts_Blocks layer (Colorado STATEFP='08') ──")
    try:
        data, elapsed = arcgis_get(
            TIGERWEB_TRACTS,
            where=f"STATEFP='{STATE_FIPS}'",
            limit=5,
        )
        if "error" in data:
            code = data["error"].get("code", "?")
            msg  = data["error"].get("message", str(data["error"]))
            log(f"ArcGIS error (code {code}): {msg}", level="ERROR")
            return False
        features = data.get("features", [])
        log(f"Response time: {elapsed:.2f}s | Features returned: {len(features)}")
        if not features:
            log("No features returned — service may be down or query is incorrect",
                level="WARN")
            return False
        log("✓ Tracts layer OK", level="INFO")
        return True
    except urllib.error.HTTPError as e:
        log(f"HTTP {e.code}: {e.reason}", level="ERROR")
        return False
    except Exception as e:
        log(f"{type(e).__name__}: {e}", level="ERROR")
        return False


def check_counties_layer() -> bool:
    """Verify the State_County layer responds and has Colorado counties."""
    log("── Check 2: State_County layer (Colorado STATEFP='08') ──")
    try:
        data, elapsed = arcgis_get(
            TIGERWEB_COUNTIES,
            where=f"STATEFP='{STATE_FIPS}'",
            out_fields="STATEFP,COUNTYFP,NAME,NAMELSAD",
            limit=5,
        )
        if "error" in data:
            code = data["error"].get("code", "?")
            msg  = data["error"].get("message", str(data["error"]))
            log(f"ArcGIS error (code {code}): {msg}", level="ERROR")
            return False
        features = data.get("features", [])
        log(f"Response time: {elapsed:.2f}s | Features returned: {len(features)}")
        if not features:
            log("No features returned — service may be down or query is incorrect",
                level="WARN")
            return False
        # Show a sample county name to aid debugging
        sample = (features[0].get("attributes") or {}).get("NAME", "<unknown>")
        log(f"Sample county: {sample}")
        log("✓ Counties layer OK")
        return True
    except urllib.error.HTTPError as e:
        log(f"HTTP {e.code}: {e.reason}", level="ERROR")
        return False
    except Exception as e:
        log(f"{type(e).__name__}: {e}", level="ERROR")
        return False


def check_tracts_geojson() -> bool:
    """Verify GeoJSON output format works for the tracts layer."""
    log("── Check 3: Tracts layer GeoJSON output (f=geojson) ──")
    params = urllib.parse.urlencode({
        "where": f"STATEFP='{STATE_FIPS}'",
        "outFields": "GEOID,STATEFP,NAMELSAD",
        "returnGeometry": "false",
        "f": "geojson",
        "resultRecordCount": "3",
    })
    url = f"{TIGERWEB_TRACTS}/query?{params}"
    log(f"GET {url[:120]}")
    try:
        data, elapsed = _fetch(url)
        if "error" in data:
            code = data["error"].get("code", "?")
            msg  = data["error"].get("message", str(data["error"]))
            log(f"ArcGIS error (code {code}): {msg}", level="ERROR")
            return False
        features = data.get("features", [])
        log(f"Response time: {elapsed:.2f}s | GeoJSON features: {len(features)}")
        if not features:
            log("No GeoJSON features returned", level="WARN")
            return False
        geoid = (features[0].get("properties") or {}).get("GEOID", "<none>")
        log(f"Sample GEOID: {geoid}")
        log("✓ GeoJSON format OK")
        return True
    except Exception as e:
        log(f"{type(e).__name__}: {e}", level="ERROR")
        return False


# ── Main ───────────────────────────────────────────────────────────────────────

def main() -> None:
    print("=" * 60)
    print(f"TIGERweb API Connectivity Test — "
          f"{datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC")
    print("=" * 60)

    results = {
        "Tracts_Blocks layer":   check_tracts_layer(),
        "State_County layer":    check_counties_layer(),
        "GeoJSON output format": check_tracts_geojson(),
    }

    print("\n── Summary ──")
    all_passed = True
    for name, passed in results.items():
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"  {status}  {name}")
        if not passed:
            all_passed = False

    if all_passed:
        print("\nAll TIGERweb checks passed.")
        sys.exit(0)
    else:
        print(
            "\nOne or more checks failed. The TIGERweb service may be temporarily "
            "unavailable or rate-limiting requests. Retry later or check:\n"
            "  https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
