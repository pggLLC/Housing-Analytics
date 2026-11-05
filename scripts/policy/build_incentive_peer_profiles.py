#!/usr/bin/env python3
"""Build data/policy/incentive-peer-profiles.json: the few facts the Local
Housing Incentives page uses to find places similar to the one a reader picks.

For every county and municipality (no CDPs: they have no government of their
own) it copies:
  - level and market pattern (type) from data/market/market-types.json,
  - region from data/hna/ranking-index.json,
  - population from data/market/market-types.json readings (ACS, as that file
    already carries it).

The page, not this file, chooses peers, because who has been researched
changes with every batch of incentive records (js/local-incentives-data.js,
peers()). Nothing here is scored. The file carries no timestamp of its own, so
a rebuild that changes no input leaves it byte-identical.

Usage: python3 scripts/policy/build_incentive_peer_profiles.py [--out PATH]
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'data', 'policy', 'incentive-peer-profiles.json')
P = lambda *a: os.path.join(ROOT, *a)


def load(*parts):
    with open(P(*parts), encoding='utf-8') as fh:
        return json.load(fh)


def build():
    geo = load('data', 'hna', 'geo-config.json')
    types = load('data', 'market', 'market-types.json')
    ranking = load('data', 'hna', 'ranking-index.json')
    region = {r['geoid']: r.get('region') for r in ranking.get('rankings', [])}
    wanted = {g['geoid']: 'county' for g in geo['counties']}
    wanted.update({g['geoid']: 'municipality' for g in geo['places']})

    places = {}
    for geoid in sorted(wanted):
        t = types['places'].get(geoid) or {}
        pop = (t.get('readings') or {}).get('population')
        places[geoid] = {
            'level': wanted[geoid],
            'region': region.get(geoid),
            'type': t.get('type'),
            'population': pop if isinstance(pop, (int, float)) and pop > 0 else None,
        }

    labels = {k: v.get('label') for k, v in (types['meta'].get('types') or {}).items()}
    return {
        'meta': {
            'title': 'Peer profiles for the Local Housing Incentives page',
            'generator': 'scripts/policy/build_incentive_peer_profiles.py',
            'inputs': ['data/hna/geo-config.json', 'data/market/market-types.json', 'data/hna/ranking-index.json'],
            'market_types_generated_at': types['meta'].get('generated_at'),
            'type_labels': labels,
            'rule': ('Similar places are counties compared with counties and municipalities with municipalities, '
                     'with the same market pattern (unless a place has too little data to type), within four times the population, same region first, '
                     'then closest in population. Only places whose incentive sources have been read are shown. '
                     'Chosen on the page from the current records; nothing here is scored.'),
        },
        'places': places,
    }


def main(argv):
    out = OUT
    if '--out' in argv:
        out = argv[argv.index('--out') + 1]
    data = build()
    with open(out, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    print(f'incentive peer profiles: {len(data["places"])} counties and municipalities -> {out}')


if __name__ == '__main__':
    main(sys.argv[1:])
