#!/usr/bin/env python3
"""
scripts/news/owner_news_picks.py

The owner's own news picks, for Housing News: his Google Alerts (as RSS feeds)
and the links he pastes. Approved by paul on 2026-10-20 (walkthrough review,
item 5: "owner RSS feeds and a link form into the existing review queue").

Nothing here publishes on its own:
  - A pasted link is a pick the owner made himself. He pastes it in the
    "News link" issue form (.github/ISSUE_TEMPLATE/news-link.yml); only issues
    opened by the repository owner, a member or a collaborator are read. The
    link is recorded as published and the issue is closed with a note.
  - A Google Alerts story waits. It is listed in one open issue, "News picks
    to review", with a box to tick. A ticked story is published on the next
    run; one left unticked for 30 days drops off.

No mailbox is read and no account is connected: Google Alerts offers each
alert as an RSS feed, listed in data/alerts/owner-feeds.txt (its own file,
because scripts/alert_feeds.txt is rewritten on every run). $0: GitHub issues
and the workflow's own token.

Writes data/alerts/owner-news.json, which scripts/generate_policy_briefs.py
reads (published items only) and the review issue is rebuilt from.

Usage:
  python3 scripts/news/owner_news_picks.py                 # writes the ledger; reads GitHub only
  python3 scripts/news/owner_news_picks.py --sync-issues   # after the ledger is pushed: closes the
                                                           # recorded link issues, rewrites the review issue
Environment: GITHUB_TOKEN, GITHUB_REPOSITORY (default pggLLC/Housing-Analytics).
"""
from __future__ import annotations

import hashlib
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FEEDS_FILE = ROOT / 'data' / 'alerts' / 'owner-feeds.txt'
OUT_FILE = ROOT / 'data' / 'alerts' / 'owner-news.json'
STORIES_FILE = ROOT / 'data' / 'policy_briefs.json'
sys.path.insert(0, str(ROOT / 'scripts'))

from fetch_google_alerts import parse_feed  # noqa: E402

LINK_LABEL = 'news-link'
REVIEW_LABEL = 'news-review'
REVIEW_TITLE = 'News picks to review'
MARKER = '<!-- owner-news-review -->'
TRUSTED = {'OWNER', 'MEMBER', 'COLLABORATOR'}
WAIT_DAYS = 30
KEEP_DAYS = 90
TIMEOUT = 20
UA = 'Mozilla/5.0 (compatible; HousingAnalytics/1.0; +https://cohoanalytics.com)'


# ── Links and titles ─────────────────────────────────────────────────────────

def unwrap(url: str) -> str:
    """Google Alerts links go through google.com/url?url=<the article>."""
    p = urllib.parse.urlparse(url or '')
    if p.netloc.endswith('google.com') and p.path == '/url':
        real = urllib.parse.parse_qs(p.query).get('url')
        if real:
            return real[0]
    return url or ''


def norm_url(url: str) -> str:
    p = urllib.parse.urlparse(unwrap(url).strip())
    host = p.netloc.lower().removeprefix('www.')
    return f'{host}{p.path.rstrip("/")}'.lower()


def norm_title(t: str) -> str:
    t = re.sub(r'[‐-―-]', ' ', (t or '').lower())
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]', '', t)).strip()


def item_id(url: str) -> str:
    return hashlib.sha1(norm_url(url).encode()).hexdigest()[:10]


def domain(url: str) -> str:
    return urllib.parse.urlparse(url).netloc.lower().removeprefix('www.')


def _meta(page: str, *names: str) -> str:
    for name in names:
        m = re.search(r'<meta[^>]+(?:property|name)=["\']%s["\'][^>]*content=["\']([^"\']+)' % re.escape(name), page, re.I) \
            or re.search(r'<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\']%s["\']' % re.escape(name), page, re.I)
        if m:
            return html.unescape(m.group(1)).strip()
    return ''


def describe(url: str, fetch=None) -> dict:
    """Headline, publisher, date and the article's own address for a pasted link.

    An Apple News link (apple.news/…) is a page that redirects to the
    publisher's article; its twitter:title is the headline and its Author the
    publisher. Anything that cannot be read keeps what the form gave.
    """
    fetch = fetch or _get
    out = {'link': url, 'title': '', 'source': '', 'date': ''}
    try:
        page = fetch(url)
    except Exception as exc:  # noqa: BLE001 — a blocked page still gets listed
        print(f'  ⚠ Could not read {url}: {exc}', file=sys.stderr)
        page = ''
    if domain(url) == 'apple.news':
        m = re.search(r'redirectToUrl\(\s*["\'](https?://[^"\']+)', page)
        if m:
            out['link'] = m.group(1)
        out['source'] = _meta(page, 'Author')
    out['title'] = _meta(page, 'twitter:title', 'og:title')
    if not out['title']:
        m = re.search(r'<title[^>]*>([^<]+)', page, re.I)
        out['title'] = html.unescape(m.group(1)).strip() if m else ''
    out['source'] = out['source'] or _meta(page, 'og:site_name') or domain(out['link'])
    # "Headline — Publisher" and "Headline | Publisher" carry the name twice.
    for sep in (' — ', ' | ', ' - '):
        if out['source'] and out['title'].endswith(sep + out['source']):
            out['title'] = out['title'][: -len(sep + out['source'])].strip()
    published = _meta(page, 'article:published_time', 'datePublished', 'pubdate')
    out['date'] = published[:10] if re.match(r'\d{4}-\d{2}-\d{2}', published) else ''
    return out


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read(600_000).decode('utf-8', 'replace')


# ── Feeds ────────────────────────────────────────────────────────────────────

def feed_urls(path: Path = FEEDS_FILE) -> list[str]:
    if not path.exists():
        return []
    return [ln.strip() for ln in path.read_text().splitlines() if ln.strip() and not ln.lstrip().startswith('#')]


def alert_items(feeds: list[str], parse=parse_feed) -> list[dict]:
    items = []
    for url in feeds:
        for a in parse(url):
            link = unwrap(a.get('url', ''))
            if not link or not a.get('title'):
                continue
            items.append({'title': a['title'].strip(), 'source': domain(link), 'link': link,
                          'date': (a.get('date') or '')[:10], 'via': 'google-alert'})
    return items


# ── Issues ───────────────────────────────────────────────────────────────────

URL_RE = re.compile(r'https?://[^\s<>()\]"\']+')


def pasted_links(issues: list[dict]) -> list[dict]:
    """One pick per trusted "News link" issue: its first link, plus the headline
    typed in the form when the page cannot be read."""
    out = []
    for it in issues:
        if it.get('pull_request') or it.get('author_association') not in TRUSTED or not is_link_issue(it):
            continue
        body = it.get('body') or ''
        m = URL_RE.search(body)
        if not m:
            continue
        head = re.search(r'###\s*Headline[^\n]*\n+([^\n#]+)', body)
        headline = head.group(1).strip() if head and head.group(1).strip() != '_No response_' else ''
        out.append({'issue': it['number'], 'link': m.group(0).rstrip('.,'), 'headline': headline,
                    'opened': (it.get('created_at') or '')[:10]})
    return out


def is_link_issue(it: dict) -> bool:
    # By label, or by the form's title: a label the repository does not have
    # yet is dropped from a new issue (sync_issues creates it).
    labels = {(lb.get('name') if isinstance(lb, dict) else lb) for lb in it.get('labels') or []}
    return LINK_LABEL in labels or (it.get('title') or '').strip().lower().startswith('news link')


def open_issues(token: str, repo: str) -> list[dict]:
    out = []
    for page in range(1, 6):
        batch = gh(token, f'/repos/{repo}/issues?state=open&per_page=100&page={page}')
        out += batch
        if len(batch) < 100:
            break
    return out


def ticked_ids(body: str) -> set[str]:
    return set(re.findall(r'^- \[[xX]\] .*<!-- id:([0-9a-f]{10}) -->', body or '', re.M))


def review_body(items: list[dict], repo: str) -> str:
    form = f'https://github.com/{repo}/issues/new?template=news-link.yml'
    waiting = sorted((i for i in items if i['status'] == 'waiting'), key=lambda i: i['date'], reverse=True)
    lines = [MARKER, '',
             'Stories from your Google Alerts that are not on Housing News yet. Tick **Publish** on the ones '
             'that belong there; the next daily news run puts them on the page. A story left unticked drops off '
             f'after {WAIT_DAYS} days.', '',
             f'To add a story yourself, [paste its link here]({form}). It goes on the page with the next run.', '']
    if not waiting:
        lines.append('Nothing waiting right now.')
    for i in waiting:
        title = i['title'].replace('[', '(').replace(']', ')')
        lines.append(f'- [ ] Publish: [{title}]({i["link"]}) — {i["source"]}, {i["date"] or "undated"} '
                     f'<!-- id:{i["id"]} -->')
    return '\n'.join(lines) + '\n'


# ── The ledger ───────────────────────────────────────────────────────────────

def load_ledger(path: Path = OUT_FILE) -> list[dict]:
    try:
        return list(json.loads(path.read_text()).get('items', []))
    except (OSError, ValueError):
        return []


def page_keys(path: Path = STORIES_FILE) -> tuple[set[str], set[str]]:
    """Headlines and addresses already on Housing News, so an alert repeating
    one is not asked about twice."""
    try:
        stories = json.loads(path.read_text()).get('stories', [])
    except (OSError, ValueError):
        stories = []
    return ({norm_title(s.get('title', '')) for s in stories},
            {norm_url(s.get('link', '')) for s in stories if s.get('link')})


def update(ledger: list[dict], alerts: list[dict], pasted: list[dict], ticked: set[str],
           on_page: tuple[set[str], set[str]], today: date, describe_fn=describe) -> tuple[list[dict], list[int]]:
    """The new ledger, and the issue numbers of pasted links now recorded."""
    by_id = {i['id']: i for i in ledger}
    titles = {norm_title(i['title']) for i in ledger}
    stamp = today.isoformat()
    for iid in ticked:
        if iid in by_id and by_id[iid]['status'] == 'waiting':
            by_id[iid].update(status='published', reviewed=stamp)
    done = []
    for p in pasted:
        d = describe_fn(p['link'])
        iid = item_id(d['link'])
        title = d['title'] or p['headline'] or d['link']
        if iid in by_id:
            by_id[iid].update(status='published', reviewed=stamp, via='pasted', issue=p['issue'])
        else:
            by_id[iid] = {'id': iid, 'title': title, 'source': d['source'] or domain(d['link']), 'link': d['link'],
                          'date': d['date'] or p['opened'] or stamp, 'via': 'pasted', 'status': 'published',
                          'added': stamp, 'reviewed': stamp, 'issue': p['issue']}
            titles.add(norm_title(title))
        done.append(p['issue'])
    page_titles, page_links = on_page
    for a in alerts:
        iid = item_id(a['link'])
        key = norm_title(a['title'])
        if iid in by_id or key in titles or key in page_titles or norm_url(a['link']) in page_links:
            continue
        by_id[iid] = {'id': iid, **a, 'status': 'waiting', 'added': stamp}
        titles.add(key)
    wait_cut = (today - timedelta(days=WAIT_DAYS)).isoformat()
    keep_cut = (today - timedelta(days=KEEP_DAYS)).isoformat()
    kept = [i for i in by_id.values()
            if not (i['status'] == 'waiting' and i['added'] < wait_cut)
            and not (i['status'] == 'published' and (i['date'] or i['added']) < keep_cut)]
    kept.sort(key=lambda i: (i['date'] or i['added'], i['id']), reverse=True)
    return kept, done


def published(path: Path = OUT_FILE) -> list[dict]:
    return [i for i in load_ledger(path) if i.get('status') == 'published']


# ── GitHub ───────────────────────────────────────────────────────────────────

def gh(token: str, path: str, method: str = 'GET', body: dict | None = None):
    req = urllib.request.Request(
        f'https://api.github.com{path}', method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read() or b'null')


def sync_issues(token: str, repo: str) -> int:
    """Run after the ledger is on main, so an issue is never closed for a pick
    that did not land."""
    ledger = load_ledger()
    recorded = {i.get('issue') for i in ledger if i.get('issue')}
    for name, color in ((LINK_LABEL, '0e8a16'), (REVIEW_LABEL, '1d76db')):
        try:
            gh(token, f'/repos/{repo}/labels', 'POST', {'name': name, 'color': color})
        except urllib.error.HTTPError as exc:
            if exc.code != 422:  # 422: it already exists
                raise
    issues = open_issues(token, repo)
    for it in issues:
        if is_link_issue(it) and it['number'] in recorded:
            gh(token, f'/repos/{repo}/issues/{it["number"]}/comments', 'POST',
               {'body': 'Added to Housing News. It shows on the page once the site redeploys.'})
            gh(token, f'/repos/{repo}/issues/{it["number"]}', 'PATCH', {'state': 'closed', 'state_reason': 'completed'})
    review = next((i for i in issues if MARKER in (i.get('body') or '')), None)
    body = review_body(ledger, repo)
    if review:
        if review['body'] != body:
            gh(token, f'/repos/{repo}/issues/{review["number"]}', 'PATCH', {'body': body})
    elif any(i['status'] == 'waiting' for i in ledger):
        gh(token, f'/repos/{repo}/issues', 'POST', {'title': REVIEW_TITLE, 'body': body, 'labels': [REVIEW_LABEL]})
    return 0


def main() -> int:
    token = os.environ.get('GITHUB_TOKEN', '')
    repo = os.environ.get('GITHUB_REPOSITORY', 'pggLLC/Housing-Analytics')
    if '--sync-issues' in sys.argv[1:]:
        if not token:
            print('✗ --sync-issues needs GITHUB_TOKEN', file=sys.stderr)
            return 1
        return sync_issues(token, repo)
    today = datetime.now(timezone.utc).date()

    issues, review = [], None
    if token:
        # A GitHub hiccup must not hold back the day's news: carry on with the
        # feeds and the ledger as they are.
        try:
            issues = open_issues(token, repo)
        except Exception as exc:  # noqa: BLE001
            print(f'  ⚠ Could not read issues: {exc}', file=sys.stderr)
        review = next((i for i in issues if MARKER in (i.get('body') or '')), None)
    feeds = feed_urls()
    alerts = alert_items(feeds)
    pasted = pasted_links(issues)
    ledger, _ = update(load_ledger(), alerts, pasted, ticked_ids(review['body'] if review else ''),
                       page_keys(), today)
    OUT_FILE.write_text(json.dumps({
        'meta': {
            'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'feeds': len(feeds),
            'method': ('The owner\'s picks for Housing News. Pasted links are published as given; Google Alerts '
                       f'stories wait in the "{REVIEW_TITLE}" issue until ticked, and drop off after {WAIT_DAYS} days. '
                       'A headline is a lead, not a source.'),
        },
        'items': ledger,
    }, indent=2) + '\n')
    waiting = sum(i['status'] == 'waiting' for i in ledger)
    print(f'✓ {len(feeds)} feed(s), {len(alerts)} alert item(s), {len(pasted)} pasted link(s); '
          f'{waiting} waiting, {len(ledger) - waiting} published → {OUT_FILE.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
