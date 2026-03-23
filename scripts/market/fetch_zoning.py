#!/usr/bin/env python3
"""
scripts/market/fetch_zoning.py

Fetch and aggregate Colorado zoning compatibility data from DOLA and
county/municipal planning department open data portals.

Zoning data informs land feasibility scoring in the PMA engine by
identifying residential and mixed-use zones where affordable housing
development is permitted.

Output:
    data/market/zoning_compat_index_co.json

Usage:
    python3 scripts/market/fetch_zoning.py

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
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "zoning_compat_index_co.json"

STATE_FIPS = "08"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_zoning_cache"
CACHE_TTL_HOURS = 720  # 30 days

# Colorado DOLA and municipal GIS zoning endpoints (public)
ZONING_SOURCES = [
    {
        "jurisdiction": "Denver",
        "county_fips": "08031",
        "url": (
            "https://www.denvergov.org/arcgis/rest/services/OpenData/"
            "mapa_zoning/MapServer/0"
        ),
        "zone_field": "ZONE_DESC",
    },
    {
        "jurisdiction": "Jefferson County",
        "county_fips": "08059",
        "url": (
            "https://maps.jeffco.us/arcgis/rest/services/Planning/"
            "ZoningDistricts/MapServer/0"
        ),
        "zone_field": "ZONE_CLASS",
    },
    {
        "jurisdiction": "Arapahoe County",
        "county_fips": "08005",
        "url": (
            "https://gis.arapahoegov.com/arcgis/rest/services/OpenData/"
            "Zoning/FeatureServer/0"
        ),
        "zone_field": "ZONE_TYPE",
    },
    {
        "jurisdiction": "Boulder County",
        "county_fips": "08013",
        "url": (
            "https://gisweb.bouldercounty.org/arcgis/rest/services/Planning/"
            "Zoning/FeatureServer/0"
        ),
        "zone_field": "ZONE_CODE",
    },
    {
        "jurisdiction": "El Paso County",
        "county_fips": "08041",
        "url": (
            "https://gis.elpasoco.com/arcgis/rest/services/Planning/"
            "Zoning/FeatureServer/0"
        ),
        "zone_field": "ZONE_CODE",
    },
    {
        "jurisdiction": "Larimer County",
        "county_fips": "08069",
        "url": (
            "https://gis.larimer.org/arcgis/rest/services/Planning/"
            "Zoning/FeatureServer/0"
        ),
        "zone_field": "ZONE_ABBREV",
    },
    {
        "jurisdiction": "Weld County",
        "county_fips": "08123",
        "url": (
            "https://gis.weldgov.com/arcgis/rest/services/Planning/"
            "Zoning/FeatureServer/0"
        ),
        "zone_field": "ZONE_TYPE",
    },
    {
        "jurisdiction": "Adams County",
        "county_fips": "08001",
        "url": (
            "https://gis.adcogov.com/arcgis/rest/services/Planning/"
            "Zoning/FeatureServer/0"
        ),
        "zone_field": "ZONE_CODE",
    },
]

# Zone category mapping — prefix-based heuristic
# Returns (residential_allowed, multifamily_allowed, mixed_use)
ZONE_CATEGORIES = {
    "prefixes": {
        "R1": ("single_family", True, False, False),
        "R2": ("two_family", True, False, False),
        "R3": ("multi_family", True, True, False),
        "R4": ("high_density", True, True, False),
        "RM": ("multi_family_mixed", True, True, True),
        "MU": ("mixed_use", True, True, True),
        "MF": ("multi_family", True, True, False),
        "RH": ("high_density_residential", True, True, False),
        "RR": ("rural_residential", True, False, False),
        "RS": ("suburban_residential", True, False, False),
        "C":  ("commercial", False, False, True),
        "B":  ("business", False, False, True),
        "I":  ("industrial", False, False, False),
        "A":  ("agricultural", False, False, False),
        "PD": ("planned_development", True, True, True),
        "PUD": ("planned_unit_dev", True, True, True),
    }
}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)


def _cache_key(url: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.md5(url.encode()).hexdigest()
    return CACHE_DIR / key


def fetch_url(url: str, retries: int = 3, timeout: int = 90) -> bytes:
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


def classify_zone(zone_code: str) -> dict:
    """Classify a zone code into residential compatibility categories."""
    z = (zone_code or "").upper().strip()
    prefixes = ZONE_CATEGORIES["prefixes"]
    for pfx, (label, res, mf, mu) in sorted(prefixes.items(), key=lambda x: -len(x[0])):
        if z.startswith(pfx):
            return {
                "zone_label":          label,
                "residential_allowed": res,
                "multifamily_allowed": mf,
                "mixed_use":           mu,
                "compat_score":        (1 if res else 0) + (1 if mf else 0) + (0.5 if mu else 0),
            }
    return {
        "zone_label":          "unknown",
        "residential_allowed": False,
        "multifamily_allowed": False,
        "mixed_use":           False,
        "compat_score":        0.0,
    }


def aggregate_jurisdiction(source: dict) -> dict:
    """Fetch and aggregate zoning data for one jurisdiction."""
    jur = source["jurisdiction"]
    county_fips = source["county_fips"]
    layer_url = source["url"]
    zone_field = source["zone_field"]

    log(f"Fetching zoning data for {jur}…")
    params = urllib.parse.urlencode({
        "where": "1=1",
        "outFields": f"OBJECTID,{zone_field}",
        "returnGeometry": "false",
        "f": "json",
        "outSR": "4326",
        "resultRecordCount": "5000",
    })
    url = f"{layer_url}/query?{params}"
    try:
        raw = fetch_url(url, timeout=60)
        data = json.loads(raw)
        if isinstance(data, dict) and "error" in data:
            raise RuntimeError(data["error"].get("message", "ArcGIS error"))
        features = data.get("features", [])
    except Exception as exc:
        log(f"  ✗ {jur}: {exc}", level="WARN")
        return _empty_jurisdiction(county_fips, jur)

    zone_totals: dict = {}
    for f in features:
        attrs = f.get("attributes") or {}
        code = str(attrs.get(zone_field, "") or "").upper().strip()
        if code not in zone_totals:
            zone_totals[code] = {"count": 0, **classify_zone(code)}
        zone_totals[code]["count"] += 1

    total = len(features)
    mf_count = sum(v["count"] for v in zone_totals.values() if v.get("multifamily_allowed"))
    res_count = sum(v["count"] for v in zone_totals.values() if v.get("residential_allowed"))

    avg_compat = (
        sum(v["compat_score"] * v["count"] for v in zone_totals.values()) / total
        if total else 0.0
    )

    log(f"  ✓ {jur}: {total} parcels, {res_count} residential, {mf_count} multifamily")
    return {
        "jurisdiction":         jur,
        "county_fips":          county_fips,
        "total_parcels":        total,
        "residential_parcels":  res_count,
        "multifamily_parcels":  mf_count,
        "pct_residential":      round(res_count / total, 4) if total else 0.0,
        "pct_multifamily":      round(mf_count / total, 4) if total else 0.0,
        "avg_compat_score":     round(avg_compat, 3),
        "zone_breakdown":       {
            code: {"count": v["count"], "zone_label": v["zone_label"]}
            for code, v in sorted(zone_totals.items())
        },
    }


def _empty_jurisdiction(county_fips: str, jur: str) -> dict:
    return {
        "jurisdiction":         jur,
        "county_fips":          county_fips,
        "total_parcels":        0,
        "residential_parcels":  0,
        "multifamily_parcels":  0,
        "pct_residential":      0.0,
        "pct_multifamily":      0.0,
        "avg_compat_score":     0.0,
        "zone_breakdown":       {},
        "note":                 "fetch failed — check GIS endpoint",
    }


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    generated = utc_now()

    jurisdictions = []
    successful = 0
    for source in ZONING_SOURCES:
        record = aggregate_jurisdiction(source)
        jurisdictions.append(record)
        if record["total_parcels"] > 0:
            successful += 1
        time.sleep(0.5)

    result = {
        "meta": {
            "source": "County/Municipal Planning GIS — Zoning Districts (public)",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": generated[:10],
            "generated": generated,
            "jurisdictions_attempted": len(ZONING_SOURCES),
            "jurisdictions_successful": successful,
            "coverage_pct": round(successful / len(ZONING_SOURCES) * 100, 1),
            "compat_score_scale": "0–2.5 (2.5 = fully MF/mixed-use compatible)",
            "note": "Rebuild via scripts/market/fetch_zoning.py",
        },
        "jurisdictions": jurisdictions,
    }

    # Fallback
    if successful == 0 and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text())
        if existing.get("jurisdictions"):
            log("[fallback] Using existing zoning_compat_index_co.json", level="WARN")
            result = existing

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    log(f"✓ Wrote {len(jurisdictions)} jurisdiction records to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())