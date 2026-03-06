#!/usr/bin/env python3
"""Household projection model using headship rates.

Converts population projections (from CohortComponentModel) into
household counts using age-specific headship rates, with optional
group-quarters accounting.

Classes
-------
HeadshipRateModel
    Applies headship rates by age group to projected population to estimate
    the number of households.

Usage
-----
    from scripts.hna.demographic_projections import CohortComponentModel
    from scripts.hna.household_projections import HeadshipRateModel

    pop_model  = CohortComponentModel(base_population, scenario="baseline")
    snapshots  = pop_model.project(years=10)

    hh_model   = HeadshipRateModel(base_households=15000)
    hh_series  = hh_model.project_from_snapshots(snapshots)
"""

from __future__ import annotations

from typing import Any

from scripts.hna.demographic_projections import AGE_GROUPS, N_COHORTS

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Default headship rates by age group (fraction of persons who are householders).
# Based on approximate US ACS 2019-2023 5-year estimates.
DEFAULT_HEADSHIP_RATES: dict[str, float] = {
    "0-4":   0.000,
    "5-9":   0.000,
    "10-14": 0.000,
    "15-19": 0.030,
    "20-24": 0.200,
    "25-29": 0.420,
    "30-34": 0.510,
    "35-39": 0.530,
    "40-44": 0.535,
    "45-49": 0.540,
    "50-54": 0.540,
    "55-59": 0.545,
    "60-64": 0.545,
    "65-69": 0.520,
    "70-74": 0.490,
    "75-79": 0.420,
    "80-84": 0.310,
    "85+":   0.160,
}

# Fraction of population in group quarters by age (not forming private households).
DEFAULT_GQ_RATES: dict[str, float] = {
    "0-4":   0.001,
    "5-9":   0.001,
    "10-14": 0.003,
    "15-19": 0.060,  # college dorms, military, juvenile facilities
    "20-24": 0.055,
    "25-29": 0.015,
    "30-34": 0.008,
    "35-39": 0.006,
    "40-44": 0.006,
    "45-49": 0.007,
    "50-54": 0.008,
    "55-59": 0.009,
    "60-64": 0.012,
    "65-69": 0.018,
    "70-74": 0.030,
    "75-79": 0.060,
    "80-84": 0.120,
    "85+":   0.200,
}


# ---------------------------------------------------------------------------
# HeadshipRateModel
# ---------------------------------------------------------------------------

class HeadshipRateModel:
    """Estimate household counts from population projections.

    Parameters
    ----------
    base_households:
        Observed household count in the base year (used to calibrate the
        headship rate scale so results align with observed data).
    headship_rates:
        Optional dict mapping age group label → headship rate.  Defaults
        to ``DEFAULT_HEADSHIP_RATES``.
    gq_rates:
        Optional dict mapping age group label → group-quarters rate.
        Defaults to ``DEFAULT_GQ_RATES``.
    headship_trend_per_year:
        Annual drift applied to all headship rates (positive = rates rise,
        negative = rates fall).  Typical recent trend is slightly negative
        (household formation rates declining).
    account_for_gq:
        If ``True``, remove group-quarters population before applying
        headship rates (more accurate but requires GQ assumptions).
    """

    def __init__(
        self,
        base_households: float,
        headship_rates: dict[str, float] | None = None,
        gq_rates: dict[str, float] | None = None,
        headship_trend_per_year: float = 0.0,
        account_for_gq: bool = True,
    ) -> None:
        self.base_households = float(base_households)
        self.headship_rates  = headship_rates or dict(DEFAULT_HEADSHIP_RATES)
        self.gq_rates        = gq_rates or dict(DEFAULT_GQ_RATES)
        self.headship_trend_per_year = float(headship_trend_per_year)
        self.account_for_gq  = account_for_gq

        # Validate age group coverage
        for ag in AGE_GROUPS:
            if ag not in self.headship_rates:
                raise ValueError(f"Missing headship rate for age group '{ag}'")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def project_from_snapshots(
        self,
        snapshots: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Convert a list of CohortComponentModel snapshots to household projections.

        Returns a list of dicts, one per year::

            {
                "year_offset":      int,
                "households":       float,
                "gq_population":    float,
                "household_pop":    float,
            }
        """
        results: list[dict[str, Any]] = []

        # Compute calibration scalar from base year (year_offset == 0)
        base_snap = next((s for s in snapshots if s["year_offset"] == 0), None)
        if base_snap is None:
            raise ValueError("snapshots must contain a base year entry with year_offset=0")

        base_estimated_hh = self._compute_households(base_snap, year_offset=0)
        if base_estimated_hh > 0:
            calibration = self.base_households / base_estimated_hh
        else:
            calibration = 1.0

        for snap in snapshots:
            yr = snap["year_offset"]
            raw_hh  = self._compute_households(snap, year_offset=yr)
            cal_hh  = raw_hh * calibration
            gq_pop  = self._compute_gq_population(snap)
            hh_pop  = snap["total_population"] - gq_pop

            results.append({
                "year_offset":   yr,
                "households":    round(cal_hh, 1),
                "gq_population": round(gq_pop, 1),
                "household_pop": round(max(0.0, hh_pop), 1),
            })

        return results

    def headship_rate_at(self, age_group: str, year_offset: int) -> float:
        """Return headship rate for a given age group adjusted for trend drift."""
        base_rate = self.headship_rates.get(age_group, 0.0)
        adjusted  = base_rate + self.headship_trend_per_year * year_offset
        return max(0.0, min(1.0, adjusted))

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _compute_households(
        self,
        snapshot: dict[str, Any],
        year_offset: int,
    ) -> float:
        """Estimate households for a single snapshot."""
        male   = snapshot.get("male",   [0.0] * N_COHORTS)
        female = snapshot.get("female", [0.0] * N_COHORTS)
        total_hh = 0.0

        for i, ag in enumerate(AGE_GROUPS):
            pop_i = male[i] + female[i]

            if self.account_for_gq:
                gq_rate = self.gq_rates.get(ag, 0.0)
                hh_pop_i = pop_i * (1.0 - gq_rate)
            else:
                hh_pop_i = pop_i

            hr = self.headship_rate_at(ag, year_offset)
            total_hh += hh_pop_i * hr

        return total_hh

    def _compute_gq_population(self, snapshot: dict[str, Any]) -> float:
        """Compute total group-quarters population for a snapshot."""
        if not self.account_for_gq:
            return 0.0
        male   = snapshot.get("male",   [0.0] * N_COHORTS)
        female = snapshot.get("female", [0.0] * N_COHORTS)
        gq = 0.0
        for i, ag in enumerate(AGE_GROUPS):
            gq += (male[i] + female[i]) * self.gq_rates.get(ag, 0.0)
        return gq
