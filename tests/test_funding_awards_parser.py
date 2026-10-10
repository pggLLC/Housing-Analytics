"""
The award parser checks itself against the totals each PDF prints, so these
tests pin that check rather than a layout: two real award lists (text from
`pdftotext -layout`, stored as fixtures so no network or poppler is needed)
must parse to rows that add up to their own TOTAL lines, and a single changed
amount must turn the same document into a mismatch. Unit counts are checked
the same way where the PDF totals them.
"""
import importlib.util
import pathlib

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / 'scripts' / 'funding' / 'build_funding_awards.py'
FIXTURES = ROOT / 'tests' / 'fixtures' / 'funding-awards'

spec = importlib.util.spec_from_file_location('build_funding_awards', SRC)
awards = importlib.util.module_from_spec(spec)
spec.loader.exec_module(awards)

CASES = {
    # file: (rows, PDF total of amount_awarded, a row that must parse whole)
    'FY23-24-LandBankingAwards.txt': (16, 25_340_000, ('Rural Southern Colorado Homeownership Portfolio 1', 750_000)),
    'Prop123-AHFF-FY24-25-ConcessionaryDebtSelections.txt': (9, 27_339_500, ('Nuche Village', 7_600_000)),
}


def parse(text: str):
    """Both wrap readings, as build() tries them; return the one naming the expected row."""
    out = []
    for wrap in ('below', 'above'):
        parsed = awards.parse_document(text, wrap)
        records = awards.to_records(parsed)
        out.append((parsed, records))
    return out


@pytest.mark.parametrize('name', sorted(CASES))
def test_rows_add_up_to_the_pdf_total(name):
    text = (FIXTURES / name).read_text()
    rows, total, (project, amount) = CASES[name]
    named = []
    for parsed, records in parse(text):
        check = awards.reconcile(parsed, records)
        assert check['status'] == 'ok', check
        assert len(records) == rows
        assert [c for c in check['checks'] if c['field'] == 'amount_awarded'][0]['pdf_total'] == total
        named += [r for r in records if r.get('name') == project]
    # non-vacuity: the reconciled rows carry the project and its amount
    assert any(r.get('amount_awarded') == amount for r in named), named


@pytest.mark.parametrize('name', sorted(CASES))
def test_one_changed_amount_is_a_mismatch(name):
    text = (FIXTURES / name).read_text()
    _, _, (_, amount) = CASES[name]
    printed = f'${amount:,}'
    changed = f'${amount + 100_000:,}'
    assert len(printed) == len(changed)          # same width: the layout is untouched
    lines = text.split('\n')
    row = next(i for i, ln in enumerate(lines) if printed in ln and 'total' not in ln.lower())
    lines[row] = lines[row].replace(printed, changed, 1)
    sabotaged = '\n'.join(lines)
    assert sabotaged != text                     # the mutation applied
    for parsed, records in parse(sabotaged):
        check = awards.reconcile(parsed, records)
        assert check['status'] == 'mismatch', check


def test_a_location_spanning_counties_is_left_unplaced():
    counties = {}
    places = {'trinidad': {'08071'}, 'walsenburg': {'08055'}, 'fort garland': {'08023'}}
    rec = {'location': 'Trinidad, Walsenburg, Fort Garland', 'name': 'Portfolio'}
    awards.assign_county(rec, counties, places, {})
    assert rec['county_fips'] is None
    assert 'spans 3 counties' in rec['county_unavailable_reason']
    rec = {'location': 'Trinidad, Trinidad', 'name': 'Portfolio'}
    awards.assign_county(rec, counties, places, {})
    assert rec['county_fips'] == '08071'


def test_public_build_patterns_are_read_from_their_one_source():
    src = (ROOT / 'scripts' / 'lib' / 'public-sensitive-patterns.mjs').read_text()
    patterns = awards.sensitive_patterns()
    assert len(patterns) == src.count('regex:') > 0
    # every pattern the guard holds must match the text its label names here too
    assert any(p.search('Sponsor: IndiBuild LLC') for p in patterns)


def test_unit_counts_add_up_to_the_pdf_total():
    # "Estimated / Unit Count" wraps so that "Unit" joins the money heading beside it
    text = (FIXTURES / 'Prop123-AHFF-FY24-25-ConcessionaryDebtSelections.txt').read_text()
    for parsed, records in parse(text):
        check = awards.reconcile(parsed, records)
        units = [c for c in check['checks'] if c['field'] == 'total_units']
        assert units == [{'field': 'total_units', 'pdf_total': 619, 'parsed_total': 619, 'ok': True}], check
        assert all(isinstance(r.get('total_units'), int) for r in records), records


def test_one_changed_unit_count_is_a_units_only_mismatch():
    text = (FIXTURES / 'Prop123-AHFF-FY24-25-ConcessionaryDebtSelections.txt').read_text()
    printed = '$7,600,000             75 '
    assert text.count(printed) == 1
    sabotaged = text.replace(printed, '$7,600,000             76 ')
    assert sabotaged != text                     # the mutation applied
    for parsed, records in parse(sabotaged):
        check = awards.reconcile(parsed, records)
        failed = [c['field'] for c in check['checks'] if not c['ok']]
        assert failed == ['total_units'], check


def test_a_4_state_report_is_4_percent():
    doc = {'file': '2016-Round1-4-State-4-CDBG-Award-Report.pdf', 'program_family': 'housing-tax-credit'}
    assert awards.doc_meta(doc, ['Colorado Housing and Finance Authority', 'Award Report'])['program'] == 'LIHTC 4% + state'
    doc = {'file': '2016-Round-2-Award-Report.pdf', 'program_family': 'housing-tax-credit'}
    assert awards.doc_meta(doc, ['2016 Round 2 - 9% Competitive'])['program'] != 'LIHTC 4% + state'


def test_a_document_no_longer_listed_is_reported(tmp_path):
    prior = tmp_path / 'documents.json'
    prior.write_text('{"documents": [{"file": "a.pdf"}, {"file": "b.pdf"}]}')
    assert awards.missing_documents(str(prior), [{'file': 'a.pdf'}, {'file': 'b.pdf'}, {'file': 'c.pdf'}]) == []
    assert awards.missing_documents(str(prior), [{'file': 'a.pdf'}]) == ['b.pdf']
    assert awards.missing_documents(str(tmp_path / 'none.json'), []) == []
