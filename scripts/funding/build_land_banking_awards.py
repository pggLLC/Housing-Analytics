#!/usr/bin/env python3
"""
scripts/funding/build_land_banking_awards.py — every Prop 123 Land Banking award, placed on a map.

The Land Banking program is part of the Prop 123 Affordable Housing Financing
Fund (OEDIT, administered by CHFA). CHFA publishes each round's awards as a PDF
only. build_funding_awards.py already reads those PDFs into the award ledger,
and checks every list against the TOTAL line it prints, so this script starts
from the ledger's land-banking rows and adds what a map needs:

  * the names as the PDF prints them. A cell that wraps onto a second line can
    land on the wrong row in the ledger ("Inc. Calvary Flats Affordable Homes");
    the fix for each is in data/policy/funding-awards/land-banking-corrections.json,
    and every sponsor, project, location, amount and unit count written here
    must appear in that round's PDF text, or the script stops.
  * each location resolved to its Census place (data/hna/geo-config.json) and
    that place's 2024 Gazetteer centroid (data/co-place-centroids.json). The
    PDFs give a town, never an address, so a pin marks the town, not the site.
  * the row as printed, as the source quote.

Contacts: the FY25-26 lists also print a contact name, phone and email for each
award. Those are written to data/jurisdiction-briefs/_land-banking-contacts.json,
which the public build leaves out (the developer-gated Jurisdiction Report reads
it). Contacts researched by hand for the earlier rounds live in the same file
under "researched" and are kept as they are on every run.

Usage:
  python3 scripts/funding/build_land_banking_awards.py --pdf-dir DIR   # PDFs already downloaded
  python3 scripts/funding/build_land_banking_awards.py                 # downloads them
  python3 scripts/funding/build_land_banking_awards.py --check         # verify, write nothing

Requires poppler-utils (pdftotext).
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import re
import subprocess
import sys
from urllib.parse import urlparse
import tempfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LEDGER = os.path.join(ROOT, 'data', 'policy', 'funding-awards', 'ledger.json')
DOCUMENTS = os.path.join(ROOT, 'data', 'policy', 'funding-awards', 'documents.json')
CORRECTIONS = os.path.join(ROOT, 'data', 'policy', 'funding-awards', 'land-banking-corrections.json')
GEO_CONFIG = os.path.join(ROOT, 'data', 'hna', 'geo-config.json')
CENTROIDS = os.path.join(ROOT, 'data', 'co-place-centroids.json')
OUT = os.path.join(ROOT, 'data', 'policy', 'prop123-land-banking-awards.json')
CONTACTS = os.path.join(ROOT, 'data', 'jurisdiction-briefs', '_land-banking-contacts.json')

PROGRAM = 'Prop 123 Land Banking'
PROGRAM_URL = 'https://coloradoaffordablehousingfinancingfund.com/land-banking/'
PROGRAM_EMAIL = 'landbanking@chfainfo.com'
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

# Round labels by PDF; the two FY25-26 lists are separate rounds.
ROUND_LABELS = {
    'FY23-24-LandBankingAwards.pdf': ('FY23-24', '2023-24 round'),
    'FY24-25-LandBankingAwards.pdf': ('FY24-25', '2024-25 round'),
    'Prop123-AHFF-FY25-26-LandBankingProgramSelections-RRR.pdf': ('FY25-26-rural', '2025-26 rural and resort round'),
    'Prop123-AHFF-FY25-26-LandBankingProgramSelections-Statewide.pdf': ('FY25-26-statewide', '2025-26 statewide round'),
}

EMAIL = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
PHONE = re.compile(r'\b\d{3}-\d{3}-\d{4}\b')
PDF_DATE = re.compile(r'(\d{2})/(\d{2})/(\d{4})\s*$')


def read_json(path):
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def write_json(path, data):
    with open(path, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
        fh.write('\n')


def flat(s: str) -> str:
    return re.sub(r'\s+', ' ', s or '').strip()


def money(n) -> str:
    return '${:,}'.format(n)


def norm_place(s: str) -> str:
    s = re.sub(r'\s*\((city|town|CDP)\)$', '', s, flags=re.I)
    return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()


def pdf_text(path: str) -> str:
    return subprocess.run(['pdftotext', '-layout', path, '-'], check=True, capture_output=True, text=True).stdout


def fetch(url: str, dest: str) -> None:
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest, 'wb') as fh:
        fh.write(r.read())


def load_places():
    geo = read_json(GEO_CONFIG)
    cents = read_json(CENTROIDS)['byGeoid']
    county_name = {c['geoid']: c['label'] for c in geo['counties']}
    by_name: dict[str, list] = {}
    for p in geo['places'] + geo['cdps']:
        by_name.setdefault(norm_place(p['label']), []).append(p)
    return by_name, cents, county_name


def resolve(town: str, county_fips: str | None, by_name, cents, county_name):
    cands = by_name.get(norm_place(town), [])
    if len(cands) > 1 and county_fips:
        cands = [c for c in cands if c['containingCounty'] == county_fips] or cands
    if len(cands) != 1:
        raise SystemExit(f'cannot place "{town}" (county {county_fips}): {len(cands)} matches in geo-config')
    p = cands[0]
    c = cents.get(p['geoid'])
    if not c:
        raise SystemExit(f'no centroid for {p["label"]} ({p["geoid"]})')
    return {'geoid': p['geoid'], 'name': re.sub(r'\s*\((city|town|CDP)\)$', '', p['label']),
            'county_fips': p['containingCounty'], 'county': county_name.get(p['containingCounty']),
            'lat': round(c['lat'], 5), 'lng': round(c['lng'], 5)}


def row_contact(text: str, project: str, amount: int):
    """The contact columns of the PDF row that carries this award's amount."""
    amt = money(amount)
    for line in text.split('\n'):
        if amt in line and EMAIL.search(line) and project.split()[0] in line:
            email = EMAIL.search(line).group(0)
            phone = PHONE.search(line)
            # the name sits between the purpose cell and the phone number
            head = line[:phone.start()] if phone else line[:line.find(email)]
            name = re.split(r'\s{2,}', head.rstrip())[-1].strip()
            return {'name': name, 'phone': phone.group(0) if phone else None, 'email': email, 'line': flat(line)}
    return None


def build(pdf_dir: str | None):
    ledger = [a for a in read_json(LEDGER)['awards'] if a['program'] == PROGRAM]
    docs = {d['file']: d for d in read_json(DOCUMENTS)['documents'] if d.get('program') == PROGRAM}
    corrections = read_json(CORRECTIONS)['corrections']
    by_name, cents, county_name = load_places()
    unknown = sorted(set(a['source_file'] for a in ledger) - set(ROUND_LABELS))
    if unknown:
        raise SystemExit(f'new land banking list(s) not labelled in ROUND_LABELS: {unknown}')

    tmp = None
    if not pdf_dir:
        tmp = tempfile.TemporaryDirectory()
        pdf_dir = tmp.name
    texts, rounds = {}, []
    for f, (rid, label) in ROUND_LABELS.items():
        d = docs.get(f)
        if not d:
            raise SystemExit(f'{f} is not in documents.json')
        path = os.path.join(pdf_dir, f)
        if not os.path.exists(path):
            fetch(d['url'], path)
        with open(path, 'rb') as fh:
            sha = hashlib.sha256(fh.read()).hexdigest()
        if sha != d['sha256']:
            raise SystemExit(f'{f} differs from the copy the ledger was built from; rebuild the ledger first')
        text = pdf_text(path)
        texts[f] = text
        m = [PDF_DATE.search(ln.strip()) for ln in text.split('\n') if 'Land Banking' in ln]
        m = [x for x in m if x]
        pdf_date = f'{m[-1].group(3)}-{m[-1].group(1)}-{m[-1].group(2)}' if m else None
        checks = {c['field']: c['pdf_total'] for c in d.get('checks', [])}
        rounds.append({'id': rid, 'label': label, 'fiscal_year': d['fiscal_year'], 'title': d['title'],
                       'pdf_date': pdf_date, 'source_file': f, 'source_url': d['url'], 'sha256': sha,
                       'awards': d['rows'], 'total_awarded': checks.get('amount_awarded'),
                       'total_units': checks.get('total_units'),
                       'prints_contacts': bool(EMAIL.search(text))})

    awards, contacts, used = [], [], set()
    for a in ledger:
        key = f"{a['fiscal_year']}|{a['name']}"
        fix = corrections.get(key, {})
        if fix:
            used.add(key)
        since = fix.get('since')
        if since and not (since.get('text') and since.get('checked') and since.get('sources')
                          and all((urlparse(str(x.get('url', ''))).scheme == 'https' and urlparse(str(x.get('url', ''))).netloc) for x in since['sources'])):
            raise SystemExit(f'{key}: "since" needs text, checked and https sources')
        # an entry with only a note annotates a row the ledger read correctly
        sponsor = fix.get('sponsor', a['sponsor'])
        project = fix.get('name', a['name'])
        location = fix.get('location', a['location'])
        text = flat(texts[a['source_file']])
        for label, val in (('sponsor', sponsor), ('project', project), ('amount', money(a['amount_awarded'])),
                           ('units', '{:,}'.format(a['total_units']))):
            # a wrapped cell is printed in pieces, so check each piece of two or more words
            parts = [val] if label in ('amount', 'units') else re.split(r'\s*\|\s*', fix.get('printed_as', {}).get(label, val))
            for part in parts:
                if flat(part) not in text:
                    raise SystemExit(f'{key}: {label} "{part}" is not in {a["source_file"]}')
        towns = [t.strip() for t in location.split(',') if t.strip()]
        places = [resolve(t, a['county_fips'], by_name, cents, county_name) for t in towns]
        rid = ROUND_LABELS[a['source_file']][0]
        slug = re.sub(r'[^a-z0-9]+', '-', f'{rid} {project}'.lower()).strip('-')
        purpose = a['detail']
        quote = f'{sponsor} | {project} | {location} | {money(a["amount_awarded"])} | {purpose} | {a["total_units"]:,}'
        awards.append({
            'id': slug, 'round': rid, 'fiscal_year': a['fiscal_year'], 'sponsor': sponsor, 'project': project,
            'location': location, 'places': places,
            # where the site is: the county the list prints (or the ledger placed it in) for a
            # one-town award, which can differ from the town's main county (Walden 35, Aurora: Adams)
            'county_fips': [a['county_fips']] if len(places) == 1 and a['county_fips'] else sorted(set(p['county_fips'] for p in places)),
            'amount_awarded': a['amount_awarded'],
            'estimated_units': a['total_units'], 'purpose': purpose,
            'rental': 'Rental' in purpose, 'homeownership': 'Homeownership' in purpose,
            'source_file': a['source_file'], 'source_url': a['source_url'], 'source_quote': quote,
            'corrected_from_ledger': fix.get('reason'), 'note': fix.get('note'),
            # what readers see when the printed name has a typo or is shortened; the
            # printed row stays in source_quote
            'show_project': fix.get('show_project'), 'show_sponsor': fix.get('show_sponsor'),
            # one dated, sourced line on what has happened to the site since the award
            'since': fix.get('since')})
        if EMAIL.search(texts[a['source_file']]):
            c = row_contact(texts[a['source_file']], project, a['amount_awarded'])
            if not c:
                raise SystemExit(f'{key}: no contact found on its PDF row')
            contacts.append({'award_id': slug, 'project': project, 'org': sponsor, 'name': c['name'],
                             'role': 'Contact named by CHFA for this award', 'phone': c['phone'], 'email': c['email'],
                             'geoids': [p['geoid'] for p in places],
                             'county_fips': sorted(set(p['county_fips'] for p in places)),
                             'source_label': 'CHFA ' + ROUND_LABELS[a['source_file']][1] + ' selection list',
                             'source_url': a['source_url'], 'source_quote': c['line']})
    # In the lists that print contacts, a wrapped cell continues on the lines under its row.
    # Every such piece must be part of that row's award, or the ledger cut a name short
    # (Rivergate Lot 5 Workforce | Housing Development) and the check above cannot see it,
    # because the piece is also in another row's name.
    for f, text in texts.items():
        if not EMAIL.search(text):
            continue
        rows = [w for w in awards if w['source_file'] == f]
        current = None
        for line in text.split('\n'):
            if '$' in line:
                current = next((w for w in rows if money(w['amount_awarded']) in line
                                and w['project'].split()[0] in line), None)
                continue
            if not line.strip() or current is None or not line.startswith(' '):
                current = None if not line.strip() else current
                continue
            for piece in re.split(r'\s{3,}', line.strip()):
                if flat(piece) not in flat(f"{current['sponsor']} {current['project']} {current['purpose']}"):
                    raise SystemExit(f'{f}: "{piece}" is printed under {current["project"]} but is not part of it')
    stale = sorted(set(corrections) - used)
    if stale:
        raise SystemExit(f'corrections that match no ledger row: {stale}')
    for r in rounds:
        rows = [w for w in awards if w['source_file'] == r['source_file']]
        if len(rows) != r['awards'] or sum(w['amount_awarded'] for w in rows) != r['total_awarded'] \
                or sum(w['estimated_units'] for w in rows) != r['total_units']:
            raise SystemExit(f'{r["source_file"]}: rows do not add up to the PDF totals')
    order = {r['id']: i for i, r in enumerate(rounds)}
    awards.sort(key=lambda w: (order[w['round']], w['project'].lower()))
    if tmp:
        tmp.cleanup()
    return rounds, awards, contacts


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--pdf-dir')
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()
    rounds, awards, contacts = build(args.pdf_dir)
    today = dt.date.today().isoformat()
    out = {
        'meta': {
            'generated': today,
            'generator': 'scripts/funding/build_land_banking_awards.py',
            'program': 'Proposition 123 Land Banking (Affordable Housing Financing Fund)',
            'administrator': 'CHFA, on behalf of the Colorado Office of Economic Development and International Trade (OEDIT)',
            'program_url': PROGRAM_URL,
            'program_email': PROGRAM_EMAIL,
            'program_quote': ('The Land Banking program provides grants to eligible local or tribal governments and forgivable '
                              'loans to eligible nonprofits with a demonstrated history of providing affordable housing. These '
                              'funds must be used to acquire and preserve land for affordable for-sale housing or affordable '
                              'rental housing.'),
            'eligibility_quote': ('To be eligible, affordable housing projects seeking support from the Affordable Housing Financing '
                                  'Fund must be located in a jurisdiction that has completed a Proposition 123 Local Government '
                                  'Affordable Housing Commitment with the Colorado Department of Local Affairs − Division of Housing.'),
            'open_round': {
                'checked': '2026-10-15',
                # the rural window closes then; past it the page stops saying "apply now"
                'review_by': '2026-12-31',
                # plain restatement of the two quotes below; test:land-banking-awards checks its dates and amount
                'summary': ('Projects in rural and resort areas can apply now, until December 31, 2026 or until the money runs out. '
                            'Projects anywhere in Colorado can apply from January 2027. About $31 million is available this year.'),
                'quote': ('CHFA will accept applications for the Proposition 123 Land Banking program for projects located in '
                          'Rural and Rural Resort communities* beginning September 15, 2026, and continuing through December 31, '
                          '2026, or until funds are exhausted. Beginning January 2027, applications will be accepted for all '
                          'projects, including those not located in Rural or Rural Resort communities.'),
                'allocation_quote': 'The FY27 total Land Banking allocation will be approximately $31 million.',
                'source_url': PROGRAM_URL},
            'location_note': ('CHFA lists a town for each award, not an address. Each pin sits at the Census 2024 Gazetteer '
                              'centre of that town; an award that lists several towns has a pin in each.'),
            'units_note': 'Units are the estimate in each award list; land banking buys land, and the homes come later.',
            'award_count': len(awards),
            'total_awarded': sum(w['amount_awarded'] for w in awards),
            'total_estimated_units': sum(w['estimated_units'] for w in awards),
            'rounds': rounds,
        },
        'awards': awards,
    }
    prior = read_json(CONTACTS) if os.path.exists(CONTACTS) else {}
    contact_out = {
        'meta': {
            'generated': today,
            'generator': 'scripts/funding/build_land_banking_awards.py',
            'note': ('Developer-gated: the public build leaves data/jurisdiction-briefs/ out. "from_award_lists" is copied '
                     'from the contact columns CHFA printed on the FY25-26 selection lists. "researched" holds a public '
                     'contact for each earlier award, found on the grantee\'s own site and kept by hand. People move; '
                     're-check before outreach.'),
            'program_contact': {'org': 'CHFA Land Banking program', 'email': PROGRAM_EMAIL, 'source_url': PROGRAM_URL},
        },
        'from_award_lists': contacts,
        'researched': prior.get('researched', []),
    }
    if args.check:
        print(f'ok: {len(awards)} awards in {len(rounds)} rounds, {len(contacts)} printed contacts')
        return 0
    write_json(OUT, out)
    write_json(CONTACTS, contact_out)
    print(f'wrote {len(awards)} awards, {len(contacts)} printed contacts')
    return 0


if __name__ == '__main__':
    sys.exit(main())
