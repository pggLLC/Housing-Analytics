#!/usr/bin/env python3
"""Economic health indicator computations for Housing Needs Assessment.

Provides five indicator classes:
  - EmploymentGrowthIndicator  — YoY % growth and CAGR calculation
  - WageTrendIndicator         — real wage growth tracking and housing cost comparison
  - IndustryConcentration      — Herfindahl-Hirschman index calculation
  - JobAccessibility           — commute time and in-county employment ratio
  - UnemploymentContext        — unemployment rate and labor force participation

All classes accept plain dicts of numeric data and return structured result
dicts so they can be used independently of any web framework.

Usage
-----
    from scripts.hna.economic_indicators import (
        EmploymentGrowthIndicator,
        WageTrendIndicator,
        IndustryConcentration,
        JobAccessibility,
        UnemploymentContext,
    )

    indicator = EmploymentGrowthIndicator({"2019": 45000, "2023": 52000})
    result = indicator.compute()
    # result["cagr_pct"], result["yoy_series"], …
"""

from __future__ import annotations

import math
from typing import Any


# ---------------------------------------------------------------------------
# EmploymentGrowthIndicator
# ---------------------------------------------------------------------------

class EmploymentGrowthIndicator:
    """Compute year-over-year employment growth rates and CAGR.

    Parameters
    ----------
    annual_employment : dict[str | int, float | int]
        Mapping from year (string or int) to total employment count.
        Example: {"2019": 45000, "2020": 43000, "2021": 46500, "2022": 49000, "2023": 52000}
    """

    def __init__(self, annual_employment: dict) -> None:
        if not isinstance(annual_employment, dict):
            raise TypeError("annual_employment must be a dict mapping year -> count")
        self._data: dict[int, float] = {}
        for k, v in annual_employment.items():
            year = int(k)
            count = float(v)
            if count < 0:
                raise ValueError(f"Employment count must be non-negative; got {count} for year {year}")
            self._data[year] = count

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------

    @staticmethod
    def yoy_pct(prior: float, current: float) -> float | None:
        """Return YoY percentage change from *prior* to *current*.

        Returns None if *prior* is zero or either value is non-finite.
        """
        if not (math.isfinite(prior) and math.isfinite(current)):
            return None
        if prior == 0:
            return None
        return round((current - prior) / prior * 100.0, 2)

    @staticmethod
    def cagr(start_value: float, end_value: float, years: int) -> float | None:
        """Compound annual growth rate (CAGR) as a percentage.

        Returns None if inputs are invalid (non-positive values or years ≤ 0).
        """
        if years <= 0 or start_value <= 0 or end_value <= 0:
            return None
        if not (math.isfinite(start_value) and math.isfinite(end_value)):
            return None
        return round(((end_value / start_value) ** (1.0 / years) - 1.0) * 100.0, 4)

    # ------------------------------------------------------------------
    # Main compute
    # ------------------------------------------------------------------

    def compute(self) -> dict[str, Any]:
        """Return a results dict with:
        - sorted_years      : list[int]
        - sorted_counts     : list[float]
        - yoy_series        : list[{year, pct}] for consecutive pairs
        - cagr_pct          : float | None  (first → last year)
        - total_change_pct  : float | None  (simple first → last %)
        - peak_year         : int | None
        - trough_year       : int | None
        """
        if not self._data:
            return {
                "sorted_years": [],
                "sorted_counts": [],
                "yoy_series": [],
                "cagr_pct": None,
                "total_change_pct": None,
                "peak_year": None,
                "trough_year": None,
            }

        years = sorted(self._data)
        counts = [self._data[y] for y in years]

        yoy_series = []
        for i in range(1, len(years)):
            pct = self.yoy_pct(counts[i - 1], counts[i])
            yoy_series.append({"year": years[i], "pct": pct})

        span = years[-1] - years[0]
        cagr_pct = self.cagr(counts[0], counts[-1], span) if span > 0 else None
        total_change_pct = self.yoy_pct(counts[0], counts[-1])

        peak_year = years[counts.index(max(counts))]
        trough_year = years[counts.index(min(counts))]

        return {
            "sorted_years": years,
            "sorted_counts": counts,
            "yoy_series": yoy_series,
            "cagr_pct": cagr_pct,
            "total_change_pct": total_change_pct,
            "peak_year": peak_year,
            "trough_year": trough_year,
        }


# ---------------------------------------------------------------------------
# WageTrendIndicator
# ---------------------------------------------------------------------------

class WageTrendIndicator:
    """Track real wage growth and compare against housing costs.

    Parameters
    ----------
    annual_wages : dict[str | int, float]
        Nominal median annual wage by year (e.g. {2019: 42000, 2023: 48000}).
    annual_housing_costs : dict[str | int, float] | None
        Annual median gross rent (annualised) or housing cost by year.
        If provided, affordability gap is computed.
    cpi_deflators : dict[str | int, float] | None
        CPI index values by year (base year = 100).  When provided wages are
        deflated to the *base_year* before computing real growth.
    base_year : int | None
        Reference year for real-wage deflation.  Defaults to the earliest year
        in annual_wages.
    """

    def __init__(
        self,
        annual_wages: dict,
        annual_housing_costs: dict | None = None,
        cpi_deflators: dict | None = None,
        base_year: int | None = None,
    ) -> None:
        self._wages: dict[int, float] = {int(k): float(v) for k, v in annual_wages.items()}
        self._housing: dict[int, float] = (
            {int(k): float(v) for k, v in annual_housing_costs.items()}
            if annual_housing_costs else {}
        )
        self._cpi: dict[int, float] = (
            {int(k): float(v) for k, v in cpi_deflators.items()}
            if cpi_deflators else {}
        )
        years = sorted(self._wages)
        self._base_year: int = base_year if base_year is not None else (years[0] if years else None)

    def _real_wage(self, year: int, nominal: float) -> float:
        """Deflate *nominal* wage to base-year dollars using CPI."""
        if not self._cpi or self._base_year is None:
            return nominal
        base_cpi = self._cpi.get(self._base_year)
        year_cpi = self._cpi.get(year)
        if base_cpi and year_cpi and year_cpi > 0:
            return nominal * (base_cpi / year_cpi)
        return nominal

    def compute(self) -> dict[str, Any]:
        """Return:
        - sorted_years          : list[int]
        - nominal_wages         : list[float]
        - real_wages            : list[float]  (deflated; same as nominal if no CPI)
        - real_wage_cagr_pct    : float | None
        - housing_cost_series   : list[float | None]
        - affordability_ratio   : list[float | None]  (wage / annual_housing_cost)
        - housing_cost_cagr_pct : float | None
        - wage_gap_latest       : float | None  (wage minus housing cost, most recent year)
        """
        if not self._wages:
            return {
                "sorted_years": [],
                "nominal_wages": [],
                "real_wages": [],
                "real_wage_cagr_pct": None,
                "housing_cost_series": [],
                "affordability_ratio": [],
                "housing_cost_cagr_pct": None,
                "wage_gap_latest": None,
            }

        years = sorted(self._wages)
        nominal = [self._wages[y] for y in years]
        real = [self._real_wage(y, self._wages[y]) for y in years]

        span = years[-1] - years[0]
        real_cagr = None
        if span > 0 and real[0] > 0 and real[-1] > 0:
            real_cagr = round(((real[-1] / real[0]) ** (1.0 / span) - 1.0) * 100.0, 4)

        housing = [self._housing.get(y) for y in years]
        afford_ratio = []
        for w, h in zip(real, housing):
            if h and h > 0:
                afford_ratio.append(round(w / h, 4))
            else:
                afford_ratio.append(None)

        housing_cagr = None
        h_values = [v for v in housing if v is not None]
        h_years = [y for y, v in zip(years, housing) if v is not None]
        if len(h_values) >= 2:
            span_h = h_years[-1] - h_years[0]
            if span_h > 0 and h_values[0] > 0 and h_values[-1] > 0:
                housing_cagr = round(((h_values[-1] / h_values[0]) ** (1.0 / span_h) - 1.0) * 100.0, 4)

        latest_wage = real[-1]
        latest_housing = self._housing.get(years[-1])
        wage_gap = round(latest_wage - latest_housing, 2) if latest_housing is not None else None

        return {
            "sorted_years": years,
            "nominal_wages": nominal,
            "real_wages": real,
            "real_wage_cagr_pct": real_cagr,
            "housing_cost_series": housing,
            "affordability_ratio": afford_ratio,
            "housing_cost_cagr_pct": housing_cagr,
            "wage_gap_latest": wage_gap,
        }


# ---------------------------------------------------------------------------
# IndustryConcentration
# ---------------------------------------------------------------------------

class IndustryConcentration:
    """Compute industry concentration metrics including the Herfindahl-Hirschman Index.

    Parameters
    ----------
    industry_employment : dict[str, float | int]
        Mapping from industry label or NAICS code to employment count.
        Example: {"CNS01": 1200, "CNS07": 8500, "CNS12": 3200, …}
    """

    def __init__(self, industry_employment: dict) -> None:
        if not isinstance(industry_employment, dict):
            raise TypeError("industry_employment must be a dict")
        self._data: dict[str, float] = {}
        for k, v in industry_employment.items():
            val = float(v)
            if val < 0:
                raise ValueError(f"Employment count must be non-negative; got {val} for '{k}'")
            self._data[str(k)] = val

    @staticmethod
    def herfindahl_index(shares: list[float]) -> float:
        """Compute the Herfindahl-Hirschman Index from market-share fractions.

        *shares* should be fractions in [0, 1] that sum to 1.
        Returns HHI in [0, 10_000] using percentage-point convention (each
        share × 100 squared then summed), consistent with DOJ/FTC usage.
        """
        return round(sum((s * 100) ** 2 for s in shares), 4)

    def compute(self) -> dict[str, Any]:
        """Return:
        - total_employment     : float
        - industries           : list[{label, count, share_pct}] sorted desc
        - hhi                  : float  (0 = max diversity, 10_000 = monopoly)
        - hhi_interpretation   : str    ('competitive'|'moderately_concentrated'|'highly_concentrated')
        - top3_share_pct       : float  (combined share of top 3 industries)
        - dominant_industry    : str | None
        """
        total = sum(self._data.values())
        if total == 0:
            return {
                "total_employment": 0.0,
                "industries": [],
                "hhi": 0.0,
                "hhi_interpretation": "competitive",
                "top3_share_pct": 0.0,
                "dominant_industry": None,
            }

        industries = []
        for label, count in self._data.items():
            share = count / total
            industries.append({
                "label": label,
                "count": count,
                "share_pct": round(share * 100, 2),
            })
        industries.sort(key=lambda x: x["count"], reverse=True)

        shares = [ind["count"] / total for ind in industries]
        hhi = self.herfindahl_index(shares)

        # DOJ/FTC interpretation thresholds (percentage-point squared scale)
        if hhi < 1500:
            interpretation = "competitive"
        elif hhi < 2500:
            interpretation = "moderately_concentrated"
        else:
            interpretation = "highly_concentrated"

        top3_share = sum(ind["share_pct"] for ind in industries[:3])
        dominant = industries[0]["label"] if industries else None

        return {
            "total_employment": total,
            "industries": industries,
            "hhi": hhi,
            "hhi_interpretation": interpretation,
            "top3_share_pct": round(top3_share, 2),
            "dominant_industry": dominant,
        }


# ---------------------------------------------------------------------------
# JobAccessibility
# ---------------------------------------------------------------------------

class JobAccessibility:
    """Measure local job accessibility via commute time and in-county employment.

    Parameters
    ----------
    total_jobs : float | int
        Total jobs located in the area (LEHD WAC C000).
    resident_workers : float | int
        Residents in the labour force (approximately employed + unemployed
        who live in the area).
    within_county : float | int
        Jobs held by residents AND located within the county (LEHD OD "S000").
    avg_commute_minutes : float | None
        Average one-way commute time in minutes (ACS S0801).  Optional.
    """

    def __init__(
        self,
        total_jobs: float,
        resident_workers: float,
        within_county: float,
        avg_commute_minutes: float | None = None,
    ) -> None:
        if total_jobs < 0:
            raise ValueError("total_jobs must be non-negative")
        if resident_workers < 0:
            raise ValueError("resident_workers must be non-negative")
        if within_county < 0:
            raise ValueError("within_county must be non-negative")
        self._total_jobs = float(total_jobs)
        self._workers = float(resident_workers)
        self._within = float(within_county)
        self._commute = float(avg_commute_minutes) if avg_commute_minutes is not None else None

    def compute(self) -> dict[str, Any]:
        """Return:
        - jobs_to_workers_ratio    : float | None
        - in_county_employment_pct : float | None  (workers employed locally %)
        - avg_commute_minutes      : float | None
        - commute_tier             : str  ('short'|'moderate'|'long'|'unknown')
        - self_sufficiency_score   : float  (0–1, higher = more locally self-sufficient)
        """
        j2w = None
        if self._workers > 0:
            j2w = round(self._total_jobs / self._workers, 4)

        in_county_pct = None
        if self._workers > 0:
            in_county_pct = round(min(self._within / self._workers, 1.0) * 100.0, 2)

        if self._commute is None:
            commute_tier = "unknown"
        elif self._commute < 20:
            commute_tier = "short"
        elif self._commute < 35:
            commute_tier = "moderate"
        else:
            commute_tier = "long"

        # Self-sufficiency: weighted combo of in-county employment and J:W ratio
        score = 0.0
        if in_county_pct is not None:
            score += min(in_county_pct / 100.0, 1.0) * 0.6
        if j2w is not None:
            score += min(j2w, 1.0) * 0.4
        score = round(score, 4)

        return {
            "jobs_to_workers_ratio": j2w,
            "in_county_employment_pct": in_county_pct,
            "avg_commute_minutes": self._commute,
            "commute_tier": commute_tier,
            "self_sufficiency_score": score,
        }


# ---------------------------------------------------------------------------
# UnemploymentContext
# ---------------------------------------------------------------------------

class UnemploymentContext:
    """Provide unemployment rate and labour force participation context.

    Parameters
    ----------
    labor_force : float | int
        Total civilian labour force (employed + unemployed).
    employed : float | int
        Number of employed persons.
    civilian_population : float | int | None
        Civilian non-institutionalised population 16+.  Required to compute
        the labour force participation rate (LFPR).
    state_unemployment_rate : float | None
        State-level unemployment rate for comparison (e.g. 4.2).
    national_unemployment_rate : float | None
        National unemployment rate for comparison (e.g. 3.9).
    """

    def __init__(
        self,
        labor_force: float,
        employed: float,
        civilian_population: float | None = None,
        state_unemployment_rate: float | None = None,
        national_unemployment_rate: float | None = None,
    ) -> None:
        if labor_force < 0:
            raise ValueError("labor_force must be non-negative")
        if employed < 0:
            raise ValueError("employed must be non-negative")
        if employed > labor_force:
            raise ValueError("employed cannot exceed labor_force")
        self._lf = float(labor_force)
        self._emp = float(employed)
        self._pop = float(civilian_population) if civilian_population is not None else None
        self._state_ur = float(state_unemployment_rate) if state_unemployment_rate is not None else None
        self._nat_ur = float(national_unemployment_rate) if national_unemployment_rate is not None else None

    def compute(self) -> dict[str, Any]:
        """Return:
        - unemployment_rate      : float | None  (%)
        - labor_force_count      : float
        - employed_count         : float
        - unemployed_count       : float
        - lfpr_pct               : float | None  (labour force participation rate %)
        - vs_state_ppt           : float | None  (local UR minus state UR in pp)
        - vs_national_ppt        : float | None  (local UR minus national UR in pp)
        - context_label          : str  ('above_average'|'average'|'below_average'|'unknown')
        """
        unemployed = self._lf - self._emp
        ur = None
        if self._lf > 0:
            ur = round((unemployed / self._lf) * 100.0, 2)

        lfpr = None
        if self._pop and self._pop > 0:
            lfpr = round((self._lf / self._pop) * 100.0, 2)

        vs_state = None
        if ur is not None and self._state_ur is not None:
            vs_state = round(ur - self._state_ur, 2)

        vs_national = None
        if ur is not None and self._nat_ur is not None:
            vs_national = round(ur - self._nat_ur, 2)

        # Derive context label using state or national comparison
        ref_diff = vs_state if vs_state is not None else vs_national
        if ref_diff is None:
            context_label = "unknown"
        elif ref_diff > 1.0:
            context_label = "above_average"
        elif ref_diff < -1.0:
            context_label = "below_average"
        else:
            context_label = "average"

        return {
            "unemployment_rate": ur,
            "labor_force_count": self._lf,
            "employed_count": self._emp,
            "unemployed_count": unemployed,
            "lfpr_pct": lfpr,
            "vs_state_ppt": vs_state,
            "vs_national_ppt": vs_national,
            "context_label": context_label,
        }
