#!/usr/bin/env python3
"""Build data/policy/state-housing-laws.json from DOLA's Multilaw Applicability sheet.

DOLA's Division of Local Government keeps one public sheet that says which
recent state housing and land use laws bind each of Colorado's 335 counties
and municipalities (linked from https://dlg.colorado.gov/housing-plans and
https://dlg.colorado.gov/transit-oriented-communities). This script copies
DOLA's own wording for each law and jurisdiction, keyed by Census GEOID, and
adds the SB24-174 housing needs assessments DOLA has approved
(data/policy/local-commitment.json, source "dola").

Usage:
  python3 scripts/policy/build_state_housing_laws.py
  python3 scripts/policy/build_state_housing_laws.py --from-file sheet.csv

It refuses to write when the sheet has fewer than 330 rows, when a column it
knows is missing, or when a jurisdiction name can't be matched to a GEOID, so a
changed sheet leaves the committed file as it was.
"""

import argparse
import csv
import io
import json
import os
import re
import sys
import urllib.request
from datetime import date

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUTPUT = os.path.join(ROOT, 'data', 'policy', 'state-housing-laws.json')
SHEET_ID = '1dGcQTZ9X_3CUipeQ1q15xZLFMtGvzFgwfWrGDSkYo04'
SHEET_URL = f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/edit'
CSV_URL = f'https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=csv'
MIN_ROWS = 330

# DOLA's column heading (first line) -> our entry. "plain" restates the law in
# one line; each is drawn from the sourced summaries already in
# data/policy/fee-reductions.json and data/policy/policy-watch.json, or, where
# the repo has none, is DOLA's own column label.
LAWS = [
    {'id': 'hb24-1152', 'col': 'HB24-1152', 'bill': 'HB24-1152', 'name': 'Accessory dwelling units',
     'plain': 'Accessory dwelling units must be allowed wherever single-family homes are allowed.',
     'url': 'https://leg.colorado.gov/bills/hb24-1152'},
    {'id': 'hb24-1304', 'col': 'HB24-1304', 'bill': 'HB24-1304', 'name': 'Minimum parking',
     'plain': 'No minimum parking for apartments and qualifying conversions in transit service areas (metro areas, since June 30, 2025).',
     'url': 'https://leg.colorado.gov/bills/hb24-1304'},
    {'id': 'hb24-1313', 'col': 'HB24-1313', 'bill': 'HB24-1313', 'name': 'Transit-oriented communities',
     'plain': 'Zone for more homes near transit: a housing opportunity goal of an average 40 homes an acre in transit areas.',
     'url': 'https://leg.colorado.gov/bills/hb24-1313'},
    {'id': 'hb24-1007', 'col': 'HB24-1007', 'bill': 'HB24-1007', 'name': 'Residential occupancy',
     'plain': 'No limit on how many people may live together based on family relationship; only health, safety or program limits.',
     'url': 'https://leg.colorado.gov/bills/hb24-1007'},
    {'id': 'sb24-174-hna', 'col': 'SB24-174 Housing Needs Assessment', 'bill': 'SB24-174', 'name': 'Housing needs assessment',
     'plain': 'A housing needs assessment that follows DOLA\'s method, sent to DOLA by December 31, 2026.',
     'url': 'https://dlg.colorado.gov/housing-plans'},
    {'id': 'sb24-174-hap', 'col': 'SB24-174 Housing Action Plan', 'bill': 'SB24-174', 'name': 'Housing action plan',
     'plain': 'A housing action plan built on the needs assessment.',
     'url': 'https://dlg.colorado.gov/housing-plans'},
    {'id': 'sb24-174-water', 'col': 'SB24-174 Water Supply Element', 'bill': 'SB24-174', 'name': 'Water supply element',
     'plain': 'A water supply element in the master plan.',
     'url': 'https://dlg.colorado.gov/housing-plans'},
    {'id': 'sb24-174-growth', 'col': 'SB24-174 Strategic Growth Element', 'bill': 'SB24-174', 'name': 'Strategic growth element',
     'plain': 'A strategic growth element in the master plan.',
     'url': 'https://dlg.colorado.gov/housing-plans'},
    {'id': 'hb26-1001', 'col': 'HB26-1001', 'bill': 'HB26-1001', 'name': 'Housing on qualifying properties',
     'plain': 'From December 31, 2027, housing on land owned by school districts, colleges, housing authorities, transit agencies and affordable housing nonprofits gets administrative approval.',
     'url': 'https://leg.colorado.gov/bills/hb26-1001'},
    {'id': 'hb25-1273', 'col': 'HB25-1273', 'bill': 'HB25-1273', 'name': 'Residential stair modernization',
     'plain': 'Residential stair modernization (building code).',
     'url': 'https://leg.colorado.gov/bills/hb25-1273'},
    {'id': 'sb25-002', 'col': 'SB25-002', 'bill': 'SB25-002', 'name': 'Factory-built structures',
     'plain': 'Factory-built structures (building code).',
     'url': 'https://leg.colorado.gov/bills/sb25-002'},
]

# Sheet spellings that differ from the Census name (after suffixes are dropped).
ALIASES = {
    'city and county of denver': 'denver', 'city and county of broomfield': 'broomfield',
    'central city': 'central', 'creede': 'city of creede',
    'mt. crested butte': 'mount crested butte', 'raymer': 'raymer (new raymer)',
}
# Incorporated after the 2024 Census Gazetteer, which still lists a CDP.
CDP_FALLBACK = {'keystone': '0840550'}


def read_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def norm(s):
    s = s.lower().replace('’', "'").strip()
    s = re.sub(r'\s+', ' ', s)
    return s


def place_key(census_name):
    n = norm(census_name)
    return re.sub(r' (city|town|city and county|cdp)$', '', n)


def load_geoids():
    counties, places = {}, {}
    b = read_json(os.path.join(ROOT, 'data', 'co-county-boundaries.json'))
    for f in b['features']:
        p = f['properties']
        counties[norm(p['NAMELSAD'])] = p.get('GEOID') or ('08' + p['COUNTY'])
    c = read_json(os.path.join(ROOT, 'data', 'co-place-centroids.json'))
    for geoid, p in c['byGeoid'].items():
        if p['name'].endswith(' CDP'):
            continue
        k = place_key(p['name'])
        if k in places and places[k] != geoid:
            sys.exit('two Census places share the name %r' % k)
        places[k] = geoid
    return counties, places


def read_sheet(path):
    if path:
        with open(path, encoding='utf-8') as f:
            text = f.read()
    else:
        req = urllib.request.Request(CSV_URL, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=60) as r:
            text = r.read().decode('utf-8')
    return list(csv.reader(io.StringIO(text)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--from-file')
    args = ap.parse_args()
    rows = read_sheet(args.from_file)
    head = [re.sub(r'\s+', ' ', h).strip() for h in rows[0]]
    body = [r for r in rows[1:] if r and r[0].strip()]
    if len(body) < MIN_ROWS:
        sys.exit('sheet has %d rows, expected at least %d' % (len(body), MIN_ROWS))
    cols = {}
    for law in LAWS:
        hits = [i for i, h in enumerate(head) if h.startswith(law['col'])]
        if len(hits) != 1:
            sys.exit('column %r not found exactly once in %r' % (law['col'], head))
        cols[law['id']] = hits[0]
    counties, places = load_geoids()
    hna = read_json(os.path.join(ROOT, 'data', 'policy', 'local-commitment.json'))
    dola_src = dict(hna['sources']['dola'], rechecked='2026-10-29')

    out, missing = {}, []
    for r in body:
        name = r[0].strip()
        n = norm(name)
        n = ALIASES.get(n, n)
        geoids = []
        if n.endswith(' county'):
            g = counties.get(n)
            if g:
                geoids.append(g)
        else:
            g = places.get(n) or CDP_FALLBACK.get(n)
            if g:
                geoids.append(g)
        if n in ('denver', 'broomfield'):
            geoids.append(counties[n + ' county'])
        if not geoids:
            missing.append(name)
            continue
        laws = {law['id']: r[cols[law['id']]].strip() for law in LAWS}
        for g in geoids:
            approved = [h for h in hna['hna'].get(g, []) if h.get('source') == 'dola' and h.get('dola_approved')]
            out[g] = {'name': name, 'laws': laws,
                      'hna_approved': [{'date': h['dola_approved'], 'title': h['title'], 'url': h['url']} for h in approved]}
    if missing:
        sys.exit('not matched to a GEOID: %s' % ', '.join(missing))

    doc = {
        'meta': {
            'source': "DOLA Division of Local Government, Multilaw Applicability sheet",
            'source_url': SHEET_URL,
            'linked_from': ['https://dlg.colorado.gov/housing-plans', 'https://dlg.colorado.gov/transit-oriented-communities'],
            'fetched': date.today().isoformat(),
            'review_by': None,
            'hna_approved_source': dola_src,
            'note': ("Which state housing and land use laws apply to each county and municipality, in DOLA's own "
                     "words. CDPs are unincorporated and follow their county. COHO doesn't decide whether a "
                     "jurisdiction complies; DOLA does. Built by scripts/policy/build_state_housing_laws.py."),
            'jurisdiction_count': len(body),
        },
        'laws': [{k: law[k] for k in ('id', 'bill', 'name', 'plain', 'url')} for law in LAWS],
        'jurisdictions': dict(sorted(out.items())),
    }
    y, m, d = map(int, doc['meta']['fetched'].split('-'))
    doc['meta']['review_by'] = date(y + (m == 12), m % 12 + 1, min(d, 28)).isoformat()
    with open(OUTPUT, 'w') as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print('wrote %s: %d sheet rows, %d GEOIDs, %d with a DOLA-approved HNA'
          % (os.path.relpath(OUTPUT, ROOT), len(body), len(out),
             sum(1 for v in out.values() if v['hna_approved'])))


if __name__ == '__main__':
    main()
