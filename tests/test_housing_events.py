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


# ── Sources added 2026-10-26: DOLA and APA Colorado calendars, FOMC, ACS, FRED ──

ICS = '\r\n'.join([
    'BEGIN:VCALENDAR', 'X-WR-CALNAME:Division of Housing Public Calendar',
    'BEGIN:VEVENT', 'DTSTART;TZID=America/Denver:20250708T130000', 'DTEND;TZID=America/Denver:20250708T150000',
    'RRULE:FREQ=MONTHLY;UNTIL=20270609T055959Z;BYDAY=2TU', 'EXDATE;TZID=America/Denver:20261110T130000',
    'SUMMARY:State Housing Board Meeting', 'LOCATION:', 'DESCRIPTION:Join: https://meet.localhost/abc-defg-hij',
    'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261104', 'DTEND;VALUE=DATE:20261107',
    'SUMMARY:Colorado Emergency Rental Assistance Pre-Application Period (November)',
    'DESCRIPTION:Details at https://doh.localhost/emergency-rental-assistance.', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART:20261026T150000Z', 'DTEND:20261026T160000Z',
    'RRULE:FREQ=DAILY;UNTIL=20261031T055959Z', 'SUMMARY:Proposition 123 Office Hours', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261102',
    'SUMMARY:Proposition 123 Commitment Filing Deadline', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART:20261120T170000Z', 'DTEND:20261120T180000Z', 'STATUS:CANCELLED',
    'SUMMARY:Cancelled housing webinar', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART:20261028T150000Z', 'SUMMARY:Saving Historic and Vintage Signs', 'END:VEVENT',
    'END:VCALENDAR', ''])


def test_ics_rows_expand_monthly_repeats_and_skip_office_hours():
    rows = fhe.parse_ics(ICS, 'Colorado Division of Housing', 'doh', fhe.DOLA_CALENDAR_PAGE, date(2026, 10, 26))
    board = [r['start'] for r in rows if r['title'] == 'State Housing Board Meeting' and r['start'] >= '2026-10-26']
    # Second Tuesdays, without the excluded 10 Nov, within the 120-day horizon.
    assert board == ['2026-12-08', '2027-01-12', '2027-02-09']
    assert all(r['time'] == '13:00' for r in rows if r['title'] == 'State Housing Board Meeting')
    assert not any('Office Hours' in r['title'] for r in rows), 'daily office hours are left out'
    assert not any('Cancelled' in r['title'] for r in rows)
    era = next(r for r in rows if r['title'].startswith('Colorado Emergency Rental'))
    assert (era['start'], era['end']) == ('2026-11-04', '2026-11-06'), 'an all-day end date is exclusive'
    assert era['url'] == 'https://doh.localhost/emergency-rental-assistance' and era['category'] == 'deadline'
    sb = next(r for r in rows if r['title'] == 'State Housing Board Meeting')
    assert sb['url'] == fhe.DOLA_CALENDAR_PAGE, 'a call-in link is not a page about the meeting'
    assert sb['category'] == 'board'
    dl = next(r for r in rows if 'Filing Deadline' in r['title'])
    assert dl['category'] == 'deadline' and dl['end'] is None


def test_utc_times_are_shown_in_mountain_time():
    one = '\r\n'.join(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART:20261119T160000Z', 'SUMMARY:Housing Strategies Peer Exchange',
                       'END:VEVENT', 'BEGIN:VEVENT', 'DTSTART:20261015T160000Z', 'SUMMARY:Housing Strategies Peer Exchange',
                       'END:VEVENT', 'END:VCALENDAR'])
    rows = fhe.parse_ics(one, 'APA Colorado', 'apa_colorado', fhe.APA_CO_PAGE, date(2026, 10, 1))
    assert {r['start']: r['time'] for r in rows} == {'2026-11-19': '09:00', '2026-10-15': '10:00'}


def test_apa_colorado_keeps_housing_items_and_the_conference_only():
    rows = fhe.parse_ics(ICS, 'APA Colorado', 'apa_colorado', fhe.APA_CO_PAGE, date(2026, 10, 26),
                         keep=fhe.apa_colorado_keep)
    titles = {r['title'] for r in rows}
    assert 'Saving Historic and Vintage Signs' not in titles
    assert 'State Housing Board Meeting' in titles
    assert fhe.apa_colorado_keep('2026 Colorado Planning Conference: Keystone', '')


def test_a_page_that_is_not_a_calendar_is_an_error():
    with pytest.raises(ValueError):
        fhe.parse_ics('<html>blocked</html>', 'X', 'doh', 'https://e.localhost', TODAY)


FOMC_PAGE = '''<h4><a id="1">2026 FOMC Meetings</a></h4>
<div class="row fomc-meeting"><div class="fomc-meeting__month col-xs-5"><strong>October</strong></div>
<div class="fomc-meeting__date col-xs-4">27-28</div></div>
<div class="row fomc-meeting"><div class="fomc-meeting__month col-xs-5"><strong>December</strong></div>
<div class="fomc-meeting__date col-xs-4">8-9*</div></div>
<h4><a id="2">2027 FOMC Meetings</a></h4>
<div class="row fomc-meeting"><div class="fomc-meeting__month col-xs-5"><strong>Apr/May</strong></div>
<div class="fomc-meeting__date col-xs-4">30-1</div></div>'''


def test_fomc_meetings_are_read_with_the_decision_day_as_the_end():
    rows = fhe.parse_fomc(FOMC_PAGE)
    assert [(r['start'], r['end']) for r in rows] == [
        ('2026-10-27', '2026-10-28'), ('2026-12-08', '2026-12-09'), ('2027-04-30', '2027-05-01')]
    assert 'economic projections' in rows[1]['title'] and 'projections' not in rows[0]['title']
    assert all(r['category'] == 'release' and r['organizer'] == 'Federal Reserve' for r in rows)
    with pytest.raises(ValueError):
        fhe.parse_fomc('<html>Access denied</html>')


ACS_PAGE = '''<h1>2025 Data Release Schedule</h1><table><tr><td>October 29, 2026</td>
<td><sup>3</sup>1-Year Data Release:</td></tr><tr><td>TBD</td><td>5-Year Data Release:</td></tr></table>'''


def test_acs_schedule_keeps_dated_releases_and_skips_tbd():
    rows = fhe.parse_acs_schedule(ACS_PAGE, 2025, 'https://census.localhost/x')
    assert [(r['start'], r['title']) for r in rows] == [('2026-10-29', 'Census ACS 2025 1-Year estimates released')]


def test_fred_release_dates_and_the_key_never_leaks():
    calls = []

    def fetch(url):
        calls.append(url)
        if '/series/release' in url:
            return json.dumps({'releases': [{'id': 10, 'name': 'Consumer Price Index',
                                             'link': 'https://bls.localhost/cpi/'}]}).encode()
        return json.dumps({'release_dates': [{'release_id': 10, 'date': '2026-10-01'},
                                             {'release_id': 10, 'date': '2026-11-12'}]}).encode()
    rows = fhe.read_fred(fetch, TODAY, 'k123')
    cpi = [r for r in rows if r['title'].startswith('Consumer Price Index')]
    assert [r['start'] for r in cpi] == ['2026-11-12'], 'a release date already past is dropped'
    assert cpi[0]['organizer'] == 'U.S. Bureau of Labor Statistics' and cpi[0]['url'] == 'https://bls.localhost/cpi/'

    def failing(url):
        raise OSError(f'refused {url}')
    doc = fhe.build(TODAY, fetch=failing, fred_key='k123')
    fred = next(s for s in doc['sources'] if s['id'] == 'fred')
    assert fred['status'] == 'unreachable' and 'k123' not in fred['note']
    doc = fhe.build(TODAY, fetch=failing)
    assert next(s for s in doc['sources'] if s['id'] == 'fred')['status'] == 'not_fetched'


def test_every_new_source_is_named_on_the_file():
    doc = fhe.build(TODAY, offline=True)
    ids = {s['id'] for s in doc['sources']}
    assert {'doh', 'prop123', 'apa_colorado', 'fomc', 'acs', 'fred', 'curated'} <= ids
    assert {'deadline', 'release'} <= set(fhe.CATEGORIES)


def test_a_cancelled_or_moved_occurrence_replaces_the_series_date():
    cal = '\r\n'.join([
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT', 'UID:shb-1', 'DTSTART;TZID=America/Denver:20261013T130000',
        'RRULE:FREQ=MONTHLY;COUNT=4;BYDAY=2TU', 'SUMMARY:State Housing Board Meeting', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:shb-1', 'RECURRENCE-ID;TZID=America/Denver:20261110T130000', 'STATUS:CANCELLED',
        'DTSTART;TZID=America/Denver:20261110T130000', 'SUMMARY:State Housing Board Meeting', 'END:VEVENT',
        'BEGIN:VEVENT', 'UID:shb-1', 'RECURRENCE-ID;TZID=America/Denver:20261208T130000',
        'DTSTART;TZID=America/Denver:20261215T130000', 'SUMMARY:State Housing Board Meeting', 'END:VEVENT',
        'END:VCALENDAR'])
    rows = fhe.parse_ics(cal, 'Colorado Division of Housing', 'doh', fhe.DOLA_CALENDAR_PAGE, date(2026, 10, 1))
    assert sorted(r['start'] for r in rows) == ['2026-10-13', '2026-12-15', '2027-01-12']


def test_rules_with_selectors_the_reader_does_not_compute_are_skipped():
    assert fhe._expand(date(2026, 10, 13), 'FREQ=MONTHLY;BYMONTH=1,4,7,10;BYDAY=2TU', date(2027, 2, 23)) is None
    assert fhe._expand(date(2026, 10, 13), 'FREQ=MONTHLY;BYMONTHDAY=13', date(2027, 2, 23)) is None
    assert fhe._expand(date(2026, 10, 13), 'FREQ=MONTHLY;BYDAY=2TU', date(2026, 12, 31)) == [
        date(2026, 10, 13), date(2026, 11, 10), date(2026, 12, 8)]


def test_a_utc_series_keeps_its_utc_time_across_daylight_time():
    cal = '\r\n'.join(['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:x', 'DTSTART:20261013T160000Z',
                         'RRULE:FREQ=MONTHLY;COUNT=3;BYDAY=2TU', 'SUMMARY:Housing webinar', 'END:VEVENT', 'END:VCALENDAR'])
    rows = fhe.parse_ics(cal, 'APA Colorado', 'apa_colorado', fhe.APA_CO_PAGE, date(2026, 10, 1))
    assert [(r['start'], r['time']) for r in rows] == [
        ('2026-10-13', '10:00'), ('2026-11-10', '09:00'), ('2026-12-08', '09:00')]


def test_an_explicit_tzid_is_converted_to_mountain_time():
    cal = '\r\n'.join(['BEGIN:VCALENDAR',
                       'BEGIN:VEVENT', 'UID:ny', 'DTSTART;TZID=America/New_York:20261119T140000',
                       'SUMMARY:Housing webinar from New York', 'END:VEVENT',
                       'BEGIN:VEVENT', 'UID:az', 'DTSTART;TZID=America/Phoenix:20261013T100000',
                       'RRULE:FREQ=MONTHLY;COUNT=2;BYDAY=2TU', 'SUMMARY:Arizona housing series', 'END:VEVENT',
                       'BEGIN:VEVENT', 'UID:win', 'DTSTART;TZID="Mountain Standard Time":20261120T090000',
                       'SUMMARY:Housing meeting', 'END:VEVENT', 'END:VCALENDAR'])
    rows = {(r['title'], r['start']): r['time']
            for r in fhe.parse_ics(cal, 'APA Colorado', 'apa_colorado', fhe.APA_CO_PAGE, date(2026, 10, 1))}
    assert rows[('Housing webinar from New York', '2026-11-19')] == '12:00'
    # Arizona keeps standard time, so its 10:00 is 11:00 in Colorado until November, then 10:00.
    assert rows[('Arizona housing series', '2026-10-13')] == '11:00'
    assert rows[('Arizona housing series', '2026-11-10')] == '10:00'
    assert rows[('Housing meeting', '2026-11-20')] == '09:00', 'an unknown zone name is read as Mountain'
