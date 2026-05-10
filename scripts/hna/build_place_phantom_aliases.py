#!/usr/bin/env python3
"""scripts/hna/build_place_phantom_aliases.py

Identify duplicate place entries in geography-registry.json and produce
a phantom→canonical alias map.

Background
----------
The geography-registry.json contains 29 duplicate places — each real
Colorado place (Pueblo, Englewood, Parker, Commerce City, Steamboat
Springs, Vail, Telluride, Durango, Glenwood Springs, etc.) appears
TWICE: once with the canonical Census GEOID (matching TIGER 2024) and
once with a non-Census "phantom" GEOID. The phantoms are referenced by
existing UI dropdowns + derived lookups, so we can't simply delete
them without coordinated downstream cleanup.

Effect of duplicates without aliasing
-------------------------------------
When a user picks "Pueblo (city)" in the picker, the dropdown sends
the phantom GEOID 0855745. PlaceChas.lookup('0855745') returns null
(place-chas.json only contains the canonical 0862000), so the chart
falls back to county-CHAS rather than tract-aggregated place-CHAS.
Methodologically inconsistent — Aurora gets place-level data, Pueblo
doesn't.

Output
------
    data/hna/place-phantom-aliases.json::

    {
      "meta": {
        "generated_at": "...",
        "count_aliases": 29,
        "method": "Match duplicate (name, containingCounty) in registry; identify canonical = the GEOID that exists in TIGER 2024 PLACE shapefile."
      },
      "aliases": {
        "0855745": "0862000",   # Pueblo phantom → canonical
        "0822465": "0824785",   # Englewood phantom → canonical
        ...
      }
    }

Use cases
---------
1. js/place-chas-lookup.js consumes this alias map so lookups against
   either the phantom or canonical GEOID resolve to place-CHAS data.
2. Future registry-cleanup PR can use this list to safely remove
   phantom entries (or merge them with their canonical twins).

Usage
-----
    python3 scripts/hna/build_place_phantom_aliases.py
"""

from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timezone

REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
GEO_REGISTRY = os.path.join(REPO_ROOT, 'data', 'hna', 'geography-registry.json')
TIGER_PLACE_SHP = os.path.join(REPO_ROOT, '.cache', 'tiger2024', 'place', 'tl_2024_08_place.shp')
OUT_FILE = os.path.join(REPO_ROOT, 'data', 'hna', 'place-phantom-aliases.json')


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def load_tiger_geoids() -> set[str]:
    """Return the set of GEOIDs present in the TIGER 2024 PLACE shapefile."""
    if not os.path.exists(TIGER_PLACE_SHP):
        raise FileNotFoundError(
            f'TIGER PLACE shapefile not found at {TIGER_PLACE_SHP}. '
            f'Run scripts/hna/build_place_tract_membership.py first '
            f'(or manually download tl_2024_08_place.zip into .cache/).'
        )
    import shapefile
    sf = shapefile.Reader(TIGER_PLACE_SHP)
    fields = [f[0] for f in sf.fields[1:]]
    geoid_idx = fields.index('GEOID')
    return {str(rec[geoid_idx]) for rec in sf.iterRecords()}


def main() -> int:
    with open(GEO_REGISTRY, 'r', encoding='utf-8') as f:
        reg = json.load(f)

    # Find duplicate (name, containingCounty) entries
    by_key = defaultdict(list)
    for g in reg.get('geographies', []):
        if g.get('type') in ('place', 'cdp'):
            key = (g.get('name'), g.get('containingCounty'))
            by_key[key].append(g.get('geoid'))
    duplicates = {k: v for k, v in by_key.items() if len(v) >= 2}
    print(f'Found {len(duplicates)} duplicate (name, county) pairs in registry')

    # Determine canonical GEOID for each (the one in TIGER PLACE shapefile)
    tiger_geoids = load_tiger_geoids()
    print(f'TIGER 2024 PLACE shapefile has {len(tiger_geoids)} CO place GEOIDs')

    aliases: dict[str, str] = {}
    unresolvable: list[tuple] = []
    for (name, county), geoids in sorted(duplicates.items()):
        in_tiger = [g for g in geoids if g in tiger_geoids]
        not_in_tiger = [g for g in geoids if g not in tiger_geoids]
        if len(in_tiger) == 1 and not_in_tiger:
            # Standard case: one canonical (in TIGER) + phantom(s) (not in TIGER)
            canonical = in_tiger[0]
            for phantom in not_in_tiger:
                aliases[phantom] = canonical
        else:
            unresolvable.append((name, county, geoids, in_tiger, not_in_tiger))

    print(f'Built {len(aliases)} phantom → canonical aliases')
    if unresolvable:
        print(f'⚠ {len(unresolvable)} pairs could not be resolved cleanly:')
        for u in unresolvable[:5]:
            print(f'  {u}')

    payload = {
        'meta': {
            'generated_at': utc_now(),
            'count_duplicates': len(duplicates),
            'count_aliases': len(aliases),
            'count_unresolvable': len(unresolvable),
            'tiger_vintage': 2024,
            'method': (
                'Match duplicate (name, containingCounty) pairs in '
                'geography-registry.json; identify canonical = the GEOID '
                'that exists in TIGER 2024 PLACE shapefile.'
            ),
            'note': (
                'Consumers should resolve phantom geoids via this map '
                'before looking up place data. See js/place-chas-lookup.js '
                'for an example consumer.'
            ),
        },
        'aliases': aliases,
    }
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, sort_keys=True)
    print(f'\n✓ Wrote {OUT_FILE} ({os.path.getsize(OUT_FILE):,} bytes)')

    print('\nSample aliases:')
    for k, v in list(sorted(aliases.items()))[:10]:
        # Find name for context
        name = next((g.get('name') for g in reg['geographies'] if g.get('geoid') == k), '?')
        print(f'  {k} ({name[:30]:<30}) → {v}')

    return 0


if __name__ == '__main__':
    sys.exit(main())
