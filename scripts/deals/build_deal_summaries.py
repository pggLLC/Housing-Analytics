#!/usr/bin/env python3
"""Copy hand-researched deal records into data/deals/ and write data/deals/index.json.

Each record is one CHFA housing tax credit award, researched from public sources
(CHFA award reports, state funding lists, city and county records, local news), in the
shape deal-summary.html reads. Records are written by hand; this script only checks them
and builds the index, so a malformed record fails here instead of on the page.

    python3 scripts/deals/build_deal_summaries.py RESEARCH_DIR

The index's `match` block is how js/agency-funding.js links an award row on
where-housing-money-goes.html to its summary: same agency, same ledger year, and a name
that equals or starts the ledger's name (the ledger cuts some long names short).
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'data' / 'deals'

# Which ledger award each summary covers (data/policy/funding-awards/ledger.json).
MATCH = {
    'ascent-at-salt-flats-grand-junction': {'agency': 'CHFA', 'year': 2025, 'names': ['Ascent at Salt Flats']},
    'fairbrooke-heights-fort-collins': {'agency': 'CHFA', 'year': 2026, 'names': ['Fairbrooke Heights (scattered site)']},
    'greenbriar-apartments-fort-collins': {'agency': 'CHFA', 'year': 2026, 'names': ['Greenbriar Apartments (scattered site)']},
    'flocrit-decatur-place-denver': {'agency': 'CHFA', 'year': 2026, 'names': ['FloCrit at Decatur Place']},
    'gregory-highlands-ranch': {'agency': 'CHFA', 'year': 2026, 'names': ['Gregory']},
    'mountain-view-plaza-longmont': {'agency': 'CHFA', 'year': 2026, 'names': ['Mountain View Plaza (scattered site)']},
    'parkside-apartments-longmont': {'agency': 'CHFA', 'year': 2026, 'names': ['Parkside Apartments (scattered site)']},
    'reserve-at-south-creek-englewood': {'agency': 'CHFA', 'year': 2026, 'names': ['Reserve at South Creek']},
    'lumberyard-apartments-aspen': {'agency': 'CHFA', 'year': 2026, 'names': ['Lumberyard Apartments']},
}

REQUIRED = ['slug', 'name', 'city', 'award', 'researched_on', 'headline', 'status', 'key_numbers', 'sources']
# Text that never goes on the public site: staff contact details, and the owner's own deals.
FORBIDDEN = [
    (re.compile(r'[\w.+-]+@[\w-]+\.[\w.]+'), 'an email address'),
    (re.compile(r'\(\d{3}\)\s*\d{3}-\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b'), 'a phone number'),
    (re.compile(r'indibuild', re.I), 'a developer brand that stays off the public site'),
    (re.compile(r'fruita', re.I), 'a Fruita project'),
]
CITED = ['key_numbers', 'facts', 'money', 'parties', 'background', 'timeline', 'pictures']


def problems(rec):
    out = []
    for k in REQUIRED:
        if not rec.get(k):
            out.append('missing ' + k)
    if rec.get('slug') not in MATCH:
        out.append('slug has no MATCH entry')
    if len(rec.get('key_numbers') or []) > 4:
        out.append('more than 4 key numbers')
    ids = [s.get('id') for s in rec.get('sources') or []]
    if len(ids) != len(set(ids)):
        out.append('duplicate source ids')
    for s in rec.get('sources') or []:
        if not re.match(r'^https?://', s.get('url') or ''):
            out.append('source %s has no http(s) url' % s.get('id'))
    known = set(ids)
    groups = [rec.get('status') or {}] + [x for k in CITED for x in (rec.get(k) or [])]
    for item in groups:
        src = item.get('src') or []
        if not src:
            out.append('uncited item: %s' % json.dumps(item)[:80])
        for sid in src:
            if sid not in known:
                out.append('unknown source id %s' % sid)
    if rec.get('mix_src'):
        for sid in rec['mix_src']:
            if sid not in known:
                out.append('unknown source id %s' % sid)
    text = json.dumps(rec, ensure_ascii=False)
    for rx, label in FORBIDDEN:
        if rx.search(text):
            out.append('contains ' + label)
    return out


def units_of(rec):
    for row in (rec.get('income_mix') or []), (rec.get('bedroom_mix') or []):
        if row:
            return sum(int(r.get('units') or 0) for r in row)
    return None


def main(research_dir):
    src_dir = Path(research_dir)
    OUT.mkdir(parents=True, exist_ok=True)
    index, failed = [], False
    for slug in sorted(MATCH):
        path = src_dir / (slug + '.json')
        if not path.exists():
            print('skip %s: no research record yet' % slug)
            continue
        rec = json.loads(path.read_text(encoding='utf-8'))
        bad = problems(rec)
        if bad:
            failed = True
            print('FAIL %s: %s' % (slug, '; '.join(bad)))
            continue
        (OUT / (slug + '.json')).write_text(json.dumps(rec, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
        index.append({
            'slug': slug, 'name': rec['name'], 'city': rec['city'], 'county': rec.get('county'),
            'award': rec['award'], 'year': MATCH[slug]['year'], 'units': rec.get('units') or units_of(rec),
            'researched_on': rec['researched_on'], 'match': MATCH[slug],
        })
    (OUT / 'index.json').write_text(json.dumps({
        'meta': {
            'title': 'Deal summaries',
            'generator': 'scripts/deals/build_deal_summaries.py',
            'method': 'One hand-researched record per CHFA award, from public sources only; every figure cites a source listed in the record.',
            'count': len(index),
        },
        'deals': index,
    }, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    print('wrote %d summaries' % len(index))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else str(OUT)))
