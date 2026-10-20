#!/usr/bin/env python3
"""Fetch Colorado's death and birth rates by age into data/hna/source/.

The Scenario Builder's cohort-component model needs the age pattern of deaths
and births. It takes the pattern from Colorado's published rates and scales it,
year by year and county by county, to the State Demography Office's own totals
of deaths and births (build_scenario_baseline.py). Only the shape by age comes
from here; every total comes from SDO.

  Deaths: U.S. State Life Tables, 2021 (NCHS, National Vital Statistics
          Reports vol. 73 no. 7, August 2024), Tables CO-2 (males) and CO-3
          (females): qx, the probability of dying between ages x and x+1, for
          ages 0 to 99. The open interval 100 and older has qx = 1 by
          definition, so its annual rate is dx / Lx.
  Births: Births: Final Data for 2023 (NCHS, NVSR vol. 74 no. 1, March 2025),
          Table 8, the Colorado row: births per 1,000 women by 5-year age of
          mother. The row is read from the report's text and checked against
          the total fertility rate printed beside it (5 x the sum of the rates).

Run by hand when NCHS publishes newer tables; the output is committed.

    python3 scripts/hna/fetch_colorado_vital_rates.py

Needs openpyxl, and pdftotext (poppler) to read the births report.
"""
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'data', 'hna', 'source', 'colorado_vital_rates.json')

# One workbook per table: <LIFE_TABLE_DIR>CO2.xlsx (males), CO3.xlsx (females).
LIFE_TABLE_DIR = 'https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/NVSR/73-07/'
LIFE_TABLE_REPORT = 'https://www.cdc.gov/nchs/data/nvsr/nvsr73/nvsr73-07.pdf'
BIRTHS_REPORT = 'https://www.cdc.gov/nchs/data/nvsr/nvsr74/nvsr74-1.pdf'
BIRTH_GROUPS = ['10-14', '15-19', '20-24', '25-29', '30-34', '35-39', '40-44', '45-49']


def _get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read()


def life_table(table):
    import openpyxl
    ws = openpyxl.load_workbook(io.BytesIO(_get(LIFE_TABLE_DIR + table + '.xlsx')), read_only=True).active
    rows = [r for r in ws.iter_rows(values_only=True) if r and isinstance(r[1], (int, float))]
    if len(rows) != 101:
        raise SystemExit(f'{table}: expected 101 ages (0 to 100+), found {len(rows)}')
    q = [float(r[1]) for r in rows[:100]]
    open_dx, open_lx = float(rows[100][3]), float(rows[100][4])
    q.append(open_dx / open_lx)
    return q


def colorado_birth_rates():
    with tempfile.TemporaryDirectory() as tmp:
        pdf = os.path.join(tmp, 'births.pdf')
        with open(pdf, 'wb') as f:
            f.write(_get(BIRTHS_REPORT))
        text = subprocess.run(['pdftotext', '-layout', pdf, '-'], check=True, capture_output=True, text=True).stdout
    start = text.index('Table 8. Birth rates, by age of mother')
    line = next(l for l in text[start:].splitlines() if l.strip().startswith('Colorado'))
    nums = [float(x.replace(',', '')) for x in re.findall(r'\d[\d,]*\.\d', line)]
    # Birth rate, fertility rate, TFR, 10-14, 15-19 total, 15-17, 18-19, 20-24 ... 45-49
    if len(nums) != 13:
        raise SystemExit(f'Colorado row did not parse into 13 figures: {line!r}')
    tfr = nums[2]
    rates = [nums[3], nums[4]] + nums[7:13]
    if abs(5 * sum(rates) - tfr) > 1.0:
        raise SystemExit(f'Colorado birth rates {rates} do not add to the printed TFR {tfr}')
    return dict(zip(BIRTH_GROUPS, rates)), tfr


def main():
    q_male = life_table('CO2')
    q_female = life_table('CO3')
    births, tfr = colorado_birth_rates()
    out = {
        'note': 'Age patterns only. The Scenario Builder scales them to SDO county totals of deaths and births each year.',
        'deaths': {
            'source': 'NCHS, U.S. State Life Tables, 2021, NVSR vol. 73 no. 7 (August 2024), Tables CO-2 and CO-3',
            'url': LIFE_TABLE_REPORT,
            'measure': 'qx, probability of dying between ages x and x+1, ages 0-99; age 100 holds the open interval 100+ as dx/Lx, an annual rate',
            'male': [round(v, 8) for v in q_male],
            'female': [round(v, 8) for v in q_female],
        },
        'births': {
            'source': 'NCHS, Births: Final Data for 2023, NVSR vol. 74 no. 1 (March 2025), Table 8, Colorado',
            'url': BIRTHS_REPORT,
            'measure': 'births per 1,000 women in each 5-year age group of mother, 2023',
            'per_1000_women': births,
            'total_fertility_rate_per_1000': tfr,
            'sex_ratio_at_birth': 1.05,
            'sex_ratio_source': 'conventional demographic value, about 105 boys per 100 girls',
        },
    }
    with open(OUT, 'w') as f:
        json.dump(out, f, indent=2)
        f.write('\n')
    print(f'wrote {os.path.relpath(OUT, ROOT)}: TFR {tfr}, q0 male {q_male[0]:.5f} female {q_female[0]:.5f}')


if __name__ == '__main__':
    sys.exit(main())
