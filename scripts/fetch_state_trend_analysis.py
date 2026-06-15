#!/usr/bin/env python3
"""
scripts/fetch_state_trend_analysis.py
=============================================================================
Pulls 4 housing metrics × 12 peer states × 6 years (2019-2024) from FRED's
public CSV endpoint (no API key required) and writes a single JSON file
consumed by js/trend-analysis.js on colorado-deep-dive.html.

Replaces the prior hard-coded scaffold values that were never wired to any
data provider despite carrying methodology citations.

Series sourced:
  1. Median Listing Price ($)        — MEDLISPRI{ST}   Realtor.com, monthly, 2016+
  2. House Price Index (FHFA, 1991=100) — {ST}STHPI    FHFA, quarterly, 1975+
  3. Active Listing Count            — ACTLISCOU{ST}   Realtor.com, monthly, 2016+
  4. Private Building Permits (units) — {ST}BPPRIV     Census BPS, monthly, 1988+

Output:
  data/market/state-trend-analysis.json
  Shape:
    {
      meta: { source: ..., generated, vintage, years },
      states: {
        Colorado: {
          MEDIAN_LISTING_PRICE_K: [...]   # 6 values for 2019..2024 in $thousands
          HPI_YOY_PCT:            [...]   # YoY % at year-end (Q4)
          ACTIVE_LISTINGS_K:      [...]   # annual mean in thousands
          PERMITS_K:              [...]   # annual sum in thousands of units
        },
        ...
      }
    }

Re-run annually to refresh — values are point-in-time; FRED publishes revisions.
"""

from __future__ import annotations

import csv
import io
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Optional FRED API key. When set, we hit api.stlouisfed.org (120 req/min,
# no throttling). When unset, we fall back to the keyless CSV endpoint and
# pace at ~5s between calls — slow but works for an annual refresh job.
FRED_API_KEY = os.environ.get("FRED_API_KEY", "").strip()
FRED_API_URL = ("https://api.stlouisfed.org/fred/series/observations"
                "?series_id={sid}&api_key={key}&file_type=json"
                "&observation_start={start}&observation_end={end}")

STATES = [
    ("Colorado", "CO"),
    ("Texas", "TX"),
    ("California", "CA"),
    ("Arizona", "AZ"),
    ("Utah", "UT"),
    ("Nevada", "NV"),
    ("Oregon", "OR"),
    ("Washington", "WA"),
    ("Florida", "FL"),
    ("Georgia", "GA"),
    ("North Carolina", "NC"),
    ("Virginia", "VA"),
]
YEARS = [2019, 2020, 2021, 2022, 2023, 2024]

ROOT = Path(__file__).resolve().parent.parent
OUT_FILE = ROOT / "data" / "market" / "state-trend-analysis.json"

FRED_CSV = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={start}&coed={end}"


def _fetch_via_api(series_id: str, start: str, end: str) -> list[tuple[str, float]]:
    """Use the FRED API endpoint (requires FRED_API_KEY env var, much faster)."""
    url = FRED_API_URL.format(sid=series_id, key=FRED_API_KEY, start=start, end=end)
    try:
        result = subprocess.run(
            ["curl", "-sSL", "--max-time", "20",
             "-H", "User-Agent: coho-housing-analytics", url],
            capture_output=True, text=True, timeout=25, check=False,
        )
        if result.returncode != 0:
            sys.stderr.write(f"  FAIL {series_id}: API curl exit {result.returncode}\n")
            return []
        data = json.loads(result.stdout)
        obs = data.get("observations", [])
        rows: list[tuple[str, float]] = []
        for o in obs:
            v = o.get("value")
            if v in (".", "", None):
                continue
            try:
                rows.append((o["date"], float(v)))
            except (KeyError, ValueError):
                continue
        return rows
    except Exception as e:
        sys.stderr.write(f"  FAIL {series_id}: {e}\n")
        return []


def fred_fetch(series_id: str, start: str = "2018-01-01", end: str = "2024-12-31") -> list[tuple[str, float]]:
    """Return [(date, value)] from FRED. Skips '.' rows (missing observations).

    Uses the FRED API (api.stlouisfed.org) when FRED_API_KEY is set in the
    environment — that's the fast path with no throttling. Falls back to
    the keyless CSV endpoint (fred.stlouisfed.org/graph/fredgraph.csv) with
    a 5s pace + retries when no key is available. The keyless path works
    for a one-off annual refresh but is fragile under repeated runs.
    """
    if FRED_API_KEY:
        rows = _fetch_via_api(series_id, start, end)
        time.sleep(0.6)  # well under 120/min
        return rows

    url = FRED_CSV.format(sid=series_id, start=start, end=end)
    # Force HTTP/1.1 — FRED's CDN returns HTTP/2 PROTOCOL_ERROR (curl exit
    # 92) under repeated rapid requests. Up to 3 retries with backoff.
    body = ""
    for attempt in range(3):
        try:
            result = subprocess.run(
                ["curl", "-sSL", "--http1.1", "--max-time", "30",
                 "-H", "User-Agent: coho-housing-analytics", url],
                capture_output=True, text=True, timeout=35, check=False,
            )
            if result.returncode == 0 and "observation_date" in result.stdout:
                body = result.stdout
                break
            sys.stderr.write(f"  retry {attempt+1} {series_id} curl exit {result.returncode}\n")
            time.sleep(5 + attempt * 5)
        except Exception as e:
            sys.stderr.write(f"  retry {attempt+1} {series_id} {e}\n")
            time.sleep(5 + attempt * 5)
    if not body:
        sys.stderr.write(f"  FAIL {series_id}: no data after retries\n")
        return []
    # Pace: 5s between every successful call to stay under FRED's keyless
    # throttle.
    time.sleep(5)
    rows: list[tuple[str, float]] = []
    reader = csv.reader(io.StringIO(body))
    next(reader, None)  # header
    for row in reader:
        if len(row) < 2:
            continue
        date, val = row[0], row[1]
        if val in (".", "", None):
            continue
        try:
            rows.append((date, float(val)))
        except ValueError:
            continue
    return rows


def annual_mean(monthly: list[tuple[str, float]], year: int) -> float | None:
    vals = [v for (d, v) in monthly if d.startswith(str(year))]
    return sum(vals) / len(vals) if vals else None


def annual_sum(monthly: list[tuple[str, float]], year: int) -> float | None:
    vals = [v for (d, v) in monthly if d.startswith(str(year))]
    return sum(vals) if vals else None


def end_of_year(quarterly: list[tuple[str, float]], year: int) -> float | None:
    """Return the Q4 value for the year (closest available)."""
    q4 = [v for (d, v) in quarterly if d.startswith(f"{year}-10")]
    if q4:
        return q4[0]
    # Fallback: last observation in that year
    yr = [v for (d, v) in quarterly if d.startswith(str(year))]
    return yr[-1] if yr else None


def hpi_yoy_pct(quarterly: list[tuple[str, float]], year: int) -> float | None:
    cur = end_of_year(quarterly, year)
    prev = end_of_year(quarterly, year - 1)
    if cur is None or prev is None or prev == 0:
        return None
    return ((cur - prev) / prev) * 100.0


def build():
    states_payload: dict[str, dict[str, list]] = {}
    for state_name, st in STATES:
        print(f"Fetching {state_name} ({st})…", file=sys.stderr)
        listing = fred_fetch(f"MEDLISPRI{st}")
        hpi = fred_fetch(f"{st}STHPI")
        active = fred_fetch(f"ACTLISCOU{st}")
        permits = fred_fetch(f"{st}BPPRIV")

        median_listing_k = []
        hpi_yoy = []
        active_k = []
        permits_k = []
        for yr in YEARS:
            ml = annual_mean(listing, yr)
            median_listing_k.append(round(ml / 1000.0, 1) if ml is not None else None)
            yo = hpi_yoy_pct(hpi, yr)
            hpi_yoy.append(round(yo, 2) if yo is not None else None)
            am = annual_mean(active, yr)
            active_k.append(round(am / 1000.0, 1) if am is not None else None)
            ps = annual_sum(permits, yr)
            permits_k.append(round(ps / 1000.0, 1) if ps is not None else None)

        states_payload[state_name] = {
            "MEDIAN_LISTING_PRICE_K": median_listing_k,
            "HPI_YOY_PCT": hpi_yoy,
            "ACTIVE_LISTINGS_K": active_k,
            "PERMITS_K": permits_k,
        }

    payload = {
        "meta": {
            "source": "FRED (Federal Reserve Economic Data, St. Louis Fed)",
            "source_url": "https://fred.stlouisfed.org/",
            "providers": {
                "MEDIAN_LISTING_PRICE_K": "Realtor.com via FRED series MEDLISPRI{state}",
                "HPI_YOY_PCT": "FHFA House Price Index via FRED series {state}STHPI (Q4-over-Q4)",
                "ACTIVE_LISTINGS_K": "Realtor.com via FRED series ACTLISCOU{state}",
                "PERMITS_K": "Census Building Permits Survey via FRED series {state}BPPRIV",
            },
            "states": [n for n, _ in STATES],
            "years": YEARS,
            "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "generator": "scripts/fetch_state_trend_analysis.py",
            "refresh_cadence": "annual (FRED revises; re-run after Q1 each year)",
        },
        "states": states_payload,
    }
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(payload, indent=2))
    print(f"\nwrote {OUT_FILE}", file=sys.stderr)
    # Spot-check
    co = states_payload["Colorado"]
    print(f"  Colorado MEDIAN_LISTING_PRICE_K: {co['MEDIAN_LISTING_PRICE_K']}", file=sys.stderr)
    print(f"  Colorado HPI_YOY_PCT:            {co['HPI_YOY_PCT']}", file=sys.stderr)
    print(f"  Colorado ACTIVE_LISTINGS_K:      {co['ACTIVE_LISTINGS_K']}", file=sys.stderr)
    print(f"  Colorado PERMITS_K:              {co['PERMITS_K']}", file=sys.stderr)


if __name__ == "__main__":
    build()
