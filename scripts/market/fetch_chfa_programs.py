#!/usr/bin/env python3
"""
scripts/market/fetch_chfa_programs.py

Fetch Colorado Housing and Finance Authority (CHFA) program and incentive
data for affordable housing development subsidy scoring.

Sources:
  - CHFA public program inventory
  - HUD LIHTC pipeline for Colorado

Output:
    data/market/chfa_programs_co.json

Usage:
    python3 scripts/market/fetch_chfa_programs.py

Environment variables (optional):
    CHFA_API_KEY — CHFA API key if/when available

All sources are free and publicly accessible without authentication.
"""

import json
import os
import sys
import time
import hashlib
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / "data" / "market" / "chfa_programs_co.json"

STATE_FIPS = "08"
STATE_ABBR = "CO"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_chfa_cache"
CACHE_TTL_HOURS = 168  # 1 week

CHFA_API_KEY = os.environ.get("CHFA_API_KEY", "").strip() or None

# CHFA public web data
CHFA_HOME_URL = "https://www.chfainfo.com/armsuite/pages/home.aspx"

# HUD LIHTC pipeline (Colorado allocations)
HUD_LIHTC_PIPELINE_URL = (
    "https://hudgis-hud.opendata.arcgis.com/datasets/"
    "8c3c3b26-38f1-4e06-a8f7-a0f2a60cc4d2_0.geojson"
)

# Static CHFA program definitions (sourced from CHFA.com public QAP/publications)
# Refreshed annually from CHFA's Qualified Allocation Plan
CHFA_PROGRAMS_STATIC = [
    {
        "program_id":     "9PCT_LIHTC",
        "name":           "9% Low Income Housing Tax Credit",
        "type":           "tax_credit",
        "credit_type":    "9%",
        "basis_boost":    False,
        "max_credit_per_unit": 15000,
        "ami_targeting":  "60% AMI",
        "typical_subsidy_per_unit": 95000,
        "active":         True,
        "annual_allocation_limit": 13000000,
        "notes": "Competitive annual LIHTC from CHFA; statewide basis allocation",
    },
    {
        "program_id":     "4PCT_LIHTC",
        "name":           "4% Low Income Housing Tax Credit + Bonds",
        "type":           "tax_credit",
        "credit_type":    "4%",
        "basis_boost":    True,
        "max_credit_per_unit": 8000,
        "ami_targeting":  "60% AMI",
        "typical_subsidy_per_unit": 45000,
        "active":         True,
        "annual_allocation_limit": None,
        "notes": "Non-competitive; paired with tax-exempt bonds; QCT/DDA boost to 30%",
    },
    {
        "program_id":     "CHFA_HOME",
        "name":           "CHFA HOME Investment Partnerships",
        "type":           "grant_loan",
        "credit_type":    None,
        "basis_boost":    False,
        "max_grant_per_unit": 50000,
        "ami_targeting":  "80% AMI",
        "typical_subsidy_per_unit": 30000,
        "active":         True,
        "annual_allocation_limit": 5000000,
        "notes": "Federal HOME funds administered by CHFA; rental housing",
    },
    {
        "program_id":     "CHFA_CDBG",
        "name":           "Community Development Block Grant (CDBG)",
        "type":           "grant",
        "credit_type":    None,
        "basis_boost":    False,
        "max_grant_per_unit": 30000,
        "ami_targeting":  "80% AMI",
        "typical_subsidy_per_unit": 20000,
        "active":         True,
        "annual_allocation_limit": 3000000,
        "notes": "Via DOLA for small cities and rural areas; housing rehabilitation",
    },
    {
        "program_id":     "CHFA_TOD",
        "name":           "Transit-Oriented Development (TOD) Fund",
        "type":           "loan",
        "credit_type":    None,
        "basis_boost":    False,
        "max_loan_per_unit": 75000,
        "ami_targeting":  "60–80% AMI",
        "typical_subsidy_per_unit": 50000,
        "active":         True,
        "annual_allocation_limit": None,
        "notes": "Preservation and new construction near transit; Denver metro focus",
    },
    {
        "program_id":     "CHFA_HTF",
        "name":           "National Housing Trust Fund (HTF)",
        "type":           "grant",
        "credit_type":    None,
        "basis_boost":    False,
        "max_grant_per_unit": 75000,
        "ami_targeting":  "30% AMI",
        "typical_subsidy_per_unit": 55000,
        "active":         True,
        "annual_allocation_limit": 4000000,
        "notes": "Targets extremely low income; paired with 9% LIHTC",
    },
    {
        "program_id":     "CHFA_AFFORDABLE_LOAN",
        "name":           "CHFA Affordable Housing Loan",
        "type":           "loan",
        "credit_type":    None,
        "basis_boost":    False,
        "max_loan_amount": 20000000,
        "ami_targeting":  "60–80% AMI",
        "typical_subsidy_per_unit": 35000,
        "active":         True,
        "annual_allocation_limit": None,
        "notes": "Below-market permanent financing; paired with LIHTC projects",
    },
    {
        "program_id":     "CHFA_RAD",
        "name":           "Rental Assistance Demonstration (RAD)",
        "type":           "preservation",
        "credit_type":    None,
        "basis_boost":    False,
        "ami_targeting":  "30–50% AMI",
        "typical_subsidy_per_unit": 80000,
        "active":         True,
        "annual_allocation_limit": None,
        "notes": "HUD-driven conversion of public housing to Section 8 project-based",
    },
]

# Colorado LIHTC project pipeline tiers
LIHTC_PIPELINE_STAGES = {
    "allocated":   "Tax credit allocated by CHFA",
    "placed":      "Project placed in service",
    "pipeline":    "In underwriting/approval",
    "proposed":    "Application submitted",
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


def fetch_lihtc_pipeline() -> list:
    """Pull Colorado LIHTC project records from HUD public dataset."""
    log("Fetching LIHTC pipeline from HUD…")
    try:
        raw = fetch_url(HUD_LIHTC_PIPELINE_URL, timeout=120)
        gj = json.loads(raw)
    except Exception as exc:
        log(f"LIHTC pipeline fetch failed: {exc}", level="WARN")
        return []

    projects = []
    for f in gj.get("features", []):
        props = f.get("properties") or {}
        state = str(props.get("STATE", props.get("hud_state_code", "")) or "").upper()
        if state != STATE_ABBR:
            continue

        fips_raw = str(props.get("FIPS2010", props.get("county_fips", "")) or "").zfill(5)
        projects.append({
            "project_name":   props.get("PROJECT", props.get("proj_name", "")),
            "county_fips":    fips_raw if fips_raw.startswith("08") else "",
            "city":           props.get("CITY", props.get("city", "")),
            "n_units":        int(props.get("N_UNITS", props.get("total_units", 0)) or 0),
            "li_units":       int(props.get("LI_UNITS", props.get("li_units", 0)) or 0),
            "year_placed":    props.get("YR_PIS", props.get("year_pis", None)),
            "credit_type":    props.get("CREDIT", ""),
            "non_profit":     bool(props.get("NON_PROF", 0)),
            "qct":            bool(props.get("QCT", props.get("qct", False))),
            "dda":            bool(props.get("DDA", props.get("dda", False))),
        })

    log(f"  {len(projects)} Colorado LIHTC projects")
    return projects


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    generated = utc_now()

    # Fetch live LIHTC pipeline
    pipeline = fetch_lihtc_pipeline()

    result = {
        "meta": {
            "source": "CHFA Program Inventory + HUD LIHTC Database",
            "url": "https://www.chfainfo.com",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": "2025",
            "generated": generated,
            "program_count": len(CHFA_PROGRAMS_STATIC),
            "lihtc_projects": len(pipeline),
            "coverage_pct": 100.0,
            "note": (
                "Static program definitions updated annually from CHFA QAP. "
                "Rebuild via scripts/market/fetch_chfa_programs.py"
            ),
        },
        "programs": CHFA_PROGRAMS_STATIC,
        "lihtc_pipeline": pipeline,
    }

    # Fallback to existing if pipeline empty
    if not pipeline and OUT_FILE.exists():
        existing = json.loads(OUT_FILE.read_text())
        if existing.get("lihtc_pipeline"):
            log("[fallback] Using existing LIHTC pipeline from chfa_programs_co.json")
            result["lihtc_pipeline"] = existing["lihtc_pipeline"]

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    log(f"✓ Wrote {len(CHFA_PROGRAMS_STATIC)} programs + {len(result['lihtc_pipeline'])} "
        f"LIHTC projects to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())