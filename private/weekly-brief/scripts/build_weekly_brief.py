#!/usr/bin/env python3
"""
build_weekly_brief.py — Weekly updater for the Housing Intelligence Brief.
Fetches current-week articles from RSS feeds defined in feeds.json,
builds the payload, and writes all output files.

Run:
  python private/weekly-brief/scripts/build_weekly_brief.py
"""
import json
import sys
from pathlib import Path

# Allow importing common from same scripts directory
sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (
    BRIEF_ROOT,
    DATA_DIR,
    current_week_start,
    build_payload,
    fetch_url,
    iso,
    parse_rss,
    update_archive_index,
    update_signals_history,
    write_archive_html,
    write_json,
)


def load_feeds() -> list[dict]:
    feeds_path = BRIEF_ROOT / "feeds.json"
    try:
        data = json.loads(feeds_path.read_text(encoding="utf-8"))
        return data.get("rss_feeds", [])
    except Exception as exc:
        print(f"[ERROR] Could not load feeds.json: {exc}")
        return []


def fetch_all_articles(feeds: list[dict], week_start_str: str) -> list[dict]:
    seen: set[str] = set()
    all_articles: list[dict] = []

    for feed in feeds:
        feed_id = feed.get("id", "unknown")
        label = feed.get("label", feed_id)
        url = feed.get("url", "")
        region_hint = feed.get("region_hint", "National")

        if not url:
            print(f"  [SKIP] Feed '{label}' has no URL.")
            continue

        print(f"  Fetching [{label}] …")
        data = fetch_url(url)
        if not data:
            print(f"  [WARN] No data from feed '{label}', skipping.")
            continue

        articles = parse_rss(data, region_hint, week_start_str, seen)
        print(f"    → {len(articles)} new articles")
        all_articles.extend(articles)

    return all_articles


def main() -> None:
    week_start = current_week_start()
    week_str = iso(week_start)
    print(f"=== Building Weekly Brief for week of {week_str} ===")

    feeds = load_feeds()
    if not feeds:
        print("[ERROR] No feeds found. Aborting.")
        sys.exit(1)

    print(f"Loaded {len(feeds)} feeds.")
    articles = fetch_all_articles(feeds, week_str)
    print(f"Total articles collected: {len(articles)}")

    payload = build_payload(week_start, articles)

    # Write latest.json
    write_json(DATA_DIR / "latest.json", payload)

    # Write archive JSON
    write_json(DATA_DIR / "archive" / f"{week_str}.json", payload)

    # Write archive HTML
    write_archive_html(payload)

    # Update archive index
    update_archive_index(payload)

    # Update signals history
    update_signals_history(payload)

    print("=== Done ===")


if __name__ == "__main__":
    main()
