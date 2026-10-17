#!/usr/bin/env python3
"""
scripts/market/fetch_bps_monthly.py — homes permitted so far this year, by
Colorado county and town, against the same months last year, from the Census
Building Permits Survey's monthly files.

The market calls in scripts/market/build_market_direction.py read the annual
BPS files (data/hna/permits.json), whose newest year is the last full one.
This adds the current year to date beside them as context; it changes no call.

Source: the year-to-date files Census publishes each month
  County: https://www2.census.gov/econ/bps/County/            coYYMMy.txt
  Place:  https://www2.census.gov/econ/bps/Place/West%20Region/ weYYMMy.txt
Units are total (reported plus Census estimates for offices that did not
report); the reported-only units are kept beside them. A town whose permit
office does not report every month has only Census estimates for this year,
so its figures are null with that reason, never 0. A town in several counties
is summed across its county parts.

Writes data/market/bps_monthly_ytd.json. Exits 1 without writing when a file
cannot be read, the county file lacks any of the 64 counties, or a place file
lists fewer than 200 towns.

Usage:
  python3 scripts/market/fetch_bps_monthly.py
"""
from __future__ import annotations

import csv
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'data', 'market', 'bps_monthly_ytd.json')
# directories and file patterns kept apart: the source-URL sweep truncates a
# URL at a "{" placeholder and probes it as a 404 (build_permits.py)
COUNTY_DIR = 'https://www2.census.gov/econ/bps/County/'
PLACE_DIR = 'https://www2.census.gov/econ/bps/Place/West%20Region/'
COUNTY_FILE = 'co{yymm}y.txt'
PLACE_FILE = 'we{yymm}y.txt'
COLORADO = '08'
COUNTIES = 64
# every place file from 2022 to 2026 lists 210-213 Colorado towns; fewer than
# this means a truncated or partly published file, which must not overwrite
# the committed one
MIN_PLACES = 200
LOOKBACK = 4  # months to look back for the newest published file
# the market calls read a permit change only when each period has this many
# homes (build_market_direction.PERMIT_FLOOR); below it one building swings it
FLOOR = 50
# last year's file is the one Census published then, so a permit office that
# filed one month late shows one month short; that month is a Census estimate
LATE_MONTHS = 1
ESTIMATED = ("the permit office does not report every month, so this year's figure "
             'is a Census estimate, not a count')


def get(url: str) -> list[str] | None:
    """The file's lines, or None when Census has not published it (404).
    A harmless query string gets past the census.gov firewall's block on
    some bare .txt URLs (build_permits.py)."""
    req = urllib.request.Request(url + '?dl=1', headers={'User-Agent': 'COHO-Analytics/1.0 (+building permits)'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            text = r.read().decode('utf-8', errors='replace')
    except urllib.error.HTTPError as err:
        if err.code == 404:
            return None
        raise
    if '<html' in text[:400].lower():
        raise OSError(f'{url} returned an HTML page instead of data')
    return text.splitlines()


def num(v: str) -> int:
    v = v.strip()
    return int(v) if v.isdigit() else 0


def units(row: list[str]) -> dict:
    """The last 24 columns are 8 groups of (buildings, units, value): 1, 2,
    3-4 and 5+ units, then the same four reported only. Anchored at the row's
    end so a name with a comma cannot shift them."""
    b = row[-24:]
    u = [num(b[i]) for i in (1, 4, 7, 10)]
    return {'total': sum(u), 'single_family': u[0], 'multifamily': sum(u[1:]),
            'reported': sum(num(b[i]) for i in (13, 16, 19, 22))}


def add(a: dict | None, b: dict) -> dict:
    return dict(b) if a is None else {k: a[k] + b[k] for k in a}


def counties_from(lines: list[str]) -> dict:
    out: dict = {}
    for row in csv.reader(lines[2:]):
        if len(row) < 30 or row[1].strip() != COLORADO:
            continue
        g = COLORADO + row[2].strip().zfill(3)
        out[g] = {'name': row[5].strip(), 'units': add(out.get(g, {}).get('units'), units(row))}
    return out


def places_from(lines: list[str]) -> dict:
    """Towns by FIPS place code; county balance rows (99990) are skipped.
    A town in several counties is summed, and its months reported is the
    fewest of its parts."""
    out: dict = {}
    for row in csv.reader(lines[2:]):
        if len(row) < 40 or row[1].strip() != COLORADO:
            continue
        fp = row[5].strip()
        if not fp.isdigit() or fp in ('99990', '00000'):
            continue
        g = COLORADO + fp.zfill(5)
        rec = out.setdefault(g, {'name': ','.join(row[16:-24]).strip(), 'months_reported': 12, 'units': None})
        rec['months_reported'] = min(rec['months_reported'], num(row[15]))
        rec['units'] = add(rec['units'], units(row))
    return out


def change(now: dict | None, before: dict | None) -> tuple[float | None, str | None]:
    if now is None or before is None:
        return None, 'no figure for one of the two years'
    if min(now['total'], before['total']) < FLOOR:
        return None, f'fewer than {FLOOR} homes permitted in one of the two periods, too few to read a change'
    return round((now['total'] / before['total'] - 1) * 100, 1), None


def combine(now: dict, before: dict, month: int, is_place: bool) -> dict:
    out = {}
    for g in sorted(set(now) | set(before)):
        a, b = now.get(g), before.get(g)
        rec = {'name': (a or b)['name']}
        if is_place:
            rec['months_reported'] = {'this_year': a and a['months_reported'],
                                      'last_year': b and b['months_reported']}
            if not (a and b and a['months_reported'] >= month and b['months_reported'] >= month - LATE_MONTHS):
                out[g] = dict(rec, ytd=None, prior_ytd=None, change_pct=None, unavailable_reason=ESTIMATED)
                continue
        pct, why = change(a and a['units'], b and b['units'])
        rec.update(ytd=a and a['units'], prior_ytd=b and b['units'], change_pct=pct)
        if why:
            rec['unavailable_reason'] = why
        out[g] = rec
    return out


def latest(today: dt.date) -> tuple[int, int, list[str]]:
    y, m = today.year, today.month
    for _ in range(LOOKBACK):
        m -= 1
        if m == 0:
            y, m = y - 1, 12
        lines = get(COUNTY_DIR + COUNTY_FILE.format(yymm=f'{y % 100:02d}{m:02d}'))
        if lines:
            return y, m, lines
    raise OSError(f'no county year-to-date file in the last {LOOKBACK} months')


def main() -> int:
    try:
        y, m, county_now = latest(dt.date.today())
        tag, prior = f'{y % 100:02d}{m:02d}', f'{(y - 1) % 100:02d}{m:02d}'
        county_before = get(COUNTY_DIR + COUNTY_FILE.format(yymm=prior))
        place_now = get(PLACE_DIR + PLACE_FILE.format(yymm=tag))
        place_before = get(PLACE_DIR + PLACE_FILE.format(yymm=prior))
        if not (county_before and place_now and place_before):
            raise OSError(f'a year-to-date file for {tag} or {prior} is not published')
    except (OSError, ValueError) as err:
        print(f'BPS monthly fetch failed: {err!r}; nothing written', file=sys.stderr)
        return 1
    counties = combine(counties_from(county_now), counties_from(county_before), m, False)
    if len(counties) != COUNTIES:
        print(f'BPS county file has {len(counties)} of {COUNTIES} counties; nothing written', file=sys.stderr)
        return 1
    parsed = {tag: places_from(place_now), prior: places_from(place_before)}
    short = {t: len(p) for t, p in parsed.items() if len(p) < MIN_PLACES}
    if short:
        print(f'BPS place files list too few Colorado towns {short} (expected at least {MIN_PLACES}); '
              'nothing written', file=sys.stderr)
        return 1
    places = combine(parsed[tag], parsed[prior], m, True)
    state = {k: sum(c[k]['total'] for c in counties.values()) for k in ('ytd', 'prior_ytd')}
    doc = {
        'meta': {
            'source': 'U.S. Census Bureau, Building Permits Survey, monthly year-to-date files',
            'source_url': COUNTY_DIR, 'place_source_url': PLACE_DIR,
            'source_files': [COUNTY_FILE.format(yymm=tag), COUNTY_FILE.format(yymm=prior),
                             PLACE_FILE.format(yymm=tag), PLACE_FILE.format(yymm=prior)],
            'through': f'{y}-{m:02d}', 'months': m, 'year': y,
            'generated_at': f'{y}-{m:02d}-01T00:00:00Z',
            'generated_at_note': 'the month the figures run through, not the time this ran, so a refetch '
                                 'of the same month writes the same bytes',
            'measure': (f'housing units permitted January–{dt.date(y, m, 1):%B} {y} against the same months '
                        f'of {y - 1}; total includes Census estimates for offices that did not report, '
                        'reported is the reported-only part; multifamily is 2 or more units'),
            'place_rule': ('a town is shown only when its permit office reported every month this year and '
                           f'all but at most {LATE_MONTHS} last year (a month filed late shows as missing in the '
                           "file Census published then); otherwise its figure is a Census estimate and is null"),
            'change_floor': FLOOR,
            'change_rule': f'change_pct is read only when each period has at least {FLOOR} homes',
            'state': dict(state, change_pct=change({'total': state['ytd']}, {'total': state['prior_ytd']})[0]),
            'county_count': len(counties),
            'place_count': len(places),
            'places_with_counts': sum(1 for p in places.values() if p['ytd'] is not None),
        },
        'counties': counties,
        'places': places,
    }
    with open(OUT, 'w') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(f'{len(counties)} counties, {doc["meta"]["places_with_counts"]} of {len(places)} towns counted, '
          f'through {y}-{m:02d}; wrote {os.path.relpath(OUT, ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
