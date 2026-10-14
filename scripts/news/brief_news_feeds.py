#!/usr/bin/env python3
"""
scripts/news/brief_news_feeds.py

One Google News search per jurisdiction that has a brief, printed as feed
lines for scripts/alert_feeds.txt.

The statewide searches in weekly_housing_brief.yml find Denver and Colorado
Springs every week and the brief towns almost never: on 2026-10-14, 4 of the 18
brief jurisdictions had appeared in 90 days of headlines (Denver 7, Colorado
Springs 7, Aspen 2, Crested Butte 2). A search named for each one is what lets
the brief news queue (build_brief_news_queue.py) find Carbondale, Silt or
Rifle at all. The list follows data/jurisdiction-briefs/, so a new brief gets
its search on the next run.

Other-state results ("Aspen Hill, MD") are dropped later by the same Colorado
check every headline goes through in generate_policy_briefs.py.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BRIEFS = ROOT / 'data' / 'jurisdiction-briefs'
GOOGLE_NEWS = 'https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en'


def search_name(jurisdiction: str) -> str:
    """'City of Fort Collins' → 'Fort Collins'; 'Garfield County' stays."""
    return re.sub(r'^(City and County|City|Town) of\s+', '', jurisdiction.strip())


def brief_names(briefs_dir: Path = BRIEFS) -> list[str]:
    names = []
    for p in sorted(briefs_dir.glob('*.json')):
        if p.name.startswith('_'):
            continue
        name = search_name(json.loads(p.read_text(encoding='utf-8')).get('jurisdiction', ''))
        if name and name not in names:
            names.append(name)
    return names


def feed_url(name: str) -> str:
    return GOOGLE_NEWS.format(q=urllib.parse.quote_plus(f'"{name}" colorado housing'))


def main() -> int:
    names = brief_names()
    print(f'# ── One search per brief jurisdiction ({len(names)}), from data/jurisdiction-briefs/ ──')
    for name in names:
        print(feed_url(name))
    return 0


if __name__ == '__main__':
    sys.exit(main())
