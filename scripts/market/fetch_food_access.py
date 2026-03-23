#!/usr/bin/env python3
"""
scripts/market/fetch_food_access.py

Fetch USDA Food Access Research Atlas data for Colorado census tracts.

The Food Access Research Atlas identifies food deserts and food access
indicators by census tract, informing neighborhood quality scoring in
the PMA engine.

Output:
    data/market/food_access_co.json

Usage:
    python3 scripts/market/fetch_food_access.py

All sources are free and publicly accessible without authentication.
"""

import csv
import io
import json
import os
import sys
import time
import hashlib
import zipfile
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "food_access_co.json"

STATE_FIPS = "08"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_food_cache"
CACHE_TTL_HOURS = 720  # 30 days

# USDA Food Access Research Atlas — public CSV download
USDA_FOOD_ATLAS_URL = (
    "https://www.ers.usda.gov/webdocs/DataFiles/80591/"
    "FoodAccessResearchAtlasData2019.csv.zip?v=2019"
)

# Alternative direct CSV (no ZIP)
USDA_FOOD_CSV_URL = (
    "https://www.ers.usda.gov/webdocs/DataFiles/80591/"
    "FoodAccessResearchAtlasData2019.csv"
)


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)


def _cache_key(url: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.md5(url.encode()).hexdigest()
    return CACHE_DIR / key


def fetch_url(url: str, retries: int = 3, timeout: int = 120) -> bytes:
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
                wait = 10 * (2 ** attempt)
                log(f"[retry {attempt+1}/{retries-1}] {exc} — waiting {wait}s", level="WARN")
                time.sleep(wait)
    raise RuntimeError(f"Failed after {retries} attempts: {last_err}")


def _safe_float(v) -> float:
    try:
        return float(v) if v not in (None, "", "NA") else 0.0
    except (TypeError, ValueError):
        return 0.0


def _safe_int(v) -> int:
    try:
        return int(float(v)) if v not in (None, "", "NA") else 0
    except (TypeError, ValueError):
        return 0


def parse_food_atlas_csv(raw_bytes: bytes, zip_wrapped: bool = False) -> list:
    """Parse USDA Food Atlas CSV, returning Colorado tract records."""
    if zip_wrapped:
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
                csv_names = [n for n in zf.namelist() if n.endswith(".csv")]
                if not csv_names:
                    raise ValueError("No CSV found in ZIP")
                with zf.open(csv_names[0]) as cf:
                    raw_bytes = cf.read()
        except Exception as exc:
            log(f"ZIP parse failed: {exc} — treating as raw CSV", level="WARN")

    reader = csv.DictReader(io.TextIOWrapper(io.BytesIO(raw_bytes), encoding="utf-8-sig"))
    tracts = []
    for row in reader:
        state = str(row.get("State", "")).strip()
        if state != "Colorado" and state != STATE_FIPS:
            # Also check CensusTract code prefix
            ct = str(row.get("CensusTract", "") or "").zfill(11)
            if not ct.startswith(STATE_FIPS):
                continue

        ct = str(row.get("CensusTract", "") or "").zfill(11)
        county_fips = ct[:5].zfill(5) if len(ct) >= 5 else ""

        tracts.append({
            "geoid":            ct,
            "county_fips":      county_fips,
            "county_name":      str(row.get("County", "") or ""),
            # Low-income + low-access flags
            "li_la_1mi":        bool(_safe_int(row.get("LILATracts_1And10", 0))),
            "li_la_halfmi":     bool(_safe_int(row.get("LILATracts_halfAnd10", 0))),
            "li_la_vehicle":    bool(_safe_int(row.get("LILATracts_Vehicle", 0))),
            # Population metrics
            "pop":              _safe_int(row.get("Pop2010", 0)),
            "pct_low_income":   _safe_float(row.get("PovertyRate", 0)),
            "pct_no_vehicle":   _safe_float(row.get("VehicleAccessPct", 0)),
            # Supermarket access
            "supermarkets_1mi": _safe_int(row.get("SuperStores1", 0)),
            "supermarkets_10mi":_safe_int(row.get("SuperStores10", 0)),
            "snap_stores_1mi":  _safe_int(row.get("SNAP_stores1", 0)),
            # Convenience/fast food
            "convenience_1mi":  _safe_int(row.get("Convenience1", 0)),
            "fastfood_1mi":     _safe_int(row.get("FastFood1", 0)),
            # Median income
            "median_income":    _safe_int(row.get("MedianFamilyIncome", 0)),
        })

    return tracts


def build_food_access() -> dict:
    """Fetch and parse USDA Food Access Research Atlas for Colorado."""
    log("Fetching USDA Food Access Research Atlas for Colorado…")
    generated = utc_now()

    # Try ZIP first, then plain CSV
    tracts = []
    for url, zipped in [(USDA_FOOD_ATLAS_URL, True), (USDA_FOOD_CSV_URL, False)]:
        try:
            raw = fetch_url(url, timeout=120)
            tracts = parse_food_atlas_csv(raw, zip_wrapped=zipped)
            if tracts:
                log(f"  Parsed {len(tracts)} Colorado tract records")
                break
        except Exception as exc:
            log(f"  Fetch failed ({url[:60]}…): {exc}", level="WARN")

    food_desert_count = sum(1 for t in tracts if t.get("li_la_1mi"))
    return {
        "meta": {
            "source": "USDA Food Access Research Atlas",
            "url": "https://www.ers.usda.gov/data-products/food-access-research-atlas/",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": "2019",
            "generated": generated,
            "tract_count": len(tracts),
            "food_desert_count": food_desert_count,
            "coverage_pct": round(min(len(tracts) / 1300, 1.0) * 100, 1),
            "definitions": {
                "li_la_1mi": "Low-income tract with ≥100 households ≥1 mi from supermarket",
                "li_la_halfmi": "Low-income tract with ≥500 households ≥0.5 mi from supermarket",
                "li_la_vehicle": "Low-income tract with ≥100 households w/o vehicle ≥0.5 mi",
            },
            "note": "Rebuild via scripts/market/fetch_food_access.py",
        },
        "tracts": tracts,
    }


def _empty_output(generated: str) -> dict:
    return {
        "meta": {
            "source": "USDA Food Access Research Atlas",
            "url": "https://www.ers.usda.gov/data-products/food-access-research-atlas/",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": "2019",
            "generated": generated,
            "tract_count": 0,
            "coverage_pct": 0.0,
            "note": "Stub — rebuild via scripts/market/fetch_food_access.py",
        },
        "tracts": [],
    }


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    try:
        result = build_food_access()
    except Exception as exc:
        log(f"Food access build failed: {exc}", level="ERROR")
        result = _empty_output(utc_now())

    # Fallback to existing file
    if not result.get("tracts") and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text())
        if existing.get("tracts"):
            log("[fallback] Using existing food_access_co.json", level="WARN")
            result = existing

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    n = len(result.get("tracts", []))
    log(f"✓ Wrote {n} tract records to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())