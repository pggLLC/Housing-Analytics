#!/usr/bin/env python3
"""
scripts/market/fetch_chas_data.py

Fetches HUD CHAS (Comprehensive Housing Affordability Strategy) data for
Colorado census tracts and writes output suitable for PMA demand dimension
and affordability gap scoring.

Source:  HUD CHAS API https://www.huduser.gov/portal/datasets/cp.html
         HUD CHAS Table 1 — Cost burden by income category
Output:  data/market/chas_co.json

Usage:
    python3 scripts/market/fetch_chas_data.py

Environment variables:
    HUD_API_TOKEN  — optional HUD API token for higher rate limits
"""

import json
import os
import sys
import time
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "chas_co.json"

STATE_FIPS = "08"
TIMEOUT = 60

HUD_API_TOKEN = os.environ.get("HUD_API_TOKEN", "")

# HUD CHAS API — Table 1 (cost burden) at census tract level
# Public endpoint; token improves rate limits
CHAS_API_BASE = "https://www.huduser.gov/hudapi/public/chas"

# CHAS year — most recent available dataset
CHAS_YEAR = 2020


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str) -> None:
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def _headers() -> dict:
    h = {"User-Agent": "HousingAnalytics-PMA/1.0"}
    if HUD_API_TOKEN:
        h["Authorization"] = f"Bearer {HUD_API_TOKEN}"
    return h


def fetch_chas_tracts(state_fips: str) -> list[dict]:
    """Fetch CHAS Table 1 records for all tracts in a state."""
    records = []
    page = 1
    while True:
        params = urllib.parse.urlencode({
            "type": "4",        # Entity type 4 = Census Tract
            "stateId": state_fips,
            "year": str(CHAS_YEAR),
            "pageSize": "500",
            "page": str(page),
        })
        url = f"{CHAS_API_BASE}?{params}"
        log(f"  GET page {page}: {url[:120]}")
        req = urllib.request.Request(url, headers=_headers())
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                data = json.loads(resp.read())
        except urllib.error.HTTPError as e:
            log(f"  HTTP {e.code}: {e.reason}")
            break
        except Exception as e:
            log(f"  Error: {e}")
            break

        if isinstance(data, dict) and "error" in data:
            log(f"  API error: {data['error']}")
            break

        # CHAS API returns a dict with 'data' key
        rows = data.get("data") if isinstance(data, dict) else data
        if not rows:
            break

        log(f"  Page {page}: {len(rows)} tracts")
        records.extend(rows)

        # Pagination: stop when fewer than page_size returned
        if len(rows) < 500:
            break
        page += 1
        time.sleep(0.5)  # Respect rate limits

    return records


def normalize_record(row: dict) -> dict:
    """Normalize a CHAS API row to our standard schema."""
    geoid = str(row.get("geoid") or row.get("geoname") or "")
    # Ensure GEOID is 11-digit tract code
    geoid = geoid.replace("14000US", "").strip()

    def safe_int(v):
        try:
            return max(0, int(float(str(v).replace(",", "")))) if v not in (None, "", "null") else 0
        except (ValueError, TypeError):
            return 0

    # Cost burden fields from CHAS Table 1
    # T1_est29: renter-occupied, 30-50% cost burden (30-49.9%)
    # T1_est30: renter-occupied, >50% cost burden (severely cost-burdened)
    # T1_est3:  total renter-occupied units
    total_renter = safe_int(row.get("T1_est3") or row.get("renter_occupied"))
    cb_30_50 = safe_int(row.get("T1_est29") or row.get("cost_burden_30_50"))
    cb_50plus = safe_int(row.get("T1_est30") or row.get("cost_burden_50plus"))
    total_owner = safe_int(row.get("T1_est1") or row.get("owner_occupied"))

    cb_30_rate = round((cb_30_50 + cb_50plus) / total_renter, 4) if total_renter > 0 else 0.0
    cb_50_rate = round(cb_50plus / total_renter, 4) if total_renter > 0 else 0.0

    county_fips = geoid[:5].zfill(5) if len(geoid) >= 5 else ""

    return {
        "geoid": geoid,
        "county_fips": county_fips,
        "cost_burden_30pct": cb_30_50,
        "cost_burden_50pct": cb_50plus,
        "cost_burden_30pct_rate": cb_30_rate,
        "cost_burden_50pct_rate": cb_50_rate,
        "renter_occupied": total_renter,
        "owner_occupied": total_owner,
        "year": CHAS_YEAR,
    }


def main() -> int:
    log("=== HUD CHAS Data Fetch ===")

    raw_records = fetch_chas_tracts(STATE_FIPS)
    log(f"Fetched {len(raw_records)} raw CHAS records")

    tracts = [normalize_record(r) for r in raw_records if r]
    # Filter to Colorado tracts
    tracts = [t for t in tracts if t["geoid"].startswith(STATE_FIPS)]
    log(f"Normalized {len(tracts)} Colorado tract records")

    output = {
        "meta": {
            "source": "HUD CHAS (Comprehensive Housing Affordability Strategy) API",
            "vintage": str(CHAS_YEAR),
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "generated": utc_now(),
            "coverage_pct": round(min(len(tracts) / 1300 * 100, 100), 1),
            "fields": {
                "geoid": "11-digit census tract GEOID",
                "county_fips": "5-digit county FIPS (zero-padded)",
                "cost_burden_30pct": "Renter HHs paying 30-49.9% of income on rent",
                "cost_burden_50pct": "Renter HHs paying 50%+ of income on rent (severely cost-burdened)",
                "cost_burden_30pct_rate": "Rate of 30%+ cost burden among renters",
                "cost_burden_50pct_rate": "Rate of 50%+ cost burden among renters",
                "renter_occupied": "Total renter-occupied housing units",
                "owner_occupied": "Total owner-occupied housing units",
            },
            "note": "Rebuild via scripts/market/fetch_chas_data.py",
        },
        "tracts": tracts,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(output, fh, indent=2, ensure_ascii=False)
    log(f"Wrote {OUT_FILE} ({OUT_FILE.stat().st_size:,} bytes)")
    log(f"  Tracts: {len(tracts)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
