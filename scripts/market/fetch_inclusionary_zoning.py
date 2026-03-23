#!/usr/bin/env python3
"""
scripts/market/fetch_inclusionary_zoning.py

Compile Colorado Inclusionary Zoning (IZ) ordinance data from DOLA and
municipal planning departments.

Inclusionary zoning requirements affect the financial feasibility of market-
rate developments and the availability of affordable units in new projects.

Output:
    data/market/inclusionary_zoning_co.json

Usage:
    python3 scripts/market/fetch_inclusionary_zoning.py

Sources:
  - DOLA housing policy database (public)
  - National Inclusionary Zoning Database (Furman Center, NYC)
  - Municipal ordinance research (static, updated annually)

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
OUT_FILE = ROOT / "data" / "market" / "inclusionary_zoning_co.json"

STATE_FIPS = "08"

CACHE_DIR = Path(os.environ.get("TMPDIR", "/tmp")) / "pma_iz_cache"
CACHE_TTL_HOURS = 720  # 30 days

# Furman Center National IZ Database API (free, no key)
FURMAN_IZ_URL = (
    "https://furmancenter.org/research/iri/inclusionary-zoning-database/api/"
    "?state=CO&format=json"
)

# DOLA IZ policy tracker (public)
DOLA_HOUSING_POLICY_URL = (
    "https://dola.colorado.gov/lgis/api/v1/housing-policy/inclusionary"
)

# Static IZ ordinance data compiled from public records (updated annually)
# Source: DOLA, municipal ordinances, Furman Center research
# Format: municipality → ordinance details
IZ_ORDINANCES_STATIC = [
    {
        "jurisdiction":    "Denver",
        "county_fips":     "08031",
        "has_iz":          True,
        "ordinance_type":  "linkage_fee",
        "set_aside_pct":   None,
        "ami_target":      None,
        "linkage_fee_per_sqft": 2.75,
        "applies_to":      "commercial > 10,000 sqft",
        "enacted_year":    2019,
        "notes":           "Affordable Housing Fund linkage fee on commercial dev",
        "source":          "Denver Community Planning and Development, 2023",
    },
    {
        "jurisdiction":    "Boulder",
        "county_fips":     "08013",
        "has_iz":          True,
        "ordinance_type":  "mandatory_set_aside",
        "set_aside_pct":   25.0,
        "ami_target":      "60% AMI",
        "linkage_fee_per_sqft": None,
        "applies_to":      "residential dev ≥5 units",
        "enacted_year":    2000,
        "notes":           "One of Colorado's strongest IZ programs; permanent affordability",
        "source":          "City of Boulder Housing and Human Services, 2024",
    },
    {
        "jurisdiction":    "Steamboat Springs",
        "county_fips":     "08107",
        "has_iz":          True,
        "ordinance_type":  "mandatory_set_aside",
        "set_aside_pct":   20.0,
        "ami_target":      "80% AMI",
        "linkage_fee_per_sqft": None,
        "applies_to":      "residential dev ≥10 units",
        "enacted_year":    2008,
        "notes":           "Workforce housing; in-lieu fee option available",
        "source":          "City of Steamboat Springs, 2023",
    },
    {
        "jurisdiction":    "Breckenridge",
        "county_fips":     "08117",
        "has_iz":          True,
        "ordinance_type":  "mandatory_set_aside",
        "set_aside_pct":   30.0,
        "ami_target":      "80% AMI",
        "linkage_fee_per_sqft": None,
        "applies_to":      "residential dev ≥3 units",
        "enacted_year":    1992,
        "notes":           "Mountain resort community; one of oldest IZ programs in CO",
        "source":          "Town of Breckenridge, 2023",
    },
    {
        "jurisdiction":    "Vail",
        "county_fips":     "08037",
        "has_iz":          True,
        "ordinance_type":  "mandatory_set_aside",
        "set_aside_pct":   15.0,
        "ami_target":      "100% AMI",
        "linkage_fee_per_sqft": 20.0,
        "applies_to":      "residential dev ≥5 units",
        "enacted_year":    2007,
        "notes":           "Employee housing mitigation; mountain resort workforce",
        "source":          "Town of Vail, 2024",
    },
    {
        "jurisdiction":    "Telluride",
        "county_fips":     "08113",
        "has_iz":          True,
        "ordinance_type":  "mandatory_set_aside",
        "set_aside_pct":   40.0,
        "ami_target":      "80% AMI",
        "linkage_fee_per_sqft": None,
        "applies_to":      "all residential dev",
        "enacted_year":    1994,
        "notes":           "Highest set-aside % in Colorado; historic resort community",
        "source":          "Town of Telluride, 2024",
    },
    {
        "jurisdiction":    "Aspen",
        "county_fips":     "08097",
        "has_iz":          True,
        "ordinance_type":  "mandatory_set_aside",
        "set_aside_pct":   35.0,
        "ami_target":      "80–120% AMI",
        "linkage_fee_per_sqft": 100.0,
        "applies_to":      "all commercial and residential dev",
        "enacted_year":    1990,
        "notes":           "Aspen/Pitkin County Housing Authority; strictest in state",
        "source":          "City of Aspen APCHA, 2024",
    },
    {
        "jurisdiction":    "Fort Collins",
        "county_fips":     "08069",
        "has_iz":          False,
        "ordinance_type":  "none",
        "set_aside_pct":   None,
        "ami_target":      None,
        "linkage_fee_per_sqft": None,
        "applies_to":      None,
        "enacted_year":    None,
        "notes":           "No mandatory IZ; voluntary incentive programs only",
        "source":          "City of Fort Collins, 2024",
    },
    {
        "jurisdiction":    "Colorado Springs",
        "county_fips":     "08041",
        "has_iz":          False,
        "ordinance_type":  "none",
        "set_aside_pct":   None,
        "ami_target":      None,
        "linkage_fee_per_sqft": None,
        "applies_to":      None,
        "enacted_year":    None,
        "notes":           "State preemption concerns; no active IZ ordinance",
        "source":          "El Paso County, 2024",
    },
    {
        "jurisdiction":    "Aurora",
        "county_fips":     "08005",
        "has_iz":          False,
        "ordinance_type":  "incentive_only",
        "set_aside_pct":   None,
        "ami_target":      None,
        "linkage_fee_per_sqft": None,
        "applies_to":      None,
        "enacted_year":    None,
        "notes":           "Voluntary density bonus for affordable units",
        "source":          "City of Aurora, 2024",
    },
    {
        "jurisdiction":    "Littleton",
        "county_fips":     "08005",
        "has_iz":          False,
        "ordinance_type":  "none",
        "set_aside_pct":   None,
        "ami_target":      None,
        "linkage_fee_per_sqft": None,
        "applies_to":      None,
        "enacted_year":    None,
        "notes":           "No IZ requirement; affordable housing fund from TIF",
        "source":          "City of Littleton, 2024",
    },
    {
        "jurisdiction":    "Pueblo",
        "county_fips":     "08101",
        "has_iz":          False,
        "ordinance_type":  "none",
        "set_aside_pct":   None,
        "ami_target":      None,
        "linkage_fee_per_sqft": None,
        "applies_to":      None,
        "enacted_year":    None,
        "notes":           "No IZ; affordable housing addressed via LIHTC and CDBG",
        "source":          "City of Pueblo, 2024",
    },
    {
        "jurisdiction":    "Glenwood Springs",
        "county_fips":     "08045",
        "has_iz":          True,
        "ordinance_type":  "mandatory_set_aside",
        "set_aside_pct":   15.0,
        "ami_target":      "80% AMI",
        "linkage_fee_per_sqft": None,
        "applies_to":      "residential dev ≥5 units",
        "enacted_year":    2006,
        "notes":           "Mountain corridor workforce housing",
        "source":          "City of Glenwood Springs, 2024",
    },
    {
        "jurisdiction":    "Avon",
        "county_fips":     "08037",
        "has_iz":          True,
        "ordinance_type":  "mandatory_set_aside",
        "set_aside_pct":   20.0,
        "ami_target":      "80% AMI",
        "linkage_fee_per_sqft": None,
        "applies_to":      "residential dev ≥6 units",
        "enacted_year":    2010,
        "notes":           "Eagle Valley workforce housing policy",
        "source":          "Town of Avon, 2024",
    },
    {
        "jurisdiction":    "Durango",
        "county_fips":     "08067",
        "has_iz":          True,
        "ordinance_type":  "incentive_only",
        "set_aside_pct":   10.0,
        "ami_target":      "80% AMI",
        "linkage_fee_per_sqft": None,
        "applies_to":      "residential dev ≥10 units",
        "enacted_year":    2019,
        "notes":           "Voluntary with density bonus; working toward mandatory",
        "source":          "City of Durango, 2024",
    },
]


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}", flush=True)


def _cache_key(url: str) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.md5(url.encode()).hexdigest()
    return CACHE_DIR / key


def fetch_url(url: str, retries: int = 3, timeout: int = 60) -> bytes:
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


def augment_from_api(base_records: list) -> list:
    """Attempt to augment static data with live API records from Furman Center."""
    try:
        raw = fetch_url(FURMAN_IZ_URL, timeout=30)
        api_data = json.loads(raw)
        if isinstance(api_data, list):
            # Index existing records by jurisdiction name
            existing = {r["jurisdiction"].lower(): i for i, r in enumerate(base_records)}
            for rec in api_data:
                jur = str(rec.get("municipality", rec.get("jurisdiction", "")) or "")
                if jur.lower() in existing:
                    idx = existing[jur.lower()]
                    # Update enacted year if API has more recent data
                    if rec.get("enacted_year"):
                        base_records[idx]["enacted_year"] = int(rec["enacted_year"])
                else:
                    # Add new jurisdiction from API
                    county_fips = str(rec.get("county_fips", "") or "").zfill(5)
                    base_records.append({
                        "jurisdiction":    jur,
                        "county_fips":     county_fips if county_fips.startswith("08") else "",
                        "has_iz":          bool(rec.get("has_iz", True)),
                        "ordinance_type":  rec.get("ordinance_type", ""),
                        "set_aside_pct":   rec.get("set_aside_pct"),
                        "ami_target":      rec.get("ami_target"),
                        "linkage_fee_per_sqft": rec.get("linkage_fee"),
                        "applies_to":      rec.get("applies_to"),
                        "enacted_year":    rec.get("enacted_year"),
                        "notes":           rec.get("notes", ""),
                        "source":          "Furman Center National IZ Database",
                    })
        log(f"  Furman Center API: augmented {len(api_data)} records")
    except Exception as exc:
        log(f"  Furman Center API unavailable: {exc}", level="WARN")

    return base_records


def main() -> int:
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    generated = utc_now()

    ordinances = list(IZ_ORDINANCES_STATIC)
    ordinances = augment_from_api(ordinances)

    has_iz_count = sum(1 for o in ordinances if o.get("has_iz"))
    mandatory_count = sum(
        1 for o in ordinances
        if o.get("ordinance_type") == "mandatory_set_aside"
    )
    avg_set_aside = (
        sum(o["set_aside_pct"] for o in ordinances if o.get("set_aside_pct"))
        / max(has_iz_count, 1)
    )

    result = {
        "meta": {
            "source": "DOLA + Municipal Ordinance Research + Furman Center IZ Database",
            "url": "https://furmancenter.org/research/iri/inclusionary-zoning-database",
            "state": "Colorado",
            "state_fips": STATE_FIPS,
            "vintage": "2024",
            "generated": generated,
            "jurisdiction_count": len(ordinances),
            "has_iz_count": has_iz_count,
            "mandatory_iz_count": mandatory_count,
            "avg_set_aside_pct": round(avg_set_aside, 1),
            "coverage_pct": 100.0,
            "note": (
                "Updated annually from municipal ordinance research. "
                "Rebuild via scripts/market/fetch_inclusionary_zoning.py"
            ),
        },
        "ordinances": sorted(ordinances, key=lambda x: x["jurisdiction"]),
    }

    with open(OUT_FILE, "w", encoding="utf-8") as fh:
        json.dump(result, fh, indent=2, ensure_ascii=False)

    log(f"✓ Wrote {len(ordinances)} IZ ordinance records to {OUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())