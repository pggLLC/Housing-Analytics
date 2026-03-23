"""tests/test_ranking_index_sentinels.py
Verify that sentinel / leak values do not appear in production ranking JSON.

Sentinel -666666666 is an ACS ETL placeholder for "data not available."
Rendering this value in the UI produces misleading numeric output (e.g.,
"-666,666,666" in a dollar column).  This test ensures the ETL pipeline has
normalized all sentinels to null before writing the JSON file.
"""

import json
import math
import os

import pytest

REPO_ROOT    = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
RANKING_PATH = os.path.join(REPO_ROOT, 'data', 'hna', 'ranking-index.json')

SENTINEL = -666666666


@pytest.fixture(scope='module')
def ranking_data():
    assert os.path.isfile(RANKING_PATH), f'ranking-index.json not found: {RANKING_PATH}'
    with open(RANKING_PATH) as f:
        return json.load(f)


class TestNoSentinelValues:
    def test_no_sentinel_in_metrics(self, ranking_data):
        """No ranking entry's metric value may equal -666666666."""
        leaks = []
        for entry in ranking_data.get('rankings', []):
            for metric, val in entry.get('metrics', {}).items():
                if val == SENTINEL:
                    leaks.append((entry.get('geoid'), metric, val))
        assert len(leaks) == 0, (
            f'{len(leaks)} sentinel values found in ranking-index.json metrics.\n'
            f'First 10: {leaks[:10]}\n'
            f'Run the ETL normalization pass to convert sentinels to null.'
        )

    def test_no_extreme_negative_in_metrics(self, ranking_data):
        """No metric value should be an unrealistically large negative number."""
        EXTREME_NEGATIVE_THRESHOLD = -1_000_000
        leaks = []
        for entry in ranking_data.get('rankings', []):
            for metric, val in entry.get('metrics', {}).items():
                if isinstance(val, (int, float)) and val < EXTREME_NEGATIVE_THRESHOLD:
                    leaks.append((entry.get('geoid'), metric, val))
        assert len(leaks) == 0, (
            f'{len(leaks)} extreme-negative metric values found: {leaks[:10]}'
        )

    def test_no_nan_or_inf_in_metrics(self, ranking_data):
        """No metric value should be NaN or ±Infinity after JSON serialization."""
        # JSON does not support NaN/Infinity so these can only appear as strings;
        # still check in case a future change bypasses json.dump's guards.
        bad = []
        for entry in ranking_data.get('rankings', []):
            for metric, val in entry.get('metrics', {}).items():
                if isinstance(val, float) and (math.isnan(val) or math.isinf(val)):
                    bad.append((entry.get('geoid'), metric, val))
        assert len(bad) == 0, f'NaN/Infinity metric values found: {bad[:10]}'


class TestRankingStructure:
    def test_rankings_key_present(self, ranking_data):
        assert 'rankings' in ranking_data, "ranking-index.json must have a 'rankings' key"

    def test_metadata_key_present(self, ranking_data):
        assert 'metadata' in ranking_data, "ranking-index.json must have a 'metadata' key"

    def test_all_entries_have_geoid(self, ranking_data):
        missing = [
            i for i, r in enumerate(ranking_data.get('rankings', []))
            if not r.get('geoid')
        ]
        assert len(missing) == 0, f'Entries missing geoid at indices: {missing[:10]}'

    def test_all_entries_have_type(self, ranking_data):
        allowed_types = {'county', 'place', 'cdp'}
        bad = [
            r.get('geoid') for r in ranking_data.get('rankings', [])
            if r.get('type') not in allowed_types
        ]
        assert len(bad) == 0, f'Entries with invalid type: {bad[:10]}'

    def test_ranking_count_reasonable(self, ranking_data):
        """Expect at least 300 ranked geographies for Colorado."""
        count = len(ranking_data.get('rankings', []))
        assert count >= 300, f'Unexpectedly low ranking count: {count}'
