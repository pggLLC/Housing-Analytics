"""scripts/polymarket/append_history.py keeps the daily Polymarket record.

Stale events and unpriced markets are left out (never recorded as 0), a
re-run on the same date replaces that date's row, and the committed history
file parses and agrees with the fetch workflow that writes it.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "polymarket" / "append_history.py"


def event(prices, outcomes='["Yes", "No"]', **extra):
    return dict({"markets": [{"question": q, "outcomePrices": p, "outcomes": outcomes} for q, p in prices]}, **extra)


def run(tmp_path, data):
    d = tmp_path / "data.json"
    h = tmp_path / "history.json"
    d.write_text(json.dumps(data))
    subprocess.run([sys.executable, str(SCRIPT), str(d), str(h)], check=True, capture_output=True)
    return json.loads(h.read_text())


def test_records_fresh_events_and_skips_stale_and_unpriced(tmp_path):
    data = {
        "updated": "2026-10-10T05:40:00Z",
        "events": {
            "live": event([("No change", '["0.835", "0.165"]'), ("Cut", '["0.004", "0.996"]')]),
            "stale": event([("Yes?", '["0.4", "0.6"]')], stale_since="2026-10-01T00:00:00Z"),
            "unpriced": event([("Q", "[]"), ("R", "not json")]),
        },
    }
    h = run(tmp_path, data)
    assert h["rows"] == [{"date": "2026-10-10", "events": {"live": {"No change": 0.835, "Cut": 0.004}}}]


def test_same_date_replaces_and_dates_stay_sorted(tmp_path):
    base = {"events": {"e": event([("Yes?", '["0.3", "0.7"]')])}}
    run(tmp_path, dict(base, updated="2026-10-10T05:00:00Z"))
    run(tmp_path, dict(base, updated="2026-10-08T05:00:00Z"))
    later = {"updated": "2026-10-10T09:00:00Z", "events": {"e": event([("Yes?", '["0.25", "0.75"]')])}}
    h = run(tmp_path, later)
    assert [r["date"] for r in h["rows"]] == ["2026-10-08", "2026-10-10"]
    assert h["rows"][-1]["events"]["e"]["Yes?"] == 0.25


def test_committed_history_parses_and_matches_workflow():
    h = json.loads((ROOT / "data" / "polymarket-history.json").read_text())
    dates = [r["date"] for r in h["rows"]]
    assert dates and dates == sorted(dates) and len(dates) == len(set(dates))
    for r in h["rows"]:
        for prices in r["events"].values():
            assert prices and all(isinstance(p, float | int) and 0 <= p <= 1 for p in prices.values())
    wf = (ROOT / ".github" / "workflows" / "fetch-polymarket-data.yml").read_text()
    assert "scripts/polymarket/append_history.py" in wf
    assert "data/polymarket-history.json" in wf, "the workflow must commit the file it appends to"
