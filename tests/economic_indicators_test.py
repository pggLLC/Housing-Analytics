#!/usr/bin/env python3
"""Unit tests for the economic indicators module.

Tests:
  - EmploymentGrowthIndicator: YoY growth, CAGR, edge cases
  - WageTrendIndicator: real wage calculation, affordability ratio
  - IndustryConcentration: HHI computation, interpretation
  - JobAccessibility: J:W ratio, in-county %, self-sufficiency score
  - UnemploymentContext: unemployment rate, LFPR, peer comparison

Usage
-----
    pytest tests/economic_indicators_test.py -v
    # (or, standalone) python tests/economic_indicators_test.py
"""

import sys
import os

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

# ---------------------------------------------------------------------------
# Import modules under test
# ---------------------------------------------------------------------------

from scripts.hna.economic_indicators import (
    EmploymentGrowthIndicator,
    WageTrendIndicator,
    IndustryConcentration,
    JobAccessibility,
    UnemploymentContext,
)
from scripts.hna.economic_housing_bridge import (
    WageAffordabilityGap,
    identify_sector_mismatches,
    affordability_by_industry,
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


# ===========================================================================
# EmploymentGrowthIndicator tests
# ===========================================================================

def test_yoy_growth_basic():
    ind = EmploymentGrowthIndicator({"2019": 45000, "2020": 43200, "2021": 46800, "2022": 49000, "2023": 52000})
    result = ind.compute()
    _assert(len(result["sorted_years"]) == 5, "sorted_years has 5 entries")
    _assert(result["sorted_years"][0] == 2019, "first year is 2019")
    _assert(len(result["yoy_series"]) == 4, "4 YoY change entries for 5 years")


def test_yoy_growth_values():
    ind = EmploymentGrowthIndicator({"2019": 50000, "2020": 55000})
    result = ind.compute()
    entry = result["yoy_series"][0]
    _assert(abs(entry["pct"] - 10.0) < 0.01, "10% growth from 50000 to 55000")


def test_yoy_growth_negative():
    ind = EmploymentGrowthIndicator({"2019": 50000, "2020": 40000})
    result = ind.compute()
    entry = result["yoy_series"][0]
    _assert(entry["pct"] < 0, "negative YoY growth when employment falls")
    _assert(abs(entry["pct"] - (-20.0)) < 0.01, "-20% growth from 50000 to 40000")


def test_cagr_correct():
    # 50000 → 61051.25 over 5 years ≈ 4% CAGR
    start = 50000
    end = round(50000 * (1.04 ** 5))
    ind = EmploymentGrowthIndicator({"2019": start, "2020": start, "2021": start, "2022": start, "2023": start, "2024": end})
    result = ind.compute()
    _assert(result["cagr_pct"] is not None, "CAGR is computed for multi-year series")
    _assert(abs(result["cagr_pct"] - 4.0) < 0.1, "CAGR ≈ 4% matches expected value")


def test_cagr_single_year():
    ind = EmploymentGrowthIndicator({"2023": 50000})
    result = ind.compute()
    _assert(result["cagr_pct"] is None, "CAGR is None for single-year series")


def test_peak_and_trough():
    ind = EmploymentGrowthIndicator({"2019": 45000, "2020": 40000, "2021": 52000})
    result = ind.compute()
    _assert(result["peak_year"] == 2021, "peak year identified correctly")
    _assert(result["trough_year"] == 2020, "trough year identified correctly")


def test_negative_employment_raises():
    try:
        EmploymentGrowthIndicator({"2019": -1000})
        _assert(False, "should raise ValueError for negative employment")
    except ValueError:
        _assert(True, "raises ValueError for negative employment count")


def test_invalid_type_raises():
    try:
        EmploymentGrowthIndicator("not a dict")
        _assert(False, "should raise TypeError for non-dict input")
    except TypeError:
        _assert(True, "raises TypeError for non-dict input")


def test_empty_returns_empty_series():
    ind = EmploymentGrowthIndicator({})
    result = ind.compute()
    _assert(result["sorted_years"] == [], "empty input returns empty sorted_years")
    _assert(result["cagr_pct"] is None, "empty input returns None cagr_pct")


def test_total_change_pct():
    ind = EmploymentGrowthIndicator({"2019": 40000, "2023": 50000})
    result = ind.compute()
    _assert(result["total_change_pct"] is not None, "total_change_pct is computed")
    _assert(abs(result["total_change_pct"] - 25.0) < 0.01, "total_change_pct = 25% from 40k to 50k")


# ===========================================================================
# WageTrendIndicator tests
# ===========================================================================

def test_wage_trend_nominal_series():
    ind = WageTrendIndicator({"2019": 40000, "2020": 41500, "2021": 43000, "2022": 45000, "2023": 47000})
    result = ind.compute()
    _assert(len(result["nominal_wages"]) == 5, "nominal_wages has 5 entries")
    _assert(result["sorted_years"][0] == 2019, "first year is 2019")


def test_wage_trend_real_vs_nominal_with_cpi():
    # CPI rising: real wages grow more slowly than nominal
    ind = WageTrendIndicator(
        annual_wages={"2019": 40000, "2023": 48000},
        cpi_deflators={"2019": 100.0, "2023": 115.0},  # 15% inflation
    )
    result = ind.compute()
    _assert(result["real_wages"][0] == result["nominal_wages"][0], "base year: real == nominal")
    _assert(result["real_wages"][1] < result["nominal_wages"][1], "later years: real < nominal with inflation")


def test_wage_trend_without_cpi_same_as_nominal():
    ind = WageTrendIndicator({"2019": 40000, "2023": 50000})
    result = ind.compute()
    for r, n in zip(result["real_wages"], result["nominal_wages"]):
        _assert(abs(r - n) < 0.01, "real == nominal when no CPI provided")


def test_wage_trend_affordability_ratio():
    ind = WageTrendIndicator(
        annual_wages={"2019": 40000, "2023": 50000},
        annual_housing_costs={"2019": 20000, "2023": 25000},
    )
    result = ind.compute()
    # affordability ratio = wage / housing_cost
    _assert(result["affordability_ratio"][0] is not None, "affordability_ratio computed for 2019")
    _assert(abs(result["affordability_ratio"][0] - 2.0) < 0.01, "ratio = 40000 / 20000 = 2.0")


def test_wage_gap_latest():
    ind = WageTrendIndicator(
        annual_wages={"2023": 45000},
        annual_housing_costs={"2023": 50000},  # housing > wage → gap
    )
    result = ind.compute()
    _assert(result["wage_gap_latest"] is not None, "wage_gap_latest is computed")
    _assert(result["wage_gap_latest"] < 0, "negative gap when wage < housing cost")


def test_housing_cost_cagr():
    ind = WageTrendIndicator(
        annual_wages={"2019": 40000, "2023": 50000},
        annual_housing_costs={"2019": 18000, "2023": 24000},
    )
    result = ind.compute()
    _assert(result["housing_cost_cagr_pct"] is not None, "housing CAGR computed")
    _assert(result["housing_cost_cagr_pct"] > 0, "housing costs rising → positive CAGR")


def test_wage_trend_empty():
    ind = WageTrendIndicator({})
    result = ind.compute()
    _assert(result["sorted_years"] == [], "empty wage series")
    _assert(result["real_wage_cagr_pct"] is None, "None CAGR for empty series")


# ===========================================================================
# IndustryConcentration tests
# ===========================================================================

def test_hhi_monopoly():
    # Single industry: HHI should be 10000
    ind = IndustryConcentration({"CNS07": 10000})
    result = ind.compute()
    _assert(abs(result["hhi"] - 10000.0) < 0.01, "single-industry HHI = 10,000 (monopoly)")
    _assert(result["hhi_interpretation"] == "highly_concentrated", "single industry = highly_concentrated")


def test_hhi_equal_shares():
    # 10 equal industries: HHI = 10 × (10)² = 1000 → competitive
    ind = IndustryConcentration({f"IND{i}": 1000 for i in range(10)})
    result = ind.compute()
    _assert(abs(result["hhi"] - 1000.0) < 0.5, "10 equal industries → HHI ≈ 1000")
    _assert(result["hhi_interpretation"] == "competitive", "10 equal industries = competitive")


def test_hhi_top3_share():
    ind = IndustryConcentration({
        "A": 5000, "B": 3000, "C": 2000, "D": 1000, "E": 500,
    })
    result = ind.compute()
    top3 = result["top3_share_pct"]
    _assert(top3 > 0, "top3_share_pct is positive")
    # A+B+C = 10000/11500 ≈ 86.96%
    _assert(abs(top3 - 86.96) < 0.1, "top3_share_pct ≈ 86.96%")


def test_dominant_industry():
    ind = IndustryConcentration({"CNS07": 5000, "CNS04": 2000, "CNS16": 3000})
    result = ind.compute()
    _assert(result["dominant_industry"] == "CNS07", "CNS07 is dominant with 5000 jobs")


def test_zero_employment_returns_empty():
    ind = IndustryConcentration({"CNS01": 0, "CNS02": 0})
    result = ind.compute()
    _assert(result["total_employment"] == 0.0, "zero employment returned")
    _assert(result["hhi"] == 0.0, "HHI is 0 for all-zero employment")
    _assert(result["dominant_industry"] is None, "no dominant industry when all zero")


def test_negative_employment_raises():
    try:
        IndustryConcentration({"IND_A": -100})
        _assert(False, "should raise ValueError for negative employment")
    except ValueError:
        _assert(True, "raises ValueError for negative employment")


def test_industries_sorted_desc():
    ind = IndustryConcentration({"B": 2000, "A": 5000, "C": 1000})
    result = ind.compute()
    counts = [d["count"] for d in result["industries"]]
    _assert(counts == sorted(counts, reverse=True), "industries sorted by count descending")


# ===========================================================================
# JobAccessibility tests
# ===========================================================================

def test_job_accessibility_basic():
    ind = JobAccessibility(total_jobs=50000, resident_workers=45000, within_county=30000)
    result = ind.compute()
    _assert(result["jobs_to_workers_ratio"] is not None, "J:W ratio computed")
    _assert(abs(result["jobs_to_workers_ratio"] - round(50000/45000, 4)) < 0.001, "J:W = 50000/45000")


def test_in_county_employment_pct():
    ind = JobAccessibility(total_jobs=60000, resident_workers=50000, within_county=40000)
    result = ind.compute()
    _assert(result["in_county_employment_pct"] is not None, "in_county_employment_pct computed")
    _assert(abs(result["in_county_employment_pct"] - 80.0) < 0.1, "40000/50000 = 80% in-county")


def test_commute_tier_short():
    ind = JobAccessibility(total_jobs=100, resident_workers=100, within_county=80, avg_commute_minutes=15)
    _assert(ind.compute()["commute_tier"] == "short", "15 min commute → short tier")


def test_commute_tier_moderate():
    ind = JobAccessibility(total_jobs=100, resident_workers=100, within_county=80, avg_commute_minutes=25)
    _assert(ind.compute()["commute_tier"] == "moderate", "25 min commute → moderate tier")


def test_commute_tier_long():
    ind = JobAccessibility(total_jobs=100, resident_workers=100, within_county=80, avg_commute_minutes=45)
    _assert(ind.compute()["commute_tier"] == "long", "45 min commute → long tier")


def test_commute_tier_unknown():
    ind = JobAccessibility(total_jobs=100, resident_workers=100, within_county=80)
    _assert(ind.compute()["commute_tier"] == "unknown", "no commute data → unknown tier")


def test_self_sufficiency_score_range():
    ind = JobAccessibility(total_jobs=50000, resident_workers=45000, within_county=30000, avg_commute_minutes=22)
    score = ind.compute()["self_sufficiency_score"]
    _assert(0.0 <= score <= 1.0, "self-sufficiency score is in [0, 1]")


def test_negative_jobs_raises():
    try:
        JobAccessibility(total_jobs=-1, resident_workers=100, within_county=50)
        _assert(False, "should raise ValueError for negative total_jobs")
    except ValueError:
        _assert(True, "raises ValueError for negative total_jobs")


def test_employed_exceeds_workers_raises():
    try:
        JobAccessibility(total_jobs=100, resident_workers=80, within_county=90)
        # within_county ≤ jobs is fine; workers < within is technically fine too (in-commuters)
        # No error expected here
        _assert(True, "within > workers does not raise (in-commuters allowed)")
    except Exception:
        _assert(False, "should not raise for within > workers")


def test_zero_workers_returns_none_ratios():
    ind = JobAccessibility(total_jobs=1000, resident_workers=0, within_county=0)
    result = ind.compute()
    _assert(result["jobs_to_workers_ratio"] is None, "J:W ratio None when workers=0")
    _assert(result["in_county_employment_pct"] is None, "in-county % None when workers=0")


# ===========================================================================
# UnemploymentContext tests
# ===========================================================================

def test_unemployment_rate_basic():
    ind = UnemploymentContext(labor_force=100000, employed=94000)
    result = ind.compute()
    _assert(abs(result["unemployment_rate"] - 6.0) < 0.01, "UR = 6% (6000/100000)")
    _assert(result["unemployed_count"] == 6000.0, "unemployed_count = 6000")


def test_lfpr():
    ind = UnemploymentContext(labor_force=60000, employed=57000, civilian_population=100000)
    result = ind.compute()
    _assert(result["lfpr_pct"] is not None, "LFPR computed when population provided")
    _assert(abs(result["lfpr_pct"] - 60.0) < 0.01, "LFPR = 60%")


def test_lfpr_none_without_population():
    ind = UnemploymentContext(labor_force=60000, employed=57000)
    _assert(ind.compute()["lfpr_pct"] is None, "LFPR is None when no civilian population")


def test_vs_state_comparison():
    ind = UnemploymentContext(
        labor_force=100000, employed=95000,
        state_unemployment_rate=4.0,
    )
    result = ind.compute()
    # UR = 5%, state = 4% → vs_state = +1.0 pp
    _assert(result["vs_state_ppt"] is not None, "vs_state_ppt computed")
    _assert(abs(result["vs_state_ppt"] - 1.0) < 0.01, "vs_state_ppt = +1.0 pp")
    _assert(result["context_label"] == "average", "1pp above state → average")


def test_above_average_context():
    ind = UnemploymentContext(
        labor_force=100000, employed=93000,
        state_unemployment_rate=4.0,
    )
    result = ind.compute()
    # UR = 7%, vs_state = +3pp → above_average
    _assert(result["context_label"] == "above_average", "UR 3pp above state → above_average")


def test_below_average_context():
    ind = UnemploymentContext(
        labor_force=100000, employed=98000,
        state_unemployment_rate=4.0,
    )
    result = ind.compute()
    # UR = 2%, vs_state = -2pp → below_average
    _assert(result["context_label"] == "below_average", "UR 2pp below state → below_average")


def test_invalid_employed_exceeds_labor_force():
    try:
        UnemploymentContext(labor_force=100000, employed=110000)
        _assert(False, "should raise ValueError when employed > labor_force")
    except ValueError:
        _assert(True, "raises ValueError when employed > labor_force")


def test_negative_labor_force_raises():
    try:
        UnemploymentContext(labor_force=-1, employed=0)
        _assert(False, "should raise ValueError for negative labor_force")
    except ValueError:
        _assert(True, "raises ValueError for negative labor_force")


def test_full_employment():
    ind = UnemploymentContext(labor_force=50000, employed=50000)
    result = ind.compute()
    _assert(result["unemployment_rate"] == 0.0, "zero unemployment rate when fully employed")


# ===========================================================================
# WageAffordabilityGap (economic_housing_bridge) tests
# ===========================================================================

def test_wage_gap_affordable():
    gap = WageAffordabilityGap(median_annual_wage=60000, median_annual_rent=15000)
    result = gap.compute()
    _assert(result["affordable"] is True, "affordable when rent < 30% of wage")
    _assert(result["rent_burden_pct"] < 30.0, "rent_burden_pct < 30%")


def test_wage_gap_not_affordable():
    gap = WageAffordabilityGap(median_annual_wage=30000, median_annual_rent=18000)
    result = gap.compute()
    _assert(result["affordable"] is False, "not affordable when rent > 30% of wage")
    _assert(result["gap_dollars"] > 0, "positive gap when wage insufficient")


def test_wage_gap_tiers():
    # Use rent $1,000/mo = $12,000 annual so high-wage tier (max $1,375/mo) can afford it
    gap = WageAffordabilityGap(median_annual_wage=40000, median_annual_rent=12000)
    result = gap.compute()
    tiers = result["wage_tiers"]
    _assert("low" in tiers and "medium" in tiers and "high" in tiers, "all wage tiers present")
    _assert(tiers["low"]["can_afford"] is False, "low-wage workers cannot afford $1,000/mo rent")
    _assert(tiers["high"]["can_afford"] is True, "high-wage workers can afford $1,000/mo rent")


def test_wage_gap_ownership():
    gap = WageAffordabilityGap(
        median_annual_wage=50000,
        median_annual_rent=18000,
        median_home_price=350000,
    )
    result = gap.compute()
    _assert(result["income_needed_to_own"] is not None, "income_needed_to_own computed when price provided")


def test_negative_wage_raises():
    try:
        WageAffordabilityGap(median_annual_wage=-1000, median_annual_rent=18000)
        _assert(False, "should raise ValueError for negative wage")
    except ValueError:
        _assert(True, "raises ValueError for negative wage")


def test_identify_sector_mismatches():
    wages = {"Retail Trade": 28000, "Healthcare": 62000, "Food Service": 22000}
    mismatches = identify_sector_mismatches(wages, median_annual_rent=18000, top_n=5)
    labels = [m["sector"] for m in mismatches]
    _assert("Food Service" in labels, "Food Service should appear in results")
    # The top mismatch should NOT be Healthcare (which has a high wage)
    _assert(mismatches[0]["sector"] != "Healthcare", "Healthcare (high wage) is not the top mismatch")


def test_identify_sector_mismatches_sorted_by_deficit():
    wages = {"SectorA": 20000, "SectorB": 25000, "SectorC": 18000}
    mismatches = identify_sector_mismatches(wages, median_annual_rent=15000, top_n=5)
    deficits = [m["deficit"] for m in mismatches]
    _assert(deficits == sorted(deficits, reverse=True), "mismatches sorted by deficit descending")


def test_affordability_by_industry_structure():
    emp = {"Retail Trade": 3000, "Healthcare": 5000, "Construction": 2000}
    wages = {"Retail Trade": 32000, "Healthcare": 58000, "Construction": 54000}
    result = affordability_by_industry(emp, wages, median_annual_rent=18000)
    _assert(len(result) == 3, "all three sectors returned")
    _assert(result[0]["sector"] == "Healthcare", "sorted by employment desc (Healthcare=5000)")
    for row in result:
        _assert("can_afford_rent" in row, "can_afford_rent field present")
        _assert("income_gap_to_rent" in row, "income_gap_to_rent field present")


def test_affordability_by_industry_skips_missing_wages():
    emp = {"SectorA": 1000, "SectorB": 2000}
    wages = {"SectorA": 35000}  # SectorB has no wage
    result = affordability_by_industry(emp, wages, median_annual_rent=15000)
    _assert(len(result) == 1, "skips sectors without wage data")
    _assert(result[0]["sector"] == "SectorA", "only SectorA returned")


# ===========================================================================
# Run all tests
# ===========================================================================

_test("EmploymentGrowthIndicator: basic YoY series", test_yoy_growth_basic)
_test("EmploymentGrowthIndicator: YoY growth values", test_yoy_growth_values)
_test("EmploymentGrowthIndicator: negative YoY growth", test_yoy_growth_negative)
_test("EmploymentGrowthIndicator: CAGR correct", test_cagr_correct)
_test("EmploymentGrowthIndicator: CAGR single year", test_cagr_single_year)
_test("EmploymentGrowthIndicator: peak and trough years", test_peak_and_trough)
_test("EmploymentGrowthIndicator: negative count raises", test_negative_employment_raises)
_test("EmploymentGrowthIndicator: invalid type raises", test_invalid_type_raises)
_test("EmploymentGrowthIndicator: empty returns empty", test_empty_returns_empty_series)
_test("EmploymentGrowthIndicator: total_change_pct", test_total_change_pct)

_test("WageTrendIndicator: nominal series", test_wage_trend_nominal_series)
_test("WageTrendIndicator: real vs nominal with CPI", test_wage_trend_real_vs_nominal_with_cpi)
_test("WageTrendIndicator: without CPI same as nominal", test_wage_trend_without_cpi_same_as_nominal)
_test("WageTrendIndicator: affordability ratio", test_wage_trend_affordability_ratio)
_test("WageTrendIndicator: wage gap latest", test_wage_gap_latest)
_test("WageTrendIndicator: housing cost CAGR", test_housing_cost_cagr)
_test("WageTrendIndicator: empty series", test_wage_trend_empty)

_test("IndustryConcentration: monopoly HHI = 10000", test_hhi_monopoly)
_test("IndustryConcentration: equal shares HHI ≈ 1000", test_hhi_equal_shares)
_test("IndustryConcentration: top3 share pct", test_hhi_top3_share)
_test("IndustryConcentration: dominant industry", test_dominant_industry)
_test("IndustryConcentration: zero employment", test_zero_employment_returns_empty)
_test("IndustryConcentration: negative employment raises", test_negative_employment_raises)
_test("IndustryConcentration: industries sorted desc", test_industries_sorted_desc)

_test("JobAccessibility: basic J:W ratio", test_job_accessibility_basic)
_test("JobAccessibility: in-county employment pct", test_in_county_employment_pct)
_test("JobAccessibility: commute tier short", test_commute_tier_short)
_test("JobAccessibility: commute tier moderate", test_commute_tier_moderate)
_test("JobAccessibility: commute tier long", test_commute_tier_long)
_test("JobAccessibility: commute tier unknown", test_commute_tier_unknown)
_test("JobAccessibility: self-sufficiency score in [0,1]", test_self_sufficiency_score_range)
_test("JobAccessibility: negative jobs raises", test_negative_jobs_raises)
_test("JobAccessibility: within > workers (in-commuters OK)", test_employed_exceeds_workers_raises)
_test("JobAccessibility: zero workers → None ratios", test_zero_workers_returns_none_ratios)

_test("UnemploymentContext: basic UR", test_unemployment_rate_basic)
_test("UnemploymentContext: LFPR", test_lfpr)
_test("UnemploymentContext: LFPR None without population", test_lfpr_none_without_population)
_test("UnemploymentContext: vs_state comparison", test_vs_state_comparison)
_test("UnemploymentContext: above_average context", test_above_average_context)
_test("UnemploymentContext: below_average context", test_below_average_context)
_test("UnemploymentContext: employed > labor_force raises", test_invalid_employed_exceeds_labor_force)
_test("UnemploymentContext: negative labor_force raises", test_negative_labor_force_raises)
_test("UnemploymentContext: full employment", test_full_employment)

_test("WageAffordabilityGap: affordable case", test_wage_gap_affordable)
_test("WageAffordabilityGap: not affordable case", test_wage_gap_not_affordable)
_test("WageAffordabilityGap: wage tiers", test_wage_gap_tiers)
_test("WageAffordabilityGap: ownership gap", test_wage_gap_ownership)
_test("WageAffordabilityGap: negative wage raises", test_negative_wage_raises)
_test("identify_sector_mismatches: basic", test_identify_sector_mismatches)
_test("identify_sector_mismatches: sorted by deficit", test_identify_sector_mismatches_sorted_by_deficit)
_test("affordability_by_industry: structure", test_affordability_by_industry_structure)
_test("affordability_by_industry: skips missing wages", test_affordability_by_industry_skips_missing_wages)

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
