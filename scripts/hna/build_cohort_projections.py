#!/usr/bin/env python3
"""build_cohort_projections.py — Generate cohort-component forward projections for all counties.

Reads DOLA SYA JSON files, runs the CohortComponentModel for each county under
three scenarios (baseline, low_growth, high_growth), and writes the results to
data/hna/projections/ as supplemental "_scenarios.json" sidecar files.

This script does NOT overwrite the main projections/{fips}.json files (which are
produced by build_hna_data.py). Instead it writes {fips}_scenarios.json with the
three scenario result sets for use by the scenario builder UI.

Usage
-----
    python3 scripts/hna/build_cohort_projections.py
    python3 scripts/hna/build_cohort_projections.py --county 08031
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

_HERE   = os.path.dirname(os.path.abspath(__file__))
_ROOT   = Path(os.path.dirname(os.path.dirname(_HERE)))

# Import the Python projection engine
sys.path.insert(0, str(_ROOT))
try:
    from scripts.hna.demographic_projections import CohortComponentModel, AGE_GROUPS, N_COHORTS
    from scripts.hna.household_projections import HeadshipRateModel
    from scripts.hna.housing_demand_projections import HousingDemandProjector
except ImportError as e:
    print(f"ERROR: Could not import projection modules: {e}", file=sys.stderr)
    sys.exit(1)

_DOLA_DIR  = _ROOT / "data" / "hna" / "dola_sya"
_PROJ_DIR  = _ROOT / "data" / "hna" / "projections"
_SCEN_FILE = _ROOT / "scripts" / "hna" / "projection_scenarios.json"

BASE_YEAR   = 2024
TARGET_YEAR = 2050
HEADSHIP_RATE  = 0.38
VACANCY_TARGET = 0.05


def load_scenarios() -> dict:
    with open(_SCEN_FILE, "r", encoding="utf-8") as fh:
        return json.load(fh)


def build_base_population_from_dola(dola: dict) -> dict:
    """Convert DOLA SYA pyramid to cohort-component base population."""
    pop = {"male": [0.0] * N_COHORTS, "female": [0.0] * N_COHORTS}
    pyramid = dola.get("pyramid", [])
    for row in pyramid:
        age = row.get("age", 0)
        idx = min(int(age) // 5, N_COHORTS - 1)
        pop["male"][idx]   += float(row.get("male", 0))
        pop["female"][idx] += float(row.get("female", 0))
    return pop


def run_scenario(base_pop: dict, scenario_name: str, scenarios: dict) -> list[dict]:
    """Run projection for one scenario, return list of yearly snapshots."""
    sc = scenarios.get(scenario_name, {})
    overrides = sc.get("parameters", {})

    model = CohortComponentModel(
        base_population=base_pop,
        scenario=scenario_name,
        scenario_overrides=overrides,
    )

    years = TARGET_YEAR - BASE_YEAR
    snapshots = model.project(years=years)

    results = []
    for snap in snapshots:
        year       = BASE_YEAR + snap["year_offset"]
        total_pop  = snap["total_population"]
        households = int(total_pop * HEADSHIP_RATE)
        units_needed = int(households / (1 - VACANCY_TARGET)) if VACANCY_TARGET < 1 else 0
        results.append({
            "year":           year,
            "totalPopulation": int(total_pop),
            "households":     households,
            "unitsNeeded":    units_needed,
        })

    return results


def process_county(fips: str, dola: dict, scenarios: dict) -> dict:
    """Generate all three scenario projections for a county."""
    base_pop = build_base_population_from_dola(dola)
    out = {
        "fips":         fips,
        "baseYear":     BASE_YEAR,
        "targetYear":   TARGET_YEAR,
        "generatedAt":  datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "vintage":      2024,
        "scenarios":    {},
    }

    for sc_name in ("baseline", "low_growth", "high_growth"):
        key = sc_name.replace("_", "-")
        try:
            results = run_scenario(base_pop, sc_name, scenarios)
            out["scenarios"][key] = results
        except Exception as e:
            print(f"  ⚠ {fips} scenario '{sc_name}' failed: {e}", file=sys.stderr)
            out["scenarios"][key] = []

    return out


def main(target_county: str | None = None) -> None:
    scenarios = load_scenarios()
    os.makedirs(_PROJ_DIR, exist_ok=True)

    dola_files = sorted(_DOLA_DIR.glob("*.json"))
    if not dola_files:
        print(f"ERROR: No DOLA SYA files found in {_DOLA_DIR}", file=sys.stderr)
        sys.exit(1)

    if target_county:
        dola_files = [f for f in dola_files if f.stem == target_county]
        if not dola_files:
            print(f"ERROR: No DOLA file for county {target_county}", file=sys.stderr)
            sys.exit(1)

    ok = 0
    failed = 0
    for dola_path in dola_files:
        fips = dola_path.stem
        try:
            with open(dola_path, "r", encoding="utf-8") as fh:
                dola = json.load(fh)
        except Exception as e:
            print(f"  ⚠ Could not read {dola_path.name}: {e}", file=sys.stderr)
            failed += 1
            continue

        result = process_county(fips, dola, scenarios)
        out_path = _PROJ_DIR / f"{fips}_scenarios.json"
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(result, fh, separators=(",", ":"))

        print(f"  {fips}: ✅ ({sum(len(v) for v in result['scenarios'].values())} data points)")
        ok += 1

    print(f"\n✅ {ok} counties processed, {failed} failed.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build cohort-component scenario projections")
    parser.add_argument("--county", metavar="FIPS", help="Process only this county FIPS (e.g. 08031)")
    args = parser.parse_args()
    main(args.county)
