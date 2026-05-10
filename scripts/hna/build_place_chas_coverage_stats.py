#!/usr/bin/env python3
"""scripts/hna/build_place_chas_coverage_stats.py

Compute and publish coverage statistics for the TIGER spatial-join
place-CHAS pipeline. Output drives the "Place-Level Data Coverage"
panel on dashboard-data-quality.html so analysts can see at a glance:

  - How many CO places get tract-aggregated CHAS (the methodologically
    consistent path)
  - How many fall back to county-level CHAS (and why)
  - Per-county breakdown showing geographic concentration of fallbacks

Output schema
-------------
    data/hna/place-chas-coverage-stats.json::

    {
      "meta": {
        "generated_at": "...",
        "source_files": [
          "data/hna/geography-registry.json",
          "data/hna/place-chas.json",
          "data/hna/place-phantom-aliases.json"
        ]
      },
      "totals": {
        "registry_places":             513,
        "covered_direct":              445,
        "covered_via_alias":            29,
        "covered_with_zero_apportion":  19,
        "uncovered_county_fallback":    20,
        "coverage_pct":                 92.4
      },
      "by_county": {
        "08001": {
          "name": "Adams",
          "total_places": 23,
          "covered": 21,
          "uncovered": 2,
          "coverage_pct": 91.3,
          "uncovered_examples": ["..."]
        },
        ...
      },
      "uncovered_places": [
        {
          "geoid": "...",
          "name": "...",
          "county_fips": "...",
          "reason": "no_tiger_coverage" | "zero_apportionment"
        }
      ]
    }
"""

from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
GEO_REGISTRY = os.path.join(REPO_ROOT, 'data', 'hna', 'geography-registry.json')
PLACE_CHAS   = os.path.join(REPO_ROOT, 'data', 'hna', 'place-chas.json')
ALIASES      = os.path.join(REPO_ROOT, 'data', 'hna', 'place-phantom-aliases.json')
COUNTY_NAMES_SRC = os.path.join(REPO_ROOT, 'data', 'co-county-boundaries.json')
OUT_FILE = os.path.join(REPO_ROOT, 'data', 'hna', 'place-chas-coverage-stats.json')


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def load_county_names() -> dict[str, str]:
    """Map 5-digit county FIPS → name (e.g. '08001' → 'Adams')."""
    if not os.path.exists(COUNTY_NAMES_SRC):
        return {}
    with open(COUNTY_NAMES_SRC) as f:
        gj = json.load(f)
    out = {}
    for feat in gj.get('features', []):
        props = feat.get('properties', {})
        fips = props.get('GEOID') or props.get('FIPS')
        name = props.get('NAME')
        if fips and name:
            out[fips] = name
    return out


def main() -> int:
    with open(GEO_REGISTRY) as f:
        registry = json.load(f)
    with open(PLACE_CHAS) as f:
        place_chas = json.load(f)
    aliases = {}
    if os.path.exists(ALIASES):
        with open(ALIASES) as f:
            aliases = json.load(f).get('aliases', {})
    county_names = load_county_names()

    place_chas_keys = set(place_chas.get('places', {}).keys())
    zero_hh_keys = {
        g for g, p in place_chas.get('places', {}).items()
        if p['summary']['total_renter_hh'] + p['summary']['total_owner_hh'] == 0
    }

    # Walk registry and bucket each place
    by_county_total: dict[str, int] = defaultdict(int)
    by_county_covered: dict[str, int] = defaultdict(int)
    by_county_uncovered_examples: dict[str, list[str]] = defaultdict(list)

    covered_direct = 0
    covered_via_alias = 0
    covered_with_zero_apportion = 0
    uncovered_county_fallback = 0
    uncovered_places: list[dict] = []
    registry_places = 0

    for g in registry.get('geographies', []):
        if g.get('type') not in ('place', 'cdp'):
            continue
        registry_places += 1
        geoid = g.get('geoid')
        county_fips = g.get('containingCounty') or 'unknown'
        by_county_total[county_fips] += 1

        in_place_chas = geoid in place_chas_keys
        aliased = geoid in aliases
        canonical = aliases.get(geoid, geoid)
        canonical_in_place_chas = canonical in place_chas_keys

        if in_place_chas:
            if geoid in zero_hh_keys:
                covered_with_zero_apportion += 1
                by_county_covered[county_fips] += 1
            else:
                covered_direct += 1
                by_county_covered[county_fips] += 1
        elif aliased and canonical_in_place_chas:
            covered_via_alias += 1
            by_county_covered[county_fips] += 1
        else:
            uncovered_county_fallback += 1
            uncovered_places.append({
                'geoid': geoid,
                'name': g.get('name', '?'),
                'county_fips': county_fips,
                'reason': 'no_tiger_coverage',
            })
            if len(by_county_uncovered_examples[county_fips]) < 5:
                by_county_uncovered_examples[county_fips].append(g.get('name', '?'))

    coverage_pct = round(
        (covered_direct + covered_via_alias + covered_with_zero_apportion) / registry_places * 100, 1
    ) if registry_places else 0.0

    by_county = {}
    for fips in sorted(by_county_total):
        total = by_county_total[fips]
        covered = by_county_covered[fips]
        by_county[fips] = {
            'name': county_names.get(fips, fips),
            'total_places': total,
            'covered': covered,
            'uncovered': total - covered,
            'coverage_pct': round(covered / total * 100, 1) if total else 0.0,
            'uncovered_examples': by_county_uncovered_examples[fips],
        }

    payload = {
        'meta': {
            'generated_at': utc_now(),
            'source_files': [
                'data/hna/geography-registry.json',
                'data/hna/place-chas.json',
                'data/hna/place-phantom-aliases.json',
            ],
            'description': (
                'Coverage of Colorado registry places by the TIGER 2024 '
                'tract-aggregated place-CHAS pipeline. Surfaced on '
                'dashboard-data-quality.html so analysts can see which '
                'places fall back to county-level data.'
            ),
        },
        'totals': {
            'registry_places':             registry_places,
            'covered_direct':              covered_direct,
            'covered_via_alias':           covered_via_alias,
            'covered_with_zero_apportion': covered_with_zero_apportion,
            'uncovered_county_fallback':   uncovered_county_fallback,
            'coverage_pct':                coverage_pct,
        },
        'by_county': by_county,
        'uncovered_places': uncovered_places,
    }
    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, sort_keys=False)

    print(f'Coverage stats written to {OUT_FILE}')
    print(f'  Total registry places:                  {registry_places}')
    print(f'  Direct TIGER place-CHAS:                {covered_direct} ({covered_direct/registry_places*100:.1f}%)')
    print(f'  Phantom-alias resolved (PR-C4):         {covered_via_alias} ({covered_via_alias/registry_places*100:.1f}%)')
    print(f'  TIGER coverage, zero apportionment:     {covered_with_zero_apportion} ({covered_with_zero_apportion/registry_places*100:.1f}%)')
    print(f'  Uncovered (county fallback):            {uncovered_county_fallback} ({uncovered_county_fallback/registry_places*100:.1f}%)')
    print(f'  Total coverage:                         {coverage_pct}%')
    return 0


if __name__ == '__main__':
    sys.exit(main())
