"""Agency releases and the day's summary — scripts/news/agency_releases.py.

paul, 2026-11-17: the daily news missed CHFA's 2026 Round Two awards because no
outlet had covered them. These tests pin the rules: agency pages are read
directly, a refused page is recorded and never fatal, nothing on a page read for
the first time is called new, meeting notices are left out, and the summary is
built from the data alone.
"""

import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts' / 'news'))
sys.path.insert(0, str(ROOT / 'scripts'))

import agency_releases as ar  # noqa: E402

CHFA_NEWS = '''
<h3><a href="/chfa-news/11162026-2026-round-two-htc-awards">CHFA Announces 2026 Round Two Housing Tax Credit Awards</a></h3>
<p class="x">teaser</p><span class="listing__date">November 16, 2026</span>
<h3><a href="/getContentAsset/a/b/November-Board.pdf?language=en-US">November 2026 CHFA Board of Directors Meeting (PDF)</a></h3>
<span class="listing__date">November 19, 2026</span>
<h3><a href="/chfa-news/10272026-golden">Financing Supports Construction of 40 Affordable Homes in Golden</a></h3>
<span class="listing__date">October 27, 2026</span>
'''
AWARDS = '<a href="/getContentAsset/x/y/2026-Round-Two-HTC-Award-Report.pdf?language=en-US">Award report</a>'
# The DOLA links below are made-up fixtures resolved against DOLA's site, so they are built from the site address
# (a full made-up URL here would fail the CI source-URL sweep as a dead link).
DOLA_SITE = 'https://cdola.colorado.gov'
DOLA = '<a href="/press-release/dola-releases-hna"><span>DOLA Releases Statewide Housing Needs Assessment</span></a>' \
       '<a href="/press-release/wildfire-grants"><span>DOLA Announces Wildfire Mitigation Grants</span></a>'


def fetcher(pages):
    def f(url):
        for key, page in pages.items():
            if key in url:
                if isinstance(page, Exception):
                    raise page
                return page
        raise OSError('HTTP Error 403: Forbidden')
    return f


PAGES = {'chfa-news': CHFA_NEWS, 'housing-credit/awards': AWARDS, 'cdola': DOLA}


def test_dated_release_is_kept_and_meetings_and_future_dates_are_not():
    block = ar.collect(None, '2026-11-16', fetcher(PAGES))
    titles = [i['title'] for i in block['items']]
    assert 'CHFA Announces 2026 Round Two Housing Tax Credit Awards' in titles
    assert not any('Meeting' in t for t in titles)
    r2 = next(i for i in block['items'] if 'Round Two' in i['title'])
    assert r2['date'] == '2026-11-16' and r2['date_basis'] == 'posted'
    assert r2['link'] == 'https://www.chfainfo.com/chfa-news/11162026-2026-round-two-htc-awards'


def test_a_refused_page_is_recorded_not_fatal():
    block = ar.collect(None, '2026-11-16', fetcher(PAGES))
    status = {s['id']: s['status'] for s in block['sources']}
    assert status['chfa-news'] == 'ok'
    assert status['oedit'].startswith(('OSError', 'HTTPError')) and status['governor'] != 'ok'
    assert 'oedit' not in block['sources_read']


def test_first_read_is_not_new_and_later_items_get_their_first_seen_date():
    first = ar.collect(None, '2026-11-16', fetcher(PAGES))
    assert not any(i['agency'] == 'DOLA' for i in first['items']), 'undated items on a first read are not new'
    assert first['first_seen'][DOLA_SITE + '/press-release/dola-releases-hna'] == 'before'
    assert DOLA_SITE + '/press-release/wildfire-grants' not in first['first_seen'], 'not housing'
    pages = dict(PAGES, cdola=DOLA + '<a href="/press-release/prop-123"><span>Prop 123 Affordable Housing Milestone</span></a>',
                 **{'housing-credit/awards': AWARDS + '<a href="/getContentAsset/x/y/2027-Round-One-HTC-Applicant-Report.pdf">a</a>'})
    second = ar.collect(json.loads(json.dumps(first)), '2026-11-17', fetcher(pages))
    new = {i['title']: i for i in second['items'] if i['date_basis'] == 'first_seen'}
    assert new['Prop 123 Affordable Housing Milestone']['date'] == '2026-11-17'
    assert any('Applicant Report' in t for t in new)
    assert 'DOLA Releases Statewide Housing Needs Assessment' not in new


def test_summary_puts_agency_first_and_counts_only_new_stories():
    block = ar.collect(None, '2026-11-16', fetcher(PAGES))
    stories = [
        {'title': 'Rents fall in Denver', 'source': 'Denver Post', 'sourcing': 'checked', 'date': '2026-11-16', 'scope': 'colorado',
         'also': [{'link': 'x'}, {'link': 'y'}], 'places': [{'name': 'Denver', 'type': 'county'}], 'link': 'https://example.com/a'},
        {'title': 'Old story', 'source': 'Sun', 'date': '2026-11-10', 'scope': 'colorado', 'also': [], 'places': []},
        {'title': 'National rates', 'source': 'WSJ', 'date': '2026-11-16', 'scope': 'national', 'also': [], 'places': []},
    ]
    now = dt.datetime(2026, 11, 17, 3, 30, tzinfo=dt.timezone.utc)  # 8:30 pm Monday in Denver
    t = ar.summarize_today(stories, block, now)
    assert t['date'] == '2026-11-16' and t['since'] == '2026-11-15'
    assert t['counts'] == {'stories': 1, 'agency': 1}
    assert t['lines'][0].startswith('CHFA: CHFA Announces 2026 Round Two')
    assert t['lines'][1] == '1 new Colorado housing story since Sunday, November 15.'
    assert t['lines'][2] == 'Rents fall in Denver (Denver Post, and 2 more outlets).'
    assert t['top'][0]['outlets'] == 3
    assert t['places'] == [{'name': 'Denver', 'stories': 1}]
    assert 'no AI' in t['method']


def test_quiet_day_says_so():
    t = ar.summarize_today([{'title': 'Old', 'date': '2026-11-01', 'scope': 'colorado'}], {'items': []},
                           dt.datetime(2026, 11, 17, 3, 0, tzinfo=dt.timezone.utc))
    assert t['lines'] == ['No new Colorado housing stories or agency releases since yesterday. The latest story is from 2026-11-01.']


def test_the_published_file_carries_the_blocks():
    d = json.loads((ROOT / 'data' / 'policy_briefs.json').read_text())
    assert {'lines', 'counts', 'top', 'agency', 'method'} <= set(d['today'])
    assert {s['id'] for s in d['agency']['sources']} == {s['id'] for s in ar.SOURCES}
    links = {s['link'] for s in d['stories']}
    for it in d['today']['agency']:
        assert it['link'] in links, 'an agency release in the summary is also in the list'


def test_a_future_dated_story_is_not_new_today():
    t = ar.summarize_today([{'title': 'Tomorrow', 'source': 'X', 'date': '2026-11-18', 'scope': 'colorado', 'also': []}],
                           {'items': [{'agency': 'DOLA', 'title': 'Later', 'link': 'l', 'date': '2026-11-18', 'date_basis': 'first_seen'}]},
                           dt.datetime(2026, 11, 17, 3, 0, tzinfo=dt.timezone.utc))
    assert t['counts'] == {'stories': 0, 'agency': 0}


def test_a_failed_source_keeps_its_last_items():
    first = ar.collect(None, '2026-11-16', fetcher(PAGES))
    pages = {k: v for k, v in PAGES.items() if k != 'chfa-news'}
    second = ar.collect(json.loads(json.dumps(first)), '2026-11-17', fetcher(pages))
    assert any('Round Two' in i['title'] for i in second['items'])
    assert next(s for s in second['sources'] if s['id'] == 'chfa-news')['status'] != 'ok'


def test_a_release_already_carried_as_other_coverage_is_not_added_again():
    import generate_policy_briefs as gpb
    import os
    link = 'https://www.chfainfo.com/chfa-news/11162026-2026-round-two-htc-awards'
    stories = [{'title': 'State awards tax credits for 845 homes', 'source': 'Denver Post', 'date': '2026-11-16', 'scope': 'colorado',
                'link': 'https://example.com/a', 'also': [{'source': 'CHFA', 'link': link}], 'places': [], 'regions': [], 'programs': []}]
    prior = {'items': [{'agency': 'CHFA', 'source': 'CHFA newsroom', 'title': 'CHFA Announces 2026 Round Two Housing Tax Credit Awards',
                        'link': link, 'date': '2026-11-16', 'date_basis': 'posted', 'kind': 'release'}]}
    os.environ['NEWS_AGENCY_OFFLINE'] = '1'
    try:
        out, _, _ = gpb.with_agency_releases(stories, gpb.load_geographies(), prior)
    finally:
        del os.environ['NEWS_AGENCY_OFFLINE']
    assert len(out) == 1


def test_today_top_needs_a_housing_headline_and_counts_one_story_once():
    now = dt.datetime(2026, 11, 17, 6, tzinfo=dt.timezone.utc)
    stories = [
        {'title': '34% of Colorado households are cost-burdened, new state housing study finds', 'source': 'A', 'date': '2026-11-16', 'also': [{}, {}]},
        {'title': 'Court weighs lawsuit over Colorado’s transgender pronouns law', 'source': 'B', 'date': '2026-11-16'},
        {'title': 'Nearly 34% of Colorado households are spending too much on housing, new state report finds', 'source': 'C', 'date': '2026-11-16'},
        {'title': 'Denver approves 200 affordable rental homes', 'source': 'D', 'date': '2026-11-16'},
    ]
    t = ar.summarize_today(stories, {'items': []}, now, about=lambda title: 'hous' in title.lower() or 'rental' in title.lower())
    assert [x['source'] for x in t['top']] == ['A', 'D']
    assert t['top'][0]['outlets'] == 4


def test_same_story_keeps_distinct_projects_apart():
    assert not ar.same_story('Denver approves 200 affordable rental homes', 'Boulder approves 100 affordable rental homes')
    assert not ar.same_story('Denver approves affordable rental homes', 'Boulder approves affordable rental homes')
    assert ar.same_story('Denver housing complex receives mail again after USPS stopped delivering',
                         'Mail delivery resumes months later for residents of Denver housing complex')


def test_a_story_told_under_many_headlines_ranks_by_its_total_coverage():
    now = dt.datetime(2026, 11, 17, 6, tzinfo=dt.timezone.utc)
    hdr = lambda src, title, n=0: {'title': title, 'source': src, 'date': '2026-11-16', 'also': [{}] * n}
    stories = [hdr('A', 'Aurora rent cap housing vote set', 1), hdr('B', 'Pueblo opens housing shelter', 1),
               hdr('C', 'Greeley housing land deal closes', 1), hdr('D', 'Mesa County housing levy fails', 1),
               hdr('E', '34% of households cost-burdened, housing study finds'),
               hdr('F', 'Nearly 34% of households spend too much on housing, study finds'),
               hdr('G', 'Housing study: 34% of households cost-burdened')]
    t = ar.summarize_today(stories, {'items': []}, now, about=lambda title: 'housing' in title.lower())
    assert t['top'][0]['source'] == 'E' and t['top'][0]['outlets'] == 3
