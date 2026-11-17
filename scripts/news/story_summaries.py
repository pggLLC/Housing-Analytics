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


def fetch(url: str, timeout: int = 20) -> str:
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
        except urllib.error.HTTPError as e:
            rp.parse([] if e.code < 500 else ['User-agent: *', 'Disallow: /'])
        except Exception:
            rp.parse(['User-agent: *', 'Disallow: /'])
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


def find_article(title: str, domain: str, fetcher=fetch) -> tuple[str, str]:
    """(article link, feed description) for a headline on the outlet's own site."""
    if not domain:
        return '', ''
    q = urllib.parse.quote(title)
    for url in (f'https://{domain}/?s={q}&feed=rss2', f'https://{domain}/search/?f=rss&q={q}'):
        if not allowed(url, fetcher):
            continue
        try:
            feed = fetcher(url)
        except Exception:
            continue
        for item in re.findall(r'<item>.*?</item>', feed, re.S)[:10]:
            t = re.search(r'<title>(.*?)</title>', item, re.S)
            if not t or not same_headline(title, clean(t.group(1))):
                continue
            link = re.search(r'<link>(.*?)</link>', item, re.S)
            desc = re.search(r'<description>(.*?)</description>', item, re.S)
            return (clean(link.group(1)) if link else ''), (clean(desc.group(1)) if desc else '')
    return '', ''


def summarize(story: dict, fetcher=fetch) -> dict:
    """{'text', 'link', 'basis'} for one story, or {'text': '', 'basis': 'not found'}."""
    title, link = story.get('title', ''), story.get('link', '')
    if story.get('agency'):
        article, feed_desc, basis = link, '', 'release'
    else:
        article, feed_desc = find_article(title, story.get('source_domain', ''), fetcher)
        basis = 'outlet'
    text = ''
    if article and allowed(article, fetcher):
        try:
            text = page_description(fetcher(article))
        except Exception:
            text = ''
    if not text and feed_desc and not feed_desc.lower().startswith(title.lower()[:30]):
        text = feed_desc
    if not text or same_headline(text, title) and len(text) < len(title) + 20:
        return {'text': '', 'link': article or '', 'basis': 'not found'}
    return {'text': trim(text), 'link': article, 'basis': basis}


def with_summaries(today: dict, cache: dict | None, fetcher=fetch) -> tuple[dict, dict]:
    """Add `summary` to each agency release and top story in the today block."""
    cache = dict(cache or {})
    keep = {}
    for group in ('agency', 'top'):
        # copies: the agency items are the agency block's own records, which must not carry summaries
        today[group] = [{k: v for k, v in it.items() if k not in ('summary', 'ai')} for it in today.get(group) or []]
    for group in ('agency', 'top'):
        for it in today.get(group) or []:
            key = it.get('link') or it.get('title')
            if key not in cache or cache[key].get('basis') == 'not found':
                story = {'title': it['title'], 'link': it.get('link', ''), 'agency': group == 'agency',
                         'source_domain': it.get('source_domain') or urllib.parse.urlsplit(it.get('link', '')).netloc}
                try:
                    cache[key] = summarize(story, fetcher)
                except Exception:
                    cache[key] = {'text': '', 'link': '', 'basis': 'not found'}
            it['summary'] = cache[key]
            keep[key] = cache[key]
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
    body = json.dumps({'model': AI_MODEL, 'temperature': 0.2, 'max_tokens': 600,
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
    if _FRAMING_RE.search(sentence) and not _FRAMING_RE.search(source):
        return False
    return len(_stems(sentence) - _stems(source)) <= allow


def with_ai(today: dict, cache: dict, api_key: str, ask=None) -> dict:
    """Add `ai` (one sentence) to each story that has its own summary text."""
    import json
    ask = ask or _openai
    items = [it for g in ('agency', 'top') for it in today.get(g) or [] if (it.get('summary') or {}).get('text')]
    todo = []
    for it in items:
        key = it.get('link') or it.get('title')
        hit = (cache.get(key) or {}).get('ai')
        if hit and hit.get('from') == it['summary']['text'] and grounded(hit['text'], it['title'] + ' ' + hit['from']):
            it['ai'] = hit['text']
        else:
            todo.append(it)
    if todo and api_key:
        src = '\n'.join(f'{i}. Headline: {it["title"]}\n   Its own summary: {it["summary"]["text"]}' for i, it in enumerate(todo))
        prompt = ('For each Colorado housing news item below, restate in one plain sentence (at most 30 words) what '
                  'the story reports. Use only the words and facts in the headline and summary given. Do not add why '
                  'it matters, who it affects, what it could lead to, or any judgment such as "important". No new '
                  'facts, numbers or names. Plain everyday words. Reply as JSON: '
                  '{"items": [{"n": <number>, "sentence": "..."}]}.\n\n' + src)
        try:
            got = {int(x['n']): str(x['sentence']).strip() for x in json.loads(ask(prompt, api_key)).get('items', [])}
        except Exception as e:  # never fatal: the quotes stay
            print(f'  AI summaries skipped: {e}')
            got = {}
        for i, it in enumerate(todo):
            s = got.get(i, '')
            source = it['title'] + ' ' + it['summary']['text']
            if s and len(s) < 400 and _numbers(s) <= _numbers(source) and grounded(s, source):
                it['ai'] = s
                key = it.get('link') or it.get('title')
                cache.setdefault(key, dict(it['summary']))['ai'] = {'text': s, 'from': it['summary']['text'], 'model': AI_MODEL}
    today['ai'] = {'model': AI_MODEL, 'count': sum(1 for it in items if it.get('ai'))}
    if today['ai']['count']:
        today['method'] = (f'The one-line summaries marked AI are written by AI ({AI_MODEL}) from only each story\'s '
                           'headline and its own description; check the source before relying on them. A story the '
                           'news script could not read shows its headline only. Window: today and yesterday, Mountain '
                           'Time. Top stories are the ones the most outlets ran.')
    return today
