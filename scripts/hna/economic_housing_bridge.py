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

import math
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

# Rule-of-thumb maximum rent-affordable to each tier at 30% of gross
# (annual wage × 0.30 / 12 = max monthly rent)
def _max_monthly_rent(annual_wage: float) -> float:
    return annual_wage * AFFORDABILITY_THRESHOLD_PCT / 12.0


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
