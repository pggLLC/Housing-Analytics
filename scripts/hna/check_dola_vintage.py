#!/usr/bin/env python3
"""
check_dola_vintage.py
=====================
Compare the county populations embedded in our projections
(data/hna/projections/<fips>.json) against SDO's components-change-county.csv
-- the same file our own projection pipeline sources from, and the file
SDO actively republishes (it appears on their public data page; the
previously-used forecast1yrcounty.csv does not and looks abandoned as of
2026-07-09).

Why this check still has value even though it compares the repo against
its own direct input: it's a regression guard against the *build process*
silently drifting from what SDO currently publishes (e.g. projections/*.json
going stale after an SDO update, or a future refactor breaking the read/write
of population_dola). It is deliberately NOT a check of our projection
*methodology* against an independent second source -- SDO does not appear
to publish an independent long-range county forecast separate from this
file, so there isn't one to compare against.

History: this script originally compared against forecast1yrcounty.csv
(SDO vintage 2023, prepared October 2024) and, on 2026-07-04, reported a
median diff of -1.4% with 12 counties beyond +/-5% (bookends: Broomfield
-11.7%, San Juan +15.4%). Investigation on 2026-07-09 (see repo issue
#1115) found forecast1yrcounty.csv no longer appears on SDO's current
public data page (https://demography.dola.colorado.gov/assets/html/sdodata.html)
and is likely a deprecated/orphaned file. Re-run against
components-change-county.csv (SDO vintage 2024, prepared March 2025 --
their currently-published county components-of-change product, which is
also what data/hna/projections/*.json is itself built from) showed all
64 counties matching exactly (0.0% diff, 0 warnings) -- the prior 12
"warnings" were entirely an artifact of comparing against a stale
benchmark, not real trajectory divergence. docs/audits/SDO-OUTLIERS-2026-07-08.md
documents the (now superseded) prior analysis for historical reference.

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
FORECAST_URL = 'https://storage.googleapis.com/co-publicdata/components-change-county.csv'
WARN_PCT = 5.0
MIN_MATCHED = 60


def fetch_forecast() -> list[list[str]]:
    req = urllib.request.Request(FORECAST_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=60) as resp:
        text = resp.read().decode('utf-8', errors='replace')
    return list(csv.reader(io.StringIO(text)))


def parse_forecast(rows: list[list[str]]) -> tuple[str, dict[str, dict[int, float]]]:
    """Return (vintage_line, {county_fips_no_leading_zeros: {year: estimate}}).

    Layout (verified against the March 2025 file): banner 'Vintage ...' row,
    then a header row (id,idtxt,countyfips,year,estimate,change,births,
    deaths,netmig,datatype); county rows have countyfips WITHOUT the state
    prefix and WITHOUT leading zeros (e.g. '14' for Broomfield/08014, '111'
    for San Juan/08111). Matching by FIPS instead of county name avoids the
    ' County' suffix / naming mismatches a name-based join is prone to.
    """
    vintage = ''
    for r in rows[:3]:
        joined = ' '.join(c for c in r if c).strip()
        if 'vintage' in joined.lower():
            vintage = joined
            break

    header_idx = None
    for i, r in enumerate(rows[:5]):
        cells = [c.strip() for c in r]
        if cells and cells[0] == 'id' and 'countyfips' in cells:
            header_idx = i
            break
    if header_idx is None:
        raise ValueError('could not locate header row (expected "id,idtxt,countyfips,...")')

    reader = csv.DictReader(','.join(r) for r in rows[header_idx:])
    out: dict[str, dict[int, float]] = {}
    for r in reader:
        cf = r.get('countyfips')
        yr = r.get('year')
        est = r.get('estimate')
        dt = r.get('datatype')
        if not cf or not yr or not est or dt not in ('Estimate', 'Projection'):
            continue
        try:
            year = int(yr)
            pop = float(est)
        except ValueError:
            continue
        out.setdefault(cf, {})[year] = pop
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
    print(f'SDO components-of-change file: {vintage or "(vintage line not found)"}')
    print(f'Comparing repo projections vs official data at {args.year}\n')

    diffs = []
    unmatched = []
    for fips, (name, series) in sorted(repo.items(), key=lambda kv: kv[1][0]):
        county_only = str(int(fips[-3:]))  # strip '08' state prefix + leading zeros
        sdo_series = official.get(county_only)
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
