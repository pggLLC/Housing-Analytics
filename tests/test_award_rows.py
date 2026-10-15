"""scripts/funding/build_award_rows.py: reading award tables without the PDFs."""
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
