"""scripts/funding/build_award_rows.py: reading award tables without the PDFs."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'scripts', 'funding'))

import build_award_rows as b  # noqa: E402

HEADER = ['Type', 'Name', 'Address', 'City', 'Credit\nAmount\nRequested', 'Total\nUnits', 'Total\nLI Units',
          'Owner Name', 'First Name', 'Last Name', 'Phone', 'Email']


def row(name, city, amount, units, owner):
    return ['N,F', name, '1 Main St', city, amount, str(units), str(units), owner, 'Pat', 'Doe', '(303) 555-0100', 'pat@example.org']


def test_wrapped_cells_stay_whole_and_contacts_are_never_read():
    rows = b.table_rows([HEADER, row('Alpenglow Village', 'Steamboat\nSprings', '$1,350,000', 72,
                                     'Overland Property Group & Yampa\nValley Housing Authority')])
    assert len(rows) == 1
    r = rows[0]
    assert r['name'] == 'Alpenglow Village'
    assert r['location'] == 'Steamboat Springs'
    assert r['sponsor'] == 'Overland Property Group & Yampa Valley Housing Authority'
    for contact in ('Pat', 'Doe', '555', 'example.org'):
        assert contact not in r['quote']
    assert 'Credit Amount Requested: $1,350,000' in r['quote']


def test_match_needs_both_amount_and_units_and_breaks_ties_by_name():
    rows = b.table_rows([HEADER,
                         row('Mill Apartments', 'Fraser', '$1,350,000', 60, 'Grand Park Homes, LLC'),
                         row('Villas at Mesa Ridge', 'Fountain', '$1,350,000', 60, 'Zimmerman Properties, LLC')])
    award = {'source_file': 'x.pdf', 'federal_credit': 1350000, 'restricted_units': 60,
             'name': 'Villas at Mesa Ridge', 'sponsor': None, 'location': 'Fountain'}
    t, why = b.match(award, rows)
    assert why is None and t['name'] == 'Villas at Mesa Ridge'
    t, why = b.match(dict(award, restricted_units=61), rows)
    assert t is None and 'no printed row' in why


def test_spaced_amounts_are_read_and_quoted_without_the_spaces():
    rows = b.table_rows([HEADER, row('Copper Rose', 'Colorado Springs', '$ 2 ,500,000', 182, 'Someone')])
    assert 2500000 in rows[0]['numbers']
    assert '$2,500,000' in rows[0]['quote']


def test_guard_blocked_text_is_withheld():
    blocked = 'IndiBuild LLC'
    assert b.sensitive(blocked)
    rows = b.table_rows([HEADER, row('Some Project', 'Fruita', '$1,000,000', 40, blocked)])
    assert rows[0].get('sponsor') is None
    assert 'indibuild' not in rows[0]['quote'].lower()
    assert 'Owner Name: [not shown]' in rows[0]['quote']


def test_keys_count_awards_that_share_file_amount_and_units():
    a = {'source_file': 'x.pdf', 'federal_credit': 1350000, 'restricted_units': 60}
    assert b.ledger_keys([a, dict(a), dict(a, restricted_units=61)]) == [
        'x.pdf|1350000|60#1', 'x.pdf|1350000|60#2', 'x.pdf|1350000|61#1']


def test_the_sponsor_column_heading_is_kept_so_an_owner_is_not_shown_as_a_developer():
    r = b.table_rows([HEADER, row('Arroyo Village', 'Denver', '$1,000,000', 40, 'Arroyo Village Apartments LLLP')])[0]
    assert r['sponsor'] == 'Arroyo Village Apartments LLLP'
    assert r['sponsor_heading'] == 'Owner Name'
    sponsor = ['Name', 'City', 'Sponsor', 'Credit Amount']
    r = b.table_rows([sponsor, ['Mill Apartments', 'Fraser', 'Grand Park Homes', '$500,000']])[0]
    assert r['sponsor_heading'] == 'Sponsor'


def test_a_line_quote_stops_before_the_contact_columns():
    for line, kept in [
        ('AR F Main Street $1,393,960 $850,000 CHFA see below Thistle Pat Doe pat@example.org (303) 555-0100',
         'AR F Main Street $1,393,960 $850,000 CHFA see below Thistle'),
        ('N,F 1 Main St Grand Junction 81506 $1,349,865 60 60 Housing Authority Pat Doe 970-555-0100 pat@example.org',
         'N,F 1 Main St Grand Junction 81506 $1,349,865 60 60 Housing Authority'),
        ('1936 Grove Apartments Denver $3,699,545 28 Mixed-Income Investment',
         '1936 Grove Apartments Denver $3,699,545 28 Mixed-Income Investment'),
    ]:
        assert b.without_contact(line) == kept


def test_no_published_quote_carries_a_phone_or_an_email():
    with open(os.path.join(b.DIR, 'award-rows.json'), encoding='utf-8') as fh:
        rows = json.load(fh)['rows']
    assert rows
    for r in rows:
        assert not b.CONTACT_TOKEN.search(r.get('quote') or ''), r['key']
