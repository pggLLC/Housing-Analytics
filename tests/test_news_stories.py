"""Housing News stories — scripts/generate_policy_briefs.py `build_stories`.

The Housing News page (policy-briefs.html) shows the pipeline's `stories` as
given: it does not decide scope, merge headlines or tag places itself. So the
rules live here, and so do their tests. The page side is covered by
test/housing-news-leads-with-the-newest.test.mjs.
"""

import json
import re
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))

import generate_policy_briefs as gpb  # noqa: E402


@pytest.fixture(scope='module')
def geos():
    return gpb.load_geographies()


def alert(title, source, date='2026-09-20', topic='affordable_housing', url=None):
    return {'title': f'{title} - {source}', 'source': source, 'date': f'{date}T12:00:00Z',
            'topic': topic, 'url': url or f'https://news.localhost/{abs(hash(title + source))}'}


def by_title(stories):
    return {s['title']: s for s in stories}


def test_a_town_without_the_word_colorado_is_colorado_news(geos):
    stories, _ = gpb.build_stories([
        alert('Sterling housing project is recipient of funds', 'Sterling Journal-Advocate'),
        alert('Frisco breaks ground on new affordable housing complex', 'CBS News'),
    ], geos)
    s = by_title(stories)
    sterling = s['Sterling housing project is recipient of funds']
    assert sterling['scope'] == 'colorado'
    assert [p['name'] for p in sterling['places']] == ['Sterling']
    frisco = s['Frisco breaks ground on new affordable housing complex']
    assert frisco['scope'] == 'colorado', 'a Colorado town named without "Colorado" was dropped'
    assert [p['name'] for p in frisco['places']] == ['Frisco']


def test_a_publisher_with_a_hyphen_is_removed_from_the_headline(geos):
    stories, _ = gpb.build_stories([alert('Sterling project wins Prop 123 award', 'Sterling Journal-Advocate')], geos)
    assert stories[0]['title'] == 'Sterling project wins Prop 123 award'
    assert stories[0]['source'] == 'Sterling Journal-Advocate'


def test_other_states_are_out_and_federal_policy_is_in(geos):
    stories, counts = gpb.build_stories([
        alert('Tennessee agency awards credits', 'Tennessee Lookout'),
        alert('Aurora, Illinois council approves apartments', 'Beacon-News'),
        alert('HUD rule change for public housing', 'Bisnow'),
    ], geos)
    titles = [s['title'] for s in stories]
    assert titles == ['HUD rule change for public housing']
    assert stories[0]['scope'] == 'federal'
    assert counts['out_of_scope'] == 2


def test_everyday_word_place_names_need_colorado_context(geos):
    stories, _ = gpb.build_stories([
        # No Colorado context: "Golden" is not the town.
        alert('A Golden rule for renters', 'Shelterforce'),
        # A Colorado outlet: it is.
        alert("Construction underway on downtown Golden's affordable condos", 'Golden Transcript'),
        # Colorado context, but the next word makes it a property name.
        alert('Crawford Commons Apartments in Clifton Colorado awarded credits', 'yieldpro.com'),
        alert('Wellington Renews Proposition 123 Commitment', 'North Forty News'),
    ], geos)
    s = by_title(stories)
    assert 'A Golden rule for renters' not in s
    assert [p['name'] for p in s["Construction underway on downtown Golden's affordable condos"]['places']] == ['Golden']
    assert [p['name'] for p in s['Crawford Commons Apartments in Clifton Colorado awarded credits']['places']] == ['Clifton']
    assert [p['name'] for p in s['Wellington Renews Proposition 123 Commitment']['places']] == ['Wellington']


def test_a_county_name_shared_with_other_states_needs_colorado_context(geos):
    stories, _ = gpb.build_stories([
        alert('Adams County weighs rental rules', 'Patch'),
        alert('Larimer County meets housing requirements', 'Patch'),
        alert('Adams County, Colorado weighs rental rules', 'Patch'),
    ], geos)
    s = by_title(stories)
    assert 'Adams County weighs rental rules' not in s
    assert s['Larimer County meets housing requirements']['places'][0]['geoid'] == '08069'
    assert s['Adams County, Colorado weighs rental rules']['places'][0]['geoid'] == '08001'


def test_the_same_headline_from_several_outlets_is_one_story_newest_first(geos):
    stories, counts = gpb.build_stories([
        alert('Pueblo breaks ground on 98 homes', 'Pueblo Chieftain', '2026-09-20'),
        alert('Pueblo breaks ground on 98 homes', 'KRDO', '2026-09-21'),
        alert('Denver council weighs Prop 123 opt-in', 'Denverite', '2026-09-22'),
    ], geos)
    assert [s['title'] for s in stories] == ['Denver council weighs Prop 123 opt-in', 'Pueblo breaks ground on 98 homes']
    pueblo = stories[1]
    assert pueblo['source'] == 'KRDO' and pueblo['date'] == '2026-09-21', 'the newest copy should lead'
    assert [a['source'] for a in pueblo['also']] == ['Pueblo Chieftain']
    assert counts['merged'] == 1


def test_programs_are_tagged_and_tool_evaluations_are_not_news(geos):
    stories, _ = gpb.build_stories([
        alert('CHFA opens comment on the 2027 QAP', 'Colorado Sun'),
        alert('Rent limit calculator', 'Novogradac', topic='tool_watch'),
    ], geos)
    assert [s['title'] for s in stories] == ['CHFA opens comment on the 2027 QAP']
    assert stories[0]['programs'] == ['LIHTC', 'CHFA']


def test_regions_agree_with_the_ranking_index(geos):
    """A place's region is the one the rest of the site shows for it."""
    index = json.loads((ROOT / 'data' / 'hna' / 'ranking-index.json').read_text())
    region_of = {r['geoid']: r['region'] for r in index['rankings']}
    checked = 0
    for kind in ('places', 'counties'):
        for geo in geos[kind].values():
            if geo['geoid'] in region_of:
                assert geo['region'] == region_of[geo['geoid']], geo
                checked += 1
    assert checked > 400, f'only {checked} geographies compared; the lookup has drifted'


def test_the_committed_stories_are_well_formed():
    data = json.loads((ROOT / 'data' / 'policy_briefs.json').read_text())
    stories = data.get('stories')
    assert isinstance(stories, list) and stories, 'data/policy_briefs.json has no stories for the page'
    geo = json.loads((ROOT / 'data' / 'hna' / 'geo-config.json').read_text())
    geoids = {g['geoid'] for k in ('counties', 'places', 'cdps') for g in geo[k]}
    regions = set(gpb._county_region().values())
    dates = [s['date'] for s in stories]
    assert dates == sorted(dates, reverse=True), 'committed stories are not newest first'
    keys = [gpb.norm_title(s['title']) for s in stories]
    assert len(keys) == len(set(keys)), 'a headline appears twice'
    for s in stories:
        assert s['scope'] in ('colorado', 'federal')
        assert re.match(r'^\d{4}-\d{2}-\d{2}$', s['date']), s
        assert all(p['geoid'] in geoids for p in s['places']), s
        assert set(s['regions']) <= regions, s
