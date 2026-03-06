#!/usr/bin/env python3
"""Housing demand projections — links household projections to affordability analysis.

Converts a household projection series into housing demand by:
  1. Splitting households into owner vs. renter using a tenure split.
  2. Distributing each tenure into affordability tiers (AMI bands).
  3. Computing incremental unit demand over the projection horizon.

Classes
-------
HousingDemandProjector
    Connects HeadshipRateModel output to affordability need estimates.

Usage
-----
    from scripts.hna.demographic_projections import CohortComponentModel
    from scripts.hna.household_projections   import HeadshipRateModel
    from scripts.hna.housing_demand_projections import HousingDemandProjector

    pop_snapshots = CohortComponentModel(base_pop, scenario="baseline").project(10)
    hh_series     = HeadshipRateModel(base_households=15000).project_from_snapshots(pop_snapshots)

    projector     = HousingDemandProjector(
        base_year_units=16000,
        tenure_split={"owner": 0.65, "renter": 0.35},
    )
    demand = projector.project(hh_series)
"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Typical affordability tier distributions for owner and renter households.
# Keys are AMI-band labels; values are fraction of households in that band.
DEFAULT_OWNER_AMI_DISTRIBUTION: dict[str, float] = {
    "30_ami":  0.04,
    "50_ami":  0.08,
    "80_ami":  0.16,
    "100_ami": 0.18,
    "120_ami": 0.22,
    "above_120_ami": 0.32,
}

DEFAULT_RENTER_AMI_DISTRIBUTION: dict[str, float] = {
    "30_ami":  0.20,
    "50_ami":  0.22,
    "80_ami":  0.26,
    "100_ami": 0.14,
    "120_ami": 0.10,
    "above_120_ami": 0.08,
}

AMI_TIERS = ["30_ami", "50_ami", "80_ami", "100_ami", "120_ami", "above_120_ami"]

DEFAULT_TARGET_VACANCY = 0.05  # 5%


# ---------------------------------------------------------------------------
# HousingDemandProjector
# ---------------------------------------------------------------------------

class HousingDemandProjector:
    """Project housing demand from household formation estimates.

    Parameters
    ----------
    base_year_units:
        Total occupied + vacant housing units in the base year.
    tenure_split:
        Dict with ``"owner"`` and ``"renter"`` fractions (must sum to 1.0).
    target_vacancy:
        Target vacancy rate (decimal).  Used to convert households to required units.
    owner_ami_distribution:
        Fraction of owner households in each AMI tier.
    renter_ami_distribution:
        Fraction of renter households in each AMI tier.
    """

    def __init__(
        self,
        base_year_units: float,
        tenure_split: dict[str, float] | None = None,
        target_vacancy: float = DEFAULT_TARGET_VACANCY,
        owner_ami_distribution: dict[str, float] | None = None,
        renter_ami_distribution: dict[str, float] | None = None,
    ) -> None:
        self.base_year_units   = float(base_year_units)
        self.target_vacancy    = float(target_vacancy)

        ts = tenure_split or {"owner": 0.65, "renter": 0.35}
        if abs(ts.get("owner", 0) + ts.get("renter", 0) - 1.0) > 0.01:
            raise ValueError("tenure_split 'owner' + 'renter' fractions must sum to 1.0")
        self.owner_frac  = float(ts["owner"])
        self.renter_frac = float(ts["renter"])

        self.owner_ami  = owner_ami_distribution  or dict(DEFAULT_OWNER_AMI_DISTRIBUTION)
        self.renter_ami = renter_ami_distribution or dict(DEFAULT_RENTER_AMI_DISTRIBUTION)

        # Validate distributions sum to ~1
        for name, dist in [("owner", self.owner_ami), ("renter", self.renter_ami)]:
            total = sum(dist.values())
            if abs(total - 1.0) > 0.02:
                raise ValueError(
                    f"{name} AMI distribution sums to {total:.3f}, expected 1.0 ± 0.02"
                )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def project(
        self,
        hh_series: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Generate housing demand projections from a household series.

        Parameters
        ----------
        hh_series:
            Output of ``HeadshipRateModel.project_from_snapshots()`` — a list
            of dicts with at least ``"year_offset"`` and ``"households"`` keys.

        Returns
        -------
        list[dict]
            One dict per year with structure::

                {
                    "year_offset":        int,
                    "total_households":   float,
                    "units_required":     float,
                    "incremental_units":  float,   # vs base year
                    "owner_households":   float,
                    "renter_households":  float,
                    "demand_by_ami":      {
                        "owner":  {tier: float, ...},
                        "renter": {tier: float, ...},
                    },
                }
        """
        results: list[dict[str, Any]] = []
        base_units = self.base_year_units

        for entry in hh_series:
            yr  = entry["year_offset"]
            hh  = float(entry.get("households", 0))

            units_required  = hh / (1.0 - self.target_vacancy) if self.target_vacancy < 1.0 else hh
            incremental     = units_required - base_units

            owner_hh  = hh * self.owner_frac
            renter_hh = hh * self.renter_frac

            demand_by_ami = {
                "owner":  {t: round(owner_hh  * self.owner_ami.get(t,  0), 1) for t in AMI_TIERS},
                "renter": {t: round(renter_hh * self.renter_ami.get(t, 0), 1) for t in AMI_TIERS},
            }

            results.append({
                "year_offset":       yr,
                "total_households":  round(hh, 1),
                "units_required":    round(units_required, 1),
                "incremental_units": round(incremental, 1),
                "owner_households":  round(owner_hh, 1),
                "renter_households": round(renter_hh, 1),
                "demand_by_ami":     demand_by_ami,
            })

        return results

    def summarize(self, demand_series: list[dict[str, Any]]) -> dict[str, Any]:
        """Return a summary dict for the full projection horizon."""
        if not demand_series:
            return {}
        first = demand_series[0]
        last  = demand_series[-1]

        total_new_units = last["incremental_units"] - first["incremental_units"]
        owner_new  = last["owner_households"]  - first["owner_households"]
        renter_new = last["renter_households"] - first["renter_households"]

        # AMI tier breakdown of incremental demand
        ami_incremental: dict[str, dict[str, float]] = {"owner": {}, "renter": {}}
        for tenure in ("owner", "renter"):
            for tier in AMI_TIERS:
                inc = (last["demand_by_ami"][tenure].get(tier, 0)
                       - first["demand_by_ami"][tenure].get(tier, 0))
                ami_incremental[tenure][tier] = round(inc, 1)

        return {
            "horizon_years":        last["year_offset"],
            "total_new_units":      round(total_new_units, 1),
            "new_owner_households": round(owner_new, 1),
            "new_renter_households": round(renter_new, 1),
            "ami_incremental_demand": ami_incremental,
        }
