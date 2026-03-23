#!/usr/bin/env python3
"""validate_dola_fred_data.py — Validate DOLA SYA and FRED data files.

Checks:
  - All 64 Colorado county DOLA SYA files exist and have valid pyramid data
  - FRED data file exists, has a non-empty series list, and no gaps > 35 days
  - All FIPS codes are properly zero-padded 5-digit strings

Usage
-----
    python3 scripts/hna/validate_dola_fred_data.py
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_HERE       = os.path.dirname(os.path.abspath(__file__))
_ROOT       = Path(os.path.dirname(os.path.dirname(_HERE)))
_DOLA_DIR   = _ROOT / "data" / "hna" / "dola_sya"
_FRED_FILE  = _ROOT / "data" / "fred-data.json"
_SCEN_DIR   = _ROOT / "data" / "hna" / "scenarios"

# All 64 Colorado county FIPS codes (5-digit, zero-padded)
CO_COUNTY_FIPS = [
    "08001","08003","08005","08007","08009","08011","08013","08014",
    "08015","08017","08019","08021","08023","08025","08027","08029",
    "08031","08033","08035","08037","08039","08041","08043","08045",
    "08047","08049","08051","08053","08055","08057","08059","08061",
    "08063","08065","08067","08069","08071","08073","08075","08077",
    "08079","08081","08083","08085","08087","08089","08091","08093",
    "08095","08097","08099","08101","08103","08105","08107","08109",
    "08111","08113","08115","08117","08119","08121","08123","08125",
]

MAX_FRED_GAP_DAYS = 35
ERRORS: list[str] = []
WARNINGS: list[str] = []


# ---------------------------------------------------------------------------
# Validators
# ---------------------------------------------------------------------------

def validate_fips_code(fips: str, context: str) -> bool:
    """Rule 1: FIPS codes must always be 5-digit strings."""
    if not isinstance(fips, str):
        ERRORS.append(f"[FIPS] {context}: FIPS is not a string: {fips!r}")
        return False
    if len(fips) != 5:
        ERRORS.append(f"[FIPS] {context}: FIPS has {len(fips)} chars (expected 5): {fips!r}")
        return False
    if not fips.isdigit():
        ERRORS.append(f"[FIPS] {context}: FIPS is not all-digits: {fips!r}")
        return False
    return True


def validate_dola_sya_files() -> None:
    """Validate DOLA single-year-of-age files for all 64 counties."""
    print("\n── DOLA SYA Files ──")
    if not _DOLA_DIR.is_dir():
        ERRORS.append(f"[DOLA] Directory not found: {_DOLA_DIR}")
        return

    present  = set(p.stem for p in _DOLA_DIR.glob("*.json"))
    expected = set(CO_COUNTY_FIPS)
    missing  = expected - present
    # Filter out known statewide/aggregate files (e.g. '08' = Colorado state)
    extra    = present - expected - {'08'}

    if missing:
        WARNINGS.append(f"[DOLA] Missing SYA files for {len(missing)} counties: {sorted(missing)[:5]}…")
    if extra:
        WARNINGS.append(f"[DOLA] Unexpected SYA files (non-standard FIPS?): {sorted(extra)[:5]}")

    print(f"  Present: {len(present)} / 64 counties")

    for fips in sorted(expected & present):
        path = _DOLA_DIR / f"{fips}.json"
        try:
            with open(path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
        except json.JSONDecodeError as e:
            ERRORS.append(f"[DOLA] {fips}.json: invalid JSON — {e}")
            continue

        # Validate FIPS in file matches filename
        file_fips = data.get("fips") or data.get("county_fips")
        if file_fips and not validate_fips_code(str(file_fips), f"{fips}.json"):
            ERRORS.append(f"[DOLA] {fips}.json: embedded fips '{file_fips}' is malformed")

        # Validate age/sex arrays exist and have data
        # DOLA SYA files use 'ages', 'male', 'female' arrays (not 'pyramid')
        ages   = data.get("ages") or data.get("pyramid")
        male   = data.get("male")
        female = data.get("female")
        if not ages or not isinstance(ages, list):
            WARNINGS.append(f"[DOLA] {fips}.json: missing or empty 'ages' array")
            continue
        if not male or not female:
            WARNINGS.append(f"[DOLA] {fips}.json: missing 'male' or 'female' arrays")
            continue

        if len(ages) < 10:
            WARNINGS.append(f"[DOLA] {fips}.json: ages array has only {len(ages)} entries (expected ≥ 85)")

        # Validate year field (Rule 3)
        year = data.get("pyramidYear") or data.get("year")
        if year is not None and year != 2024:
            WARNINGS.append(f"[DOLA] {fips}.json: pyramidYear={year} (expected 2024)")

    print(f"  Validated FIPS formatting: {'✅ OK' if not any('[FIPS]' in e for e in ERRORS) else '❌ see errors'}")


def validate_fred_data() -> None:
    """Validate FRED data file (Rule 7: no gaps > 35 days, Rule 18: 'updated' key)."""
    print("\n── FRED Data ──")
    if not _FRED_FILE.is_file():
        WARNINGS.append(f"[FRED] data/fred-data.json not found — skipping FRED validation")
        return

    try:
        with open(_FRED_FILE, "r", encoding="utf-8") as fh:
            fred = json.load(fh)
    except json.JSONDecodeError as e:
        ERRORS.append(f"[FRED] Invalid JSON in fred-data.json: {e}")
        return

    # Rule 18: sentinel key 'updated' must exist
    if "updated" not in fred:
        ERRORS.append("[FRED] fred-data.json is missing required sentinel key 'updated'")
    else:
        print(f"  updated: {fred['updated']}")

    series_list = fred.get("series", {})
    # series can be a dict (keyed by series ID) or a list
    if isinstance(series_list, dict):
        series_items = list(series_list.values())
        series_ids   = list(series_list.keys())
    elif isinstance(series_list, list):
        series_items = series_list
        series_ids   = [s.get("id", f"idx{i}") for i, s in enumerate(series_list)]
    else:
        ERRORS.append("[FRED] fred-data.json 'series' is not an array or object")
        return

    print(f"  Series count: {len(series_items)}")

    gap_errors = 0
    for idx, s in enumerate(series_items):
        sid  = series_ids[idx] if idx < len(series_ids) else f"idx{idx}"
        name = s.get("name", "")
        obs  = s.get("observations", []) or s.get("data", [])

        # Rule 6: name must be non-empty
        if not name:
            WARNINGS.append(f"[FRED] Series '{sid}' has blank 'name'")

        # Rule 7: no gaps > 35 days
        if len(obs) < 2:
            if len(obs) == 0:
                WARNINGS.append(f"[FRED] Series '{sid}' has zero observations")
            continue

        dates = []
        for ob in obs:
            dt_str = ob.get("date") or ob.get("d")
            if dt_str:
                try:
                    dates.append(datetime.strptime(dt_str[:10], "%Y-%m-%d"))
                except ValueError:
                    pass

        dates.sort()
        for i in range(1, len(dates)):
            gap = (dates[i] - dates[i - 1]).days
            if gap > MAX_FRED_GAP_DAYS:
                WARNINGS.append(
                    f"[FRED] Series '{sid}': gap of {gap} days between "
                    f"{dates[i-1].date()} and {dates[i].date()}"
                )
                gap_errors += 1

    print(f"  Gap checks: {'✅ no gaps > 35 days' if gap_errors == 0 else f'⚠ {gap_errors} gap(s) found'}")


def validate_scenario_files() -> None:
    """Validate scenario JSON files in data/hna/scenarios/."""
    print("\n── Scenario Files ──")
    if not _SCEN_DIR.is_dir():
        WARNINGS.append(f"[SCENARIOS] data/hna/scenarios/ not found — run build_scenarios.py")
        return

    required = {"baseline.json", "low-growth.json", "high-growth.json"}
    present  = {p.name for p in _SCEN_DIR.glob("*.json")}
    missing  = required - present
    if missing:
        WARNINGS.append(f"[SCENARIOS] Missing files: {missing}")

    for fname in sorted(present):
        path = _SCEN_DIR / fname
        try:
            with open(path, "r", encoding="utf-8") as fh:
                sc = json.load(fh)
        except json.JSONDecodeError as e:
            ERRORS.append(f"[SCENARIOS] {fname}: invalid JSON — {e}")
            continue

        # Check required keys
        for key in ("id", "name", "parameters", "projectionHorizon"):
            if key not in sc:
                ERRORS.append(f"[SCENARIOS] {fname}: missing key '{key}'")

        params = sc.get("parameters", {})
        for p in ("fertility_multiplier", "mortality_multiplier", "net_migration_annual"):
            if p not in params:
                WARNINGS.append(f"[SCENARIOS] {fname}: parameters missing '{p}'")

        print(f"  {fname}: ✅")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    print("=" * 60)
    print("DOLA / FRED Data Validation")
    print("=" * 60)

    validate_dola_sya_files()
    validate_fred_data()
    validate_scenario_files()

    print("\n── Summary ──")
    if ERRORS:
        print(f"  ❌ {len(ERRORS)} error(s):")
        for e in ERRORS:
            print(f"     {e}")
    if WARNINGS:
        print(f"  ⚠  {len(WARNINGS)} warning(s):")
        for w in WARNINGS:
            print(f"     {w}")
    if not ERRORS and not WARNINGS:
        print("  ✅ All checks passed")
    elif not ERRORS:
        print("  ✅ No blocking errors (warnings noted above)")

    return 1 if ERRORS else 0


if __name__ == "__main__":
    sys.exit(main())
