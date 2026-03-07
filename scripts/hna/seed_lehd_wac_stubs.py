#!/usr/bin/env python3
"""
scripts/hna/seed_lehd_wac_stubs.py

Seed LEHD county files in data/hna/lehd/ with synthetic WAC-enriched fields
for CI / offline environments where the real LEHD WAC downloads are not available.

For each county file the script:
  1. Reads the existing OD employment totals (``within`` + ``inflow``).
  2. Applies Colorado statewide industry-distribution and wage-band shares to
     derive per-year employment, wages, and an industry breakdown.
  3. Writes the following fields back into the county JSON file:
       - ``annualEmployment``  {year: total_jobs, …}  (2019–2023)
       - ``annualWages``       {year: {low, medium, high}, …}
       - ``yoyGrowth``         {year: pct_change, …}  (year-over-year vs prior year)
       - ``industries``        list of {naics, label, count, pct} sorted by count
  4. Sets ``syntheticWac: true`` to signal that the data is derived, not from
     the real Census LEHD WAC files.

OUTPUT IS SYNTHETIC.  The values are approximations based on Colorado statewide
averages and should be replaced with real LEHD WAC data by running the full HNA
data build pipeline once network access is available:

    python3 scripts/hna/build_hna_data.py

Usage:
    python3 scripts/hna/seed_lehd_wac_stubs.py [--dry-run]

Options:
    --dry-run   Print what would be written without modifying any files.

Exit codes:
    0  All files successfully seeded (or dry-run completed).
    1  No LEHD county files found, or no usable OD data in any file.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

ROOT     = Path(__file__).resolve().parent.parent.parent
LEHD_DIR = ROOT / "data" / "hna" / "lehd"

# ---------------------------------------------------------------------------
# Constants — Colorado statewide approximations derived from 2022 LEHD actuals
# ---------------------------------------------------------------------------

# Years to seed (2019–2023 matching the full LEHD WAC snapshot range)
SEED_YEARS = [2019, 2020, 2021, 2022, 2023]

# Employment growth factors relative to the 2022 OD `within` baseline.
# 2022 OD `within` ≈ the total workplace employment for that county in 2022.
GROWTH_FACTORS: dict[int, float] = {
    2019: 1.03,   # pre-COVID baseline
    2020: 0.92,   # COVID-year contraction
    2021: 0.97,   # partial recovery
    2022: 1.00,   # LODES OD base year (`within` value)
    2023: 1.02,   # continued recovery / growth
}

# Wage band shares (CE01 ≤$1,250/mo, CE02 mid, CE03 >$3,333/mo)
# Based on Colorado statewide LEHD 2022 actuals.
WAGE_BAND_SHARES: dict[str, float] = {
    "CE01": 0.23,  # low
    "CE02": 0.40,  # medium
    "CE03": 0.37,  # high
}

# Industry sector shares (CNS01–CNS20) — Colorado statewide approximation.
INDUSTRY_SHARES: dict[str, float] = {
    "CNS01": 0.02,  # Agriculture & Forestry
    "CNS02": 0.02,  # Mining & Oil/Gas
    "CNS03": 0.01,  # Utilities
    "CNS04": 0.07,  # Construction
    "CNS05": 0.05,  # Manufacturing
    "CNS06": 0.03,  # Wholesale Trade
    "CNS07": 0.10,  # Retail Trade
    "CNS08": 0.04,  # Transportation & Warehousing
    "CNS09": 0.03,  # Information
    "CNS10": 0.04,  # Finance & Insurance
    "CNS11": 0.02,  # Real Estate
    "CNS12": 0.10,  # Professional & Technical Services
    "CNS13": 0.02,  # Management
    "CNS14": 0.07,  # Admin & Waste Services
    "CNS15": 0.03,  # Educational Services
    "CNS16": 0.13,  # Healthcare & Social Assistance
    "CNS17": 0.02,  # Arts & Entertainment
    "CNS18": 0.10,  # Accommodation & Food Services
    "CNS19": 0.04,  # Other Services
    "CNS20": 0.06,  # Public Administration
}

INDUSTRY_LABELS: dict[str, str] = {
    "CNS01": "Agriculture & Forestry",
    "CNS02": "Mining & Oil/Gas",
    "CNS03": "Utilities",
    "CNS04": "Construction",
    "CNS05": "Manufacturing",
    "CNS06": "Wholesale Trade",
    "CNS07": "Retail Trade",
    "CNS08": "Transportation & Warehousing",
    "CNS09": "Information",
    "CNS10": "Finance & Insurance",
    "CNS11": "Real Estate",
    "CNS12": "Professional & Technical Services",
    "CNS13": "Management",
    "CNS14": "Admin & Waste Services",
    "CNS15": "Educational Services",
    "CNS16": "Healthcare & Social Assistance",
    "CNS17": "Arts & Entertainment",
    "CNS18": "Accommodation & Food Services",
    "CNS19": "Other Services",
    "CNS20": "Public Administration",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utc_now_z() -> str:
    """Return current UTC time as an ISO-8601 string ending in 'Z'."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _seed_county(data: dict) -> dict:
    """Return a copy of *data* with WAC-enriched fields added/updated.

    Uses ``within`` + ``inflow`` as the workplace employment proxy for 2022,
    then scales to other years using *GROWTH_FACTORS*.
    """
    base_emp = (data.get("within") or 0) + (data.get("inflow") or 0)
    if base_emp <= 0:
        # Fall back to `within` alone if inflow is absent
        base_emp = data.get("within") or 0
    if base_emp <= 0:
        # No usable employment data — return unchanged
        return data

    annual_emp: dict[str, int] = {}
    annual_wages: dict[str, dict[str, int]] = {}

    for yr in SEED_YEARS:
        factor = GROWTH_FACTORS[yr]
        total = max(1, round(base_emp * factor))
        annual_emp[str(yr)] = total
        annual_wages[str(yr)] = {
            "low":    max(0, round(total * WAGE_BAND_SHARES["CE01"])),
            "medium": max(0, round(total * WAGE_BAND_SHARES["CE02"])),
            "high":   max(0, round(total * WAGE_BAND_SHARES["CE03"])),
        }

    # YoY growth rates
    yoy_growth: dict[str, float | None] = {}
    for i in range(1, len(SEED_YEARS)):
        prev_yr = SEED_YEARS[i - 1]
        curr_yr = SEED_YEARS[i]
        prev_val = annual_emp.get(str(prev_yr))
        curr_val = annual_emp.get(str(curr_yr))
        if prev_val and curr_val and prev_val > 0:
            pct = round((curr_val - prev_val) / prev_val * 100.0, 2)
        else:
            pct = None
        yoy_growth[str(curr_yr)] = pct

    # Industry breakdown from primary (latest) year
    primary_yr = str(SEED_YEARS[-1])
    primary_total = annual_emp[primary_yr]
    industries = []
    for naics, share in INDUSTRY_SHARES.items():
        count = max(0, round(primary_total * share))
        if count > 0:
            pct = round(count / primary_total * 100.0, 1) if primary_total > 0 else 0.0
            industries.append({
                "naics": naics,
                "label": INDUSTRY_LABELS[naics],
                "count": count,
                "pct":   pct,
            })
    industries.sort(key=lambda x: x["count"], reverse=True)

    # Primary-year flat columns for JS compatibility
    primary_wage = annual_wages[primary_yr]
    flat_cols: dict[str, int] = {
        "C000": primary_total,
        "CE01": primary_wage["low"],
        "CE02": primary_wage["medium"],
        "CE03": primary_wage["high"],
    }
    for ind in industries:
        flat_cols[ind["naics"]] = ind["count"]

    out = dict(data)
    out.update({
        "wacYear":          SEED_YEARS[-1],
        "annualEmployment": annual_emp,
        "annualWages":      annual_wages,
        "yoyGrowth":        yoy_growth,
        "industries":       industries,
        "syntheticWac":     True,
    })
    out.update(flat_cols)
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[1].strip())
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be written without modifying any files.",
    )
    args = parser.parse_args()

    if not LEHD_DIR.is_dir():
        print(
            f"ERROR: {LEHD_DIR} not found.\n"
            "Run: python3 scripts/hna/build_hna_data.py  (creates the OD county files first)",
            file=sys.stderr,
        )
        return 1

    county_files = sorted(LEHD_DIR.glob("*.json"))
    if not county_files:
        print(
            f"ERROR: No JSON files found in {LEHD_DIR}.\n"
            "Run: python3 scripts/hna/build_hna_data.py",
            file=sys.stderr,
        )
        return 1

    print(
        f"Seeding {len(county_files)} LEHD county files with synthetic WAC data "
        f"(years {SEED_YEARS[0]}–{SEED_YEARS[-1]}) …"
    )
    if args.dry_run:
        print("  [dry-run — no files will be modified]")

    seeded = 0
    skipped = 0

    for path in county_files:
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, json.JSONDecodeError) as exc:
            print(f"  SKIP {path.name}: cannot read — {exc}", file=sys.stderr)
            skipped += 1
            continue

        enriched = _seed_county(data)
        if enriched is data:
            # _seed_county returned unchanged (no usable employment)
            print(f"  SKIP {path.name}: no usable OD employment (within=0)")
            skipped += 1
            continue

        if args.dry_run:
            emp_yrs = list(enriched.get("annualEmployment", {}).keys())
            n_ind   = len(enriched.get("industries", []))
            print(f"  DRY  {path.name}: annualEmployment years={emp_yrs}, industries={n_ind}")
        else:
            enriched["updated"] = enriched.get("updated") or _utc_now_z()
            with open(path, "w", encoding="utf-8") as f:
                json.dump(enriched, f)
            emp_yrs = list(enriched.get("annualEmployment", {}).keys())
            n_ind   = len(enriched.get("industries", []))
            print(f"  OK   {path.name}: annualEmployment years={emp_yrs}, industries={n_ind} [synthetic]")
        seeded += 1

    print(
        f"\n{'DRY-RUN' if args.dry_run else 'Done'}: "
        f"{seeded} file(s) seeded, {skipped} skipped."
    )
    if not args.dry_run:
        print(
            "\nNOTE: Output is SYNTHETIC — derived from OD employment totals and Colorado\n"
            "      statewide industry/wage averages.  Replace with real LEHD WAC data by\n"
            "      running the full HNA data build pipeline:\n"
            "        python3 scripts/hna/build_hna_data.py"
        )

    return 0 if seeded > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
