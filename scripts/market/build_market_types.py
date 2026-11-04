#!/usr/bin/env python3
"""Market types and a Colorado strategy menu for every county, town and CDP.

Reads (all public, all already in this repo):
  data/market/market-direction.json   the market call, household growth, rent edge
  data/hna/second-homes-str.json      ACS seasonal homes share and its margin of error
  data/market/commute-strength.json   LODES jobs, residents and in-commuters
  data/hna/ranking-index.json         population
  data/policy/co-developer-funding-guide.json, incentive-alternatives.json,
  homeownership-programs.json, fee-reductions.json, local-housing-funds.json,
  prop123_jurisdictions.json, data/resort-workforce-housing-programs.json
                                      the menu items, each with its own source link

Writes data/market/market-types.json.

A type is a written rule, not a cluster label, so anyone can see why a place got
it. The rules run in order and the first one that holds names the type:
  1 Resort and second-home   seasonal homes are 20% or more of all homes, or the
                             market call is "second-home shift"
  2 Job centre               2,000+ jobs and 1.3+ jobs per working resident
  3 Fast-growing             household population up 2%+ a year, or the call is "emerging"
  4 Softening or shrinking   the call is "softening" or "falling demand", or
                             household population is down 0.5%+ a year
  5 Steady                   none of the above
  6 Too little data          no market call and no household reading
Three conditions change the menu without changing the type: no rent edge
(the county 2-bedroom FMR is at or below the CHFA 60% rent), a small place
(under 5,000 people) and no filed Prop 123 commitment.

Checks written into the file (meta.validation):
  - stability: the seasonal share is redrawn 500 times from its ACS margin of
    error, and the share of draws in which the place keeps its type is recorded;
  - near the line: which rule thresholds a place sits close to;
  - a cluster check: k-means on the same readings, to show how far the written
    rules agree with groups found without them.
Menu items are our reading of what tends to fit a type. Each one names a
program or tool from a cited record and carries that record's link.
"""
import argparse
import json
import math
import os
import re
import sys

import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'data', 'market', 'market-types.json')

RULES = {
    'seasonal_share': 0.20,
    'job_centre_jobs': 2000,
    'job_centre_ratio': 1.3,
    'growing_pct': 2.0,
    'shrinking_pct': -0.5,
    'small_population': 5000,
}
NEAR = {'seasonal_share': 0.03, 'job_centre_ratio': 0.1, 'growing_pct': 0.3, 'shrinking_pct': 0.3}

TYPES = {
    'resort': {
        'label': 'Resort and second-home',
        'rule': 'Seasonal homes are 20% or more of all homes (ACS), or the market call is "second-home shift".',
        'plain': 'Many homes sit empty part of the year, so workers compete with buyers who do not live here.',
    },
    'job_centre': {
        'label': 'Job centre',
        'rule': '2,000 or more jobs and at least 1.3 jobs for every working resident (LODES).',
        'plain': 'More people come in to work than live here, so the need reaches workers who live elsewhere.',
    },
    'growing': {
        'label': 'Fast-growing',
        'rule': 'Household population up 2% or more a year, or the market call is "emerging".',
        'plain': 'Households are arriving quickly, so land and approvals are the pinch points.',
    },
    'softening': {
        'label': 'Softening or shrinking',
        'rule': 'The market call is "softening" or "falling demand", or household population is down 0.5% or more a year.',
        'plain': 'Prices, permits or people are slipping, so keeping and fixing existing homes goes further than building.',
    },
    'steady': {
        'label': 'Steady',
        'rule': 'None of the rules above holds.',
        'plain': 'No strong push either way, so a standard tax credit deal sized to local need is the usual route.',
    },
    'too_little_data': {
        'label': 'Too little data',
        'rule': 'No market call and no household population reading.',
        'plain': 'Public data is too thin to type this place. The county type is shown instead.',
    },
}
ORDER = ['resort', 'job_centre', 'growing', 'softening', 'steady', 'too_little_data']

# Each menu item: (source file key, record id, why it fits, in our words).
MENU = {
    'resort': [
        ('ia', 'shared_equity_deed_restriction', 'Buying deed restrictions on existing homes keeps them for local workers without new land.'),
        ('ia', 'lodging_or_str_tax', 'Visitors and short-term rentals can help pay for worker housing, with voter approval.'),
        ('ia', 'land_bank_public_land', 'Land is the scarce input here, so public and banked land does the most.'),
        ('fg', 'prop123-ahff-land-banking', 'Prop 123 money can buy land now for homes built later.'),
        ('fg', 'chfa-mihtc', 'Workers here often earn too much for 60% rents and too little for market rents.'),
        ('ia', 'vacancy_or_second_home_tax', 'Often raised in resort towns. Colorado authority is unclear: read the status first.'),
    ],
    'job_centre': [
        ('ia', 'inclusionary_zoning_rental', 'New market-rate building is steady here, so a share of it can be affordable.'),
        ('ia', 'linkage_fee', 'Employers drive the need. Colorado authority for commercial linkage is unclear: read the status first.'),
        ('fg', 'chfa-federal-4pct-lihtc-pab', 'Larger sites and deeper markets can carry a bond deal of 100+ homes.'),
        ('fg', 'chfa-colorado-state-ahtc', 'The state credit closes much of the gap on a 4% bond deal.'),
        ('ia', 'density_bonus', 'More homes on the same site lowers the land cost per home.'),
        ('ia', 'parking_reduction', 'Parking is a large cost per home where land is dear and transit is near.'),
    ],
    'growing': [
        ('ia', 'land_bank_public_land', 'Buying land ahead of growth fixes its price before it rises.'),
        ('fg', 'prop123-ahff-land-banking', 'Prop 123 money can buy land now for homes built later.'),
        ('ia', 'inclusionary_zoning_rental', 'Much new building is coming, so a share of it can be affordable.'),
        ('ia', 'expedited_review', 'Prop 123 fast-track cuts time, and time is money on a growing market.'),
        ('fg', 'chfa-federal-4pct-lihtc-pab', 'Growth supports larger rental deals that carry bond financing.'),
        ('ho', 'chfa-dpa-grant', 'First-time buyers can still get in while prices are rising.'),
    ],
    'softening': [
        ('fg', 'chfa-cahp-preservation-fund', 'Buying existing rentals while prices soften keeps them affordable for less than building.'),
        ('fg', 'freddie-mac-tah', 'Debt for buying and fixing existing affordable rentals.'),
        ('fg', 'hud-223f', 'Debt to buy or refinance existing apartments.'),
        ('fg', 'doh-cdbg-housing', 'State money for buying and fixing homes outside the large cities.'),
        ('ho', 'colorado-wap-weatherization', 'Repairs lower the cost of living in homes people already have.'),
        ('ia', 'community_land_trust', 'Homes bought while prices are low can stay affordable for good.'),
    ],
    'steady': [
        ('fg', 'chfa-federal-9pct-lihtc', 'The 9% credit is the usual route for a 30-60 home rental sized to local need.'),
        ('fg', 'doh-housing-development-grant', 'State gap money that most tax credit deals in Colorado carry.'),
        ('ia', 'fee_waiver_reduction', 'Waived fees lower the cost of every home a local deal builds.'),
        ('ia', 'land_bank_public_land', 'Public land is often the largest local contribution a town can make.'),
        ('ho', 'chfa-dpa-grant', 'Helps local renters buy where prices are steady.'),
    ],
    'too_little_data': [],
}
MODIFIER_MENU = {
    'no_rent_edge': {
        'label': 'No rent edge',
        'rule': 'The county 2-bedroom FMR is at or below the CHFA 60% AMI rent, so a 60% rent is no cheaper than market.',
        'items': [
            ('fg', 'hud-pbv', 'Rental assistance lets homes reach households well below 60% AMI.'),
            ('fg', 'doh-national-housing-trust-fund', 'Pays for homes at 30% AMI, where the real gap is.'),
            ('fg', 'prop123-dola-affordable-homeownership', 'Ownership can be the better buy where rents already sit near the limit.'),
        ],
    },
    'small_place': {
        'label': 'Small place',
        'rule': 'Under 5,000 people.',
        'items': [
            ('fg', 'chfa-small-scale-perm-loan', 'Built for rentals of 5 to 19 homes.'),
            ('fg', 'usda-515', 'Rural rental loans. Check the USDA eligibility map for the site.'),
            ('fg', 'doh-home', 'State HOME money for places outside the large cities.'),
        ],
    },
    'no_prop123': {
        'label': 'No Prop 123 commitment',
        'rule': 'No filed Prop 123 commitment on the DOLA list for this town (or, for a county or CDP, this county).',
        'items': [
            ('fg', 'prop123-ahff-lihtc-gap', 'Needs a filed commitment. Filing one opens this and DOLA homeownership grants.'),
        ],
    },
}


def load(*parts):
    with open(os.path.join(ROOT, *parts), encoding='utf-8') as f:
        return json.load(f)


def norm(name):
    s = (name or '').strip()
    for pat in (r'^City and County of\s+', r'^City of\s+', r'^Town of\s+'):
        s = re.sub(pat, '', s, flags=re.I)
    s = re.sub(r'\s*\((city|town|CDP)\)\s*$', '', s, flags=re.I)
    s = re.sub(r'\s+County$', '', s, flags=re.I)
    return s.strip().lower()


def first_quote(evidence):
    for e in evidence or []:
        q = e.get('quote') if isinstance(e, dict) else None
        if q:
            return q
    return None


def build_catalog():
    fg = {p['id']: p for p in load('data', 'policy', 'co-developer-funding-guide.json')['programs']}
    ia = {t['id']: t for t in load('data', 'policy', 'incentive-alternatives.json')['tools']}
    ho = {p['id']: p for p in load('data', 'policy', 'homeownership-programs.json')['programs']}
    fr_basis = {b['id']: b for b in load('data', 'policy', 'fee-reductions.json')['meta'].get('legal_basis', [])}
    cat = {}

    def add(src, rid):
        key = f'{src}:{rid}'
        if key in cat:
            return key
        if src == 'fg':
            p = fg[rid]
            q = first_quote(p.get('evidence'))
            cat[key] = {'name': p['name'], 'kind': 'funding', 'status': p.get('status'),
                        'what': p.get('what_it_funds'), 'url': p['official_url'],
                        'quote': q, 'record': f'data/policy/co-developer-funding-guide.json#{rid}'}
        elif src == 'ia':
            t = ia[rid]
            url = None
            quote = None
            for lb in t.get('legal_basis') or []:
                url = url or (lb.get('source') or {}).get('url')
                quote = quote or first_quote(lb.get('evidence'))
            for bid in t.get('reuse_legal_basis_ids') or []:
                b = fr_basis.get(bid) or {}
                url = url or (b.get('source') or {}).get('url') or b.get('url')
                quote = quote or first_quote(b.get('evidence'))
            cat[key] = {'name': t['label'], 'kind': 'local tool', 'status': t.get('colorado_status'),
                        'status_reason': t.get('status_reason'), 'what': t.get('what_it_is'), 'url': url,
                        'quote': quote, 'record': f'data/policy/incentive-alternatives.json#{rid}'}
        elif src == 'ho':
            p = ho[rid]
            cat[key] = {'name': p['name'], 'kind': 'ownership', 'status': p.get('status'),
                        'what': p.get('plain_summary'), 'url': p['source_url'], 'quote': p.get('source_note'),
                        'record': f'data/policy/homeownership-programs.json#{rid}'}
        else:
            raise KeyError(src)
        return key

    menus = {}
    for t, items in MENU.items():
        menus[t] = [{'item': add(s, r), 'why': w} for s, r, w in items]
    mods = {}
    for m, spec in MODIFIER_MENU.items():
        mods[m] = {'label': spec['label'], 'rule': spec['rule'],
                   'items': [{'item': add(s, r), 'why': w} for s, r, w in spec['items']]}
    for k, v in cat.items():
        if not v['url']:
            raise SystemExit(f'menu item {k} has no source link')
    return cat, menus, mods


def type_of(seasonal, call, jobs, residents, growth):
    if (seasonal is not None and seasonal >= RULES['seasonal_share']) or call == 'second_home_shift':
        return 'resort'
    if jobs and residents and jobs >= RULES['job_centre_jobs'] and jobs / residents >= RULES['job_centre_ratio']:
        return 'job_centre'
    if call == 'emerging' or (growth is not None and growth >= RULES['growing_pct']):
        return 'growing'
    if call in ('softening', 'falling_demand') or (growth is not None and growth <= RULES['shrinking_pct']):
        return 'softening'
    if call in (None, 'not_enough_data') and growth is None:
        return 'too_little_data'
    return 'steady'


def basis(t, seasonal, call, jobs, residents, growth):
    pct = lambda v: f'{v * 100:.0f}%'
    if t == 'resort':
        if seasonal is not None and seasonal >= RULES['seasonal_share']:
            return f'Seasonal homes are {pct(seasonal)} of all homes.'
        return 'The market call is "second-home shift".'
    if t == 'job_centre':
        return f'{jobs:,} jobs and {jobs / residents:.1f} jobs per working resident.'
    if t == 'growing':
        if growth is not None and growth >= RULES['growing_pct']:
            return f'Household population up {growth:.1f}% a year.'
        return 'The market call is "emerging".'
    if t == 'softening':
        if call in ('softening', 'falling_demand'):
            return 'The market call is "' + call.replace('_', ' ') + '".'
        return f'Household population down {abs(growth):.1f}% a year.'
    if t == 'too_little_data':
        return 'No market call and no household population reading.'
    return 'No rule above holds.'


def near_line(seasonal, jobs, residents, growth):
    out = []
    if seasonal is not None and abs(seasonal - RULES['seasonal_share']) <= NEAR['seasonal_share']:
        out.append('seasonal share')
    if jobs and residents and jobs >= RULES['job_centre_jobs'] and abs(jobs / residents - RULES['job_centre_ratio']) <= NEAR['job_centre_ratio']:
        out.append('jobs per resident')
    if growth is not None and (abs(growth - RULES['growing_pct']) <= NEAR['growing_pct'] or abs(growth - RULES['shrinking_pct']) <= NEAR['shrinking_pct']):
        out.append('household growth')
    return out


def kmeans(X, k, rng, iters=100):
    c = X[rng.choice(len(X), k, replace=False)]
    for _ in range(iters):
        lab = ((X[:, None, :] - c[None]) ** 2).sum(-1).argmin(1)
        new = np.array([X[lab == j].mean(0) if (lab == j).any() else c[j] for j in range(k)])
        if np.allclose(new, c):
            break
        c = new
    return lab, ((X - c[lab]) ** 2).sum()


def adjusted_rand(a, b):
    from collections import Counter
    n = len(a)
    comb = lambda x: x * (x - 1) / 2
    nij = Counter(zip(a, b))
    ai, bj = Counter(a), Counter(b)
    s = sum(comb(v) for v in nij.values())
    sa, sb = sum(comb(v) for v in ai.values()), sum(comb(v) for v in bj.values())
    exp = sa * sb / comb(n)
    mx = (sa + sb) / 2
    return (s - exp) / (mx - exp) if mx != exp else 1.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()

    md = load('data', 'market', 'market-direction.json')
    sh = load('data', 'hna', 'second-homes-str.json')['geographies']
    cs = load('data', 'market', 'commute-strength.json')
    ri = {r['geoid']: r for r in load('data', 'hna', 'ranking-index.json')['rankings']}
    p123 = load('data', 'policy', 'prop123_jurisdictions.json')
    # A filed commitment shows as "Committed" or, once its first cycle is done, "Commitment Met".
    filed = [j for j in p123['jurisdictions'] if (j.get('status') or '').lower() in ('committed', 'commitment met')]
    committed = {norm(j['name']) + '|' + j.get('kind', '') for j in filed}
    # City and County of Denver and of Broomfield file as counties; their city record takes that filing.
    committed |= {norm(j['name']) + '|municipality' for j in filed if re.match(r'City and County of', j['name'], re.I)}
    funds = load('data', 'policy', 'local-housing-funds.json')['entries']
    resort = load('data', 'resort-workforce-housing-programs.json')['authorities']
    fg = {p['id']: p for p in load('data', 'policy', 'co-developer-funding-guide.json')['programs']}
    cat, menus, mods = build_catalog()

    def local_here(geoid, county_fips, level):
        here = []
        for f in funds:
            if f.get('status') != 'adopted':
                continue
            if f.get('geoid') == geoid or (level != 'county' and f.get('geoid') == county_fips):
                url = (f.get('source') or {}).get('url') if isinstance(f.get('source'), dict) else f.get('source_url')
                here.append({'name': f.get('jurisdiction') + ': ' + (f.get('rate_text') or f.get('tool', '').replace('_', ' ')),
                             'kind': 'local fund', 'url': url, 'record': f'data/policy/local-housing-funds.json#{f["id"]}'})
        for a in resort:
            if geoid in (a.get('serves_place_geoids') or []) or (level == 'county' and a.get('county_fips') == geoid):
                here.append({'name': a['name'], 'kind': 'housing authority', 'url': a.get('url'),
                             'programs': len(a.get('key_programs') or []),
                             'record': f'data/resort-workforce-housing-programs.json#{a["id"]}'})
        for p in fg.values():
            g = p['fit']['geography']
            if g.get('scope') == 'local' and (geoid in (g.get('places') or []) or (level == 'county' and geoid in (g.get('counties') or []))):
                here.append({'name': p['name'], 'kind': 'local fund', 'url': p['official_url'],
                             'record': f'data/policy/co-developer-funding-guide.json#{p["id"]}'})
        seen, out = set(), []
        for h in here:
            if h['record'] not in seen and h['url']:
                seen.add(h['record'])
                out.append(h)
        return out

    rows = []
    for geoid, c in md['counties'].items():
        s = (sh.get(geoid) or {}).get('seasonal_homes') or {}
        cm = cs['counties'].get(geoid) or {}
        pop_sig = (c.get('signals') or {}).get('population') or {}
        rows.append({'geoid': geoid, 'name': c['name'], 'level': 'county', 'county_fips': geoid,
                     'call': c.get('call'), 'growth': pop_sig.get('value'),
                     'seasonal': s.get('share_of_housing_units'), 'seasonal_moe': s.get('share_moe'),
                     'jobs': cm.get('jobs'), 'residents': cm.get('residents'),
                     'population': (ri.get(geoid) or {}).get('metrics', {}).get('population'),
                     'rent_edge': (c.get('rent_edge') or {}).get('reading'),
                     'prop123': (norm(c['name']) + '|county') in committed})
    for geoid, p in md['places'].items():
        s = (sh.get(geoid) or {}).get('seasonal_homes') or {}
        cm = cs['places'].get(geoid) or {}
        cty = md['counties'][p['county_fips']]
        pop_sig = (p.get('signals') or {}).get('population') or {}
        kind = 'municipality' if p['type'] == 'town' else 'cdp'
        rows.append({'geoid': geoid, 'name': p['name'], 'level': 'town' if p['type'] == 'town' else 'cdp',
                     'county_fips': p['county_fips'], 'county': cty['name'],
                     'call': p.get('call'), 'growth': pop_sig.get('value'),
                     'seasonal': s.get('share_of_housing_units'), 'seasonal_moe': s.get('share_moe'),
                     'jobs': cm.get('jobs'), 'residents': cm.get('residents'),
                     'population': (ri.get(geoid) or {}).get('metrics', {}).get('population'),
                     'rent_edge': (cty.get('rent_edge') or {}).get('reading'),
                     'prop123': ((norm(p['name']) + '|municipality') in committed) if kind == 'municipality'
                     else ((norm(cty['name']) + '|county') in committed)})

    rng = np.random.RandomState(20261104)
    out_rows = {}
    for r in rows:
        args_ = (r['seasonal'], r['call'], r['jobs'], r['residents'], r['growth'])
        t = type_of(*args_)
        draws = 500
        keep = draws
        if r['seasonal'] is not None and r['seasonal_moe']:
            se = r['seasonal_moe'] / 1.645
            sims = r['seasonal'] + se * rng.standard_normal(draws)
            keep = sum(type_of(max(0.0, v), *args_[1:]) == t for v in sims)
        mods_on = []
        if r['rent_edge'] == 'no_edge':
            mods_on.append('no_rent_edge')
        if r['level'] != 'county' and r['population'] is not None and r['population'] < RULES['small_population']:
            mods_on.append('small_place')
        if not r['prop123']:
            mods_on.append('no_prop123')
        rec = {'name': r['name'], 'level': r['level'], 'type': t,
               'basis': basis(t, *args_), 'stability': round(keep / draws, 3),
               'near_line': near_line(r['seasonal'], r['jobs'], r['residents'], r['growth']),
               'modifiers': mods_on,
               'readings': {'seasonal_share': r['seasonal'], 'seasonal_moe': r['seasonal_moe'],
                            'jobs': r['jobs'], 'working_residents': r['residents'],
                            'household_growth_pct': r['growth'], 'call': r['call'],
                            'rent_edge': r['rent_edge'], 'population': r['population'],
                            'prop123_committed': r['prop123']},
               'here_now': local_here(r['geoid'], r['county_fips'], r['level'])}
        if r['level'] != 'county':
            rec['county_fips'] = r['county_fips']
            rec['county'] = r['county']
        out_rows[r['geoid']] = rec

    # Cluster check: do the written rules sit near groups found without them?
    feat_rows = [r for r in rows if r['seasonal'] is not None and r['jobs'] and r['residents'] and r['growth'] is not None]
    X = np.array([[math.log1p(r['seasonal'] * 100), math.log(r['jobs'] / r['residents']), r['growth']] for r in feat_rows])
    X = (X - X.mean(0)) / X.std(0)
    X[:, 2] = np.clip(X[:, 2], -3, 3)
    best = None
    for _ in range(20):
        lab, inertia = kmeans(X, 5, rng)
        if best is None or inertia < best[1]:
            best = (lab, inertia)
    rule_lab = [out_rows[r['geoid']]['type'] for r in feat_rows]
    ari = adjusted_rand(rule_lab, list(best[0]))

    counts = {t: {'county': 0, 'town': 0, 'cdp': 0} for t in ORDER}
    for v in out_rows.values():
        counts[v['type']][v['level']] += 1
    stable = [v['stability'] for v in out_rows.values() if v['type'] != 'too_little_data']
    stamp = md['meta'].get('generated_at')
    out = {
        'meta': {
            'title': 'Colorado market types and a strategy menu',
            'generator': 'scripts/market/build_market_types.py',
            'generated_at': stamp,
            'generated_at_note': 'the market-direction stamp this was built from, not the time this ran',
            'sources': ['data/market/market-direction.json', 'data/hna/second-homes-str.json',
                        'data/market/commute-strength.json', 'data/hna/ranking-index.json',
                        'data/policy/co-developer-funding-guide.json', 'data/policy/incentive-alternatives.json',
                        'data/policy/homeownership-programs.json', 'data/policy/fee-reductions.json',
                        'data/policy/local-housing-funds.json', 'data/policy/prop123_jurisdictions.json',
                        'data/resort-workforce-housing-programs.json'],
            'types': {t: TYPES[t] for t in ORDER},
            'order': ORDER,
            'rules': RULES,
            'menus': menus,
            'modifiers': mods,
            'items': cat,
            'counts': counts,
            'menu_note': 'Menu items are our reading of what tends to fit each type, not advice for any one site. '
                         'Each names a program or tool from a cited record; check its own terms before relying on it.',
            'validation': {
                'stability': 'Share of 500 redraws of the ACS seasonal share (from its margin of error) in which a '
                             'place keeps its type.',
                'stable_80_share': round(sum(1 for s in stable if s >= 0.8) / len(stable), 3),
                'typed_places': len(stable),
                'cluster_check': {'method': 'k-means, 5 groups, 20 starts, on standardised seasonal share (log), '
                                            'jobs per working resident (log) and household growth',
                                  'places': len(feat_rows), 'adjusted_rand': round(ari, 3),
                                  'reading': 'Agreement between the written types and groups found without them '
                                             '(0 is chance, 1 is the same grouping).'},
            },
            'limits': [
                'Rent edge is read at the county: town rents are thin outside the larger cities.',
                'Jobs and residents are LODES primary jobs for 2023, inside Colorado only.',
                'Seasonal homes are ACS 5-year estimates; small places carry wide margins (see stability).',
                'A type describes the market, not the right answer for a site.',
            ],
        },
        'places': out_rows,
    }
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print(f'market-types: {len(out_rows)} geographies; '
          + ', '.join(f'{t} {sum(counts[t].values())}' for t in ORDER)
          + f'; stable>=80% {out["meta"]["validation"]["stable_80_share"]}; ARI {ari:.2f}', file=sys.stderr)


if __name__ == '__main__':
    main()
