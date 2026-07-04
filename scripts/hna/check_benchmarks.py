#!/usr/bin/env python3
"""
check_benchmarks.py
===================
Compare the repo's computed HNA figures against calibration anchors from five
professional consultant housing needs assessments (data/hna/benchmarks.json).

Purpose: when the HNA methodology changes (e.g. the rent-gap tenure fix, new
projection components), this prints repo-vs-consultant ratios so we can see
whether the change moved us toward or away from professional practice.

Divergence is INFORMATION, not failure — consultant reports measure different
concepts with different vintages (each anchor's caveat says how). The script
exits nonzero only when repo data is missing or unparseable.

Usage:
    python3 scripts/hna/check_benchmarks.py
    npm run test:hna-benchmarks
"""

from __future__ import annotations

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BENCHMARKS = os.path.join(ROOT, 'data', 'hna', 'benchmarks.json')


def load_json(rel_path: str):
    path = os.path.join(ROOT, rel_path)
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def resolve_repo_value(metric: dict) -> float | None:
    """Pull the repo figure a benchmark anchor points at.

    The stored gap field has OPPOSITE sign conventions in the two files
    (county: units−households, negative = shortage; place: households−units,
    positive = shortage), so we recompute shortage = households − units from
    the component fields, which is unambiguous in both.
    """
    data = load_json(metric['file'])
    field = metric['field']

    if field == 'gap_units_minus_households_le_ami_pct':
        threshold = metric['threshold']
        fname = os.path.basename(metric['file'])
        if fname == 'co_ami_gap_by_county.json':
            fips = metric.get('fips') or metric.get('geoid')
            entry = next((c for c in data['counties'] if c['fips'] == fips), None)
        else:
            entry = data['places'].get(metric.get('fips') or metric.get('geoid'))
        if entry is None:
            return None
        hh = entry['households_le_ami_pct'][threshold]
        units = entry['units_priced_affordable_le_ami_pct'][threshold]
        if hh is None or units is None:
            return None
        return hh - units

    if field == 'housing_need.incremental_units_needed_dola':
        series = data['housing_need']['incremental_units_needed_dola']
        years = data['years']
        year = metric['year']
        if year not in years:
            return None
        return series[years.index(year)]

    raise ValueError(f'unknown repo_metric field: {field}')


def fmt(v) -> str:
    if v is None:
        return '—'
    return f'{v:,.0f}'


def main() -> int:
    bench = load_json(os.path.relpath(BENCHMARKS, ROOT))
    errors = 0
    rows = []

    for j in bench['jurisdictions']:
        for a in j['anchors']:
            metric = a.get('repo_metric')
            # Anchors with no repo comparable yet (e.g. place-level projections)
            if metric is None:
                rows.append((j['name'], a['key'], None, a, None))
                continue
            # Thread the jurisdiction geoid into the metric resolver.
            metric = dict(metric, geoid=j['geoid'])
            try:
                repo_val = resolve_repo_value(metric)
            except (FileNotFoundError, KeyError, IndexError, TypeError, ValueError) as e:
                print(f'ERROR resolving {j["name"]}/{a["key"]}: {type(e).__name__}: {e}',
                      file=sys.stderr)
                errors += 1
                continue
            if repo_val is None:
                print(f'ERROR: repo value missing for {j["name"]}/{a["key"]}', file=sys.stderr)
                errors += 1
                continue
            rows.append((j['name'], a['key'], repo_val, a, _ratio(repo_val, a)))

    _print_table(rows)
    print()
    print('Ratios are calibration signals, not error measurements — read each caveat.')
    if errors:
        print(f'\n{errors} anchor(s) could not be resolved against repo data.', file=sys.stderr)
        return 1
    return 0


def _consultant_display(a: dict) -> tuple[str, float | None]:
    if 'consultant_value' in a:
        v = a['consultant_value']
        return (fmt(v) if v is not None else 'n/a (by design)'), v
    lo, hi = a.get('consultant_value_low'), a.get('consultant_value_high')
    mid = (lo + hi) / 2 if lo is not None and hi is not None else None
    return f'{fmt(lo)}–{fmt(hi)}', mid


def _ratio(repo_val: float, a: dict) -> float | None:
    _, consultant_mid = _consultant_display(a)
    if consultant_mid in (None, 0):
        return None
    return repo_val / consultant_mid


def _print_table(rows) -> None:
    header = ('Jurisdiction', 'Anchor', 'Repo', 'Consultant', 'Ratio', 'Caveat (abridged)')
    widths = [22, 22, 10, 16, 6, 60]
    line = '  '.join(h.ljust(w) for h, w in zip(header, widths))
    print(line)
    print('-' * len(line))
    for name, key, repo_val, a, ratio in rows:
        cons_str, _ = _consultant_display(a)
        caveat = a['caveat']
        caveat = caveat if len(caveat) <= 60 else caveat[:57] + '...'
        print('  '.join([
            name.ljust(widths[0]),
            key.ljust(widths[1]),
            (fmt(repo_val) if repo_val is not None else 'no metric').rjust(widths[2]),
            cons_str.rjust(widths[3]),
            (f'{ratio:.2f}' if ratio is not None else '—').rjust(widths[4]),
            caveat,
        ]))


if __name__ == '__main__':
    sys.exit(main())
