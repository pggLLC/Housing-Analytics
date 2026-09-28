"""EPA's National Walkability Index reaches epa_sld_co.json only if it matches EPA's formula.

The walkability score is EPA's NatWalkInd rescaled to 0-100
(js/data-connectors/epa-walkability.js). scripts/market/fetch_epa_sld.py
checks every block group against EPA's published formula
    d3bRanked/3 + d4aRanked/3 + d2aRanked/6 + d2bRanked/6
and refuses to write otherwise. These tests pin that refusal, and that the
committed data satisfies the formula.
"""
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("fetch_epa_sld", ROOT / "scripts" / "market" / "fetch_epa_sld.py")
fetch_epa_sld = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch_epa_sld)


def record(**over):
    rec = {"GEOID20": "080310020001", "D3B": 150.0, "D2B_E8MIX": 0.8,
           "NatWalkInd": 14.0, "D3B_Ranked": 18, "D4A_Ranked": 12, "D2A_Ranked": 12, "D2B_Ranked": 12}
    rec.update(over)
    return rec


def test_matching_index_is_written_with_its_ranks():
    bg = fetch_epa_sld.build_output([record()])["blockGroups"]["080310020001"]
    assert bg["walkIndex"] == 14.0
    assert (bg["d3bRanked"], bg["d4aRanked"], bg["d2aRanked"], bg["d2bRanked"]) == (18, 12, 12, 12)


def test_index_that_disagrees_with_the_formula_is_refused():
    with pytest.raises(RuntimeError, match="EPA formula"):
        fetch_epa_sld.build_output([record(NatWalkInd=15.0)])


def test_index_without_its_ranks_is_refused():
    with pytest.raises(RuntimeError, match="component ranks"):
        fetch_epa_sld.build_output([record(D4A_Ranked=None)])


def test_committed_data_matches_the_formula_for_every_block_group():
    bgs = json.loads((ROOT / "data" / "market" / "epa_sld_co.json").read_text())["blockGroups"]
    assert len(bgs) > 3000
    w = fetch_epa_sld.WALK_INDEX_WEIGHTS
    off = [g for g, b in bgs.items()
           if b.get("walkIndex") is None or abs(sum(b[k] * v for k, v in w.items()) - b["walkIndex"]) > 0.01]
    assert off == [], f"{len(off)} block groups lack an index or disagree with EPA's formula, e.g. {off[:3]}"
