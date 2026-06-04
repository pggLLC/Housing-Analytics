#!/usr/bin/env python3
"""
scripts/build_county_trends_json.py

F199 + F200 — Convert the three parquet files in data/co-housing-costs/ to a
single browser-loadable JSON keyed by county FIPS. The HNA renderers read it
synchronously to chart decade-long affordability + housing-type pace.

Inputs:
  data/co-housing-costs/acs_county_latest.parquet       (3 cohorts: 2009, 2014, 2024)
  data/co-housing-costs/fhfa_hpi_county_raw.parquet     (latest + 10y + 15y indices)
  data/co-housing-costs/permits_county.parquet          (annual unit permits 2020-2024)

Output:
  data/co-housing-costs/county-trends.json

Schema:
  {
    "meta": { "generated": ISO timestamp, "vintage": str },
    "counties": {
      "08001": {
        "county_name": "Adams, Colorado",
        "acs_cohorts": [
          { "year": 2009, "median_gross_rent": 700, "median_hh_income": 48960, "rent_burden_30_plus": 0.525, "vacancy_rate": 0.100 },
          { "year": 2014, ... },
          { "year": 2024, ... }
        ],
        "hpi": { "latest": 340.0, "10y_base": 165.0, "15y_base": 115.0, "change_10y": 1.06, "change_15y": 1.96 },
        "permits": [ { "year": 2020, "total_units": 3995 }, ... ]
      },
      ...
    }
  }

Usage:
  python3 scripts/build_county_trends_json.py
"""
import datetime
import json
import os

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR = os.path.join(ROOT, 'data', 'co-housing-costs')
ACS_PATH = os.path.join(DIR, 'acs_county_latest.parquet')
HPI_PATH = os.path.join(DIR, 'fhfa_hpi_county_raw.parquet')
PERMITS_PATH = os.path.join(DIR, 'permits_county.parquet')
OUT_PATH = os.path.join(DIR, 'county-trends.json')


def _normalize_fips(v):
    """ACS FIPS in parquet are strings like '08001'; FHFA HPI may store as int. Normalize to 5-char zero-padded string."""
    s = str(v).strip()
    if s.endswith('.0'):  # int → str via pandas can leave .0
        s = s[:-2]
    return s.zfill(5)


def main():
    acs = pd.read_parquet(ACS_PATH)
    hpi = pd.read_parquet(HPI_PATH)
    permits = pd.read_parquet(PERMITS_PATH)

    counties = {}

    # ── ACS cohorts ─────────────────────────────────────────────────
    for _, row in acs.iterrows():
        fips = _normalize_fips(row['county_fips'])
        if fips not in counties:
            counties[fips] = {
                'county_name': str(row['county_name']),
                'acs_cohorts': [],
                'hpi': None,
                'permits': [],
            }
        counties[fips]['acs_cohorts'].append({
            'year': int(row['acs_year']),
            'median_gross_rent': float(row['median_gross_rent']) if pd.notna(row['median_gross_rent']) else None,
            'median_hh_income': float(row['median_hh_income']) if pd.notna(row['median_hh_income']) else None,
            'rent_burden_30_plus': float(row['rent_burden_30_plus']) if pd.notna(row['rent_burden_30_plus']) else None,
            'vacancy_rate': float(row['vacancy_rate']) if pd.notna(row['vacancy_rate']) else None,
            'total_housing_units': int(row['total_housing_units']) if pd.notna(row['total_housing_units']) else None,
        })

    # Sort cohorts ascending by year
    for fips, rec in counties.items():
        rec['acs_cohorts'].sort(key=lambda r: r['year'])

    # ── FHFA HPI ────────────────────────────────────────────────────
    for _, row in hpi.iterrows():
        fips = _normalize_fips(row['county_fips'])
        if fips not in counties:
            counties[fips] = {'county_name': '', 'acs_cohorts': [], 'hpi': None, 'permits': []}
        counties[fips]['hpi'] = {
            'latest': float(row['hpi_latest']) if pd.notna(row['hpi_latest']) else None,
            'base_10y': float(row['hpi_10y_base']) if pd.notna(row['hpi_10y_base']) else None,
            'base_15y': float(row['hpi_15y_base']) if pd.notna(row['hpi_15y_base']) else None,
            'change_10y_pct': float(row['hpi_change_10y']) if pd.notna(row['hpi_change_10y']) else None,
            'change_15y_pct': float(row['hpi_change_15y']) if pd.notna(row['hpi_change_15y']) else None,
        }

    # ── Permits ─────────────────────────────────────────────────────
    for _, row in permits.iterrows():
        fips = _normalize_fips(row['county_fips'])
        if fips not in counties:
            counties[fips] = {'county_name': '', 'acs_cohorts': [], 'hpi': None, 'permits': []}
        counties[fips]['permits'].append({
            'year': int(row['bps_year']),
            'total_units': int(row['total_units']) if pd.notna(row['total_units']) else 0,
        })
    for fips, rec in counties.items():
        rec['permits'].sort(key=lambda r: r['year'])

    out = {
        'meta': {
            'generated': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'vintage': '2024',
            'sources': [
                'Census ACS 5-yr 2009/2014/2024 (B25064 median gross rent, B19013 median HH income, B25070 rent burden)',
                'FHFA House Price Index (county-level, annual)',
                'Census Building Permits Survey (BPS) — annual unit permits',
            ],
            'note': 'ACS cohorts are 3 snapshots (2009, 2014, 2024), not continuous annual series. FHFA HPI is annual continuous. Permits are annual 2020-2024.',
        },
        'counties': counties,
    }

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'Wrote {OUT_PATH}: {len(counties)} counties')
    print(f'Sample (08001): {json.dumps(counties.get("08001"), indent=2)[:600]}')


if __name__ == '__main__':
    main()
