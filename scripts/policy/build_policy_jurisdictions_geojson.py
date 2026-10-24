#!/usr/bin/env python3
"""Refresh the Housing policy jurisdictions map layer from the scorecard.

The layer's county and place outlines came from TIGERweb once (2026-04-09)
and do not change; its scores do. Before this script the properties were a
hand-built snapshot that drifted from the scorecard. Now the outlines are
kept and every property is rewritten from the current scorecard, so the map
and the scorecard page always agree.

Input:  data/policy/housing-policy-scorecard.json
Output: data/market/housing_policy_jurisdictions_co.geojson (rewritten in place)

Unknown dimensions stay null (the map shows only the dimensions that are
known to be true). build_housing_scorecard.py checks the layer with build()
before writing either file, so the two never disagree.
"""

import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SCORECARD = os.path.join(ROOT, 'data', 'policy', 'housing-policy-scorecard.json')
LAYER = os.path.join(ROOT, 'data', 'market', 'housing_policy_jurisdictions_co.geojson')


def build(card):
    """Return the refreshed layer for this scorecard, or raise ValueError.

    Writes nothing, so the scorecard build can check the layer before it
    overwrites either file.
    """
    with open(LAYER, encoding='utf-8') as f:
        layer = json.load(f)

    scores = card['scores']
    dims = [d['id'] for d in card['dimensions']]
    as_of = card['metadata']['generatedAt'][:10]

    missing = [f['properties']['geoid'] for f in layer['features']
               if f['properties']['geoid'] not in scores]
    if missing:
        # An outline with no score would silently keep stale values.
        raise ValueError('no scorecard row for %s' % ', '.join(missing))

    for feat in layer['features']:
        geoid = feat['properties']['geoid']
        rec = scores[geoid]
        props = {
            'geoid': geoid,
            'name': rec['name'],
            'geo_type': feat['properties'].get('geo_type') or rec.get('type'),
            'totalScore': rec['totalScore'],
            'knownDimensions': rec.get('knownDimensions'),
            'maxPossible': rec['maxPossible'],
        }
        for d in dims:
            props[d] = rec['dimensions'].get(d)
        feat['properties'] = props

    return {
        'type': 'FeatureCollection',
        'source': ('data/policy/housing-policy-scorecard.json (Prop 123 filings, HNA and '
                   'local-resources records, inclusionary zoning list, soft-funding status); '
                   'outlines: Census TIGERweb'),
        'source_url': 'https://tigerweb.geo.census.gov/tigerwebmain/TIGERweb_main.html',
        'as_of': as_of,
        'note': 'Scores rebuilt from the housing policy scorecard on each scorecard build.',
        'features': layer['features'],
    }


def write(out):
    with open(LAYER, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote %s: %d jurisdictions, scores as of %s'
          % (os.path.relpath(LAYER, ROOT), len(out['features']), out['as_of']))


def main():
    with open(SCORECARD, encoding='utf-8') as f:
        card = json.load(f)
    try:
        out = build(card)
    except ValueError as e:
        print('build_policy_jurisdictions_geojson: %s' % e, file=sys.stderr)
        return 1
    write(out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
