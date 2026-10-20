"""
scripts/funding/build_round_watch.py — which deals are likely to apply in the
next CHFA housing tax credit rounds, and why.

Reads only files the repo already builds:

  data/jurisdiction-briefs/_lihtc-applications.json  CHFA Applicant Reports,
      funded and not, with derived outcomes (build_lihtc_applications.py)
  data/market/development-activity.json  one row per project across CHFA,
      OEDIT Prop 123 and DOLA awards (build_development_activity.py)

From 2023 to 2026 every Round One applicant asked for 9% credits and every
Round Two applicant for 4% plus state credits, so each round is scored on its
own credit type. A project scores points for public evidence that it is
still looking for credits:

  not funded in the same round type a year earlier       50
  not funded in an older round of the same type          10
  DOLA or Prop 123 rental money in the last two calendar
    years, size suits this round (70+ homes = 4%)        25
  the same, size suits the other round (or not printed)  10
  not funded in the other round type                     10
  sponsor applied in 2+ of the last 4 rounds              5
  Prop 123 land banking award                             5

State money counts only for projects of 15+ homes (the smallest round
application 2023-2026) that are not mobile home parks.

High 50+, Medium 25-49, Watch 10-24. A project leaves the list once CHFA
awards it credit, and while an application of its is still undecided.

The same rules are backtested on every past round with two earlier rounds of
its type: score each project as it stood the day the round's applicant
report came out, using only what was public then, and count who applied.
Those counts are the rates each "why" line quotes, and the page's
how-well-it-works table.

No contact columns are read and none are written: the contacts for each
project live only in the private developer site (coho-backend, gated/).
The owner's excluded project (_lihtc-applications-excluded.json) is dropped.

Writes data/jurisdiction-briefs/_round-watch.json (developer-gated: the
public build leaves the folder out). No network, no clock: the output
depends only on the inputs.

Usage:
  python3 scripts/funding/build_round_watch.py          # write
  python3 scripts/funding/build_round_watch.py --check  # build, compare, write nothing
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
_spec = importlib.util.spec_from_file_location(
    'build_development_activity', os.path.join(ROOT, 'scripts', 'market', 'build_development_activity.py'))
dev = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(dev)
apps_mod = dev.apps_mod

APPLICATIONS = os.path.join(ROOT, 'data', 'jurisdiction-briefs', '_lihtc-applications.json')
EXCLUDED = os.path.join(ROOT, 'data', 'jurisdiction-briefs', '_lihtc-applications-excluded.json')
LEDGER = os.path.join(ROOT, 'data', 'market', 'development-activity.json')
AWARD_LEDGER = os.path.join(ROOT, 'data', 'policy', 'funding-awards', 'ledger.json')
DOLA = os.path.join(ROOT, 'data', 'policy', 'funding-awards', 'dola-awards.json')
DEALS = os.path.join(ROOT, 'data', 'deals', 'index.json')
OUT = os.path.join(ROOT, 'data', 'jurisdiction-briefs', '_round-watch.json')

ROUND_CREDIT = {1: '9%', 2: '4%'}
POINTS = {'lost_last_same': 50, 'lost_older_same': 10, 'soft_fit': 25, 'soft_misfit': 10, 'soft_size_unknown': 10,
          'lost_other': 10, 'sponsor': 5, 'land': 5}
BANDS = [('High', 50), ('Medium', 25), ('Watch', 10)]
BIG = 70        # homes; 70+ usually goes 4% with bonds (218 of 275 CHFA allocations 2019-2025)
MIN_HOMES = 15  # the smallest round application 2023-2026; smaller state-funded projects are not tax credit deals
# mobile home park purchases and preservation: none has ever applied for credits
NOT_A_CREDIT_DEAL = re.compile(r'\b(mhp|mobile home|manufactured home)', re.I)
SOFT_SKIP = {'Prop 123 homeownership (AHOP)'}   # for-sale homes; no tax credit
LAND = 'Prop 123 Land Banking'
UNDECIDED = {'pending', 'in_review', 'letter_of_intent', 'unresolved'}


def read(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def money(v):
    return '${:,}'.format(v) if isinstance(v, (int, float)) else None


class Data:
    def __init__(self, apps_doc, ledger_doc, excluded, award_rows=(), dola_rows=()):
        self.excluded = excluded
        # the organisation each state award names, by source and project name,
        # for deals that have no CHFA application to name a sponsor
        self.grantees = defaultdict(list)
        for r in award_rows:
            if r.get('sponsor') and r.get('source_url'):
                self.grantees[r['source_url']].append((dev.core_name(r.get('name') or ''), r['sponsor']))
        for r in dola_rows:
            if r.get('grantee') and r.get('source_url'):
                self.grantees[r['source_url']].append((dev.core_name(r.get('name') or ''), r['grantee']))
        self.projects = [p for p in ledger_doc['projects'] if not self.is_excluded(p['name'], p.get('city'))]
        self.by_id = {p['id']: p for p in self.projects}
        self.names = {p['id']: self.names_of(p) for p in self.projects}
        apps = [a for a in apps_doc['applications'] if not self.is_excluded(a['name'], a.get('city'))]
        self.rounds = sorted({(a['year'], a['round']) for a in apps if not a['rolling'] and a['round'] in ROUND_CREDIT})
        self.report_date = {}
        for a in apps:
            if (a['year'], a['round']) in self.rounds and a.get('source_as_of'):
                self.report_date[(a['year'], a['round'])] = a['source_as_of']
        self.round_apps = [a for a in apps if not a['rolling'] and (a['year'], a['round']) in self.rounds
                           and a['credit_type'] == ROUND_CREDIT[a['round']]]
        self.rolling = [a for a in apps if a['rolling']]
        for a in self.round_apps + self.rolling:
            a['_entity'] = self.project_for(a) or 'app:' + dev.core_name(a['name']) + '|' + (a.get('county_fips') or '')

    def is_excluded(self, name, city):
        return apps_mod.exclusion_hash(name or '', city or '') in self.excluded

    @staticmethod
    def names_of(p):
        out = {dev.core_name(p['name'])}
        for e in p['events']:
            for m in re.finditer(r'(?:^|; )(?:Name|PROJECT|Project Name|Project): ([^;]+)', e.get('quote') or ''):
                out.add(dev.core_name(m.group(1)))
        return {n for n in out if n}

    def grantee_of(self, event, names):
        for n, org in self.grantees.get(event.get('source_url'), []):
            if n and any(n == m or n.startswith(m) or m.startswith(n) or dev.same_project(n, m) for m in names):
                return org
        return None

    def project_for(self, app):
        n = dev.core_name(app['name'])
        cs = set(app.get('county_fips_all') or [])
        for p in self.projects:
            pc = set(p.get('county_fips_all') or ([p['county_fips']] if p.get('county_fips') else []))
            if pc and cs and not (pc & cs):
                continue
            if any(dev.same_project(n, m) for m in self.names[p['id']]):
                return p['id']
        return None


def label(r):
    return '%d Round %s' % (r[0], {1: 'One', 2: 'Two'}[r[1]])


def public_before(e, cutoff):
    """An event counts only once it was public: DOLA by its announced day
    (or month, when only the month is printed), everything else (dated by
    year only) once its year is over."""
    d = e.get('announced')
    if e['agency'] == 'DOLA' and d and len(d) == 10 and len(cutoff) >= 10:
        return d < cutoff[:10]
    if e['agency'] == 'DOLA' and d and len(d) >= 7:
        return d[:7] < cutoff[:7]
    return e['year'] < int(cutoff[:4])


SIZE_IN_QUOTE = re.compile(r'(?:Total Units|N_UNITS|Homes|Estimated Units|Estimated Unit Count|Projected Units): (\d+)')


def size_as_of(p, apps, events, live):
    """Homes as known at the cutoff. The ledger keeps the size from its
    latest record, which may postdate a past round, so a backtest takes the
    latest size printed by a record public by then: an earlier application,
    or a funding record (its quote). Year-only records date to year end."""
    if live:
        return (p or {}).get('total_units') or (apps[-1]['total_units'] if apps else None)
    # (date as printed, 0 record / 1 application, homes): same-day ties go to the application
    sized = [((e.get('announced') or '%d-12-31' % e['year']).split('/')[0], 0, int(m.group(1))) for e in events
             for m in [SIZE_IN_QUOTE.search(e.get('quote') or '')] if m]
    sized += [(a.get('source_as_of') or '%d-12-31' % a['year'], 1, a['total_units']) for a in apps if a.get('total_units')]
    return max(sized)[2] if sized else None


def score_round(D, target, cutoff, keep_all=False, live=False):
    """Every project's points for round `target` as of `cutoff`. Returns
    {entity: {...}} for projects scoring 10 or more (every project with a
    signal when keep_all, so a signal's rate is not limited to listed ones).
    `live` scores the list for the next round: every event in the files is
    public by now, including this year's awards."""
    credit = ROUND_CREDIT[target[1]]
    prior = [r for r in D.rounds if r < target]
    same = [r for r in prior if r[1] == target[1]]
    cy = int(cutoff[:4])
    apps_by = defaultdict(list)
    for a in D.round_apps:
        if (a['year'], a['round']) in prior:
            apps_by[a['_entity']].append(a)
    sponsor_rounds = defaultdict(dict)  # sponsor -> {round: first application printed}
    for a in D.round_apps:
        if (a['year'], a['round']) in prior[-4:] and a.get('sponsor'):
            sponsor_rounds[a['sponsor']].setdefault((a['year'], a['round']), a)
    out = {}
    for key in sorted(set(apps_by) | set(D.by_id)):
        p = D.by_id.get(key)
        apps = sorted(apps_by[key], key=lambda a: (a['year'], a['round']))
        if any(a['outcome'] == 'awarded' for a in apps):
            continue
        if apps and apps[-1]['outcome'] in UNDECIDED:
            continue
        events = [e for e in (p['events'] if p else []) if live or public_before(e, cutoff)]
        if any(e['agency'] == 'CHFA' and e['stage'] in ('funded', 'under_construction') for e in events):
            continue
        signals = []
        if apps:
            def loss(a):
                r = (a['year'], a['round'])
                return ('lost_last_same' if same and r == same[-1] else
                        'lost_older_same' if r in same else 'lost_other')
            # the strongest loss counts (a same-type loss beats a later other-type one), newest on a tie
            kind, _, lost = max(((loss(x), n, x) for n, x in enumerate(apps)), key=lambda t: (POINTS[t[0]], t[1]))
            signals.append({'kind': kind, 'app': lost})
            a = apps[-1]
            if a.get('sponsor') and len(sponsor_rounds[a['sponsor']]) >= 2:
                rows = sponsor_rounds[a['sponsor']]
                signals.append({'kind': 'sponsor', 'sponsor': a['sponsor'], 'rounds': len(rows),
                                'apps': [rows[r] for r in sorted(rows)]})
        units = size_as_of(p, apps, events, live)
        soft = [e for e in events if e['agency'] != 'CHFA' and e['program'] not in SOFT_SKIP
                and e['program'] != LAND and e['year'] >= cy - 1]
        if units is not None and units < MIN_HOMES or NOT_A_CREDIT_DEAL.search(' '.join(D.names.get(key, ())) + ' ' + ((p or {}).get('name') or '')):
            soft = []
        if soft:
            # no printed size yet: it could suit either round, so it has its own rate
            kind = ('soft_size_unknown' if units is None else
                    'soft_fit' if (units >= BIG) == (credit == '4%') else 'soft_misfit')
            signals.append({'kind': kind, 'events': soft, 'units': units})
        land = [e for e in events if e['program'] == LAND]
        if land:
            signals.append({'kind': 'land', 'events': land})
        score = sum(POINTS[s['kind']] for s in signals)
        band = next((b for b, floor in BANDS if score >= floor), None)
        if band or (keep_all and signals):
            out[key] = {'score': score, 'band': band, 'signals': signals, 'project': p, 'apps': apps, 'units': units}
    return out


def backtest(D):
    """Score each past round with two earlier rounds of its type, as of the
    day its applicant report came out, and count who applied."""
    rounds, per_signal = [], defaultdict(lambda: [0, 0])
    for target in D.rounds:
        if len([r for r in D.rounds if r < target and r[1] == target[1]]) < 2 or target not in D.report_date:
            continue
        cutoff = D.report_date[target]
        scored = score_round(D, target, cutoff, keep_all=True)
        listed = {k: v for k, v in scored.items() if v['band']}
        applied = {a['_entity'] for a in D.round_apps if (a['year'], a['round']) == target}
        for key, v in scored.items():
            for s in v['signals']:
                k = s['kind'] + ('_' + ROUND_CREDIT[target[1]] if s['kind'] == 'lost_last_same' else '')
                per_signal[k][0] += 1  # projects with the signal
                per_signal[k][1] += key in applied
        bands = {b: {'listed': sum(1 for v in listed.values() if v['band'] == b),
                     'applied': sum(1 for k, v in listed.items() if v['band'] == b and k in applied)} for b, _ in BANDS}
        rounds.append({'round': label(target), 'credit': ROUND_CREDIT[target[1]], 'as_of': cutoff,
                       'applicants': len(applied), 'caught': len(applied & set(listed)),
                       'below_list': len(applied & set(scored) - set(listed)),
                       'no_sign_before': len(applied - set(scored)), 'bands': bands})
    totals = {b: {'listed': sum(r['bands'][b]['listed'] for r in rounds),
                  'applied': sum(r['bands'][b]['applied'] for r in rounds)} for b, _ in BANDS}
    return {'rounds': rounds, 'bands': totals,
            'applicants': sum(r['applicants'] for r in rounds), 'caught': sum(r['caught'] for r in rounds),
            'below_list': sum(r['below_list'] for r in rounds), 'no_sign_before': sum(r['no_sign_before'] for r in rounds),
            'signals': {k: {'with_signal': v[0], 'applied': v[1]} for k, v in sorted(per_signal.items())}}


def rate(bt, key):
    s = bt['signals'].get(key)
    return '%d of %d' % (s['applied'], s['with_signal']) if s and s['with_signal'] else None


def requested(a):
    parts = []
    if a.get('federal_credit_requested'):
        parts.append('%s a year in federal %s credit' % (money(a['federal_credit_requested']), a['credit_type']))
    if a.get('state_credit_requested'):
        parts.append('%s in state credit' % money(a['state_credit_requested']))
    if a.get('pab_requested'):
        parts.append('%s in private activity bonds' % money(a['pab_requested']))
    return ' and '.join(parts)


def why(sig, credit, bt):
    """One plain line per signal, with its source and the quote it rests on."""
    k = sig['kind']
    if k in ('lost_last_same', 'lost_older_same', 'lost_other'):
        a = sig['app']
        ask = requested(a)
        text = 'CHFA did not fund it in %s%s.' % (a['round_label'], ' (it asked for %s)' % ask if ask else '')
        r = rate(bt, 'lost_last_same_' + credit) if k == 'lost_last_same' else rate(bt, k)
        if k == 'lost_last_same' and r:
            text += ' %s deals turned down in a %s round applied again the next year.' % (r, credit)
        elif k == 'lost_older_same' and r:
            text += ' It has not applied since; %s deals like this came back in a later round.' % r
        elif k == 'lost_other' and r:
            text += ' That was the other round type; %s deals like this applied in this one.' % r
        return {'kind': k, 'text': text, 'source_url': a['source_url'], 'quote': a['quote'],
                'outcome_detail': a.get('outcome_detail')}
    if k in ('soft_fit', 'soft_misfit', 'soft_size_unknown'):
        lines = []
        for e in sorted(sig['events'], key=lambda e: (e['year'], e['program'])):
            amt = money(e.get('amount'))
            basis = e.get('amount_label') or ''
            when = e.get('announced') or str(e['year'])
            lines.append({'text': '%s (%s)%s, %s' % (e['program'], e['agency'], ', %s %s' % (amt, basis) if amt else '', when),
                          'source_url': e['source_url'], 'quote': e.get('quote')})
        r = rate(bt, k)
        text = 'State money in place and no tax credit yet: ' + '; '.join(l['text'] for l in lines) + '.'
        if k == 'soft_fit' and r:
            text += ' %s deals with recent state money and a size that suits this round applied in it.' % r
        elif k == 'soft_misfit':
            text += ' At %s homes it suits the other round better%s.' % (sig['units'], ' (%s deals like this applied here)' % r if r else '')
        elif k == 'soft_size_unknown':
            text += ' No public record prints its size yet, so it could suit either round%s.' % (' (%s deals like this applied here)' % r if r else '')
        return {'kind': k, 'text': text, 'sources': [{'url': l['source_url'], 'quote': l['quote']} for l in lines]}
    if k == 'land':
        e = min(sig['events'], key=lambda e: e['year'])
        amt = money(e.get('amount'))
        return {'kind': k, 'text': 'Prop 123 land banking paid for the land in %d%s, so the site is held for affordable homes.'
                % (e['year'], ' (%s)' % amt if amt else ''), 'source_url': e['source_url'], 'quote': e.get('quote')}
    if k == 'sponsor':
        return {'kind': k, 'text': '%s applied in %d of the last 4 CHFA rounds.' % (sig['sponsor'], sig['rounds']),
                'sources': [{'url': a['source_url'], 'quote': a['quote']} for a in sig['apps']]}
    raise ValueError(k)


def award_orgs(v, D):
    """The organisations the state awards name (grantee or sponsor as printed)."""
    p = v['project']
    if not p:
        return []
    names = D.names[p['id']]
    out = []
    for s in v['signals']:
        for e in s.get('events', []):
            org = D.grantee_of(e, names)
            if org and org not in out:
                out.append(org)
    return out


def item(key, v, credit, bt, D):
    p, apps = v['project'], v['apps']
    last = apps[-1] if apps else None
    return {
        'id': key if not key.startswith('app:') else 'app-' + re.sub(r'[^a-z0-9]+', '-', key[4:].lower()).strip('-'),
        'name': (p or {}).get('name') or last['name'],
        'city': (p or {}).get('city') or (last or {}).get('city'),
        'county': (p or {}).get('county'),
        'place_geoid': (p or {}).get('place_geoid') or ((last or {}).get('place_geoids') or [None])[0],
        'homes': v['units'],
        'sponsor': (last or {}).get('sponsor'),
        'award_orgs': award_orgs(v, D),
        'band': v['band'],
        'score': v['score'],
        'why': [why(s, credit, bt) for s in sorted(v['signals'], key=lambda s: -POINTS[s['kind']])],  # strongest first
        # every CHFA application on file, newest first, so the private site can
        # find the contact CHFA printed beside it
        'applications': [{'round_label': a['round_label'], 'credit_type': a['credit_type'], 'name': a['name'],
                          'city': a['city'], 'outcome': a['outcome'], 'source_url': a['source_url']}
                         for a in reversed(apps)],
    }


def deal_summary(i, deals):
    """The hand-researched deal summary for the same development, if one exists
    (data/deals/, shown on deal-summary.html): same town, and one name equal to
    or starting with the other."""
    mine = dev.core_name(i['name'])
    for d in deals:
        if (d.get('city') or '').lower() != (i.get('city') or '').lower():
            continue
        for n in [d.get('name') or ''] + list((d.get('match') or {}).get('names') or []):
            other = dev.core_name(n)
            short, long_ = sorted((mine, other), key=len)
            if short and (short == long_ or (len(short.split()) >= 2 and long_.startswith(short + ' '))):
                return d['slug']
    return None


def next_round(D, rnd):
    latest = max((r for r in D.rounds if r[1] == rnd), default=None)
    return (latest[0] + 1, rnd) if latest else None


def build(apps_doc, ledger_doc, excluded_doc, award_rows=(), dola_rows=(), deals=()):
    excluded = {e['sha256'] for e in excluded_doc.get('excluded', [])}
    D = Data(apps_doc, ledger_doc, excluded, award_rows, dola_rows)
    bt = backtest(D)
    as_of = max(apps_doc['meta']['generated_at'], ledger_doc['meta']['generated_at'])[:10]
    rounds = []
    for rnd in (1, 2):
        target = next_round(D, rnd)
        credit = ROUND_CREDIT[rnd]
        listed = score_round(D, target, as_of, live=True)
        latest = max(r for r in D.rounds if r[1] == rnd)
        pending = [a for a in D.round_apps if (a['year'], a['round']) == latest and a['outcome'] == 'pending']
        items = sorted((item(k, v, credit, bt, D) for k, v in listed.items()),
                       key=lambda i: (-i['score'], i['name'].lower()))
        for i in items:
            i['deal_summary'] = deal_summary(i, deals)
        rounds.append({
            'round': label(target), 'credit': credit,
            'applications_due': 'February' if rnd == 1 else 'August',
            'undecided_last_round': len(pending),
            'note': ('%d %s from %s %s still waiting on CHFA; each joins this list if it is not funded.'
                     % (len(pending), 'application' if len(pending) == 1 else 'applications', pending[0]['round_label'],
                        'is' if len(pending) == 1 else 'are')) if pending else None,
            'counts': {b: sum(1 for i in items if i['band'] == b) for b, _ in BANDS},
            'items': items,
        })
    rolling = [{'name': a['name'], 'city': a['city'], 'homes': a['total_units'], 'sponsor': a.get('sponsor'),
                'stage': a.get('stage'), 'outcome': a['outcome'], 'source_url': a['source_url'], 'quote': a['quote'],
                'as_of': a.get('source_as_of')}
               for a in sorted(D.rolling, key=lambda a: a['name'].lower())
               if a['credit_type'] == '4%' and a['outcome'] in UNDECIDED]
    return {
        'meta': {
            'generated_at': as_of,
            'generator': 'scripts/funding/build_round_watch.py',
            'title': 'Next round watch',
            'method': ('Each CHFA round is scored on its own credit type (Round One 9%, Round Two 4% plus state, '
                       'as every round from 2023 to 2026 was). Points for public evidence a project still needs '
                       'credits: not funded a year earlier in the same round type 50, in an older round of that '
                       'type 10, recent DOLA or Prop 123 rental money with a size that suits the round 25 (10 if '
                       'it suits the other round or its size is not printed yet), not funded in the other round type 10, a sponsor that applied in '
                       '2 of the last 4 rounds 5, a Prop 123 land banking award 5. High 50+, Medium 25-49, Watch '
                       '10-24. A project leaves the list once CHFA awards it credit or while its application is '
                       'undecided. Homeownership (AHOP) awards, projects under 15 homes and mobile home parks '
                       'do not count as state-money signals: none has applied for credits.'),
            'points': POINTS, 'bands': dict(BANDS), 'big_project_homes': BIG,
            'limits': [
                'Public records only: a deal with no earlier application or state award is invisible until it applies.',
                'CHFA prints neither "not awarded" nor "withdrawn"; outcomes are derived, so a dropped deal can look like a returner.',
                'CHFA and Prop 123 awards carry a year, not a date, so the backtest counts them only once their year is over.',
                'The applicant record starts in 2023.',
                'The rates were set on the same rounds they are tested on; the next applicant report is the real test.',
            ],
            'contacts_note': 'Contacts are kept only on the private developer site, never in this file.',
            'sources': {'applications': 'data/jurisdiction-briefs/_lihtc-applications.json',
                        'ledger': 'data/market/development-activity.json',
                        'award_orgs': 'data/policy/funding-awards/ledger.json, dola-awards.json (grantee or sponsor as printed)'},
        },
        'backtest': bt,
        'rounds': rounds,
        'rolling_4pct': rolling,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()
    dola = read(DOLA)
    out = build(read(APPLICATIONS), read(LEDGER), read(EXCLUDED), read(AWARD_LEDGER)['awards'],
                dola['awards'] if isinstance(dola, dict) else dola,
                read(DEALS)['deals'] if os.path.exists(DEALS) else [])
    text = json.dumps(out, indent=1, ensure_ascii=False) + '\n'
    if args.check:
        same = os.path.exists(OUT) and open(OUT, encoding='utf-8').read() == text
        print('round watch is %s' % ('current' if same else 'STALE: run python3 scripts/funding/build_round_watch.py'))
        return 0 if same else 1
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(text)
    for r in out['rounds']:
        print('%s: %s' % (r['round'], r['counts']))
    bt = out['backtest']
    print('backtest: caught %d of %d applicants; High %s' % (bt['caught'], bt['applicants'], bt['bands']['High']))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
