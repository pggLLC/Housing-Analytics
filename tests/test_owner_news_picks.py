"""The owner's news picks — scripts/news/owner_news_picks.py.

paul approved (2026-10-20, walkthrough review item 5): his Google Alerts as RSS
feeds and a paste-a-link form, into a review queue. Nothing publishes on its
own: an alert waits for a tick, a pasted link is his own pick. No mailbox.
"""

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts'))
sys.path.insert(0, str(ROOT / 'scripts' / 'news'))

import generate_policy_briefs as gpb  # noqa: E402
import owner_news_picks as onp  # noqa: E402

TODAY = date(2026, 10, 20)
APPLE_PAGE = '''<html><head><title>The Immigration Crackdown Is Making It Much Harder to Build Houses</title>
<meta name="Author" content="The Wall Street Journal" />
<meta property="og:title" content="The Immigration Crackdown Is Making It Much Harder to Build Houses — The Wall Street Journal" />
<meta name="twitter:title" content="The Immigration Crackdown Is Making It Much Harder to Build Houses" />
</head><body><script>redirectToUrlAfterTimeout("https://www.wsj.com/us-news/the-immigration-crackdown-ec00f4da", 0)
redirectToUrl("https://www.wsj.com/us-news/the-immigration-crackdown-ec00f4da")</script></body></html>'''


def alert(title, link, d='2026-10-19'):
    return {'title': title, 'source': onp.domain(link), 'link': link, 'date': d, 'via': 'google-alert'}


def test_google_alert_links_are_unwrapped():
    wrapped = ('https://www.google.com/url?rct=j&sa=t&url=https://www.denverpost.com/2026/10/19/housing/'
               '&ct=ga&cd=CAEYACoU&usg=AOvVaw0')
    assert onp.unwrap(wrapped) == 'https://www.denverpost.com/2026/10/19/housing/'
    items = onp.alert_items(['feed'], parse=lambda _u: [
        {'title': 'Aurora approves <b>housing</b> plan', 'url': wrapped, 'date': '2026-10-19T10:00:00Z'}])
    assert items == [{'title': 'Aurora approves <b>housing</b> plan', 'source': 'denverpost.com',
                      'link': 'https://www.denverpost.com/2026/10/19/housing/', 'date': '2026-10-19',
                      'via': 'google-alert'}]


def test_an_apple_news_link_resolves_to_the_publisher():
    d = onp.describe('https://apple.news/AM-vmsWjPQpOHt0OYbn5v4Q', fetch=lambda _u: APPLE_PAGE)
    assert d['link'] == 'https://www.wsj.com/us-news/the-immigration-crackdown-ec00f4da'
    assert d['title'] == 'The Immigration Crackdown Is Making It Much Harder to Build Houses'
    assert d['source'] == 'The Wall Street Journal'


def test_a_blocked_page_keeps_the_typed_headline():
    def blocked(_u):
        raise OSError('403')
    ledger, done = onp.update([], [], [{'issue': 7, 'link': 'https://www.wsj.com/x', 'headline': 'Typed headline',
                                        'opened': '2026-10-20'}], set(), (set(), set()), TODAY,
                              describe_fn=lambda u: onp.describe(u, fetch=blocked))
    assert [(i['title'], i['source'], i['status'], i['issue']) for i in ledger] == \
        [('Typed headline', 'wsj.com', 'published', 7)]
    assert done == [7]


def test_only_trusted_link_issues_are_read():
    issues = [
        {'number': 1, 'title': 'News link', 'labels': [{'name': 'news-link'}], 'author_association': 'OWNER',
         'body': '### Link\n\nhttps://apple.news/AM-vmsWjPQpOHt0OYbn5v4Q\n\n### Headline\n\n_No response_',
         'created_at': '2026-10-20T15:00:00Z'},
        {'number': 2, 'title': 'News link', 'labels': [], 'author_association': 'NONE',
         'body': '### Link\n\nhttps://spam.example/', 'created_at': '2026-10-20T15:00:00Z'},
        {'number': 3, 'title': 'Bug in the map', 'labels': [], 'author_association': 'OWNER',
         'body': 'see https://cohoanalytics.com/', 'created_at': '2026-10-20T15:00:00Z'},
    ]
    assert onp.pasted_links(issues) == [{'issue': 1, 'link': 'https://apple.news/AM-vmsWjPQpOHt0OYbn5v4Q',
                                         'headline': '', 'opened': '2026-10-20'}]


def test_alerts_wait_until_ticked_and_are_not_asked_twice():
    a = alert('Aurora approves housing plan', 'https://www.denverpost.com/a/')
    dup = alert('Aurora approves housing plan', 'https://www.9news.com/a/')
    on_page = alert('Already on the page', 'https://www.cpr.org/b/')
    ledger, _ = onp.update([], [a, dup, on_page], [], set(), ({onp.norm_title('Already on the page')}, set()), TODAY)
    assert [(i['title'], i['status']) for i in ledger] == [('Aurora approves housing plan', 'waiting')]
    body = onp.review_body(ledger, 'pggLLC/Housing-Analytics')
    assert '- [ ] Publish: [Aurora approves housing plan](https://www.denverpost.com/a/)' in body
    ticked = onp.ticked_ids(body.replace('- [ ] Publish', '- [x] Publish'))
    ledger, _ = onp.update(ledger, [a], [], ticked, (set(), set()), TODAY)
    assert [(i['status'], i['reviewed']) for i in ledger] == [('published', '2026-10-20')]
    assert 'Nothing waiting right now.' in onp.review_body(ledger, 'pggLLC/Housing-Analytics')


def test_an_unticked_alert_drops_off_after_thirty_days():
    old = {'id': 'aaaaaaaaaa', 'title': 'Old', 'source': 'x.com', 'link': 'https://x.com/o', 'date': '2026-09-01',
           'via': 'google-alert', 'status': 'waiting', 'added': '2026-09-01'}
    ledger, _ = onp.update([old], [], [], set(), (set(), set()), TODAY)
    assert ledger == []


def test_published_picks_join_the_stories_once(tmp_path):
    geos = gpb.load_geographies()
    path = tmp_path / 'owner-news.json'
    path.write_text(json.dumps({'items': [
        {'title': 'The Immigration Crackdown Is Making It Much Harder to Build Houses',
         'source': 'The Wall Street Journal', 'link': 'https://www.wsj.com/x', 'date': '2026-10-16',
         'status': 'published'},
        {'title': 'Aurora approves housing plan', 'source': 'denverpost.com', 'link': 'https://d/a',
         'date': '2026-10-19', 'status': 'published'},
        {'title': 'Waiting story', 'source': 'x.com', 'link': 'https://x/w', 'date': '2026-10-19',
         'status': 'waiting'},
    ]}))
    stories, _ = gpb.build_stories([{'title': 'Aurora approves housing plan - Denver Post', 'source': 'Denver Post',
                                     'date': '2026-10-19T12:00:00Z', 'url': 'https://d/a'}], geos)
    out = gpb.with_owner_picks(stories, geos, path)
    got = {s['title']: (s['scope'], s.get('picked')) for s in out}
    assert got == {
        'Aurora approves housing plan': ('colorado', True),
        'The Immigration Crackdown Is Making It Much Harder to Build Houses': ('national', True),
    }
    assert [s['date'] for s in out] == sorted((s['date'] for s in out), reverse=True)


def test_no_picks_file_changes_nothing(tmp_path):
    stories = [{'title': 'A', 'date': '2026-10-19'}]
    assert gpb.with_owner_picks(stories, {}, tmp_path / 'missing.json') == stories


def test_the_issue_form_labels_its_issues():
    form = (ROOT / '.github' / 'ISSUE_TEMPLATE' / 'news-link.yml').read_text()
    assert 'labels: ["news-link"]' in form and 'title: "News link"' in form
