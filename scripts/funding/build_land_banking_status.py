"""
scripts/funding/build_land_banking_status.py — where the project on each Prop 123
land banking site stands.

Reads only files the repo already has:

  data/policy/prop123-land-banking-awards.json   the 63+ awards (build_land_banking_awards.py)
  data/market/development-activity.json          one row per project across CHFA, OEDIT
      Prop 123 and DOLA awards (build_development_activity.py); each land banking
      award is a land_funded event on the project it belongs to
  data/policy/funding-awards/land-banking-status-research.json   hand-checked, sourced
      notes for awards the ledger cannot place (a partner chosen, a developer sought)

Each award gets one status, strongest first:

  financed     the same project has another state award (tax credits, a DOLA grant,
               a Prop 123 loan or homeownership award), before or after the land
               award; an earlier one is marked so. The ledger never says built.
  applied      it has applied for building money and the decision is pending
  partner      a dated public source says a development partner is chosen
  seeking      a dated public source says the grantee is asking developers to apply
  not_funded   it applied for building money and was not funded (yet)
  none_found   searched on the checked date; nothing public found
  none         no later state funding on record (not searched by hand)

A research note outranks the ledger except where the ledger shows financing.

Writes data/policy/prop123-land-banking-status.json. No network, no clock.

Usage:
  python3 scripts/funding/build_land_banking_status.py          # write
  python3 scripts/funding/build_land_banking_status.py --check  # build, compare, write nothing
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
AWARDS = os.path.join(ROOT, 'data/policy/prop123-land-banking-awards.json')
LEDGER = os.path.join(ROOT, 'data/market/development-activity.json')
RESEARCH = os.path.join(ROOT, 'data/policy/funding-awards/land-banking-status-research.json')
OUT = os.path.join(ROOT, 'data/policy/prop123-land-banking-status.json')

LABELS = {
    'financed': 'Building money awarded',
    'applied': 'Applied for building money',
    'partner': 'Development partner chosen',
    'seeking': 'Seeking a developer',
    'not_funded': 'Applied for building money, not funded yet',
    'none_found': 'No public next step found',
    'none': 'No later state funding on record',
}
RANK = {k: i for i, k in enumerate(LABELS)}
DATE = re.compile(r'^\d{4}(-\d{2}(-\d{2})?)?$')
LEDGER_STAGE = {'funded': 'financed', 'under_construction': 'financed', 'applied': 'applied',
                'letter_of_intent': 'applied', 'not_funded': 'not_funded'}


def read_json(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def is_https(url):
    u = urlparse(str(url or ''))
    return u.scheme == 'https' and bool(u.netloc)


def norm(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def ledger_project(award, projects):
    """The ledger project whose land banking event is this award (same list, same amount)."""
    hits = []
    for p in projects:
        for e in p['events']:
            if (e['stage'] == 'land_funded' and e.get('source_url') == award['source_url']
                    and e.get('amount') == award['amount_awarded']):
                hits.append((p, e))
                break
    if len(hits) > 1:
        # two awards of the same amount on one list: keep the one whose land event
        # prints this award's whole project name
        name = norm(award['project'])
        hits = [(p, e) for p, e in hits if name and name in norm(e.get('quote'))]
    return hits[0][0] if len(hits) == 1 else None


def event_stage(e):
    # a DOLA row that prints only the amount requested is an application, not an award
    if e['stage'] == 'funded' and 'Amount basis: requested' in (e.get('quote') or ''):
        return 'applied'
    return LEDGER_STAGE.get(e['stage'])


def from_ledger(project):
    land_year = min((e['year'] for e in (project or {}).get('events', []) if e['stage'] == 'land_funded'), default=None)
    later = [(event_stage(e), e) for e in (project or {}).get('events', []) if e['stage'] != 'land_funded']
    later = [(s, e) for s, e in later if s]
    if not later:
        return None
    best = min((s for s, _ in later), key=RANK.get)
    picked = sorted([e for s, e in later if s == best], key=lambda e: -e['year'])
    # CHFA's property list repeats the credit award it follows; keep it only when it is alone
    if any(not e['program'].startswith('Housing tax credit property list') for e in picked):
        picked = [e for e in picked if not e['program'].startswith('Housing tax credit property list')]
    seen, steps, sources = set(), [], []
    for e in picked:
        key = (e['program'], e['year'])
        if key in seen:
            continue
        seen.add(key)
        asked = event_stage(e) != LEDGER_STAGE.get(e['stage'])
        before = ', before the land award' if land_year and e['year'] < land_year else ''
        steps.append(f"{e['program']} ({'amount requested, ' if asked else ''}{e['year']}{before})")
        if e.get('source_url') and e['source_url'] not in [s['url'] for s in sources]:
            sources.append({'title': f"{e.get('agency') or 'State'} {e['program']}, {e['year']}", 'url': e['source_url']})
    return {'status': best, 'text': f"{project['name']}: " + '; '.join(steps[:3]) + '.',
            'sources': sources[:3], 'quote': picked[0].get('quote'), 'from': 'ledger',
            'ledger_project': project['id']}


def build():
    awards = read_json(AWARDS)['awards']
    ledger = read_json(LEDGER)
    research = read_json(RESEARCH)
    entries = research['entries']
    ids = {a['id'] for a in awards}
    unknown = sorted(set(entries) - ids)
    if unknown:
        raise SystemExit(f'research notes for awards that are not on the list: {unknown}')
    out, unlinked = {}, []
    for a in awards:
        project = ledger_project(a, ledger['projects'])
        if not project:
            unlinked.append(a['id'])
        led = from_ledger(project)
        note = entries.get(a['id'])
        if note:
            if note['status'] not in LABELS or note['status'] in ('financed', 'none'):
                raise SystemExit(f"{a['id']}: research status must be one of applied, partner, seeking, not_funded, none_found")
            if note['status'] != 'none_found' and not (note.get('text') and note.get('quote') and note.get('sources')
                                                         and all(is_https(s.get('url')) and DATE.match(str(s.get('date', '')))
                                                                 for s in note['sources'])):
                raise SystemExit(f"{a['id']}: a {note['status']} note needs text, a quote and dated https sources")
        if led and (led['status'] == 'financed' or not note):
            row = led
        elif note:
            row = {'status': note['status'], 'text': note.get('text'), 'sources': note.get('sources', []),
                   'quote': note.get('quote'), 'from': 'research', 'checked': note['checked']}
        else:
            row = {'status': 'none', 'text': None, 'sources': [], 'quote': None, 'from': 'ledger'}
        row['label'] = LABELS[row['status']]
        out[a['id']] = row
    counts = {k: sum(1 for r in out.values() if r['status'] == k) for k in LABELS}
    return {
        'meta': {
            'generator': 'scripts/funding/build_land_banking_status.py',
            'generated_from': {'awards': read_json(AWARDS)['meta'].get('generated'),
                               'ledger': ledger['meta'].get('generated_at'),
                               'research_checked': research.get('checked')},
            'labels': LABELS,
            'counts': counts,
            # awards with no single ledger project to read; each shows "none" until fixed
            'unlinked': unlinked,
            'note': 'A status reads only public state award records and dated public sources. '
                    '"Building money awarded" means another state award to the same project, before or after the land award, not that homes are built.',
        },
        'status': out,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()
    data = build()
    text = json.dumps(data, indent=2, ensure_ascii=False) + '\n'
    if args.check:
        current = ''
        if os.path.exists(OUT):
            with open(OUT, encoding='utf-8') as fh:
                current = fh.read()
        if current != text:
            print(f'{os.path.relpath(OUT, ROOT)} is stale: run python3 scripts/funding/build_land_banking_status.py', file=sys.stderr)
            sys.exit(1)
        print('land banking status: up to date')
        return
    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(text)
    print(f"wrote {os.path.relpath(OUT, ROOT)}: " + ', '.join(f'{k} {v}' for k, v in data['meta']['counts'].items()))


if __name__ == '__main__':
    main()
