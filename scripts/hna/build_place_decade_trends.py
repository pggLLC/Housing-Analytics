#!/usr/bin/env python3
"""
scripts/hna/build_place_decade_trends.py

F226 — Place-level companion to data/co-housing-costs/county-trends.json.

Today, the "How Affordable Has Housing Become Over the Last 15 Years?" chart
on hna-what-households-can-afford.html falls back to the containing county
for every place selection (renderDecadeAffordTrend() in hna-renderers.js),
with an honest "these figures are the county's, not yours" banner — because
the only source it has, county-trends.json, is built from a one-off county-
level parquet with no place-level equivalent. That's accurate but narrower
than it needs to be: ACS 5-Year DP03/DP04 profile tables (the same tables
already used for the page's CURRENT-vintage place-level rent/income/burden
numbers) also publish at place geography for the 2009 and 2014 vintages,
not just 2024 — nothing about the underlying Census data forces a
county-only chart, it's just that no one had fetched the historical place
vintages yet.

This script fetches those historical vintages at PLACE geography via
ACSExtractor (the same fetcher class + rate limiter used throughout
scripts/hna/), for the 482-place universe already tracked in
data/hna/place-tract-membership.json (the same universe
scripts/market/build_fhfa_hpi_subcounty.py aggregates FHFA tract HPI up to),
and merges in each place's 15-year home-price change from
data/market/fhfa_hpi_subcounty_co.json when available.

Requires CENSUS_API_KEY (see scripts/hna/acs_etl.py's ACSExtractor) — keyless
Census API calls always fail (the .github/workflows/build-hna-data.yml
"Environment check" step hard-gates on this for the same reason). Run this
via a GitHub Actions workflow with that secret, not locally without one.

Output: data/hna/place-decade-trends.json, keyed by 7-digit place GEOID,
with an `acs_cohorts` array shaped exactly like county-trends.json's, so
hna-renderers.js's renderDecadeAffordTrend() can read either file through
the same rendering code — only the LOOKUP (place file first, county
fallback second) needs to change.

Coverage: the 2005-2009 ACS 5-year estimate was the first 5-year ACS ever
published, and very small places may not have a reliable place-level
estimate that far back — or ANY place-level estimate for some sparse-data
variables. A place missing either its earliest (2009) or latest (2024)
cohort is left OUT of this file entirely: a 15-year comparison with only
one end of the comparison isn't a 15-year comparison, and the existing
county-inherits fallback already covers that place honestly.

Usage:
  CENSUS_API_KEY=... python3 scripts/hna/build_place_decade_trends.py
  CENSUS_API_KEY=... python3 scripts/hna/build_place_decade_trends.py --limit 5   # smoke test
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from acs_etl import ACSExtractor  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
MEMBERSHIP_PATH = os.path.join(ROOT, 'data', 'hna', 'place-tract-membership.json')
HPI_SUBCOUNTY_PATH = os.path.join(ROOT, 'data', 'market', 'fhfa_hpi_subcounty_co.json')
OUT_PATH = os.path.join(ROOT, 'data', 'hna', 'place-decade-trends.json')

VINTAGES = [2009, 2014, 2024]


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')


def load_places() -> dict:
    with open(MEMBERSHIP_PATH, encoding='utf-8') as fh:
        data = json.load(fh)
    return data.get('places', {})


def load_hpi_subcounty() -> dict:
    # Additive-only dependency: if this file is missing, stale, or the
    # separate FHFA county-parquet-schema bug (see the task this script's PR
    # description links) still blocks regenerating it, this script still
    # produces a fully valid output — just without a hpi.change_15y figure
    # for any place. renderDecadeAffordTrend() already tolerates a missing
    # hpi block (see its `hpi.change_15y != null ? ... : null` handling).
    if not os.path.exists(HPI_SUBCOUNTY_PATH):
        return {}
    with open(HPI_SUBCOUNTY_PATH, encoding='utf-8') as fh:
        data = json.load(fh)
    return data.get('places', {})


def rent_burden_30_plus_pct(fields: dict) -> float | None:
    """Share of renter households paying >=30% of income on rent, as a
    percentage. GRAPI bins: DP04_0141PE = 30-34.9%, DP04_0142PE = 35%+."""
    g30 = fields.get('DP04_0141PE')
    g35 = fields.get('DP04_0142PE')
    if g30 is None and g35 is None:
        return None
    return round((g30 or 0) + (g35 or 0), 1)


def fetch_cohort(geoids: list[str], year: int) -> dict:
    """Fetch DP03 (median household income) + DP04 (median gross rent, GRAPI
    rent-burden bins) for every geoid at one ACS 5-year vintage."""
    fetcher = ACSExtractor(['DP03', 'DP04'], geoids, year=year)
    return fetcher.fetch_all()


def build(geoids: list[str]) -> dict:
    places = load_places()
    hpi_subcounty = load_hpi_subcounty()

    by_year = {}
    for year in VINTAGES:
        print(f'[place-decade-trends] fetching {len(geoids)} places for {year}...', file=sys.stderr)
        by_year[year] = fetch_cohort(geoids, year)

    out_places = {}
    skipped_incomplete = 0
    for geoid in geoids:
        cohorts = []
        for year in VINTAGES:
            fields = (by_year.get(year) or {}).get(geoid)
            if not fields:
                continue
            income = fields.get('DP03_0062E')
            rent = fields.get('DP04_0134E')
            burden_pct = rent_burden_30_plus_pct(fields)
            if income is None and rent is None:
                continue
            cohorts.append({
                'year': year,
                'median_gross_rent': rent,
                'median_hh_income': income,
                'rent_burden_30_plus': (burden_pct / 100.0) if burden_pct is not None else None,
            })

        has_earliest = any(c['year'] == VINTAGES[0] for c in cohorts)
        has_latest = any(c['year'] == VINTAGES[-1] for c in cohorts)
        if not (has_earliest and has_latest):
            skipped_incomplete += 1
            continue

        hpi = hpi_subcounty.get(geoid) or {}
        change_15y = hpi.get('change_15y')
        # Schema matches county-trends.json's hpi block exactly (change_15y_pct,
        # not change_15y) so hna-renderers.js's renderDecadeAffordTrend() reads
        # `hpi.change_15y_pct` the same way for either file.
        out_places[geoid] = {
            'place_name': places.get(geoid, {}).get('name'),
            'acs_cohorts': sorted(cohorts, key=lambda c: c['year']),
            'hpi': {'change_15y_pct': change_15y} if change_15y is not None else None,
        }

    return {
        'meta': {
            'generated': _utc_now(),
            'vintage_years': VINTAGES,
            'source': (
                'ACS 5-Year DP03 (median household income) + DP04 (median gross rent, '
                'GRAPI rent-burden bins), place geography'
            ),
            'hpi_source': (
                'data/market/fhfa_hpi_subcounty_co.json (FHFA tract HPI aggregated to '
                'place via TIGER place-tract membership); omitted per-place when that '
                'file has no change_15y for the place'
            ),
            'place_count': len(out_places),
            'places_skipped_incomplete_history': skipped_incomplete,
            'total_places_considered': len(geoids),
        },
        'places': out_places,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--limit', type=int, default=None,
                         help='Only process the first N places, sorted by GEOID (smoke test).')
    args = parser.parse_args()

    all_geoids = sorted(load_places().keys())
    geoids = all_geoids[:args.limit] if args.limit else all_geoids

    payload = build(geoids)

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, 'w', encoding='utf-8') as fh:
        json.dump(payload, fh, indent=2)
        fh.write('\n')

    meta = payload['meta']
    print(
        f"[place-decade-trends] wrote {os.path.relpath(OUT_PATH, ROOT)}: "
        f"{meta['place_count']} places with full {VINTAGES[0]}-{VINTAGES[-1]} history, "
        f"{meta['places_skipped_incomplete_history']} skipped (incomplete history)",
        file=sys.stderr,
    )
    return 0


if __name__ == '__main__':
    sys.exit(main())
