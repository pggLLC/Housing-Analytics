"""Policy watch — data/policy/policy-watch.json.

The Housing News page shows these entries as checked facts, so every figure
an entry states has to be backed by the source wording it carries. This
checks that agreement mechanically: each dollar amount and percentage in
an entry's title and detail must appear in its `evidence` quotes, be a
declared `derived` sum of amounts that do, or be a declared `redline`
amount. A figure that is only in the prose fails.
"""

import json
import re
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

import pytest

ROOT = Path(__file__).resolve().parent.parent
WATCH = ROOT / 'data' / 'policy' / 'policy-watch.json'
SECTIONS = {'qap', 'ballot', 'people'}
LEVELS = {'primary', 'reported'}


@pytest.fixture(scope='module')
def doc():
    return json.loads(WATCH.read_text())


def money(text):
    """Every dollar amount in text, in whole dollars."""
    out = []
    for m in re.finditer(r'\$(\d[\d,]*(?:\.\d+)?)\s*(M\b|million\b|K\b)?', text):
        value = float(m.group(1).replace(',', ''))
        unit = (m.group(2) or '').lower()
        if unit in ('m', 'million'):
            value *= 1_000_000
        elif unit == 'k':
            value *= 1_000
        out.append(round(value))
    return out


def percents(text):
    out = []
    for m in re.finditer(r'(\d+(?:\.\d+)?)\s*(?:%|percent\b)', text):
        out.append(float(m.group(1)))
    return out


def backed(entry):
    """Amounts and percentages the entry's evidence supports."""
    amounts, pcts = set(), set()
    for ev in entry.get('evidence', []):
        amounts.update(money(ev['quote']))
        pcts.update(percents(ev['quote']))
        red = ev.get('redline')
        if red:
            amounts.update(money(red['struck']) + money(red['inserted']))
    for d in entry.get('derived', []):
        amounts.update(money(d['figure']))
    return amounts, pcts


def test_the_file_is_well_formed(doc):
    assert doc['schema'] == 'policy-watch/v1'
    as_of = date.fromisoformat(doc['meta']['as_of'])
    entries = doc['entries']
    assert entries, 'the policy watch is empty'
    ids = [e['id'] for e in entries]
    assert len(ids) == len(set(ids)), 'duplicate entry id'
    for e in entries:
        assert e['section'] in SECTIONS, e['id']
        assert e['title'].strip() and e.get('status'), e['id']
        assert urlparse(e['source']['url']).scheme == 'https' and urlparse(e['source']['url']).netloc, e['id']
        v = e['verification']
        assert v['level'] in LEVELS, f"{e['id']}: unknown verification level {v['level']!r}"
        assert date.fromisoformat(v['checked']) <= as_of, f"{e['id']} was checked after the file's as_of"
        if e.get('date') is not None:
            date.fromisoformat(e['date'])
    assert isinstance(doc['meta'].get('known_gaps'), list)


def test_a_primary_entry_carries_the_source_wording_it_rests_on(doc):
    primary = [e for e in doc['entries'] if e['verification']['level'] == 'primary']
    assert primary, 'no primary entries; the checks below would pass vacuously'
    for e in primary:
        assert e['verification'].get('against'), f"{e['id']}: primary, but against what?"
        assert e.get('evidence'), f"{e['id']}: primary with no evidence quote"
        for ev in e['evidence']:
            assert ev.get('section') and len(ev['quote']) >= 15, e['id']


def test_a_reported_entry_names_its_outlet(doc):
    for e in doc['entries']:
        if e['verification']['level'] == 'reported':
            assert e['verification'].get('by'), f"{e['id']}: reported by whom?"


def test_every_figure_in_an_entry_is_in_its_evidence(doc):
    checked = 0
    for e in doc['entries']:
        if e['verification']['level'] != 'primary':
            continue
        amounts, pcts = backed(e)
        prose = e['title'] + ' ' + e.get('detail', '')
        for figure in e.get('not_in_source', []):
            assert round(money(figure)[0]) not in amounts, \
                f"{e['id']}: {figure} is declared absent from the source but its evidence contains it"
            prose = prose.replace(figure, '')
        for amount in money(prose):
            checked += 1
            assert amount in amounts, f"{e['id']}: ${amount:,} is stated but not in the entry's evidence"
        for pct in percents(prose):
            checked += 1
            assert pct in pcts, f"{e['id']}: {pct}% is stated but not in the entry's evidence"
    assert checked >= 20, f'only {checked} figures checked; the scan has drifted'


def test_derived_sums_add_up(doc):
    seen = 0
    for e in doc['entries']:
        quotes = ' '.join(ev['quote'] for ev in e.get('evidence', []))
        for d in e.get('derived', []):
            parts = [money(p)[0] for p in d['sum_of']]
            for p in d['sum_of']:
                assert p in quotes, f"{e['id']}: {p} is summed but not quoted"
            assert sum(parts) == money(d['figure'])[0], f"{e['id']}: {d['figure']} != {' + '.join(d['sum_of'])}"
            seen += 1
    assert seen >= 1


def test_a_redline_amount_is_how_the_pdf_runs_the_two_together(doc):
    seen = 0
    for e in doc['entries']:
        for ev in e.get('evidence', []):
            red = ev.get('redline')
            if not red:
                continue
            # "$1,800,000" struck, "$1,700,000" inserted: the PDF text reads
            # "$1,800" + "700,000" = "$1,800700,000".
            joined = red['struck'][:-len(',000')] + red['inserted'].split(',', 1)[1]
            assert joined in ev['quote'], f"{e['id']}: redline {red} does not match the quote"
            seen += 1
    assert seen >= 1
