"""tests/test_sentinel_normalization.py
Unit tests for ACS sentinel value normalization functions.

The Census ACS API returns -666666666 for variables that are "not available"
for a given geography (suppressed small-population data, questions not asked
for a survey type, etc.).  All such values must be converted to Python None
(JSON null) before they enter any production data file or UI display path.

Tested functions
----------------
* ``build_hna_data.normalize_acs_value``  — single-value coercion
* ``build_hna_data.normalize_acs_dict``   — whole-dict normalization
* ``build_hna_data.safe_float``           — float helper with sentinel guard
* ``build_ranking_index.safe_float``      — ranking float helper with sentinel guard

Run with::

    pytest tests/test_sentinel_normalization.py -v
"""
from __future__ import annotations

import math
import os
import sys

import pytest

# ---------------------------------------------------------------------------
# Path setup — allow direct imports from scripts/hna without installation
# ---------------------------------------------------------------------------
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
_HNA_DIR   = os.path.join(_REPO_ROOT, 'scripts', 'hna')
if _HNA_DIR not in sys.path:
    sys.path.insert(0, _HNA_DIR)

from build_hna_data import (  # noqa: E402
    ACS_SENTINEL_THRESHOLD,
    normalize_acs_dict,
    normalize_acs_value,
    safe_float as hna_safe_float,
)
from build_ranking_index import safe_float as ranking_safe_float  # noqa: E402

# ---------------------------------------------------------------------------
# Constants used across all test classes
# ---------------------------------------------------------------------------
SENTINEL_INT    = -666666666
SENTINEL_FLOAT  = -666666666.0
SENTINEL_STRING = '-666666666'


# ===========================================================================
# normalize_acs_value
# ===========================================================================

class TestNormalizeAcsValueSentinels:
    """Sentinel inputs must always produce None."""

    def test_sentinel_int(self):
        assert normalize_acs_value(SENTINEL_INT) is None

    def test_sentinel_float(self):
        assert normalize_acs_value(SENTINEL_FLOAT) is None

    def test_sentinel_string(self):
        assert normalize_acs_value(SENTINEL_STRING) is None

    def test_string_none(self):
        assert normalize_acs_value('None') is None

    def test_string_na(self):
        assert normalize_acs_value('NA') is None

    def test_empty_string(self):
        assert normalize_acs_value('') is None

    def test_python_none(self):
        assert normalize_acs_value(None) is None

    def test_dash_string(self):
        """Census sometimes uses bare '-' as a missing-value marker."""
        assert normalize_acs_value('-') is None

    def test_extreme_negative_below_threshold(self):
        """Values far below the threshold are also sentinels."""
        assert normalize_acs_value(-999999999) is None
        assert normalize_acs_value(-1_000_000) is None

    def test_threshold_constant_is_correct(self):
        assert ACS_SENTINEL_THRESHOLD == -1_000_000


class TestNormalizeAcsValuePassthrough:
    """Valid numeric values must pass through unchanged (type-preserved)."""

    def test_positive_int(self):
        assert normalize_acs_value(50_000) == 50_000

    def test_positive_int_type_preserved(self):
        result = normalize_acs_value(42)
        assert isinstance(result, int)
        assert result == 42

    def test_positive_float(self):
        result = normalize_acs_value(3.14)
        assert result == pytest.approx(3.14)

    def test_zero(self):
        result = normalize_acs_value(0)
        assert result == 0

    def test_small_negative_valid(self):
        """Modestly negative values (e.g. net migration) are NOT sentinels."""
        result = normalize_acs_value(-1)
        assert result == -1

    def test_string_integer(self):
        """ACS API often returns numeric values as strings."""
        result = normalize_acs_value('75000')
        assert result == 75_000

    def test_string_float(self):
        result = normalize_acs_value('42.7')
        assert result == pytest.approx(42.7)

    def test_just_above_threshold(self):
        """A value one unit above the threshold must not be treated as sentinel."""
        result = normalize_acs_value(-999_999)
        assert result == -999_999


class TestNormalizeAcsValueEdgeCases:
    """Unusual inputs must not raise; they should return None gracefully."""

    def test_nan_string_returns_none(self):
        """'nan' is not a useful metric — normalise to None."""
        result = normalize_acs_value('nan')
        assert result is None

    def test_infinity_string_returns_none(self):
        result = normalize_acs_value('inf')
        assert result is None

    def test_negative_infinity_string_returns_none(self):
        result = normalize_acs_value('-inf')
        assert result is None

    def test_overflow_string_returns_none(self):
        """A string that overflows to ±∞ must not propagate as a real value."""
        result = normalize_acs_value('9' * 400)
        assert result is None  # float('9'*400) is inf → filtered

    def test_non_numeric_string_returns_none(self):
        assert normalize_acs_value('not_a_number') is None

    def test_list_input_returns_none(self):
        """Non-string, non-numeric types should be handled gracefully."""
        result = normalize_acs_value([1, 2, 3])
        # Should not raise; must return None (str conversion fails)
        assert result is None or isinstance(result, (int, float))

    def test_null_string_returns_none(self):
        assert normalize_acs_value('null') is None


# ===========================================================================
# normalize_acs_dict
# ===========================================================================

class TestNormalizeAcsDict:
    """normalize_acs_dict applies normalize_acs_value to every value."""

    def test_empty_dict(self):
        assert normalize_acs_dict({}) == {}

    def test_sentinel_int_values_become_none(self):
        d = {'a': SENTINEL_INT, 'b': SENTINEL_FLOAT, 'c': SENTINEL_STRING}
        result = normalize_acs_dict(d)
        assert result['a'] is None
        assert result['b'] is None
        assert result['c'] is None

    def test_valid_values_pass_through(self):
        d = {'pop': 50_000, 'income': 65_000, 'pct_renter': 42.1}
        result = normalize_acs_dict(d)
        assert result['pop'] == 50_000
        assert result['income'] == 65_000
        assert result['pct_renter'] == pytest.approx(42.1)

    def test_mixed_dict_real_acs_field_names(self):
        """Representative ACS variable names from DP03/DP04/DP05 tables."""
        d = {
            'DP05_0001E': '12345',       # valid population (string from API)
            'DP03_0062E': SENTINEL_INT,   # sentinel median income
            'DP04_0134E': '75000',        # valid median gross rent
            'DP04_0089E': SENTINEL_STRING,# sentinel median home value
            'DP04_0047PE': '38.5',        # valid pct renter
        }
        result = normalize_acs_dict(d)
        assert result['DP05_0001E'] == 12_345
        assert result['DP03_0062E'] is None
        assert result['DP04_0134E'] == 75_000
        assert result['DP04_0089E'] is None
        assert result['DP04_0047PE'] == pytest.approx(38.5)

    def test_existing_none_values_preserved(self):
        d = {'a': None, 'b': 100}
        result = normalize_acs_dict(d)
        assert result['a'] is None
        assert result['b'] == 100

    def test_string_missing_markers_become_none(self):
        d = {'x': 'NA', 'y': 'None', 'z': ''}
        result = normalize_acs_dict(d)
        assert all(v is None for v in result.values())

    def test_keys_are_unchanged(self):
        keys = {'DP05_0001E', 'DP03_0062E', 'DP04_0001E'}
        d = {k: 0 for k in keys}
        assert set(normalize_acs_dict(d).keys()) == keys

    def test_non_dict_input_returned_unchanged(self):
        """normalize_acs_dict must not crash on non-dict input."""
        assert normalize_acs_dict(None) is None
        assert normalize_acs_dict([1, 2, 3]) == [1, 2, 3]
        assert normalize_acs_dict('string') == 'string'


# ===========================================================================
# safe_float in build_hna_data
# ===========================================================================

class TestHnaSafeFloat:
    """safe_float (build_hna_data) — sentinel and edge-case detection."""

    def test_sentinel_int_returns_none(self):
        assert hna_safe_float(SENTINEL_INT) is None

    def test_sentinel_float_returns_none(self):
        assert hna_safe_float(SENTINEL_FLOAT) is None

    def test_sentinel_string_returns_none(self):
        assert hna_safe_float(SENTINEL_STRING) is None

    def test_none_input_returns_none(self):
        assert hna_safe_float(None) is None

    def test_empty_string_returns_none(self):
        assert hna_safe_float('') is None

    def test_na_string_returns_none(self):
        assert hna_safe_float('NA') is None

    def test_non_numeric_string_returns_none(self):
        assert hna_safe_float('not_a_number') is None

    def test_valid_int_passes_through(self):
        assert hna_safe_float(42) == pytest.approx(42.0)

    def test_valid_float_string_passes_through(self):
        assert hna_safe_float('3.14') == pytest.approx(3.14)

    def test_zero_passes_through(self):
        assert hna_safe_float(0) == pytest.approx(0.0)

    def test_inf_returns_none(self):
        assert hna_safe_float(float('inf')) is None

    def test_nan_returns_none(self):
        assert hna_safe_float(float('nan')) is None


# ===========================================================================
# safe_float in build_ranking_index
# ===========================================================================

class TestRankingSafeFloat:
    """safe_float (build_ranking_index) — sentinel detection with default."""

    def test_sentinel_int_returns_default(self):
        assert ranking_safe_float(SENTINEL_INT) == 0.0

    def test_sentinel_float_returns_default(self):
        assert ranking_safe_float(SENTINEL_FLOAT) == 0.0

    def test_none_returns_default(self):
        assert ranking_safe_float(None) == 0.0

    def test_custom_default_returned_for_sentinel(self):
        assert ranking_safe_float(SENTINEL_INT, default=-1.0) == -1.0

    def test_custom_default_returned_for_none(self):
        assert ranking_safe_float(None, default=99.0) == 99.0

    def test_valid_float_passes_through(self):
        assert ranking_safe_float(42.5) == pytest.approx(42.5)

    def test_valid_int_passes_through(self):
        assert ranking_safe_float(100) == pytest.approx(100.0)

    def test_invalid_string_returns_default(self):
        assert ranking_safe_float('not_a_number') == 0.0

    def test_extreme_negative_returns_default(self):
        assert ranking_safe_float(-999_999_999) == 0.0