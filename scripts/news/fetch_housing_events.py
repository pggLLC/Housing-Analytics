#!/usr/bin/env python3
"""
scripts/news/fetch_housing_events.py

Upcoming Colorado housing events for Housing News (policy-briefs.html) and the
jurisdiction briefs' news panel.

Until 2026-10-14 the news feed carried no events at all: it is built from news
searches, and a training calendar or a conference agenda rarely makes the news.
So the Housing Colorado conference and CHFA's chfareach classes never appeared.

Three sources, each read every day by weekly_housing_brief.yml:
  - CHFA's public calendar feed, the data behind chfainfo.com/events and the
    chfareach calendar (JSON: title, start, end, place, link).
  - Housing Colorado's "Upcoming Events" list on housingcolorado.org/events/.
    The site sits behind Cloudflare and answers a bare script with 403; it
    answers a request that sends ordinary browser headers.
  - data/policy/housing-events-curated.json: events no feed lists (the annual
    conference has its own page, not a row in the list; NAHRO is national).
    Each entry names the page it was checked against and the date.

A source that cannot be read is recorded as unreachable and contributes
nothing. Its previous upcoming events are not kept: a list that silently stops
updating is the failure this file exists to avoid.

Past events are kept in their own list (`past`, newest first) because paul
asked on 2026-10-19 to keep them: a record of what CHFA and Housing Colorado
ran is useful, and it never reads as current. Each is an event a source listed
while it was still upcoming or as it ended; CHFA's feed also lists its own past
events. Kept for PAST_DAYS.

Usage:
  python3 scripts/news/fetch_housing_events.py              # fetch and write
  python3 scripts/news/fetch_housing_events.py --offline    # curated only
  python3 scripts/news/fetch_housing_events.py --today 2026-10-14
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_FILE = ROOT / 'data' / 'policy' / 'housing-events.json'
CURATED_FILE = ROOT / 'data' / 'policy' / 'housing-events-curated.json'

CHFA_FEED = 'https://www.chfainfo.com/api/calendar/calendar.json'
CHFA_BASE = 'https://www.chfainfo.com'
CHFA_PAGE = 'https://www.chfainfo.com/events'
HC_PAGE = 'https://housingcolorado.org/events/'

HORIZON_DAYS = 120
PAST_DAYS = 365
TIMEOUT = 30
BROWSER_HEADERS = {
    'User-Agent': ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                   '(KHTML, like Gecko) Chrome/126.0 Safari/537.36'),
    'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
}

# Display order. The page shows a filter chip for each one that has events.
CATEGORIES = {
    'conference': 'Conferences',
    'developer': 'Developer & finance',
    'compliance': 'Compliance training',
    'board': 'Board meetings',
    'homebuyer': 'Homebuyer & lender',
    'networking': 'Networking',
    'other': 'Other',
}

MONTHS = {m: i for i, m in enumerate(
    ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
     'september', 'october', 'november', 'december'], start=1)}


def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers=BROWSER_HEADERS)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read()


def clean(text: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(text or '')).strip()


def categorize(title: str, organizer: str) -> str:
    t = title.lower()
    if 'board of directors' in t:
        return 'board'
    if 'conference' in t:
        return 'conference'
    if re.search(r'homebuyer|lender|loan|closers|funders|final documents|suspense conditions|'
                 r'real estate professional|mortgage', t):
        return 'homebuyer'
    if re.search(r'^(chfareach|hpi)\b|compliance|nspire|reac|hotma|fair housing|vivienda justa|'
                 r'property|resident|de-escalation', t):
        return 'compliance'
    if re.search(r'tax credit|lihtc|qap|allocation|developer|funding|financ|bond|prop(osition)? 123', t):
        return 'developer'
    return 'networking' if organizer == 'Housing Colorado' else 'other'


def _iso_day(value: str) -> str | None:
    m = re.match(r'^(\d{4}-\d{2}-\d{2})', value or '')
    if not m or m.group(1).startswith('0001'):
        return None
    return m.group(1)


def _time(value: str, all_day: bool) -> str | None:
    if all_day:
        return None
    m = re.match(r'^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})', value or '')
    return m.group(1) if m else None


def parse_chfa(doc: dict) -> list[dict]:
    """CHFA's calendar JSON → events. Times are Mountain, as CHFA lists them."""
    if not isinstance(doc, dict) or not isinstance(doc.get('events'), list):
        raise ValueError('CHFA calendar response has no events list')
    out = []
    for e in (doc or {}).get('events') or []:
        title = clean(e.get('title') or e.get('extendedProps', {}).get('heading') or '')
        start = _iso_day(e.get('start') or '')
        if not title or not start:
            continue
        all_day = bool(e.get('allDay'))
        end = _iso_day(e.get('end') or '')
        url = (e.get('url') or '').strip()
        if url.startswith('/'):
            url = CHFA_BASE + url
        if not url.startswith('http'):
            url = CHFA_PAGE
        location = clean((e.get('extendedProps') or {}).get('copy') or '')
        out.append({
            'title': title,
            'start': start,
            'end': end if end and end != start else None,
            'time': _time(e.get('start') or '', all_day),
            'location': location or None,
            'online': bool(re.search(r'\bonline\b|\bvirtual\b', location, re.I)),
            'organizer': 'CHFA',
            'url': url,
            'source': 'chfa',
            'category': categorize(title, 'CHFA'),
        })
    return out


def _parse_long_date(text: str) -> str | None:
    m = re.search(r'([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})', text or '')
    if not m or m.group(1).lower() not in MONTHS:
        return None
    return date(int(m.group(3)), MONTHS[m.group(1).lower()], int(m.group(2))).isoformat()


def parse_housing_colorado(page: str) -> list[dict]:
    """The "Upcoming Events" list on housingcolorado.org/events/.

    A 200 that is not that page (a bot challenge, a redesign) must not read as
    "no events": without the list's container the page is not recognized.
    """
    if 'class="remembers-events"' not in (page or ''):
        raise ValueError('Housing Colorado events list not found on the page')
    out = []
    for art in re.findall(r'<article class="remembers-event">(.*?)</article>', page or '', re.S):
        title = clean(re.sub(r'<[^>]+>', ' ', (re.search(r'<h3[^>]*>(.*?)</h3>', art, re.S) or [None, ''])[1]))
        when = re.search(r'class="remembers-event-date"[^>]*>(.*?)</p>', art, re.S)
        start = _parse_long_date(clean(re.sub(r'<[^>]+>', ' ', when.group(1)))) if when else None
        link = re.search(r'href="(https?://[^"]+)"', art)
        if not title or not start:
            continue
        out.append({
            'title': title,
            'start': start,
            'end': None,
            'time': None,
            'location': None,
            'online': False,
            'organizer': 'Housing Colorado',
            'url': html.unescape(link.group(1)) if link else HC_PAGE,
            'source': 'housing_colorado',
            'category': categorize(title, 'Housing Colorado'),
        })
    return out


def load_curated(path: Path = CURATED_FILE) -> list[dict]:
    doc = json.loads(path.read_text(encoding='utf-8'))
    out = []
    for e in doc.get('events') or []:
        checked = e.get('checked') or {}
        if not (checked.get('date') and checked.get('source_url') and checked.get('quote')):
            raise ValueError(f'curated event {e.get("title")!r} has no source, check date and quote')
        if e.get('category') not in CATEGORIES:
            raise ValueError(f'curated event {e.get("title")!r} has unknown category {e.get("category")!r}')
        out.append({
            'title': e['title'],
            'start': e['start'],
            'end': e.get('end'),
            'time': e.get('time'),
            'location': e.get('location'),
            'online': bool(e.get('online')),
            'organizer': e['organizer'],
            'url': e['url'],
            'source': 'curated',
            'category': e['category'],
            'checked': checked['date'],
        })
    return out


def upcoming(events: list[dict], today: date, horizon_days: int = HORIZON_DAYS) -> list[dict]:
    """Events not yet over and starting within the horizon, soonest first, once each."""
    first, last = today.isoformat(), (today + timedelta(days=horizon_days)).isoformat()
    seen, out = set(), []
    for e in sorted(events, key=lambda x: (x['start'], x.get('time') or '', x['title'])):
        if (e.get('end') or e['start']) < first or e['start'] > last:
            continue
        key = _key(e)
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out


def _key(e: dict) -> tuple:
    return (e['organizer'], re.sub(r'\W+', ' ', e['title'].lower()).strip(), e['start'])


def past(events: list[dict], previous: dict | None, today: date, past_days: int = PAST_DAYS) -> list[dict]:
    """Events that have ended within past_days, newest first, once each.

    `events` are what the sources list today; `previous` is yesterday's file,
    whose upcoming events that have since ended, and whose past list, carry
    forward. Today's listing wins over a carried-forward copy of one event.
    """
    first, today_iso = (today - timedelta(days=past_days)).isoformat(), today.isoformat()
    prev = previous if isinstance(previous, dict) else {}
    carried = [e for e in (prev.get('events') or []) + (prev.get('past') or [])
               if isinstance(e, dict) and e.get('title') and e.get('start') and e.get('organizer')]
    seen, out = set(), []
    for e in list(events) + carried:
        ended = e.get('end') or e['start']
        if ended >= today_iso or ended < first:
            continue
        k = _key(e)
        if k in seen:
            continue
        seen.add(k)
        out.append(e)
    return sorted(out, key=lambda x: (x.get('end') or x['start'], x['start'], x.get('time') or '', x['title']),
                  reverse=True)


def load_previous(path: Path = OUT_FILE) -> dict | None:
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def build(today: date, offline: bool = False, fetch=http_get, previous: dict | None = None) -> dict:
    events: list[dict] = []
    sources = []
    readers = [
        ('chfa', 'CHFA events and chfareach calendar', CHFA_PAGE, CHFA_FEED,
         lambda raw: parse_chfa(json.loads(raw))),
        ('housing_colorado', 'Housing Colorado upcoming events', HC_PAGE, HC_PAGE,
         lambda raw: parse_housing_colorado(raw.decode('utf-8', 'replace'))),
    ]
    for sid, name, page, url, parse in readers:
        entry = {'id': sid, 'name': name, 'url': page}
        if offline:
            entry.update(status='not_fetched', note='Offline run: this source was not read.')
        else:
            try:
                found = parse(fetch(url))
                events.extend(found)
                entry.update(status='ok', listed=len(found))
            except Exception as exc:  # network, HTTP or parse: the source contributes nothing
                entry.update(status='unreachable', note=f'{type(exc).__name__}: {str(exc)[:160]}')
        sources.append(entry)
    curated = load_curated()
    events.extend(curated)
    sources.append({'id': 'curated', 'name': 'Events checked by hand', 'url': None,
                    'status': 'ok', 'listed': len(curated)})
    shown = upcoming(events, today)
    ended = past(events, previous, today)
    for s in sources:
        s['upcoming'] = sum(1 for e in shown if e['source'] == s['id'])
    return {
        'meta': {
            'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'as_of': today.isoformat(),
            'horizon_days': HORIZON_DAYS,
            'past_days': PAST_DAYS,
            'categories': CATEGORIES,
            'method': ('Read daily from CHFA\'s calendar feed and Housing Colorado\'s events page, '
                       'plus events checked by hand in data/policy/housing-events-curated.json. '
                       'Ended events move to `past` and are kept for a year. A source that cannot be '
                       'read contributes nothing and is marked unreachable; its earlier upcoming '
                       'events are not kept.'),
        },
        'sources': sources,
        'events': shown,
        'past': ended,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--offline', action='store_true', help='skip the network; curated events only')
    ap.add_argument('--today', help='YYYY-MM-DD (tests)')
    args = ap.parse_args()
    today = date.fromisoformat(args.today) if args.today else datetime.now(timezone.utc).date()
    doc = build(today, offline=args.offline, previous=load_previous())
    OUT_FILE.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    for s in doc['sources']:
        print(f"  {s['id']:<17} {s['status']:<12} {s.get('upcoming', 0)} upcoming"
              + (f" — {s['note']}" if s.get('note') else ''))
    print(f'✓ {len(doc["events"])} upcoming and {len(doc["past"])} past events → {OUT_FILE.relative_to(ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
