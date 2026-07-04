#!/usr/bin/env python3
"""
check_dola_vintage.py
=====================
Compare the county populations embedded in our projections
(data/hna/projections/<fips>.json, derived from SDO's
components-change-county.csv) against SDO's official published county
forecast (forecast1yrcounty.csv, same co-publicdata bucket).

Why: consultant HNAs often cite older, hotter SDO vintages (e.g. Root
Policy's Feb 2025 La Plata report used a pre-revision series with 2030
pop 61,656 vs the current vintage-2023 forecast of 59,471). This check
proves our trajectory tracks the CURRENT official forecast, so divergence
from consultant reports is a vintage story, not a pipeline bug.

Baseline established 2026-07-04: median diff −1.4% at 2030 across all
64 counties; 12 counties beyond ±5%, almost all small-population
(bookends: Broomfield −11.7%, San Juan +15.4%); every large county is
within ±5%. Diffs beyond ±5% print as warnings; the script fails
(nonzero exit) only when data cannot be fetched/parsed or fewer than
60 counties match.

Usage:
    python3 scripts/hna/check_dola_vintage.py            # compares at 2030
    python3 scripts/hna/check_dola_vintage.py --year 2040
    npm run check:dola-vintage
"""

from __future__ import annotations

import argparse
import csv
import glob
import io
import json
import os
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FORECAST_URL = 'https://storage.googleapis.com/co-publicdata/forecast1yrcounty.csv'
WARN_PCT = 5.0
MIN_MATCHED = 60


def fetch_forecast() -> list[list[str]]:
    req = urllib.request.Request(FORECAST_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=60) as resp:
        text = resp.read().decode('utf-8', errors='replace')
    return list(csv.reader(io.StringIO(text)))


def parse_forecast(rows: list[list[str]]) -> tuple[str, dict[str, dict[int, float]]]:
    """Return (vintage_line, {county_name_lower: {year: population}}).

    Layout quirks (verified against the Oct 2024 file): banner title row,
    then a 'Vintage ...' row, then junk, then a header row whose first cell
    is 'Counties' followed by years 2000–2050; county rows follow with
    comma-formatted numbers; names have no ' County' suffix.
    """
    vintage = ''
    for r in rows[:5]:
        joined = ' '.join(c for c in r if c).strip()
        if 'vintage' in joined.lower():
            vintage = joined
            break

    header_idx = None
    for i, r in enumerate(rows):
        cells = [c.strip() for c in r]
        if cells and cells[0].lower().startswith('count') and '2030' in cells:
            header_idx = i
            break
    if header_idx is None:
        raise ValueError('could not locate year header row (first cell "Counties")')

    years: dict[int, int] = {}
    for col, cell in enumerate(rows[header_idx]):
        cell = cell.strip()
        if cell.isdigit() and 1990 < int(cell) < 2100:
            years[int(cell)] = col

    out: dict[str, dict[int, float]] = {}
    for r in rows[header_idx + 1:]:
        if not r or not r[0].strip():
            continue
        name = r[0].strip()
        low = name.lower()
        if low.startswith(('total', 'colorado', 'state', 'source', 'note', 'table')):
            continue
        series: dict[int, float] = {}
        for year, col in years.items():
            if col < len(r):
                raw = r[col].replace(',', '').strip()
                if raw:
                    try:
                        series[year] = float(raw)
                    except ValueError:
                        pass
        if series:
            out[low] = series
    return vintage, out


def repo_projections() -> dict[str, tuple[str, dict[int, float]]]:
    """{fips: (label, {year: population_dola})} for the 64 county files."""
    out = {}
    for path in sorted(glob.glob(os.path.join(ROOT, 'data', 'hna', 'projections', '08*.json'))):
        with open(path, 'r', encoding='utf-8') as f:
            d = json.load(f)
        fips = d.get('countyFips')
        if not fips or len(fips) != 5:
            continue
        summary_path = os.path.join(ROOT, 'data', 'hna', 'summary', f'{fips}.json')
        try:
            with open(summary_path, 'r', encoding='utf-8') as f:
                label = json.load(f)['geo']['label']
        except (OSError, KeyError, json.JSONDecodeError):
            continue
        name = label.replace(' County', '').strip()
        series = {y: p for y, p in zip(d['years'], d['population_dola']) if p is not None}
        out[fips] = (name, series)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--year', type=int, default=2030)
    args = ap.parse_args()

    try:
        vintage, official = parse_forecast(fetch_forecast())
    except Exception as e:  # network or format drift — that IS the failure mode
        print(f'ERROR fetching/parsing SDO forecast: {type(e).__name__}: {e}', file=sys.stderr)
        return 1

    repo = repo_projections()
    print(f'SDO official forecast: {vintage or "(vintage line not found)"}')
    print(f'Comparing repo projections vs official forecast at {args.year}\n')

    diffs = []
    unmatched = []
    for fips, (name, series) in sorted(repo.items(), key=lambda kv: kv[1][0]):
        sdo_series = official.get(name.lower())
        if sdo_series is None or args.year not in sdo_series or args.year not in series:
            unmatched.append(name)
            continue
        repo_v, sdo_v = series[args.year], sdo_series[args.year]
        pct = 100.0 * (repo_v / sdo_v - 1.0)
        diffs.append((pct, name, repo_v, sdo_v))

    diffs.sort()
    warns = 0
    for pct, name, repo_v, sdo_v in diffs:
        flag = '  ⚠ ' if abs(pct) > WARN_PCT else '    '
        if abs(pct) > WARN_PCT:
            warns += 1
        print(f'{flag}{name:<14} repo {repo_v:>10,.0f}  SDO {sdo_v:>10,.0f}  {pct:+.1f}%')

    n = len(diffs)
    if n:
        med = sorted(d[0] for d in diffs)[n // 2]
        print(f'\n{n} counties compared; median diff {med:+.1f}%; {warns} beyond ±{WARN_PCT:.0f}% (warnings)')
    if unmatched:
        print(f'unmatched: {", ".join(unmatched)}', file=sys.stderr)

    if n < MIN_MATCHED:
        print(f'ERROR: only {n} counties matched (< {MIN_MATCHED})', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
