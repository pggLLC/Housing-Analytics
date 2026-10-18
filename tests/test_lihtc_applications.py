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
    c['geocode'] = lambda address, city: None  # tests never call the Census geocoder
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


def test_a_namesake_elsewhere_does_not_move_an_application_to_its_county():
    """A project name in the LIHTC feed places an application only when the
    feed puts that name in one of the application's own cities."""
    c = {
        'counties': {'denver': '08031', 'el paso': '08041', 'adams': '08001', 'jefferson': '08059'},
        'county_places': {'denver': {'08031'}, 'colorado springs': {'08041'}, 'westminster': {'08001'}},
        'names': {'ridge': '08041', 'blossom commons': '08059'},
        'name_cities': {'ridge': {'colorado springs': {'08041'}}, 'blossom commons': {'westminster': {'08059'}}},
        'city_spans': {'westminster': {'08001', '08059'}},
        'geocode': lambda address, city: {'7840 W 87th Drive': '08059'}.get(address),
    }
    # "Ridge" in the feed is in Colorado Springs: a Denver application stays in Denver
    got = apps_mod.place_county({'name': 'Ridge', 'city': 'Denver'}, ['Denver'], c)
    assert got['county_fips'] == '08031'
    # the feed's own Westminster project keeps the feed's county, Jefferson,
    # though the place table lists Westminster under Adams only
    got = apps_mod.place_county({'name': 'Blossom Commons', 'city': 'Westminster'}, ['Westminster'], c)
    assert got['county_fips'] == '08059'


def test_in_a_city_that_spans_counties_the_address_decides_or_the_county_is_unknown():
    """Westminster is in Adams and Jefferson, but the place table names Adams
    only: a Westminster application is placed by its street address, and one
    with no address the geocoder can place gets no county, not Adams."""
    c = {
        'counties': {'adams': '08001', 'jefferson': '08059', 'la plata': '08067'},
        'county_places': {'westminster': {'08001'}},
        'names': {'mountain vista apartments': '08067'},
        'name_cities': {'mountain vista apartments': {'durango': {'08067'}}},
        'city_spans': {'westminster': {'08001', '08059'}},
        'geocode': lambda address, city: {'7840 W 87th Drive': '08059'}.get(address),
    }
    got = apps_mod.place_county({'name': 'Mountain Vista Apartments', 'city': 'Westminster',
                                 'address': '7840 W 87th Drive'}, ['Westminster'], c)
    assert got['county_fips'] == '08059' and got['county_method'] == 'Census geocoder, street address'
    got = apps_mod.place_county({'name': 'Somewhere New', 'city': 'Westminster',
                                 'address': '91st Place and Eaton Street'}, ['Westminster'], c)
    assert got['county_fips'] is None
    assert 'Westminster spans 2 counties' in got['county_unavailable_reason']
    got = apps_mod.place_county({'name': 'Somewhere New', 'city': 'Westminster', 'address': None},
                                ['Westminster'], c)
    assert got['county_fips'] is None and got['county_unavailable_reason'].endswith('no street address')


def test_every_committed_county_agrees_with_the_rows_own_city():
    """Each county a row is filed under is one its city is in: the county the
    place table gives the city, one the Census cross-county list puts part of
    it in, or one the CHFA feed puts properties of that city in (Westminster
    spans Adams and Jefferson, Aurora Adams and Arapahoe).
    A county from neither is a namesake's, and puts the row on the wrong
    county's brief."""
    awards = apps_mod.awards
    data = json.loads((ROOT / 'data' / 'jurisdiction-briefs' / '_lihtc-applications.json').read_text())
    _, county_places = awards.load_geo()
    spans = apps_mod.city_spans(apps_mod.load_places())
    feed_counties: dict = {}
    for f in awards.read_json(awards.LIHTC_FEED)['features']:
        pr = f.get('properties') or {}
        if pr.get('PROJ_CTY') and pr.get('CNTY_FIPS'):
            feed_counties.setdefault(awards.norm(pr['PROJ_CTY']), set()).add(pr['CNTY_FIPS'])
    checked = 0
    for r in data['applications']:
        if r.get('award_only') or not r.get('city'):
            continue
        allowed = set()
        for city in (awards.norm(c) for c in r['city'].split(',') if c.strip()):
            allowed |= county_places.get(city, set()) | feed_counties.get(city, set()) | spans.get(city, set())
        if not allowed:
            continue
        for fips in r['county_fips_all']:
            assert fips in allowed, (r['name'], r['city'], fips, sorted(allowed))
        checked += 1
    assert checked > 100


def test_an_application_in_a_city_that_spans_counties_is_filed_under_one_county_or_none():
    """The place table names one county for Westminster or Aurora, so adding it
    beside the application's own county would file the row on a county brief
    it does not belong to; with no county found, the row is on no county's."""
    awards = apps_mod.awards
    data = json.loads((ROOT / 'data' / 'jurisdiction-briefs' / '_lihtc-applications.json').read_text())
    spans = apps_mod.city_spans(apps_mod.load_places())
    # the Census cross-county list (Arvada, Longmont) and the feed (Englewood,
    # and Denver, whose mailing addresses reach into Adams)
    assert {'westminster', 'aurora', 'arvada', 'longmont', 'englewood', 'denver'} <= set(spans)
    checked = 0
    for r in data['applications']:
        cities = [c for c in (r.get('city') or '').split(',') if c.strip()]
        if r.get('award_only') or len(cities) != 1 or awards.norm(cities[0]) not in spans:
            continue
        expected = [r['county_fips']] if r['county_fips'] else []
        assert r['county_fips_all'] == expected, (r['name'], r['city'], r['county_fips_all'])
        if not r['county_fips']:
            assert r.get('county_unavailable_reason'), r['name']
        checked += 1
    assert checked > 20


def test_a_scattered_site_in_a_city_that_spans_counties_is_placed_by_its_own_address(ctx):
    """A scattered-site application across Silverthorne and Westminster files
    the Westminster site under the county its street address is in."""
    c = dict(ctx, geocode=lambda address, city: {'7840 W 87th Drive': '08059'}.get(address))
    rec = {'name': 'Two Towns (scattered site)', 'city': 'Silverthorne, Westminster',
           'sites': [{'name': 'A', 'address': '1 Main St', 'city': 'Silverthorne'},
                     {'name': 'B', 'address': '7840 W 87th Drive', 'city': 'Westminster'}]}
    cities = ['Silverthorne', 'Westminster']
    assert apps_mod.place_county(rec, cities, c)['county_fips'] is None  # spans 2 counties
    counties = apps_mod.application_counties(rec, cities, None, c)
    assert counties == ['08059', '08117']


def test_a_geocoder_outage_is_not_read_as_no_match(monkeypatch):
    """An answer with no match leaves the county unknown; no usable answer at
    all raises, so the build can keep the last list instead of erasing it."""
    monkeypatch.setattr(apps_mod.awards, 'http_get', lambda url, timeout=60: b'{"result": {"addressMatches": []}}')
    assert apps_mod.geocode_county('Sable Blvd and Centerpointe Drive', 'Aurora') is None
    monkeypatch.setattr(apps_mod.awards, 'http_get', lambda url, timeout=60: (
        b'{"result": {"addressMatches": [{"geographies": {"Counties": [{"GEOID": "08059"}]}}]}}'))
    assert apps_mod.geocode_county('7840 W 87th Drive', 'Westminster') == '08059'
    for reply in (b'<html>Service Unavailable</html>', b'{"errors": ["busy"]}'):
        monkeypatch.setattr(apps_mod.awards, 'http_get', lambda url, timeout=60, r=reply: r)
        with pytest.raises(apps_mod.GeocoderUnavailable):
            apps_mod.geocode_county('7840 W 87th Drive', 'Westminster')

    def down(url, timeout=60):
        raise TimeoutError('timed out')
    monkeypatch.setattr(apps_mod.awards, 'http_get', down)
    with pytest.raises(apps_mod.GeocoderUnavailable):
        apps_mod.geocode_county('7840 W 87th Drive', 'Westminster')


def test_a_geocoder_outage_keeps_the_last_list(monkeypatch, tmp_path, ctx):
    """The weekly run fails and writes nothing rather than commit unknown
    counties for every address-placed application."""
    out = tmp_path / 'out.json'
    out.write_text('{"prior": true}')
    fx = fixture('2026-HTC-Round-One-Applicant-Report')
    name = '2026-HTC-Round-One-Applicant-Report'

    def down(address, city):
        raise apps_mod.GeocoderUnavailable('TimeoutError: timed out')
    c = dict(ctx, geocode=down)  # the fixture's Aurora and Westminster rows need it
    monkeypatch.setattr(apps_mod, 'OUT', str(out))
    monkeypatch.setattr(apps_mod.awards, 'discover', lambda src: [doc(name)])
    monkeypatch.setattr(apps_mod, 'read_tables', lambda path: (fx['rows'], fx['texts']))
    monkeypatch.setattr(apps_mod, 'context', lambda: c)
    monkeypatch.setattr(apps_mod.sys, 'argv', ['x', '--cache', str(tmp_path)])
    (tmp_path / f'{name}.pdf').write_bytes(b'%PDF')
    assert apps_mod.main() == 1
    assert out.read_text() == '{"prior": true}'


def test_a_name_in_several_cities_takes_the_county_of_the_applications_city():
    """The feed has "Legacy Senior Residences" in Arvada (Jefferson) and Fort
    Collins (Larimer): a Fort Collins application takes Larimer, not whichever
    one the statewide name lookup found first."""
    c = {
        'counties': {'jefferson': '08059', 'larimer': '08069'},
        'county_places': {'fort collins': {'08069'}, 'arvada': {'08059'}},
        'names': {'legacy senior residences': '08059'},
        'name_cities': {'legacy senior residences': {'arvada': {'08059'}, 'fort collins': {'08069'}}},
        'city_spans': {},
        'geocode': lambda address, city: None,
    }
    got = apps_mod.place_county({'name': 'Legacy Senior Residences', 'city': 'Fort Collins'}, ['Fort Collins'], c)
    assert got['county_fips'] == '08069'


def test_a_mailing_city_mostly_in_one_county_still_geocodes_and_falls_back_to_it():
    """Denver mailing addresses reach into Adams (Welby, 7295 Washington
    Street): the address decides it, and an address the geocoder cannot place
    stays in Denver rather than on no county's brief."""
    c = {
        'counties': {'denver': '08031', 'adams': '08001'},
        'county_places': {'denver': {'08031'}},
        'names': {}, 'name_cities': {},
        'city_spans': {'denver': {'08031', '08001'}},
        'city_fallbacks': {'denver': '08031'},
        'geocode': lambda address, city: {'7295 Washington Street': '08001'}.get(address),
    }
    got = apps_mod.place_county({'name': 'Welby', 'city': 'Denver', 'address': '7295 Washington Street'}, ['Denver'], c)
    assert got['county_fips'] == '08001'
    got = apps_mod.place_county({'name': 'New Street', 'city': 'Denver', 'address': '3979 Central Park Blvd'}, ['Denver'], c)
    assert got['county_fips'] == '08031' and got['county_method'].startswith('Mailing city')
    got = apps_mod.place_county({'name': 'No Address', 'city': 'Denver', 'address': None}, ['Denver'], c)
    assert got['county_fips'] == '08031'


def test_the_fallback_is_only_for_a_city_no_county_line_runs_through():
    """Denver and Lakewood fall back to their county; Westminster, Aurora and
    Englewood, where the line runs through the city or its addresses, do not."""
    fb = apps_mod.city_fallbacks(apps_mod.load_places())
    assert fb.get('denver') == '08031'
    assert not {'westminster', 'aurora', 'englewood', 'arvada', 'longmont'} & set(fb)


def test_a_refused_or_multi_address_request_is_not_an_outage(monkeypatch):
    """The geocoder answers 400 to a request it will not read (six addresses
    in one cell): that is no match, not an outage. Several addresses are
    placed one by one and agree on a county, or give none."""
    from urllib.error import HTTPError
    calls = []

    def get(url, timeout=60):
        calls.append(url)
        if '%3B' in url:
            raise HTTPError(url, 400, 'Bad Request', {}, None)
        county = '08001' if 'Pecos' in url else '08031'
        return json.dumps({'result': {'addressMatches': [{'geographies': {'Counties': [{'GEOID': county}]}}]}}).encode()
    monkeypatch.setattr(apps_mod.awards, 'http_get', get)
    assert apps_mod.geocode_county('1738 West 33rd Avenue; 2301 Eliot Street', 'Denver') == '08031'
    assert len(calls) == 2 and not any('%3B' in u for u in calls)
    assert apps_mod.geocode_county('1738 West 33rd Avenue; 8000 Pecos Street', 'Denver') is None

    def refused(url, timeout=60):
        raise HTTPError(url, 400, 'Bad Request', {}, None)
    monkeypatch.setattr(apps_mod.awards, 'http_get', refused)
    assert apps_mod.geocode_county('1738 West 33rd Avenue', 'Denver') is None
