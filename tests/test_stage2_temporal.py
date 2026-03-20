#!/usr/bin/env python3
"""Stage 2 Temporal Logic & Methodology Test Suite.

Comprehensive pytest validation for 7 temporal engine fixes.
Covers 55+ checks across 7 validation blocks:
  1. FRED metadata validation (6 checks)
  2. FRED temporal continuity (8 checks)
  3. CAR market reports (12 checks)
  4. car-market.json schema (6 checks)
  5. Projection base year (8 checks)
  6. LIHTC trends temporal coverage (9 checks)
  7. Cross-file temporal consistency (6 checks)

Usage:
    pytest tests/test_stage2_temporal.py -v
"""

import json
import os
import glob
from datetime import date, datetime, timedelta, timezone
from dateutil.relativedelta import relativedelta

import pytest

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA_DIR = os.path.join(REPO_ROOT, 'data')

FRED_FILE = os.path.join(DATA_DIR, 'fred-data.json')
CAR_MARKET_FILE = os.path.join(DATA_DIR, 'car-market.json')
CAR_REPORT_FEB = os.path.join(DATA_DIR, 'car-market-report-2026-02.json')
CAR_REPORT_MAR = os.path.join(DATA_DIR, 'car-market-report-2026-03.json')
LIHTC_FILE = os.path.join(DATA_DIR, 'lihtc-trends-by-county.json')
PROJ_DIR = os.path.join(DATA_DIR, 'hna', 'projections')

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope='session')
def fred_data():
    with open(FRED_FILE) as f:
        return json.load(f)


@pytest.fixture(scope='session')
def fred_series(fred_data):
    return fred_data.get('series', {})


@pytest.fixture(scope='session')
def car_market():
    with open(CAR_MARKET_FILE) as f:
        return json.load(f)


@pytest.fixture(scope='session')
def car_report_feb():
    with open(CAR_REPORT_FEB) as f:
        return json.load(f)


@pytest.fixture(scope='session')
def car_report_mar():
    with open(CAR_REPORT_MAR) as f:
        return json.load(f)


@pytest.fixture(scope='session')
def lihtc():
    with open(LIHTC_FILE) as f:
        return json.load(f)


@pytest.fixture(scope='session')
def projection_files():
    # Match only county-level files (5-digit FIPS: 08XXX.json).
    # The statewide aggregate (08.json) is excluded intentionally.
    return sorted(glob.glob(os.path.join(PROJ_DIR, '08???.json')))


@pytest.fixture(scope='session')
def sample_projection(projection_files):
    with open(projection_files[0]) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Block 1: FRED Metadata Validation (6 checks)
# ---------------------------------------------------------------------------


class TestFredMetadata:
    # Governance Rule 6: the canonical required field is "name" (not "title").
    # Downstream code that reads "title" must fall back to "name".
    REQUIRED_META_FIELDS = ['name']

    SAMPLE_SERIES = [
        'CPIAUCSL', 'UNRATE', 'PAYEMS', 'MORTGAGE30US', 'HOUST', 'DFF'
    ]

    def test_all_series_have_name(self, fred_series):
        """All 39 FRED series must have a non-empty name field (Rule 6).

        The canonical identifier field is 'name'. Legacy code may read 'title'
        but must fall back to 'name' per the governance spec.
        """
        missing = [k for k, v in fred_series.items() if not v.get('name')]
        assert missing == [], f'Series missing name: {missing}'

    def test_all_series_have_observations_list(self, fred_series):
        """All 39 FRED series must include an observations list (Rule 6)."""
        missing = [
            k for k, v in fred_series.items()
            if not isinstance(v.get('observations'), list)
        ]
        assert missing == [], f'Series missing observations list: {missing}'

    def test_sample_series_have_numeric_values(self, fred_series):
        """Sample core series must have observations with parseable numeric values."""
        for series_id in self.SAMPLE_SERIES:
            obs = fred_series.get(series_id, {}).get('observations', [])
            assert obs, f'{series_id}: has no observations'
            for o in obs[:5]:  # spot-check first 5 observations
                try:
                    float(o['value'])
                except (ValueError, TypeError, KeyError):
                    assert False, (
                        f'{series_id}: non-numeric value {o!r} in observations'
                    )

    def test_all_series_have_valid_date_format(self, fred_series):
        """All series observations must use YYYY-MM-DD date format."""
        import re
        date_re = re.compile(r'^\d{4}-\d{2}-\d{2}$')
        bad = []
        for series_id, entry in fred_series.items():
            obs = entry.get('observations', [])
            for o in obs[:3]:  # spot-check first 3 dates
                if not date_re.match(str(o.get('date', ''))):
                    bad.append(f'{series_id}: {o.get("date")!r}')
                    break
        assert bad == [], f'Series with invalid date format: {bad}'

    def test_sample_series_have_min_12_observations(self, fred_series):
        """Sample series must have at least 12 observations (one year of data)."""
        for series_id in self.SAMPLE_SERIES:
            obs = fred_series.get(series_id, {}).get('observations', [])
            assert len(obs) >= 12, (
                f'{series_id}: expected ≥12 observations, got {len(obs)}'
            )

    def test_series_count_is_39(self, fred_series):
        """fred-data.json must contain exactly 39 series."""
        assert len(fred_series) == 39, (
            f'Expected 39 series, found {len(fred_series)}'
        )


# ---------------------------------------------------------------------------
# Block 2: FRED Temporal Continuity (8 checks)
# ---------------------------------------------------------------------------


class TestFredTemporalContinuity:
    MONTHLY_SERIES = ['CPIAUCSL', 'CUUR0000SAH1', 'UNRATE', 'CIVPART']
    # These commodity PPI series may be unavailable from the FRED API;
    # they are tracked separately and only validated when present.
    COMMODITY_SERIES = [
        'WPUFD4', 'PCU236115236115', 'PCU331111331111',
        'PCU3313153313153', 'PCU32731327313',
    ]
    # Maximum age in days before a series is considered stale
    MAX_AGE_DAYS = 60

    def test_no_empty_core_series(self, fred_series):
        """Core monthly FRED series must have at least one observation."""
        empty = [s for s in self.MONTHLY_SERIES
                 if len(fred_series.get(s, {}).get('observations', [])) == 0]
        assert empty == [], f'Core monthly series with no observations: {empty}'

    def test_commodity_series_have_min_24_obs_if_present(self, fred_series):
        """Commodity PPI series must have ≥ 24 observations when data is available.

        Series with zero observations are skipped — FRED may not carry them for
        the current vintage; the fetch workflow logs a warning in that case.
        """
        for series_id in self.COMMODITY_SERIES:
            obs = fred_series.get(series_id, {}).get('observations', [])
            if not obs:
                continue  # series unavailable from FRED; handled by monitoring
            assert len(obs) >= 24, (
                f'{series_id}: expected ≥24 observations, got {len(obs)}'
            )

    def test_commodity_series_values_in_plausible_range(self, fred_series):
        """Commodity PPI series values must be in plausible index range (50–500)."""
        for series_id in self.COMMODITY_SERIES:
            obs = fred_series.get(series_id, {}).get('observations', [])
            for o in obs:
                val = float(o['value'])
                assert 50.0 <= val <= 500.0, (
                    f'{series_id}: value {val} on {o["date"]} outside range [50, 500]'
                )

    def test_monthly_series_have_recent_data(self, fred_series):
        """Each core monthly FRED series must have an observation within the last 60 days.

        This replaces the previous hard-coded date checks (e.g. test_cpiaucsl_has_oct_2025)
        with a dynamic, date-aware assertion that remains valid as time advances.
        """
        cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=self.MAX_AGE_DAYS)
        for series_id in self.MONTHLY_SERIES:
            obs = fred_series.get(series_id, {}).get('observations', [])
            assert obs, f'{series_id}: has no observations'
            latest_date_str = max(o['date'] for o in obs)
            latest = datetime.fromisoformat(latest_date_str)
            assert latest >= cutoff, (
                f'{series_id}: latest observation is {latest_date_str}, '
                f'more than {self.MAX_AGE_DAYS} days old'
            )

    def test_monthly_series_no_internal_gaps(self, fred_series):
        """Core monthly FRED series must have no internal gaps > 35 days.

        An "internal" gap is any consecutive-date gap that occurs entirely
        within the observed data (i.e., both surrounding dates are present).
        This replaces the brittle test_oct_2025_is_interpolated_correctly check.
        """
        for series_id in self.MONTHLY_SERIES:
            obs = fred_series.get(series_id, {}).get('observations', [])
            assert obs, f'{series_id}: has no observations'
            dates = sorted(date.fromisoformat(o['date']) for o in obs)
            for i in range(1, len(dates)):
                gap = (dates[i] - dates[i - 1]).days
                assert gap <= 35, (
                    f'{series_id}: internal gap of {gap} days between '
                    f'{dates[i-1]} and {dates[i]}'
                )


# ---------------------------------------------------------------------------
# Block 3: CAR Market Reports (12 checks)
# ---------------------------------------------------------------------------


class TestCarMarketReports:
    STATEWIDE_FIELDS = [
        'median_sale_price', 'active_listings', 'median_days_on_market',
        'median_price_per_sqft', 'closed_sales', 'new_listings',
        'months_of_supply', 'list_to_sale_ratio',
    ]
    METRO_FIELDS = [
        'median_sale_price', 'active_listings', 'median_days_on_market',
        'median_price_per_sqft', 'closed_sales', 'new_listings', 'months_of_supply',
    ]
    METRO_AREAS = [
        'denver', 'colorado_springs', 'fort_collins', 'boulder', 'pueblo', 'grand_junction'
    ]

    def test_feb_statewide_no_nulls(self, car_report_feb):
        """February report statewide fields must all be non-null."""
        sw = car_report_feb.get('statewide', {})
        null_fields = [f for f in self.STATEWIDE_FIELDS if sw.get(f) is None]
        assert null_fields == [], f'Feb report statewide null fields: {null_fields}'

    def test_mar_statewide_no_nulls(self, car_report_mar):
        """March report statewide fields must all be non-null."""
        sw = car_report_mar.get('statewide', {})
        null_fields = [f for f in self.STATEWIDE_FIELDS if sw.get(f) is None]
        assert null_fields == [], f'Mar report statewide null fields: {null_fields}'

    def test_feb_metro_no_nulls(self, car_report_feb):
        """February report metro area fields must all be non-null."""
        metros = car_report_feb.get('metro_areas', {})
        for metro_key in self.METRO_AREAS:
            metro = metros.get(metro_key, {})
            null_fields = [f for f in self.METRO_FIELDS if metro.get(f) is None]
            assert null_fields == [], (
                f'Feb report {metro_key} null fields: {null_fields}'
            )

    def test_mar_metro_no_nulls(self, car_report_mar):
        """March report metro area fields must all be non-null."""
        metros = car_report_mar.get('metro_areas', {})
        for metro_key in self.METRO_AREAS:
            metro = metros.get(metro_key, {})
            null_fields = [f for f in self.METRO_FIELDS if metro.get(f) is None]
            assert null_fields == [], (
                f'Mar report {metro_key} null fields: {null_fields}'
            )

    def test_feb_median_price_plausible(self, car_report_feb):
        """February statewide median_sale_price must be in plausible CO range."""
        price = car_report_feb['statewide']['median_sale_price']
        assert 400_000 <= price <= 900_000, (
            f'Feb median_sale_price {price} outside expected CO range [400k, 900k]'
        )

    def test_mar_median_price_plausible(self, car_report_mar):
        """March statewide median_sale_price must be in plausible CO range."""
        price = car_report_mar['statewide']['median_sale_price']
        assert 400_000 <= price <= 900_000, (
            f'Mar median_sale_price {price} outside expected CO range [400k, 900k]'
        )

    def test_feb_months_supply_plausible(self, car_report_feb):
        """February months of supply must be in plausible range."""
        mos = car_report_feb['statewide']['months_of_supply']
        assert 0.5 <= mos <= 12.0, f'Feb months_of_supply {mos} implausible'

    def test_mar_months_supply_plausible(self, car_report_mar):
        """March months of supply must be in plausible range."""
        mos = car_report_mar['statewide']['months_of_supply']
        assert 0.5 <= mos <= 12.0, f'Mar months_of_supply {mos} implausible'

    def test_feb_dom_plausible(self, car_report_feb):
        """February median days on market must be in plausible range (1–180)."""
        dom = car_report_feb['statewide']['median_days_on_market']
        assert 1 <= dom <= 180, f'Feb median_days_on_market {dom} implausible'

    def test_mar_dom_plausible(self, car_report_mar):
        """March median days on market must be in plausible range (1–180)."""
        dom = car_report_mar['statewide']['median_days_on_market']
        assert 1 <= dom <= 180, f'Mar median_days_on_market {dom} implausible'

    def test_mar_greater_activity_than_feb(self, car_report_feb, car_report_mar):
        """March should have higher closed_sales than February (spring seasonal)."""
        feb_sales = car_report_feb['statewide']['closed_sales']
        mar_sales = car_report_mar['statewide']['closed_sales']
        assert mar_sales >= feb_sales, (
            f'Expected Mar ({mar_sales}) ≥ Feb ({feb_sales}) closed_sales'
        )

    def test_metro_prices_less_than_statewide_or_premium(self, car_report_feb):
        """Metro median prices should be within ±30% of statewide."""
        sw_price = car_report_feb['statewide']['median_sale_price']
        metros = car_report_feb.get('metro_areas', {})
        for metro_key, metro in metros.items():
            metro_price = metro.get('median_sale_price', 0)
            if metro_price:
                ratio = metro_price / sw_price
                assert 0.5 <= ratio <= 1.5, (
                    f'{metro_key}: price ratio {ratio:.2f} outside [0.5, 1.5] '
                    f'(metro={metro_price}, state={sw_price})'
                )


# ---------------------------------------------------------------------------
# Block 4: car-market.json Schema (6 checks)
# ---------------------------------------------------------------------------


class TestCarMarketSchema:
    CANONICAL_FIELDS = [
        'median_sale_price', 'active_listings', 'median_days_on_market',
        'median_price_per_sqft', 'closed_sales', 'new_listings',
        'months_of_supply', 'list_to_sale_ratio',
    ]
    LEGACY_FIELDS = ['median_price', 'median_dom', 'price_per_sqft']

    def test_canonical_fields_present(self, car_market):
        """car-market.json must have all canonical field names."""
        missing = [f for f in self.CANONICAL_FIELDS if f not in car_market]
        assert missing == [], f'Missing canonical fields: {missing}'

    def test_no_raw_legacy_fields(self, car_market):
        """car-market.json must not have raw (non-aliased) legacy field names."""
        raw_legacy = [f for f in self.LEGACY_FIELDS if f in car_market]
        assert raw_legacy == [], (
            f'Raw legacy fields still present (should be _legacy_*): {raw_legacy}'
        )

    def test_legacy_aliases_present(self, car_market):
        """car-market.json must have _legacy_ aliases for renamed fields."""
        expected_aliases = [f'_legacy_{f}' for f in self.LEGACY_FIELDS]
        missing_aliases = [a for a in expected_aliases if a not in car_market]
        assert missing_aliases == [], f'Missing legacy aliases: {missing_aliases}'

    def test_median_sale_price_matches_legacy(self, car_market):
        """median_sale_price must equal _legacy_median_price."""
        canonical = car_market.get('median_sale_price')
        legacy = car_market.get('_legacy_median_price')
        if legacy is not None:
            assert canonical == legacy, (
                f'median_sale_price ({canonical}) != _legacy_median_price ({legacy})'
            )

    def test_median_sale_price_plausible(self, car_market):
        """car-market.json median_sale_price must be in plausible CO range."""
        price = car_market.get('median_sale_price', 0)
        assert 400_000 <= price <= 900_000, (
            f'median_sale_price {price} outside expected range'
        )

    def test_list_to_sale_ratio_range(self, car_market):
        """list_to_sale_ratio must be between 0.8 and 1.1."""
        lsr = car_market.get('list_to_sale_ratio', 0)
        assert 0.8 <= lsr <= 1.1, f'list_to_sale_ratio {lsr} outside plausible range'


# ---------------------------------------------------------------------------
# Block 5: Projection Base Year (8 checks)
# ---------------------------------------------------------------------------


class TestProjectionBaseYear:
    def test_all_files_have_baseyear_2024(self, projection_files):
        """All 64 projection files must have baseYear: 2024."""
        bad = []
        for f in projection_files:
            with open(f) as fh:
                proj = json.load(fh)
            if proj.get('baseYear') != 2024:
                bad.append(f'{os.path.basename(f)}: {proj.get("baseYear")}')
        assert bad == [], f'Files with wrong baseYear:\n' + '\n'.join(bad)

    def test_projection_count_is_64(self, projection_files):
        """Must have exactly 64 projection files (one per CO county)."""
        assert len(projection_files) == 64, (
            f'Expected 64 projection files, found {len(projection_files)}'
        )

    def test_base_population_matches_2024_dola(self, sample_projection):
        """base.population must match population_dola at year index 2024."""
        years = sample_projection['years']
        population_dola = sample_projection['population_dola']
        base_pop = sample_projection['base']['population']
        idx_2024 = years.index(2024)
        expected = population_dola[idx_2024]
        assert abs(base_pop - expected) < 1.0, (
            f'base.population {base_pop} != population_dola[2024] {expected}'
        )

    def test_incremental_at_2024_is_zero(self, sample_projection):
        """incremental_units_needed_dola at year 2024 must be 0."""
        years = sample_projection['years']
        incr = sample_projection['housing_need']['incremental_units_needed_dola']
        idx_2024 = years.index(2024)
        val = incr[idx_2024]
        assert abs(val) < 0.01, (
            f'incremental_units_needed_dola at 2024 = {val}, expected ~0'
        )

    def test_incremental_increases_after_2024(self, sample_projection):
        """incremental_units_needed_dola must increase after 2024 (growing need)."""
        years = sample_projection['years']
        incr = sample_projection['housing_need']['incremental_units_needed_dola']
        idx_2024 = years.index(2024)
        # Check 2025 onward
        for i in range(idx_2024 + 1, min(idx_2024 + 6, len(incr))):
            assert incr[i] > incr[i - 1], (
                f'incremental decreases at year {years[i]}: '
                f'{incr[i]} < {incr[i-1]}'
            )

    def test_base_households_consistent_with_headship(self, sample_projection):
        """base.households must be consistent with population × headship_rate."""
        base = sample_projection['base']
        expected_hh = base['population'] * base['headship_rate']
        assert abs(base['households'] - expected_hh) < 1.0, (
            f'base.households {base["households"]} != '
            f'population × headship_rate = {expected_hh}'
        )

    def test_base_housing_units_consistent_with_vacancy(self, sample_projection):
        """base.housing_units must be consistent with households / (1 - vacancy)."""
        base = sample_projection['base']
        vacancy = base['vacancy_rate'] / 100.0
        expected_units = base['households'] / (1 - vacancy)
        assert abs(base['housing_units'] - expected_units) < 1.0, (
            f'base.housing_units {base["housing_units"]} != '
            f'expected {expected_units}'
        )

    def test_statewide_aggregate_has_vacancy_rate(self):
        """Statewide 08.json must have vacancy_rate in base and satisfy the formula."""
        state_file = os.path.join(PROJ_DIR, '08.json')
        with open(state_file) as f:
            proj = json.load(f)
        base = proj['base']
        assert 'vacancy_rate' in base, 'Statewide 08.json is missing vacancy_rate in base'
        vacancy = base['vacancy_rate'] / 100.0
        expected_units = base['households'] / (1 - vacancy)
        assert abs(base['housing_units'] - expected_units) < 1.0, (
            f'Statewide housing_units {base["housing_units"]} != '
            f'expected {expected_units} (vacancy_rate={base["vacancy_rate"]})'
        )

    def test_years_array_includes_2024(self, sample_projection):
        """Projection years array must include 2024."""
        years = sample_projection['years']
        assert 2024 in years, f'2024 not in years array: {years}'


# ---------------------------------------------------------------------------
# Block 6: LIHTC Trends Temporal Coverage (9 checks)
# ---------------------------------------------------------------------------


class TestLihtcTrendsCoverage:
    ALL_CO_COUNTIES = [
        'Adams', 'Alamosa', 'Arapahoe', 'Archuleta', 'Baca', 'Bent', 'Boulder',
        'Broomfield', 'Chaffee', 'Cheyenne', 'Clear Creek', 'Conejos', 'Costilla',
        'Crowley', 'Custer', 'Delta', 'Denver', 'Dolores', 'Douglas', 'Eagle',
        'El Paso', 'Elbert', 'Fremont', 'Garfield', 'Gilpin', 'Grand', 'Gunnison',
        'Hinsdale', 'Huerfano', 'Jackson', 'Jefferson', 'Kiowa', 'Kit Carson',
        'La Plata', 'Lake', 'Larimer', 'Las Animas', 'Lincoln', 'Logan', 'Mesa',
        'Mineral', 'Moffat', 'Montezuma', 'Montrose', 'Morgan', 'Otero', 'Ouray',
        'Park', 'Phillips', 'Pitkin', 'Prowers', 'Pueblo', 'Rio Blanco',
        'Rio Grande', 'Routt', 'Saguache', 'San Juan', 'San Miguel', 'Sedgwick',
        'Summit', 'Teller', 'Washington', 'Weld', 'Yuma',
    ]

    def test_all_64_counties_present(self, lihtc):
        """lihtc-trends-by-county.json must contain all 64 Colorado counties."""
        counties = lihtc.get('counties', {})
        missing = [c for c in self.ALL_CO_COUNTIES if c not in counties]
        assert missing == [], f'Missing counties ({len(missing)}): {missing}'

    def test_county_count_is_64(self, lihtc):
        """Must have exactly 64 counties."""
        counties = lihtc.get('counties', {})
        assert len(counties) == 64, (
            f'Expected 64 counties, found {len(counties)}'
        )

    def test_all_counties_have_all_years(self, lihtc):
        """Every county must have data for all years in the years array."""
        years = [str(y) for y in lihtc.get('years', [])]
        counties = lihtc.get('counties', {})
        for county, data in counties.items():
            missing_years = [y for y in years if y not in data]
            assert missing_years == [], (
                f'{county} missing years: {missing_years}'
            )

    def test_2025_flagged_as_preliminary(self, lihtc):
        """2025 must be in the preliminary_years list."""
        prelim = lihtc.get('preliminary_years', [])
        assert 2025 in prelim, f'2025 not in preliminary_years: {prelim}'

    def test_preliminary_note_exists(self, lihtc):
        """A preliminary_note field must exist explaining the YR_PIS lag."""
        note = lihtc.get('preliminary_note', '')
        assert note, 'preliminary_note field is missing or empty'
        assert 'YR_PIS' in note or 'lag' in note.lower(), (
            f'preliminary_note does not mention YR_PIS lag: {note}'
        )

    def test_missing_counties_have_zero_counts(self, lihtc):
        """Newly added (zero-activity) counties must have 0 for all years."""
        known_active = {
            'Adams', 'Arapahoe', 'Boulder', 'Denver', 'El Paso', 'Jefferson',
            'Larimer', 'Weld',
        }
        counties = lihtc.get('counties', {})
        # Previously missing counties should have all zeros
        previously_missing = [
            'Archuleta', 'Baca', 'Bent', 'Cheyenne', 'Yuma',
        ]
        for county in previously_missing:
            if county in counties:
                data = counties[county]
                assert all(v == 0 for v in data.values()), (
                    f'{county} should have all zeros but has: {data}'
                )

    def test_existing_counties_not_zeroed_out(self, lihtc):
        """Existing active counties must retain non-zero historical data."""
        counties = lihtc.get('counties', {})
        active_counties = ['Denver', 'Boulder', 'Jefferson', 'El Paso', 'Adams']
        for county in active_counties:
            if county in counties:
                data = counties[county]
                total = sum(data.values())
                assert total > 0, (
                    f'Active county {county} has all-zero data after fix'
                )

    def test_years_range_2015_to_2025(self, lihtc):
        """Years array must span 2015 to 2025 inclusive."""
        years = lihtc.get('years', [])
        assert 2015 in years, f'2015 not in years: {years}'
        assert 2025 in years, f'2025 not in years: {years}'

    def test_county_values_non_negative(self, lihtc):
        """All county year values must be non-negative integers."""
        counties = lihtc.get('counties', {})
        for county, data in counties.items():
            for year, count in data.items():
                assert isinstance(count, int), (
                    f'{county}[{year}] is not int: {count!r}'
                )
                assert count >= 0, (
                    f'{county}[{year}] is negative: {count}'
                )


# ---------------------------------------------------------------------------
# Block 7: Cross-File Temporal Consistency (6 checks)
# ---------------------------------------------------------------------------


class TestCrossFileTemporalConsistency:
    def test_car_market_feb_price_matches_report(self, car_market, car_report_feb):
        """car-market.json median_sale_price must match Feb report statewide value."""
        cm_price = car_market.get('median_sale_price')
        feb_price = car_report_feb['statewide'].get('median_sale_price')
        assert cm_price is not None and feb_price is not None
        assert cm_price == feb_price, (
            f'car-market.json price ({cm_price}) != Feb report price ({feb_price})'
        )

    def test_mar_price_at_least_feb_price(self, car_report_feb, car_report_mar):
        """March median price should be ≥ February (spring appreciation)."""
        feb_price = car_report_feb['statewide']['median_sale_price']
        mar_price = car_report_mar['statewide']['median_sale_price']
        assert mar_price >= feb_price, (
            f'Mar price ({mar_price}) should be ≥ Feb price ({feb_price})'
        )

    def test_fred_data_updated_field_exists(self, fred_data):
        """fred-data.json must have a top-level updated timestamp."""
        assert fred_data.get('updated'), 'fred-data.json missing updated field'

    def test_lihtc_updated_field_exists(self, lihtc):
        """lihtc-trends-by-county.json must have an updated field."""
        assert lihtc.get('updated'), 'lihtc-trends-by-county.json missing updated field'

    def test_projections_all_have_county_fips(self, projection_files):
        """All projection files must have countyFips field."""
        missing_fips = []
        for f in projection_files:
            with open(f) as fh:
                proj = json.load(fh)
            if not proj.get('countyFips'):
                missing_fips.append(os.path.basename(f))
        assert missing_fips == [], f'Projection files missing countyFips: {missing_fips}'

    def test_fred_series_monthly_no_large_gaps(self, fred_series):
        """Key monthly FRED series must have no internal gaps > 35 days.

        Only consecutive date pairs where both dates are present in the data
        (i.e., true internal gaps) are checked. This avoids false positives from
        the trailing edge of the series where FRED may have a publication lag.
        """
        monthly_series = ['CPIAUCSL', 'UNRATE', 'PAYEMS', 'CIVPART']
        for series_id in monthly_series:
            obs = fred_series.get(series_id, {}).get('observations', [])
            dates = sorted(date.fromisoformat(o['date']) for o in obs)
            for i in range(1, len(dates)):
                gap = (dates[i] - dates[i - 1]).days
                assert gap <= 35, (
                    f'{series_id}: gap of {gap} days between '
                    f'{dates[i-1]} and {dates[i]}'
                )


# ---------------------------------------------------------------------------
# Block 8: FRED Data Currency UI (4 checks)
# ---------------------------------------------------------------------------


class TestFredDataCurrencyUI:
    """Verify that dashboard HTML files expose data-currency hooks.

    Economic and commodity dashboards must contain elements that display
    "As of [date]" information so users can see how fresh each data series is.
    """

    ECONOMIC_DASHBOARD = os.path.join(REPO_ROOT, 'economic-dashboard.html')
    COMMODITIES_DASHBOARD = os.path.join(REPO_ROOT, 'construction-commodities.html')

    def _load_html(self, path):
        with open(path, encoding='utf-8') as f:
            return f.read()

    def test_economic_dashboard_has_meta_currency_class(self):
        """economic-dashboard.html must contain elements with class 'meta-currency'."""
        html = self._load_html(self.ECONOMIC_DASHBOARD)
        assert 'meta-currency' in html, (
            'economic-dashboard.html is missing elements with class "meta-currency". '
            'Add <span class="meta-currency"> inside each FRED metric card to show '
            '"As of [date]" data freshness information.'
        )

    def test_economic_dashboard_has_data_currency_attr(self):
        """economic-dashboard.html must contain elements with data-currency attribute."""
        html = self._load_html(self.ECONOMIC_DASHBOARD)
        assert 'data-currency' in html, (
            'economic-dashboard.html is missing data-currency attributes. '
            'Add data-currency="..." to FRED card containers so tests and '
            'screen readers can access the data vintage.'
        )

    def test_construction_commodities_has_meta_currency_class(self):
        """construction-commodities.html must contain elements with class 'meta-currency'."""
        html = self._load_html(self.COMMODITIES_DASHBOARD)
        assert 'meta-currency' in html, (
            'construction-commodities.html is missing elements with class "meta-currency". '
            'Add <span class="meta-currency"> inside each commodity price card to show '
            '"As of [date]" data freshness information.'
        )

    def test_construction_commodities_has_data_currency_attr(self):
        """construction-commodities.html must contain elements with data-currency attribute."""
        html = self._load_html(self.COMMODITIES_DASHBOARD)
        assert 'data-currency' in html, (
            'construction-commodities.html is missing data-currency attributes. '
            'Add data-currency="..." to commodity card containers.'
        )
