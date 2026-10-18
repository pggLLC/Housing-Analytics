"""Brief news queue — scripts/news/build_brief_news_queue.py.

Which headlines each jurisdiction brief has waiting since its last review.
The brief panel and the review issue are covered by
test/housing-events-and-brief-news.test.mjs.
"""
import importlib.util
import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('bnq', ROOT / 'scripts' / 'news' / 'build_brief_news_queue.py')
bnq = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bnq)

TODAY = date(2026, 10, 14)
CARBONDALE = {'geoid': '0812045', 'jurisdiction': 'Town of Carbondale', 'scope': 'place',
              'county_fips': '08045', 'published': True, 'last_curated': '2026-09-01'}
GARFIELD = {'geoid': '08045', 'jurisdiction': 'Garfield County', 'scope': 'county',
            'county_fips': '08045', 'published': False, 'last_curated': '2026-06-19'}
COUNTIES = {'0812045': '08045', '0864255': '08045', '0820000': '08031'}


def story(title, date_, *geoids, link=None):
    return {'title': title, 'source': 'The Sopris Sun', 'date': date_,
            'link': link or 'https://news.localhost/' + title.replace(' ', '-'),
            'places': [{'geoid': g, 'name': g, 'type': 'place'} for g in geoids], 'also': []}


def rows(doc):
    return {r['geoid']: r for r in doc['briefs']}


def test_only_stories_since_the_last_review_are_queued():
    doc = bnq.build(TODAY, [CARBONDALE], [
        story('Carbondale approves housing lease', '2026-10-01', '0812045'),
        story('Carbondale budget talk', '2026-09-01', '0812045'),
        story('Old Carbondale story', '2026-08-31', '0812045'),
    ], [], COUNTIES, None)
    titles = [s['title'] for s in rows(doc)['0812045']['stories']]
    assert titles == ['Carbondale approves housing lease', 'Carbondale budget talk'], \
        'a story from the review date itself is kept; one from before it is not'


def test_county_and_town_stories_match_both_ways():
    stories = [
        story('Rifle opens apartments', '2026-10-02', '0864255'),
        story('Garfield County housing authority', '2026-10-03', '08045'),
        story('Denver council vote', '2026-10-04', '0820000'),
    ]
    r = rows(bnq.build(TODAY, [CARBONDALE, GARFIELD], stories, [], COUNTIES, None))
    assert [(s['title'], s['match']) for s in r['08045']['stories']] == [
        ('Garfield County housing authority', 'place'), ('Rifle opens apartments', 'in_county')]
    assert [(s['title'], s['match']) for s in r['0812045']['stories']] == [
        ('Garfield County housing authority', 'county')]
    assert 'Denver council vote' not in json.dumps(r)


def test_a_used_or_dismissed_story_leaves_the_queue():
    s1 = story('Carbondale approves housing lease', '2026-10-01', '0812045')
    s2 = story('Carbondale fee waiver', '2026-10-02', '0812045')
    ledger = {'entries': [
        {'geoid': '0812045', 'link': s1['link'], 'status': 'used'},
        {'geoid': '0812045', 'title': 'Carbondale Fee Waiver!', 'status': 'dismissed', 'reason': 'not housing'},
        {'geoid': '08045', 'link': 'https://other.localhost', 'status': 'used'},
    ]}
    assert rows(bnq.build(TODAY, [CARBONDALE], [s1, s2], [], COUNTIES, ledger))['0812045']['stories'] == []
    kept = rows(bnq.build(TODAY, [CARBONDALE], [s1, s2], [], COUNTIES, {'entries': [
        {'geoid': '08045', 'link': s1['link'], 'status': 'used'}]}))['0812045']['stories']
    assert len(kept) == 2, "a story handled for one brief still counts for another"


def test_an_unread_story_stays_queued_after_the_review_date():
    s1 = story('Carbondale paywalled housing story', '2026-09-01', '0812045')
    lead = {'geoid': '0812045', 'title': s1['title'], 'link': s1['link'], 'date': s1['date'],
            'source': 'Paywalled Daily', 'status': 'unread', 'reason': 'publisher blocks automated reading'}
    reviewed = {**CARBONDALE, 'last_curated': '2026-10-01'}
    got = rows(bnq.build(TODAY, [reviewed], [s1], [], COUNTIES, {'entries': [lead]}))['0812045']['stories']
    assert [(x['title'], x['match'], x['unread']) for x in got] == [
        (s1['title'], 'place', 'publisher blocks automated reading')]
    got = rows(bnq.build(TODAY, [CARBONDALE], [s1], [], COUNTIES, {'entries': [lead]}))['0812045']['stories']
    assert len(got) == 1, "a story both in the feed and unread in the ledger shows once"
    done = rows(bnq.build(TODAY, [reviewed], [s1], [], COUNTIES, {'entries': [{**lead, 'status': 'dismissed'}]}))
    assert done['0812045']['stories'] == []


def test_events_match_by_name_and_past_ones_drop():
    events = [
        {'title': 'chfareach: NSPIRE Inspections, Carbondale', 'start': '2026-10-22', 'location': 'In-person'},
        {'title': 'Workshop', 'start': '2026-11-01', 'location': 'In-person, Carbondale'},
        {'title': 'Carbondale mixer', 'start': '2026-10-01', 'location': None},
        {'title': 'Carbondale-ish', 'start': '2026-11-01', 'location': 'Online'},
    ]
    evs = rows(bnq.build(TODAY, [CARBONDALE], [], events, COUNTIES, None))['0812045']['events']
    assert [e['title'] for e in evs] == ['chfareach: NSPIRE Inspections, Carbondale', 'Workshop']


def test_reasons_and_order():
    doc = bnq.build(TODAY, [GARFIELD, CARBONDALE], [
        story('Carbondale approves housing lease', '2026-10-01', '0812045')], [], COUNTIES, None)
    first, second = doc['briefs']
    assert first['geoid'] == '0812045', 'a brief with news naming it comes first'
    assert first['reasons'] == ['1 new story naming it', 'not reviewed in 43 days']
    assert second['reasons'] == ['1 new story about its towns', 'not reviewed in 117 days',
                                 'draft, not shown on the site']

