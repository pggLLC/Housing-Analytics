"""What the day's top stories say, in their own words, for the Today box.

paul, 2026-11-17: "summaries should summarize the content of the news
articles not just present the links". The box quotes each story's own
summary, so nothing on the page is reworded or written by AI:

  - an outlet story: the outlet's own description of the article (its
    og:description, the standfirst most outlets write for each article);
  - an agency release: the release's own description, or its first paragraph.

The alerts feed gives Google News links, which hide the article's address,
so an outlet story is found on the outlet's own site: its WordPress search
feed (/?s=...&feed=rss2) or its BLOX search feed (/search/?f=rss&q=...),
matched to the headline. robots.txt is honoured (RFC 9309: an unreadable
4xx robots file allows, a 5xx one does not). A story that cannot be found
keeps its headline only, and says so.

Results are cached by story link in `agency.summaries` in
data/policy_briefs.json, so each article is read once.
"""
from __future__ import annotations

import html
from html.parser import HTMLParser
import re
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser

UA = 'Mozilla/5.0 (compatible; cohoanalytics-news/1.0; +https://cohoanalytics.com)'
UA_TOKEN = 'cohoanalytics-news'
MAX_CHARS = 320
_robots: dict = {}
# Hosts whose robots.txt could not be read this run (rate limit, server error, timeout): a miss there
# is not a real "not found", so the story is tried again on the next run, not a day later.
_unsure: set = set()


class Transient(Exception):
    """The outlet could not be read this time (429, 5xx, timeout); try the story again next run."""


def _transient(e: Exception) -> bool:
    if isinstance(e, urllib.error.HTTPError):
        return e.code == 429 or e.code >= 500
    return True


_last: dict = {}
SPACING = 2.0  # seconds between two reads of one site: the Sentinel answered 429 to faster reads (18 Nov 2026)


def fetch(url: str, timeout: int = 20) -> str:
    import time
    host = urllib.parse.urlsplit(url).netloc
    wait = _last.get(host, 0) + SPACING - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last[host] = time.monotonic()
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read(2_000_000).decode('utf-8', 'replace')


def allowed(url: str, fetcher=fetch) -> bool:
    p = urllib.parse.urlsplit(url)
    host = f'{p.scheme}://{p.netloc}'
    if host not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        try:
            rp.parse(fetcher(host + '/robots.txt').splitlines())
        except Exception as e:
            if _transient(e):
                rp.parse(['User-agent: *', 'Disallow: /'])
                _unsure.add(host)
            else:
                rp.parse([])
        _robots[host] = rp
    return _robots[host].can_fetch(UA_TOKEN, url)


def clean(s: str) -> str:
    s = re.sub(r'<!\[CDATA\[|\]\]>', '', s or '')
    s = html.unescape(s)
    s = re.sub(r'<figure.*?</figure>|<figcaption.*?</figcaption>', ' ', s, flags=re.S | re.I)
    s = html.unescape(re.sub(r'<[^>]+>', ' ', s))
    s = re.sub(r'\s+', ' ', s).strip()
    s = re.sub(r'\s*(The post .* appeared first on .*|Continue reading.*|Read more.*)$', '', s)
    return s


def trim(s: str, limit: int = MAX_CHARS) -> str:
    """Whole sentences up to `limit` characters; one cut sentence ends in an ellipsis."""
    if len(s) <= limit:
        return s
    out = ''
    for sent in re.split(r'(?<=[.!?])\s+', s):
        if len(out) + len(sent) + 1 > limit:
            break
        out = (out + ' ' + sent).strip()
    return out or s[:limit].rsplit(' ', 1)[0] + '…'


def _words(t: str) -> set:
    return {w for w in re.findall(r'[a-z0-9]+', (t or '').lower()) if len(w) > 2}


def same_headline(a: str, b: str) -> bool:
    wa, wb = _words(a), _words(b)
    return bool(wa) and len(wa & wb) / max(len(wa), 1) >= 0.8


class _Meta(HTMLParser):
    """Meta tags by property/name, parsed properly (a quoted value may hold the other quote)."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta = {}

    def handle_starttag(self, tag, attrs):
        if tag == 'meta':
            a = dict(attrs)
            key = (a.get('property') or a.get('name') or '').lower()
            if key and a.get('content') and key not in self.meta:
                self.meta[key] = a['content']


def page_description(page: str) -> str:
    head = page[:page.lower().find('</head>')] if '</head>' in page.lower() else page[:200_000]
    mp = _Meta()
    try:
        mp.feed(head)
    except Exception:
        # A malformed page head is not an error: fall through to the first-paragraph fallback below,
        # so one bad page never stops the news run.
        pass
    for key in ('og:description', 'description'):
        if len(clean(mp.meta.get(key, ''))) > 40:
            return clean(mp.meta[key])
    body = re.search(r'<(?:article|main)\b.*?</(?:article|main)>', page, re.S | re.I)
    for p in re.findall(r'<p\b[^>]*>(.*?)</p>', body.group(0) if body else page, re.S | re.I):
        t = clean(p)
        if len(t) > 80:
            return t
    return ''


def _host(url: str) -> str:
    p = urllib.parse.urlsplit(url)
    return f'{p.scheme}://{p.netloc}'


def find_article(title: str, domain: str, fetcher=fetch) -> tuple[str, str]:
    """(article link, feed description) for a headline on the outlet's own site.

    Raises Transient when nothing was found and a search could not be read (rate limit, server
    error, timeout), so the caller tries again next run instead of recording a miss.
    """
    if not domain:
        return '', ''
    q = urllib.parse.quote(re.sub(r'[\u200b-\u200f\u2060\ufeff]', '', title))
    trouble = False
    for url in (f'https://{domain}/?s={q}&feed=rss2', f'https://{domain}/search/?f=rss&q={q}'):
        if not allowed(url, fetcher):
            trouble = trouble or _host(url) in _unsure
            continue
        try:
            feed = fetcher(url)
        except Exception as e:
            trouble = trouble or _transient(e)
            continue
        for item in re.findall(r'<item>.*?</item>', feed, re.S)[:10]:
            t = re.search(r'<title>(.*?)</title>', item, re.S)
            if not t or not same_headline(title, clean(t.group(1))):
                continue
            link = re.search(r'<link>(.*?)</link>', item, re.S)
            desc = re.search(r'<description>(.*?)</description>', item, re.S)
            return (clean(link.group(1)) if link else ''), (clean(desc.group(1)) if desc else '')
    if trouble:
        raise Transient(domain)
    return '', ''


def summarize(story: dict, fetcher=fetch) -> dict:
    """{'text', 'link', 'basis'} for one story, or {'text': '', 'basis': 'not found'}."""
    title, link = story.get('title', ''), story.get('link', '')
    if story.get('agency'):
        article, feed_desc, basis = link, '', 'release'
    else:
        article, feed_desc = find_article(title, story.get('source_domain', ''), fetcher)
        basis = 'outlet'
    text, trouble = '', False
    if article and allowed(article, fetcher):
        try:
            text = page_description(fetcher(article))
        except Exception as e:
            text, trouble = '', _transient(e)
    if not text and feed_desc and not feed_desc.lower().startswith(title.lower()[:30]):
        text = feed_desc
    if not text or same_headline(text, title) and len(text) < len(title) + 20:
        if trouble:
            raise Transient(article)
        return {'text': '', 'link': article or '', 'basis': 'not found'}
    return {'text': trim(text), 'link': article, 'basis': basis}


def summarize_items(items: list[dict], cache: dict, fetcher=fetch, agency: bool = False,
                    today: str = '', budget: list | None = None) -> dict:
    """Set `summary` on each item from the cache, looking up what is missing; returns the entries used.

    A story not found is tried again at most once a day (`checked`). One the outlet would not
    serve this time (Transient) is left out of the cache, so the next run tries it again.
    `budget` is a one-item list counting the lookups this run may still make, so one run never
    reads hundreds of pages.
    """
    keep = {}
    # Order: stories never tried, then retries of outlets that did not answer last time (or misses
    # recorded before `sure` existed, some of them rate limits), then daily retries of clean misses.
    # Never-tried stories always go first, so a run of unreadable outlets cannot hold them back
    # (Codex reviews of #2934 and #2941).
    def tier(it):
        hit = cache.get(it.get('link') or it.get('title'))
        if hit is None:
            return 0
        return 2 if hit.get('sure') else 1
    for it in sorted(items, key=tier):  # stable: newest first within each tier
        key = it.get('link') or it.get('title')
        hit = cache.get(key)
        stale = hit is None or hit.get('basis') == 'unavailable' or hit.get('basis') == 'not found' and (
            hit.get('checked', '') != today or not hit.get('sure'))
        if stale and (budget is None or budget[0] > 0):
            if budget is not None:
                budget[0] -= 1
            story = {'title': it['title'], 'link': it.get('link', ''), 'agency': agency or bool(it.get('agency')),
                     'source_domain': it.get('source_domain') or urllib.parse.urlsplit(it.get('link', '')).netloc}
            try:
                hit = summarize(story, fetcher)
            except Transient:
                # shown as "no summary yet"; tried again next run, never taken for a clean miss
                hit = {'text': '', 'link': '', 'basis': 'unavailable', 'checked': today}
            except Exception:
                hit = {'text': '', 'link': '', 'basis': 'not found'}
            if hit.get('basis') == 'not found':
                hit['checked'] = today
                hit['sure'] = True
            cache[key] = hit
        if hit is not None:
            it['summary'] = hit
            keep[key] = hit
    return keep


def borrow(items: list[dict], pool: list[dict]) -> int:
    """A story whose own outlet could not be read takes the summary of the same story from another outlet.

    paul, 18 Nov 2026, wants a line under every story. The line stays the other outlet's own words (or
    the AI line written from them) and names that outlet (`via`); the headline still links to the
    story's own outlet. Returns how many stories borrowed a line.
    """
    from agency_releases import _content, _names, ordinary_words, same_story
    import datetime as _dt

    def days(x):
        try:
            return _dt.date.fromisoformat((x.get('date') or '')[:10]).toordinal()
        except ValueError:
            return None

    def clearly_same(a, b):
        # same_story groups the Today box; lending words needs more (Codex review of #2941: an
        # election story took a lawsuit's summary on two shared housing words)
        ta, tb = a.get('title', ''), b.get('title', '')
        if not same_story(ta, tb, ordinary):
            return False
        da, db = days(a), days(b)
        if da is None or db is None or abs(da - db) > 3:
            return False
        wa, wb = _content(ta), _content(tb)
        shared = wa & wb
        figures = {w for w in shared if re.match(r'\d', w)}
        names = _names(ta, ordinary) & _names(tb, ordinary)
        return len(shared) >= 3 and bool(figures or names or len(shared) / max(len(wa), len(wb)) >= 0.6)

    have = [p for p in pool if (p.get('summary') or {}).get('text') and p['summary'].get('basis') != 'same story']
    if not have:
        return 0
    ordinary = ordinary_words(p.get('title', '') for p in pool)
    n = 0
    for it in items:
        if (it.get('summary') or {}).get('text'):
            continue
        for p in have:
            if p is it or (p.get('source') and p.get('source') == it.get('source')):
                continue
            if clearly_same(it, p):
                it['summary'] = {'text': p['summary']['text'], 'link': '', 'basis': 'same story',
                                 'via': p.get('source', ''), 'via_link': p['summary'].get('link') or p.get('link', '')}
                if p.get('ai'):
                    it['ai'] = p['ai']
                n += 1
                break
    return n


def with_summaries(today: dict, cache: dict | None, fetcher=fetch,
                   pool: list | None = None) -> tuple[dict, dict]:
    """Add `summary` to each agency release and top story in the today block."""
    cache = dict(cache or {})
    keep = {}
    for group in ('agency', 'top'):
        # copies: the agency items are the agency block's own records, which must not carry summaries
        today[group] = [{k: v for k, v in it.items() if k not in ('summary', 'ai')} for it in today.get(group) or []]
    for group in ('agency', 'top'):
        keep.update(summarize_items(today[group], cache, fetcher, agency=group == 'agency', today=today.get('date', '')))
        if group == 'top' and pool:
            borrow(today[group], pool)
        for it in today[group]:
            it.setdefault('summary', {'text': '', 'link': '', 'basis': 'not found'})
    lines = []
    for it in today.get('agency') or []:
        s = it['summary']['text']
        lines.append(f"{it['agency']}: {it['title']}." + (f' “{s}”' if s else ''))
    for it in today.get('top') or []:
        s = it['summary']['text']
        lines.append(f"{it['source']}: {it['title']}." + (f' “{s}”' if s else ''))
    today['summary_lines'] = lines
    today['method'] = ('Written by the news script, with no AI. Each line quotes the story\'s own summary: '
                       'the outlet\'s description of its article, or the agency release\'s own description or '
                       'first paragraph. A story whose outlet could not be read shows its headline only. '
                       'Window: today and yesterday, Mountain Time. Top stories are the ones the most outlets ran.')
    return today, keep


# ── AI-written summaries (paul chose "AI-written, labelled", 2026-11-17) ─────
# One plain sentence per story, written by the same model the briefs use, from
# only the story's headline and its own summary found above. A story with no
# summary gets no AI sentence (it would only restate the headline). A sentence
# with a number that is not in its source text is dropped, and the quote shows
# instead. Every AI sentence is labelled on the page; the model is named.

AI_MODEL = 'gpt-4o-mini'


def _numbers(s: str) -> set:
    # whole values only: 1,200 -> 1200, 4.5 stays, a sentence's closing period is not part of the number
    return set(re.findall(r'\d+(?:\.\d+)?', re.sub(r'(?<=\d),(?=\d{3})', '', s)))


def _openai(prompt: str, api_key: str) -> str:
    import json
    body = json.dumps({'model': AI_MODEL, 'temperature': 0.2, 'max_tokens': 1600,
                       'response_format': {'type': 'json_object'},
                       'messages': [{'role': 'user', 'content': prompt}]}).encode()
    req = urllib.request.Request('https://api.openai.com/v1/chat/completions', data=body, method='POST',
                                 headers={'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=40) as res:
        return json.loads(res.read())['choices'][0]['message']['content']


# Framing the model adds on its own ("which is important for renters", "which could affect civil
# rights protections", the first live run, 17 Nov 2026) is dropped: such words, or more than a few
# content words the source never uses, and the quote shows instead.
_FRAMING_RE = re.compile(r'\b(important|significant|crucial|critical|vital|key|major|highlight\w*|underscor\w*|'
                         r'could|may|might|would|likely|potentially|impact\w*|affect\w*|benefit\w*|aim\w* to|'
                         r'help\w*|seeking|struggl\w*|concern\w*)\b', re.I)
_COMMON = {'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were', 'has', 'have', 'its', 'their',
           'they', 'will', 'new', 'says', 'said', 'about', 'into', 'over', 'more', 'than', 'also', 'which', 'who',
           'state', 'colorado', 'story', 'reports', 'report'}


def _stems(s: str) -> set:
    return {w[:5] for w in re.findall(r"[a-z]+", s.lower()) if len(w) > 3 and w not in _COMMON}


def grounded(sentence: str, source: str, allow: int = 3) -> bool:
    """True when the sentence adds no framing and at most `allow` content words the source lacks."""
    used = {m.group(0).lower()[:5] for m in _FRAMING_RE.finditer(sentence)}
    if used - {m.group(0).lower()[:5] for m in _FRAMING_RE.finditer(source)}:
        return False  # a framing word the source itself does not use
    return len(_stems(sentence) - _stems(source)) <= allow


def ai_items(items: list[dict], cache: dict, api_key: str, ask=None, batch: int = 15) -> int:
    """Set `ai` (one sentence) on each item that has its own summary text; returns how many have one."""
    import json
    ask = ask or _openai
    items = [it for it in items if (it.get('summary') or {}).get('text')]
    todo = []
    for it in items:
        it.pop('ai', None)
        key = it.get('link') or it.get('title')
        hit = (cache.get(key) or {}).get('ai')
        if hit and hit.get('from') == it['summary']['text'] and grounded(hit['text'], it['title'] + ' ' + hit['from']):
            it['ai'] = hit['text']
        else:
            todo.append(it)
    for start in range(0, len(todo) if api_key else 0, batch):
        part = todo[start:start + batch]
        src = '\n'.join(f'{i}. Headline: {it["title"]}\n   Its own summary: {it["summary"]["text"]}' for i, it in enumerate(part))
        prompt = ('For each Colorado housing news item below, restate in one plain sentence (at most 30 words) what '
                  'the story reports. Use only the words and facts in the headline and summary given. Do not add why '
                  'it matters, who it affects, what it could lead to, or any judgment such as "important". No new '
                  'facts, numbers or names. Plain everyday words. Reply as JSON: '
                  '{"items": [{"n": <number>, "sentence": "..."}]}.\n\n' + src)
        try:
            got = {int(x['n']): str(x['sentence']).strip() for x in json.loads(ask(prompt, api_key)).get('items', [])}
        except Exception as e:  # never fatal: the quotes stay
            print(f'  AI summaries skipped: {e}')
            break
        for i, it in enumerate(part):
            s = got.get(i, '')
            source = it['title'] + ' ' + it['summary']['text']
            if s and len(s) < 400 and _numbers(s) <= _numbers(source) and grounded(s, source):
                it['ai'] = s
                key = it.get('link') or it.get('title')
                entry = cache.setdefault(key, {k: v for k, v in it['summary'].items() if k != 'ai'})
                entry['ai'] = {'text': s, 'from': it['summary']['text'], 'model': AI_MODEL}
    return sum(1 for it in items if it.get('ai'))


def with_ai(today: dict, cache: dict, api_key: str, ask=None) -> dict:
    """Add `ai` (one sentence) to each story in the today block that has its own summary text."""
    items = [it for g in ('agency', 'top') for it in today.get(g) or []]
    today['ai'] = {'model': AI_MODEL, 'count': ai_items(items, cache, api_key, ask)}
    if today['ai']['count']:
        today['method'] = (f'The one-line summaries marked AI are written by AI ({AI_MODEL}) from only each story\'s '
                           'headline and its own description; check the source before relying on them. A story the '
                           'news script could not read shows its headline only. Window: today and yesterday, Mountain '
                           'Time. Top stories are the ones the most outlets ran.')
    return today


STORY_DAYS = 14      # stories this recent get a summary
LOOKUPS_PER_RUN = 100  # new page lookups one run may make


def with_story_summaries(stories: list[dict], cache: dict, api_key: str, today: str, since: str,
                         fetcher=fetch, ask=None) -> dict:
    """Every recent story in the news list gets its own summary, and an AI line where one passes.

    paul, 2026-11-18: "the news briefs use to have summaries of the content ... so people would
    know what is in the link". Newest first; older stories keep what the cache already has.
    """
    recent = sorted((s for s in stories if s.get('title') and (s.get('date') or '') >= since),
                    key=lambda s: s.get('date') or '', reverse=True)
    for s in recent:
        s.pop('summary', None)
        s.pop('ai', None)
    keep = summarize_items(recent, cache, fetcher, today=today, budget=[LOOKUPS_PER_RUN])
    count = ai_items(recent, cache, api_key, ask)
    lent = borrow(recent, recent)
    print(f'  Story summaries: {sum(1 for s in recent if (s.get("summary") or {}).get("text"))} of {len(recent)} recent '
          f'({lent} from another outlet on the same story); {count} AI lines')
    return keep
