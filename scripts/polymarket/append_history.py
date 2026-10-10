#!/usr/bin/env python3
"""Append today's Polymarket odds to data/polymarket-history.json.

data/polymarket-data.json is overwritten on every fetch, so without this file
the site keeps no record of how the odds moved. Testing whether market
expectations (recession, Fed path) lead LIHTC equity pricing needs that
record, and Polymarket contracts expire every few months, so the history has
to be kept as it happens.

One row per UTC date. Each row maps an event slug to its outcomes' "Yes"
prices. Only events fetched fresh this run are recorded: an event carried
forward with `stale_since` holds an old price, and recording it again would
make a stale price look like a new observation. A price that does not parse
is left out, never written as 0. Re-running on the same date replaces that
date's row, so a manual dispatch after the cron does not duplicate it.

Usage: python3 scripts/polymarket/append_history.py [data-path] [history-path]
"""
import json
import sys
from pathlib import Path

DATA = Path(sys.argv[1] if len(sys.argv) > 1 else "data/polymarket-data.json")
HISTORY = Path(sys.argv[2] if len(sys.argv) > 2 else "data/polymarket-history.json")


def yes_prices(event):
    out = {}
    for market in event.get("markets") or []:
        try:
            prices = json.loads(market.get("outcomePrices") or "[]")
            outcomes = json.loads(market.get("outcomes") or "[]")
        except (TypeError, ValueError):
            continue
        idx = outcomes.index("Yes") if "Yes" in outcomes else 0
        try:
            p = float(prices[idx])
        except (IndexError, TypeError, ValueError):
            continue
        if 0 <= p <= 1:
            out[market.get("question") or "?"] = round(p, 4)
    return out


def dump(history):
    """Meta indented for reading; one row per line so a year stays small and diffs stay one line a day."""
    head = json.dumps({k: v for k, v in history.items() if k != "rows"}, indent=1)[:-2]
    rows = ",\n".join("  " + json.dumps(r, separators=(",", ":")) for r in history["rows"])
    return head + ',\n "rows": [\n' + rows + "\n ]\n}\n"


def main():
    data = json.loads(DATA.read_text())
    date = str(data.get("updated") or "")[:10]
    if len(date) != 10:
        print(f"::error::{DATA} has no `updated` date; history not written")
        return 1
    row = {}
    for slug, event in sorted((data.get("events") or {}).items()):
        if event.get("stale_since"):
            continue
        prices = yes_prices(event)
        if prices:
            row[slug] = prices

    history = json.loads(HISTORY.read_text()) if HISTORY.exists() else {
        "meta": {
            "source": "Polymarket Gamma API, via data/polymarket-data.json",
            "description": "Daily snapshot of the curated Polymarket events' Yes prices (0-1), "
                           "one row per UTC date, written by scripts/polymarket/append_history.py "
                           "after each fetch. Events carried forward as stale are not recorded.",
        },
        "rows": [],
    }
    rows = [r for r in history.get("rows", []) if r.get("date") != date]
    if row:
        rows.append({"date": date, "events": row})
    rows.sort(key=lambda r: r["date"])
    history["rows"] = rows
    HISTORY.write_text(dump(history))
    print(f"── {HISTORY}: {len(rows)} dates; {date} has {len(row)} events ──")
    return 0


if __name__ == "__main__":
    sys.exit(main())
