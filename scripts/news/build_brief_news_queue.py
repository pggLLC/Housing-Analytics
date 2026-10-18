#!/usr/bin/env python3
"""
scripts/news/build_brief_news_queue.py

For each jurisdiction brief, the news that arrived since the brief was last
reviewed, and the upcoming events held there. Read by the brief page
(js/components/jurisdiction-brief.js) and by the review issue
(scripts/news/update-brief-review-issue.mjs).

Why: the briefs were last reviewed in June and July 2026, and nothing pointed
a reviewer at the briefs that had something new. The news pipeline already
tags every headline with the Colorado places it names
(generate_policy_briefs.py → data/policy_briefs.json `stories[].places`).
This joins those tags to the briefs.

What it does not do: write brief text. A headline and a Google News redirect
are not a source. A brief claim still needs the article itself and the
verbatim quote in data/jurisdiction-briefs/_verified/ (the June 2026
fabrication incident, docs/JURISDICTION-BRIEFS-HANDOFF.md). The queue tells a
reviewer which brief to open and why.

How a story leaves the queue: the brief is re-reviewed (`last_curated` moves
past the story's date), or the story is recorded in
data/jurisdiction-briefs/_news-used.json as `used` (it went into the brief) or
`dismissed` (with the reason). That ledger is how the queue learns.

Matching:
  - a story naming the brief's own geography matches as `place`;
  - for a county brief, a story naming a place in that county matches as
    `in_county`;
  - for a place brief, a story naming its county matches as `county`.
  - an event matches when its title or location names the jurisdiction.

Usage:
  python3 scripts/news/build_brief_news_queue.py [--today YYYY-MM-DD]
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BRIEFS_DIR = ROOT / 'data' / 'jurisdiction-briefs'
LEDGER_FILE = BRIEFS_DIR / '_news-used.json'
STORIES_FILE = ROOT / 'data' / 'policy_briefs.json'
EVENTS_FILE = ROOT / 'data' / 'policy' / 'housing-events.json'
GEO_CONFIG = ROOT / 'data' / 'hna' / 'geo-config.json'
OUT_FILE = ROOT / 'data' / 'alerts' / 'brief-news-queue.json'
CANDIDATES_SCRIPT = ROOT / 'scripts' / 'list-brief-candidates.py'

STALE_DAYS = 30
CANDIDATES_SHOWN = 20


def _load(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return default


def norm_title(t: str) -> str:
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]', ' ', (t or '').lower())).strip()


def short_name(jurisdiction: str) -> str:
    return re.sub(r'^(City and County|City|Town) of\s+', '', (jurisdiction or '').strip())


def load_briefs(briefs_dir: Path = BRIEFS_DIR) -> list[dict]:
    out = []
    for p in sorted(briefs_dir.glob('*.json')):
        if p.name.startswith('_'):
            continue
        b = json.loads(p.read_text(encoding='utf-8'))
        out.append({
            'geoid': b['geoid'],
            'jurisdiction': b['jurisdiction'],
            'scope': b.get('scope'),
            'county_fips': b.get('containing_county_fips'),
            'published': b.get('published') is True,
            'last_curated': b.get('last_curated'),
        })
    return out


def place_counties(geo_config: dict) -> dict[str, str]:
    out = {}
    for kind in ('places', 'cdps'):
        for p in geo_config.get(kind) or []:
            if p.get('geoid') and p.get('containingCounty'):
                out[p['geoid']] = p['containingCounty']
    return out


def ledger_keys(ledger: dict | None) -> dict[str, set]:
    """geoid → the links and normalized titles already handled for that brief."""
    keys: dict[str, set] = {}
    for e in (ledger or {}).get('entries') or []:
        if e.get('status') not in ('used', 'dismissed') or not e.get('geoid'):
            continue
        k = keys.setdefault(e['geoid'], set())
        if e.get('link'):
            k.add(e['link'])
        if e.get('title'):
            k.add('t:' + norm_title(e['title']))
    return keys


def unread_leads(ledger: dict | None) -> dict[str, list]:
    """geoid → stories a reviewer could not read (status "unread"). They stay queued whatever the
    brief's last review date, until someone reads them and marks them used or dismissed."""
    out: dict[str, list] = {}
    for e in (ledger or {}).get('entries') or []:
        if e.get('status') == 'unread' and e.get('geoid') and e.get('title'):
            out.setdefault(e['geoid'], []).append(e)
    return out


def match_story(brief: dict, story: dict, counties: dict[str, str]) -> str | None:
    for p in story.get('places') or []:
        g = p.get('geoid')
        if g == brief['geoid']:
            return 'place'
        if brief['scope'] == 'county' and counties.get(g) == brief['geoid']:
            return 'in_county'
    if brief['scope'] != 'county':
        for p in story.get('places') or []:
            if p.get('geoid') == brief['county_fips']:
                return 'county'
    return None


def event_names(brief: dict) -> list[str]:
    name = short_name(brief['jurisdiction'])
    return [name]


def match_event(brief: dict, event: dict) -> bool:
    hay = f"{event.get('title') or ''} | {event.get('location') or ''}"
    return any(re.search(r'(?<![\w-])' + re.escape(n) + r'(?![\w-])', hay) for n in event_names(brief))


def build(today: date, briefs: list[dict], stories: list[dict], events: list[dict],
          counties: dict[str, str], ledger: dict | None, candidates: list[dict] | None = None,
          events_meta: dict | None = None) -> dict:
    handled = ledger_keys(ledger)
    unread = unread_leads(ledger)
    rows = []
    for b in briefs:
        done = handled.get(b['geoid'], set())
        since = b['last_curated'] or '0000-00-00'
        found = []
        for s in stories:
            if not s.get('date') or s['date'] < since:
                continue
            if s.get('link') in done or 't:' + norm_title(s.get('title')) in done:
                continue
            m = match_story(b, s, counties)
            if m:
                found.append({'title': s['title'], 'source': s.get('source'), 'link': s.get('link'),
                              'date': s['date'], 'match': m,
                              'also': [a.get('source') for a in s.get('also') or [] if a.get('source')]})
        for e in unread.get(b['geoid'], []):
            note = e.get('reason') or 'Not read yet.'
            same = [x for x in found if (e.get('link') and x.get('link') == e['link'])
                    or norm_title(x['title']) == norm_title(e['title'])]
            for x in same:
                x['unread'] = note
            if same:
                continue
            found.append({'title': e['title'], 'source': e.get('source'), 'link': e.get('link'),
                          'date': e.get('date') or since, 'match': e.get('match') or 'place', 'also': [],
                          'unread': note})
        found.sort(key=lambda x: x['date'], reverse=True)
        found.sort(key=lambda x: x['match'] != 'place')
        evs = [{'title': e['title'], 'start': e['start'], 'end': e.get('end'), 'location': e.get('location'),
                'organizer': e.get('organizer'), 'url': e.get('url')}
               for e in events if (e.get('end') or e['start']) >= today.isoformat() and match_event(b, e)]
        try:
            days = (today - date.fromisoformat(b['last_curated'])).days
        except (TypeError, ValueError):
            days = None
        reasons = []
        fresh = [x for x in found if not (x.get('unread') and x['date'] < since)]
        own = sum(1 for x in fresh if x['match'] == 'place')
        if own:
            reasons.append(f'{own} new {"story" if own == 1 else "stories"} naming it')
        if len(fresh) > own:
            n = len(fresh) - own
            reasons.append(f'{n} new {"story" if n == 1 else "stories"} about its '
                           + ('towns' if b['scope'] == 'county' else 'county'))
        if len(found) > len(fresh):
            n = len(found) - len(fresh)
            reasons.append(f'{n} older {"story" if n == 1 else "stories"} not read yet')
        if days is None:
            reasons.append('no review date on file')
        elif days > STALE_DAYS:
            reasons.append(f'not reviewed in {days} days')
        if not b['published']:
            reasons.append('draft, not shown on the site')
        rows.append({**b, 'days_since_review': days, 'stories': found, 'events': evs, 'reasons': reasons})
    # Briefs with news naming them first, then any news, then the longest unreviewed.
    rows.sort(key=lambda r: (-sum(1 for x in r['stories'] if x['match'] == 'place'), -len(r['stories']),
                             -(r['days_since_review'] if r['days_since_review'] is not None else 10**6),
                             r['jurisdiction']))
    return {
        'meta': {
            'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'as_of': today.isoformat(),
            'stale_days': STALE_DAYS,
            'events_as_of': (events_meta or {}).get('as_of'),
            'method': ('Headlines from data/policy_briefs.json dated on or after each brief\'s last review '
                       '(last_curated), matched by the places the news pipeline tagged in them. Stories '
                       'recorded in data/jurisdiction-briefs/_news-used.json as used or dismissed are left out; '
                       'stories recorded there as unread stay in until someone reads them. '
                       'Headlines are leads for a reviewer, not sources: a brief claim still needs the article '
                       'and its quote in _verified/.'),
        },
        'briefs': rows,
        'candidates': (candidates or [])[:CANDIDATES_SHOWN],
        'candidate_count': len(candidates or []),
    }


def load_candidates() -> list[dict]:
    spec = importlib.util.spec_from_file_location('list_brief_candidates', CANDIDATES_SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    for fn in ('find_candidates', 'candidates', 'list_candidates'):
        if hasattr(mod, fn):
            return getattr(mod, fn)()
    raise AttributeError('list-brief-candidates.py has no candidate function')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--today', help='YYYY-MM-DD (tests)')
    args = ap.parse_args()
    today = date.fromisoformat(args.today) if args.today else datetime.now(timezone.utc).date()
    stories = (_load(STORIES_FILE, {}) or {}).get('stories') or []
    events_doc = _load(EVENTS_FILE, {}) or {}
    doc = build(today, load_briefs(), stories, events_doc.get('events') or [],
                place_counties(_load(GEO_CONFIG, {}) or {}), _load(LEDGER_FILE, {}),
                load_candidates(), events_doc.get('meta'))
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    waiting = [r for r in doc['briefs'] if r['stories']]
    print(f'✓ {len(doc["briefs"])} briefs, {len(waiting)} with news since their last review → '
          f'{OUT_FILE.relative_to(ROOT)}')
    for r in waiting:
        print(f'  {r["jurisdiction"]:<28} {len(r["stories"])} stories, {len(r["events"])} events')
    return 0


if __name__ == '__main__':
    sys.exit(main())
