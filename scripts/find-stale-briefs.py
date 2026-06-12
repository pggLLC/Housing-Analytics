#!/usr/bin/env python3
"""
scripts/find-stale-briefs.py

Lists jurisdictional housing-history briefs whose `last_curated` date is
older than a threshold — the source of truth for the monthly stale-
refresh cron.

Default threshold: 30 days. Configurable via --days N.

Output:
  - JSON to stdout: list of {geoid, jurisdiction, last_curated, days_old}
    sorted by days_old descending (most stale first).
  - Optionally writes data/jurisdiction-briefs/_stale.json with --write.

Usage:
  python3 scripts/find-stale-briefs.py
  python3 scripts/find-stale-briefs.py --days 60
  python3 scripts/find-stale-briefs.py --write
  python3 scripts/find-stale-briefs.py --as-of 2026-12-15  # for tests
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

ROOT   = Path(__file__).resolve().parent.parent
BRIEFS = ROOT / "data" / "jurisdiction-briefs"

DEFAULT_DAYS = 30


def _parse_date(s):
    # type: (str) -> Optional[date]
    try:
        return date.fromisoformat(s)
    except Exception:
        return None


def main():
    args = sys.argv[1:]
    write = "--write" in args
    days = DEFAULT_DAYS
    if "--days" in args:
        idx = args.index("--days")
        try:
            days = int(args[idx + 1])
        except (IndexError, ValueError):
            print("--days requires an integer argument", file=sys.stderr)
            return 2

    today = date.today()
    if "--as-of" in args:
        idx = args.index("--as-of")
        try:
            today = date.fromisoformat(args[idx + 1])
        except (IndexError, ValueError):
            print("--as-of requires YYYY-MM-DD", file=sys.stderr)
            return 2

    threshold = today - timedelta(days=days)
    out = []

    if not BRIEFS.exists():
        print(json.dumps(out, indent=2))
        return 0

    for p in sorted(BRIEFS.glob("*.json")):
        if p.name.startswith("_"):
            continue
        try:
            brief = json.loads(p.read_text())
        except Exception:
            continue
        last = _parse_date(brief.get("last_curated") or "")
        if last is None:
            # Unverified curation date — treat as stale.
            out.append({
                "geoid": brief.get("geoid", p.stem),
                "jurisdiction": brief.get("jurisdiction", ""),
                "last_curated": brief.get("last_curated"),
                "days_old": None,
                "reason": "missing or unparseable last_curated",
            })
            continue
        if last <= threshold:
            out.append({
                "geoid": brief.get("geoid", p.stem),
                "jurisdiction": brief.get("jurisdiction", ""),
                "last_curated": brief.get("last_curated"),
                "days_old": (today - last).days,
                "reason": f"older than {days} days",
            })

    out.sort(key=lambda x: (x.get("days_old") or 10**6), reverse=True)

    if write:
        BRIEFS.mkdir(parents=True, exist_ok=True)
        (BRIEFS / "_stale.json").write_text(
            json.dumps({"generated": today.isoformat(),
                        "threshold_days": days,
                        "stale": out}, indent=2)
        )
        print(f"[stale] wrote {len(out)} to {BRIEFS / '_stale.json'}", file=sys.stderr)
    else:
        print(json.dumps(out, indent=2))
    print(f"[stale] {len(out)} brief(s) older than {days} days",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
