#!/usr/bin/env python3
"""
scripts/market/fetch_dola_muni_households.py — DOLA's household population
for every incorporated Colorado town, by year, for the town-level market
calls in scripts/market/build_market_direction.py.

Household population leaves out group quarters (prisons, dorms, nursing
homes), the same measure the county calls use, so a prison moving does not
read as housing demand.

Source: the State Demography Office's municipal estimates lookup
  https://gis.dola.colorado.gov/lookups/munipophousing?year=...&placefips=...&compressed=no&stats=householdpopulation
A town in several counties comes back as one row per county part plus a
"(Total)" row (countyfips 999); the total is kept. A zero is DOLA reporting
no households (Carbonate), kept as null with that reason, never 0.

Writes data/market/dola_muni_household_population.json. Exits 1 without
writing when the lookup fails or returns fewer towns than geo-config lists.

Usage:
  python3 scripts/market/fetch_dola_muni_households.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
GEO_CONFIG = os.path.join(ROOT, 'data', 'hna', 'geo-config.json')
OUT = os.path.join(ROOT, 'data', 'market', 'dola_muni_household_population.json')
URL = 'https://gis.dola.colorado.gov/lookups/munipophousing'
PAGE = 'https://demography.dola.colorado.gov/assets/html/population.html'
FIRST_YEAR = 2014
BATCH = 60  # place codes per request


def fetch(years: list[int], codes: list[int]) -> list[dict] | None:
    """The lookup's rows, or None when it answers that a year is not served
    (it replies in plain text, not JSON)."""
    url = (f"{URL}?year={','.join(map(str, years))}&placefips={','.join(map(str, codes))}"
           '&compressed=no&stats=householdpopulation')
    req = urllib.request.Request(url, headers={'User-Agent': 'COHO-Analytics/1.0 (+municipal estimates)'})
    with urllib.request.urlopen(req, timeout=120) as r:
        body = r.read()
    if body.startswith(b'one of your year inputs is not valid'):
        return None
    return json.loads(body)


def latest_year(code: int) -> int:
    """The newest estimate year the lookup serves, found by asking for Denver."""
    year = FIRST_YEAR + 10
    while fetch([year + 1], [code]):
        year += 1
    return year


def towns_from_rows(rows: list[dict], towns: dict[str, str], years: list[int]) -> dict:
    """One series per town: the "(Total)" row (countyfips 999) for a town in
    several counties, else its one row; a zero or missing count is null."""
    by_town: dict[str, dict] = {}
    for r in rows:
        g = f"08{int(r['placefips']):05d}"
        rec = by_town.setdefault(g, {'name': towns.get(g), 'parts': {}, 'total': {}})
        v = r.get('householdpopulation')
        v = int(v) if str(v or '').isdigit() else None
        if r['countyfips'] == 999:
            rec['total'][r['year']] = v
        else:
            rec['parts'].setdefault(r['year'], []).append(v)
    out = {}
    for g, rec in sorted(by_town.items()):
        series = {}
        for y in years:
            v = rec['total'].get(y)
            if v is None and y not in rec['total']:
                parts = rec['parts'].get(y) or []
                v = parts[0] if len(parts) == 1 else None
            series[str(y)] = v if v else None
        out[g] = {'name': rec['name'], 'household_population': series}
        if any(v is None for v in series.values()):
            out[g]['unavailable_reason'] = 'DOLA reports no household population for a year shown as null'
    return out


def main() -> int:
    with open(GEO_CONFIG) as fh:
        geo = json.load(fh)
    towns = {p['geoid']: p['label'] for p in geo['places']}
    codes = sorted(int(g[2:]) for g in towns)
    try:
        last = latest_year(20000)
        years = list(range(last - 10, last + 1))
        rows = []
        for i in range(0, len(codes), BATCH):
            rows += fetch(years, codes[i:i + BATCH])
    except (OSError, ValueError) as err:
        print(f'DOLA municipal lookup failed: {err!r}; nothing written', file=sys.stderr)
        return 1
    out = towns_from_rows(rows, towns, years)
    if len(out) < len(towns):
        print(f'DOLA returned {len(out)} of {len(towns)} towns; nothing written', file=sys.stderr)
        return 1
    doc = {
        'meta': {
            'source': 'Colorado State Demography Office, municipal population estimates (household population)',
            'source_url': URL, 'source_page_url': PAGE,
            'measure': 'household population: total population less group quarters',
            'vintage': last, 'years': [years[0], years[-1]],
            'generated_at': f'{last}-07-01T00:00:00Z',
            'generated_at_note': "the latest estimate's reference date (DOLA estimates are as of July 1), "
                                 'not the time this ran, so a refetch of the same vintage writes the same bytes',
            'town_count': len(out),
        },
        'towns': out,
    }
    with open(OUT, 'w') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(f'{len(out)} towns, {years[0]}–{years[-1]}; wrote {os.path.relpath(OUT, ROOT)}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
