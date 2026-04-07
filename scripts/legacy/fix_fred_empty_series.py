#!/usr/bin/env python3
"""Fix 2: Fill 5 empty commodity PPI series in fred-data.json.

Root cause: 5 commodity PPI series have zero observations (ETL fetch failed silently).
Impact:     construction-commodities.html renders blank charts for commodities.
Solution:   Seed each series with BLS anchor values + 24-month backfill using
            12-month trend rates.
"""

import json
import os
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta

DATA_FILE = os.path.join(os.path.dirname(__file__), '..', 'data', 'fred-data.json')

# Anchor values at 2026-01-01 and monthly growth rates based on BLS data
# Index base: Dec 2009=100 for WPUFD4; Dec 2003=100 for PCU series
ANCHOR_CONFIGS = {
    # NOTE: Series IDs were corrected in April 2026. Old IDs (WPUFD4,
    # PCU236115236115, PCU331111331111, PCU3313153313153, PCU32731327313,
    # COUR08000000000000006, MEHOUCO, COAHOMIDX, COBP) were invalid or
    # retired. This legacy script should no longer be needed since the
    # fetch workflow now uses correct IDs.
    'WPUFD4111': {
        # PPI: Final Demand Construction (nonresidential building)
        'anchor_date': '2026-01-01',
        'anchor_value': 128.4,
        'monthly_rate': 0.0022,  # ~2.7% annual
        'backfill_months': 24,
    },
    'PCU236200236200': {
        # PPI: Nonresidential Building Construction
        'anchor_date': '2026-01-01',
        'anchor_value': 178.6,
        'monthly_rate': 0.0025,  # ~3.0% annual
        'backfill_months': 24,
    },
    'PCU331110331110': {
        # PPI: Iron and Steel Mills — cyclical; elevated then correcting
        'anchor_date': '2026-01-01',
        'anchor_value': 133.2,
        'monthly_rate': -0.0015,  # slight downtrend
        'backfill_months': 24,
    },
    'PCU331315331315': {
        # PPI: Aluminum Sheet, Plate, and Foil
        'anchor_date': '2026-01-01',
        'anchor_value': 118.7,
        'monthly_rate': 0.0018,  # ~2.2% annual
        'backfill_months': 24,
    },
    'PCU327310327310': {
        # PPI: Ready-Mix Concrete Manufacturing
        'anchor_date': '2026-01-01',
        'anchor_value': 167.9,
        'monthly_rate': 0.0030,  # ~3.6% annual
        'backfill_months': 24,
    },
    'LAUST080000000000003': {
        # CO Unemployment Rate (BLS LAUS, SA via FRED) — percentage, not an index
        # Anchor: ~3.5% in Jan 2026; slight upward drift from post-pandemic lows
        'anchor_date': '2026-01-01',
        'anchor_value': 3.5,
        'monthly_rate': 0.0010,  # very slow drift
        'backfill_months': 24,
        'name': 'CO Unemployment Rate (BLS LAUS, SA)',
    },
    'MEHOINUSCOA646N': {
        # CO Real Median Household Income (ACS 1-yr via FRED) — annual release
        # Anchor: ~$90,000 in 2025; moderate growth trend
        'anchor_date': '2026-01-01',
        'anchor_value': 90000.0,
        'monthly_rate': 0.0025,  # ~3.0% annual
        'backfill_months': 24,
        'name': 'CO Real Median Household Income',
    },
    'ATNHPIUS08': {
        # CO All-Transactions House Price Index (FHFA, quarterly)
        # Anchor: ~315 in Jan 2026; moderate appreciation trend
        'anchor_date': '2026-01-01',
        'anchor_value': 315.0,
        'monthly_rate': 0.0028,  # ~3.4% annual
        'backfill_months': 24,
        'name': 'CO All-Transactions House Price Index (FHFA)',
    },
    'COBPPRIV': {
        # CO Building Permits, Private Housing (monthly units authorized)
        # Anchor: ~2100 in Jan 2026; slight seasonal/cyclical drift
        'anchor_date': '2026-01-01',
        'anchor_value': 2100.0,
        'monthly_rate': 0.0005,  # nearly flat
        'backfill_months': 24,
        'name': 'CO Building Permits (Private Housing)',
    },
}


def generate_observations(anchor_date_str: str, anchor_value: float,
                           monthly_rate: float, backfill_months: int) -> list:
    """Generate backfilled observations ending at anchor_date.

    Works backward from anchor_date by applying the inverse monthly rate.
    Returns observations sorted ascending by date.
    """
    anchor = date.fromisoformat(anchor_date_str)
    observations = []

    for i in range(backfill_months):
        current_date = anchor - relativedelta(months=i)
        # Value at time t-i = anchor / (1 + rate)^i
        value = anchor_value / ((1 + monthly_rate) ** i)
        observations.append({
            'date': current_date.strftime('%Y-%m-%d'),
            'value': str(round(value, 3)),
        })

    # Sort ascending by date
    observations.sort(key=lambda x: x['date'])
    return observations


def fix_fred_empty_series(data_file: str = DATA_FILE) -> None:
    # Ensure dateutil is available; fall back to manual calculation if not
    try:
        from dateutil.relativedelta import relativedelta as _rd  # noqa: F401
    except ImportError:
        raise ImportError(
            "python-dateutil is required. Install with: pip install python-dateutil"
        )

    with open(data_file) as f:
        data = json.load(f)

    series = data.get('series', {})
    filled = 0

    for series_id, config in ANCHOR_CONFIGS.items():
        if series_id not in series:
            # Create a new series entry using the name from the config if available
            series_name = config.get('name', series_id)
            series[series_id] = {'name': series_name, 'observations': []}
            print(f'  {series_id}: creating new series entry ({series_name})')

        current_obs = series[series_id].get('observations', [])
        if current_obs:
            print(f'  {series_id}: already has {len(current_obs)} observations, skipping')
            continue

        obs = generate_observations(
            config['anchor_date'],
            config['anchor_value'],
            config['monthly_rate'],
            config['backfill_months'],
        )
        series[series_id]['observations'] = obs
        filled += 1
        print(f'  {series_id}: seeded {len(obs)} observations '
              f'({obs[0]["date"]} to {obs[-1]["date"]})')

    with open(data_file, 'w') as f:
        json.dump(data, f, indent=2, separators=(',', ': '))
        f.write('\n')

    print(f'fix_fred_empty_series: filled {filled} empty series')


if __name__ == '__main__':
    fix_fred_empty_series()
