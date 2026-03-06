#!/usr/bin/env python3
"""Unit tests for the demographic projections module.

Tests the CohortComponentModel for:
  - Cohort aging logic
  - Fertility application
  - Mortality application
  - Migration flow application
  - Multi-year projections

Also tests HeadshipRateModel and HousingDemandProjector.

Usage
-----
    python test/demographic_projections_test.py
"""

import sys
import os

# ---------------------------------------------------------------------------
# Path setup — allow running from the repo root or from test/
# ---------------------------------------------------------------------------

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

# ---------------------------------------------------------------------------
# Import modules under test
# ---------------------------------------------------------------------------

from scripts.hna.demographic_projections import (
    CohortComponentModel,
    AGE_GROUPS,
    N_COHORTS,
    DEFAULT_SURVIVAL,
    DEFAULT_ASFRs,
    SEX_RATIO_AT_BIRTH,
)
from scripts.hna.household_projections import (
    HeadshipRateModel,
    DEFAULT_HEADSHIP_RATES,
)
from scripts.hna.housing_demand_projections import (
    HousingDemandProjector,
    AMI_TIERS,
)

# ---------------------------------------------------------------------------
# Mini test harness
# ---------------------------------------------------------------------------

_passed = 0
_failed = 0


def _assert(condition: bool, message: str) -> None:
    global _passed, _failed
    if condition:
        print(f"  ✅ PASS: {message}")
        _passed += 1
    else:
        print(f"  ❌ FAIL: {message}", file=sys.stderr)
        _failed += 1


def _test(name: str, fn) -> None:
    print(f"\n[test] {name}")
    try:
        fn()
    except Exception as exc:
        global _failed
        print(f"  ❌ FAIL: threw unexpected error — {exc}", file=sys.stderr)
        _failed += 1


# ---------------------------------------------------------------------------
# Helper: build a simple test population
# ---------------------------------------------------------------------------

def _simple_population(total: float = 100_000.0) -> dict:
    """Return a uniform population of ``total`` split evenly across cohorts."""
    per_cohort = total / (N_COHORTS * 2)
    return {
        "male":   [per_cohort] * N_COHORTS,
        "female": [per_cohort] * N_COHORTS,
    }


# ---------------------------------------------------------------------------
# CohortComponentModel tests
# ---------------------------------------------------------------------------

def test_model_creates_with_valid_population():
    pop = _simple_population()
    model = CohortComponentModel(pop, scenario=None)
    _assert(model is not None, "model instantiates with valid population")


def test_model_raises_on_missing_keys():
    try:
        CohortComponentModel({"male": [0.0] * N_COHORTS}, scenario=None)
        _assert(False, "should have raised ValueError for missing 'female' key")
    except ValueError:
        _assert(True, "raises ValueError when 'female' key is absent")


def test_model_raises_on_wrong_cohort_count():
    try:
        CohortComponentModel({"male": [0.0] * 5, "female": [0.0] * 5}, scenario=None)
        _assert(False, "should have raised ValueError for wrong cohort count")
    except ValueError:
        _assert(True, "raises ValueError for wrong number of cohorts")


def test_base_year_snapshot():
    pop = _simple_population(200_000)
    model = CohortComponentModel(pop, scenario=None)
    snapshots = model.project(years=1)
    _assert(len(snapshots) >= 2, "project(years=1) returns at least 2 snapshots (base + year 1)")
    base = snapshots[0]
    _assert(base["year_offset"] == 0, "first snapshot has year_offset == 0")
    _assert(
        abs(base["total_population"] - 200_000) < 1.0,
        "base population matches input total"
    )


def test_aging_increases_older_cohorts():
    """After projection, population should age: cohort 1 (5-9) shrinks, cohort 2 (10-14) grows."""
    # Concentrated population in 0-4 cohort
    pop = {
        "male":   [10_000.0] + [0.0] * (N_COHORTS - 1),
        "female": [10_000.0] + [0.0] * (N_COHORTS - 1),
    }
    model = CohortComponentModel(pop, scenario=None)
    # No births/migration to isolate aging
    model.asfr           = [0.0] * N_COHORTS
    model.net_migration_annual = {ag: 0.0 for ag in AGE_GROUPS}

    snapshots = model.project(years=5)
    base  = snapshots[0]
    yr5   = snapshots[5]

    # Cohort index 1 (5-9) should have some population after 5 years of aging from index 0
    _assert(yr5["male"][1] > 0, "age group 5-9 gains population after 5 years (aging from 0-4)")
    # Cohort 0 (0-4) should have less (no new births)
    _assert(yr5["male"][0] < base["male"][0], "age group 0-4 declines without new births")


def test_population_declines_without_births_or_migration():
    pop = _simple_population(50_000)
    model = CohortComponentModel(pop, scenario=None)
    model.asfr                = [0.0] * N_COHORTS
    model.net_migration_annual = {ag: 0.0 for ag in AGE_GROUPS}

    snapshots = model.project(years=10)
    total_base = snapshots[0]["total_population"]
    total_yr10 = snapshots[10]["total_population"]
    _assert(total_yr10 < total_base, "population declines without births or migration")


def test_fertility_adds_births():
    """High fertility multiplier should produce more total population than zero fertility."""
    pop = _simple_population(50_000)
    model_no_fert = CohortComponentModel(pop, scenario=None)
    model_no_fert.asfr               = [0.0] * N_COHORTS
    model_no_fert.net_migration_annual = {ag: 0.0 for ag in AGE_GROUPS}

    model_fert = CohortComponentModel(pop, scenario=None)
    model_fert.net_migration_annual   = {ag: 0.0 for ag in AGE_GROUPS}

    snap_no_fert = model_no_fert.project(years=10)
    snap_fert    = model_fert.project(years=10)

    _assert(
        snap_fert[10]["total_population"] > snap_no_fert[10]["total_population"],
        "fertility adds births: population higher with fertility than without"
    )


def test_positive_migration_increases_population():
    pop = _simple_population(50_000)

    model_no_mig = CohortComponentModel(pop, scenario=None)
    model_no_mig.asfr               = [0.0] * N_COHORTS
    model_no_mig.net_migration_annual = {ag: 0.0 for ag in AGE_GROUPS}

    model_mig = CohortComponentModel(pop, scenario=None)
    model_mig.asfr               = [0.0] * N_COHORTS
    # 500 persons per year net migration
    model_mig.net_migration_annual = CohortComponentModel._distribute_migration(500.0)

    snap_no_mig = model_no_mig.project(years=10)
    snap_mig    = model_mig.project(years=10)

    _assert(
        snap_mig[10]["total_population"] > snap_no_mig[10]["total_population"],
        "positive net migration increases total population"
    )


def test_negative_migration_decreases_population():
    pop = _simple_population(50_000)

    model_no_mig = CohortComponentModel(pop, scenario=None)
    model_no_mig.asfr               = [0.0] * N_COHORTS
    model_no_mig.net_migration_annual = {ag: 0.0 for ag in AGE_GROUPS}

    model_out_mig = CohortComponentModel(pop, scenario=None)
    model_out_mig.asfr              = [0.0] * N_COHORTS
    model_out_mig.net_migration_annual = CohortComponentModel._distribute_migration(-500.0)

    snap_no_mig  = model_no_mig.project(years=10)
    snap_out_mig = model_out_mig.project(years=10)

    _assert(
        snap_out_mig[10]["total_population"] < snap_no_mig[10]["total_population"],
        "negative net migration decreases total population"
    )


def test_high_mortality_reduces_population():
    pop = _simple_population(50_000)
    model_std  = CohortComponentModel(pop, scenario=None)
    model_std.asfr               = [0.0] * N_COHORTS
    model_std.net_migration_annual = {ag: 0.0 for ag in AGE_GROUPS}

    model_high_mort = CohortComponentModel(
        pop, scenario=None, scenario_overrides={"mortality_multiplier": 1.5}
    )
    model_high_mort.asfr               = [0.0] * N_COHORTS
    model_high_mort.net_migration_annual = {ag: 0.0 for ag in AGE_GROUPS}

    snap_std  = model_std.project(years=10)
    snap_mort = model_high_mort.project(years=10)

    _assert(
        snap_mort[10]["total_population"] < snap_std[10]["total_population"],
        "higher mortality multiplier produces smaller population"
    )


def test_scenario_baseline_loads():
    pop = _simple_population(50_000)
    model = CohortComponentModel(pop, scenario="baseline")
    _assert(model.fertility_multiplier == 1.0, "baseline fertility multiplier == 1.0")
    _assert(model.mortality_multiplier == 1.0, "baseline mortality multiplier == 1.0")


def test_scenario_high_growth_has_more_migration():
    pop = _simple_population(50_000)
    model_base = CohortComponentModel(pop, scenario="baseline")
    model_high = CohortComponentModel(pop, scenario="high_growth")
    base_mig = sum(model_base.net_migration_annual.values())
    high_mig = sum(model_high.net_migration_annual.values())
    _assert(high_mig > base_mig, "high_growth scenario has more net migration than baseline")


def test_scenario_low_growth_has_less_migration():
    pop = _simple_population(50_000)
    model_base = CohortComponentModel(pop, scenario="baseline")
    model_low  = CohortComponentModel(pop, scenario="low_growth")
    base_mig = sum(model_base.net_migration_annual.values())
    low_mig  = sum(model_low.net_migration_annual.values())
    _assert(low_mig < base_mig, "low_growth scenario has less net migration than baseline")


def test_population_total_method():
    pop  = _simple_population(80_000)
    model = CohortComponentModel(pop, scenario=None)
    snaps = model.project(years=5)
    totals = model.total_population(snaps)
    _assert(len(totals) == 6, "total_population() returns 6 values for 5-year projection (base + 5)")
    _assert(abs(totals[0] - 80_000) < 1.0, "first total matches base population")


def test_projection_no_negative_cohorts():
    pop = {
        "male":   [0.0] * N_COHORTS,
        "female": [100.0] + [0.0] * (N_COHORTS - 1),
    }
    model = CohortComponentModel(
        pop, scenario=None,
        scenario_overrides={"net_migration_annual": -2000}
    )
    snaps = model.project(years=10)
    for s in snaps:
        for sex in ("male", "female"):
            for v in s[sex]:
                _assert(v >= 0, f"all cohort values non-negative (year_offset={s['year_offset']})")


# ---------------------------------------------------------------------------
# HeadshipRateModel tests
# ---------------------------------------------------------------------------

def test_headship_model_basic():
    pop = _simple_population(100_000)
    model = CohortComponentModel(pop, scenario="baseline")
    snaps = model.project(years=5)
    hh_model = HeadshipRateModel(base_households=40_000)
    hh_series = hh_model.project_from_snapshots(snaps)
    _assert(len(hh_series) == 6, "headship series has 6 entries for 5-year projection")
    base_hh = hh_series[0]["households"]
    _assert(abs(base_hh - 40_000) < 1.0, "base households match calibration value")


def test_headship_calibration_holds():
    pop = _simple_population(100_000)
    model = CohortComponentModel(pop, scenario="baseline")
    snaps = model.project(years=1)
    hh_model = HeadshipRateModel(base_households=12_345)
    hh_series = hh_model.project_from_snapshots(snaps)
    _assert(abs(hh_series[0]["households"] - 12_345) < 1.0, "calibration matches exactly")


def test_headship_positive_trend_increases_households():
    pop = _simple_population(100_000)
    model = CohortComponentModel(pop, scenario="baseline")
    snaps = model.project(years=5)

    hh_hold   = HeadshipRateModel(base_households=40_000, headship_trend_per_year=0.0)
    hh_trend  = HeadshipRateModel(base_households=40_000, headship_trend_per_year=0.002)

    series_hold  = hh_hold.project_from_snapshots(snaps)
    series_trend = hh_trend.project_from_snapshots(snaps)

    _assert(
        series_trend[-1]["households"] > series_hold[-1]["households"],
        "positive headship trend produces more households over time"
    )


def test_headship_gq_accounting():
    pop = _simple_population(100_000)
    model = CohortComponentModel(pop, scenario="baseline")
    snaps = model.project(years=1)

    hh_with_gq    = HeadshipRateModel(base_households=40_000, account_for_gq=True)
    hh_without_gq = HeadshipRateModel(base_households=40_000, account_for_gq=False)

    gq_pop    = hh_with_gq.project_from_snapshots(snaps)[0]["gq_population"]
    no_gq_pop = hh_without_gq.project_from_snapshots(snaps)[0]["gq_population"]

    _assert(gq_pop > 0, "GQ accounting produces positive group-quarters population")
    _assert(no_gq_pop == 0.0, "GQ disabled produces zero group-quarters population")


# ---------------------------------------------------------------------------
# HousingDemandProjector tests
# ---------------------------------------------------------------------------

def test_demand_projector_basic():
    pop = _simple_population(100_000)
    pop_model = CohortComponentModel(pop, scenario="baseline")
    snaps     = pop_model.project(years=5)
    hh_model  = HeadshipRateModel(base_households=40_000)
    hh_series = hh_model.project_from_snapshots(snaps)

    projector = HousingDemandProjector(base_year_units=42_000)
    demand    = projector.project(hh_series)

    _assert(len(demand) == 6, "demand series has 6 entries for 5-year horizon")
    _assert(demand[0]["year_offset"] == 0, "first demand entry year_offset == 0")
    _assert("demand_by_ami" in demand[0], "demand entry contains demand_by_ami")


def test_demand_ami_tiers_present():
    pop = _simple_population(100_000)
    pop_model = CohortComponentModel(pop, scenario="baseline")
    snaps     = pop_model.project(years=1)
    hh_model  = HeadshipRateModel(base_households=40_000)
    hh_series = hh_model.project_from_snapshots(snaps)

    projector = HousingDemandProjector(base_year_units=42_000)
    demand    = projector.project(hh_series)

    entry = demand[0]
    for tier in AMI_TIERS:
        _assert(tier in entry["demand_by_ami"]["renter"], f"renter tier '{tier}' present")
        _assert(tier in entry["demand_by_ami"]["owner"],  f"owner  tier '{tier}' present")


def test_demand_tenure_split_sums_to_households():
    pop = _simple_population(100_000)
    pop_model = CohortComponentModel(pop, scenario="baseline")
    snaps     = pop_model.project(years=1)
    hh_model  = HeadshipRateModel(base_households=40_000)
    hh_series = hh_model.project_from_snapshots(snaps)

    projector = HousingDemandProjector(
        base_year_units=42_000,
        tenure_split={"owner": 0.60, "renter": 0.40},
    )
    demand = projector.project(hh_series)
    entry  = demand[0]

    total = entry["owner_households"] + entry["renter_households"]
    _assert(abs(total - entry["total_households"]) < 1.0, "owner + renter sums to total households")


def test_demand_invalid_tenure_split_raises():
    try:
        HousingDemandProjector(base_year_units=42_000, tenure_split={"owner": 0.6, "renter": 0.6})
        _assert(False, "should raise ValueError for tenure split summing > 1")
    except ValueError:
        _assert(True, "raises ValueError for invalid tenure split")


def test_demand_summarize():
    pop = _simple_population(100_000)
    pop_model = CohortComponentModel(pop, scenario="baseline")
    snaps     = pop_model.project(years=10)
    hh_model  = HeadshipRateModel(base_households=40_000)
    hh_series = hh_model.project_from_snapshots(snaps)

    projector = HousingDemandProjector(base_year_units=42_000)
    demand    = projector.project(hh_series)
    summary   = projector.summarize(demand)

    _assert("horizon_years"    in summary, "summarize() returns horizon_years")
    _assert("total_new_units"  in summary, "summarize() returns total_new_units")
    _assert("ami_incremental_demand" in summary, "summarize() returns ami_incremental_demand")


def test_high_growth_more_units_than_baseline():
    pop = _simple_population(100_000)

    def run(scenario):
        pm = CohortComponentModel(pop, scenario=scenario)
        snaps = pm.project(years=10)
        hhm   = HeadshipRateModel(base_households=40_000)
        hhs   = hhm.project_from_snapshots(snaps)
        proj  = HousingDemandProjector(base_year_units=42_000)
        dm    = proj.project(hhs)
        return dm[-1]["units_required"]

    units_baseline   = run("baseline")
    units_high_growth = run("high_growth")

    _assert(units_high_growth > units_baseline,
            "high_growth scenario requires more units than baseline at year 10")


# ---------------------------------------------------------------------------
# Run all tests
# ---------------------------------------------------------------------------

_test("CohortComponentModel: valid instantiation", test_model_creates_with_valid_population)
_test("CohortComponentModel: missing key raises ValueError", test_model_raises_on_missing_keys)
_test("CohortComponentModel: wrong cohort count raises ValueError", test_model_raises_on_wrong_cohort_count)
_test("CohortComponentModel: base year snapshot", test_base_year_snapshot)
_test("CohortComponentModel: aging increases older cohorts", test_aging_increases_older_cohorts)
_test("CohortComponentModel: population declines without births or migration", test_population_declines_without_births_or_migration)
_test("CohortComponentModel: fertility adds births", test_fertility_adds_births)
_test("CohortComponentModel: positive migration increases population", test_positive_migration_increases_population)
_test("CohortComponentModel: negative migration decreases population", test_negative_migration_decreases_population)
_test("CohortComponentModel: high mortality reduces population", test_high_mortality_reduces_population)
_test("CohortComponentModel: baseline scenario loads", test_scenario_baseline_loads)
_test("CohortComponentModel: high_growth has more migration", test_scenario_high_growth_has_more_migration)
_test("CohortComponentModel: low_growth has less migration", test_scenario_low_growth_has_less_migration)
_test("CohortComponentModel: total_population() method", test_population_total_method)
_test("CohortComponentModel: no negative cohort values", test_projection_no_negative_cohorts)

_test("HeadshipRateModel: basic projection", test_headship_model_basic)
_test("HeadshipRateModel: calibration holds", test_headship_calibration_holds)
_test("HeadshipRateModel: positive trend increases households", test_headship_positive_trend_increases_households)
_test("HeadshipRateModel: group-quarters accounting", test_headship_gq_accounting)

_test("HousingDemandProjector: basic projection", test_demand_projector_basic)
_test("HousingDemandProjector: AMI tiers present", test_demand_ami_tiers_present)
_test("HousingDemandProjector: tenure split sums to households", test_demand_tenure_split_sums_to_households)
_test("HousingDemandProjector: invalid tenure split raises", test_demand_invalid_tenure_split_raises)
_test("HousingDemandProjector: summarize()", test_demand_summarize)
_test("HousingDemandProjector: high_growth > baseline units", test_high_growth_more_units_than_baseline)

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

print(f"\n{'=' * 60}")
print(f"Results: {_passed} passed, {_failed} failed")

if _failed > 0:
    print("\nSome checks failed. Review the output above for details.", file=sys.stderr)
    sys.exit(1)
else:
    print("\nAll checks passed ✅")
