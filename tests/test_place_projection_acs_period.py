"""Place household shares use the ACS 5-year for place and county alike.

Owner decision 2026-11-03: the household share in build_place_projections.py
divides a place's ACS 5-year households by its county's ACS 5-year households.
Before it, Milliken's 2020-24 5-year count was divided by Weld County's 2025
1-year count (173 of 472 rows mixed periods). A geography whose main profile is
the 1-year reads its 5-year twin; until the twin carries households the 1-year
is used and the row is marked "mixed". Invented summaries only.
"""

from __future__ import annotations

import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'hna'))

import build_place_projections as bpp  # noqa: E402


def _write(dirpath, geoid, payload):
    with open(os.path.join(dirpath, f'{geoid}.json'), 'w', encoding='utf-8') as f:
        json.dump(payload, f)


def test_one_year_county_reads_its_five_year_twin(tmp_path, monkeypatch):
    monkeypatch.setattr(bpp, 'SUMMARY_DIR', str(tmp_path))
    _write(tmp_path, '08999', {
        'acsProfile': {'DP02_0001E': 132280, '_acsSeries': 'acs1', '_acsYear': '2025'},
        'acs5Profile': {'DP02_0001E': 125000, '_acsSeries': 'acs5', '_acsYear': '2024'},
    })
    assert bpp.summary_households_with_period('08999') == (125000.0, 'acs5:2024')


def test_twin_without_households_falls_back_and_says_so(tmp_path, monkeypatch):
    monkeypatch.setattr(bpp, 'SUMMARY_DIR', str(tmp_path))
    _write(tmp_path, '08998', {
        'acsProfile': {'DP02_0001E': 132280, '_acsSeries': 'acs1', '_acsYear': '2025'},
        'acs5Profile': {'DP04_0001E': 140000, '_acsSeries': 'acs5', '_acsYear': '2024'},
    })
    assert bpp.summary_households_with_period('08998') == (132280.0, 'acs1:2025')


def test_five_year_place_reads_its_own_profile(tmp_path, monkeypatch):
    monkeypatch.setattr(bpp, 'SUMMARY_DIR', str(tmp_path))
    _write(tmp_path, '0899901', {'acsProfile': {'DP02_0001E': 3192, '_acsSeries': 'acs5', '_acsYear': '2024'}})
    assert bpp.summary_households_with_period('0899901') == (3192.0, 'acs5:2024')


def test_missing_or_zero_households_stay_unknown(tmp_path, monkeypatch):
    monkeypatch.setattr(bpp, 'SUMMARY_DIR', str(tmp_path))
    _write(tmp_path, '0899902', {'acsProfile': {'DP02_0001E': 0, '_acsSeries': 'acs5', '_acsYear': '2024'}})
    assert bpp.summary_households_with_period('0899902') == (None, None)
    assert bpp.summary_households_with_period('0899903') == (None, None)


def test_committed_rows_with_inputs_divide_like_with_like():
    path = os.path.join(ROOT, 'data', 'hna', 'projections', 'places.json')
    places = json.load(open(path, encoding='utf-8'))['places']
    for geoid, rec in places.items():
        inputs = rec.get('household_inputs')
        if not inputs:
            continue  # written before the 2026-11-03 rule; the next rebuild adds it
        share = inputs['place_households'] / inputs['county_households']
        assert abs(share - rec['shares']['household']) < 1e-5, geoid
        periods = set(inputs['county_periods']) | {inputs['place_period']}
        assert inputs['period'] == (periods.pop() if len(periods) == 1 else 'mixed'), geoid
