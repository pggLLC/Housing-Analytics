"""Local Housing Incentives data (local-incentives.html).

Three hand-verified files sit beside data/policy/fee-reductions.json:

  data/policy/local-housing-funds.json   dedicated funds, taxes, linkage fees,
                                         land and ownership tools
  data/policy/incentive-coverage.json    who was checked and found nothing, or
                                         whose official source could not be read
  data/policy/incentive-alternatives.json  the tool catalog and each tool's
                                         Colorado legal basis

The rules are the fee dataset's rules: every figure a record states is in the
source wording it quotes, an unpublished amount is null (never 0), a reported
record says who reported it, and every record carries its check and re-check
dates. The coverage ledger may not contradict the records: a scope cannot be
"checked, none found" for a jurisdiction that has a record in that scope.
"""

import json
import re
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

import pytest

from test_fee_reductions import money, percents, quotes_of

ROOT = Path(__file__).resolve().parent.parent
POLICY = ROOT / 'data' / 'policy'
GEO_CONFIG = ROOT / 'data' / 'hna' / 'geo-config.json'

FUND_TOOLS = {
    'housing_trust_fund', 'dedicated_sales_tax', 'dedicated_property_tax', 'lodging_or_str_tax',
    'other_excise_tax', 'linkage_fee', 'in_lieu_fee', 'real_estate_transfer_tax',
    'land_bank_or_public_land', 'community_land_trust', 'shared_equity_or_deed_restriction',
    'housing_authority', 'tax_increment_or_urban_renewal', 'other',
}
FUND_STATUS = {'adopted', 'repealed', 'expired', 'ballot_failed'}
PROVIDERS = {'city', 'county', 'town', 'special_district', 'housing_authority', 'regional'}
LEVELS = {'primary', 'reported'}
SCOPES = {'fees', 'land_use', 'funds'}
RESULTS = {'records', 'none_found', 'unreadable', 'not_checked'}
FEE_MEASURES = {'waived', 'reduced', 'deferred', 'rate_discount', 'reimbursed'}
LAND_USE = {'inclusionary_zoning', 'expedited_review', 'density_bonus', 'parking_reduction',
            'dimensional_relief', 'reduced_lot_size', 'land_dedication_or_donation',
            'by_right_or_admin_approval', 'other'}
FAMILIES = {'fee_relief', 'land_use', 'local_revenue', 'land_and_ownership', 'tax_relief'}
CO_STATUS = {'authorized', 'authorized_with_voter_approval', 'restricted', 'prohibited_for_new',
             'not_usable_for_housing', 'unclear'}
# City-and-county governments carry two geoids for one government.
CONSOLIDATED = {'08031': '0820000', '08014': '0809280'}


def load(name):
    return json.loads((POLICY / name).read_text())


@pytest.fixture(scope='module')
def funds():
    return load('local-housing-funds.json')


@pytest.fixture(scope='module')
def coverage():
    return load('incentive-coverage.json')


@pytest.fixture(scope='module')
def catalog():
    return load('incentive-alternatives.json')


@pytest.fixture(scope='module')
def fees():
    return load('fee-reductions.json')


@pytest.fixture(scope='module')
def known_geoids():
    geo = json.loads(GEO_CONFIG.read_text())
    return {row['geoid'] for key in ('counties', 'places', 'cdps') for row in geo.get(key, [])}


def https(url):
    u = urlparse(url or '')
    return u.scheme == 'https' and bool(u.netloc)


def iso(value):
    return date.fromisoformat(value)


def canon(geoid):
    return CONSOLIDATED.get(geoid, geoid)


def fund_quotes(rec):
    # Codes write a fractional rate as "(.25) percent"; read it as 0.25.
    return re.sub(r'\(\.(\d+)\)', r'(0.\1)', quotes_of(rec))


def check_verification(rec, as_of):
    rid = rec['id']
    assert https(rec['source']['url']), f'{rid}: source must be an https URL'
    v = rec['verification']
    assert v['level'] in LEVELS, rid
    assert v.get('against'), f'{rid}: checked against what?'
    if v['level'] == 'reported':
        assert v.get('by'), f'{rid}: reported by whom?'
    assert iso(v['checked']) <= as_of, f'{rid} was checked after as_of'
    assert rec.get('last_verified') == v['checked'], f'{rid}: last_verified must equal verification.checked'
    assert iso(rec['review_by']) > iso(rec['last_verified']), f'{rid}: review_by must come after last_verified'
    assert rec.get('evidence'), f'{rid}: a record needs the source wording it rests on'
    for ev in rec['evidence']:
        assert ev.get('section') and len(ev.get('quote', '')) >= 8, rid


def test_funds_file_is_well_formed(funds, known_geoids):
    assert funds['schema'] == 'local-housing-funds/v1'
    meta = funds['meta']
    as_of = iso(meta['as_of'])
    assert meta.get('method') and meta.get('known_gaps'), 'say how records were checked and what is not covered'
    entries = funds['entries']
    assert len(entries) >= 10, f'only {len(entries)} fund records; the dataset has been emptied'
    ids = [e['id'] for e in entries]
    assert len(ids) == len(set(ids)), 'duplicate id'
    for e in entries:
        rid = e['id']
        assert e['tool'] in FUND_TOOLS, f"{rid}: tool {e['tool']!r}"
        assert e['status'] in FUND_STATUS, f"{rid}: status {e['status']!r}"
        assert e['provider_type'] in PROVIDERS, f"{rid}: provider_type {e['provider_type']!r}"
        assert e['voter_approved'] in (True, False, None), rid
        assert e['geoid'] in known_geoids, f"{rid}: geoid {e['geoid']} is not in geo-config"
        for k in ('adopted', 'sunset'):
            if e.get(k):
                iso(e[k])
        check_verification(e, as_of)


def test_an_unpublished_amount_is_null_never_zero(funds):
    for e in funds['entries']:
        for k in ('annual_revenue', 'revenue_year'):
            v = e.get(k)
            assert v is None or (isinstance(v, (int, float)) and v > 0), f"{e['id']}: {k} must be null or positive, not {v!r}"
        if e.get('annual_revenue') is not None:
            assert e.get('revenue_year'), f"{e['id']}: a revenue figure needs its year"


def test_every_figure_in_a_fund_record_is_in_its_evidence(funds):
    checked = 0
    for e in funds['entries']:
        quotes = fund_quotes(e)
        amounts, pcts = set(money(quotes)), set(percents(quotes))
        prose = ' '.join(e.get(k) or '' for k in ('summary', 'rate_text', 'uses'))
        for amount in money(prose):
            checked += 1
            assert amount in amounts, f"{e['id']}: ${amount / 100:,.2f} is stated but not in the evidence"
        for pct in percents(prose):
            checked += 1
            assert pct in pcts, f"{e['id']}: {pct}% is stated but not in the evidence"
        if e.get('annual_revenue') is not None:
            checked += 1
            assert round(e['annual_revenue'] * 100) in amounts, f"{e['id']}: annual_revenue is not in the evidence"
    assert checked >= 5, f'only {checked} figures checked; the scan is vacuous'


def test_fee_and_land_use_records_carry_review_dates(fees):
    as_of = iso(fees['meta']['as_of'])
    for rec in fees['entries'] + fees['land_use']:
        assert rec.get('last_verified') == rec['verification']['checked'], f"{rec['id']}: last_verified"
        assert iso(rec['review_by']) > iso(rec['last_verified']), f"{rec['id']}: review_by"
        assert iso(rec['last_verified']) <= as_of, rec['id']


def test_land_use_figures_are_in_their_evidence(fees):
    checked = 0
    for rec in fees['land_use']:
        quotes = quotes_of(rec)
        amounts, pcts = set(money(quotes)), set(percents(quotes))
        for amount in money(rec.get('detail')):
            checked += 1
            assert amount in amounts, f"{rec['id']}: ${amount / 100:,.2f} is stated but not in the evidence"
        for pct in percents(rec.get('detail')):
            checked += 1
            assert pct in pcts, f"{rec['id']}: {pct}% is stated but not in the evidence"
    assert checked >= 10, 'land-use figure scan is vacuous'


def test_coverage_ledger_is_well_formed(coverage, known_geoids):
    assert coverage['schema'] == 'incentive-coverage/v1'
    rows = coverage['jurisdictions']
    assert rows, 'the ledger is empty'
    seen = set()
    for row in rows:
        g = row['geoid']
        assert g in known_geoids, f'{g}: not in geo-config'
        assert canon(g) not in seen, f'{g}: listed twice'
        seen.add(canon(g))
        iso(row['checked'])
        assert set(row['result_by_scope']) <= SCOPES, g
        assert set(row['result_by_scope'].values()) <= RESULTS, g
        if any(v in ('none_found', 'unreadable') for v in row['result_by_scope'].values()):
            assert row.get('sources_checked'), f'{g}: "none found" or "unreadable" must name what was read'
            assert all(https(u) for u in row['sources_checked']), g


def test_the_ledger_never_contradicts_the_records(coverage, fees, funds):
    """A scope cannot read "checked, none found" while a record in it exists."""
    held = {s: set() for s in SCOPES}
    for e in fees['entries']:
        if e.get('state', 'CO') == 'CO':
            held['fees'].add(canon(e['geoid']))
    for e in fees['land_use']:
        if e.get('state', 'CO') == 'CO':
            held['land_use'].add(canon(e['geoid']))
    for e in funds['entries']:
        held['funds'].add(canon(e['geoid']))
    compared = 0
    for row in coverage['jurisdictions']:
        for scope, result in row['result_by_scope'].items():
            compared += 1
            if result == 'none_found':
                assert canon(row['geoid']) not in held[scope], \
                    f"{row['geoid']}: ledger says no {scope} found, but a {scope} record exists"
    assert compared >= 5


def test_catalog_tools_have_a_quoted_colorado_legal_basis(catalog, fees):
    assert catalog['schema'] == 'incentive-alternatives/v1'
    legal_ids = {lb['id'] for lb in fees['meta']['legal_basis']}
    tools = catalog['tools']
    assert len(tools) >= 12
    ids = [t['id'] for t in tools]
    assert len(ids) == len(set(ids))
    for t in tools:
        tid = t['id']
        assert t['family'] in FAMILIES, tid
        assert t['colorado_status'] in CO_STATUS, f"{tid}: {t['colorado_status']!r}"
        assert t.get('what_it_is') and t.get('status_reason'), tid
        reused = t.get('reuse_legal_basis_ids') or []
        assert set(reused) <= legal_ids, f'{tid}: unknown legal_basis id'
        own = t.get('legal_basis') or []
        assert own or reused, f'{tid}: a tool needs its Colorado legal basis'
        quotes = ' '.join(quotes_of(b) for b in own)
        quotes += ' ' + ' '.join(quotes_of(lb) for lb in fees['meta']['legal_basis'] if lb['id'] in reused)
        for b in own:
            assert https(b['source']['url']), tid
            assert b['verification']['level'] in LEVELS, tid
            assert b.get('evidence'), f'{tid}: legal basis without its quoted text'
        for amount in money(t['status_reason']):
            assert amount in set(money(quotes)), f'{tid}: ${amount / 100:,.2f} in status_reason is not quoted'
        for pct in percents(t['status_reason']):
            assert pct in set(percents(quotes)), f'{tid}: {pct}% in status_reason is not quoted'
        m = t.get('maps_to') or {}
        assert set(m.get('fee_measure', [])) <= FEE_MEASURES, tid
        assert set(m.get('land_use_measure', [])) <= LAND_USE, tid
        assert set(m.get('funds_tool', [])) <= FUND_TOOLS, tid
    # A tool whose revenue cannot fund housing counts no adopter as using it for housing.
    for t in tools:
        if t['colorado_status'] == 'not_usable_for_housing':
            assert not any((t.get('maps_to') or {}).values()), f"{t['id']}: cannot be adopted for housing"
