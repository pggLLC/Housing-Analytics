#!/usr/bin/env python3
"""Build data/policy/prop123_jurisdictions.json from DOLA's own Prop 123 lists.

DOLA publishes four lists, and this file joins them by jurisdiction:

  1. First-cycle (2024-2026) commitment filings: a Google Sheet linked from
     https://cdola.colorado.gov/commitment-filings (217 rows, 22,988 units).
  2. Expedited review ("fast track") policies DOLA has verified: a Google
     Sheet linked from https://cdola.colorado.gov/prop123fasttrack
  3. Jurisdictions DOLA has verified as meeting every statutory requirement
     (fast track plus the unit commitment): the table on
     https://cdola.colorado.gov/fully-compliant-jurisdictions-under-proposition-123
  4. Second-cycle (2027-2029) commitments filed in 2026: the table on the
     commitment-filings page. It grows until the November 1 deadline.

Until 2026-10 the file was typed by hand and had drifted far from DOLA's
lists: 62 of its 217 names were jurisdictions DOLA does not list (and 62 that
DOLA does list were missing), 155 filing dates disagreed, and it still showed
one jurisdiction as having met its commitment when DOLA had verified 41.

Usage:
  python3 scripts/policy/build_prop123_jurisdictions.py
  python3 scripts/policy/build_prop123_jurisdictions.py --from-dir DIR

After writing, it rebuilds data/policy/housing-policy-scorecard.json, which
derives prop123_committed from this file, and runs validate-schemas.

--from-dir reads saved copies (cycle1.csv, fasttrack.csv, commitment-filings.html,
fully-compliant.html) instead of fetching. The script refuses to write when a
list parses to fewer rows than DOLA states, or when a name in lists 2-4 cannot
be placed, so a changed page leaves the committed file as it was.
"""

import argparse
import csv
import io
import json
import os
import re
import subprocess
import sys
import urllib.request
from html.parser import HTMLParser
from datetime import date, datetime

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUTPUT = os.path.join(ROOT, 'data', 'policy', 'prop123_jurisdictions.json')

FILINGS_PAGE = 'https://cdola.colorado.gov/commitment-filings'
COMPLIANT_PAGE = 'https://cdola.colorado.gov/fully-compliant-jurisdictions-under-proposition-123'
FAST_TRACK_PAGE = 'https://cdola.colorado.gov/prop123fasttrack'
CYCLE1_SHEET = 'https://docs.google.com/spreadsheets/d/1xpZFV506S-nws4oSf-nXJDs168calx620FYDiLqwN9o/export?format=csv&gid=0'
FAST_TRACK_SHEET = 'https://docs.google.com/spreadsheets/d/1MNi6SG8rNaXxVojOAYOMhcz2SmrUCjrjdEhJqgYCSG8/export?format=csv&gid=0'

# DOLA's page states these for the first cycle; the sheet must agree.
CYCLE1_FILINGS = 217
CYCLE1_UNITS = 22988

# DOLA's cdola.colorado.gov answers a non-browser user agent with 403.
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'

# Misspellings in DOLA's lists, mapped to the cycle-1 spelling.
ALIASES = {
    'ridgeway': 'ridgway',
    'plateville': 'platteville',
}

TRIBES = {
    'southern ute': 'Southern Ute Indian Tribe',
    'ute mountain ute': 'Ute Mountain Ute Tribe',
}

NOTE = (
    'Local government Proposition 123 affordable housing commitments, joined from DOLA\'s '
    'own lists: first-cycle (2024-2026) commitment filings, verified expedited review '
    '("fast track") policies, jurisdictions verified as meeting every statutory requirement, '
    'and second-cycle (2027-2029) commitments filed so far in 2026. Built by '
    'scripts/policy/build_prop123_jurisdictions.py. HB26-1313 (signed and effective '
    '2026-05-26 under its safety clause) replaces the 3% annual-growth eligibility requirement '
    'with permit-and-job-growth targets beginning the 3-year cycle on 2027-01-01; the '
    'required_commitment values below describe the current cycle.'
)


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode('utf-8')


class _TableParser(HTMLParser):
    """Collects the text of every table cell, row by row.

    An HTML parser rather than regular expressions, so markup inside a cell
    (DOLA wraps numbers in <p>) and odd tag spellings are handled the way a
    browser would. Text outside a cell is ignored.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows, self._row, self._cell = [], None, None

    def handle_starttag(self, tag, attrs):
        if tag == 'tr':
            self._row = []
        elif tag in ('td', 'th') and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag):
        if tag in ('td', 'th') and self._cell is not None:
            self._row.append(re.sub(r'\s+', ' ', ''.join(self._cell)).strip())
            self._cell = None
        elif tag == 'tr' and self._row is not None:
            self.rows.append(self._row)
            self._row = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def table_rows(src):
    """Cell text of every <tr> on a page, header rows included."""
    p = _TableParser()
    p.feed(src)
    p.close()
    return p.rows


def iso(d):
    d = (d or '').strip()
    if not d:
        return None
    for fmt in ('%m/%d/%Y', '%m/%d/%y'):
        try:
            return datetime.strptime(d, fmt).date().isoformat()
        except ValueError:
            pass
    raise ValueError('unparseable date: %r' % d)


def to_int(v):
    v = (v or '').replace(',', '').strip()
    return int(v) if re.fullmatch(r'\d+', v) else None


def parse_name(raw):
    """DOLA writes "Akron, Town of", "Adams, County of" or "Adams County".

    Returns (key, display name, kind, type). The display name follows the
    form this file has always used ("Town of Akron", "Adams County").
    """
    n = re.sub(r'\s+', ' ', raw).strip()
    m = re.fullmatch(r'(.+?),\s*(Town|City|County|City and County|Tribe)(?: of)?', n, flags=re.I)
    # The fast-track sheet also drops the comma ("Parker Town of"); only the
    # trailing "of" marks that form, so a bare "Lake City" stays a name.
    m = m or re.fullmatch(r'(.+?)\s+(Town|City|City and County) of', n, flags=re.I)
    if m:
        base, form = m.group(1).strip(), m.group(2).title().replace('And', 'and')
    elif re.search(r'\sCounty$', n, flags=re.I):
        base, form = re.sub(r'\s+County$', '', n, flags=re.I).strip(), 'County'
    else:
        m = re.fullmatch(r'(Town|City|City and County) of (.+)', n, flags=re.I)
        if m:
            form, base = m.group(1).title().replace('And', 'and'), m.group(2).strip()
        else:
            # A bare name ("Central City") in the later lists; place_key
            # resolves it against the cycle-1 filings.
            form, base = 'Municipality', n
    key_base = base.lower().replace('mt.', 'mount')
    key_base = ALIASES.get(key_base, key_base)
    if form == 'Tribe':
        return 'tribe:' + key_base, TRIBES.get(key_base, base + ' Tribe'), 'tribe', 'Tribe'
    if form == 'County':
        return 'county:' + key_base, base + ' County', 'county', 'County'
    if form == 'City and County':
        return 'citycounty:' + key_base, 'City and County of ' + base, 'county', 'City/County'
    if form == 'Municipality':
        return 'place:' + key_base, base, 'municipality', form
    return 'place:' + key_base, form + ' of ' + base, 'municipality', form


def place_key(index, raw):
    """Key for a name from lists 2-4, which spell some names differently."""
    key = parse_name(raw)[0]
    if key in index:
        return key
    base = key.split(':', 1)[1]
    # A city-and-county is listed as either; a "City of Central" is DOLA's
    # cycle-1 spelling of Central City.
    for alt in ('citycounty:' + base, 'place:' + base, 'county:' + base,
                'place:' + base.replace('central city', 'central')):
        if alt in index:
            return alt
    return None


def build(src):
    # 1. First-cycle filings.
    rows = list(csv.DictReader(io.StringIO(src['cycle1'])))
    units_col = next(c for c in rows[0] if c.lower().startswith('proposed'))
    records, index = [], {}
    for r in rows:
        name = (r.get('Jurisdiction') or '').strip()
        if not name:
            continue
        key, display, kind, typ = parse_name(name)
        if key in index:
            raise ValueError('duplicate jurisdiction in cycle-1 sheet: %s' % name)
        units = to_int(r[units_col])
        if units is None:
            raise ValueError('no unit count for %s' % name)
        rec = {
            'name': display,
            'kind': kind,
            'type': typ,
            'required_commitment': '3% annual affordable housing unit increase',
            'commitment_length': (r.get('Length of Commitment') or '').strip(),
            'proposed_units': units,
            'status': 'Committed',
            'filing_date': iso(r.get('Date of Commitment')),
            'source_url': FILINGS_PAGE,
            'fast_track': False,
            'fast_track_adopted': None,
            'fast_track_instrument': None,
            'compliance_verified': None,
            'next_cycle': None,
        }
        index[key] = rec
        records.append(rec)
    total = sum(r['proposed_units'] for r in records)
    if len(records) != CYCLE1_FILINGS or total != CYCLE1_UNITS:
        raise ValueError('cycle-1 sheet has %d filings / %d units; DOLA states %d / %d'
                         % (len(records), total, CYCLE1_FILINGS, CYCLE1_UNITS))

    unplaced = []
    fast_track_only = []

    # 2. Verified fast-track policies.
    ft_rows = list(csv.reader(io.StringIO(src['fasttrack'])))
    ft_updated = None
    ft_count = 0
    for r in ft_rows[1:]:
        name = (r[0] if r else '').strip()
        m = re.match(r'Last updated:\s*(\S+)', name)
        if m:
            ft_updated = iso(m.group(1))
            continue
        if not name or name.startswith('*'):
            continue
        ft_count += 1
        key = place_key(index, name)
        if key is None:
            # A government can adopt fast track without a first-cycle
            # commitment (it may file for the second cycle instead).
            fast_track_only.append({'name': parse_name(name)[1],
                                    'fast_track_adopted': iso(r[1]) if len(r) > 1 else None})
            continue
        rec = index[key]
        rec['fast_track'] = True
        rec['fast_track_adopted'] = iso(r[1]) if len(r) > 1 else None
        rec['fast_track_instrument'] = next((c.strip() for c in r[2:4] if c.strip()), None)
    if ft_count < 100:
        raise ValueError('fast-track sheet parsed to %d rows; expected 100 or more' % ft_count)

    # 3. Fully compliant (unit commitment met and fast track verified).
    met = 0
    items = []
    for row in table_rows(src['compliant']):
        if not row or not re.fullmatch(r'\d+', row[0]):
            continue
        items.append(int(row[0]))
        if len(row) < 5:
            raise ValueError('fully compliant row %s has %d cells, expected 5' % (row[0], len(row)))
        key = place_key(index, row[1])
        if key is None:
            unplaced.append(('fully compliant', row[1]))
            continue
        rec = index[key]
        rec['status'] = 'Commitment Met'
        rec['compliance_verified'] = {
            'expedited_review': iso(row[2]),
            'unit_commitment': iso(row[3]),
            'required_units_met': to_int(row[4]),
        }
        met += 1
    # DOLA numbers the rows 1..N; a gap means part of the table did not parse,
    # and resetting those jurisdictions to Committed would be wrong.
    if not items or sorted(items) != list(range(1, len(items) + 1)):
        raise ValueError('fully compliant table rows are not numbered 1..N: %s' % sorted(items)[:10])
    if met != len(items):
        raise ValueError('placed %d of %d fully compliant rows' % (met, len(items)))

    # 4. Second-cycle commitments filed in 2026.
    next_cycle = []
    for row in table_rows(src['filings']):
        if len(row) != 5 or not re.search(r'\d+/\d+/\d{4}', row[1]) or not re.search(r'years?', row[3]):
            continue
        key, display, kind, typ = parse_name(row[0])
        if to_int(row[4]) is None:
            # A goal DOLA has not stated is unknown, not zero; summing it as 0
            # would understate unit_goal_total.
            raise ValueError('second-cycle filing %s has no numeric unit goal: %r' % (row[0], row[4]))
        entry = {
            'submitted': iso(row[1]),
            'begins': iso(row[2]),
            'length': row[3],
            'unit_goal': to_int(row[4]),
        }
        placed = place_key(index, row[0])
        if placed is not None:
            index[placed]['next_cycle'] = entry
        next_cycle.append(dict({'name': index[placed]['name'] if placed else display}, **entry))
    if not next_cycle:
        raise ValueError('no second-cycle rows parsed from the commitment filings page')

    if unplaced:
        raise ValueError('names DOLA lists that match no cycle-1 filing: %s' % unplaced)

    records.sort(key=lambda r: (r['kind'] != 'county', r['name'].lower()))
    return {
        'updated': date.today().isoformat(),
        'source_url': FILINGS_PAGE,
        'sources': {
            'cycle1_filings': {'page': FILINGS_PAGE, 'sheet': CYCLE1_SHEET.split('/export')[0]},
            'fast_track': {'page': FAST_TRACK_PAGE, 'sheet': FAST_TRACK_SHEET.split('/export')[0],
                           'sheet_last_updated': ft_updated},
            'fully_compliant': {'page': COMPLIANT_PAGE},
            'next_cycle_filings': {'page': FILINGS_PAGE},
        },
        'note': NOTE,
        'total_projected_units': total,
        'fast_track_count': sum(1 for r in records if r['fast_track']),
        'fast_track_without_cycle1_commitment': fast_track_only,
        'commitment_met_count': met,
        'next_cycle': {
            'cycle': '2027-2029',
            'filing_deadline': '2026-11-01',
            'filed_count': len(next_cycle),
            'unit_goal_total': sum(e['unit_goal'] for e in next_cycle),
            'filings': sorted(next_cycle, key=lambda e: e['name'].lower()),
        },
        'jurisdictions': records,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--from-dir', help='read saved copies instead of fetching')
    args = ap.parse_args()
    if args.from_dir:
        def rd(name):
            with open(os.path.join(args.from_dir, name), encoding='utf-8') as fh:
                return fh.read()
        src = {'cycle1': rd('cycle1.csv'), 'fasttrack': rd('fasttrack.csv'),
               'filings': rd('commitment-filings.html'), 'compliant': rd('fully-compliant.html')}
    else:
        src = {'cycle1': fetch(CYCLE1_SHEET), 'fasttrack': fetch(FAST_TRACK_SHEET),
               'filings': fetch(FILINGS_PAGE), 'compliant': fetch(COMPLIANT_PAGE)}
    try:
        out = build(src)
        prev = {}
        if os.path.exists(OUTPUT):
            with open(OUTPUT, encoding='utf-8') as fh:
                prev = json.load(fh)
        # DOLA's verifications and second-cycle filings only accumulate, so a
        # smaller count means a list did not parse in full.
        for label, now, before in (
            ('commitment_met_count', out['commitment_met_count'], prev.get('commitment_met_count')),
            ('next_cycle filed_count', out['next_cycle']['filed_count'], (prev.get('next_cycle') or {}).get('filed_count')),
        ):
            if isinstance(before, int) and now < before:
                raise ValueError('%s fell from %d to %d' % (label, before, now))
    except ValueError as e:
        print('build_prop123_jurisdictions: %s; file left unchanged' % e, file=sys.stderr)
        return 1
    with open(OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print('wrote %s: %d jurisdictions, %d fast track, %d met, %d second-cycle filings'
          % (os.path.relpath(OUTPUT, ROOT), len(out['jurisdictions']), out['fast_track_count'],
             out['commitment_met_count'], out['next_cycle']['filed_count']))
    # Files derived from this one, then the schema gate (AGENTS.md rule 3).
    # The two byte manifests are regenerated by ci-checks on the PR.
    for cmd in (['python3', 'scripts/policy/build_housing_scorecard.py'],
                ['node', 'scripts/validate-schemas.js']):
        print('running ' + ' '.join(cmd))
        if subprocess.run(cmd, cwd=ROOT, stdout=subprocess.DEVNULL).returncode != 0:
            print('build_prop123_jurisdictions: %s failed' % ' '.join(cmd), file=sys.stderr)
            return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
