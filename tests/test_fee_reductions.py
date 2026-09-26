"""Fee reductions — data/policy/fee-reductions.json.

The dataset behind the "Colorado fee reductions for affordable housing"
brief. Every entry is a local fee a jurisdiction (or its utility or
district) waives, reduces, defers, reimburses or discounts, and every
figure it states has to be backed by the source wording it carries.

These checks hold the agreement mechanically:
  - each dollar amount and percentage in an entry — its `amount`,
    `percent`, and the $/% in its summary, value basis and backfill note —
    must appear in that entry's `evidence` quotes;
  - an unknown amount is null, never 0;
  - a deferral is kept apart from a cost reduction, because a fee paid
    later is still paid;
  - every Colorado geoid is one the site knows.
"""

import json
import re
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

import pytest

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data' / 'policy' / 'fee-reductions.json'
GEO_CONFIG = ROOT / 'data' / 'hna' / 'geo-config.json'

LEVELS = {'primary', 'reported'}
PROVIDER_TYPES = {'city', 'county', 'special_district', 'utility'}
FEE_CATEGORIES = {
    'tap_water', 'tap_sewer', 'plant_investment', 'system_development',
    'impact_transportation', 'impact_parks', 'impact_police_fire', 'impact_school',
    'impact_other', 'building_permit', 'plan_review', 'use_tax', 'utility_rate',
}
RECURRENCE = {'one_time', 'recurring'}
MEASURES = {'waived', 'reduced', 'deferred', 'rate_discount', 'reimbursed'}
BACKFILL = {'general_fund', 'housing_fund', 'enterprise_absorbed', 'grant',
            'reimbursement', 'none', 'not_specified'}
LEGAL_TOPICS = {'impact_fee', 'enterprise_tabor', 'prop123', 'waiver_statute', 'other'}


@pytest.fixture(scope='module')
def doc():
    return json.loads(DATA.read_text())


@pytest.fixture(scope='module')
def known_geoids():
    geo = json.loads(GEO_CONFIG.read_text())
    ids = set()
    for key in ('counties', 'places', 'cdps'):
        ids.update(row['geoid'] for row in geo.get(key, []))
    return ids


def money(text):
    """Every dollar amount in text, in whole cents (so $21.95 and $21,650 both round-trip)."""
    out = []
    for m in re.finditer(r'\$\s?(\d[\d,]*(?:\.\d+)?)\s*(M\b|million\b|K\b)?', text or ''):
        value = float(m.group(1).replace(',', ''))
        unit = (m.group(2) or '').lower()
        if unit in ('m', 'million'):
            value *= 1_000_000
        elif unit == 'k':
            value *= 1_000
        out.append(round(value * 100))
    return out


# Codes often spell a percentage out ("sixty percent", "eighty (80) percent").
WORD_PERCENTS = {
    'one hundred and twenty': 120, 'one hundred twenty': 120, 'one hundred': 100,
    'twenty-five': 25, 'ninety': 90, 'eighty': 80, 'seventy': 70, 'sixty': 60,
    'fifty': 50, 'forty': 40, 'thirty': 30, 'twenty': 20, 'ten': 10,
}


def percents(text):
    text = text or ''
    for word, n in WORD_PERCENTS.items():
        text = re.sub(r'\b' + word + r'\s+percent\b', f'{n} percent', text, flags=re.I)
    return [float(m.group(1)) for m in re.finditer(r'(\d+(?:\.\d+)?)\)?\s*(?:%|percent\b)', text)]


def quotes_of(item):
    return ' '.join(ev['quote'] for ev in item.get('evidence', []))


def prose_of(entry):
    return ' '.join([
        entry.get('summary') or '',
        entry.get('value_basis') or '',
        (entry.get('backfill') or {}).get('source_note') or '',
        entry.get('deferral_trigger') or '',
    ])


def https(url):
    u = urlparse(url or '')
    return u.scheme == 'https' and bool(u.netloc)


def test_the_file_is_well_formed(doc):
    assert doc['schema'] == 'fee-reductions/v1'
    meta = doc['meta']
    as_of = date.fromisoformat(meta['as_of'])
    assert meta.get('method'), 'meta.method must say how entries were checked'
    assert isinstance(meta.get('known_gaps'), list) and meta['known_gaps'], \
        'known_gaps must list what the dataset does not cover'
    assert all(isinstance(g, str) and g.strip() for g in meta['known_gaps'])

    entries = doc['entries']
    assert len(entries) >= 20, f'only {len(entries)} entries; the dataset has been emptied'
    ids = [e['id'] for e in entries]
    assert len(ids) == len(set(ids)), 'duplicate entry id'
    legal_ids = {lb['id'] for lb in meta['legal_basis']}
    assert len(legal_ids) == len(meta['legal_basis']), 'duplicate legal_basis id'

    for e in entries:
        eid = e['id']
        assert e['provider'] and e['provider_type'] in PROVIDER_TYPES, eid
        assert e['fee_category'] in FEE_CATEGORIES, f"{eid}: fee_category {e['fee_category']!r}"
        assert e['recurrence'] in RECURRENCE, eid
        assert e['measure'] in MEASURES, f"{eid}: measure {e['measure']!r}"
        assert e['backfill']['method'] in BACKFILL, f"{eid}: backfill {e['backfill']['method']!r}"
        assert set(e['legal_basis_ids']) <= legal_ids, f'{eid}: unknown legal_basis id'
        assert https(e['source']['url']), f'{eid}: source must be an https URL'
        v = e['verification']
        assert v['level'] in LEVELS, eid
        assert v.get('against'), f'{eid}: checked against what?'
        assert date.fromisoformat(v['checked']) <= as_of, f'{eid} was checked after as_of'
        assert isinstance(e.get('not_in_source', []), list), eid
        el = e['eligibility']
        for k in ('ami_max', 'tenure', 'deed_restriction_years', 'by_right'):
            assert k in el, f'{eid}: eligibility.{k} missing (use null for unknown)'

    for lb in meta['legal_basis']:
        assert lb['topic'] in LEGAL_TOPICS, lb['id']
        assert https(lb['source']['url']), lb['id']
        assert lb['verification']['level'] in LEVELS, lb['id']
        assert lb.get('evidence'), f"{lb['id']}: a legal basis needs its quoted text"


def test_recurrence_matches_the_kind_of_fee(doc):
    for e in doc['entries']:
        if e['fee_category'] == 'utility_rate':
            assert e['recurrence'] == 'recurring', e['id']
            assert e['measure'] in ('rate_discount', 'reimbursed', 'reduced', 'waived'), e['id']
        else:
            assert e['recurrence'] == 'one_time', e['id']
            assert e['measure'] != 'rate_discount', f"{e['id']}: a one-time fee has no rate class"


def test_an_unknown_amount_is_null_never_zero(doc):
    for e in doc['entries']:
        for k in ('amount', 'percent'):
            val = e.get(k)
            assert val is None or (isinstance(val, (int, float)) and not isinstance(val, bool) and val > 0), \
                f"{e['id']}: {k}={val!r} — an unknown figure is null, and zero is never a reduction"
        if e.get('percent') is not None:
            assert e['percent'] <= 100, e['id']
        ami = e['eligibility'].get('ami_max')
        assert ami is None or ami > 0, e['id']


def test_a_deferral_is_never_counted_as_a_cost_reduction(doc):
    deferrals = [e for e in doc['entries'] if e['measure'] == 'deferred']
    for e in doc['entries']:
        if e['measure'] == 'deferred':
            assert e['reduces_total_cost'] is False, f"{e['id']}: a deferred fee is still owed"
            assert e.get('deferral_trigger'), f"{e['id']}: deferred until when?"
            assert not re.search(r'\b(sav(e|es|ing|ings)|waiv|reduc|discount|free)', e.get('summary') or '', re.I), \
                f"{e['id']}: a deferral's summary describes it as a saving"
        elif e['measure'] in ('waived', 'reduced', 'reimbursed'):
            assert e['reduces_total_cost'] is True, e['id']
            assert e.get('deferral_trigger') is None, f"{e['id']}: not a deferral, so no trigger"
        else:
            assert e['reduces_total_cost'] is None, f"{e['id']}: a rate discount is not a development cost"
    return deferrals


def test_a_primary_entry_carries_the_source_wording_it_rests_on(doc):
    primary = [e for e in doc['entries'] if e['verification']['level'] == 'primary']
    assert len(primary) >= 15, 'too few primary entries; the checks below would pass vacuously'
    for e in primary + doc['meta']['legal_basis']:
        assert e.get('evidence'), f"{e['id']}: primary with no evidence quote"
        for ev in e['evidence']:
            assert ev.get('section') and len(ev['quote']) >= 8, e['id']


def test_every_figure_in_an_entry_is_in_its_evidence(doc):
    checked = 0
    for e in doc['entries'] + doc['meta']['legal_basis']:
        quotes = quotes_of(e)
        amounts, pcts = set(money(quotes)), set(percents(quotes))
        for ev in e.get('evidence', []):
            # A PDF table can put the $ in its own column, so extraction
            # reads "21,650 $". The declared figure must be in the quote.
            for figure in ev.get('table_figures', []):
                assert figure.lstrip('$') in ev['quote'], f"{e['id']}: table figure {figure} is not in its quote"
                amounts.update(money(figure))
        prose = prose_of(e)
        for figure in e.get('not_in_source', []):
            prose = prose.replace(figure, '')
        for amount in money(prose):
            checked += 1
            assert amount in amounts, f"{e['id']}: ${amount / 100:,.2f} is stated but not in the entry's evidence"
        for pct in percents(prose):
            checked += 1
            assert pct in pcts, f"{e['id']}: {pct}% is stated but not in the entry's evidence"
        if e.get('amount') is not None:
            checked += 1
            assert round(e['amount'] * 100) in amounts, \
                f"{e['id']}: amount {e['amount']} is not a dollar figure in its evidence"
        if e.get('percent') is not None:
            checked += 1
            assert float(e['percent']) in pcts, f"{e['id']}: percent {e['percent']} is not in its evidence"
        if e['id'] in {x['id'] for x in doc['entries']} and e['eligibility'].get('ami_max') is not None:
            checked += 1
            assert float(e['eligibility']['ami_max']) in pcts, \
                f"{e['id']}: ami_max {e['eligibility']['ami_max']}% is not in its evidence"
    assert checked >= 40, f'only {checked} figures checked; the scan has drifted'


def test_a_named_backfill_is_quoted(doc):
    named = 0
    for e in doc['entries']:
        b = e['backfill']
        if b['method'] != 'not_specified':
            named += 1
            assert b.get('source_note'), f"{e['id']}: backfill {b['method']} with no note"
            assert b.get('quote') and b['quote'] in quotes_of(e), \
                f"{e['id']}: backfill {b['method']} must quote the evidence that says so"
    assert named >= 3, 'no entry names how a waiver is paid for; the check is vacuous'


def test_geoids_are_ones_the_site_knows(doc, known_geoids):
    colorado = 0
    for e in doc['entries']:
        g = e.get('geoid')
        if e.get('state', 'CO') != 'CO':
            assert g is None, f"{e['id']}: out-of-state entries carry no Colorado geoid"
            continue
        colorado += 1
        assert isinstance(g, str) and g.startswith('08') and len(g) in (5, 7), f"{e['id']}: geoid {g!r}"
        assert g in known_geoids, f"{e['id']}: geoid {g} is not in data/hna/geo-config.json"
    assert colorado >= 15


def test_reported_entries_are_labelled_as_such(doc):
    for e in doc['entries']:
        if e['verification']['level'] == 'reported':
            assert e['verification'].get('by'), f"{e['id']}: reported by whom?"
