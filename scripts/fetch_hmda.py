#!/usr/bin/env python3
"""
fetch_hmda.py — Fetch HMDA (Home Mortgage Disclosure Act) aggregates for Colorado.

Pulls county-level + state-level mortgage origination, denial, and loan-purpose
breakdowns from the CFPB HMDA Data Browser API. The API is public (no auth)
but unfilterable per-county — we loop one request per (county, year, metric)
combination with polite throttling.

Background — why HMDA matters
-----------------------------
HMDA is the single best public dataset for **mortgage credit access** at
the county/tract level. Where FRED gives macro signals (rates, starts,
spending) and CHAS gives stock affordability, HMDA shows the *transaction
flow*: who got loans, who didn't, in what amounts. Critical inputs for:

  - Reading market liquidity / credit-availability cycles
  - Identifying underserved markets (high denial rates / low origination
    volume relative to demographic-implied demand)
  - Measuring multifamily debt activity (LIHTC-relevant subset)
  - Demographic / fair-lending lens consistent with the existing CHAS
    cost-burden-by-income dashboard

CFPB API: https://ffiec.cfpb.gov/v2/data-browser-api/
Vintages: 2018-2024 (calendar 2024 published spring 2025)

Output
------
    data/hmda/co-county-aggregates.json — per-county, per-year metrics
    data/hmda/co-state-trends.json      — statewide time series (lightweight)

Usage
-----
    python3 scripts/fetch_hmda.py            # fetch all years, all counties
    python3 scripts/fetch_hmda.py --years 2023,2024
    python3 scripts/fetch_hmda.py --counties 08031,08001  # Denver, Adams
    python3 scripts/fetch_hmda.py --state-only  # skip per-county loop

Throttling
----------
~3 req/s with 200ms inter-request delay. CFPB has no documented rate limit
but heavy parallel fetches occasionally see 429s; the polite cadence
keeps us off the radar. Full refresh = 64 counties × 7 years × ~5 metrics
≈ 2,200 calls ≈ 12-15 minutes.

Failure modes
-------------
  - HTTP 400 (bad filter combo) → log + skip that county/year/metric
  - Network timeout → retry with exponential backoff (max 3)
  - Empty response → record as zero (some rural counties have 0
    originations of certain types in some years)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any

REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
COUNTY_BOUNDARIES = os.path.join(REPO_ROOT, 'data', 'co-county-boundaries.json')
OUT_COUNTIES = os.path.join(REPO_ROOT, 'data', 'hmda', 'co-county-aggregates.json')
OUT_STATE = os.path.join(REPO_ROOT, 'data', 'hmda', 'co-state-trends.json')

API_BASE = 'https://ffiec.cfpb.gov/v2/data-browser-api/view/aggregations'
DEFAULT_YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024]
COLORADO_STATE_CODE = 'CO'
REQ_DELAY = 0.20  # 200 ms — ~3 req/s polite cadence
TIMEOUT = 30


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def load_co_counties() -> list[dict]:
    """Return list of {fips, name} for all 64 CO counties."""
    with open(COUNTY_BOUNDARIES, 'r', encoding='utf-8') as f:
        gj = json.load(f)
    out = []
    for feat in gj.get('features', []):
        props = feat.get('properties', {})
        fips = props.get('GEOID') or props.get('FIPS')
        name = props.get('NAME')
        if fips and name:
            out.append({'fips': fips, 'name': name})
    return sorted(out, key=lambda c: c['fips'])


def http_get_json(url: str, *, max_retries: int = 3) -> dict | None:
    """GET with retry. Returns parsed JSON or None on terminal failure."""
    last_err: Exception | None = None
    for attempt in range(max_retries + 1):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    'User-Agent': 'HousingAnalytics/1.0 fetch_hmda.py',
                    'Accept-Encoding': 'gzip',
                },
            )
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                raw = resp.read()
                if resp.headers.get('Content-Encoding') == 'gzip':
                    import gzip
                    raw = gzip.decompress(raw)
                return json.loads(raw.decode('utf-8'))
        except urllib.error.HTTPError as err:
            # 400 = bad filter combo (no data for this slice). Don't retry.
            if err.code in (400, 404):
                return None
            last_err = err
        except Exception as err:  # noqa: BLE001
            last_err = err
        if attempt < max_retries:
            time.sleep(2 ** attempt)
    print(f'  ✗ GET failed after {max_retries + 1} tries: {url[:120]} ({last_err})', file=sys.stderr)
    return None


def fetch_aggregation(
    *,
    state: str | None = None,
    county: str | None = None,
    year: int,
    extra_params: dict | None = None,
) -> dict | None:
    """Fetch a single aggregation. Returns the raw API response or None."""
    params: dict[str, str] = {'years': str(year)}
    if county:
        # API quirk: counties + states are mutually exclusive. Pass only counties.
        params['counties'] = county
    elif state:
        params['states'] = state
    if extra_params:
        params.update(extra_params)
    url = f'{API_BASE}?{urllib.parse.urlencode(params)}'
    time.sleep(REQ_DELAY)
    return http_get_json(url)


def aggregate_metrics_for_geo(
    *,
    state: str | None,
    county: str | None,
    year: int,
) -> dict:
    """Fetch the 5 metric bundles for one geography/year combination.

    Returns a dict with these keys:
      originations         — count + total $ volume (action 1)
      denials              — count of action 3
      denial_rate          — denials / (originations + approved-not-accepted + denials)
      by_purpose           — {purchase, refi, cashout_refi, home_improvement, other} counts
      multifamily          — multifamily originations count + $ volume
    """
    geo_kw = {'state': state, 'county': county, 'year': year}

    # 1) Originations + denials in one call (actions 1,2,3)
    orig_resp = fetch_aggregation(**geo_kw, extra_params={'actions_taken': '1,2,3'})
    actions = {a.get('actions_taken'): a for a in (orig_resp or {}).get('aggregations', [])}
    originations = int(actions.get('1', {}).get('count', 0))
    orig_volume = float(actions.get('1', {}).get('sum', 0) or 0)
    approved_not_accepted = int(actions.get('2', {}).get('count', 0))
    denials = int(actions.get('3', {}).get('count', 0))
    decision_total = originations + approved_not_accepted + denials
    denial_rate = round(denials / decision_total, 4) if decision_total else None

    # 2) Loan purpose split (only on originations, action_taken=1)
    purpose_resp = fetch_aggregation(
        **geo_kw,
        extra_params={'actions_taken': '1', 'loan_purposes': '1,2,31,32,4,5'},
    )
    purposes = {p.get('loan_purposes'): int(p.get('count', 0))
                for p in (purpose_resp or {}).get('aggregations', [])}
    by_purpose = {
        'purchase':         purposes.get('1', 0),
        'home_improvement': purposes.get('2', 0),
        'refinance':        purposes.get('31', 0),
        'cashout_refi':     purposes.get('32', 0),
        'other':            purposes.get('4', 0) + purposes.get('5', 0),
    }

    # 3) Multifamily (LIHTC-adjacent)
    mf_resp = fetch_aggregation(
        **geo_kw,
        extra_params={
            'actions_taken': '1',
            'dwelling_categories': 'Multifamily:Site-Built',
        },
    )
    mf_aggs = (mf_resp or {}).get('aggregations', [])
    mf_origs = int(mf_aggs[0].get('count', 0)) if mf_aggs else 0
    mf_volume = float(mf_aggs[0].get('sum', 0) or 0) if mf_aggs else 0

    # Median loan amount: API returns sum + count; true median requires
    # record-level data. Use mean as a proxy and label it as such.
    mean_loan = round(orig_volume / originations) if originations else None

    return {
        'originations': originations,
        'origination_volume_usd': orig_volume,
        'mean_loan_amount_usd': mean_loan,
        'denials': denials,
        'denial_rate': denial_rate,
        'decision_total': decision_total,
        'by_purpose': by_purpose,
        'multifamily': {
            'originations': mf_origs,
            'volume_usd': mf_volume,
        },
    }


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument('--years', help='Comma-separated years (default: 2018-2024)')
    p.add_argument('--counties', help='Comma-separated county FIPS (default: all 64 CO counties)')
    p.add_argument('--state-only', action='store_true', help='Skip per-county loop')
    args = p.parse_args()

    years = [int(y) for y in args.years.split(',')] if args.years else DEFAULT_YEARS
    counties_all = load_co_counties()
    if args.counties:
        wanted = set(c.strip() for c in args.counties.split(','))
        counties_all = [c for c in counties_all if c['fips'] in wanted]

    print(f'HMDA fetch: years={years}, counties={len(counties_all)}, state_only={args.state_only}')
    print(f'Estimated calls: state {len(years)*3} + counties {len(counties_all)*len(years)*3 if not args.state_only else 0}')

    # ── State-level fetch ──────────────────────────────────────────────
    state_trends: dict[str, Any] = {
        'meta': {
            'generated_at': utc_now(),
            'source': 'CFPB HMDA Data Browser API',
            'state': COLORADO_STATE_CODE,
            'years': years,
        },
        'years': {},
    }
    print('\n── State-level (CO) ──')
    for year in years:
        print(f'  {year}…', end=' ', flush=True)
        metrics = aggregate_metrics_for_geo(
            state=COLORADO_STATE_CODE, county=None, year=year,
        )
        state_trends['years'][str(year)] = metrics
        print(f'orig={metrics["originations"]:,} denial_rate={metrics["denial_rate"]} mf={metrics["multifamily"]["originations"]}')

    # ── Per-county fetch ───────────────────────────────────────────────
    counties_payload: dict[str, Any] = {}
    if not args.state_only:
        print(f'\n── Per-county ({len(counties_all)} CO counties) ──')
        for i, c in enumerate(counties_all, 1):
            row: dict[str, Any] = {'name': c['name'], 'fips': c['fips'], 'years': {}}
            for year in years:
                metrics = aggregate_metrics_for_geo(
                    state=None, county=c['fips'], year=year,
                )
                row['years'][str(year)] = metrics
            counties_payload[c['fips']] = row
            latest = years[-1]
            latest_orig = row['years'][str(latest)]['originations']
            print(f'  [{i:>2}/{len(counties_all)}] {c["fips"]} {c["name"]:<22} '
                  f'{latest}={latest_orig:,} originations')

    # ── Write outputs ──────────────────────────────────────────────────
    os.makedirs(os.path.dirname(OUT_COUNTIES), exist_ok=True)

    state_payload = state_trends
    with open(OUT_STATE, 'w', encoding='utf-8') as f:
        json.dump(state_payload, f, indent=2, sort_keys=False)
    print(f'\n✓ Wrote {OUT_STATE}')

    if not args.state_only:
        counties_doc = {
            'meta': {
                'generated_at': utc_now(),
                'source': 'CFPB HMDA Data Browser API',
                'state': COLORADO_STATE_CODE,
                'years': years,
                'count_counties': len(counties_payload),
            },
            'counties': counties_payload,
        }
        with open(OUT_COUNTIES, 'w', encoding='utf-8') as f:
            json.dump(counties_doc, f, indent=2, sort_keys=False)
        print(f'✓ Wrote {OUT_COUNTIES}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
