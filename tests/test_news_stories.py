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
        # El Paso, Summit and Otero counties exist in Texas, Ohio/Utah and New Mexico.
        alert('El Paso County approves affordable housing', 'El Paso Times'),
        alert('Summit County weighs short-term rental tax', 'Akron Beacon Journal'),
        alert('El Paso County approves affordable housing plan', 'Colorado Springs Gazette'),
    ], geos)
    s = by_title(stories)
    assert 'Adams County weighs rental rules' not in s
    assert 'El Paso County approves affordable housing' not in s, 'a Texas county was filed as Colorado'
    assert 'Summit County weighs short-term rental tax' not in s
    assert s['El Paso County approves affordable housing plan']['places'][0]['geoid'] == '08041'
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
        assert s['scope'] in ('colorado', 'federal', 'national')
        assert re.match(r'^\d{4}-\d{2}-\d{2}$', s['date']), s
        assert all(p['geoid'] in geoids for p in s['places']), s
        assert set(s['regions']) <= regions, s


def test_a_property_listing_is_not_news(geos):
    stories, counts = gpb.build_stories([
        alert('124 Deer Trail Ave, Carbondale, CO 81623', 'Realtor.com'),
        alert('2 bed apartment in Carbondale', 'Zillow'),
        alert('Carbondale council approves affordable housing lease', 'The Sopris Sun'),
    ], geos)
    assert [s['title'] for s in stories] == ['Carbondale council approves affordable housing lease']
    assert counts['out_of_scope'] == 2


def test_yuma_needs_colorado_context(geos):
    stories, _ = gpb.build_stories([
        alert('Gov. Hobbs highlights Yuma apartments as model for affordable housing', 'AZ Family'),
        alert('Yuma apartments praised as model for affordable housing', 'KAWC'),
        alert('Yuma, Colorado council weighs new rental housing', 'Fort Morgan Times'),
    ], geos)
    titles = [s['title'] for s in stories]
    assert titles == ['Yuma, Colorado council weighs new rental housing']


def test_briefs_summarise_only_headlines_the_stories_keep(geos):
    alerts = [
        alert('Gov. Hobbs highlights Yuma apartments as model for affordable housing', 'AZ Family'),
        alert('Yorkshire Water sewer capacity threatens new homes and funding, says councillor',
              'Richmondshire Today', topic='infrastructure'),
        alert('Alders want review of inclusionary housing ordinance', 'Evanston Now', topic='policy'),
        alert('Salida asks Buena Vista for Proposition 123 housing credits', 'The Mountain Mail',
              topic='policy'),
        {'title': 'Tool watch item', 'source': 'x', 'date': '2026-09-20', 'topic': 'tool_watch'},
    ]
    kept = gpb.in_scope_alerts(alerts, geos)
    stories, _ = gpb.build_stories(alerts, geos)
    # The scan found something to keep and something to drop.
    assert 0 < len(kept) < len(alerts)
    story_titles = {s['title'] for s in stories}
    for a in kept:
        if a['topic'] == 'tool_watch':
            continue
        headline, _src = gpb.split_title(a['title'], a['source'])
        assert headline in story_titles
    assert not any('Yuma' in a['title'] or 'Richmondshire' in a['title'] or 'Evanston' in a['title']
                   for a in kept)


def test_a_colorado_headline_naming_another_state_stays_in_briefs_and_stories(geos):
    kept = alert('Colorado lawmakers borrow Oregon zoning reforms', 'Patch')
    dropped = alert('Oregon lawmakers pass zoning reforms', 'Patch')
    town_elsewhere = alert('Aurora, Illinois approves housing plan', 'Patch')
    stories, _ = gpb.build_stories([kept, dropped, town_elsewhere], geos)
    s = by_title(stories)
    assert 'Colorado lawmakers borrow Oregon zoning reforms' in s
    assert 'Oregon lawmakers pass zoning reforms' not in s
    assert 'Aurora, Illinois approves housing plan' not in s
    assert gpb.in_scope_alerts([kept, dropped, town_elsewhere], geos) == [kept]


def test_a_colorado_street_elsewhere_is_not_colorado_news(geos):
    stories, _ = gpb.build_stories([
        alert('Hearing on Up to $42 Million in Bonds for East Colorado Housing Project Pulled From Council Agenda',
              'Pasadena Now'),
        alert('Affordable housing secures financing at 1756 Colorado Blvd. in Pasadena', 'Urbanize LA'),
        alert('Eastern Colorado county weighs housing grant', 'Sterling Journal-Advocate'),
    ], geos)
    assert set(by_title(stories)) == {'Eastern Colorado county weighs housing grant'}


def test_headlines_that_are_not_about_housing_are_left_out(geos):
    stories, _ = gpb.build_stories([
        alert('Deborah Nicholls denied bail after murder convictions overturned', 'The Denver Post'),
        alert('This Denver house inspired a famous horror film', 'Denver Gazette'),
        alert('Manny Rutinel smashes Colorado House race fundraising record in 8th CD', 'Denver Gazette'),
        alert('Colorado home sellers are cutting prices more than people in other states', 'Colorado Public Radio'),
        alert('JB Matteson Acquires Vantage at Loveland in Colorado for $72.3M',
              'Multifamily & Affordable Housing Business'),
        alert("'Off the Street' breakfast highlights The Place's mission to house and support local youth",
              'KOAA News 5'),
    ], geos)
    assert set(by_title(stories)) == {
        'Colorado home sellers are cutting prices more than people in other states',
        'JB Matteson Acquires Vantage at Loveland in Colorado for $72.3M',
        "'Off the Street' breakfast highlights The Place's mission to house and support local youth",
    }


def test_an_indirect_housing_headline_stays(geos):
    stories, _ = gpb.build_stories([
        alert("Hope is at the core of organization\u2019s purpose | NONPROFIT REGISTER", 'Colorado Politics'),
        alert('Denver Mayor Mike Johnston unveils Mile High Line project at State of the City', 'Rocky Mountain PBS'),
        alert("Roberts Resorts & Communities Acquires King's Crown in Rifle, Colorado", 'Morningstar'),
        alert("Denver's Javier Mabrey eyes Colorado House leadership", 'State Affairs Pro'),
    ], geos)
    assert len(stories) == 4


def test_a_first_name_that_is_also_a_town_is_not_that_town(geos):
    # 2026-10-19: "Elizabeth Bachmann Speaks at ... Boot Camp" (a law firm's
    # post) was matched to the town of Elizabeth and shown as its news.
    stories, _ = gpb.build_stories([
        alert('Elizabeth Bachmann Speaks at 2026 Affordable Housing Boot Camp', 'Kutak Rock'),
        alert('Elizabeth, Colo. approves workforce housing plan', 'Elbert County News'),
    ], geos)
    assert set(by_title(stories)) == {'Elizabeth, Colo. approves workforce housing plan'}


def test_a_brief_keeps_only_links_the_stories_keep(geos, tmp_path, monkeypatch):
    out = tmp_path / 'policy_briefs.json'
    out.write_text(json.dumps({'briefs': [{'title': 'b', 'sources': ['Urbanize LA', 'Denver Gazette'], 'articles': [
        {'title': 'Affordable housing slated for 2000 E. Colorado Blvd. in Pasadena - Urbanize LA', 'source': 'Urbanize LA'},
        {'title': 'Denver approves affordable housing tax credits - Denver Gazette', 'source': 'Denver Gazette'},
    ]}]}))
    monkeypatch.setattr(gpb, 'OUT_FILE', str(out))
    monkeypatch.setattr(gpb, 'load_alerts', lambda: [])
    assert gpb.refresh_stories_only() == 0
    brief = json.loads(out.read_text())['briefs'][0]
    assert [a['source'] for a in brief['articles']] == ['Denver Gazette']
    assert brief['sources'] == ['Denver Gazette']


def test_national_trends_come_only_from_listed_outlets(geos):
    # 2026-10-20: paul sent two WSJ stories the Colorado searches never
    # found, and asked for national trends from very reputable sources only.
    stories, _ = gpb.build_stories([
        alert('The Immigration Crackdown Is Making It Much Harder to Build Houses', 'WSJ'),
        alert('A New Type of Mortgage Is Reviving Long Abandoned Neighborhoods', 'WSJ'),
        alert('US homebuilder sentiment tumbles to near 14-1/2-year low in October', 'Reuters'),
        alert('As Baby Boomers Age, Housing Demand Faces a Rising Headwind', 'Joint Center for Housing Studies'),
        # Same kind of headline, unlisted outlet.
        alert('Housing starts slump as builders pull back', 'Some Housing Blog'),
        # Listed outlets, but opinion, advice, another country, another
        # state, or not housing.
        alert('Opinion | Tighter Rent Control Robs New York Tenants', 'WSJ'),
        alert("It's a great time to buy a house — if you can stomach a 7% rate", 'The Washington Post'),
        alert("China's new home prices fall again as recovery remains elusive", 'Reuters'),
        alert("Could Embracing Sprawl Ease California's Housing Crunch?", 'The New York Times'),
        alert('Supreme Court rejects Google challenge to US patent agency review policy', 'Reuters'),
        alert('Joint Center for Housing Studies', 'Joint Center for Housing Studies'),
    ], geos)
    got = {s['title']: s['scope'] for s in stories}
    assert got == {
        'The Immigration Crackdown Is Making It Much Harder to Build Houses': 'national',
        'A New Type of Mortgage Is Reviving Long Abandoned Neighborhoods': 'national',
        'US homebuilder sentiment tumbles to near 14-1/2-year low in October': 'national',
        'As Baby Boomers Age, Housing Demand Faces a Rising Headwind': 'national',
    }


def test_a_national_outlet_on_colorado_or_federal_news_keeps_that_scope(geos):
    stories, _ = gpb.build_stories([
        alert('Denver rents fall as new apartments open', 'WSJ'),
        alert('HUD cuts housing voucher funding', 'Reuters'),
    ], geos)
    assert {s['title']: s['scope'] for s in stories} == {
        'Denver rents fall as new apartments open': 'colorado',
        'HUD cuts housing voucher funding': 'federal',
    }


def test_national_trends_are_not_summarised_in_the_briefs(geos):
    alerts = [alert('U.S. Housing Starts Dropped Again in September', 'WSJ'),
              alert('Denver approves affordable housing tax credits', 'Denver Gazette')]
    assert [a['source'] for a in gpb.in_scope_alerts(alerts, geos)] == ['Denver Gazette']


def test_the_same_national_release_is_one_story(geos):
    stories, _ = gpb.build_stories([
        alert('U.S. Housing Starts Dropped Again in September', 'WSJ', date='2026-10-20'),
        alert('US Housing Starts Fall to Four-Month Low as Demand Falters', 'Bloomberg.com', date='2026-10-20'),
        alert('U.S. Home-Builder Sentiment Sinks to 14-Year Low', 'WSJ', date='2026-10-19'),
        alert('US homebuilder sentiment tumbles to near 14-1/2-year low in October', 'Reuters', date='2026-10-19'),
        # One shared phrase a day apart is not the same story.
        alert('The Immigration Crackdown Is Making It Much Harder to Build Houses', 'WSJ', date='2026-10-16'),
        alert("A developer wants to build houses near Pocahontas's birthplace", 'The Washington Post', date='2026-10-17'),
    ], geos)
    assert {s['title']: [a['source'] for a in s['also']] for s in stories} == {
        'U.S. Housing Starts Dropped Again in September': ['Bloomberg.com'],
        'U.S. Home-Builder Sentiment Sinks to 14-Year Low': ['Reuters'],
        'The Immigration Crackdown Is Making It Much Harder to Build Houses': [],
        "A developer wants to build houses near Pocahontas's birthplace": [],
    }


def test_an_outlet_retitling_its_own_national_story_is_one_story(geos):
    stories, _ = gpb.build_stories([
        alert('Luxury and Cash Fuel U.S. Housing Market', 'WSJ', date='2026-10-20'),
        alert('America’s New Housing Market Is All About Luxury—and It Runs on Cash', 'WSJ', date='2026-10-19'),
    ], geos)
    assert [s['title'] for s in stories] == ['Luxury and Cash Fuel U.S. Housing Market']
