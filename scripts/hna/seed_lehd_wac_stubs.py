#!/usr/bin/env python3
"""
scripts/hna/seed_lehd_wac_stubs.py

Generates synthetic WAC-enriched stub data for LEHD county files.

This script is used when the LEHD WAC download is unavailable (e.g., no
network access in CI).  It derives workplace employment totals from the
existing OD data (within + inflow) and generates plausible year-over-year
trends and industry/wage distributions.

For production data, run build_hna_data.py which fetches real LEHD WAC files:
    python3 scripts/hna/build_hna_data.py

Usage:
    python3 scripts/hna/seed_lehd_wac_stubs.py

Output: overwrites each data/hna/lehd/<fips>.json in-place with synthetic
        annualEmployment, annualWages, yoyGrowth, and industries fields.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
LEHD_DIR = ROOT / "data" / "hna" / "lehd"

# Approximate Colorado industry distribution (CNS01–CNS20 NAICS supersectors)
# Fractions sum to 1.0; based on BLS QCEW Colorado statewide estimates.
_INDUSTRY_DISTRIBUTION: list[tuple[str, str, float]] = [
    ('CNS16', 'Healthcare & Social Assistance',     0.130),
    ('CNS07', 'Retail Trade',                       0.110),
    ('CNS12', 'Professional & Technical Services',  0.090),
    ('CNS18', 'Accommodation & Food Services',      0.100),
    ('CNS04', 'Construction',                       0.070),
    ('CNS05', 'Manufacturing',                      0.060),
    ('CNS20', 'Public Administration',              0.055),
    ('CNS14', 'Administrative & Waste Services',    0.060),
    ('CNS10', 'Finance & Insurance',                0.050),
    ('CNS08', 'Transportation & Warehousing',       0.040),
    ('CNS06', 'Wholesale Trade',                    0.040),
    ('CNS15', 'Educational Services',               0.030),
    ('CNS09', 'Information',                        0.030),
    ('CNS19', 'Other Services',                     0.035),
    ('CNS01', 'Agriculture & Mining',               0.030),
    ('CNS02', 'Mining, Quarrying, Oil & Gas',       0.020),
    ('CNS11', 'Real Estate',                        0.020),
    ('CNS17', 'Arts & Entertainment',               0.020),
    ('CNS13', 'Management of Companies',            0.010),
    ('CNS03', 'Utilities',                          0.010),
]

# Wage-band distribution: CE01 (<$15k/yr low), CE02 ($15k–$40k medium),
# CE03 (>$40k high).  Based on approximate Colorado LEHD proportions.
_WAGE_SHARES = {'low': 0.27, 'medium': 0.33, 'high': 0.40}

# Approximate COVID-era year-over-year deltas applied cumulatively from 2019.
_YOY_DELTA: dict[int, float] = {
    2019: 0.0,
    2020: -0.075,   # COVID contraction
    2021:  0.040,   # partial recovery
    2022:  0.050,   # continued rebound
    2023:  0.025,   # normalized growth
}

_WAC_YEARS = [2019, 2020, 2021, 2022, 2023]


def _utc_now_z() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _generate_wac(base_employment: int) -> dict:
    """Return a dict of WAC-enriched fields derived from *base_employment*."""
    # Build annual employment series
    cumulative = 1.0
    annual_emp: dict[str, int] = {}
    for yr in _WAC_YEARS:
        cumulative *= 1 + _YOY_DELTA[yr]
        annual_emp[str(yr)] = max(1, round(base_employment * cumulative))

    # YoY growth rates
    yoy_growth: dict[str, float | None] = {}
    yrs = sorted(annual_emp)
    for i in range(1, len(yrs)):
        prev = annual_emp[yrs[i - 1]]
        curr = annual_emp[yrs[i]]
        yoy_growth[yrs[i]] = round((curr - prev) / prev * 100, 2) if prev else None

    # Annual wage-band counts
    annual_wages: dict[str, dict[str, int]] = {}
    for yr in _WAC_YEARS:
        total = annual_emp[str(yr)]
        annual_wages[str(yr)] = {
            'low':    max(0, round(total * _WAGE_SHARES['low'])),
            'medium': max(0, round(total * _WAGE_SHARES['medium'])),
            'high':   max(0, round(total * _WAGE_SHARES['high'])),
        }

    # Industry breakdown for primary year (2023)
    total_2023 = annual_emp['2023']
    industries = []
    for col, label, share in _INDUSTRY_DISTRIBUTION:
        count = round(total_2023 * share)
        if count > 0:
            industries.append({
                'naics': col,
                'label': label,
                'count': count,
                'pct':   round(share * 100, 1),
            })
    industries.sort(key=lambda x: x['count'], reverse=True)

    return {
        'wacYear':          2023,
        'annualEmployment': annual_emp,
        'annualWages':      annual_wages,
        'yoyGrowth':        yoy_growth,
        'industries':       industries,
    }


def main() -> int:
    files = sorted(LEHD_DIR.glob('*.json'))
    if not files:
        print(f"ERROR: No JSON files found in {LEHD_DIR}")
        print("       Run: python3 scripts/hna/build_hna_data.py")
        return 1

    print(f"Seeding synthetic WAC stub data for {len(files)} LEHD county files…\n")
    updated = 0

    for fpath in files:
        try:
            with open(fpath, encoding='utf-8') as fh:
                payload: dict = json.load(fh)
        except (OSError, json.JSONDecodeError) as exc:
            print(f"  SKIP {fpath.name}: {exc}")
            continue

        # Use within+inflow (OD data) as a proxy for total workplace jobs.
        base_emp = (payload.get('within') or 0) + (payload.get('inflow') or 0)
        if base_emp < 100:
            base_emp = 1000  # safety floor for sparsely populated counties

        wac = _generate_wac(base_emp)
        payload.update(wac)

        with open(fpath, 'w', encoding='utf-8') as fh:
            json.dump(payload, fh)

        print(f"  OK  {fpath.name} "
              f"(2023 emp: {wac['annualEmployment'].get('2023', 'N/A'):,}; "
              f"industries: {len(wac['industries'])})")
        updated += 1

    print(f"\n✓ WAC stub data seeded for {updated} county files.")
    print()
    print("NOTE: This file contains synthetic placeholder data derived from OD")
    print("      employment totals.  To replace with real LEHD WAC data run:")
    print("        python3 scripts/hna/build_hna_data.py")
    print("      Then validate with:")
    print("        node scripts/validate-hna-lehd.js")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
