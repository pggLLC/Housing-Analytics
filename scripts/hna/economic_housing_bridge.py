#!/usr/bin/env python3
"""Economic-housing affordability bridge for Housing Needs Assessment.

Connects labour-market wage data with housing cost data to surface:
  - The wage-affordability gap (what workers earn vs. what housing costs)
  - Sectors where wages are insufficient to afford local housing
  - A detailed affordability analysis broken down by industry / wage tier

Also exposes :func:`compute_ownership_affordability` which implements a full
PITI (Principal + Interest + Taxes + Insurance) mortgage underwriting model
that accounts for down payment, interest rate, property taxes, homeowner
insurance, PMI, HOA fees, and DTI ratio.

Usage
-----
    from scripts.hna.economic_housing_bridge import (
        WageAffordabilityGap,
        compute_ownership_affordability,
        identify_sector_mismatches,
        affordability_by_industry,
    )

    gap = WageAffordabilityGap(median_annual_wage=46000, median_annual_rent=18000)
    result = gap.compute()
    # result["gap_dollars"], result["affordable"], result["rent_burden_pct"], …

    own = compute_ownership_affordability(median_price=575000, median_income=86000)
    # own["monthly_payment"], own["required_annual_income"], own["affordability_gap_percent"], …
"""

from __future__ import annotations

import json
import math
import sys
from typing import Any


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Standard housing affordability threshold: monthly housing ≤ 30% gross income
AFFORDABILITY_THRESHOLD_PCT = 0.30

# Common wage tiers from LEHD WAC CE01–CE03 expressed as approximate annual wages
# CE01 ≤ $1,250/month  → ≤ $15,000/year
# CE02 $1,251–$3,333/month → $15,012–$39,996/year  (midpoint ≈ $27,500)
# CE03 > $3,333/month → > $39,996/year  (representative midpoint ≈ $55,000)
WAGE_TIER_ANNUAL = {
    "low":    15_000,
    "medium": 27_500,
    "high":   55_000,
}

LEHD_EARNINGS_FIELDS = {
    "low": "CE01",
    "medium": "CE02",
    "high": "CE03",
}

SERVICE_SECTOR_FIELDS = ("CNS07", "CNS16", "CNS18")

# Rule-of-thumb maximum rent-affordable to each tier at 30% of gross
# (annual wage × 0.30 / 12 = max monthly rent)
def _max_monthly_rent(annual_wage: float) -> float:
    return annual_wage * AFFORDABILITY_THRESHOLD_PCT / 12.0


def _num(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _round_or_none(value: float | None, digits: int = 1) -> float | None:
    return round(value, digits) if value is not None and math.isfinite(value) else None


def _normalize(value: float | None, low: float, high: float) -> float | None:
    if value is None:
        return None
    if high <= low:
        return None
    return _clamp((value - low) / (high - low) * 100.0)


def _latest_acs_cohort(county_trends: dict[str, Any] | None) -> dict[str, Any]:
    cohorts = (county_trends or {}).get("acs_cohorts") or []
    if not cohorts:
        return {}
    return max(cohorts, key=lambda row: row.get("year") or 0)


def _first_acs_cohort(county_trends: dict[str, Any] | None) -> dict[str, Any]:
    cohorts = (county_trends or {}).get("acs_cohorts") or []
    if not cohorts:
        return {}
    return min(cohorts, key=lambda row: row.get("year") or 9999)


def _pct_change(start: float | None, end: float | None) -> float | None:
    if start is None or end is None or start == 0:
        return None
    return (end - start) / start * 100.0


def county_service_sector_share_pct(county_lehd: dict[str, Any]) -> float | None:
    """Return county service-sector share of LEHD WAC jobs.

    Service sectors are Retail (CNS07), Health Care & Social Assistance
    (CNS16), and Accommodation & Food Services (CNS18), divided by C000.
    """
    total = _num(county_lehd.get("C000"))
    if not total or total <= 0:
        return None
    service_jobs = sum(_num(county_lehd.get(field)) or 0.0 for field in SERVICE_SECTOR_FIELDS)
    return service_jobs / total * 100.0


def estimate_county_median_annual_wage(county_lehd: dict[str, Any]) -> float | None:
    """Estimate a county annual wage from LEHD earnings-bin counts.

    The county cache stores CE01-CE03 job counts, not a dollar wage table.  This
    returns the representative annual wage for the bin containing the median
    job, using WAGE_TIER_ANNUAL as documented bin representatives.
    """
    counts = {
        tier: _num(county_lehd.get(field)) or 0.0
        for tier, field in LEHD_EARNINGS_FIELDS.items()
    }
    total = sum(counts.values())
    if total <= 0:
        return None
    midpoint = total / 2.0
    cumulative = 0.0
    for tier in ("low", "medium", "high"):
        cumulative += counts[tier]
        if cumulative >= midpoint:
            return float(WAGE_TIER_ANNUAL[tier])
    return float(WAGE_TIER_ANNUAL["high"])


def compute_wage_affordability_gap(
    median_home_value: float | None,
    median_gross_rent: float | None,
    county_median_annual_wage: float | None,
) -> dict[str, Any]:
    """Compare place housing costs with the containing county wage estimate."""
    if county_median_annual_wage is None or county_median_annual_wage < 0:
        return {
            "county_median_annual_wage_estimate": county_median_annual_wage,
            "rent_gap_dollars": None,
            "ownership_gap_dollars": None,
            "rent_burden_pct": None,
            "income_needed_to_rent": None,
            "income_needed_to_own": None,
        }
    annual_rent = (median_gross_rent or 0.0) * 12.0
    gap = WageAffordabilityGap(
        median_annual_wage=county_median_annual_wage,
        median_annual_rent=annual_rent,
        median_home_price=median_home_value,
    ).compute()
    return {
        "county_median_annual_wage_estimate": county_median_annual_wage,
        "rent_gap_dollars": gap["gap_dollars"],
        "ownership_gap_dollars": gap["own_gap_dollars"],
        "rent_burden_pct": gap["rent_burden_pct"],
        "income_needed_to_rent": gap["income_needed_to_rent"],
        "income_needed_to_own": gap["income_needed_to_own"],
    }


def compute_service_worker_demand(
    median_home_value: float | None,
    commute_ratio: float | None,
    service_sector_share_pct: float | None,
    ownership_gap_dollars: float | None,
) -> dict[str, Any]:
    """Bounded 0-100 workforce-housing-pressure blend.

    Blend terms:
      * place home-value pressure, normalized from $250k to $900k;
      * county service-sector share, normalized from 15% to 45%;
      * place in-commute pressure, using commute_ratio capped at 150%;
      * county wage gap pressure, using ownership income gap capped at $125k.

    The score is descriptive context only and is not fed into ranking.
    """
    home_pressure = _normalize(median_home_value, 250_000, 900_000)
    service_pressure = _normalize(service_sector_share_pct, 15.0, 45.0)
    commute_pressure = _normalize(commute_ratio, 0.0, 150.0)
    wage_gap_pressure = _normalize(max(ownership_gap_dollars or 0.0, 0.0), 0.0, 125_000.0)
    terms = [home_pressure, service_pressure, commute_pressure, wage_gap_pressure]
    present = [term for term in terms if term is not None]
    if not present:
        score = None
    else:
        weights = [0.30, 0.25, 0.25, 0.20]
        weighted = [
            (term, weights[index])
            for index, term in enumerate(terms)
            if term is not None
        ]
        score = sum(term * weight for term, weight in weighted) / sum(weight for _, weight in weighted)
    return {
        "score": _round_or_none(score),
        "home_value_pressure": _round_or_none(home_pressure),
        "service_sector_pressure": _round_or_none(service_pressure),
        "commute_pressure": _round_or_none(commute_pressure),
        "wage_gap_pressure": _round_or_none(wage_gap_pressure),
    }


def compute_place_workforce_housing_layer(record: dict[str, Any]) -> dict[str, Any]:
    """Compute B3 economic/service-worker context for one jurisdiction record."""
    county_lehd = record.get("county_lehd") or {}
    county_trends = record.get("county_trends") or {}
    home_value = _num(record.get("median_home_value"))
    gross_rent = _num(record.get("gross_rent_median"))
    commute_ratio = _num(record.get("commute_ratio"))
    in_commuters = _num(record.get("in_commuters"))
    county_wage = estimate_county_median_annual_wage(county_lehd)
    service_share = county_service_sector_share_pct(county_lehd)
    wage_gap = compute_wage_affordability_gap(home_value, gross_rent, county_wage)
    demand = compute_service_worker_demand(
        home_value,
        commute_ratio,
        service_share,
        wage_gap["ownership_gap_dollars"],
    )
    first = _first_acs_cohort(county_trends)
    latest = _latest_acs_cohort(county_trends)
    return {
        "geoid": record.get("geoid"),
        "county_fips": record.get("county_fips"),
        "county_median_annual_wage_estimate": _round_or_none(county_wage, 0),
        "service_sector_share_pct": _round_or_none(service_share, 1),
        "wage_affordability_rent_gap_dollars": _round_or_none(wage_gap["rent_gap_dollars"], 0),
        "wage_affordability_ownership_gap_dollars": _round_or_none(wage_gap["ownership_gap_dollars"], 0),
        "wage_affordability_rent_burden_pct": _round_or_none(wage_gap["rent_burden_pct"], 1),
        "workforce_housing_pressure_score": demand["score"],
        "workforce_housing_home_value_pressure": demand["home_value_pressure"],
        "workforce_housing_service_sector_pressure": demand["service_sector_pressure"],
        "workforce_housing_commute_pressure": demand["commute_pressure"],
        "workforce_housing_wage_gap_pressure": demand["wage_gap_pressure"],
        "in_commuters": _round_or_none(in_commuters, 0),
        "county_trend_rent_change_2009_2024_pct": _round_or_none(
            _pct_change(_num(first.get("median_gross_rent")), _num(latest.get("median_gross_rent"))), 1
        ),
        "county_trend_income_change_2009_2024_pct": _round_or_none(
            _pct_change(_num(first.get("median_hh_income")), _num(latest.get("median_hh_income"))), 1
        ),
        "county_trend_rent_burden_2024_pct": _round_or_none((_num(latest.get("rent_burden_30_plus")) or 0) * 100.0, 1)
            if latest.get("rent_burden_30_plus") is not None else None,
        "county_trend_vacancy_rate_2024_pct": _round_or_none((_num(latest.get("vacancy_rate")) or 0) * 100.0, 1)
            if latest.get("vacancy_rate") is not None else None,
        "county_trend_total_housing_units_2024": _round_or_none(_num(latest.get("total_housing_units")), 0),
    }


def _compute_layer_cli() -> None:
    payload = json.load(sys.stdin)
    records = payload if isinstance(payload, list) else payload.get("records", [])
    result = {
        str(record.get("geoid")): compute_place_workforce_housing_layer(record)
        for record in records
        if record.get("geoid")
    }
    json.dump(result, sys.stdout, sort_keys=True)


# ---------------------------------------------------------------------------
# WageAffordabilityGap
# ---------------------------------------------------------------------------

class WageAffordabilityGap:
    """Compute the gap between local wages and housing costs.

    Parameters
    ----------
    median_annual_wage : float
        Median annual wage for the area (e.g. from QCEW or ACS DP03).
    median_annual_rent : float
        Median gross annual rent (median monthly rent × 12).
    median_home_price : float | None
        Median owner-occupied home value.  Used to compute income needed to
        qualify for a mortgage (28% front-end ratio, 30-yr at *mortgage_rate*).
    mortgage_rate : float
        Annual mortgage interest rate as a decimal (default 0.065 = 6.5%).
    down_payment_pct : float
        Down payment fraction (default 0.10 = 10%).
    """

    def __init__(
        self,
        median_annual_wage: float,
        median_annual_rent: float,
        median_home_price: float | None = None,
        mortgage_rate: float = 0.065,
        down_payment_pct: float = 0.10,
    ) -> None:
        if median_annual_wage < 0:
            raise ValueError("median_annual_wage must be non-negative")
        if median_annual_rent < 0:
            raise ValueError("median_annual_rent must be non-negative")
        self._wage = float(median_annual_wage)
        self._rent = float(median_annual_rent)
        self._price = float(median_home_price) if median_home_price is not None else None
        self._rate = float(mortgage_rate)
        self._down = float(down_payment_pct)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _monthly_mortgage_payment(self, price: float) -> float:
        """Estimate principal-and-interest monthly payment."""
        loan = price * (1.0 - self._down)
        monthly_rate = self._rate / 12.0
        n = 360  # 30-year term
        if monthly_rate == 0:
            return loan / n
        return loan * (monthly_rate * (1 + monthly_rate) ** n) / ((1 + monthly_rate) ** n - 1)

    def _income_needed_to_rent(self) -> float:
        """Annual income required so that rent ≤ 30% of gross."""
        monthly_rent = self._rent / 12.0
        return monthly_rent / AFFORDABILITY_THRESHOLD_PCT * 12.0

    def _income_needed_to_own(self) -> float | None:
        if self._price is None:
            return None
        monthly_pi = self._monthly_mortgage_payment(self._price)
        # Use 28% front-end ratio for ownership
        return monthly_pi / 0.28 * 12.0

    # ------------------------------------------------------------------
    # Public compute
    # ------------------------------------------------------------------

    def compute(self) -> dict[str, Any]:
        """Return:
        - median_annual_wage      : float
        - median_annual_rent      : float
        - rent_burden_pct         : float  (rent as % of wage)
        - affordable              : bool   (rent ≤ 30% of wage)
        - gap_dollars             : float  (income needed to afford rent minus wage; negative = surplus)
        - income_needed_to_rent   : float  (minimum income for rent affordability)
        - income_needed_to_own    : float | None
        - own_gap_dollars         : float | None
        - wage_tiers              : dict   (affordability analysis per LEHD wage tier)
        """
        rent_burden = (self._rent / self._wage * 100.0) if self._wage > 0 else None
        affordable = bool(rent_burden is not None and rent_burden <= 30.0)

        income_rent = self._income_needed_to_rent()
        gap_rent = round(income_rent - self._wage, 2)

        income_own = self._income_needed_to_own()
        gap_own = round(income_own - self._wage, 2) if income_own is not None else None

        # Per-tier analysis
        monthly_rent = self._rent / 12.0
        wage_tiers: dict[str, dict] = {}
        for tier, annual_w in WAGE_TIER_ANNUAL.items():
            max_rent = _max_monthly_rent(annual_w)
            can_afford = max_rent >= monthly_rent
            deficit = round(monthly_rent - max_rent, 2) if not can_afford else 0.0
            wage_tiers[tier] = {
                "approx_annual_wage": annual_w,
                "max_affordable_monthly_rent": round(max_rent, 2),
                "actual_monthly_rent": round(monthly_rent, 2),
                "can_afford": can_afford,
                "monthly_deficit": deficit,
            }

        return {
            "median_annual_wage": self._wage,
            "median_annual_rent": self._rent,
            "rent_burden_pct": round(rent_burden, 2) if rent_burden is not None else None,
            "affordable": affordable,
            "gap_dollars": gap_rent,
            "income_needed_to_rent": round(income_rent, 2),
            "income_needed_to_own": round(income_own, 2) if income_own is not None else None,
            "own_gap_dollars": gap_own,
            "wage_tiers": wage_tiers,
        }


# ---------------------------------------------------------------------------
# Sector mismatch identification
# ---------------------------------------------------------------------------

def identify_sector_mismatches(
    industry_wages: dict[str, float],
    median_annual_rent: float,
    top_n: int = 5,
) -> list[dict[str, Any]]:
    """Identify sectors where typical wages cannot support local housing costs.

    Parameters
    ----------
    industry_wages : dict[str, float]
        Mapping from industry label → median annual wage for that sector.
        Example: {"Retail Trade": 32000, "Healthcare": 58000, …}
    median_annual_rent : float
        Median annual gross rent (monthly × 12) for the area.
    top_n : int
        Maximum number of mismatched sectors to return (sorted by deficit).

    Returns
    -------
    List of dicts, each containing:
        - sector         : str
        - annual_wage    : float
        - monthly_rent   : float
        - max_affordable : float
        - deficit        : float  (monthly rent − max affordable; 0 if none)
        - mismatched     : bool
    """
    monthly_rent = median_annual_rent / 12.0
    results = []
    for sector, wage in industry_wages.items():
        max_rent = _max_monthly_rent(wage)
        deficit = monthly_rent - max_rent
        mismatched = deficit > 0
        results.append({
            "sector": sector,
            "annual_wage": float(wage),
            "monthly_rent": round(monthly_rent, 2),
            "max_affordable_monthly_rent": round(max_rent, 2),
            "deficit": round(max(deficit, 0.0), 2),
            "mismatched": mismatched,
        })

    # Sort by deficit descending (most severe first), then by sector name for stability
    results.sort(key=lambda x: (-x["deficit"], x["sector"]))
    return results[:top_n]


# ---------------------------------------------------------------------------
# Affordability analysis by industry
# ---------------------------------------------------------------------------

def affordability_by_industry(
    industry_employment: dict[str, int],
    industry_wages: dict[str, float],
    median_annual_rent: float,
    median_home_price: float | None = None,
) -> list[dict[str, Any]]:
    """Detailed affordability analysis for every industry in the local economy.

    Parameters
    ----------
    industry_employment : dict[str, int]
        Jobs count by industry label (e.g. from LEHD WAC CNS fields).
    industry_wages : dict[str, float]
        Median annual wage by industry label.  Industries absent from this
        mapping are skipped.
    median_annual_rent : float
        Area median gross annual rent (monthly × 12).
    median_home_price : float | None
        Area median home value.  Used to compute ownership affordability.

    Returns
    -------
    List of dicts sorted by employment count descending:
        - sector                 : str
        - employment             : int
        - median_annual_wage     : float
        - rent_burden_pct        : float
        - can_afford_rent        : bool
        - income_gap_to_rent     : float  (negative = surplus)
        - can_afford_ownership   : bool | None
        - income_gap_to_own      : float | None
    """
    monthly_rent = median_annual_rent / 12.0
    results = []

    for sector, emp in industry_employment.items():
        wage = industry_wages.get(sector)
        if wage is None:
            continue

        gap_obj = WageAffordabilityGap(
            median_annual_wage=wage,
            median_annual_rent=median_annual_rent,
            median_home_price=median_home_price,
        )
        gap = gap_obj.compute()

        can_own = None
        own_gap = None
        if gap["income_needed_to_own"] is not None:
            can_own = wage >= gap["income_needed_to_own"]
            own_gap = round(gap["income_needed_to_own"] - wage, 2)

        results.append({
            "sector": sector,
            "employment": int(emp),
            "median_annual_wage": wage,
            "rent_burden_pct": gap["rent_burden_pct"],
            "can_afford_rent": gap["affordable"],
            "income_gap_to_rent": gap["gap_dollars"],
            "can_afford_ownership": can_own,
            "income_gap_to_own": own_gap,
        })

    results.sort(key=lambda x: x["employment"], reverse=True)
    return results


# ---------------------------------------------------------------------------
# Full PITI ownership affordability model
# ---------------------------------------------------------------------------

# Colorado county-level property tax rates (effective rate as decimal).
# Source: Colorado Division of Property Taxation annual report (approximate FY2024 rates).
# Review and update these annually when the Division publishes new certified levies:
#   https://cdola.colorado.gov/property-taxation
# Keys are 5-digit FIPS codes; fallback to CO_PROPERTY_TAX_DEFAULT if missing.
CO_PROPERTY_TAX_DEFAULT = 0.0065  # 0.65% statewide average

_COUNTY_TAX_RATES: dict[str, float] = {
    "08001": 0.0059,  # Adams
    "08005": 0.0055,  # Arapahoe
    "08013": 0.0047,  # Boulder
    "08014": 0.0052,  # Broomfield
    "08031": 0.0054,  # Denver
    "08035": 0.0052,  # Douglas
    "08041": 0.0063,  # El Paso
    "08059": 0.0048,  # Jefferson
    "08069": 0.0060,  # Larimer
    "08077": 0.0064,  # Mesa
    "08101": 0.0067,  # Pueblo
    "08123": 0.0058,  # Weld
}


def _monthly_pi(price: float, down_pct: float, annual_rate: float) -> float:
    """Compute monthly principal-and-interest payment for a 30-year fixed mortgage."""
    loan = price * (1.0 - down_pct)
    r = annual_rate / 12.0
    n = 360
    if r == 0:
        return loan / n
    return loan * (r * (1 + r) ** n) / ((1 + r) ** n - 1)


def _compute_scenario(
    median_price: float,
    down_pct: float,
    annual_rate: float,
    monthly_tax: float,
    monthly_insurance: float,
    monthly_hoa: float,
    max_dti: float,
) -> dict[str, Any]:
    pi = _monthly_pi(median_price, down_pct, annual_rate)
    pmi = (median_price * 0.0085 / 12.0) if down_pct < 0.20 else 0.0
    total_monthly = pi + monthly_tax + monthly_insurance + pmi + monthly_hoa
    required_annual = (total_monthly / max_dti) * 12.0
    return {
        "down_payment_pct": down_pct,
        "monthly_payment": round(total_monthly, 2),
        "breakdown": {
            "principal_interest": round(pi, 2),
            "property_taxes": round(monthly_tax, 2),
            "insurance": round(monthly_insurance, 2),
            "pmi": round(pmi, 2),
            "hoa": round(monthly_hoa, 2),
        },
        "required_annual_income": round(required_annual, 2),
    }


def compute_ownership_affordability(
    median_price: float,
    median_income: float,
    down_payment_pct: float = 0.20,
    interest_rate: float = 0.065,
    county_fips: str | None = None,
    insurance_rate: float = 0.0085,
    hoa_monthly: float = 0.0,
    max_dti_ratio: float = 0.43,
) -> dict[str, Any]:
    """Calculate realistic ownership affordability using full PITI underwriting.

    Parameters
    ----------
    median_price : float
        Median home sale price for the area.
    median_income : float
        Median household annual income.
    down_payment_pct : float
        Down payment as a fraction of purchase price (default 0.20 = 20%).
    interest_rate : float
        Annual mortgage interest rate as a decimal (default 0.065 = 6.5%).
    county_fips : str | None
        5-digit FIPS code used for county-specific property tax lookup.
        Falls back to Colorado statewide average when None or unknown.
    insurance_rate : float
        Annual homeowner insurance as a fraction of home value (default 0.85%).
    hoa_monthly : float
        Monthly HOA fee in dollars (default 0).
    max_dti_ratio : float
        Maximum total debt-to-income ratio for qualification (default 0.43).

    Returns
    -------
    dict with keys:
        monthly_payment            : float  (primary scenario total PITI + HOA)
        required_annual_income     : float  (income needed to qualify at max_dti)
        affordability_gap_percent  : float  (gap as % of median_income; negative = surplus)
        affordable                 : bool
        breakdown                  : dict   (PI, taxes, insurance, PMI, HOA)
        scenarios                  : dict   (standard_20pct_down, first_time_buyer_5pct_down)
        assumptions                : dict   (all input parameters used)
    """
    if median_price <= 0:
        raise ValueError("median_price must be positive")
    if median_income < 0:
        raise ValueError("median_income must be non-negative")

    tax_rate = _COUNTY_TAX_RATES.get(county_fips or "", CO_PROPERTY_TAX_DEFAULT)
    monthly_tax = (median_price * tax_rate) / 12.0
    monthly_insurance = (median_price * insurance_rate) / 12.0

    primary = _compute_scenario(
        median_price, down_payment_pct, interest_rate,
        monthly_tax, monthly_insurance, hoa_monthly, max_dti_ratio,
    )
    ftb = _compute_scenario(
        median_price, 0.05, interest_rate,
        monthly_tax, monthly_insurance, hoa_monthly, max_dti_ratio,
    )

    gap_pct = ((primary["required_annual_income"] - median_income) / median_income * 100.0
               if median_income > 0 else None)

    return {
        "monthly_payment": primary["monthly_payment"],
        "required_annual_income": primary["required_annual_income"],
        "affordability_gap_percent": round(gap_pct, 1) if gap_pct is not None else None,
        "affordable": median_income >= primary["required_annual_income"],
        "breakdown": primary["breakdown"],
        "scenarios": {
            "standard_20pct_down": primary,
            "first_time_buyer_5pct_down": ftb,
        },
        "assumptions": {
            "interest_rate": interest_rate,
            "down_payment_pct": down_payment_pct,
            "property_tax_rate": tax_rate,
            "insurance_rate": insurance_rate,
            "hoa_monthly": hoa_monthly,
            "max_dti_ratio": max_dti_ratio,
            "term_years": 30,
            "county_fips": county_fips,
        },
    }


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--compute-workforce-layer":
        _compute_layer_cli()
    else:
        print("Usage: economic_housing_bridge.py --compute-workforce-layer < records.json", file=sys.stderr)
        sys.exit(2)
