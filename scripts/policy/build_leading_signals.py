#!/usr/bin/env python3
"""Build data/policy/leading-signals.json: the dated public facts that usually
come before an affordable housing application, gathered per place and county.

Signals (each copied from a committed file that already cites its source):
  - land_banking: Prop 123 land banking awards in the place, with the status
    data/policy/prop123-land-banking-status.json gives each one. A banked site
    that is not yet financed is the plainest sign of a coming application.
  - prop123: the jurisdiction's first-cycle commitment, its fast-track policy,
    and its 2027-2029 filing (data/policy/prop123_jurisdictions.json, from DOLA).
  - hna: housing needs assessments named in data/policy/local-commitment.json.
  - local_funds: adopted local housing funds and taxes
    (data/policy/local-housing-funds.json).
  - ballot_2026: housing tax, housing finance and land use measures on the
    3 November 2026 ballot (data/policy/ballot-2026/), with their result once
    the county clerk publishes it. Until then the result is null and
    result_status says so.
  - pipeline: open projects in the development ledger
    (data/market/development-activity.json): letters of intent, applications
    awaiting a decision, and land-only funding.

Facts only. Nothing here is scored or weighted: the gated next-deal model reads
this file as one of its inputs, and the free site can show it as a list.

Usage: python3 scripts/policy/build_leading_signals.py [--out PATH]
"""
import glob
import json
import os
import re
import sys
import unicodedata
from datetime import date

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'data', 'policy', 'leading-signals.json')
P = lambda *a: os.path.join(ROOT, *a)

# City-and-county governments are one jurisdiction with two geoids; signals sit on both.
CONSOLIDATED = {'08031': '0820000', '08014': '0809280'}
TWIN = {**CONSOLIDATED, **{v: k for k, v in CONSOLIDATED.items()}}

BALLOT_RELEVANCE = {'housing_tax', 'housing_finance', 'land_use', 'homelessness'}
OPEN_STAGES = {'letter_of_intent': 'letter of intent', 'applied': 'application awaiting a decision',
               'land_funded': 'land funded, no construction funding yet'}


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def norm(name):
    s = unicodedata.normalize('NFKD', name or '')
    s = ''.join(c for c in s if not unicodedata.combining(c)).strip()
    for pat in (r'^City and County of\s+', r'^City of\s+', r'^Town of\s+', r'^Village of\s+'):
        s = re.sub(pat, '', s, flags=re.I)
    s = re.sub(r'\s*\((city|town|village|CDP)\)\s*$', '', s, flags=re.I)
    s = re.sub(r'\s+(city|town|village|CDP)$', '', s, flags=re.I)
    s = re.sub(r'\s+County$', '', s, flags=re.I)
    return s.strip().lower()


def main():
    out_path = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else OUT
    geo = load(P('data', 'hna', 'geo-config.json'))
    names = {}
    by_name = {'county': {}, 'place': {}}
    for c in geo.get('counties', []):
        names[c['geoid']] = {'name': c['label'], 'type': 'county'}
        by_name['county'][norm(c['label'])] = c['geoid']
    for key in ('places', 'cdps'):
        for p in geo.get(key, []):
            names[p['geoid']] = {'name': p['label'], 'type': 'place' if key == 'places' else 'cdp',
                                 'county': p.get('containingCounty')}
            if key == 'places':
                by_name['place'].setdefault(norm(p['label']), p['geoid'])

    out = {}
    unmatched = []

    def add(geoid, kind, row):
        for g in {geoid, TWIN.get(geoid, geoid)}:
            if g not in names:
                continue
            rec = out.setdefault(g, {'geoid': g, **names[g], 'signals': {}})
            rec['signals'].setdefault(kind, []).append(row)

    # Land banking awards with their status
    lb = load(P('data', 'policy', 'prop123-land-banking-awards.json'))
    st = load(P('data', 'policy', 'prop123-land-banking-status.json'))['status']
    for a in lb['awards']:
        s = st.get(a['id'], {})
        row = {'project': a.get('project'), 'sponsor': a.get('sponsor'), 'round': a.get('round'),
               'amount_awarded': a.get('amount_awarded'), 'estimated_units': a.get('estimated_units'),
               'purpose': a.get('purpose'), 'status': s.get('status'), 'status_text': s.get('text'),
               'financed': s.get('status') == 'financed', 'source_url': a.get('source_url')}
        for pl in a.get('places') or []:
            add(pl['geoid'], 'land_banking', row)

    # Prop 123 commitments, fast track, 2027-2029 filings
    p123 = load(P('data', 'policy', 'prop123_jurisdictions.json'))
    cycle2 = {norm(f['name']): f for f in (p123.get('next_cycle') or {}).get('filings', [])}
    c2_kind = {}
    for f in (p123.get('next_cycle') or {}).get('filings', []):
        c2_kind[norm(f['name'])] = 'county' if re.search(r'County$', f['name']) else 'place'
    seen_c2 = set()
    for j in p123['jurisdictions']:
        kind = 'county' if j.get('kind') == 'county' else 'place'
        g = by_name[kind].get(norm(j['name']))
        if not g:
            unmatched.append(('prop123', j['name']))
            continue
        f = cycle2.get(norm(j['name'])) if c2_kind.get(norm(j['name'])) == kind else None
        if f:
            seen_c2.add(norm(j['name']))
        add(g, 'prop123', {
            'status': j.get('status'), 'filing_date': j.get('filing_date'),
            'proposed_units': j.get('proposed_units'), 'fast_track': j.get('fast_track'),
            'fast_track_adopted': j.get('fast_track_adopted'),
            'cycle2_submitted': f.get('submitted') if f else None,
            'cycle2_unit_goal': f.get('unit_goal') if f else None,
            'source_url': j.get('source_url')})
    for k, f in cycle2.items():
        if k in seen_c2:
            continue
        g = by_name[c2_kind[k]].get(k)
        if not g:
            unmatched.append(('prop123-cycle2', f['name']))
            continue
        add(g, 'prop123', {'status': None, 'filing_date': None, 'proposed_units': None,
                           'fast_track': None, 'fast_track_adopted': None,
                           'cycle2_submitted': f.get('submitted'), 'cycle2_unit_goal': f.get('unit_goal'),
                           'source_url': p123.get('source_url')})

    # Housing needs assessments
    lc = load(P('data', 'policy', 'local-commitment.json'))
    for g, rows in (lc.get('hna') or {}).items():
        for r in rows:
            add(g, 'hna', {'kind': r.get('kind'), 'date': r.get('date'), 'title': r.get('title'),
                           'dola_approved': r.get('dola_approved'), 'url': r.get('url')})

    # Adopted local funds and taxes
    lf = load(P('data', 'policy', 'local-housing-funds.json'))
    for r in lf['entries']:
        if r.get('status') != 'adopted' or not r.get('geoid'):
            continue
        add(r['geoid'], 'local_funds', {'id': r.get('id'), 'tool': r.get('tool'), 'adopted': r.get('adopted'),
                                        'sunset': r.get('sunset'), 'rate_text': r.get('rate_text'),
                                        'voter_approved': r.get('voter_approved'),
                                        'summary': r.get('summary'),
                                        'source_url': (r.get('source') or {}).get('url')})

    # 3 November 2026 ballot measures
    ballot_files = sorted(glob.glob(P('data', 'policy', 'ballot-2026', 'counties', '*.json')))
    for path in ballot_files:
        for e in load(path).get('entries', []):
            rel = set(e['measure'].get('relevance') or [])
            if not rel & BALLOT_RELEVANCE:
                continue
            res = e.get('result') or None
            add(e['jurisdiction']['geoid'], 'ballot_2026', {
                'id': e['id'], 'measure': e['measure'].get('number'), 'title': e.get('neutral_title'),
                'relevance': sorted(rel), 'mechanism': e['measure'].get('fiscal', {}).get('mechanism'),
                'election_date': e['election']['date'],
                'result': res.get('outcome') if isinstance(res, dict) else None,
                'result_status': (res.get('status') if isinstance(res, dict) else None)
                                 or 'awaiting the county clerk\'s published results',
                'result_source': res.get('source_url') if isinstance(res, dict) else None,
                'source_url': ((e.get('sources') or {}).get('ballot_notice') or {}).get('url')})

    # Open pipeline projects
    da = load(P('data', 'market', 'development-activity.json'))
    for pr in da['projects']:
        if pr.get('stage') not in OPEN_STAGES or not pr.get('place_geoid'):
            continue
        last = (pr.get('events') or [{}])[-1]
        add(pr['place_geoid'], 'pipeline', {
            'project': pr.get('name'), 'stage': pr['stage'], 'stage_label': OPEN_STAGES[pr['stage']],
            'latest_year': pr.get('latest_year'), 'restricted_units': pr.get('restricted_units'),
            'agency': last.get('agency'), 'program': last.get('program'), 'source_url': last.get('source_url')})

    places = dict(sorted(out.items()))
    for rec in places.values():
        s = rec['signals']
        rec['counts'] = {k: len(v) for k, v in sorted(s.items())}
        rec['land_banked_not_financed'] = sum(1 for r in s.get('land_banking', []) if not r['financed'])

    meta = {
        'title': 'Leading signals: dated public facts that usually come before an affordable housing application',
        'generator': 'scripts/policy/build_leading_signals.py',
        'generated': date.today().isoformat(),
        'inputs': ['data/policy/prop123-land-banking-awards.json', 'data/policy/prop123-land-banking-status.json',
                   'data/policy/prop123_jurisdictions.json', 'data/policy/local-commitment.json',
                   'data/policy/local-housing-funds.json', 'data/policy/ballot-2026/counties/*.json',
                   'data/market/development-activity.json', 'data/hna/geo-config.json'],
        'not_scored': 'Facts only. No signal is weighted or added to another.',
        'ballot_note': 'Results for the 3 November 2026 measures are null until the county clerk publishes them; '
                       'unofficial results are labelled unofficial until certification.',
        'geographies': len(places),
        'unmatched': sorted(set(n for _, n in unmatched)),
    }
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump({'meta': meta, 'places': places}, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print(f'leading signals: {len(places)} geographies, {len(meta["unmatched"])} unmatched names -> '
          f'{out_path}')


if __name__ == '__main__':
    sys.exit(main())
