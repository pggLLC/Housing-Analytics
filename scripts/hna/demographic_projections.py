#!/usr/bin/env python3
"""Cohort-component demographic projection model.

Implements a simplified cohort-component model for forward-projecting
population by age/sex cohort over 5–10 year horizons.

Classes
-------
CohortComponentModel
    Applies annual survival rates, age-in cohorts by one year each step,
    adds births (fertility × female cohorts), and applies net migration
    by age/sex per year.

Usage
-----
    from scripts.hna.demographic_projections import CohortComponentModel

    model = CohortComponentModel(base_population, scenario="baseline")
    results = model.project(years=10)
"""

from __future__ import annotations

import json
import os
from typing import Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_SCENARIOS_PATH = os.path.join(os.path.dirname(__file__), "projection_scenarios.json")

# Standard 5-year age groups used throughout (0-4, 5-9, … 80-84, 85+)
AGE_GROUPS = [
    "0-4", "5-9", "10-14", "15-19", "20-24", "25-29",
    "30-34", "35-39", "40-44", "45-49", "50-54", "55-59",
    "60-64", "65-69", "70-74", "75-79", "80-84", "85+",
]
N_COHORTS = len(AGE_GROUPS)  # 18

# Default survival rates by age group (approximate US life-table derived values).
# Index 0 = age 0-4, index 17 = age 85+.  These are 5-year survival rates.
DEFAULT_SURVIVAL = [
    0.9985, 0.9990, 0.9989, 0.9985, 0.9978,  # 0-4 … 20-24
    0.9975, 0.9970, 0.9963, 0.9950, 0.9930,  # 25-29 … 45-49
    0.9900, 0.9860, 0.9800, 0.9700, 0.9550,  # 50-54 … 70-74
    0.9300, 0.8900, 0.7500,                   # 75-79, 80-84, 85+
]

# Female cohort indices that contribute to births (age groups 15-19 through 45-49 → indices 3-9)
FERTILE_START = 3  # 15-19
FERTILE_END   = 9  # 45-49 (inclusive)

# Age-specific fertility rates per woman (births per 5-year period, approximate US averages)
DEFAULT_ASFRs = {
    "15-19": 0.040,
    "20-24": 0.160,
    "25-29": 0.280,
    "30-34": 0.280,
    "35-39": 0.160,
    "40-44": 0.055,
    "45-49": 0.008,
}

SEX_RATIO_AT_BIRTH = 1.05  # males per female


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_scenarios() -> dict[str, Any]:
    """Load projection scenario definitions from JSON file."""
    with open(_SCENARIOS_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _build_empty_cohorts() -> dict[str, list[float]]:
    """Return a zero-filled cohort dict with 'male' and 'female' keys."""
    return {"male": [0.0] * N_COHORTS, "female": [0.0] * N_COHORTS}


# ---------------------------------------------------------------------------
# CohortComponentModel
# ---------------------------------------------------------------------------

class CohortComponentModel:
    """Cohort-component population projection model.

    Parameters
    ----------
    base_population:
        dict with keys ``"male"`` and ``"female"``, each a list of 18 floats
        representing counts by 5-year age group (0-4 through 85+).
    scenario:
        Name of the scenario to load from ``projection_scenarios.json``.
        Supported values: ``"baseline"``, ``"low_growth"``, ``"high_growth"``.
        Pass ``None`` to use neutral defaults.
    scenario_overrides:
        Optional dict to override individual scenario parameters such as
        ``"fertility_multiplier"``, ``"net_migration_annual"``,
        ``"mortality_multiplier"``.
    """

    def __init__(
        self,
        base_population: dict[str, list[float]],
        scenario: str | None = "baseline",
        scenario_overrides: dict[str, Any] | None = None,
    ) -> None:
        if "male" not in base_population or "female" not in base_population:
            raise ValueError("base_population must have 'male' and 'female' keys")
        if len(base_population["male"]) != N_COHORTS or len(base_population["female"]) != N_COHORTS:
            raise ValueError(f"Each sex cohort list must have {N_COHORTS} elements")

        self.base_population = {
            "male":   list(map(float, base_population["male"])),
            "female": list(map(float, base_population["female"])),
        }

        # Load scenario parameters
        params: dict[str, Any] = {}
        if scenario is not None:
            try:
                scenarios = _load_scenarios()
                params = scenarios.get(scenario, {}).get("parameters", {})
            except (OSError, json.JSONDecodeError):
                pass  # fall back to defaults silently

        if scenario_overrides:
            params.update(scenario_overrides)

        self.fertility_multiplier: float = float(params.get("fertility_multiplier", 1.0))
        self.mortality_multiplier: float = float(params.get("mortality_multiplier", 1.0))
        # Net migration as a dict: {age_group: annual_net_count} or a single scalar
        raw_mig = params.get("net_migration_annual", 0)
        if isinstance(raw_mig, (int, float)):
            self.net_migration_annual: dict[str, float] = self._distribute_migration(float(raw_mig))
        else:
            self.net_migration_annual = {k: float(v) for k, v in raw_mig.items()}

        # Survival rates (apply mortality multiplier — higher multiplier → lower survival,
        # lower multiplier → higher survival).
        # Formula: adjusted_survival = base_survival * (2.0 - multiplier)
        # Examples:
        #   multiplier=1.0  → survival unchanged (×1.0)
        #   multiplier=1.5  → survival halved (×0.5)  — much higher mortality
        #   multiplier=0.98 → survival slightly increased (×1.02) — mortality improvement
        self.survival_male   = [
            max(0.0, min(1.0, s * (2.0 - self.mortality_multiplier)))
            for s in DEFAULT_SURVIVAL
        ]
        self.survival_female = [
            max(0.0, min(1.0, s * (2.0 - self.mortality_multiplier)))
            for s in DEFAULT_SURVIVAL
        ]

        # Age-specific fertility rates (per 5-year period) × multiplier
        self.asfr: list[float] = [
            DEFAULT_ASFRs.get(ag, 0.0) * self.fertility_multiplier
            for ag in AGE_GROUPS
        ]

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def project(self, years: int = 10) -> list[dict[str, Any]]:
        """Run the cohort-component projection for *years* years.

        Returns a list of annual snapshots, starting with year 0 (the base).

        Each snapshot is::

            {
                "year_offset": 0,          # 0 = base year
                "male":   [float, ...],    # 18 cohort counts
                "female": [float, ...],
                "total_population": float,
            }
        """
        snapshots: list[dict[str, Any]] = []
        male   = list(self.base_population["male"])
        female = list(self.base_population["female"])

        snapshots.append(self._snapshot(0, male, female))

        for yr in range(1, years + 1):
            male, female = self._step(male, female)
            snapshots.append(self._snapshot(yr, male, female))

        return snapshots

    def total_population(self, snapshots: list[dict[str, Any]]) -> list[float]:
        """Extract total population series from project() output."""
        return [s["total_population"] for s in snapshots]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _step(
        self, male: list[float], female: list[float]
    ) -> tuple[list[float], list[float]]:
        """Advance cohorts by one year using aging, mortality, births, migration."""
        # --- Age-in (shift cohorts forward one year; last cohort accumulates) ---
        new_male   = self._age_in(male,   self.survival_male)
        new_female = self._age_in(female, self.survival_female)

        # --- Births ---
        births = self._compute_births(female)
        male_births   = births * SEX_RATIO_AT_BIRTH / (1.0 + SEX_RATIO_AT_BIRTH)
        female_births = births / (1.0 + SEX_RATIO_AT_BIRTH)
        new_male[0]   += male_births
        new_female[0] += female_births

        # --- Net migration (applied to each age group, split evenly by sex) ---
        for i, ag in enumerate(AGE_GROUPS):
            net = self.net_migration_annual.get(ag, 0.0) / 2.0
            new_male[i]   = max(0.0, new_male[i]   + net)
            new_female[i] = max(0.0, new_female[i] + net)

        return new_male, new_female

    @staticmethod
    def _age_in(cohort: list[float], survival: list[float]) -> list[float]:
        """Apply survival and shift cohorts forward by one (annual) step.

        Because the model tracks 5-year groups, each group gains one year of
        age.  After 5 annual steps the first member of cohort *i* will have
        fully aged into cohort *i+1*.  We approximate this by shifting 1/5 of
        each cohort per year.
        """
        n = len(cohort)
        new = [0.0] * n
        for i in range(n):
            # Fraction remaining in the same cohort after one year
            stay_frac  = 4.0 / 5.0
            # Fraction aging into the next cohort
            age_frac   = 1.0 / 5.0
            survived = cohort[i] * survival[i]
            stay  = survived * stay_frac
            aging = survived * age_frac
            new[i] += stay
            if i + 1 < n:
                new[i + 1] += aging
            else:
                new[i] += aging  # oldest cohort stays in place

        return new

    def _compute_births(self, female: list[float]) -> float:
        """Compute total births from female cohort counts × ASFR."""
        births = 0.0
        for i in range(FERTILE_START, FERTILE_END + 1):
            if i < N_COHORTS:
                births += female[i] * self.asfr[i]
        return max(0.0, births)

    @staticmethod
    def _distribute_migration(total: float) -> dict[str, float]:
        """Distribute total net migration across age groups using a typical pattern."""
        # Migration weights (working-age and young adults over-represented)
        weights = [
            0.05, 0.04, 0.04, 0.06, 0.10,  # 0-4 … 20-24
            0.12, 0.11, 0.10, 0.09, 0.08,  # 25-29 … 45-49
            0.07, 0.05, 0.04, 0.03, 0.02,  # 50-54 … 70-74
            0.03, 0.02, 0.01,               # 75-79, 80-84, 85+
        ]
        total_w = sum(weights)
        return {
            ag: total * weights[i] / total_w
            for i, ag in enumerate(AGE_GROUPS)
        }

    @staticmethod
    def _snapshot(
        year_offset: int, male: list[float], female: list[float]
    ) -> dict[str, Any]:
        total = sum(male) + sum(female)
        return {
            "year_offset":        year_offset,
            "male":               list(male),
            "female":             list(female),
            "total_population":   round(total, 2),
        }
