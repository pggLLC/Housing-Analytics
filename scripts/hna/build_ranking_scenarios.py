#!/usr/bin/env python3
"""Build slim exploratory HNA ranking-scenario overlays.

These files are intentionally separate from data/hna/ranking-index.json. The
canonical ranking remains the official default; scenarios only support UI
diffing on the comparative ranking page.
"""

from __future__ import annotations

import importlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCENARIO_DIR = ROOT / "data" / "hna" / "ranking-scenarios"
CANONICAL_INDEX = ROOT / "data" / "hna" / "ranking-index.json"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

PRESETS = [
    {
        "id": "balanced",
        "scenario_name": "Balanced",
        "description": "Baseline comparison lens using an even gap count/rate blend and standard commuter pressure.",
        "gap_count_weight": 0.50,
        "gap_rate_weight": 0.50,
        "commuter_augment_alpha": 0.15,
        "min_rate_denominator": 50,
    },
    {
        "id": "rate-sensitive",
        "scenario_name": "Rate-sensitive",
        "description": "Prioritizes places where the affordable-unit gap is large relative to very-low-income households.",
        "gap_count_weight": 0.35,
        "gap_rate_weight": 0.65,
        "commuter_augment_alpha": 0.15,
        "min_rate_denominator": 50,
    },
    {
        "id": "large-gap",
        "scenario_name": "Large-gap / production-focused",
        "description": "Prioritizes jurisdictions with the largest absolute affordable-unit deficits.",
        "gap_count_weight": 0.65,
        "gap_rate_weight": 0.35,
        "commuter_augment_alpha": 0.15,
        "min_rate_denominator": 50,
    },
    {
        "id": "commuter-pressure",
        "scenario_name": "Commuter-pressure sensitive",
        "description": "Increases the augment for jurisdictions importing a large share of their workforce.",
        "gap_count_weight": 0.50,
        "gap_rate_weight": 0.50,
        "commuter_augment_alpha": 0.25,
        "min_rate_denominator": 50,
    },
    {
        "id": "rural-lens",
        "scenario_name": "Rural/small-community lens",
        "description": "Emphasizes gap rates and relaxes the rate-denominator floor to surface smaller communities.",
        "gap_count_weight": 0.35,
        "gap_rate_weight": 0.65,
        "commuter_augment_alpha": 0.15,
        "min_rate_denominator": 25,
    },
]


def _git_sha() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()
    except Exception:
        return "unknown"


def _slim(index: dict) -> list[dict]:
    return [
        {
            "geoid": entry["geoid"],
            "rank": entry["rank"],
            "overall_need_score": entry.get("metrics", {}).get("overall_need_score"),
        }
        for entry in index.get("rankings", [])
    ]


def build_scenarios() -> None:
    canonical = json.loads(CANONICAL_INDEX.read_text(encoding="utf-8"))
    based_on = canonical.get("metadata", {}).get("generatedAt")
    SCENARIO_DIR.mkdir(parents=True, exist_ok=True)

    for preset in PRESETS:
        module_name = "scripts.hna.build_ranking_index"
        if module_name in sys.modules:
            del sys.modules[module_name]
        builder = importlib.import_module(module_name)

        builder.apply_config(
            gap_count_weight=preset["gap_count_weight"],
            gap_rate_weight=preset["gap_rate_weight"],
            commuter_augment_alpha=preset["commuter_augment_alpha"],
            min_rate_denominator=preset["min_rate_denominator"],
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir) / f"{preset['id']}.json"
            builder.build(out_path=str(tmp_path))
            full = json.loads(tmp_path.read_text(encoding="utf-8"))

        out = {
            "metadata": {
                "scenario_id": preset["id"],
                "scenario_name": preset["scenario_name"],
                "description": preset["description"],
                "weights": {
                    "gap_count_weight": preset["gap_count_weight"],
                    "gap_rate_weight": preset["gap_rate_weight"],
                    "commuter_augment_alpha": preset["commuter_augment_alpha"],
                },
                "params": {
                    "min_rate_denominator": preset["min_rate_denominator"],
                },
                "generated_at": full.get("metadata", {}).get("generatedAt"),
                "source_commit": _git_sha(),
                "based_on": based_on,
            },
            "rankings": _slim(full),
        }
        out_path = SCENARIO_DIR / f"{preset['id']}.json"
        out_path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"[ranking-scenarios] wrote {out_path.relative_to(ROOT)} ({len(out['rankings'])} rows)")


def main() -> int:
    build_scenarios()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
