#!/usr/bin/env python3
"""
scripts/market/fetch_qct_dda.py

Fetch HUD Qualified Census Tract (QCT) and Difficult Development Area (DDA)
designations for Colorado, with annual update support.

QCT/DDA status affects LIHTC credit calculations (+30% basis boost) and is
a critical input to the PMA development incentives scoring dimension.

Output:
    data/market/qct_dda_designations_co.json

Usage:
    python3 scripts/market/fetch_qct_dda.py

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
OUT_FILE = ROOT / "data" / "market" / "qct_dda_designations_co.json"

STATE_FIPS = "08"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_qct_dda_cache"
CACHE_TTL_HOURS = 720  # 30 days (HUD updates annually in January)

# HUD GIS Open Data — QCT FeatureServer (public)
HUD_QCT_URL = (
    "https://hudgis-hud.opendata.arcgis.com/datasets/"
    "b6bd80b57e41436f9be85f40b5ccbd97_0.geojson"
)

# HUD GIS Open Data — DDA FeatureServer (public)
HUD_DDA_URL = (
    "https://hudgis-hud.opendata.arcgis.com/datasets/"
    "0c9cec80b5f041289ffe0f2c818d6ded_0.geojson"
)

# HUD API (normalized) — QCT endpoint
HUD_API_QCT = "https://hudgis-hud.opendata.arcgis.com/api/search/v1/collections/qcts"

# Current designation year
DESIGNATION_YEAR = 2025


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


def fetch_geojson_filtered(url: str, label: str) -> list:
    """Fetch a HUD GeoJSON endpoint and filter to Colorado records."""
    log(f"Fetching {label} from HUD…")
    raw = fetch_url(url, timeout=120)
    gj = json.loads(raw)
    features = gj.get("features", [])

    co_records = []
    for f in features:
        props = f.get("properties") or {}
        geoid = str(
            props.get("GEOID", props.get("geoid", props.get("TRACT", ""))) or ""
        )
        state_code = str(props.get("STATE", props.get("state", "")) or "")

        # Filter by state code or GEOID prefix
        if state_code == STATE_FIPS or geoid.startswith(STATE_FIPS):
            co_records.append({
                "geoid":       geoid,
                "county_fips": geoid[:5].zfill(5) if len(geoid) >= 5 else "",
                **{k: v for k, v in props.items() if k not in ("geometry",)},
            })

    log(f"  {label}: {len(co_records)} Colorado records")
    return co_records


def build_qct_dda() -> dict:
    """Fetch and merge QCT and DDA designations for Colorado."""
    generated = utc_now()

    # Fetch QCT designations
    qct_records = []
    try:
        qct_records = fetch_geojson_filtered(HUD_QCT_URL, "QCT")
    except Exception as exc:
        log(f"QCT fetch failed: {exc}", level="WARN")

    # Fetch DDA designations
    dda_records = []
    try:
        dda_records = fetch_geojson_filtered(HUD_DDA_URL, "DDA")
    except Exception as exc:
        log(f"DDA fetch failed: {exc}", level="WARN")

    # Build merged index by GEOID
    merged: dict = {}

    for rec in qct_records:
        geoid = rec["geoid"]
        if geoid not in merged:
            merged[geoid] = {"geoid": geoid, "county_fips": rec["county_fips"],
                             "qct": False, "dda": False}
        merged[geoid]["qct"] = True
        merged[geoid]["qct_year"] = int(
            rec.get("YEAR", rec.get("year", DESIGNATION_YEAR)) or DESIGNATION_YEAR
        )

    for rec in dda_records:
        geoid = rec["geoid"]
        if geoid not in merged:
            merged[geoid] = {"geoid": geoid, "county_fips": rec["county_fips"],
                             "qct": False, "dda": False}
        merged[geoid]["dda"] = True
        merged[geoid]["dda_year"] = int(
            rec.get("YEAR", rec.get("year", DESIGNATION_YEAR)) or DESIGNATION_YEAR
        )

    designations = sorted(merged.values(), key=lambda x: x["geoid"])
    qct_count = sum(1 for d in designations if d.get("qct"))
    dda_count = sum(1 for d in designations if d.get("dda"))

    log(f"Built {len(designations)} designations ({qct_count} QCT, {dda_count} DDA)")
    return {
        "meta": {
            "source": "HUD QCT/DDA Designations (HUD GIS Open Data)",
            "url": "https://www.hud.gov/program_offices/housing/mfh/lihtc/qcts",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "designation_year": DESIGNATION_YEAR,
            "vintage": str(DESIGNATION_YEAR),
            "generated": generated,
            "qct_count": qct_count,
            "dda_count": dda_count,
            "total_designations": len(designations),
            "coverage_pct": round(min(len(designations) / 300, 1.0) * 100, 1),
            "definitions": {
                "qct": "Qualified Census Tract — ≥50% of households below 60% AMI or 25%+ poverty rate",
                "dda": "Difficult Development Area — high construction/land costs relative to incomes",
                "basis_boost": "QCT/DDA sites qualify for 30% basis boost in LIHTC scoring",
            },
            "note": "Rebuild annually via scripts/market/fetch_qct_dda.py",
        },
        "designations": designations,
    }


def _empty_output(generated: str) -> dict:
    return {
        "meta": {
            "source": "HUD QCT/DDA Designations",
            "url": "https://www.hud.gov/program_offices/housing/mfh/lihtc/qcts",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "designation_year": DESIGNATION_YEAR,
            "vintage": str(DESIGNATION_YEAR),
            "generated": generated,
            "qct_count": 0,
            "dda_count": 0,
            "total_designations": 0,
            "coverage_pct": 0.0,
            "note": "Stub — rebuild via scripts/market/fetch_qct_dda.py",
        },
        "designations": [],
    }


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    try:
        result = build_qct_dda()
    except Exception as exc:
        log(f"QCT/DDA build failed: {exc}", level="ERROR")
        result = _empty_output(utc_now())

    # Fallback to existing file
    if not result.get("designations") and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text())
        if existing.get("designations"):
            log("[fallback] Using existing qct_dda_designations_co.json", level="WARN")
            result = existing

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    n = len(result.get("designations", []))
    log(f"✓ Wrote {n} designation records to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())