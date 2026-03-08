#!/usr/bin/env python3
"""
fetch_google_alerts.py — Fetch housing news from RSS feeds and archive to alerts_archive.json.

Reads RSS feed URLs (one per line) from ALERT_FEEDS_FILE or the ALERT_FEEDS environment
variable (comma-separated), fetches each feed, and appends new items to
data/alerts/alerts_archive.json.

Usage:
    python3 scripts/fetch_google_alerts.py

Environment variables:
    ALERT_FEEDS       — comma-separated list of RSS feed URLs (overrides feed file)
    ALERT_FEEDS_FILE  — path to newline-delimited file of RSS feed URLs
                        (default: scripts/alert_feeds.txt)
    ALERTS_MAX_AGE_DAYS — maximum age of alerts to keep in archive (default: 90)

Output:
    data/alerts/alerts_archive.json
"""

import email.utils
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_FILE = REPO_ROOT / 'data' / 'alerts' / 'alerts_archive.json'
DEFAULT_FEEDS_FILE = Path(__file__).parent / 'alert_feeds.txt'
TIMEOUT = 20
MAX_AGE_DAYS = int(os.environ.get('ALERTS_MAX_AGE_DAYS', '90'))

# Default topic keyword map — used to auto-tag items
TOPIC_KEYWORDS: dict[str, list[str]] = {
    'affordable_housing': ['affordable housing', 'low-income housing', 'lihtc', 'tax credit', 'hud'],
    'rent': ['rent', 'rental', 'eviction', 'tenant', 'landlord'],
    'homelessness': ['homeless', 'unsheltered', 'shelter'],
    'zoning': ['zoning', 'rezoning', 'land use', 'upzone', 'density'],
    'market': ['housing market', 'home prices', 'median price', 'mortgage rates'],
    'policy': ['housing bill', 'legislation', 'ordinance', 'proposition 123'],
    'construction': ['construction', 'permits', 'housing starts', 'development'],
}

# Colorado geography keywords for region tagging
REGION_KEYWORDS: dict[str, list[str]] = {
    'Denver': ['denver'],
    'Colorado Springs': ['colorado springs'],
    'Boulder': ['boulder'],
    'Fort Collins': ['fort collins'],
    'Pueblo': ['pueblo'],
    'Grand Junction': ['grand junction'],
    'Aurora': ['aurora, co', 'aurora, colorado'],
    'Statewide': ['colorado', 'co '],
}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_rss_date(date_str: str | None) -> str | None:
    """Parse an RFC 2822 date string to ISO-8601 UTC."""
    if not date_str:
        return None
    try:
        parsed = email.utils.parsedate_to_datetime(date_str)
        return parsed.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
    except Exception:
        return date_str


def strip_html(text: str) -> str:
    """Remove HTML tags and decode entities."""
    text = re.sub(r'<[^>]+>', ' ', text or '')
    return html.unescape(text).strip()


def detect_topic(text: str) -> str:
    text_lower = text.lower()
    for topic, keywords in TOPIC_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            return topic
    return 'general'


def detect_region(text: str) -> str:
    text_lower = text.lower()
    for region, keywords in REGION_KEYWORDS.items():
        if any(kw in text_lower for kw in keywords):
            return region
    return 'Colorado'


def http_get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'HousingAnalytics/1.0'})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read()


def parse_feed(url: str) -> list[dict]:
    """Parse an RSS/Atom feed and return a list of alert items."""
    try:
        raw = http_get(url)
    except Exception as exc:
        print(f'  ⚠ Could not fetch {url}: {exc}', file=sys.stderr)
        return []

    items = []
    try:
        root = ET.fromstring(raw)
        ns = {'atom': 'http://www.w3.org/2005/Atom'}

        # Detect RSS vs Atom
        if root.tag == 'rss' or root.tag.endswith('}rss'):
            # RSS 2.0
            for item in root.iter('item'):
                title = strip_html(item.findtext('title', ''))
                link = item.findtext('link', '').strip()
                desc = strip_html(item.findtext('description', ''))
                pub_date = parse_rss_date(item.findtext('pubDate'))
                source = item.findtext('source', '') or urllib.parse.urlparse(url).netloc
                full_text = f'{title} {desc}'
                items.append({
                    'title': title,
                    'date': pub_date,
                    'source': strip_html(source) or url,
                    'url': link,
                    'topic': detect_topic(full_text),
                    'region': detect_region(full_text),
                    'summary': desc[:300] if desc else '',
                })
        else:
            # Atom
            for entry in root.iter('{http://www.w3.org/2005/Atom}entry'):
                title = strip_html(entry.findtext('{http://www.w3.org/2005/Atom}title', ''))
                link_el = entry.find('{http://www.w3.org/2005/Atom}link')
                link = link_el.get('href', '') if link_el is not None else ''
                summary_el = entry.find('{http://www.w3.org/2005/Atom}summary')
                desc = strip_html(summary_el.text if summary_el is not None else '')
                pub_date = parse_rss_date(entry.findtext('{http://www.w3.org/2005/Atom}updated') or
                                          entry.findtext('{http://www.w3.org/2005/Atom}published'))
                full_text = f'{title} {desc}'
                items.append({
                    'title': title,
                    'date': pub_date,
                    'source': url,
                    'url': link,
                    'topic': detect_topic(full_text),
                    'region': detect_region(full_text),
                    'summary': desc[:300] if desc else '',
                })
    except Exception as exc:
        print(f'  ⚠ Could not parse feed {url}: {exc}', file=sys.stderr)

    return items


def load_archive() -> list[dict]:
    if OUT_FILE.exists():
        try:
            with open(OUT_FILE, encoding='utf-8') as f:
                data = json.load(f)
            return data.get('alerts', [])
        except Exception:
            pass
    return []


def main() -> int:
    # Determine feed list
    feeds_env = os.environ.get('ALERT_FEEDS', '').strip()
    feeds_file = os.environ.get('ALERT_FEEDS_FILE', str(DEFAULT_FEEDS_FILE))

    if feeds_env:
        feeds = [f.strip() for f in feeds_env.split(',') if f.strip()]
    elif Path(feeds_file).exists():
        feeds = [line.strip() for line in Path(feeds_file).read_text().splitlines()
                 if line.strip() and not line.startswith('#')]
    else:
        print('ℹ No feeds configured. Create scripts/alert_feeds.txt or set ALERT_FEEDS env var.', file=sys.stderr)
        feeds = []

    print(f'Fetching {len(feeds)} RSS feed(s)…')
    existing = load_archive()
    existing_urls = {a.get('url') for a in existing if a.get('url')}

    new_items = []
    for feed_url in feeds:
        print(f'  Fetching: {feed_url}')
        items = parse_feed(feed_url)
        for item in items:
            if item.get('url') and item['url'] not in existing_urls:
                new_items.append(item)
                existing_urls.add(item['url'])
    print(f'  Found {len(new_items)} new item(s)')

    # Merge and prune by age
    cutoff = (datetime.now(timezone.utc) - timedelta(days=MAX_AGE_DAYS)).strftime('%Y-%m-%dT%H:%M:%SZ')
    all_alerts = new_items + existing
    all_alerts = [a for a in all_alerts if not a.get('date') or a['date'] >= cutoff]

    # Sort by date descending
    all_alerts.sort(key=lambda a: a.get('date') or '', reverse=True)

    output = {
        'meta': {
            'generated': utc_now(),
            'feed_count': len(feeds),
            'alert_count': len(all_alerts),
            'max_age_days': MAX_AGE_DAYS,
        },
        'alerts': all_alerts,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2)

    print(f'✓ Archive has {len(all_alerts)} alerts → {OUT_FILE}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
