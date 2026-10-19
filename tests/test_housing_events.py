"""Upcoming housing events — scripts/news/fetch_housing_events.py.

The page side (js/components/housing-events.js, policy-briefs.html) is covered
by test/housing-events-and-brief-news.test.mjs.
"""
import importlib.util
import json
from datetime import date
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location('fetch_housing_events', ROOT / 'scripts' / 'news' / 'fetch_housing_events.py')
fhe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fhe)

TODAY = date(2026, 10, 14)

CHFA = {'events': [
    {'title': 'chfareach: CHFA NSPIRE Inspections, Fort Collins', 'allDay': False,
     'start': '2026-10-22T13:00:00', 'end': '2026-10-22T15:00:00',
     'extendedProps': {'copy': 'In-person, Fort Collins'},
     'url': '/rental-housing/chfareach/chfareach-calendar/nspire'},
    {'title': 'October 2026 CHFA Board of Directors Meeting', 'allDay': True,
     'start': '2026-10-22T00:00:00', 'end': '0001-01-01T00:00:00',
     'extendedProps': {'copy': 'CHFA Board Room and Virtual '}, 'url': '/about-chfa/board/oct'},
    {'title': 'Training Webinar: CHFA Lender Basic Training', 'allDay': False,
     'start': '2026-10-21T11:00:00', 'end': '2026-10-21T13:00:00',
     'extendedProps': {'copy': 'Online'}, 'url': 'https://events.localhost/x'},
    {'title': 'Training Webinar: Fair Housing 101', 'allDay': False,
     'start': '2022-03-03T10:00:00', 'end': '2022-03-03T11:00:00',
     'extendedProps': {'copy': 'Online'}, 'url': '/old'},
    {'title': 'chfareach: HOTMA for Tax Credit Properties, Online Workshop', 'allDay': False,
     'start': '2026-10-13T08:55:00', 'end': '2026-10-15T14:00:00',
     'extendedProps': {'copy': 'Online'}, 'url': '/hotma'},
]}

HC_PAGE = '''<h2>Upcoming Events</h2><div class="remembers-events">
<article class="remembers-event"><div class="event-info"><h3>Spooky Bingo</h3>
<p class="remembers-event-date">
    October 29, 2026</p></div>
<div class="link"><a class="elementor-icon" href="https://members.housingcolorado.org/event-details?id=abc&amp;x=1">go</a></div>
</article></div>'''


def test_chfa_events_are_normalized():
    ev = {e['title']: e for e in fhe.parse_chfa(CHFA)}
    nspire = ev['chfareach: CHFA NSPIRE Inspections, Fort Collins']
    assert nspire['start'] == '2026-10-22' and nspire['end'] is None and nspire['time'] == '13:00'
    assert nspire['url'] == fhe.CHFA_BASE + '/rental-housing/chfareach/chfareach-calendar/nspire'
    assert nspire['location'] == 'In-person, Fort Collins' and nspire['online'] is False
    assert nspire['category'] == 'compliance'
    board = ev['October 2026 CHFA Board of Directors Meeting']
    assert board['end'] is None, 'CHFA writes 0001-01-01 for "no end"; it is not a date'
    assert board['time'] is None and board['category'] == 'board'
    assert ev['Training Webinar: CHFA Lender Basic Training']['category'] == 'homebuyer'
    assert ev['Training Webinar: CHFA Lender Basic Training']['online'] is True


def test_housing_colorado_list_is_parsed():
    [e] = fhe.parse_housing_colorado(HC_PAGE)
    assert e['title'] == 'Spooky Bingo' and e['start'] == '2026-10-29'
    assert e['url'] == 'https://members.housingcolorado.org/event-details?id=abc&x=1'
    assert e['organizer'] == 'Housing Colorado' and e['category'] == 'networking'


def test_an_unrecognized_page_is_an_error_not_an_empty_calendar():
    with pytest.raises(ValueError):
        fhe.parse_housing_colorado('<html><title>Just a moment...</title></html>')
    with pytest.raises(ValueError):
        fhe.parse_chfa({'error': 'maintenance'})
    assert fhe.parse_housing_colorado('<div class="remembers-events"></div>') == []
    doc = fhe.build(TODAY, fetch=lambda url: b'<html>challenge</html>')
    assert {s['id']: s['status'] for s in doc['sources']}['housing_colorado'] == 'unreachable'
    assert {s['id']: s['status'] for s in doc['sources']}['chfa'] == 'unreachable'


def test_past_events_drop_and_a_running_one_stays():
    events = fhe.upcoming(fhe.parse_chfa(CHFA), TODAY)
    shown = [e['title'] for e in events]
    assert 'Training Webinar: Fair Housing 101' not in shown
    assert 'chfareach: HOTMA for Tax Credit Properties, Online Workshop' in shown, \
        'an event that started yesterday and ends tomorrow is still on'
    starts = [e['start'] for e in events]
    assert starts == sorted(starts)


def test_an_unreachable_source_contributes_nothing_and_says_so():
    def fetch(url):
        if 'chfainfo' in url:
            raise OSError('HTTP Error 403: Forbidden')
        return HC_PAGE.encode()
    doc = fhe.build(TODAY, fetch=fetch)
    by_id = {s['id']: s for s in doc['sources']}
    assert by_id['chfa']['status'] == 'unreachable' and '403' in by_id['chfa']['note']
    assert by_id['chfa']['upcoming'] == 0
    assert not any(e['source'] == 'chfa' for e in doc['events'])
    assert by_id['housing_colorado']['status'] == 'ok' and by_id['housing_colorado']['upcoming'] == 1


def test_both_sources_feed_the_list():
    def fetch(url):
        return json.dumps(CHFA).encode() if 'chfainfo' in url else HC_PAGE.encode()
    doc = fhe.build(TODAY, fetch=fetch)
    organizers = {e['organizer'] for e in doc['events']}
    assert {'CHFA', 'Housing Colorado'} <= organizers
    assert all(e['category'] in fhe.CATEGORIES for e in doc['events'])
    assert doc['meta']['categories'] == fhe.CATEGORIES


def test_every_curated_event_names_its_source_check_and_quote():
    doc = json.loads(fhe.CURATED_FILE.read_text())
    assert doc['events'], 'the curated list is empty; nothing to check'
    for e in doc['events']:
        c = e.get('checked') or {}
        assert c.get('date') and c.get('quote') and c.get('source_url', '').startswith('https:'), e['title']
        assert e['category'] in fhe.CATEGORIES
    fhe.load_curated()  # raises on a missing source


def test_a_curated_event_without_a_source_is_refused(tmp_path):
    bad = tmp_path / 'c.json'
    bad.write_text(json.dumps({'events': [{'title': 'X', 'start': '2026-11-01', 'organizer': 'Y',
                                          'url': 'https://e.localhost', 'category': 'conference',
                                          'checked': {'date': '2026-10-14'}}]}))
    with pytest.raises(ValueError, match='no source'):
        fhe.load_curated(bad)


def test_the_committed_file_holds_no_past_event():
    doc = json.loads(fhe.OUT_FILE.read_text())
    as_of = doc['meta']['as_of']
    assert doc['events'], 'the committed events file is empty'
    assert all((e.get('end') or e['start']) >= as_of for e in doc['events'])


def test_ended_events_are_kept_in_past_newest_first():
    previous = {'events': [
        {'title': 'Spooky Bingo', 'start': '2026-10-10', 'end': None, 'organizer': 'Housing Colorado',
         'source': 'housing_colorado', 'category': 'networking', 'url': 'https://hc.localhost/b'},
        {'title': 'Still ahead', 'start': '2026-10-30', 'end': None, 'organizer': 'CHFA',
         'source': 'chfa', 'category': 'board', 'url': 'https://chfa.localhost/s'},
    ], 'past': [
        {'title': 'Long ago', 'start': '2025-01-05', 'end': None, 'organizer': 'CHFA',
         'source': 'chfa', 'category': 'board', 'url': 'https://chfa.localhost/l'},
    ]}
    ended = fhe.past(fhe.parse_chfa(CHFA), previous, TODAY)
    titles = [e['title'] for e in ended]
    assert 'Spooky Bingo' in titles, "yesterday's upcoming event that has ended carries forward"
    assert 'Still ahead' not in titles
    assert 'Long ago' not in titles and 'Training Webinar: Fair Housing 101' not in titles, 'older than a year'
    assert 'chfareach: HOTMA for Tax Credit Properties, Online Workshop' not in titles, 'still running'
    ends = [e.get('end') or e['start'] for e in ended]
    assert ends == sorted(ends, reverse=True)


def test_build_writes_past_events_and_keeps_upcoming_current():
    def fetch(url):
        return json.dumps(CHFA).encode() if 'chfainfo' in url else HC_PAGE.encode()
    prev = {'events': [{'title': 'Ended last week', 'start': '2026-10-07', 'end': None, 'organizer': 'CHFA',
                        'source': 'chfa', 'category': 'board', 'url': 'https://chfa.localhost/e'}]}
    doc = fhe.build(TODAY, fetch=fetch, previous=prev)
    assert [e['title'] for e in doc['past']] == ['Ended last week']
    assert all((e.get('end') or e['start']) >= TODAY.isoformat() for e in doc['events'])
    assert all((e.get('end') or e['start']) < TODAY.isoformat() for e in doc['past'])
