#!/usr/bin/env python3
"""
scripts/news/outlet_review.py

The "Outlets to review" issue: every Housing News publisher the outlet register
(data/alerts/outlet-register.json, scripts/news/outlets.py) has not checked.

paul, 2026-10-31: "Show unverified tab, and create weekly review. review those
unverified tabs every news run." So on every news run:

  --apply        (before the stories are built) reads the boxes ticked in the
                 issue and records them in data/alerts/outlet-decisions.json, so
                 an outlet ticked today is tagged correctly in today's run.
  (no flag)      (after the stories are built) lists the unverified outlets on
                 the page in data/alerts/outlet-review.json: stories, dates,
                 latest headlines, the address the feed gave.
  --sync-issue   (after the push, main only) rewrites the issue from that list
                 and, once a week, adds a comment with the week's sourcing so
                 the review is a weekly ask, not a silent list.

Each outlet gets three boxes: Checked outlet, Weak sourcing, Block. The most
severe ticked box wins. Only the issue this workflow opened counts, so nobody
can tick their way into the register from an issue of their own (the same rule
as "News picks to review", owner_news_picks.py).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import outlets  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
STORIES_FILE = ROOT / 'data' / 'policy_briefs.json'
REVIEW_FILE = ROOT / 'data' / 'alerts' / 'outlet-review.json'
DECISIONS_FILE = outlets.DECISIONS_FILE

LABEL = 'outlet-review'
TITLE = 'Outlets to review'
MARKER = '<!-- outlet-review -->'
WEEKLY_MARKER = '<!-- outlet-review-weekly -->'
BOT_LOGIN = 'github-actions[bot]'
DECISIONS = ('checked', 'weak', 'blocked')  # least to most severe
BOX_LABELS = {'checked': 'Checked outlet', 'weak': 'Weak sourcing', 'blocked': 'Block'}
SHOWN_SCOPES = ('colorado', 'federal', 'national')
TIMEOUT = 20
WEEKLY_GAP = timedelta(days=6, hours=12)


def outlet_id(name: str) -> str:
    return hashlib.sha1(outlets.norm_name(name).encode()).hexdigest()[:10]


def read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return default


# ── The list ─────────────────────────────────────────────────────────────────

def week_sourcing(stories: list[dict], today: date) -> dict:
    """Stories dated in the last seven days, by outlet check."""
    since = (today - timedelta(days=6)).isoformat()
    out = {'since': since, 'checked': 0, 'unverified': 0, 'weak': 0}
    for s in stories:
        if s.get('scope') in SHOWN_SCOPES and (s.get('date') or '') >= since:
            k = s.get('sourcing') or 'checked'
            if k in out:
                out[k] += 1
    return out


def build_review(stories: list[dict], previous: dict | None, today: date) -> dict:
    listed_before = {o['id']: o.get('first_listed') for o in (previous or {}).get('outlets', [])}
    by_id: dict[str, dict] = {}
    for s in stories:
        if s.get('scope') not in SHOWN_SCOPES or s.get('sourcing') != 'unverified':
            continue
        name = (s.get('source') or '').strip().strip('|-–— ').strip() or 'Unknown publisher'
        oid = outlet_id(name)
        o = by_id.setdefault(oid, {'id': oid, 'name': name, 'domains': [], 'stories': 0,
                                   'first_seen': s.get('date') or '', 'last_seen': s.get('date') or '',
                                   'headlines': []})
        o['stories'] += 1
        if s.get('source_domain') and s['source_domain'] not in o['domains']:
            o['domains'].append(s['source_domain'])
        d = s.get('date') or ''
        if d and (not o['first_seen'] or d < o['first_seen']):
            o['first_seen'] = d
        if d > o['last_seen']:
            o['last_seen'] = d
        o['headlines'].append({'title': s.get('title', ''), 'link': s.get('link', ''), 'date': d})
    items = []
    for o in by_id.values():
        o['headlines'] = sorted(o['headlines'], key=lambda h: h['date'], reverse=True)[:3]
        o['first_listed'] = listed_before.get(o['id']) or today.isoformat()
        items.append(o)
    items.sort(key=lambda o: (o['last_seen'], o['stories']), reverse=True)
    return {
        'meta': {
            'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'method': ('Housing News publishers not in data/alerts/outlet-register.json. Their stories show with an '
                       f'"Unverified outlet" tag until the outlet is ticked in the "{TITLE}" issue.'),
            'week': week_sourcing(stories, today),
        },
        'outlets': items,
    }


# ── Ticks ────────────────────────────────────────────────────────────────────

def ticked(body: str) -> dict[str, str]:
    """outlet id → the most severe decision ticked for it."""
    out: dict[str, str] = {}
    for oid, dec in re.findall(r'^- \[[xX]\] .*<!-- outlet:([0-9a-f]{10}):(checked|weak|blocked) -->', body or '', re.M):
        if oid not in out or DECISIONS.index(dec) > DECISIONS.index(out[oid]):
            out[oid] = dec
    return out


def apply_ticks(decisions: list[dict], ticks: dict[str, str], review: dict, issue: int | None,
                today: date) -> tuple[list[dict], int]:
    names = {o['id']: o for o in review.get('outlets', [])}
    by_id = {d['id']: d for d in decisions}
    changed = 0
    for oid, dec in ticks.items():
        o = names.get(oid)
        if not o:
            continue
        cur = by_id.get(oid)
        if cur and cur.get('decision') == dec:
            continue
        by_id[oid] = {'id': oid, 'name': o['name'], 'domains': o.get('domains', []), 'decision': dec,
                      'decided': today.isoformat(), **({'issue': issue} if issue else {})}
        changed += 1
    return sorted(by_id.values(), key=lambda d: d['name'].lower()), changed


# ── The issue ────────────────────────────────────────────────────────────────

def issue_body(review: dict, keep: dict[str, str] | None = None) -> str:
    keep = keep or {}
    week = review.get('meta', {}).get('week', {})
    lines = [MARKER, '',
             ('Housing News publishers COHO has not checked yet. Their stories are on the page with an '
              '**Unverified outlet** tag. For each outlet, tick one box and the next news run applies it:'), '',
             '- **Checked outlet**: a real newsroom, trade publication, research center or government source. The tag comes off.',
             '- **Weak sourcing**: real but weak (marketing, press releases, partisan, AI-written). Stories show a "Weak sourcing" tag.',
             '- **Block**: an imposter or fake local-news site. Its stories leave the page.', '',
             ('Before ticking, open the outlet\'s About page: is there a named editor and staff, a street address, '
              'and a stated owner? A site with none of these, or one that belongs to a political group, is not a newsroom.'), '']
    if week:
        lines += [(f"This week on Housing News (since {week.get('since', '')}): {week.get('checked', 0)} stories from "
                   f"checked outlets, {week.get('unverified', 0)} unverified, {week.get('weak', 0)} weak sourcing."), '']
    items = review.get('outlets', [])
    if not items:
        lines.append('Nothing to review right now.')
    for o in items:
        where = f" ({', '.join(o['domains'])})" if o.get('domains') else ''
        plural = 's' if o['stories'] != 1 else ''
        lines.append(f"**{o['name']}**{where}: {o['stories']} stor{'ies' if plural else 'y'}, "
                     f"{o['first_seen'] or 'undated'} to {o['last_seen'] or 'undated'}; listed {o['first_listed']}")
        for h in o['headlines']:
            t = (h['title'] or '').replace('[', '(').replace(']', ')')
            lines.append(f"  - [{t}]({h['link']}) {h['date']}" if h.get('link') else f"  - {t} {h['date']}")
        for dec in DECISIONS:
            box = 'x' if keep.get(o['id']) == dec else ' '
            lines.append(f"- [{box}] {BOX_LABELS[dec]} <!-- outlet:{o['id']}:{dec} -->")
        lines.append('')
    return '\n'.join(lines).rstrip() + '\n'


def weekly_comment(review: dict, today: date) -> str:
    week = review.get('meta', {}).get('week', {})
    items = review.get('outlets', [])
    new = sum(1 for o in items if (o.get('first_listed') or '') >= (today - timedelta(days=6)).isoformat())
    return (f"{WEEKLY_MARKER}\n**Weekly outlet review, {today.isoformat()}.** {len(items)} outlet"
            f"{'s' if len(items) != 1 else ''} to review ({new} new this week). "
            f"Housing News this week: {week.get('checked', 0)} stories from checked outlets, "
            f"{week.get('unverified', 0)} unverified, {week.get('weak', 0)} weak sourcing. "
            'Tick a box for each outlet in the list above.')


def gh(token: str, path: str, method: str = 'GET', body: dict | None = None):
    req = urllib.request.Request(
        f'https://api.github.com{path}', method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read() or b'null')


def find_issue(token: str, repo: str) -> dict | None:
    for it in gh(token, f'/repos/{repo}/issues?state=open&labels={LABEL}&per_page=100') or []:
        if MARKER in (it.get('body') or '') and (it.get('user') or {}).get('login') == BOT_LOGIN:
            return it
    return None


def needs_weekly(comments: list[dict], now: datetime) -> bool:
    for c in comments:
        if WEEKLY_MARKER in (c.get('body') or '') and (c.get('user') or {}).get('login') == BOT_LOGIN:
            try:
                at = datetime.strptime(c['created_at'], '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
            except (KeyError, ValueError):
                continue
            if now - at < WEEKLY_GAP:
                return False
    return True


def sync_issue(token: str, repo: str, today: date) -> int:
    review = read_json(REVIEW_FILE, {'outlets': []})
    try:
        gh(token, f'/repos/{repo}/labels', 'POST', {'name': LABEL, 'color': 'b60205'})
    except urllib.error.HTTPError as exc:
        if exc.code != 422:  # 422: it already exists
            raise
    issue = find_issue(token, repo)
    # A box ticked while this run was going stays ticked for the next run.
    body = issue_body(review, ticked(issue['body']) if issue else {})
    if issue:
        if issue['body'] != body:
            gh(token, f'/repos/{repo}/issues/{issue["number"]}', 'PATCH', {'body': body})
    else:
        issue = gh(token, f'/repos/{repo}/issues', 'POST', {'title': TITLE, 'body': body, 'labels': [LABEL]})
    # Only comments since the de-duplication cutoff: the list is oldest first,
    # so a long-lived issue's first page would miss last week's comment
    # (Codex review of #2607).
    now = datetime.now(timezone.utc)
    since = (now - WEEKLY_GAP).strftime('%Y-%m-%dT%H:%M:%SZ')
    comments: list[dict] = []
    for page in range(1, 6):
        batch = gh(token, f'/repos/{repo}/issues/{issue["number"]}/comments?since={since}&per_page=100&page={page}') or []
        comments += batch
        if len(batch) < 100:
            break
    if needs_weekly(comments, now):
        gh(token, f'/repos/{repo}/issues/{issue["number"]}/comments', 'POST', {'body': weekly_comment(review, today)})
    return 0


def main() -> int:
    today = datetime.now(timezone.utc).date()
    token = os.environ.get('GITHUB_TOKEN', '')
    repo = os.environ.get('GITHUB_REPOSITORY', 'pggLLC/Housing-Analytics')
    args = sys.argv[1:]
    if '--sync-issue' in args:
        if not token:
            print('✗ --sync-issue needs GITHUB_TOKEN', file=sys.stderr)
            return 1
        return sync_issue(token, repo, today)
    if '--apply' in args:
        if not token:
            print('ℹ No GITHUB_TOKEN: outlet ticks not read.')
            return 0
        # A GitHub hiccup must not hold back the day's news.
        try:
            issue = find_issue(token, repo)
        except Exception as exc:  # noqa: BLE001
            print(f'  ⚠ Could not read the outlet review issue: {exc}', file=sys.stderr)
            return 0
        if not issue:
            return 0
        data = read_json(DECISIONS_FILE, {'decisions': []})
        decisions, changed = apply_ticks(data.get('decisions', []), ticked(issue['body']),
                                         read_json(REVIEW_FILE, {'outlets': []}), issue['number'], today)
        DECISIONS_FILE.write_text(json.dumps({
            'meta': {'updated': today.isoformat(),
                     'method': f'Outlets ticked in the "{TITLE}" issue. They override data/alerts/outlet-register.json.'},
            'decisions': decisions}, indent=2, ensure_ascii=False) + '\n')
        print(f'✓ {changed} outlet decision(s) recorded → {DECISIONS_FILE.relative_to(ROOT)}')
        return 0
    stories = (read_json(STORIES_FILE, {}) or {}).get('stories', [])
    review = build_review(stories, read_json(REVIEW_FILE, None), today)
    REVIEW_FILE.write_text(json.dumps(review, indent=2, ensure_ascii=False) + '\n')
    w = review['meta']['week']
    print(f"✓ {len(review['outlets'])} outlet(s) to review; this week {w['checked']} checked, "
          f"{w['unverified']} unverified, {w['weak']} weak → {REVIEW_FILE.relative_to(ROOT)}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
