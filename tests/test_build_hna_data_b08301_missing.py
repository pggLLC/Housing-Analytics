"""B08301 commuting counts: a missing count stays unknown, never a measured zero.

Invented Census responses only. Covers the 3 Nov 2026 pre-public audit finding
that an all-null response came back as seven zero-worker modes.
"""

from pathlib import Path
import sys
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "hna"))

import build_hna_data as hna  # noqa: E402

KEYS = ['B08301_001E', 'B08301_003E', 'B08301_004E', 'B08301_010E', 'B08301_018E',
        'B08301_019E', 'B08301_016E', 'B08301_017E', 'B08301_020E', 'B08301_021E']


def _response(values):
    return [KEYS + ['state', 'county'], [values.get(k) for k in KEYS] + ['08', '077']]


def _run(responses):
    calls = iter(responses)
    with mock.patch.object(hna, 'http_get_json', side_effect=lambda url: next(calls, None)):
        return hna.fetch_acs_b08301('county', '08077')


def test_all_null_response_is_skipped_for_the_next_vintage():
    good = dict.fromkeys(KEYS, '10')
    good['B08301_001E'] = '100'
    out = _run([_response({}), _response(good)])
    assert out is not None
    assert out['total'] == 100 and out['drive'] == 10
    assert out['other'] == 30


def test_no_usable_response_returns_none_not_zeros():
    out = _run([_response({})] * 20)
    assert out is None


def test_partial_and_annotated_counts_stay_unknown():
    vals = dict.fromkeys(KEYS, '5')
    vals.update({'B08301_001E': '100', 'B08301_010E': None, 'B08301_019E': '-666666666', 'B08301_017E': '-1'})
    out = _run([_response(vals)])
    assert out['transit'] is None
    assert out['walk'] is None
    assert out['other'] is None  # one of its three parts is unknown
    assert out['drive'] == 5


def test_measured_zero_is_kept():
    vals = dict.fromkeys(KEYS, '0')
    vals['B08301_001E'] = '100'
    vals['B08301_003E'] = '100'
    out = _run([_response(vals)])
    assert out['transit'] == 0 and out['walk'] == 0 and out['other'] == 0
    assert out['drive'] == 100
