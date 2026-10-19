"""CRA size class rule in scripts/cra/fetch_fdic_branches_co.py (2026 thresholds)."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "fetch_fdic_branches_co",
    Path(__file__).resolve().parent.parent / "scripts" / "cra" / "fetch_fdic_branches_co.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def test_large_needs_both_year_ends():
    assert mod.size_class(1_700_000, 1_650_000, 2026) == "large"
    # Above the line on only one of the two December 31 dates is not large.
    assert mod.size_class(1_600_000, 1_700_000, 2026) == "intermediate"


def test_intermediate_and_small():
    assert mod.size_class(412_000, 500_000, 2026) == "intermediate"
    assert mod.size_class(411_999, 500_000, 2026) == "small"
    assert mod.size_class(100_000, 100_000, 2026) == "small"


def test_missing_year_is_unknown():
    assert mod.size_class(None, 2_000_000, 2026) is None
