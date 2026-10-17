"""The county household series follows the SDO household forecast (#2260).

Before 2026-10 every county's ``housing_need.households_dola`` was population x
a constant base-year headship rate. The State Demography Office publishes a
county household forecast (household-county.csv) that already carries changing
household size and age structure; for La Plata County the constant rate grew
households 61% slower than that forecast, and every downstream need figure
(places.json, the ranking index, the briefs, the homepage) was low with it.

What these tests hold is the agreement, not the copy: each county file's
household series must move, year by year, by exactly what the committed SDO
forecast moves from the base year; the base year itself must stay the
profile's household count; the statewide file must sum the counties; and the
builder's own functions must prefer the forecast and fall back to the headship
rate, returning None (never 0) where neither exists.
"""

from __future__ import annotations

import glob
import json
import os
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
PROJ_DIR = os.path.join(ROOT, 'data', 'hna', 'projections')
FORECAST_CSV = os.path.join(ROOT, 'data', 'hna', 'source', 'dola_household_county.csv')

sys.path.insert(0, os.path.join(ROOT, 'scripts', 'hna'))
import build_hna_data as hna  # noqa: E402

FORECAST = hna.HOUSEHOLD_METHOD_FORECAST
HEADSHIP = hna.HOUSEHOLD_METHOD_HEADSHIP


def _load(path: str) -> dict:
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


@pytest.fixture(scope='module')
def forecast() -> dict[str, dict[int, float]]:
    assert os.path.exists(FORECAST_CSV), f'{FORECAST_CSV} is missing: the DOLA phase caches it next to the components file'
    with open(FORECAST_CSV, 'r', encoding='utf-8') as f:
        parsed = hna.parse_sdo_household_forecast(f.read())
    assert len(parsed) >= 64, f'the cached household forecast parsed to {len(parsed)} counties, not 64'
    return parsed


@pytest.fixture(scope='module')
def county_files() -> list[str]:
    files = sorted(glob.glob(os.path.join(PROJ_DIR, '08???.json')))
    assert len(files) == 64, f'{len(files)} county projection files; every statewide set carries 64 counties'
    return files


# ── the committed data agrees with the committed forecast ────────────────────

def test_every_county_moves_with_the_sdo_household_forecast(forecast, county_files):
    checked = 0
    for path in county_files:
        d = _load(path)
        cf = d['countyFips']
        years = d['years']
        base_year = d['baseYear']
        hh = d['housing_need']['households_dola']
        method = d['housing_need'].get('household_method')
        assert isinstance(method, list) and len(method) == len(years), f'{cf}: household_method must label every year'
        assert cf in forecast, f'{cf}: not in the household forecast'
        f = forecast[cf]
        bi = years.index(base_year)
        base_hh = d['base']['households']
        assert base_hh is not None and abs(hh[bi] - base_hh) < 0.01, (
            f'{cf}: the series starts at {hh[bi]}, the profile base year says {base_hh}')
        for i, y in enumerate(years):
            if y not in f or base_year not in f:
                continue
            assert method[i] == FORECAST, f'{cf} {y}: the forecast covers this year but the file says {method[i]}'
            expected = f[y] - f[base_year]
            actual = hh[i] - hh[bi]
            assert abs(actual - expected) < 0.5, (
                f'{cf} {y}: households moved {actual:,.1f} from {base_year}; the SDO forecast moves {expected:,.1f}')
            checked += 1
    assert checked >= 64 * 20, f'only {checked} county-years compared; the scan is not reading the series'


def test_la_plata_grows_with_the_forecast_not_the_constant_rate(county_files):
    # The measured case: with the constant rate, La Plata's 2024-2034 household
    # growth was 1,124 against the forecast's 2,871 (issue #2260).
    d = _load(os.path.join(PROJ_DIR, '08067.json'))
    years = d['years']
    hh = d['housing_need']['households_dola']
    pop = d['population_dola']
    i0, i10 = years.index(2024), years.index(2034)
    growth = hh[i10] - hh[i0]
    constant_rate_growth = d['base']['households'] * (pop[i10] / pop[i0] - 1.0)
    assert growth > 1.5 * constant_rate_growth, (
        f'La Plata 2024-2034 household growth {growth:,.0f} is back near the constant-rate figure {constant_rate_growth:,.0f}')
    inc = d['housing_need']['incremental_units_needed_dola']
    assert inc[i10] > growth, 'units needed by 2034 must exceed the household growth once target vacancy is applied'


def test_statewide_file_sums_the_county_series(county_files):
    state = _load(os.path.join(PROJ_DIR, '08.json'))
    years = state['years']
    totals = [0.0] * len(years)
    for path in county_files:
        hh = _load(path)['housing_need']['households_dola']
        assert len(hh) == len(years), f'{os.path.basename(path)}: {len(hh)} years, statewide has {len(years)}'
        for i, v in enumerate(hh):
            assert v is not None, f'{os.path.basename(path)} {years[i]}: households is None'
            totals[i] += v
    for i, y in enumerate(years):
        assert abs(state['housing_need']['households_dola'][i] - totals[i]) < 1.0, (
            f'statewide {y}: {state["housing_need"]["households_dola"][i]:,.1f} is not the county sum {totals[i]:,.1f}')
    assert state['housing_need'].get('household_method') == [FORECAST] * len(years), (
        'the statewide file must say every year came from the forecast when every county did')


def test_method_labels_are_only_the_known_values(county_files):
    allowed = {FORECAST, HEADSHIP, None}
    seen = set()
    for path in county_files:
        for m in _load(path)['housing_need']['household_method']:
            assert m in allowed, f'{os.path.basename(path)}: unknown household_method {m!r}'
            seen.add(m)
    assert FORECAST in seen, 'no county used the forecast; the DOLA phase ran without household-county.csv'


# ── the builder's own functions ──────────────────────────────────────────────

def test_project_households_prefers_the_forecast_change_over_the_profile_base():
    years = [2024, 2025, 2026]
    hh, method = hna.project_households(
        years, 2024, base_households=100.0, pop_dola=[1000.0, 1100.0, 1200.0], headship=0.1,
        forecast_by_year={2024: 50.0, 2025: 60.0, 2026: 75.0})
    assert hh == [100.0, 110.0, 125.0], 'each year moves by the forecast change from its base year, from the profile base'
    assert method == [FORECAST] * 3


def test_project_households_falls_back_to_the_headship_rate_only_where_the_forecast_is_missing():
    years = [2024, 2025, 2026]
    hh, method = hna.project_households(
        years, 2024, base_households=100.0, pop_dola=[1000.0, 1100.0, 1200.0], headship=0.1,
        forecast_by_year={2024: 50.0, 2025: 60.0})
    assert hh == [100.0, 110.0, 120.0]
    assert method == [FORECAST, FORECAST, HEADSHIP]
    hh, method = hna.project_households(years, 2024, 100.0, [1000.0, 1100.0, 1200.0], 0.1, None)
    assert hh == [100.0, 110.0, 120.0] and method == [HEADSHIP] * 3, 'no forecast at all: the pre-#2260 method, labelled'


def test_project_households_reports_absence_as_none_never_zero():
    years = [2024, 2025]
    hh, method = hna.project_households(years, 2024, base_households=None, pop_dola=[1000.0, None], headship=None,
                                        forecast_by_year={2024: 50.0, 2025: 60.0})
    assert hh == [None, None] and method == [None, None]
    hh, method = hna.project_households(years, 2024, 100.0, [1000.0, None], 0.1, {})
    assert hh == [100.0, None] and method == [HEADSHIP, None]


def test_parse_sdo_household_forecast_keeps_only_county_totals():
    text = '\n'.join([
        'id,area_code,year,household_type_id,household_type_description,age_group_id,age_group_description,total_households',
        '1,0,2024,0,All Households,0,Total,2367212',
        '2,67,2024,0,All Households,0,Total,24356',
        '3,67,2024,0,All Households,1,18-24,900',
        '4,67,2024,1,One adult no kids,0,Total,7000',
        '5,67,2034,0,All Households,0,Total,27227',
        '6,1,2024,0,All Households,0,Total,189607',
        '7,bad,2024,0,All Households,0,Total,1',
    ])
    out = hna.parse_sdo_household_forecast(text)
    assert out == {'08067': {2024: 24356.0, 2034: 27227.0}, '08001': {2024: 189607.0}}
    assert hna.parse_sdo_household_forecast('x,y\n1,2\n') == {}


def test_county_fips_from_sdo_area_accepts_county_codes_and_full_fips():
    # area_code style (67) and countyfips style ('08067', read as 8067) both land on '08067'.
    assert hna.county_fips_from_sdo_area(67) == '08067'
    assert hna.county_fips_from_sdo_area('67') == '08067'
    assert hna.county_fips_from_sdo_area('08067') == '08067'
    assert hna.county_fips_from_sdo_area(8067) == '08067'
    assert hna.county_fips_from_sdo_area('1') == '08001'
    assert hna.county_fips_from_sdo_area('08001') == '08001'
    # the statewide row, another state's county and junk are not Colorado counties
    assert hna.county_fips_from_sdo_area(0) is None
    assert hna.county_fips_from_sdo_area('48001') is None
    assert hna.county_fips_from_sdo_area('bad') is None
    assert hna.county_fips_from_sdo_area(None) is None


def test_parse_sdo_household_forecast_reads_a_full_fips_column_without_double_prefixing():
    text = '\n'.join([
        'countyfips,year,household_type_id,age_group_id,total_households',
        '08067,2024,0,0,24356',
        '08067,2034,0,0,27227',
        '08001,2024,0,0,189607',
        '48001,2024,0,0,5',
        '0,2024,0,0,2367212',
    ])
    assert hna.parse_sdo_household_forecast(text) == {
        '08067': {2024: 24356.0, 2034: 27227.0}, '08001': {2024: 189607.0},
    }


def test_label_household_method_marks_an_incomplete_year_as_none():
    F, H = hna.HOUSEHOLD_METHOD_FORECAST, hna.HOUSEHOLD_METHOD_HEADSHIP
    assert hna.label_household_method([[F, F], [F, F]], 2) == [F, F]
    assert hna.label_household_method([[F, F], [H, F]], 2) == ['mixed', F]
    # a county with no value for a year makes that year's statewide label None, not the others'
    assert hna.label_household_method([[F, F, F], [F, None, F]], 3) == [F, None, F]
    # a county whose list is short, or missing, is unavailable for the years it lacks
    assert hna.label_household_method([[F, F], [F]], 2) == [F, None]
    assert hna.label_household_method([[F, F], None], 2) == [None, None]
    assert hna.label_household_method([], 2) == [None, None]


def test_statewide_label_is_what_the_committed_county_files_produce(county_files):
    methods = [_load(p)['housing_need'].get('household_method') for p in county_files]
    state = _load(os.path.join(PROJ_DIR, '08.json'))
    labels = hna.label_household_method(methods, len(state['years']))
    assert labels == state['housing_need']['household_method']
    assert None not in labels, 'every county-year must have a household value'


def test_statewide_series_is_null_for_a_year_any_county_cannot_value(tmp_path, monkeypatch, county_files):
    """A statewide sum over fewer than all counties is not Colorado's total.

    Copy three real county files, blank one county's last year (no forecast,
    no headship fallback: value and label None), and rebuild the statewide
    aggregate from that directory. The last year must be None in the
    households, units and incremental series and in the label; every other
    year must still be the full sum. The reconciliation note and the
    calculator on the HNA page treat a None year as absent (#2260).
    """
    assert len(county_files) >= 3, 'need three committed county files to build a small aggregate'
    for path in county_files[:3]:
        data = _load(path)
        if os.path.basename(path) == os.path.basename(county_files[0]):
            hn = data['housing_need']
            hn['households_dola'][-1] = None
            hn['units_needed_dola'][-1] = None
            hn['incremental_units_needed_dola'][-1] = None
            hn['household_method'][-1] = None
        with open(tmp_path / os.path.basename(path), 'w', encoding='utf-8') as f:
            json.dump(data, f)
    monkeypatch.setitem(hna.OUT, 'proj_dir', str(tmp_path))
    hna._build_state_projection_aggregate()
    state = _load(str(tmp_path / f'{hna.STATE_FIPS_CO}.json'))
    hn = state['housing_need']
    last = len(state['years']) - 1
    for key in ('households_dola', 'units_needed_dola', 'incremental_units_needed_dola', 'household_method'):
        assert hn[key][last] is None, f'{key}: a year one county cannot value must be null statewide, got {hn[key][last]!r}'
    counties = [_load(str(tmp_path / os.path.basename(p))) for p in county_files[:3]]
    for i in range(last):
        expected = round(sum(c['housing_need']['households_dola'][i] for c in counties), 2)
        assert hn['households_dola'][i] == pytest.approx(expected), f'year index {i} still sums every county'
        assert hn['household_method'][i] is not None
    base_idx = state['years'].index(hna.HNA_BASE_YEAR)
    assert hn['incremental_units_needed_dola'][base_idx] == 0.0
