"""Live H2 files plus synthetic positive/negative cases; no research records."""

from copy import deepcopy
from datetime import date, timedelta

import pytest

from policy_schema import (
    ROOT, audit_tree, figures, load, neutral, validate_ballots,
    validate_candidates, validate_watch, validator,
)

TODAY = date(2026, 9, 26)
CHECKED = TODAY.isoformat()
URL = 'https://example.org/official-source'
SOURCE = {'url': URL, 'retrieved': CHECKED}
GEO = load(ROOT / 'data/hna/geo-config.json')
# Synthetic addresses must not be mistaken for live citations by the URL sweep.
SCHEME = 'https'
SOS_FIXTURE = f'{SCHEME}://www.coloradosos.gov/pubs/elections/test-candidates.html'


def ballot_files():
    base = ROOT / 'data/policy/ballot-2026'
    return {p.relative_to(base).as_posix(): load(p) for p in base.rglob('*.json')}


@pytest.fixture
def ballots():
    files = ballot_files()
    row = files['statewide.json']['coverage'][0]
    row.update(coverage_state='verified_measure_found', reviewed_source=URL,
               checked=CHECKED, entry_ids=['synthetic-measure'])
    files['statewide.json']['entries'] = [{
        'id': 'synthetic-measure',
        'election': {'date': '2026-11-03', 'type': 'general'},
        'jurisdiction': {'geoid': '08', 'level': 'state', 'name': 'Colorado'},
        'measure': {
            'number': 'TEST', 'official_title': 'Synthetic question for tests only',
            'origin': 'referred', 'relevance': ['housing_finance'],
            'fiscal': {k: None for k in ('mechanism', 'rate', 'amount_cap', 'duration', 'sunset')},
        },
        'status': 'on_ballot',
        'sources': {k: deepcopy(SOURCE) if k == 'certification' else None for k in
                    ('certification', 'official_text', 'ballot_notice', 'blue_book', 'resolution')},
        'neutral_title': 'Housing levy of 2 mills for 10 years',
        'detail': 'Raises $1M at 2.5% through 2040.',
        'evidence': [{'section': 'Synthetic question',
                      'quote': 'A 2 mill levy for ten years raises $1 million at 2.5 percent through 2040.'}],
        'verification': {'level': 'primary', 'against': 'Synthetic question', 'checked': CHECKED},
        'limitations': [], 'result': None, 'history': [], 'archived': False,
    }]
    return files


def candidate_record(name, party):
    return {
        'candidate': name, 'office': 'Treasurer', 'party': party,
        'campaign_source': {'url': None, 'published': None, 'retrieved': None, 'archive_url': None},
        'topics': [], 'neutral_summary': '', 'quote': '', 'coverage_state': 'not_researched',
        'verification': None, 'proposed_appointments': [], 'history': [], 'archived': False,
    }


@pytest.fixture
def candidates():
    # The roster is independent of records. Removing a record must not alter it.
    roster = [{'candidate': 'Fixture A', 'party': 'Major label'},
              {'candidate': 'Fixture B', 'party': 'Minor label'},
              {'candidate': 'Fixture C', 'party': 'Unaffiliated label'}]
    doc = {
        'schema': 'candidate-platforms/v1',
        'races': [{'office': 'Treasurer', 'election_date': '2026-11-03',
                   'candidates_source': SOS_FIXTURE,
                   'coverage_state': 'not_researched', 'roster_checked': CHECKED,
                   'certified_candidates': roster}],
        'candidates': [candidate_record('Fixture A', 'Major label'),
                       candidate_record('Fixture B', 'Minor label'),
                       candidate_record('Fixture C', 'Unaffiliated label')],
    }
    record = doc['candidates'][0]
    record.update(coverage_state='verified_platform_found', topics=['supply'],
                  neutral_summary='The campaign says it would allocate $2M over 5 years.',
                  quote='Allocate $2 million over five years.',
                  verification={'level': 'primary', 'checked': CHECKED})
    record['campaign_source'].update(url=URL, retrieved=CHECKED)
    return doc


@pytest.fixture
def watch():
    doc = load(ROOT / 'data/policy/policy-watch.json')
    doc['entries'].append({
        'id': 'synthetic-person', 'section': 'people', 'status': 'current', 'date': None,
        'title': 'Synthetic housing role', 'detail': 'Fixture holds a housing role.', 'programs': [],
        'source': {'label': 'Synthetic agency', 'url': URL},
        'verification': {'level': 'primary', 'against': 'Synthetic agency page', 'checked': CHECKED},
        'evidence': [{'section': 'Leadership', 'quote': 'Fixture holds a housing role.'}],
        'role': 'Housing role', 'agency': 'Synthetic agency', 'appointing_authority': None,
        'person': {'name': 'Fixture Person'}, 'action': 'appointed',
        'dates': {k: None for k in ('nominated', 'confirmed', 'effective', 'term_end')},
        'predecessor': None, 'relevance': ['Housing administration'],
    })
    return doc


def set_path(value, path, replacement):
    for key in path[:-1]:
        value = value[key]
    value[path[-1]] = replacement


def test_ballot_live_dataset():
    validate_ballots(ballot_files(), GEO)


def test_candidate_live_dataset():
    validate_candidates(load(ROOT / 'data/policy/candidate-platforms-2026.json'))


def test_policy_watch_existing_data_validates_without_migration():
    validate_watch(load(ROOT / 'data/policy/policy-watch.json'))


def test_ballot_positive_fixture(ballots):
    validate_ballots(ballots, GEO, TODAY)


def test_candidate_positive_fixture_includes_unresearched_minor_party(candidates):
    validate_candidates(candidates, TODAY)


def test_policy_people_optional_extension(watch):
    validate_watch(watch, TODAY)
    for key in ('role', 'agency', 'appointing_authority', 'person', 'action', 'dates', 'predecessor', 'relevance'):
        del watch['entries'][-1][key]
    validate_watch(watch, TODAY)


@pytest.mark.parametrize('schema', ['ballot-2026', 'candidate-platforms-2026', 'policy-watch'])
def test_policy_schemas_are_valid(schema):
    validator(schema)


@pytest.mark.parametrize('path', [
    ('status',), ('election', 'type'), ('jurisdiction', 'level'), ('measure', 'origin'),
    ('measure', 'relevance', 0), ('verification', 'level'),
])
def test_ballot_invalid_enums_fail(ballots, path):
    set_path(ballots['statewide.json']['entries'][0], path, 'invalid-enum')
    with pytest.raises(AssertionError):
        validate_ballots(ballots, GEO, TODAY)


@pytest.mark.parametrize('status', ['proposed', 'title_set', 'petitioning', 'certified', 'on_ballot',
                                   'passed', 'failed', 'withdrawn', 'litigated'])
def test_ballot_all_statuses_supported(ballots, status):
    ballots['statewide.json']['entries'][0]['status'] = status
    validate_ballots(ballots, GEO, TODAY)


@pytest.mark.parametrize('state', ['official_ballot_reviewed_none_found', 'not_applicable',
                                  'official_notice_unavailable', 'source_unreadable'])
@pytest.mark.parametrize('missing', [None, 'reviewed_source', 'checked'])
def test_ballot_reviewed_coverage_requires_source_and_date(ballots, state, missing):
    row = ballots['counties/08001.json']['coverage'][0]
    row.update(coverage_state=state, reviewed_source=URL, checked=CHECKED)
    if missing:
        row[missing] = None
        with pytest.raises(AssertionError, match='reviewed row needs'):
            validate_ballots(ballots, GEO, TODAY)
    else:
        validate_ballots(ballots, GEO, TODAY)


def test_ballot_invalid_coverage_enum(ballots):
    ballots['statewide.json']['coverage'][0]['coverage_state'] = 'guessed_none'
    with pytest.raises(AssertionError):
        validate_ballots(ballots, GEO, TODAY)


@pytest.mark.parametrize('status', ['certified', 'on_ballot'])
@pytest.mark.parametrize('source', ['certification', 'ballot_notice', None])
def test_ballot_certification_source(ballots, status, source):
    entry = ballots['statewide.json']['entries'][0]
    entry['status'] = status
    entry['sources']['certification'] = None
    if source:
        entry['sources'][source] = SOURCE
        validate_ballots(ballots, GEO, TODAY)
    else:
        with pytest.raises(AssertionError, match='needs certification or ballot_notice'):
            validate_ballots(ballots, GEO, TODAY)


@pytest.mark.parametrize('mutation', ['missing_file', 'extra_file', 'missing_municipality',
                                    'duplicate_municipality', 'wrong_county', 'cdp', 'missing_state',
                                    'wrong_geoid_type', 'wrong_name', 'missing_county'])
def test_ballot_coverage_mutations_fail(ballots, mutation):
    municipal = next(p for p in ballots if p.startswith('counties/') and len(ballots[p]['coverage']) > 1)
    other = next(p for p in ballots if p.startswith('counties/') and p != municipal)
    rows = ballots[municipal]['coverage']
    if mutation == 'missing_file':
        del ballots[other]
    elif mutation == 'extra_file':
        ballots['counties/08999.json'] = deepcopy(ballots[other])
    elif mutation == 'missing_municipality':
        rows.pop()
    elif mutation == 'duplicate_municipality':
        rows.append(deepcopy(rows[-1]))
    elif mutation == 'wrong_county':
        ballots[other]['coverage'].append(rows.pop())
    elif mutation == 'cdp':
        rows[-1]['geoid'] = GEO['cdps'][0]['geoid']
    elif mutation == 'missing_state':
        ballots['statewide.json']['coverage'] = []
    elif mutation == 'wrong_geoid_type':
        rows[-1]['geoid'] = int(rows[-1]['geoid'])
    elif mutation == 'wrong_name':
        rows[-1]['name'] = 'Wrong identity'
    else:
        rows.pop(0)
    with pytest.raises(AssertionError):
        validate_ballots(ballots, GEO, TODAY)


@pytest.mark.parametrize('mutation', ['dangling', 'cross_file', 'orphan', 'duplicate', 'wrong_jurisdiction'])
def test_ballot_entry_references_fail(ballots, mutation):
    doc = ballots['statewide.json']
    if mutation == 'dangling':
        doc['coverage'][0]['entry_ids'] = ['missing']
    elif mutation == 'cross_file':
        ballots['counties/08001.json']['entries'] = doc['entries']
        doc['entries'] = []
    elif mutation == 'orphan':
        doc['entries'].append({**deepcopy(doc['entries'][0]), 'id': 'orphan'})
    elif mutation == 'duplicate':
        doc['entries'].append(deepcopy(doc['entries'][0]))
    else:
        doc['entries'][0]['jurisdiction']['geoid'] = '08001'
    with pytest.raises(AssertionError):
        validate_ballots(ballots, GEO, TODAY)


@pytest.mark.parametrize('prose,quote', [
    ('$1M', '$1,000,000'), ('$1.25 billion', '$1,250,000,000'), ('$0.05', '$0.05'),
    ('2.5%', '2.5 percent'), ('five mills', '5 mills'), ('ten-year term', '10 years'),
    ('twenty-five years', '25 years'), ('6 months', 'six months'), ('30 days', '30 days'),
    ('through 2040', 'expires in 2040'), ('5–10 years', 'five years to ten years'),
    ('$5–10 million', '$5 million to $10 million'), ('$2040', '$2,040'),
    ('$one hundred thousand', '$100,000'), ('one hundred and twenty years', '120 years'),
    ('-$5', '$-5'),
    ('$.50', '$0.50'), ('.5%', '0.5 percent'), ('.5 mills', '0.5 mill'),
])
def test_policy_figure_rewording_stays_green(prose, quote):
    assert prose != quote or prose in ('$0.05', '30 days')
    assert figures(prose), 'the positive test must scan at least one figure'
    neutral({'detail': prose}, quote)


@pytest.mark.parametrize('prose,quote', [
    ('$1M', '$11M'), ('$0.05', '$0.04'), ('2.5%', '12.5%'), ('2 mills', '2%'),
    ('10 years', '10 months'), ('5–10 years', '10 years'), ('through 2040', 'through 2041'),
    ('six months', 'five months'), ('twenty-five years', '25 dollars'),
    ('$5–10 million', '$10 million'), ('-$5', '$5'),
    ('$.50', '$.51'), ('.5%', '5%'), ('.5 mills', '5 mills'),
])
@pytest.mark.parametrize('field', ['neutral_title', 'detail', 'neutral_summary'])
def test_policy_unsupported_figures_fail(field, prose, quote):
    with pytest.raises(AssertionError, match='figures absent'):
        neutral({field: prose}, quote)


@pytest.mark.parametrize('word', ['endorse', 'endorsed', 'recommend', 'recommendation', 'best',
                                 'friendly', 'pro-housing', 'anti-housing', 'PRO‑housing'])
@pytest.mark.parametrize('field', ['neutral_title', 'neutral_summary', 'detail'])
def test_policy_forbidden_neutral_language(field, word):
    with pytest.raises(AssertionError, match='forbidden neutral wording'):
        neutral({field: word}, word)


def test_policy_source_quotes_allow_attributed_language():
    neutral({'neutral_summary': 'The campaign says it would expand housing.'},
            'Endorse our best pro-housing plan.')


@pytest.mark.parametrize('field', ['score', 'rank', 'endorsement', 'stance', 'party_inference',
                                  'partyInference', 'housing_score', 'party_lean'])
def test_policy_forbidden_fields_are_recursive(field):
    with pytest.raises(AssertionError, match='forbidden field'):
        audit_tree({'history': [{'nested': {field: 'x'}}]}, TODAY)


@pytest.mark.parametrize('path', [('office',), ('topics', 0), ('coverage_state',), ('verification', 'level')])
def test_candidate_invalid_enums_fail(candidates, path):
    set_path(candidates['candidates'][0], path, 'invalid-enum')
    with pytest.raises(AssertionError):
        validate_candidates(candidates, TODAY)


@pytest.mark.parametrize('index', [0, 1, 2])
def test_candidate_omission_fails_against_independent_roster(candidates, index):
    original_roster = deepcopy(candidates['races'][0]['certified_candidates'])
    removed = candidates['candidates'].pop(index)
    assert removed not in candidates['candidates']
    assert candidates['races'][0]['certified_candidates'] == original_roster
    with pytest.raises(AssertionError, match='every certified candidate'):
        validate_candidates(candidates, TODAY)


@pytest.mark.parametrize('mutation', ['roster_empty', 'source_missing', 'non_sos', 'spoof_host',
                                    'checked_missing', 'duplicate_roster', 'wrong_party',
                                    'duplicate_record', 'unknown_race', 'false_complete', 'invalid_race_state'])
def test_candidate_roster_mutations_fail(candidates, mutation):
    race = candidates['races'][0]
    if mutation == 'roster_empty':
        race['certified_candidates'] = []
    elif mutation in ('source_missing', 'non_sos', 'spoof_host'):
        race['candidates_source'] = {'source_missing': None, 'non_sos': URL,
                                    'spoof_host': f'{SCHEME}://www.coloradosos.gov.example.org/pubs/elections/x'}[mutation]
    elif mutation == 'checked_missing':
        race['roster_checked'] = None
    elif mutation == 'duplicate_roster':
        race['certified_candidates'].append(deepcopy(race['certified_candidates'][0]))
    elif mutation == 'wrong_party':
        candidates['candidates'][1]['party'] = 'Inferred party'
    elif mutation == 'duplicate_record':
        candidates['candidates'].append(deepcopy(candidates['candidates'][0]))
    elif mutation == 'unknown_race':
        candidates['candidates'][0]['office'] = 'Attorney General'
    elif mutation == 'false_complete':
        race['coverage_state'] = 'complete'
    else:
        race['coverage_state'] = 'verified'
    with pytest.raises(AssertionError):
        validate_candidates(candidates, TODAY)


def test_candidate_no_position_and_unavailable_need_no_invented_quotes(candidates):
    c = candidates['candidates'][1]
    c.update(coverage_state='official_material_reviewed_no_housing_position_found',
             verification={'level': 'primary', 'checked': CHECKED})
    c['campaign_source'].update(url=URL, retrieved=CHECKED)
    c['reviewed_sources'] = [SOURCE]
    candidates['candidates'][2]['coverage_state'] = 'campaign_source_unavailable'
    candidates['races'][0]['coverage_state'] = 'complete'
    validate_candidates(candidates, TODAY)
    c['verification'] = None
    with pytest.raises(AssertionError, match='requires primary verification'):
        validate_candidates(candidates, TODAY)


def test_candidate_report_is_separate_and_cannot_replace_campaign_record(candidates):
    report = deepcopy(candidates['candidates'][0])
    report.update(coverage_state='not_researched', verification={
        'level': 'reported', 'by': 'Synthetic outlet', 'checked': CHECKED})
    candidates['candidates'].append(report)
    validate_candidates(candidates, TODAY)
    candidates['candidates'].pop(0)
    with pytest.raises(AssertionError, match='every certified candidate'):
        validate_candidates(candidates, TODAY)


def test_candidate_report_cannot_set_verified_platform(candidates):
    report = deepcopy(candidates['candidates'][0])
    report['verification'] = {'level': 'reported', 'by': 'Synthetic outlet', 'checked': CHECKED}
    candidates['candidates'].append(report)
    with pytest.raises(AssertionError, match='cannot establish campaign coverage'):
        validate_candidates(candidates, TODAY)


@pytest.mark.parametrize('kind', ['ballot', 'candidate'])
def test_policy_prose_mutations_run_through_live_validators(ballots, candidates, kind):
    if kind == 'ballot':
        record = ballots['statewide.json']['entries'][0]
        field, reworded, wrong = 'detail', 'The levy raises $1 million.', 'The levy raises $9 million.'
        check = lambda: validate_ballots(ballots, GEO, TODAY)
    else:
        record = candidates['candidates'][0]
        field, reworded, wrong = ('neutral_summary', 'The campaign says it would allocate $2 million.',
                                  'The campaign says it would allocate $9 million.')
        check = lambda: validate_candidates(candidates, TODAY)
    original = record[field]
    record[field] = reworded
    assert record[field] != original and record[field] == reworded
    check()
    record[field] = wrong
    assert record[field] != reworded and record[field] == wrong
    with pytest.raises(AssertionError, match='figures absent'):
        check()


def test_candidate_proposed_appointment_is_explicit_campaign_claim(candidates):
    claim = {'role': 'Housing coordinator', 'person': None, 'source': SOURCE,
             'quote': 'We would create a housing coordinator role.', 'claim_type': 'campaign_claim'}
    candidates['candidates'][0]['proposed_appointments'] = [claim]
    validate_candidates(candidates, TODAY)
    claim['person'] = 'Synthetic Person'
    validate_candidates(candidates, TODAY)
    claim['claim_type'] = 'confirmed'
    with pytest.raises(AssertionError):
        validate_candidates(candidates, TODAY)


@pytest.mark.parametrize('kind', ['ballot', 'candidate'])
@pytest.mark.parametrize('days,archived,passes', [(44, False, True), (45, False, False),
                                               (46, False, False), (45, True, True), (365, True, True)])
def test_policy_election_currency(ballots, candidates, kind, days, archived, passes):
    today = date(2026, 11, 3) + timedelta(days=days)
    if kind == 'ballot':
        ballots['statewide.json']['entries'][0]['archived'] = archived
        check = lambda: validate_ballots(ballots, GEO, today)
    else:
        for c in candidates['candidates']:
            c['archived'] = archived
        check = lambda: validate_candidates(candidates, today)
    if passes:
        check()
    else:
        with pytest.raises(AssertionError, match='45 or more days'):
            check()


@pytest.mark.parametrize('target', ['ballot_row', 'ballot_entry', 'candidate', 'roster', 'people', 'history'])
def test_policy_checked_cannot_be_future(ballots, candidates, watch, target):
    tomorrow = (TODAY + timedelta(days=1)).isoformat()
    if target == 'ballot_row':
        ballots['statewide.json']['coverage'][0]['checked'] = tomorrow
    elif target == 'ballot_entry':
        ballots['statewide.json']['entries'][0]['verification']['checked'] = tomorrow
    elif target == 'candidate':
        candidates['candidates'][0]['verification']['checked'] = tomorrow
    elif target == 'roster':
        candidates['races'][0]['roster_checked'] = tomorrow
    elif target == 'people':
        watch['entries'][-1]['verification']['checked'] = tomorrow
    else:
        candidates['candidates'][0]['history'] = [{'checked': tomorrow, 'note': 'Synthetic review', 'source': None}]
    check = (lambda: validate_ballots(ballots, GEO, TODAY)) if target.startswith('ballot') else (
        (lambda: validate_watch(watch, TODAY)) if target == 'people' else
        (lambda: validate_candidates(candidates, TODAY)))
    with pytest.raises(AssertionError, match='after today'):
        check()


@pytest.mark.parametrize('action', ['appointed', 'nominated', 'confirmed', 'resigned', 'replaced', 'interim'])
def test_policy_people_action_enum(watch, action):
    watch['entries'][-1]['action'] = action
    validate_watch(watch, TODAY)


@pytest.mark.parametrize('mutation', ['action', 'invalid_date', 'future_checked', 'non_people', 'private_person_field'])
def test_policy_people_invalid_extension_fails(watch, mutation):
    person = watch['entries'][-1]
    if mutation == 'action':
        person['action'] = 'elected'
    elif mutation == 'invalid_date':
        person['dates']['effective'] = '2026-02-30'
    elif mutation == 'future_checked':
        person['verification']['checked'] = '2099-01-01'
    elif mutation == 'non_people':
        person['section'] = 'qap'
    else:
        person['person']['contact'] = 'Not part of this schema'
    with pytest.raises(AssertionError):
        validate_watch(watch, TODAY)


@pytest.mark.parametrize('stage', ['unofficial', 'certified', 'invalid'])
def test_ballot_result_stage(ballots, stage):
    ballots['statewide.json']['entries'][0]['result'] = {
        'outcome': 'passed', 'stage': stage, 'source': SOURCE, 'as_of': CHECKED}
    if stage == 'invalid':
        with pytest.raises(AssertionError):
            validate_ballots(ballots, GEO, TODAY)
    else:
        validate_ballots(ballots, GEO, TODAY)
