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

# USDA Food Access Research Atlas downloads (public)
# URLs updated 2026-04 from ers.usda.gov/data-products/food-access-research-atlas/download-the-data
USDA_XLSX_URL = (
    "https://www.ers.usda.gov/media/5626/"
    "food-access-research-atlas-data-download-2019.xlsx?v=77780"
)
USDA_CSV_ZIP_URL = (
    "https://www.ers.usda.gov/media/5627/"
    "food-access-research-atlas-data-download-2019.zip?v=84188"
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
                log(f"[retry {attempt+1}/{retries-1}] {exc} -- waiting {wait}s", level="WARN")
                time.sleep(wait)
    raise RuntimeError(f"Failed after {retries} attempts: {last_err}")


def _safe_float(v) -> float:
    try:
        return float(v) if v not in (None, "", "NA", "N/A") else 0.0
    except (TypeError, ValueError):
        return 0.0


def _safe_int(v) -> int:
    try:
        return int(float(v)) if v not in (None, "", "NA", "N/A") else 0
    except (TypeError, ValueError):
        return 0


def _safe_bool(v) -> bool:
    return bool(_safe_int(v))


# ── XLSX parser (requires openpyxl) ────────────────────────────────

def parse_xlsx(raw_bytes: bytes) -> list:
    """Parse USDA XLSX and return Colorado rows as dicts."""
    try:
        import openpyxl
    except ImportError:
        log("openpyxl not installed; attempting pip install...", level="WARN")
        import subprocess
        try:
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", "openpyxl", "-q"],
                timeout=60,
            )
            import openpyxl
        except Exception as exc:
            log(f"pip install openpyxl failed: {exc}", level="WARN")
            raise ImportError("openpyxl unavailable")

    wb = openpyxl.load_workbook(io.BytesIO(raw_bytes), read_only=True, data_only=True)
    ws = wb.active
    rows = ws.iter_rows(values_only=True)
    header = [str(h or "").strip() for h in next(rows)]
    records = []
    for row in rows:
        d = dict(zip(header, row))
        ct = str(d.get("CensusTract", "") or "").zfill(11)
        if not ct.startswith(STATE_FIPS):
            continue
        records.append(d)
    wb.close()
    return records


# ── CSV parser ──────────────────────────────────────────────────────

def parse_csv(raw_bytes: bytes, zip_wrapped: bool = False) -> list:
    """Parse USDA CSV (optionally inside a ZIP), return Colorado rows."""
    if zip_wrapped:
        try:
            with zipfile.ZipFile(io.BytesIO(raw_bytes)) as zf:
                csv_names = [n for n in zf.namelist() if n.endswith(".csv")]
                if not csv_names:
                    raise ValueError("No CSV found in ZIP")
                with zf.open(csv_names[0]) as cf:
                    raw_bytes = cf.read()
        except Exception as exc:
            log(f"ZIP parse failed: {exc} -- treating as raw CSV", level="WARN")

    reader = csv.DictReader(
        io.TextIOWrapper(io.BytesIO(raw_bytes), encoding="utf-8-sig")
    )
    records = []
    for row in reader:
        ct = str(row.get("CensusTract", "") or "").zfill(11)
        if not ct.startswith(STATE_FIPS):
            continue
        records.append(row)
    return records


# ── Pandas fallback ─────────────────────────────────────────────────

def parse_with_pandas(raw_bytes: bytes, is_xlsx: bool = False) -> list:
    """Fallback: use pandas to parse either XLSX or CSV."""
    import pandas as pd
    if is_xlsx:
        df = pd.read_excel(io.BytesIO(raw_bytes), dtype=str)
    else:
        df = pd.read_csv(io.BytesIO(raw_bytes), dtype=str)

    df["CensusTract"] = df["CensusTract"].str.zfill(11)
    df = df[df["CensusTract"].str.startswith(STATE_FIPS)]
    return df.to_dict(orient="records")


# ── Transform raw rows into output format ───────────────────────────

def transform_rows(rows: list) -> dict:
    """Convert raw USDA rows into the tract-keyed output dict."""
    tracts = {}
    for row in rows:
        ct = str(row.get("CensusTract", "") or "").zfill(11)
        if not ct.startswith(STATE_FIPS):
            continue

        is_food_desert = _safe_bool(row.get("LILATracts_1And10", 0))
        low_access_1mi = _safe_bool(row.get("LATracts1", 0))
        low_access_half = _safe_bool(row.get("LATracts_half", 0))
        # Share fields are percentages (0-100); normalize to 0-1
        pct_la_1mi = round(_safe_float(row.get("lapop1share", 0)) / 100.0, 4)
        pct_la_half = round(_safe_float(row.get("lapophalfshare", 0)) / 100.0, 4)
        # TractSNAP = count of SNAP participants in the tract
        snap_participants = _safe_int(row.get("TractSNAP", 0))
        # PovertyRate is already a percentage (0-100); normalize to 0-1
        poverty_rate = round(_safe_float(row.get("PovertyRate", 0)) / 100.0, 4)
        median_income = _safe_int(row.get("MedianFamilyIncome", 0))
        li_la_half_and_10 = _safe_bool(row.get("LILATracts_halfAnd10", 0))
        population = _safe_int(row.get("Pop2010", 0))
        low_income = _safe_bool(row.get("LowIncomeTracts", 0))

        tracts[ct] = {
            "foodDesert": is_food_desert,
            "lowAccess1mi": low_access_1mi,
            "lowAccessHalfMi": low_access_half,
            "pctLowAccess1mi": pct_la_1mi,
            "pctLowAccessHalfMi": pct_la_half,
            "snapParticipants": snap_participants,
            "povertyRate": poverty_rate,
            "medianFamilyIncome": median_income,
            "lilaHalfAnd10": li_la_half_and_10,
            "lowIncome": low_income,
            "population": population,
        }

    return tracts


# ── Main build logic ────────────────────────────────────────────────

def build_food_access() -> dict:
    """Fetch and parse USDA Food Access Research Atlas for Colorado."""
    log("Fetching USDA Food Access Research Atlas for Colorado...")
    generated = utc_now()

    rows = []
    source_method = "none"

    # Strategy 1: Try XLSX with openpyxl
    try:
        log("  Trying XLSX download...")
        raw = fetch_url(USDA_XLSX_URL, timeout=180)
        rows = parse_xlsx(raw)
        source_method = "xlsx-openpyxl"
        log(f"  XLSX parsed: {len(rows)} Colorado rows")
    except Exception as exc:
        log(f"  XLSX attempt failed: {exc}", level="WARN")

    # Strategy 2: Try CSV ZIP
    if not rows:
        try:
            log("  Trying CSV ZIP download...")
            raw = fetch_url(USDA_CSV_ZIP_URL, timeout=120)
            rows = parse_csv(raw, zip_wrapped=True)
            source_method = "csv-zip"
            log(f"  CSV ZIP parsed: {len(rows)} Colorado rows")
        except Exception as exc:
            log(f"  CSV ZIP attempt failed: {exc}", level="WARN")

    # Strategy 3: Pandas fallback on any cached bytes
    if not rows:
        for url, is_xlsx in [
            (USDA_XLSX_URL, True),
            (USDA_CSV_ZIP_URL, False),
        ]:
            try:
                log(f"  Trying pandas fallback on {url[:60]}...")
                raw = fetch_url(url, timeout=180)
                rows = parse_with_pandas(raw, is_xlsx=is_xlsx)
                source_method = f"pandas-{'xlsx' if is_xlsx else 'csv'}"
                log(f"  Pandas parsed: {len(rows)} Colorado rows")
                break
            except Exception as exc:
                log(f"  Pandas fallback failed: {exc}", level="WARN")

    tracts = transform_rows(rows)
    food_desert_count = sum(1 for t in tracts.values() if t.get("foodDesert"))
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    return {
        "meta": {
            "source": "USDA Food Access Research Atlas 2019",
            "url": "https://www.ers.usda.gov/data-products/food-access-research-atlas/",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "fetched": today,
            "tracts": len(tracts),
            "food_deserts": food_desert_count,
            "method": source_method,
            "note": "Rebuild via: python3 scripts/market/fetch_food_access.py",
        },
        "tracts": tracts,
    }


def _empty_output() -> dict:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return {
        "meta": {
            "source": "USDA Food Access Research Atlas 2019",
            "url": "https://www.ers.usda.gov/data-products/food-access-research-atlas/",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "fetched": today,
            "tracts": 0,
            "food_deserts": 0,
            "method": "none",
            "note": "Stub -- rebuild via: python3 scripts/market/fetch_food_access.py",
        },
        "tracts": {},
    }


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    try:
        result = build_food_access()
    except Exception as exc:
        log(f"Food access build failed: {exc}", level="ERROR")
        result = _empty_output()

    # Fallback to existing file if fetch produced nothing
    if not result.get("tracts") and OUT_FILE.exists():
        try:
            existing = json.loads(OUT_FILE.read_text())
            if existing.get("tracts"):
                log("[fallback] Using existing food_access_co.json", level="WARN")
                result = existing
        except Exception:
            pass

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    n = len(result.get("tracts", {}))
    fd = result.get("meta", {}).get("food_deserts", 0)
    log(f"Wrote {n} tract records ({fd} food deserts) to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
