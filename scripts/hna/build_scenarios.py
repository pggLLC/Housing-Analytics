#!/usr/bin/env python3
"""build_scenarios.py — Generate baseline, low-growth, and high-growth scenario data files.

Reads projection_scenarios.json and produces JSON files in data/hna/scenarios/ that
can be loaded by the browser-side scenario builder.

Usage
-----
    python3 scripts/hna/build_scenarios.py
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_HERE    = os.path.dirname(os.path.abspath(__file__))
_ROOT    = os.path.dirname(os.path.dirname(_HERE))  # repo root
_SCEN_SRC = os.path.join(_HERE, "projection_scenarios.json")
_OUT_DIR  = os.path.join(_ROOT, "data", "hna", "scenarios")

# FRED series that inform alternative scenarios
_FRED_REFS = {
    "baseline":   None,
    "low_growth": "CUUR0000SAH1",   # CPI shelter component — affordability headwind indicator
    "high_growth": "UNRATE",        # Unemployment rate — economic expansion indicator
}

_DOLA_URL = "https://demography.dola.colorado.gov/population/population-totals-colorado-counties/"
_VINTAGE  = 2024
_BASE_YEAR   = 2024
_TARGET_YEAR = 2050

SCENARIO_META = {
    "baseline": {
        "id":   "baseline",
        "name": "Baseline (Moderate Growth)",
        "description": (
            "Baseline scenario: moderate growth following recent historical trends. "
            "Fertility rates hold steady at recent levels; net migration reflects the "
            "2018–2023 average; mortality follows current life-table patterns."
        ),
        "source": "DOLA State Demography Office — Components of Change (2024 vintage)",
        "sourceUrl": _DOLA_URL,
        "fredSeriesRef": None,
        "attributionNote": (
            "Projections use the DOLA cohort-component model with 2024-vintage "
            "single-year-of-age data as the base population. Net migration is the "
            "2018–2023 average county-level flow from DOLA Components of Change. "
            "Fertility rates are derived from ACS 5-year estimates."
        ),
    },
    "low_growth": {
        "id":   "low-growth",
        "name": "Low Growth",
        "description": (
            "Low-growth scenario: slowing in-migration, modest fertility decline, "
            "and slightly elevated mortality (aging population effect). Reflects "
            "headwinds such as affordability-driven out-migration."
        ),
        "source": "DOLA State Demography Office (2024) with FRED CPI shelter adjustment",
        "sourceUrl": _DOLA_URL,
        "fredSeriesRef": "CUUR0000SAH1",
        "attributionNote": (
            "Low-growth scenario reduces baseline migration by 50% and fertility by 10%, "
            "reflecting affordability headwinds documented in FRED CPI shelter index. "
            "Mortality is elevated 2% above the life-table baseline to capture aging-population effects."
        ),
    },
    "high_growth": {
        "id":   "high-growth",
        "name": "High Growth",
        "description": (
            "High-growth scenario: accelerated in-migration driven by economic expansion, "
            "slightly above-trend fertility, and continued mortality improvements. "
            "Reflects a strong regional economy drawing working-age households."
        ),
        "source": "DOLA State Demography Office (2024) with FRED unemployment adjustment",
        "sourceUrl": _DOLA_URL,
        "fredSeriesRef": "UNRATE",
        "attributionNote": (
            "High-growth scenario doubles baseline migration and raises fertility 5%, "
            "reflecting Colorado's historically strong economic in-migration documented "
            "in FRED labor market data. Mortality improvements (2% below baseline) reflect "
            "nationwide longevity trends."
        ),
    },
}


def load_source_scenarios() -> dict:
    with open(_SCEN_SRC, "r", encoding="utf-8") as fh:
        return json.load(fh)


def build_scenario_file(scenario_key: str, source: dict) -> dict:
    """Merge projection_scenarios.json parameters with rich metadata."""
    meta = SCENARIO_META[scenario_key]
    params = source.get(scenario_key, {}).get("parameters", {})

    return {
        "id":   meta["id"],
        "name": meta["name"],
        "description": meta["description"],
        "source":      meta["source"],
        "sourceUrl":   meta["sourceUrl"],
        "fredSeriesRef": meta.get("fredSeriesRef"),
        "createdAt":   datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "vintage":     _VINTAGE,
        "assumptions": source.get(scenario_key, {}).get("assumptions", {}),
        "parameters":  params,
        "projectionHorizon": {
            "baseYear":   _BASE_YEAR,
            "targetYear": _TARGET_YEAR,
            "steps":      _TARGET_YEAR - _BASE_YEAR,
        },
        "attributionNote": meta["attributionNote"],
        "methodologyRef":  "docs/PROJECTION-METHODOLOGY.md",
    }


def main() -> None:
    os.makedirs(_OUT_DIR, exist_ok=True)

    print("Loading source scenarios from projection_scenarios.json …")
    source = load_source_scenarios()

    for sc_key in ("baseline", "low_growth", "high_growth"):
        out_filename = sc_key.replace("_", "-") + ".json"
        out_path = os.path.join(_OUT_DIR, out_filename)

        data = build_scenario_file(sc_key, source)

        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)

        print(f"  Wrote {out_path}")

    print(f"\n✅  {len(SCENARIO_META)} scenario files written to {_OUT_DIR}")


if __name__ == "__main__":
    main()
