#!/usr/bin/env python3
"""
scripts/market/fetch_epa_sld.py

Fetch EPA Smart Location Database walkability and transit data for Colorado
block groups. Outputs block-group-level metrics for local lookup by the
DataService and PMA transit scoring.

Primary source:
    EPA SLD ArcGIS REST endpoint (paginated JSON queries, STATEFP20='08')

Fallback source:
    EPA SLD bulk CSV download from edg.epa.gov

Output:
    data/market/epa_sld_co.json

Usage:
    python3 scripts/market/fetch_epa_sld.py
"""

import json
import os
import sys
import time
import hashlib
import urllib.request
import urllib.parse
import urllib.error
import zipfile
import csv
import io
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "epa_sld_co.json"

STATE_FIPS = "08"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_epa_sld_cache"
CACHE_TTL_HOURS = 720  # 30 days

# EPA Smart Location Database ArcGIS REST endpoint
# Layer 14 ("Transit service frequency") contains ALL SLD fields and supports pagination
EPA_SLD_ARCGIS_URL = (
    "https://geodata.epa.gov/arcgis/rest/services/OA/"
    "SmartLocationDatabase/MapServer/14/query"
)

# Fallback: EPA SLD bulk download (geodatabase zip)
EPA_SLD_DOWNLOAD_URL = (
    "https://edg.epa.gov/EPADataCommons/public/OA/SLD/SmartLocationDatabaseV3.zip"
)

# Fields we need from the SLD (MapServer uses uppercase field names)
SLD_FIELDS = [
    "GEOID20",     # 12-digit block group FIPS
    "STATEFP",     # state FIPS
    "D3B",         # pedestrian-oriented intersection density (walkability)
    "D4A",         # transit service frequency
    "D2A_JPHH",    # jobs per household
    "D5AR",        # regional job accessibility (auto)
    "D2B_E8MIX",   # employment entropy / land use mix
    "D1C",         # gross employment density
    "D3APO",       # auto-oriented network density
]


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)


def _cache_key(url: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.md5(url.encode()).hexdigest()
    return CACHE_DIR / key


def fetch_url(url: str, retries: int = 3, timeout: int = 120) -> bytes:
    """Fetch a URL with caching and retries."""
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
                log(f"[retry {attempt+1}/{retries-1}] {exc} -- waiting {wait}s", level="WARN")
                time.sleep(wait)
    raise RuntimeError(f"Failed after {retries} attempts: {last_err}")


# ---------------------------------------------------------------------------
# Primary: ArcGIS REST paginated queries
# ---------------------------------------------------------------------------

def arcgis_query(offset: int = 0, limit: int = 2000) -> dict:
    """Query EPA SLD ArcGIS endpoint for Colorado block groups."""
    params = urllib.parse.urlencode({
        "where": f"STATEFP='{STATE_FIPS}'",
        "outFields": ",".join(SLD_FIELDS),
        "returnGeometry": "false",
        "f": "json",
        "resultRecordCount": str(limit),
        "resultOffset": str(offset),
    })
    url = f"{EPA_SLD_ARCGIS_URL}?{params}"
    raw = fetch_url(url, timeout=120)
    data = json.loads(raw)
    if isinstance(data, dict) and "error" in data:
        err = data["error"]
        raise RuntimeError(f"ArcGIS error {err.get('code')}: {err.get('message')}")
    return data


def fetch_via_arcgis() -> list[dict]:
    """Fetch all CO block groups via paginated ArcGIS queries. Returns list of attribute dicts."""
    log("Fetching EPA SLD via ArcGIS MapServer layer 14 (supports pagination)...")
    all_records = []
    offset = 0
    page = 0
    while True:
        page += 1
        data = arcgis_query(offset=offset)
        feats = data.get("features", [])
        records = [f.get("attributes", {}) for f in feats]
        all_records.extend(records)
        log(f"  Page {page}: {len(feats)} block groups (total {len(all_records)})")
        if not feats or not data.get("exceededTransferLimit"):
            break
        offset += len(feats)

    return all_records


# ---------------------------------------------------------------------------
# Fallback: bulk CSV download
# ---------------------------------------------------------------------------

def fetch_via_csv() -> list[dict]:
    """Download bulk SLD zip, extract CSV, filter to Colorado, return list of dicts."""
    log("Falling back to bulk download...")
    raw = fetch_url(EPA_SLD_DOWNLOAD_URL, timeout=600)

    log("Extracting from zip archive...")
    zf = zipfile.ZipFile(io.BytesIO(raw))

    # Look for CSV files first, then try other text formats
    csv_names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
    if not csv_names:
        log(f"  Zip contents: {zf.namelist()[:10]}", level="WARN")
        raise RuntimeError(
            "No CSV found in SLD zip archive. "
            "Archive may contain geodatabase format which requires GDAL."
        )

    csv_name = csv_names[0]
    log(f"  Reading {csv_name}...")
    with zf.open(csv_name) as f:
        reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8"))
        records = []
        for row in reader:
            statefp = row.get("STATEFP20") or row.get("STATEFP") or ""
            if statefp == STATE_FIPS:
                records.append(row)

    log(f"  Filtered {len(records)} Colorado block groups from CSV")
    return records


# ---------------------------------------------------------------------------
# Build output
# ---------------------------------------------------------------------------

def safe_float(val, default=None):
    """Parse a float, returning default if not valid.
    Also treats EPA sentinel values (-99999) as missing."""
    if val is None or val == "" or val == "None":
        return default
    try:
        v = float(val)
        if v != v:  # NaN check
            return default
        if v <= -99999:  # EPA SLD sentinel for missing data
            return default
        return v
    except (ValueError, TypeError):
        return default


def build_output(records: list[dict]) -> dict:
    """Transform raw records into the output JSON structure."""
    block_groups = {}
    for rec in records:
        geoid = str(rec.get("GEOID20") or "").strip()
        if not geoid or len(geoid) < 12:
            continue

        # Zero-pad to 12 digits if needed
        geoid = geoid.zfill(12)

        bg = {}
        # Handle both uppercase (MapServer) and mixed-case (CSV) field names
        d3b = safe_float(rec.get("D3B") or rec.get("D3b"))
        d4a = safe_float(rec.get("D4A") or rec.get("D4a"))
        d5ar = safe_float(rec.get("D5AR") or rec.get("D5ar"))
        d2b_e8mix = safe_float(rec.get("D2B_E8MIX") or rec.get("D2b_E8MiX"))
        d1c = safe_float(rec.get("D1C"))
        d2a_jphh = safe_float(rec.get("D2A_JPHH") or rec.get("D2a_JPHH"))
        d3apo = safe_float(rec.get("D3APO") or rec.get("D3apo"))

        if d3b is not None:
            bg["walkability"] = round(d3b, 2)
        if d4a is not None:
            bg["transitAccess"] = round(d4a, 2)
        if d5ar is not None:
            bg["jobAccess"] = round(d5ar, 2)
        if d2b_e8mix is not None:
            bg["landUseMix"] = round(d2b_e8mix, 3)
        if d1c is not None:
            bg["empDensity"] = round(d1c, 2)
        if d2a_jphh is not None:
            bg["jobsPerHH"] = round(d2a_jphh, 2)
        if d3apo is not None:
            bg["autoNetDensity"] = round(d3apo, 2)

        if bg:
            block_groups[geoid] = bg

    return {
        "meta": {
            "source": "EPA Smart Location Database v3.0",
            "vintage": "2021",
            "fetched": today_str(),
            "blockGroups": len(block_groups),
            "fields": {
                "walkability": "D3b - pedestrian-oriented intersection density",
                "transitAccess": "D4a - transit service frequency",
                "jobAccess": "D5ar - regional job accessibility (auto)",
                "landUseMix": "D2b_E8MiX - employment entropy",
                "empDensity": "D1C - gross employment density",
                "jobsPerHH": "D2a_JPHH - jobs per household",
                "autoNetDensity": "D3apo - auto-oriented network density",
            },
        },
        "blockGroups": block_groups,
    }


def main():
    log("=== EPA Smart Location Database fetch (Colorado block groups) ===")

    records = []

    # Try ArcGIS REST first
    try:
        records = fetch_via_arcgis()
    except Exception as exc:
        log(f"ArcGIS fetch failed: {exc}", level="WARN")

    # If ArcGIS yielded nothing, try CSV fallback
    if not records:
        log("ArcGIS returned no records. Trying CSV fallback...", level="WARN")
        try:
            records = fetch_via_csv()
        except Exception as exc:
            log(f"CSV fallback also failed: {exc}", level="ERROR")
            sys.exit(1)

    if not records:
        log("No records from any source. Exiting.", level="ERROR")
        sys.exit(1)

    output = build_output(records)
    bg_count = output["meta"]["blockGroups"]
    log(f"Built output with {bg_count} block groups")

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    size_kb = OUT_FILE.stat().st_size / 1024
    log(f"Wrote {OUT_FILE} ({size_kb:.1f} KB)")
    log("Done.")


if __name__ == "__main__":
    main()
