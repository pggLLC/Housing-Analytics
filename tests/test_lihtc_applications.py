"""
scripts/funding/build_lihtc_applications.py reads CHFA's Housing Tax Credit
applicant reports. These tests pin what the jurisdiction briefs rely on:

- a report's rows add up to the TOTALS row it prints, and one changed amount
  turns the report into a mismatch that contributes no rows;
- the contact name, email and phone columns never reach a row;
- an excluded project is left out;
- outcomes come from the award ledger: the same round's award report, never a
  later round's, and "not awarded" only once that round's award report exists.

Fixtures are the tables pdfplumber reads from three real reports, with the
contact columns replaced by placeholders, so no network or pdfplumber is needed.
"""
import copy
import importlib.util
import json
import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / 'scripts' / 'funding' / 'build_lihtc_applications.py'
FIXTURES = ROOT / 'tests' / 'fixtures' / 'lihtc-applications'

spec = importlib.util.spec_from_file_location('build_lihtc_applications', SRC)
apps_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(apps_mod)

CASES = {
    # file: (rows kept, status, a row that must parse whole)
    '2026-HTC-Round-One-Applicant-Report': (32, 'ok', ('Barth Hotel', 'Denver', 50, 1_450_000)),
    # prints its sums under the columns with no TOTALS label
    '2023-HTC-Round-Two-Applicant-Report': (35, 'ok', None),
    # a rolling list: totals only some stages, so nothing to check against
    'Federal-4-percent-Credit-LOI-and-Applicant-Report': (10, 'no_total_line', ('29 Mile Apartments', 'Grand Junction', 144, 1_781_428)),
}


def fixture(name):
    return json.loads((FIXTURES / f'{name}.json').read_text())


def doc(name):
    return {'file': f'{name}.pdf', 'url': f'https://www.chfainfo.com/getattachment/x/{name}.pdf'}


@pytest.fixture(scope='module')
def ctx():
    c = apps_mod.context()
    c['excluded'] = set()
    return c


@pytest.mark.parametrize('name', sorted(CASES))
def test_rows_add_up_to_the_report_totals(name):
    want_rows, want_status, row = CASES[name]
    parsed = apps_mod.parse_tables(fixture(name)['rows'])
    check = apps_mod.reconcile(parsed)
    assert len(parsed['records']) == want_rows
    assert check['status'] == want_status
    if want_status == 'ok':
        # non-vacuous: the totals row named at least units and a credit
        fields = {c['field'] for c in check['checks']}
        assert {'total_units', 'federal_credit_requested'} <= fields
    if row:
        name_, city, units, credit = row
        rec = next(r for r in parsed['records'] if r['name'] == name_)
        assert (rec['city'], rec['total_units'], rec['federal_credit_requested']) == (city, units, credit)


def test_one_changed_amount_is_a_mismatch_and_contributes_no_rows(ctx):
    name = '2026-HTC-Round-One-Applicant-Report'
    fx = fixture(name)
    rows = copy.deepcopy(fx['rows'])
    target = next(r for r in rows if 'Barth Hotel' in r)
    i = target.index('$1,450,000')
    target[i] = '$1,460,000'
    assert '$1,460,000' in [c for r in rows for c in r]  # the mutation applied
    assert apps_mod.reconcile(apps_mod.parse_tables(rows))['status'] == 'mismatch'
    got, status = apps_mod.build_document(doc(name), rows, fx['texts'], ctx)
    assert status['status'] == 'mismatch' and got == []


def test_contact_columns_never_reach_a_row(ctx):
    seen = 0
    for name in CASES:
        fx = fixture(name)
        # non-vacuous: the fixture does carry contact cells
        assert any('person@example.localhost' in c for r in fx['rows'] for c in r)
        got, _ = apps_mod.build_document(doc(name), fx['rows'], fx['texts'], ctx)
        seen += len(got)
        text = json.dumps(got)
        assert '@' not in text
        assert '(000) 000-0000' not in text
        assert 'Contact Person' not in text
    assert seen > 40


def test_rows_quote_the_report_and_link_it(ctx):
    name = '2026-HTC-Round-One-Applicant-Report'
    fx = fixture(name)
    got, _ = apps_mod.build_document(doc(name), fx['rows'], fx['texts'], ctx)
    barth = next(a for a in got if a['name'] == 'Barth Hotel')
    assert 'Name: Barth Hotel' in barth['quote'] and 'City: Denver' in barth['quote']
    assert barth['source_url'].startswith('https://www.chfainfo.com/')
    assert barth['place_geoids'] == ['0820000'] and barth['county_fips'] == '08031'
    assert barth['credit_type'] == '9%' and barth['round_label'] == '2026 Round One'


def test_rolling_list_stage_and_as_of(ctx):
    name = 'Federal-4-percent-Credit-LOI-and-Applicant-Report'
    fx = fixture(name)
    got, status = apps_mod.build_document(doc(name), fx['rows'], fx['texts'], ctx)
    assert status['as_of'] == '2026-09-18'
    stages = {a['stage'] for a in got}
    assert stages == {'Application', 'LOI'}  # the asterisk is a footnote mark, not part of the stage
    assert all(a['rolling'] and a['credit_type'] == '4%' for a in got)


def test_scattered_sites_fold_into_one_application_in_every_place(ctx):
    name = 'Federal-4-percent-Credit-LOI-and-Applicant-Report'
    fx = fixture(name)
    got, _ = apps_mod.build_document(doc(name), fx['rows'], fx['texts'], ctx)
    holy = next(a for a in got if a['name'].startswith('Holy Cross Village'))
    assert holy['total_units'] == 122 and holy['federal_credit_requested'] == 2_425_000
    assert [s['city'] for s in holy['sites']] == ['Gypsum', 'Silverthorne']
    assert set(holy['county_fips_all']) == {'08037', '08117'}  # Eagle and Summit
    assert holy['county_fips'] is None  # spans two counties, so no single county
    assert 'Site: Villa Sierra Madre' in holy['quote']
    # site rows are not applications of their own
    assert not any(a['name'] in ('Holly Cross Village', 'Villa Sierra Madre', '40th Apartments') for a in got)


def test_excluded_project_is_left_out(ctx):
    name = '2026-HTC-Round-One-Applicant-Report'
    fx = fixture(name)
    c = dict(ctx, excluded={apps_mod.exclusion_hash('Barth Hotel', 'Denver')})
    got, status = apps_mod.build_document(doc(name), fx['rows'], fx['texts'], c)
    assert status['excluded'] == 1
    assert 'Barth Hotel' not in {a['name'] for a in got}
    assert len(got) == CASES[name][0] - 1


def test_the_excluded_list_names_no_project():
    data = json.loads((ROOT / 'data' / 'jurisdiction-briefs' / '_lihtc-applications-excluded.json').read_text())
    assert data['excluded']
    for e in data['excluded']:
        assert re.fullmatch(r'[0-9a-f]{64}', e['sha256'])


# ── outcomes ─────────────────────────────────────────────────────────────────

def app(name, city, year, rnd, credit='9%', county='08031', rolling=False, stage=None):
    meta = {'year': year, 'round': rnd, 'rolling': rolling, 'credit_type': credit}
    return {'name': name, 'city': city, 'year': year, 'round': rnd, 'rolling': rolling, 'stage': stage,
            'credit_type': credit, 'county_fips': county, 'round_label': apps_mod.round_label(meta)}


def award(name, location, year, rnd, program='LIHTC 9% + state', file='award.pdf', county='08031'):
    return {'agency': 'CHFA', 'program': program, 'year': year, 'round': rnd, 'name': name,
            'location': location, 'county_fips': county, 'source_file': file,
            'source_url': f'https://www.chfainfo.com/{file}'}


STATUSES = [
    {'agency': 'CHFA', 'program': 'LIHTC 9% + state', 'year': 2025, 'round': 1, 'status': 'ok', 'file': 'r1-2025.pdf'},
    {'agency': 'CHFA', 'program': 'LIHTC 9% + state', 'year': 2026, 'round': 1, 'status': 'ok', 'file': 'r1-2026.pdf'},
    {'agency': 'CHFA', 'program': 'LIHTC 4% + state', 'year': 2025, 'round': 2, 'status': 'ok', 'file': 'r2-2025.pdf'},
]


def run(apps, ledger):
    return apps_mod.finish(apps, ledger, STATUSES, 2023, {'places': {}})


def test_award_in_the_same_round_is_awarded_and_names_the_report():
    a = app('1001 Lincoln St', 'Denver', 2025, 1)
    run([a], [award('1001 Lincoln Street', 'Denver', 2025, 1, file='r1-2025.pdf')])
    assert a['outcome'] == 'awarded' and 'r1-2025.pdf' in a['outcome_detail']


def test_a_later_rounds_award_is_not_this_rounds():
    lost = app('Harbor View', 'Denver', 2025, 1)
    won = app('Harbor View', 'Denver', 2026, 1)
    run([lost, won], [award('Harbor View', 'Denver', 2026, 1)])
    assert lost['outcome'] == 'not_awarded'
    assert won['outcome'] == 'awarded'
    assert lost['later_applications'] == [{'round_label': '2026 Round One', 'credit_type': '9%', 'outcome': 'awarded'}]


def test_not_awarded_needs_a_published_award_report():
    a = app('Pine Court', 'Denver', 2026, 2, credit='4%')
    run([a], [])
    assert a['outcome'] == 'pending'


def test_a_same_place_award_sharing_a_word_makes_the_outcome_unresolved():
    renamed = app('Cole Flats', 'Denver', 2025, 2, credit='4%')
    other = app('Gibson', 'Denver', 2025, 2, credit='4%')
    run([renamed, other], [award('Cole Train', 'Denver', 2025, 2, program='LIHTC 4% + state')])
    assert renamed['outcome'] == 'unresolved' and 'Cole Train' in renamed['outcome_detail']
    assert other['outcome'] == 'not_awarded'


def test_the_award_ledger_location_may_carry_a_neighbouring_column():
    a = app('Compass Pointe', 'Pueblo', 2025, 2, credit='4%', county='08101')
    run([a], [award('Compass Pointe', 'Pueblo CHFA', 2025, 2, program='LIHTC 4% + state', county='08101')])
    assert a['outcome'] == 'awarded'


def test_a_later_cycles_federal_4pct_award_is_not_this_applications():
    """CHFA's rolling federal 4% report prints each award's cycle year. A 2025
    award under the same name does not answer a 2024 Round Two application
    (CHFA's 2024 Round Two award report omits Ives II; the 2025 award is a
    different, 44-unit deal), so the 2024 row says it cannot tell."""
    statuses = STATUSES + [{'agency': 'CHFA', 'program': 'LIHTC 4% + state', 'year': 2024, 'round': 2,
                            'status': 'ok', 'file': 'r2-2024.pdf'}]
    rolling = award('Ives II', 'Wheat Ridge', 2025, None, program='LIHTC 4% + state',
                    file='federal-4-housing-tax-credit-award-report.pdf', county='08059')
    early = app('Ives II', 'Wheat Ridge', 2024, 2, credit='4%', county='08059')
    apps_mod.finish([early], [rolling], statuses, 2023, {'places': {}})
    assert early['outcome'] == 'unresolved' and 'later one' in early['outcome_detail']
    same = app('Ives II', 'Wheat Ridge', 2025, 2, credit='4%', county='08059')
    apps_mod.finish([same], [rolling], statuses, 2023, {'places': {}})
    assert same['outcome'] == 'awarded'


def test_a_one_word_name_inside_another_is_not_the_same_project():
    """"Federal Apartments" (3244 S Federal Blvd) is not "4745 N Federal Blvd"."""
    assert not apps_mod.similar(apps_mod.norm_name('Federal Apartments'), apps_mod.norm_name('4745 N Federal Blvd'))
    first = app('Federal Apartments', 'Denver', 2025, 1)
    first.update(address='3244 S Federal Boulevard', sponsor='Silva Development Partners')
    other = app('4745 N Federal Blvd', 'Denver', 2026, 2, credit='4%')
    other.update(address='4745 N Federal Boulevard', sponsor='Colorado Coalition for the Homeless')
    run([first, other], [])
    assert 'later_applications' not in first


def test_a_renamed_reapplication_at_the_same_address_is_linked():
    first = app('Annex', 'Boulder', 2025, 1, county='08013')
    first.update(address='1603 Walnut Street', sponsor='Grace Commons Church')
    again = app('Grace Commons Annex', 'Boulder', 2026, 1, county='08013')
    again.update(address='1603 Walnut Street', sponsor='Grace Commons Church')
    run([first, again], [])
    assert [l['round_label'] for l in first['later_applications']] == ['2026 Round One']


def test_rolling_letter_of_intent_is_not_called_a_loss():
    a = app('Rock Crest', 'Loveland', 2026, None, credit='4%', rolling=True, stage='LOI')
    run([a], [])
    assert a['outcome'] == 'letter_of_intent'


def test_an_unusable_report_keeps_the_last_list(monkeypatch, tmp_path, ctx):
    """A report that stops adding up must not drop its round from the list."""
    out = tmp_path / 'out.json'
    out.write_text('{"prior": true}')
    fx = fixture('2026-HTC-Round-One-Applicant-Report')
    rows = copy.deepcopy(fx['rows'])
    target = next(r for r in rows if 'Barth Hotel' in r)
    target[target.index('$1,450,000')] = '$1,460,000'
    name = '2026-HTC-Round-One-Applicant-Report'
    monkeypatch.setattr(apps_mod, 'OUT', str(out))
    monkeypatch.setattr(apps_mod.awards, 'discover', lambda src: [doc(name)])
    monkeypatch.setattr(apps_mod, 'read_tables', lambda path: (rows, fx['texts']))
    monkeypatch.setattr(apps_mod, 'context', lambda: ctx)
    monkeypatch.setattr(apps_mod.sys, 'argv', ['x', '--cache', str(tmp_path)])
    (tmp_path / f'{name}.pdf').write_bytes(b'%PDF')
    assert apps_mod.main() == 1
    assert out.read_text() == '{"prior": true}'
    monkeypatch.setattr(apps_mod.sys, 'argv', ['x', '--cache', str(tmp_path), '--check'])
    assert apps_mod.main() == 1


def test_committed_list_agrees_with_its_documents():
    """Every row in the committed list cites a CHFA report that the list's own
    documents table records as usable, and carries a quote."""
    data = json.loads((ROOT / 'data' / 'jurisdiction-briefs' / '_lihtc-applications.json').read_text())
    usable = {d['file'] for d in data['meta']['documents'] if d['status'] in ('ok', 'no_total_line')}
    rows = data['applications']
    assert len(rows) > 100
    assert data['meta']['application_count'] == len(rows)
    for r in rows:
        assert r['source_url'].startswith('https://www.chfainfo.com/')
        assert r['quote']
        assert r['outcome'] in ('awarded', 'not_awarded', 'pending', 'in_review', 'letter_of_intent', 'unresolved')
        if not r.get('award_only'):
            assert r['source_file'] in usable
    assert '@' not in json.dumps(rows)
