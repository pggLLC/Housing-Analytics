"""The Today box quotes each story's own summary — scripts/news/story_summaries.py.

paul, 2026-11-17: "summaries should summarize the content of the news articles
not just present the links". These tests pin the rules: the summary is the
outlet's or agency's own words (never rewritten), robots.txt is honoured, a
story that cannot be found keeps its headline only, and results are cached.
All links are example.com fixtures.
"""

import sys
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'scripts' / 'news'))

import story_summaries as ss  # noqa: E402

TITLE = 'Colorado home sales fell 19% in October, median prices were flat'
SEARCH = f'''<rss><channel><item><title>Something else entirely about parks</title><link>https://example.com/parks</link></item>
<item><title>{TITLE}</title><link>https://example.com/2026/11/16/home-sales/</link>
<description><![CDATA[<figure><figcaption>A photo caption</figcaption></figure><p>Feed text.</p>]]></description></item></channel></rss>'''
ARTICLE = '<head><meta property="og:description" content="Realtors say sellers don&#8217;t want to lower prices, which are unaffordable for many. Some wonder if a correction is coming."></head>'
RELEASE = '<main><p>Short.</p><p>The agency is pleased to announce nine developments will be awarded a reservation of Housing Tax Credits to support 845 rental units.</p></main>'


def fake(pages, calls=None):
    def f(url):
        if calls is not None:
            calls.append(url)
        for key, page in pages.items():
            if key in url:
                if isinstance(page, Exception):
                    raise page
                return page
        raise urllib.error.HTTPError(url, 404, 'nf', {}, None)
    return f


def setup_function():
    ss._robots.clear()
    ss._unsure.clear()


def test_outlet_story_quotes_the_articles_own_description():
    f = fake({'robots.txt': 'User-agent: *\nAllow: /', '?s=': SEARCH, 'home-sales': ARTICLE})
    out = ss.summarize({'title': TITLE, 'source_domain': 'example.com'}, f)
    assert out['basis'] == 'outlet'
    assert out['link'] == 'https://example.com/2026/11/16/home-sales/'
    assert out['text'].startswith('Realtors say sellers don’t want to lower prices')


def test_feed_description_is_the_fallback_without_the_caption():
    f = fake({'robots.txt': '', '?s=': SEARCH, 'home-sales': '<p>tiny</p>'})
    out = ss.summarize({'title': TITLE, 'source_domain': 'example.com'}, f)
    assert out['text'] == 'Feed text.'


def test_robots_disallow_is_honoured():
    calls = []
    f = fake({'robots.txt': 'User-agent: *\nDisallow: /', '?s=': SEARCH}, calls)
    out = ss.summarize({'title': TITLE, 'source_domain': 'example.com'}, f)
    assert out['basis'] == 'not found' and out['text'] == ''
    assert all('robots.txt' in c for c in calls)


def test_unreachable_robots_means_no_reading():
    calls = []
    f = fake({'robots.txt': OSError('down'), '?s=': SEARCH}, calls)
    try:
        ss.summarize({'title': TITLE, 'source_domain': 'example.com'}, f)
        raise AssertionError('expected Transient')
    except ss.Transient:
        pass
    assert not any('?s=' in u for u in calls)


def test_agency_release_uses_its_first_real_paragraph():
    f = fake({'robots.txt': '', 'release-1': RELEASE})
    out = ss.summarize({'title': 'Awards', 'link': 'https://example.com/release-1', 'agency': True}, f)
    assert out['basis'] == 'release' and out['text'].startswith('The agency is pleased to announce nine')


def test_long_text_is_cut_at_a_sentence():
    s = ('One sentence that is fairly long. ' * 20).strip()
    t = ss.trim(s, 100)
    assert len(t) <= 100 and t.endswith('.')


def test_cache_is_used_and_lines_quote_the_summary():
    today = {'agency': [], 'top': [{'title': TITLE, 'link': 'https://example.com/g', 'source': 'Example News'}]}
    cache = {'https://example.com/g': {'text': 'Cached words.', 'link': 'https://example.com/a', 'basis': 'outlet'}}
    calls = []
    today, keep = ss.with_summaries(today, cache, fake({}, calls))
    assert calls == []
    assert today['top'][0]['summary']['text'] == 'Cached words.'
    assert today['summary_lines'] == [f'Example News: {TITLE}. “Cached words.”']
    assert 'no AI' in today['method'] and keep == cache


def _today():
    return {'agency': [], 'top': [
        {'title': TITLE, 'link': 'https://example.com/a', 'source': 'Example News',
         'summary': {'text': 'Realtors say sellers won’t cut prices; 19% fewer homes sold.', 'link': '', 'basis': 'outlet'}},
        {'title': 'Headline only', 'link': 'https://example.com/b', 'source': 'Example TV',
         'summary': {'text': '', 'link': '', 'basis': 'not found'}}]}


def test_ai_writes_one_labelled_sentence_per_story_with_its_own_text():
    seen = []
    ask = lambda prompt, key: seen.append(prompt) or '{"items": [{"n": 0, "sentence": "Home sales fell 19% as sellers held prices."}]}'
    cache = {}
    t = ss.with_ai(_today(), cache, 'k', ask)
    assert t['top'][0]['ai'] == 'Home sales fell 19% as sellers held prices.'
    assert 'ai' not in t['top'][1]                      # no own summary, no AI sentence
    assert 'Headline only' not in seen[0]
    assert t['ai'] == {'model': ss.AI_MODEL, 'count': 1} and 'AI' in t['method']
    # cached: the second run asks nothing
    t2 = ss.with_ai(_today(), cache, 'k', lambda p, k: (_ for _ in ()).throw(AssertionError('asked again')))
    assert t2['top'][0]['ai'].startswith('Home sales fell')


def test_ai_sentence_with_a_new_number_is_dropped():
    ask = lambda p, k: '{"items": [{"n": 0, "sentence": "Sales fell 25% statewide."}]}'
    t = ss.with_ai(_today(), {}, 'k', ask)
    assert 'ai' not in t['top'][0] and t['ai']['count'] == 0


def test_no_key_or_ai_failure_keeps_the_quotes():
    assert ss.with_ai(_today(), {}, '')['ai']['count'] == 0
    boom = lambda p, k: (_ for _ in ()).throw(OSError('down'))
    assert ss.with_ai(_today(), {}, 'k', boom)['ai']['count'] == 0


def test_description_with_an_apostrophe_is_read_whole():
    page = '<head><meta property="og:description" content="The project adds 80 rental homes to Colorado\'s housing supply."></head>'
    assert ss.page_description(page) == "The project adds 80 rental homes to Colorado's housing supply."


def test_numbers_ignore_sentence_punctuation():
    assert ss._numbers('rental units to 845.') == ss._numbers('The awards support 845 rental units.') == {'845'}
    assert ss._numbers('1,200 homes at 4.5%.') == {'1200', '4.5'}


def test_ai_framing_is_dropped_and_the_quote_shows():
    src = 'Court weighs lawsuit over a state law A judge heard arguments Monday in a lawsuit brought by two businesses.'
    assert not ss.grounded('A court is weighing a lawsuit from businesses, which could affect civil rights protections.', src)
    assert not ss.grounded('Nine homes were funded, which is important for renters.', 'Nine homes were funded.')
    assert ss.grounded('A judge heard arguments in a lawsuit brought by two businesses.', src)
    ask = lambda p, k: '{"items": [{"n": 0, "sentence": "Sales fell 19%, which is important for buyers."}]}'
    t = ss.with_ai(_today(), {}, 'k', ask)
    assert 'ai' not in t['top'][0] and t['ai']['count'] == 0


def test_cached_line_that_fails_the_check_is_not_shown():
    item = _today()
    key = 'https://example.com/a'
    cache = {key: {'ai': {'text': 'Sales fell 19%, which could hurt buyers.', 'from': item['top'][0]['summary']['text']}}}
    t = ss.with_ai(item, cache, '', None)
    assert 'ai' not in t['top'][0]


def test_one_framing_word_in_the_source_does_not_allow_others():
    assert not ss.grounded('Nine homes were funded, which is important for renters.', 'The agency will help fund nine homes.')
    assert ss.grounded('The agency will help fund nine homes.', 'The agency will help fund nine homes for renters.')


def test_every_recent_story_gets_its_summary_within_the_lookup_budget(monkeypatch):
    monkeypatch.setattr(ss, 'LOOKUPS_PER_RUN', 2)
    stories = [{'title': TITLE, 'link': f'https://example.com/g{i}', 'source_domain': 'example.com', 'date': f'2026-11-1{i}',
                'source': 'One outlet'}
               for i in range(5)] + [{'title': 'Old story', 'link': 'https://example.com/old', 'date': '2026-10-01'}]
    f = fake({'robots.txt': '', '?s=': SEARCH, 'home-sales': ARTICLE})
    ask = lambda p, k: '{"items": [' + ','.join('{"n": %d, "sentence": "Realtors say sellers will not lower prices."}' % i for i in range(5)) + ']}'
    cache = {}
    keep = ss.with_story_summaries(stories, cache, 'k', '2026-11-18', '2026-11-04', fetcher=f, ask=ask)
    done = [s for s in stories if s.get('summary')]
    assert sorted(s['date'] for s in done) == ['2026-11-13', '2026-11-14']          # newest first, two lookups
    assert all(s['ai'] == 'Realtors say sellers will not lower prices.' for s in done)
    assert 'summary' not in stories[-1] and len(keep) == 2
    # the next run reads two more, and reuses the cached ones without asking again
    ss.with_story_summaries(stories, cache, 'k', '2026-11-18', '2026-11-04', fetcher=f, ask=ask)
    assert sum(1 for s in stories if s.get('ai')) == 4


def test_a_story_not_found_is_tried_again_only_the_next_day():
    calls = []
    f = fake({'robots.txt': 'User-agent: *\nDisallow: /'}, calls)
    items = [{'title': TITLE, 'link': 'https://example.com/x', 'source_domain': 'example.com'}]
    cache = {}
    ss.summarize_items(items, cache, f, today='2026-11-18')
    n = len(calls)
    ss.summarize_items([dict(items[0])], cache, f, today='2026-11-18')
    assert len(calls) == n and cache['https://example.com/x']['checked'] == '2026-11-18'
    ss._robots.clear()
    ss.summarize_items([dict(items[0])], cache, f, today='2026-11-19')
    assert len(calls) > n


def test_stories_never_tried_come_before_daily_retries():
    f = fake({'robots.txt': '', '?s=': SEARCH, 'home-sales': ARTICLE})
    failed = [{'title': f'Unreadable {i}', 'link': f'https://example.com/u{i}'} for i in range(3)]
    cache = {x['link']: {'text': '', 'link': '', 'basis': 'not found', 'checked': '2026-11-17', 'sure': True} for x in failed}
    new = {'title': TITLE, 'link': 'https://example.com/new', 'source_domain': 'example.com'}
    ss.summarize_items(failed + [new], cache, f, today='2026-11-18', budget=[1])
    assert new['summary']['basis'] == 'outlet'


def rate_limited(url):
    return urllib.error.HTTPError(url, 429, 'Too Many Requests', {}, None)


def test_a_rate_limited_search_is_not_recorded_as_not_found():
    # 18 Nov 2026: the newest stories came back "not found" on rate limits and then waited a day
    f = fake({'robots.txt': '', '?s=': rate_limited('s'), '/search/': rate_limited('b')})
    items = [{'title': TITLE, 'link': 'https://example.com/x', 'source_domain': 'example.com'}]
    cache = {}
    ss.summarize_items(items, cache, f, today='2026-11-18')
    assert 'https://example.com/x' not in cache and 'summary' not in items[0]
    f = fake({'robots.txt': '', '?s=': SEARCH, 'home-sales': ARTICLE})
    ss.summarize_items([dict(items[0])], cache, f, today='2026-11-18')
    assert cache['https://example.com/x']['basis'] == 'outlet'


def test_an_unreadable_robots_file_is_not_a_miss_either():
    f = fake({'robots.txt': rate_limited('r')})
    items = [{'title': TITLE, 'link': 'https://example.com/x', 'source_domain': 'example.com'}]
    cache = {}
    ss.summarize_items(items, cache, f, today='2026-11-18')
    assert cache == {}


def test_a_clean_miss_is_marked_sure_and_older_misses_get_one_more_try_today():
    f = fake({'robots.txt': ''})
    items = [{'title': TITLE, 'link': 'https://example.com/x', 'source_domain': 'example.com'}]
    cache = {'https://example.com/x': {'text': '', 'link': '', 'basis': 'not found', 'checked': '2026-11-18'}}
    calls = []
    ss.summarize_items(items, cache, fake({'robots.txt': ''}, calls), today='2026-11-18')
    assert calls and cache['https://example.com/x'].get('sure') is True
    calls.clear()
    ss.summarize_items([dict(items[0])], cache, fake({'robots.txt': ''}, calls), today='2026-11-18')
    assert calls == []


def test_a_zero_width_space_in_a_headline_is_left_out_of_the_search():
    calls = []
    f = fake({'robots.txt': ''}, calls)
    ss.find_article('Housing\u200b study finds', 'example.com', f)
    assert all('%E2%80%8B' not in u for u in calls)


def test_a_story_its_outlet_would_not_serve_borrows_the_same_story_from_another_outlet():
    read = {'title': '34% of Colorado households are cost-burdened, new state housing study finds',
            'source': 'Grand Junction Daily Sentinel', 'link': 'https://example.com/a',
            'summary': {'text': 'A new state study finds 34% of households spend over 30% of income on housing.',
                        'link': 'https://example.com/a-article', 'basis': 'outlet'}, 'ai': 'A state study found 34% of households are cost-burdened.'}
    blocked = {'title': 'Nearly 34% of Colorado households are spending too much on housing, new state study says',
               'source': 'CBS Colorado', 'link': 'https://example.com/b',
               'summary': {'text': '', 'link': '', 'basis': 'not found'}}
    other = {'title': 'Aspen breaks ground on employee housing project', 'source': 'Aspen Times',
             'link': 'https://example.com/c', 'summary': {'text': '', 'link': '', 'basis': 'not found'}}
    assert ss.borrow([read, blocked, other], [read, blocked, other]) == 1
    assert blocked['summary']['basis'] == 'same story' and blocked['summary']['via'] == 'Grand Junction Daily Sentinel'
    assert blocked['summary']['link'] == '' and blocked['ai'] == read['ai']
    assert other['summary']['text'] == ''


def test_a_borrowed_line_is_never_lent_on():
    a = {'title': 'Denver council passes rent rule for older buildings', 'source': 'Denverite',
         'summary': {'text': 'Borrowed text.', 'basis': 'same story', 'via': 'X'}}
    b = {'title': 'Denver council passes rent rule for older buildings, landlords react', 'source': 'Denver Post',
         'summary': {'text': '', 'basis': 'not found'}}
    assert ss.borrow([b], [a, b]) == 0
