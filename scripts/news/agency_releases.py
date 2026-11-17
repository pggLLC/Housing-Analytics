"""Agency releases for the daily Housing News, and the day's summary at the top.

paul, 2026-11-17: "news briefs should summarize the news for the day at the
top" and "news briefs missed the round two awards". CHFA announced its 2026
Round Two awards on its own newsroom and award page; no outlet the news
searches read had covered them, so the daily list never showed them.

This module reads the agencies' own pages each run, so an announcement shows
up even before any outlet writes about it:
  - CHFA newsroom (each item carries its posting date),
  - CHFA's housing tax credit awards page (a new award or applicant report),
  - DOLA press releases (housing items only),
  - OEDIT press releases and the Governor's newsroom (housing items only),
    which often refuse automated readers; a refusal is recorded, not fatal.
A page that lists no date gets the date this site first saw the item, and says
so (date_basis "first_seen"). The first time a page is read, nothing on it is
called new.

summarize_today() writes the summary block from the data only: no AI writing.
"""
from __future__ import annotations

import datetime as dt
import html
import re
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

UA = 'Mozilla/5.0 (compatible; cohoanalytics-news/1.0; +https://cohoanalytics.com)'
DENVER = ZoneInfo('America/Denver')
KEEP_DAYS = 45
HOUSING_RE = re.compile(
    r'hous|home|rent|afford|apartment|tax credit|lihtc|proposition 123|prop 123|homeless|shelter|'
    r'land bank|zoning|mortgage|down payment|eviction|tenant|landlord|dwelling|units?\b', re.I)
# CHFA's newsroom also lists meeting notices (dated by the meeting, often in the
# future), public hearing notices and its newsletters, which repeat a release.
NOT_NEWS_RE = re.compile(r'\bmeeting\b|\bcommittee\b|\bTEFRA\b|notice of public hearing|\beNews\b', re.I)

SOURCES = [
    {'id': 'chfa-news', 'agency': 'CHFA', 'name': 'CHFA newsroom', 'url': 'https://www.chfainfo.com/chfa-news', 'housing_only': False},
    {'id': 'chfa-awards', 'agency': 'CHFA', 'name': 'CHFA housing tax credit awards page',
     'url': 'https://www.chfainfo.com/rental-housing/housing-credit/awards', 'housing_only': False},
    {'id': 'dola', 'agency': 'DOLA', 'name': 'DOLA press releases', 'url': 'https://cdola.colorado.gov/category/press-release', 'housing_only': True},
    {'id': 'oedit', 'agency': 'OEDIT', 'name': 'OEDIT press releases', 'url': 'https://oedit.colorado.gov/category/press-release', 'housing_only': True},
    {'id': 'governor', 'agency': 'Governor’s Office', 'name': 'Governor’s newsroom', 'url': 'https://www.colorado.gov/governor/news', 'housing_only': True},
]


def _text(s: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', s or ''))).strip()


def _date(s: str) -> str | None:
    s = _text(s)
    for fmt in ('%B %d, %Y', '%b %d, %Y', '%m/%d/%Y'):
        try:
            return dt.datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def parse_chfa_news(page: str, base: str) -> list[dict]:
    out = []
    for m in re.finditer(r'<h3>\s*<a href="([^"]+)"[^>]*>(.*?)</a>\s*</h3>(.{0,600}?)listing__date">([^<]+)<', page, re.S):
        href, title, _, when = m.groups()
        out.append({'title': _text(title), 'link': urllib.parse.urljoin(base, href), 'date': _date(when), 'date_basis': 'posted', 'kind': 'release'})
    return out


REPORT_RE = re.compile(r'href="([^"]*/(?:getattachment|getContentAsset)/[^"]*?/([^"/?]*(?:Award|Applicant)[^"/?]*Report[^"/?]*)\.pdf[^"]*)"', re.I)


def parse_chfa_awards(page: str, base: str) -> list[dict]:
    out, seen = [], set()
    for m in REPORT_RE.finditer(page):
        href, name = m.groups()
        if name.lower() in seen:
            continue
        seen.add(name.lower())
        title = re.sub(r'[-_]+', ' ', name).replace('HTC', 'Housing Tax Credit').strip()
        out.append({'title': f'CHFA posted: {title}', 'link': urllib.parse.urljoin(base, html.unescape(href)), 'date': None,
                    'date_basis': 'first_seen', 'kind': 'report'})
    return out


def parse_drupal_list(page: str, base: str, path: str) -> list[dict]:
    out = []
    for m in re.finditer(r'<a href="(' + re.escape(path) + r'[^"]+)"[^>]*>\s*(?:<span>)?(.*?)(?:</span>)?\s*</a>', page, re.S):
        title = _text(m.group(2))
        if len(title) > 8:
            out.append({'title': title, 'link': urllib.parse.urljoin(base, m.group(1)), 'date': None, 'date_basis': 'first_seen', 'kind': 'release'})
    return out


PARSERS = {
    'chfa-news': parse_chfa_news,
    'chfa-awards': parse_chfa_awards,
    'dola': lambda p, b: parse_drupal_list(p, b, '/press-release/'),
    'oedit': lambda p, b: parse_drupal_list(p, b, '/press-release/'),
    'governor': lambda p, b: parse_drupal_list(p, b, '/governor/news/'),
}


def fetch(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read().decode('utf-8', 'replace')


def collect(prior: dict | None, today: str, fetcher=fetch) -> dict:
    """Read every source; return the agency block for data/policy_briefs.json.

    prior is the agency block from the last run (or None). Its `first_seen`
    map dates the undated items; a source read for the first time marks its
    current items as already there (first_seen "before"), so they are not new.
    """
    prior = prior or {}
    first_seen: dict = dict(prior.get('first_seen') or {})
    known_sources = set(prior.get('sources_read') or [])
    items, statuses, read_ok = [], [], set(known_sources)
    for src in SOURCES:
        try:
            page = fetcher(src['url'])
            found = PARSERS[src['id']](page, src['url'])
            status = 'ok'
        except Exception as exc:  # a refusal or timeout is recorded, never fatal
            found, status = [], f'{exc.__class__.__name__}: {exc}'[:160]
        statuses.append({'id': src['id'], 'name': src['name'], 'url': src['url'], 'status': status, 'items': len(found)})
        if status != 'ok':
            # A refusal or timeout keeps what the last run found there, so an
            # agency-only release does not drop off the list for a night.
            items.extend(it for it in prior.get('items') or [] if it.get('source') == src['name'])
            continue
        first_read = src['id'] not in known_sources
        read_ok.add(src['id'])
        seen_links = set()
        for it in found:
            it['link'] = it['link'].split('?')[0]
            if it['link'] in seen_links:
                continue
            seen_links.add(it['link'])
            if src['housing_only'] and not HOUSING_RE.search(it['title']):
                continue
            if NOT_NEWS_RE.search(it['title']) or (it['date'] and it['date'] > today):
                continue
            if it['link'] not in first_seen:
                first_seen[it['link']] = 'before' if first_read else today
            fs = first_seen[it['link']]
            date = it['date'] or (fs if fs != 'before' else None)
            items.append({'agency': src['agency'], 'source': src['name'], 'title': it['title'], 'link': it['link'],
                          'date': date, 'date_basis': it['date_basis'] if it['date'] else 'first_seen', 'kind': it['kind']})
    # The page shows recent releases only; first_seen keeps the memory of the rest.
    keep_from = (dt.date.fromisoformat(today) - dt.timedelta(days=KEEP_DAYS)).isoformat()
    items = [x for x in items if x['date'] and x['date'] >= keep_from]
    items.sort(key=lambda x: x['date'], reverse=True)
    return {'checked': dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'sources': statuses, 'sources_read': sorted(read_ok), 'items': items, 'first_seen': first_seen}


def agency_stories(block: dict, since: str) -> list[dict]:
    """Agency items dated on or after `since`, shaped as Housing News stories."""
    out = []
    for it in block.get('items', []):
        if not it.get('date') or it['date'] < since:
            continue
        out.append({'title': it['title'], 'source': it['agency'], 'sourcing': 'checked', 'source_domain': urllib.parse.urlsplit(it['link']).netloc,
                    'link': it['link'], 'date': it['date'], 'scope': 'colorado', 'programs': [], 'places': [], 'regions': [],
                    'also': [], 'agency': True, 'date_basis': it['date_basis']})
    return out


def _fmt_day(d: dt.date) -> str:
    return d.strftime('%A, %B ') + str(d.day)


_STOP = {'the', 'and', 'for', 'with', 'new', 'finds', 'says', 'colorado', 'from', 'are', 'that', 'this', 'over', 'into', 'after'}


def _content(title: str) -> set:
    return {w[:5] for w in re.findall(r'[a-z0-9%]+', (title or '').lower().replace('\u200b', '')) if len(w) > 2 and w not in _STOP}


def _names(title: str) -> set:
    """Capitalised words (places, agencies, people), as lowercase stems."""
    return {w.lower()[:5] for w in re.findall(r"[A-Z][A-Za-z]+", title or '') if len(w) > 2 and w.lower() not in _STOP}


def same_story(a: str, b: str) -> bool:
    """Two headlines for one story: a shared percent figure, or half the word stems in common.

    Never when their figures disagree ("200 homes" vs "100 homes") or each names someone or
    somewhere the other does not ("Denver approves..." vs "Boulder approves...").
    """
    na, nb = set(re.findall(r'\d+(?:\.\d+)?%?', a or '')), set(re.findall(r'\d+(?:\.\d+)?%?', b or ''))
    if na and nb and not na & nb:
        return False
    wa, wb = _content(a), _content(b)
    if (_names(a) - wb) and (_names(b) - wa):
        return False
    pa, pb = {n for n in na if n.endswith('%')}, {n for n in nb if n.endswith('%')}
    overlap = len(wa & wb) / max(1, min(len(wa), len(wb)))
    return bool(pa & pb) and overlap >= 0.3 or overlap >= 0.5


def summarize_today(stories: list[dict], agency: dict, now: dt.datetime | None = None, about=None) -> dict:
    """The day's summary, from the data only.

    The window is today and yesterday in Mountain Time, since the news run
    happens overnight. Lines, in order: agency releases in the window; how many
    Colorado stories are new; the most-covered stories (most outlets on one
    story, checked outlets first); the places most in the news. When nothing is
    new the summary says so and points to the latest story.
    """
    now = (now or dt.datetime.now(dt.timezone.utc)).astimezone(DENVER)
    today = now.date()
    since = (today - dt.timedelta(days=1)).isoformat()
    end = today.isoformat()
    inside = lambda d: bool(d) and since <= d <= end  # today and yesterday, never a future date
    co = [s for s in stories if s.get('scope') != 'national' and s.get('title') and inside(s.get('date'))]
    news = [s for s in co if not s.get('agency')]
    ag = [it for it in agency.get('items', []) if inside(it.get('date'))]
    rank = sorted(news, key=lambda s: (s.get('sourcing', 'checked') == 'checked', len(s.get('also') or []), s.get('date') or ''), reverse=True)
    # Top stories must say housing in the headline (`about`), and one story told by two outlets
    # under different headlines counts once (17 Nov: a state study led twice, and a court case
    # about a pronouns law made the top three).
    # Group every eligible story first, so a story told under several headlines ranks by its
    # combined coverage (Codex review of #2913), then take the three most covered.
    groups: list[list[dict]] = []
    for s in rank:
        if about and not about(s['title']):
            continue
        g = next((g for g in groups if any(same_story(m['title'], s['title']) for m in g)), None)
        (g.append(s) if g else groups.append([s]))
    def covered(g):  # distinct publishers across the group (one outlet's two headlines count once)
        names = {(m.get('source') or m.get('link') or id(m)) for m in g}
        names |= {(a.get('source') or a.get('link') or id(a)) for m in g for a in m.get('also') or []}
        return len(names)
    groups.sort(key=lambda g: (g[0].get('sourcing', 'checked') == 'checked', covered(g), g[0].get('date') or ''), reverse=True)
    top = [{'title': g[0]['title'], 'link': g[0].get('link', ''), 'source': g[0].get('source', ''),
            'source_domain': g[0].get('source_domain', ''), 'outlets': covered(g), 'date': g[0].get('date')}
           for g in groups[:3]]
    places: dict = {}
    for s in news:
        for p in s.get('places') or []:
            if p.get('type') != 'state':
                places[p['name']] = places.get(p['name'], 0) + 1
    hot = sorted(places.items(), key=lambda kv: (-kv[1], kv[0]))[:4]
    lines = []
    for it in ag[:4]:
        when = 'first seen' if it['date_basis'] == 'first_seen' else 'posted'
        lines.append(f"{it['agency']}: {it['title']} ({when} {it['date']}).")
    if news:
        lines.append(f"{len(news)} new Colorado housing {'story' if len(news) == 1 else 'stories'} since {_fmt_day(today - dt.timedelta(days=1))}.")
        for t in top:
            more = f", and {t['outlets'] - 1} more outlet{'s' if t['outlets'] > 2 else ''}" if t['outlets'] > 1 else ''
            lines.append(f"{t['title']} ({t['source']}{more}).")
        if hot:
            lines.append('Places in the news: ' + ', '.join(f'{n} ({c})' for n, c in hot) + '.')
    elif not ag:
        latest = next((s for s in stories if s.get('scope') != 'national' and s.get('date')), None)
        lines.append('No new Colorado housing stories or agency releases since yesterday.' +
                     (f" The latest story is from {latest['date']}." if latest else ''))
    return {'as_of': now.strftime('%Y-%m-%dT%H:%M:%S%z'), 'date': today.isoformat(), 'since': since,
            'counts': {'stories': len(news), 'agency': len(ag)},
            'agency': ag[:4], 'top': top, 'places': [{'name': n, 'stories': c} for n, c in hot], 'lines': lines,
            'method': 'Written by the news script from the stories and agency pages it read; no AI writing. '
                      'Window: today and yesterday, Mountain Time. Most covered = most outlets on one story, checked outlets first.'}
