#!/usr/bin/env python3
"""Build data/hna/forecast-error.json: how far past Colorado county forecasts missed.

The Scenario Builder shades a band around SDO's forecast: where two in three
past forecasts for a place of that size landed, year by year. It is the
standard empirical way to size a forecast's error (Smith, Tayman and Swanson,
A Practitioner's Guide to State and Local Population Projections, 2013, ch. 13;
Rayer, "Population Forecast Errors: A Primer for Planners", Journal of Planning
Education and Research 27, 2008):

  1. From SDO's county population estimates, 1970 to the latest year, forecast
     each county from every launch year with a 10-year base period: the
     average of a linear and an exponential trend through the launch year and
     ten years before it.
  2. Compare each forecast, 1 to 20 years out, with SDO's later estimate for
     that year: the miss as a percent of the forecast. The chart's range is
     drawn around a forecast (SDO's), so this is the measure it needs: a miss
     of e% of the actual would put the forecast's range at F/(1+e) to F/(1-e).
  3. Group the errors by the county's population at launch and by years out,
     and keep the error two in three forecasts stayed within (the 67th
     percentile). A later horizon never shows less error than an earlier one.

Rayer (2008, Table 5) finds trend and cohort-component forecasts about equally
precise, so the record of these forecasts stands in for SDO's, whose past
county vintages are not published as data. Adams, Boulder, Broomfield,
Jefferson and Weld are one area here: Broomfield was formed from them in 2001,
and SDO's estimates before then count its people in the other four.

Input, cached by build_hna_data.py (DOLA phase):
  data/hna/source/dola_components_county.csv  SDO estimates, 1970 onward

    python3 scripts/hna/build_forecast_error.py [--out PATH]

test/forecast-error-band.test.js checks the file matches this script's output.
"""
import csv
import io
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'data', 'hna', 'source', 'dola_components_county.csv')
OUT = os.path.join(ROOT, 'data', 'hna', 'forecast-error.json')

BASE_PERIOD = 10
MAX_HORIZON = 20
PERCENTILE = 2 / 3
# Population at launch. In 2024 Colorado had 12 counties under 5,000 people
# and 11 over 100,000; four groups keep a few hundred forecasts in each.
SIZE_CLASSES = [(0, 5000), (5000, 20000), (20000, 100000), (100000, None)]
# Broomfield (14) was formed in 2001 from these four.
BROOMFIELD_PARENTS = {'1', '13', '14', '59', '123'}


def read_estimates():
    with open(SRC, newline='') as f:
        lines = f.read().splitlines()
    header = next(i for i, l in enumerate(lines) if l.startswith('id,'))
    vintage = lines[0].split(',')[0].strip() if header else None
    pop = {}
    for r in csv.DictReader(io.StringIO('\n'.join(lines[header:]))):
        if r['datatype'] != 'Estimate' or r['countyfips'] == '0':
            continue
        area = 'broomfield-and-parents' if r['countyfips'] in BROOMFIELD_PARENTS else r['countyfips']
        year = int(r['year'])
        pop.setdefault(area, {})
        pop[area][year] = pop[area].get(year, 0.0) + float(r['estimate'])
    return vintage, pop


def size_class(p):
    for i, (lo, hi) in enumerate(SIZE_CLASSES):
        if p >= lo and (hi is None or p < hi):
            return i
    raise ValueError(p)


def percentile(values, q):
    v = sorted(values)
    k = (len(v) - 1) * q
    i = int(k)
    j = min(i + 1, len(v) - 1)
    return v[i] + (v[j] - v[i]) * (k - i)


def main():
    out_path = OUT
    if '--out' in sys.argv:
        out_path = sys.argv[sys.argv.index('--out') + 1]
    vintage, pop = read_estimates()
    first = min(min(s) for s in pop.values())
    last = max(max(s) for s in pop.values())
    if len(pop) != 60 or first != 1970:
        raise SystemExit(f'expected 60 areas from 1970 in {os.path.relpath(SRC, ROOT)}, '
                         f'found {len(pop)} from {first}; nothing written')

    errors = [[[] for _ in range(MAX_HORIZON)] for _ in SIZE_CLASSES]
    for series in pop.values():
        for launch in range(first + BASE_PERIOD, last):
            p0, pb = series.get(launch), series.get(launch - BASE_PERIOD)
            if not p0 or not pb:
                continue
            c = size_class(p0)
            for h in range(1, MAX_HORIZON + 1):
                actual = series.get(launch + h)
                if not actual:
                    continue
                linear = p0 + (p0 - pb) / BASE_PERIOD * h
                exponential = p0 * (p0 / pb) ** (h / BASE_PERIOD)
                forecast = (linear + exponential) / 2
                errors[c][h - 1].append(abs(forecast - actual) / forecast * 100)

    error_pct, counts = [], []
    for c, by_h in enumerate(errors):
        if any(len(e) < 100 for e in by_h):
            raise SystemExit(f'fewer than 100 forecasts in a size class {SIZE_CLASSES[c]}; nothing written')
        row, worst = [], 0.0
        for e in by_h:
            worst = max(worst, percentile(e, PERCENTILE))
            row.append(round(worst, 1))
        error_pct.append(row)
        counts.append([len(e) for e in by_h])

    out = {
        'about': ('Miss, as a percent of the forecast, that two in three past trend forecasts of Colorado '
                  'county population stayed within, by population at launch and years out.'),
        'source': f'Colorado State Demography Office county population estimates, {first}-{last} ({vintage})',
        'method': ('Launch years {0}-{1}; 10-year base period; average of linear and exponential trend; '
                   'miss against SDO\'s later estimate as a percent of the forecast; 67th percentile, never falling with years out. '
                   'Adams, Boulder, Broomfield, Jefferson and Weld combined.').format(first + BASE_PERIOD, last - 1),
        'references': [
            'Smith, Tayman and Swanson, A Practitioner\'s Guide to State and Local Population Projections (Springer, 2013), ch. 13',
            'Rayer, "Population Forecast Errors: A Primer for Planners," Journal of Planning Education and Research 27 (2008)',
        ],
        'percentile': round(PERCENTILE, 4),
        'sizeClasses': [{'min': lo, 'max': hi} for lo, hi in SIZE_CLASSES],
        'yearsOut': list(range(1, MAX_HORIZON + 1)),
        'errorPct': error_pct,
        'forecasts': counts,
    }
    with open(out_path, 'w') as f:
        json.dump(out, f, indent=1)
        f.write('\n')
    print(f'wrote {os.path.relpath(out_path, ROOT)}: 20-year error two in three stayed within, by size: '
          + ', '.join(f'{r[-1]}%' for r in error_pct))


if __name__ == '__main__':
    main()
