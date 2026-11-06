#!/usr/bin/env python3
"""Build data/market/public-employers.json: staff headcount of every Colorado school district and BOCES, by county.

Why: the largest-employer lists we can publish cover about a third of counties. CDLE's "Largest Employers"
(LMI Gateway) is licensed from Data Axle and its terms bar copying or reuse on another site, so we do not use it.
School districts are among the biggest employers in most rural counties, and the state publishes their staff
counts every year, so every county gets at least this, dated and sourced.

Sources (both public, no key):
  CDE, "Personnel Turnover Rate by District and Position Categories (2025-2026 compared with 2024-2025)",
      row "All Job Categories": headcount of people employed, 2024-25 and 2025-26.
      https://ed.cde.state.co.us/cdereval/staffstatistics
  NCES Common Core of Data, LEA directory (via the Urban Institute Education Data API): the county of each
      district's office, joined on the state LEA code (CO-XXXX).
      https://educationdata.urban.org/api/v1/school-districts/ccd/directory/2023/?fips=8

A district that crosses a county line is listed once, under the county of its office. Counts are district-wide.
Usage: python3 scripts/build_public_employers.py   (writes data/market/public-employers.json)
"""
import io
import json
import os
import sys
import urllib.request
from datetime import date

import openpyxl

CDE_URL = 'https://ed.cde.state.co.us/fs/resource-manager/view/815995cd-d18c-466d-8694-c3673ac524c1'
CDE_PAGE = 'https://ed.cde.state.co.us/cdereval/staffstatistics'
NCES_URL = 'https://educationdata.urban.org/api/v1/school-districts/ccd/directory/2023/?fips=8'
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'market', 'public-employers.json')
# The Charter School Institute's staff work in schools all over the state; its office county says nothing.
SKIP = {'8001'}


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'coho-analytics-data-build'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def main():
    wb = openpyxl.load_workbook(io.BytesIO(get(CDE_URL)), read_only=True, data_only=True)
    ws = wb['LEA Level']
    rows = list(ws.iter_rows(values_only=True))
    title = rows[1][0]
    head = rows[2]
    assert 'All Job Categories' in {r[2] for r in rows[3:] if r and len(r) > 2}, 'CDE file changed: no All Job Categories row'
    y_prev, y_now = head[4].replace(' Headcount', ''), head[5].replace(' Headcount', '')
    staff = {}
    for r in rows[3:]:
        if not r or r[0] is None or r[2] != 'All Job Categories':
            continue
        code = str(r[0]).replace(' Total', '').strip()
        if not code.isdigit():
            continue
        code = code.zfill(4)
        staff[code] = {'employer': r[1], 'lea_code': code, 'headcount': r[5], 'headcount_prior': r[4]}

    nces = json.loads(get(NCES_URL))['results']
    county = {}
    for d in nces:
        sl = str(d.get('state_leaid') or '').replace('CO-', '')
        if sl and d.get('county_code'):
            county[sl] = (str(d['county_code']).zfill(5), d.get('county_name'))

    by_county, unplaced = {}, []
    for code, s in staff.items():
        if code in SKIP:
            continue
        if code not in county or not county[code][0].startswith('08'):
            unplaced.append(s['employer'])
            continue
        if not s['headcount']:
            continue
        by_county.setdefault(county[code][0], []).append(s)
    for f in by_county:
        by_county[f].sort(key=lambda s: -s['headcount'])

    out = {
        'meta': {
            'title': 'School district and BOCES staff, by county',
            'what': 'People employed by each public school district and BOCES (headcount, all job categories, '
                    'full- and part-time), listed under the county of the district office. Counts are district-wide.',
            'as_of': y_now,
            'prior': y_prev,
            'source': {'label': 'Colorado Department of Education, ' + title, 'url': CDE_PAGE, 'file': CDE_URL},
            'county_source': {'label': 'NCES Common Core of Data, LEA directory 2023-24 (district office county)', 'url': NCES_URL},
            'not_a_ranking': 'This is not a list of the largest employers. It names one kind of employer that every '
                             'county has and whose staff counts are published.',
            'not_used': 'CDLE LMI Gateway "Largest Employers" is licensed from Data Axle; its terms of use bar copying '
                        'or republishing, so it is not used (terms read 2026-11-06).',
            'skipped': ['Charter School Institute (statewide, office county is not where its staff work)'],
            'unplaced': sorted(unplaced),
            'built': date.today().isoformat(),
            'script': 'scripts/build_public_employers.py',
        },
        'counties': dict(sorted(by_county.items())),
    }
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    print('public-employers: %d counties, %d districts, %d unplaced' % (len(by_county), sum(len(v) for v in by_county.values()), len(unplaced)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
