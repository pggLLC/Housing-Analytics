#!/usr/bin/env python3
"""
scripts/funding/build_lihtc_applications.py — who applied for Housing Tax
Credits, and what became of each application.

CHFA publishes an Applicant Report for every competitive round (9% Round One,
4% + state Round Two, Middle Income credit) and two rolling lists of letters
of intent and applications (federal 4%, MIHTC). Award reports name only the
winners, so the applicants a jurisdiction did not see funded are only in
these reports. This script reads them, keeps the last four years of rounds,
and joins each application to the award ledger that
scripts/funding/build_funding_awards.py writes, so every row carries an
outcome:

  awarded       the project is on an award report (the row names which one)
  not_awarded   the round's award report is published and the project is on
                no award report for that credit. CHFA does not say why.
  pending       the round's award report is not published yet
  in_review     on a rolling list as an application, no award found yet
  letter_of_intent  on a rolling list as a letter of intent

The reports also print a contact name, email and phone for every applicant.
Those columns are never read into a row.

Output goes to data/jurisdiction-briefs/_lihtc-applications.json, which the
public build leaves out with the rest of the briefs (scripts/build-public-site.mjs):
the list is read by the developer brief only.

Every report prints a TOTALS row. A document whose parsed rows do not add up
to it is recorded as `mismatch` and contributes no rows.

Usage:
  python3 scripts/funding/build_lihtc_applications.py              # fetch, parse, write
  python3 scripts/funding/build_lihtc_applications.py --cache DIR  # reuse/keep PDFs in DIR
  python3 scripts/funding/build_lihtc_applications.py --check      # parse, write nothing

Requires pdfplumber (the reports draw cell boxes, which pdfplumber reads as a
table; pdftotext -layout loses which line of a wrapped cell belongs to which row).
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
import re
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
_spec = importlib.util.spec_from_file_location('build_funding_awards', os.path.join(HERE, 'build_funding_awards.py'))
awards = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(awards)

OUT = os.path.join(ROOT, 'data', 'jurisdiction-briefs', '_lihtc-applications.json')
# Applications left out on purpose, by sha256 of "<normalized name>|<normalized
# city>", so the file does not itself name them.
EXCLUDED = os.path.join(ROOT, 'data', 'jurisdiction-briefs', '_lihtc-applications-excluded.json')
LEDGER = os.path.join(ROOT, 'data', 'policy', 'funding-awards', 'ledger.json')
DOCUMENTS = os.path.join(ROOT, 'data', 'policy', 'funding-awards', 'documents.json')

SOURCE = {
    'agency': 'CHFA',
    'program_family': 'housing-tax-credit',
    'index_url': 'https://www.chfainfo.com/rental-housing/housing-credit/awards',
    'link_pattern': re.compile(r'/getattachment/[^"\s]*applicant-report[^"\s]*\.pdf', re.I),
}
# Rounds kept: the latest year CHFA has published an applicant report for and
# the three before it (four years; the owner's choice, 2026-10-14).
YEARS_KEPT = 4

ROUND_WORD = {1: 'Round One', 2: 'Round Two'}
PROGRAM_OF = {'9%': 'LIHTC 9% + state', '4%': 'LIHTC 4% + state', 'MIHTC': 'MIHTC'}


# ── documents ────────────────────────────────────────────────────────────────

def doc_meta(file: str) -> dict:
    """Year, round and credit type from the file name CHFA gives the report."""
    f = file.lower()
    y = re.search(r'(20\d\d)', f)
    meta = {'year': int(y.group(1)) if y else None, 'round': None,
            'rolling': 'loi-and-applicant' in f}
    r = re.search(r'round[-_ ]*(one|two|1|2)\b', f)
    if r:
        meta['round'] = {'one': 1, 'two': 2, '1': 1, '2': 2}[r.group(1)]
    if 'mihtc' in f:
        meta['credit_type'] = 'MIHTC'
    elif meta['rolling'] and re.search(r'federal-4|4-percent', f):
        meta['credit_type'] = '4%'
    elif meta['round'] == 2:
        meta['credit_type'] = '4%'
    elif meta['round'] == 1:
        meta['credit_type'] = '9%'
    else:
        meta['credit_type'] = None
    return meta


def round_label(meta: dict) -> str:
    if meta['rolling']:
        return ('Rolling federal 4% list' if meta['credit_type'] == '4%' else 'Rolling MIHTC list')
    if meta['credit_type'] == 'MIHTC':
        return f"{meta['year']} Middle Income Housing Tax Credit"
    return f"{meta['year']} {ROUND_WORD.get(meta['round'], 'round')}"


def read_tables(path: str) -> tuple[list[list[str]], list[str]]:
    """Every table row on every page, header row first, and the page text
    (for the "As of" date the rolling lists print)."""
    import pdfplumber  # only the fetch needs it; tests pass tables directly
    rows, texts = [], []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            texts.append(page.extract_text() or '')
            for table in page.extract_tables():
                rows.extend([[(c or '') for c in r] for r in table])
    return rows, texts


# ── rows ─────────────────────────────────────────────────────────────────────

# (field, test on the lower-cased heading); first match wins. Contact columns
# map to None and are never read.
HEADING_RULES = [
    (None, lambda h: any(k in h for k in ('contact', 'email', 'phone', 'first', 'last', 'zip'))),
    ('stage', lambda h: h == 'stage'),
    ('sponsor', lambda h: 'sponsor' in h or 'owner' in h),
    ('pab_issuer', lambda h: 'issuer' in h),
    ('pab_requested', lambda h: 'pab' in h or 'bond' in h),
    ('restricted_units', lambda h: 'units' in h and re.search(r'\b(li|mihtc)\b', h) is not None),
    ('total_units', lambda h: 'units' in h),
    ('toc_credit_requested', lambda h: 'toc' in h),
    ('accelerated_state_credit_requested', lambda h: 'accelerated' in h),
    ('state_credit_requested', lambda h: 'state' in h),
    ('mihtc_credit_requested', lambda h: 'mihtc' in h),
    ('federal_credit_requested', lambda h: 'federal' in h or 'credit' in h),
    ('address', lambda h: 'address' in h),
    ('city', lambda h: h == 'city'),
    ('name', lambda h: h == 'name'),
    ('type', lambda h: 'type' in h),
]
MONEY_FIELDS = ('federal_credit_requested', 'state_credit_requested', 'accelerated_state_credit_requested',
                'toc_credit_requested', 'mihtc_credit_requested', 'pab_requested')
INT_FIELDS = ('total_units', 'restricted_units')
TEXT_FIELDS = ('stage', 'type', 'name', 'address', 'city', 'sponsor', 'pab_issuer')


def clean(s: str) -> str:
    s = re.sub('[‐‑‒–—]', '-', s or '')
    return re.sub(r'\s+', ' ', s).strip()


def heading_fields(header: list[str]) -> list[str | None]:
    out = []
    for cell in header:
        h = clean(cell).lower().strip('*')
        out.append(next((f for f, test in HEADING_RULES if test(h)), None) if h else None)
    return out


def number(s: str) -> int | None:
    s = clean(s).replace('$', '').replace(',', '').replace(' ', '').strip('*')
    if not re.fullmatch(r'\d+(?:\.\d+)?', s):
        return None
    return int(round(float(s)))


def is_total_row(row: list[str], fields: list[str | None] | None = None) -> bool:
    """A TOTALS row, labelled or not: 2023 Round Two prints its sums under the
    columns with no label and no name or city beside them."""
    if any(re.fullmatch(r'totals?:?', clean(c), re.I) for c in row):
        return True
    if fields is None:
        return False
    named = {f: clean(c) for f, c in zip(fields, row) if f}
    sums = [f for f, v in named.items() if v and (f in MONEY_FIELDS or f in INT_FIELDS) and number(v) is not None]
    return not named.get('name') and not named.get('city') and len(sums) >= 2


def parse_tables(rows: list[list[str]]) -> dict:
    """Rows of one report, read under the heading row each table starts with.
    Returns the records (each with the row's quote), the TOTALS row by field,
    and the headings.

    A scattered-site application prints one row with the totals and no city,
    then one row per site with a name, address and city and nothing else;
    the sites are folded into that application."""
    fields: list[str | None] | None = None
    header: list[str] = []
    records, totals = [], {}
    for row in rows:
        cells = [clean(c) for c in row]
        flds = heading_fields(row)
        if 'name' in flds and 'city' in flds:
            fields, header = flds, row   # a heading row (repeated on later pages)
            continue
        if fields is None:
            continue
        if is_total_row(cells, fields):
            for f, c in zip(fields, cells):
                if f in MONEY_FIELDS or f in INT_FIELDS:
                    v = number(c)
                    if v is not None and f not in totals:
                        totals[f] = v
            continue
        rec = {}
        for f, c in zip(fields, cells):
            if f is None or not c:
                continue
            if f in MONEY_FIELDS or f in INT_FIELDS:
                rec[f] = number(c)
            else:
                # "Application*" marks a request for the accelerated state credit
                rec[f] = c.rstrip('*').strip() if f == 'stage' else c
        quote = quote_of(header, fields, row)
        numbers = any(f in MONEY_FIELDS or f in INT_FIELDS for f in rec)
        if rec.get('name') and rec.get('city') and not numbers and not rec.get('stage') and not rec.get('type') \
                and records and records[-1].get('_parent'):
            site = {k: rec.get(k) for k in ('name', 'address', 'city')}
            parent = records[-1]
            parent.setdefault('sites', []).append(site)
            parent['quote'] += ' | Site: ' + ', '.join(v for v in site.values() if v)
            continue
        if rec.get('name') and not rec.get('city') and numbers:
            rec['_parent'] = True
            rec['quote'] = quote
            records.append(rec)
            continue
        # an abbreviation key or a footnote fills one cell and names no city
        if not rec.get('name') or not rec.get('city'):
            continue
        rec['quote'] = quote
        records.append(rec)
    for rec in records:
        if rec.pop('_parent', None):
            cities = list(dict.fromkeys(s['city'] for s in rec.get('sites', []) if s.get('city')))
            rec['city'] = ', '.join(cities) or None
    records = [r for r in records if r.get('city')]
    return {'records': records, 'totals': totals, 'fields': [f for f in (fields or []) if f]}


def reconcile(parsed: dict) -> dict:
    """Each column the TOTALS row sums must equal the sum of the parsed rows.
    Rolling lists total only some stages, so they are checked against nothing."""
    totals = parsed['totals']
    if not totals:
        return {'status': 'no_total_line', 'checks': []}
    checks = []
    for f, want in sorted(totals.items()):
        got = sum(r.get(f) or 0 for r in parsed['records'])
        checks.append({'field': f, 'pdf_total': want, 'parsed_total': got,
                       'ok': abs(got - want) <= (len(parsed['records']) if f in MONEY_FIELDS else 0)})
    return {'status': 'ok' if all(c['ok'] for c in checks) else 'mismatch', 'checks': checks}


# ── places ───────────────────────────────────────────────────────────────────

def norm_name(s: str) -> str:
    s = clean(s).lower().replace('&', ' and ')
    s = re.sub(r'\([^)]*\)', ' ', s)
    s = re.sub(r'[^a-z0-9 ]+', ' ', s)
    abbrev = {'st': 'street', 'ave': 'avenue', 'av': 'avenue', 'blvd': 'boulevard', 'rd': 'road',
              'apts': 'apartments', 'apt': 'apartments', 'dr': 'drive', 'pkwy': 'parkway',
              'n': 'north', 's': 'south', 'e': 'east', 'w': 'west', 'ii': '2', 'iii': '3', 'i': '1',
              'ph': 'phase'}
    words = [abbrev.get(w, w) for w in s.split()]
    drop = {'the', 'apartments', 'at', 'of', 'and', 'residences', 'homes', 'lofts'}
    return ' '.join(w for w in words if w not in drop)


def name_key(name: str, city: str) -> str:
    return norm_name(name) + '|' + awards.norm(city or '')


def exclusion_hash(name: str, city: str) -> str:
    return hashlib.sha256(name_key(name, city).encode()).hexdigest()


def load_places() -> dict[str, str]:
    """Normalized place label → 7-digit GEOID, for labels naming one place."""
    geo = awards.read_json(awards.GEO_CONFIG)
    seen: dict[str, set] = {}
    for p in geo['places'] + geo['cdps']:
        seen.setdefault(awards.norm(p['label']), set()).add(p['geoid'])
    return {k: next(iter(v)) for k, v in seen.items() if len(v) == 1}


# ── outcomes ─────────────────────────────────────────────────────────────────

def similar(a: str, b: str) -> bool:
    """Two normalized project names are the same project: equal, one inside the
    other, or sharing most of their words (an applicant report says
    "1001 Lincoln St", the award report "1001 Lincoln Street")."""
    if not a or not b:
        return False
    if a == b or (len(a) >= 5 and a in b) or (len(b) >= 5 and b in a):
        return True
    wa, wb = set(a.split()), set(b.split())
    return len(wa & wb) >= 2 and len(wa & wb) / len(wa | wb) >= 0.6


ROLLING_4PCT_AWARDS = re.compile(r'^federal-4-housing-tax-credit-award-report\.pdf$', re.I)


def answers(app: dict, aw: dict) -> bool:
    """Whether an award answers this application: the same round's award
    report, or, for a 4% request, CHFA's rolling federal 4% award report in a
    later year. A project that lost a round and won the next is not awarded in
    the first; link_reapplications shows the later win."""
    year = aw.get('year') or 0
    if app['rolling'] or (app['credit_type'] == '4%' and ROLLING_4PCT_AWARDS.match(aw.get('source_file') or '')):
        return (app['year'] or 0) <= year <= (app['year'] or 0) + 2
    if year != app['year']:
        return False
    return app['credit_type'] == 'MIHTC' or aw.get('round') in (None, app['round'])


def same_place(app: dict, aw: dict) -> bool:
    """The award ledger's location can carry a neighbouring column ("Pueblo
    CHFA", "Adams County Housing Authority Westminster"), so the applicant's
    city counts when it appears in it as whole words; otherwise the county."""
    city = awards.norm(app.get('city') or '')
    loc = awards.norm(aw.get('location') or '')
    if city and loc and re.search(r'(?:^| )' + re.escape(city) + r'(?: |$)', loc):
        return True
    return aw.get('county_fips') is not None and aw.get('county_fips') == app.get('county_fips')


def round_awards(app: dict, ledger: list[dict]) -> list[dict]:
    program = PROGRAM_OF.get(app['credit_type'])
    return [aw for aw in ledger if aw.get('agency') == 'CHFA' and aw.get('program') == program
            and aw.get('name') and answers(app, aw)]


def find_award(app: dict, ledger: list[dict]) -> dict | None:
    a = norm_name(app['name'])
    for aw in round_awards(app, ledger):
        if same_place(app, aw) and similar(a, norm_name(aw['name'])):
            return aw
    return None


def award_published(statuses: list[dict], year: int | None, rnd: int | None, credit_type: str) -> dict | None:
    program = PROGRAM_OF.get(credit_type)
    for s in statuses:
        if (s.get('agency') == 'CHFA' and s.get('program') == program and s.get('year') == year
                and (credit_type == 'MIHTC' or s.get('round') == rnd)
                and s.get('status') in awards.USABLE):
            return s
    return None


def outcome(app: dict, ledger: list[dict], statuses: list[dict]) -> None:
    aw = find_award(app, ledger)
    if aw:
        app['outcome'] = 'awarded'
        app['outcome_detail'] = (f"On CHFA's award report {aw['source_file']}"
                                 + (f" ({aw['year']})" if aw.get('year') else ''))
        app['award'] = {'name': aw['name'], 'year': aw.get('year'), 'round': aw.get('round'),
                        'program': aw['program'], 'source_url': aw['source_url']}
        app['_award'] = app['_award_ref'] = aw
        return
    if app['rolling']:
        if (app.get('stage') or '').lower().startswith('loi'):
            app['outcome'], app['outcome_detail'] = 'letter_of_intent', 'Letter of intent on CHFA\'s rolling list; no application yet'
        else:
            app['outcome'], app['outcome_detail'] = 'in_review', 'Application on CHFA\'s rolling list; no award found yet'
        return
    doc = award_published(statuses, app['year'], app['round'], app['credit_type'])
    if doc is None:
        app['outcome'] = 'pending'
        app['outcome_detail'] = f"CHFA has not published the {app['round_label']} award report yet"
        return
    app['outcome'] = 'not_awarded'
    app['outcome_detail'] = (f"Not on CHFA's {app['round_label']} award report ({doc['file']})"
                             + (" or its federal 4% award report" if app['credit_type'] == '4%' else '')
                             + '. CHFA does not publish reasons.')


def link_reapplications(apps: list[dict]) -> None:
    """The same project in a later round, so a reader sees a loss followed by
    a win (or a second loss) without reading both rounds."""
    order = sorted(apps, key=lambda a: (a['year'] or 0, a['round'] or 0))
    for i, a in enumerate(order):
        later = [b for b in order[i + 1:] if b is not a and b['city'] == a['city']
                 and similar(norm_name(a['name']), norm_name(b['name']))
                 and (b['year'], b['round']) != (a['year'], a['round'])]
        if later:
            a['later_applications'] = [{'round_label': b['round_label'], 'credit_type': b['credit_type'],
                                        'outcome': b['outcome']} for b in later]


# ── build ────────────────────────────────────────────────────────────────────

def quote_of(header: list[str], fields: list[str | None], raw: list[str]) -> str:
    """The row as CHFA prints it, heading by heading, without the contact columns."""
    parts = []
    for h, f, c in zip(header, fields, raw):
        if f is None or not clean(c):
            continue
        parts.append(f'{clean(h)}: {clean(c)}')
    return '; '.join(parts)


def build_document(doc: dict, rows: list[list[str]], texts: list[str], ctx: dict) -> tuple[list[dict], dict]:
    meta = doc_meta(doc['file'])
    parsed = parse_tables(rows)
    check = reconcile(parsed)
    status = {'file': doc['file'], 'url': doc['url'], 'round_label': round_label(meta),
              'credit_type': meta['credit_type'], 'rows': len(parsed['records']), **check}
    as_of = None
    m = re.search(r'as of\s+(\d{1,2})/(\d{1,2})/(\d{4})', ' '.join(texts), re.I)
    if m:
        as_of = f'{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}'
        status['as_of'] = as_of
    if check['status'] == 'mismatch' or meta['credit_type'] is None:
        if meta['credit_type'] is None:
            status['status'] = 'unclassified'
        return [], status
    out = []
    for rec in parsed['records']:
        quote = rec['quote']
        if exclusion_hash(rec['name'], rec['city']) in ctx['excluded']:
            status['excluded'] = status.get('excluded', 0) + 1
            continue
        app = {
            'year': meta['year'] if not meta['rolling'] else (int(as_of[:4]) if as_of else None),
            'round': meta['round'], 'round_label': round_label(meta), 'rolling': meta['rolling'],
            'credit_type': meta['credit_type'],
        }
        for f in TEXT_FIELDS + INT_FIELDS + MONEY_FIELDS:
            app[f] = rec.get(f)
        probe = {'name': rec['name'], 'location': rec['city']}
        awards.assign_county(probe, ctx['counties'], ctx['county_places'], ctx['names'])
        app['county_fips'] = probe['county_fips']
        if probe.get('county_unavailable_reason'):
            app['county_unavailable_reason'] = probe['county_unavailable_reason']
        cities = [c.strip() for c in rec['city'].split(',') if c.strip()]
        # every place and county the application builds in, so a scattered-site
        # application shows in each jurisdiction it touches
        app['place_geoids'] = sorted({g for g in (ctx['places'].get(awards.norm(c)) for c in cities) if g})
        counties = set()
        for c in cities:
            one = {'name': None, 'location': c}
            awards.assign_county(one, ctx['counties'], ctx['county_places'], ctx['names'])
            if one['county_fips']:
                counties.add(one['county_fips'])
        if app['county_fips']:
            counties.add(app['county_fips'])
        app['county_fips_all'] = sorted(counties)
        if rec.get('sites'):
            app['sites'] = rec['sites']
        for f in ('name', 'sponsor', 'address'):
            if app.get(f) and any(p.search(app[f]) for p in ctx['sensitive']):
                app[f] = None
                app[f + '_unavailable_reason'] = 'withheld: matches text the public build excludes'
        if any(p.search(quote) for p in ctx['sensitive']):
            quote = None
        app['quote'] = quote
        app['source_file'], app['source_url'] = doc['file'], doc['url']
        if as_of:
            app['source_as_of'] = as_of
        out.append(app)
    return out, status


def context() -> dict:
    counties, county_places = awards.load_geo()
    try:
        excluded = {e['sha256'] for e in awards.read_json(EXCLUDED).get('excluded', [])}
    except (OSError, ValueError):
        excluded = set()
    return {'counties': counties, 'county_places': county_places, 'names': awards.lihtc_names(),
            'places': load_places(), 'sensitive': awards.sensitive_patterns(), 'excluded': excluded}


def award_only_row(aw: dict, ctx: dict) -> dict:
    loc = aw.get('location') or ''
    place = next((g for k, g in ctx['places'].items() if k and re.search(r'(?:^| )' + re.escape(k) + r'(?: |$)', awards.norm(loc))), None)
    quote = '; '.join(f'{label}: {v}' for label, v in (
        ('Name', aw.get('name')), ('Location', loc or None), ('Sponsor', aw.get('sponsor')),
        ('Federal 4% credit', f"${aw['federal_credit']:,}" if aw.get('federal_credit') else None),
        ('Year', aw.get('year'))) if v)
    return {
        'year': aw.get('year'), 'round': None, 'round_label': 'Federal 4% award', 'rolling': True,
        'credit_type': '4%', 'stage': None, 'type': None, 'name': aw['name'], 'address': None, 'city': loc or None,
        'sponsor': aw.get('sponsor'), 'pab_issuer': None,
        'total_units': aw.get('total_units'), 'restricted_units': aw.get('restricted_units'),
        'federal_credit_requested': None, 'state_credit_requested': None,
        'accelerated_state_credit_requested': None, 'toc_credit_requested': None,
        'mihtc_credit_requested': None, 'pab_requested': None,
        'county_fips': aw.get('county_fips'), 'place_geoids': [place] if place else [],
        'county_fips_all': [aw['county_fips']] if aw.get('county_fips') else [],
        'quote': quote, 'source_file': aw['source_file'], 'source_url': aw['source_url'],
        'outcome': 'awarded', 'award_only': True,
        'outcome_detail': ("On CHFA's federal 4% award report; awarded without a state credit round, "
                           "so CHFA keeps no applicant report for it"),
        'award': {'name': aw['name'], 'year': aw.get('year'), 'round': None,
                  'program': aw['program'], 'source_url': aw['source_url']},
    }


def finish(apps: list[dict], ledger: list[dict], statuses: list[dict], first_year: int, ctx: dict) -> list[dict]:
    for a in apps:
        outcome(a, ledger, statuses)
    # One award answers one application: when a project applied twice and the
    # rolling 4% report shows one award, it goes to the later application.
    by_award: dict[int, list[dict]] = {}
    for a in apps:
        if a.get('award'):
            by_award.setdefault(id(a['_award']), []).append(a)
    for group in by_award.values():
        group.sort(key=lambda a: (a['year'] or 0, a['round'] or 0))
        for a in group[:-1]:
            a.pop('award')
            a.pop('_award_ref', None)
            outcome(a, [], statuses)
    for a in apps:
        a.pop('_award', None)
    # A decided round whose award report lists an award in this place that
    # matches no application by name: the project may have been renamed, so
    # "not awarded" would be a guess.
    claimed = {id(a['_award_ref']) for a in apps if a.get('_award_ref') is not None}
    for a in apps:
        if a['outcome'] != 'not_awarded':
            continue
        words = {w for w in norm_name(a['name']).split() if len(w) >= 3 and not w.isdigit()}
        loose = [aw for aw in round_awards(a, ledger) if id(aw) not in claimed and same_place(a, aw)
                 and not ROLLING_4PCT_AWARDS.match(aw.get('source_file') or '')
                 and words & set(norm_name(aw['name']).split())]
        if loose:
            a['outcome'] = 'unresolved'
            a['outcome_detail'] = (f"The {a['round_label']} award report lists "
                                   + ', '.join(f"\"{aw['name']}\"" for aw in loose)
                                   + ' here, matching no application by name; this may be the same project under another name.')
    for a in apps:
        a.pop('_award_ref', None)
    # Federal 4% awards made outside a Round Two (bond-only deals) were never
    # on an applicant report CHFA keeps; they are activity here all the same.
    for aw in ledger:
        if (aw.get('agency') == 'CHFA' and ROLLING_4PCT_AWARDS.match(aw.get('source_file') or '')
                and (aw.get('year') or 0) >= first_year and id(aw) not in claimed and aw.get('name')):
            apps.append(award_only_row(aw, ctx))
    link_reapplications(apps)
    apps.sort(key=lambda a: (-(a['year'] or 0), -(a['round'] or 9), a['credit_type'], a['name'] or ''))
    return apps


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--cache', help='directory to keep downloaded PDFs (default: a temp dir)')
    ap.add_argument('--check', action='store_true', help='parse and report; write nothing')
    args = ap.parse_args()
    cache = args.cache or tempfile.mkdtemp(prefix='lihtc-applications-')
    os.makedirs(cache, exist_ok=True)

    try:
        docs = awards.discover(SOURCE)
    except Exception as exc:
        print(f'Applicant reports page unreachable ({exc.__class__.__name__}: {exc}); '
              'leaving the list as it is.', file=sys.stderr)
        return 1
    metas = {d['file']: doc_meta(d['file']) for d in docs}
    years = [m['year'] for m in metas.values() if m['year'] and not m['rolling']]
    if not years:
        print('No applicant reports discovered; leaving the list as it is.', file=sys.stderr)
        return 1
    first_year = max(years) - YEARS_KEPT + 1
    keep = [d for d in docs if metas[d['file']]['rolling'] or (metas[d['file']]['year'] or 0) >= first_year]

    ctx = context()
    ledger = awards.read_json(LEDGER)['awards']
    award_statuses = awards.read_json(DOCUMENTS)['documents']
    apps, statuses = [], []
    for doc in keep:
        path = os.path.join(cache, doc['file'])
        try:
            if not os.path.exists(path):
                with open(path, 'wb') as fh:
                    fh.write(awards.http_get(doc['url']))
            rows, texts = read_tables(path)
        except Exception as exc:  # network, not-a-PDF, pdfplumber failure
            statuses.append({'file': doc['file'], 'url': doc['url'], 'status': 'error',
                             'error': f'{exc.__class__.__name__}: {exc}'})
            continue
        got, status = build_document(doc, rows, texts, ctx)
        apps.extend(got)
        statuses.append(status)
    finish(apps, ledger, award_statuses, first_year, ctx)
    statuses.sort(key=lambda s: s['file'])
    for s in statuses:
        print(f"{s['status']:<14} {s.get('rows', 0):>3} rows  {s['file']}")
    bad = [s for s in statuses if s['status'] not in ('ok', 'no_total_line')]
    print(f'{len(apps)} applications from {len(statuses) - len(bad)} reports; {len(bad)} reports not used')
    if args.check:
        return 0
    if any(s['status'] == 'error' for s in statuses):
        # writing now would drop an unreachable report's applicants
        print('A report could not be read; leaving the list as it is.', file=sys.stderr)
        return 1

    now = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    prior = {}
    if os.path.exists(OUT):
        try:
            prior = awards.read_json(OUT)
        except ValueError:
            prior = {}
    if prior.get('applications') == apps:
        now = prior.get('meta', {}).get('generated_at', now)
    meta = {
        'generated_at': now,
        'generator': 'scripts/funding/build_lihtc_applications.py',
        'source': SOURCE['index_url'],
        'first_year': first_year,
        'method': ("Each CHFA Applicant Report (and the rolling federal 4% and MIHTC lists) is read as a table; "
                   "a report whose rows do not add up to the TOTALS row it prints contributes none. Contact "
                   "names, emails and phones are not read. Outcomes are derived: a project counts as awarded "
                   "when the same name and city is on a CHFA award report in data/policy/funding-awards/ledger.json "
                   "for the same credit within two years; not_awarded only when that round's award report is "
                   "published and the project is on none. CHFA prints neither 'not awarded' nor 'withdrawn'."),
        'amount_note': 'Credit amounts are the ANNUAL amounts requested, as CHFA prints them.',
        'application_count': len(apps),
        'documents': statuses,
    }
    with open(OUT, 'w') as fh:
        json.dump({'meta': meta, 'applications': apps}, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    return 0


if __name__ == '__main__':
    sys.exit(main())
