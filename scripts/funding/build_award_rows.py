#!/usr/bin/env python3
"""
scripts/funding/build_award_rows.py — each award as its PDF prints it.

The award ledger (data/policy/funding-awards/ledger.json) is built from
`pdftotext -layout`, which is right about the numbers (every document is
checked against the total it prints) but splits a cell that wraps onto a
second line: a sponsor turns into "50" with the real name folded into the
project, or a town reads "Oak Trinidad". This script re-reads the same PDFs
as tables with pdfplumber, which keeps a wrapped cell in one piece, and finds
the table row each ledger award came from by its numbers: the amount the
ledger carries and its unit count must both be printed on the row.

For every ledger award it writes the project name, sponsor and town as
printed, and the row itself as the award's source quote, to
data/policy/funding-awards/award-rows.json. Contact columns (names, phones,
emails) are never read. The ledger is not changed: the agency funding view
reads both and keys one to the other (js/agency-funding-model.js ledgerKey).

A ledger award with no matching row, or with more than one, is listed under
`unmatched` with the reason, and keeps the ledger's own text on the page.

Usage:
  python3 scripts/funding/build_award_rows.py --cache DIR   # reuse/keep PDFs in DIR
  python3 scripts/funding/build_award_rows.py --check       # exit 1 if the file would change
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DIR = os.path.join(ROOT, 'data', 'policy', 'funding-awards')
LEDGER = os.path.join(DIR, 'ledger.json')
DOCUMENTS = os.path.join(DIR, 'documents.json')
OUTPUT = os.path.join(DIR, 'award-rows.json')
# CHFA's applicant reports name the sponsor of each federal 4% application;
# the rolling 4% award list does not. Read by scripts/funding/build_lihtc_applications.py.
APPLICATIONS = os.path.join(ROOT, 'data', 'jurisdiction-briefs', '_lihtc-applications.json')

CONTACT = ('contact', 'email', 'phone', 'first name', 'last name', 'zip')

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_funding_awards import sensitive_patterns  # noqa: E402  the public-artifact guard's list, read from one place

SENSITIVE = sensitive_patterns()


def sensitive(text: str | None) -> bool:
    return bool(text) and any(p.search(text) for p in SENSITIVE)


def clean(s) -> str:
    s = re.sub('[‐‑‒–—]', '-', s or '')
    return re.sub(r'\s+', ' ', s).strip()


def field_of(heading: str) -> str | None:
    h = clean(heading).lower().strip('*')
    if not h or any(k in h for k in CONTACT):
        return None
    if any(k in h for k in ('sponsor', 'owner', 'borrower', 'grantee', 'applicant', 'developer')):
        return 'sponsor'
    if h == 'city' or 'location' in h:
        return 'location'
    if 'county' == h:
        return 'county'
    if h in ('name', 'project', 'property name', 'project name') or h.startswith('project name'):
        return 'name'
    if 'address' in h:
        return 'address'
    return 'other'


def number(s: str) -> int | None:
    s = clean(s).replace('$', '').replace(',', '').replace(' ', '').strip('*')
    if not re.fullmatch(r'\d+(?:\.\d+)?', s):
        return None
    return int(round(float(s)))


def read_tables(path: str) -> tuple[list[list[str]], list[str]]:
    import pdfplumber
    rows, lines = [], []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                rows.extend([[(c or '') for c in r] for r in table])
            lines.extend(clean(l) for l in (page.extract_text() or '').splitlines())
    return rows, lines


def line_quote(r: dict, lines: list[str]) -> str | None:
    """The one printed line carrying this award's amount, when the table
    reader could not split the row into cells."""
    a = ledger_amount(r)
    if a is None:
        return None
    hits = [l for l in lines if f'${a:,}' in l and not sensitive(l)]
    return hits[0] if len(hits) == 1 else None


# 2016 Round One prints its whole heading row in one cell, so the columns are
# known only by position. These are its headings, in order, as printed.
SINGLE_CELL_HEADINGS = {
    'Type Name Address City Credit Credit Units Units AMI AMI AMI AMI Ownership':
        ['Type', 'Name', 'Address', 'City', '4% Federal Credit', 'State Credit', 'Total Units', 'LI Units',
         '30% AMI', '40% AMI', '50% AMI', '60% AMI', 'Ownership', 'First Name', 'Last Name', 'Phone', 'Email'],
}


def single_cell_header(raw: list[str]) -> list[str] | None:
    text = clean(raw[0]) if raw else ''
    if not text or any(clean(c) for c in raw[1:]):
        return None
    for key, headings in SINGLE_CELL_HEADINGS.items():
        if key in text and len(raw) == len(headings):
            return headings
    return None


def table_rows(rows: list[list[str]]) -> list[dict]:
    """Each data row under the heading row its table starts with. A row that
    pdfplumber could not split into cells keeps its printed text as the quote
    and its numbers, but no name, sponsor or town."""
    out, header, fields = [], None, None
    for raw in rows:
        named = single_cell_header(raw)
        flds = [field_of(c) for c in (named or raw)]
        if named:
            flds = ['other' if f is None and h == 'Ownership' else f for f, h in zip(flds, named)]
            flds = ['sponsor' if h == 'Ownership' else f for f, h in zip(flds, named)]
        if 'name' in flds and ('location' in flds or 'sponsor' in flds):
            header, fields = (named or raw), flds
            continue
        if fields is None:
            continue
        cells = [clean(c) for c in raw]
        if any(re.fullmatch(r'totals?:?', c, re.I) for c in cells):
            continue
        filled = [c for c in cells if c]
        if len(raw) != len(fields):
            if len(filled) == 1 and re.search(r'\$[\d,]+', filled[0]) and not sensitive(filled[0]):
                nums = {number(m) for m in re.findall(r'\$?[\d,]+(?:\.\d+)?', filled[0])} - {None}
                out.append({'numbers': nums, 'quote': ' | '.join(clean(h) for h in header) + ' — ' + filled[0]})
            continue
        rec = {'numbers': set(), 'quote': []}
        for h, f, c in zip(header, fields, cells):
            if f is None or not c:
                continue
            if sensitive(c):
                # The public build refuses this text, so the cell is left out of the record and the quote.
                rec['quote'].append(f'{clean(h)}: [not shown]')
                rec.setdefault('withheld', True)
                continue
            n = number(c)
            if n is not None:
                c = re.sub(r'(?<=[$\d,])\s+(?=[\d,])', '', c)  # "$ 2 ,500,000" as printed, without the stray spaces
            rec['quote'].append(f'{clean(h)}: {c}')
            if n is not None:
                rec['numbers'].add(n)
            elif f in ('name', 'sponsor', 'location') and f not in rec:
                rec[f] = c
        if rec.get('name') and rec['numbers']:
            rec['quote'] = '; '.join(rec['quote'])
            out.append(rec)
    return out


def ledger_amount(r: dict):
    for k in ('amount_awarded', 'amount_requested', 'federal_credit', 'mihtc_credit'):
        if r.get(k) is not None:
            return r[k]
    return None


def ledger_units(r: dict):
    return r['restricted_units'] if r.get('restricted_units') is not None else r.get('total_units')


def base_key(r: dict) -> str:
    a, u = ledger_amount(r), ledger_units(r)
    return '|'.join([r['source_file'], '' if a is None else str(a), '' if u is None else str(u)])


def ledger_keys(awards: list[dict]) -> list[str]:
    """One key per ledger award: file, amount and units, then a counter for
    awards that share all three (CHFA awards the per-project cap to several
    projects of the same size in one round). Must equal ledgerKeys() in
    js/agency-funding-model.js."""
    seen: dict[str, int] = {}
    keys = []
    for r in awards:
        b = base_key(r)
        seen[b] = seen.get(b, 0) + 1
        keys.append(f'{b}#{seen[b]}')
    return keys


def words(s: str) -> set[str]:
    return set(re.findall(r'[a-z0-9]+', (s or '').lower()))


def match(r: dict, rows: list[dict]) -> tuple[dict | None, str | None]:
    a, u = ledger_amount(r), ledger_units(r)
    if a is None:
        return None, 'the ledger row carries no amount to match on'
    cands = [t for t in rows if a in t['numbers'] and (u is None or u in t['numbers'])]
    if len(cands) > 1:
        # Two rows with the same amount and units: the one sharing most words with the ledger's text.
        w = words(f"{r.get('name')} {r.get('sponsor')} {r.get('location')}")
        scored = sorted(cands, key=lambda t: -len(w & words(f"{t.get('name')} {t.get('sponsor')} {t.get('location')}")))
        best = len(w & words(f"{scored[0].get('name')} {scored[0].get('sponsor')} {scored[0].get('location')}"))
        second = len(w & words(f"{scored[1].get('name')} {scored[1].get('sponsor')} {scored[1].get('location')}"))
        if best == second:
            return None, 'more than one printed row has this amount and unit count'
        cands = scored[:1]
    if not cands:
        return None, 'no printed row has this amount and unit count'
    return cands[0], None


def name_key(s: str | None) -> str:
    s = re.sub(r'\([^)]*\)', ' ', (s or '').lower())
    return ' '.join(re.findall(r'[a-z0-9]+', s))


def sponsor_from_applications(r: dict, row: dict, apps: list[dict]) -> dict | None:
    """The sponsor CHFA's applicant report prints for this 4% award: the
    application with the same project name and city. None unless exactly one
    sponsor matches."""
    if row.get('sponsor') or r.get('federal_credit_type') != '4%':
        return None
    name, city = name_key(row.get('name') or r.get('name')), name_key(row.get('location') or r.get('location'))
    hits = [a for a in apps if a.get('credit_type') == '4%' and a.get('sponsor') and name_key(a.get('name')) == name
            and name_key(a.get('city')) == city and not sensitive(a.get('sponsor'))]
    sponsors = {a['sponsor'] for a in hits}
    if len(sponsors) != 1:
        return None
    a = max(hits, key=lambda x: x.get('year') or 0)
    return {'sponsor': a['sponsor'], 'sponsor_source': f"CHFA applicant report, {a.get('round_label') or a.get('year')}: {a.get('quote')}"}


def fetch(url: str, path: str) -> None:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (COHO Analytics award reader)'})
    with urllib.request.urlopen(req, timeout=60) as resp, open(path, 'wb') as fh:
        fh.write(resp.read())


def build(cache: str) -> dict:
    ledger = json.load(open(LEDGER, encoding='utf-8'))
    docs = {d['file']: d for d in json.load(open(DOCUMENTS, encoding='utf-8'))['documents']}
    by_file: dict[str, list[dict]] = {}
    keys = {}
    for r, k in zip(ledger['awards'], ledger_keys(ledger['awards'])):
        by_file.setdefault(r['source_file'], []).append(r)
        keys[id(r)] = k
    apps = json.load(open(APPLICATIONS, encoding='utf-8')).get('applications', []) if os.path.exists(APPLICATIONS) else []
    out, unmatched = [], []
    for file in sorted(by_file):
        path = os.path.join(cache, file)
        if not os.path.exists(path):
            fetch(docs[file]['url'], path)
        tables, lines = read_tables(path)
        rows = table_rows(tables)
        used: set[int] = set()  # indexes of printed rows already matched
        for r in by_file[file]:
            t, why = match(r, [x for i, x in enumerate(rows) if i not in used])
            if t is None and line_quote(r, lines):
                out.append({'key': keys[id(r)], 'source_file': file, 'name': None, 'sponsor': None,
                            'location': None, 'quote': 'Line as printed: ' + line_quote(r, lines)})
                continue
            if t is None:
                unmatched.append({'key': keys[id(r)], 'source_file': file, 'ledger_name': r.get('name'), 'reason': why})
                continue
            used.add(next(i for i, x in enumerate(rows) if x is t))
            rec = {'key': keys[id(r)], 'source_file': file, 'name': t.get('name'), 'sponsor': t.get('sponsor'),
                   'location': t.get('location'), 'quote': t['quote']}
            extra = sponsor_from_applications(r, rec, apps)
            if extra:
                rec.update(extra)
            out.append(rec)
    return {
        'meta': {
            'generator': 'scripts/funding/build_award_rows.py',
            'ledger_generated_at': ledger['meta'].get('generated_at'),
            'method': 'Each award PDF read as tables with pdfplumber; each ledger award matched to the printed row that '
                      'carries both its amount and its unit count. Contact columns are never read. The quote is the row '
                      'as printed, heading by heading.',
            'rows': len(out),
            'unmatched': len(unmatched),
            'sponsors_from_applications': sum(1 for r in out if r.get('sponsor_source')),
        },
        'rows': out,
        'unmatched': unmatched,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', help='directory to keep downloaded PDFs (default: a temp dir)')
    ap.add_argument('--check', action='store_true', help='exit 1 if award-rows.json would change')
    args = ap.parse_args()
    cache = args.cache or tempfile.mkdtemp(prefix='award-rows-')
    os.makedirs(cache, exist_ok=True)
    result = build(cache)
    text = json.dumps(result, indent=2, ensure_ascii=False) + '\n'
    if args.check:
        current = open(OUTPUT, encoding='utf-8').read() if os.path.exists(OUTPUT) else ''
        if current != text:
            print(f'{os.path.relpath(OUTPUT, ROOT)} is stale: run python3 scripts/funding/build_award_rows.py', file=sys.stderr)
            return 1
        return 0
    with open(OUTPUT, 'w', encoding='utf-8') as fh:
        fh.write(text)
    print(f"{result['meta']['rows']} awards matched to their printed row, {result['meta']['unmatched']} unmatched")
    for u in result['unmatched']:
        print(f"  unmatched: {u['source_file']}: {u['ledger_name']} ({u['reason']})")
    return 0


if __name__ == '__main__':
    sys.exit(main())
