#!/usr/bin/env python3
"""
backfill_gdelt.py — Historic backfill using the GDELT 2.1 DOC API.

This script generates approximate weekly briefs for past weeks using GDELT
article data. Results are best-effort reconstructions — GDELT coverage varies
by outlet, language, and time period. Do not rely on these as exact records.

Usage:
  python private/weekly-brief/scripts/backfill_gdelt.py
  python private/weekly-brief/scripts/backfill_gdelt.py --weeks 52 --maxrecords 50

Arguments:
  --weeks      Number of past weeks to backfill (default: 156, ~3 years)
  --maxrecords Max articles per GDELT query (default: 75)
  --force      Overwrite existing archive files (default: skip existing)
"""
import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import (
    BRIEF_ROOT,
    DATA_DIR,
    ARCHIVE_DATA_DIR,
    article_hash,
    build_payload,
    classify_region,
    current_week_start,
    fetch_gdelt_articles,
    iso,
    timedelta,
    update_archive_index,
    update_signals_history,
    week_start_for,
    write_archive_html,
    write_json,
)


def load_gdelt_queries() -> dict[str, list[str]]:
    feeds_path = BRIEF_ROOT / "feeds.json"
    try:
        data = json.loads(feeds_path.read_text(encoding="utf-8"))
        return data.get("gdelt_queries", {})
    except Exception as exc:
        print(f"[ERROR] Could not load feeds.json: {exc}")
        return {}


def collect_gdelt_week(
    week_start,
    queries: dict[str, list[str]],
    maxrecords: int,
) -> list[dict]:
    """Fetch GDELT articles for all region/topic queries for one week."""
    from datetime import datetime as _dt

    week_end = week_start + timedelta(days=6)
    start_dt = _dt(week_start.year, week_start.month, week_start.day, 0, 0, 0)
    end_dt = _dt(week_end.year, week_end.month, week_end.day, 23, 59, 59)

    seen: set[str] = set()
    all_articles: list[dict] = []
    week_str = iso(week_start)

    for region_hint, q_list in queries.items():
        for query in q_list:
            print(f"    GDELT [{region_hint}] {query[:60]}…")
            try:
                arts = fetch_gdelt_articles(query, start_dt, end_dt, maxrecords)
            except Exception as exc:
                print(f"      [WARN] GDELT query failed: {exc}")
                arts = []

            added = 0
            for art in arts:
                h = article_hash(art.get("title", ""), art.get("link", ""), week_str)
                if h in seen:
                    continue
                seen.add(h)
                combined = (art.get("title", "") + " " + art.get("source", "")).lower()
                region = classify_region(combined)
                if region_hint in ("Western Slope", "Colorado") and region == "National":
                    region = region_hint
                art["region"] = region
                all_articles.append(art)
                added += 1

            print(f"      → {added} new articles")
            time.sleep(0.5)  # polite rate limiting

    return all_articles


def main() -> None:
    parser = argparse.ArgumentParser(description="GDELT historic backfill for weekly briefs")
    parser.add_argument("--weeks", type=int, default=156, help="Weeks to backfill (default: 156)")
    parser.add_argument("--maxrecords", type=int, default=75, help="Max GDELT records per query (default: 75)")
    parser.add_argument("--force", action="store_true", help="Overwrite existing archive files")
    args = parser.parse_args()

    queries = load_gdelt_queries()
    if not queries:
        print("[ERROR] No GDELT queries found in feeds.json. Aborting.")
        sys.exit(1)

    today = current_week_start()
    latest_json_path = DATA_DIR / "latest.json"

    print(f"=== GDELT Historic Backfill: {args.weeks} weeks, maxrecords={args.maxrecords} ===")
    print("NOTE: GDELT backfill is approximate historic reconstruction.")
    print("      Coverage varies by outlet and time period.\n")

    for i in range(1, args.weeks + 1):
        week_start = today - timedelta(weeks=i)
        week_str = iso(week_start)

        archive_json = DATA_DIR / "archive" / f"{week_str}.json"
        if archive_json.exists() and not args.force:
            print(f"[SKIP] {week_str} — already exists (use --force to overwrite)")
            continue

        print(f"\n--- Week {i}/{args.weeks}: {week_str} ---")
        articles = collect_gdelt_week(week_start, queries, args.maxrecords)
        print(f"  Total articles: {len(articles)}")

        payload = build_payload(week_start, articles)

        # Write archive JSON
        write_json(archive_json, payload)

        # Write archive HTML
        write_archive_html(payload)

        # Update indexes
        update_archive_index(payload)
        update_signals_history(payload)

        # Update latest.json only if this is the most recent week
        if i == 1:
            if not latest_json_path.exists():
                write_json(latest_json_path, payload)
                print(f"  Wrote initial latest.json for {week_str}")
            else:
                try:
                    existing = json.loads(latest_json_path.read_text(encoding="utf-8"))
                    if existing.get("week_start", "") < week_str:
                        write_json(latest_json_path, payload)
                        print(f"  Updated latest.json to {week_str}")
                except Exception:
                    write_json(latest_json_path, payload)

        time.sleep(1)  # polite pause between weeks

    print("\n=== Backfill complete ===")


if __name__ == "__main__":
    main()
