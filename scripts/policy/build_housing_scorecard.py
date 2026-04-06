#!/usr/bin/env python3
"""Build the Housing Policy Commitment Scorecard.

Reads existing policy/data files and produces a per-jurisdiction scorecard
with 7 dimensions scored as true/false/null (unknown).

Output: data/policy/housing-policy-scorecard.json
"""

import json
import os
import re
import unicodedata
from datetime import datetime, timezone

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

INPUTS = {
    'ranking_index': os.path.join(ROOT, 'data', 'hna', 'ranking-index.json'),
    'geo_config': os.path.join(ROOT, 'data', 'hna', 'geo-config.json'),
    'prop123': os.path.join(ROOT, 'data', 'policy', 'prop123_jurisdictions.json'),
    'local_resources': os.path.join(ROOT, 'data', 'hna', 'local-resources.json'),
    'iz': os.path.join(ROOT, 'data', 'market', 'inclusionary_zoning_co.json'),
    'soft_funding': os.path.join(ROOT, 'data', 'policy', 'soft-funding-status.json'),
}

OUTPUT = os.path.join(ROOT, 'data', 'policy', 'housing-policy-scorecard.json')

DIMENSIONS = [
    {'id': 'has_hna', 'label': 'Has Housing Needs Assessment'},
    {'id': 'prop123_committed', 'label': 'Proposition 123 Committed'},
    {'id': 'has_housing_authority', 'label': 'Has Housing Authority'},
    {'id': 'has_housing_nonprofits', 'label': 'Has Housing Nonprofits'},
    {'id': 'has_comp_plan', 'label': 'Housing in Comprehensive Plan'},
    {'id': 'has_iz_ordinance', 'label': 'Zoning Incentives / IZ Ordinance'},
    {'id': 'has_local_funding', 'label': 'Affordable Housing Funding'},
]


def load_json(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def normalize_name(name):
    """Normalize a jurisdiction name for fuzzy matching.

    Strips prefixes like 'City of', 'Town of', suffixes like ' city', ' town',
    parenthetical labels like '(city)', '(town)', ' County', and diacritics.
    """
    s = name.strip()
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r'^City and County of\s+', '', s, flags=re.I)
    s = re.sub(r'^City of\s+', '', s, flags=re.I)
    s = re.sub(r'^Town of\s+', '', s, flags=re.I)
    s = re.sub(r'\s*\((city|town|village|CDP)\)\s*$', '', s, flags=re.I)
    s = re.sub(r'\s+(city|town|village|CDP)$', '', s, flags=re.I)
    s = re.sub(r'\s+County$', '', s, flags=re.I)
    return s.strip().lower()


def build_prop123_lookup(prop123_data):
    """Build a name→entry lookup from prop123_jurisdictions.json."""
    lookup = {}
    for entry in prop123_data.get('jurisdictions', []):
        key = normalize_name(entry['name'])
        lookup[key] = entry
    return lookup


def build_iz_lookup(iz_data):
    """Build a name→entry lookup from inclusionary_zoning_co.json."""
    lookup = {}
    for entry in iz_data.get('ordinances', iz_data.get('jurisdictions', [])):
        key = normalize_name(entry.get('jurisdiction', ''))
        lookup[key] = entry
    return lookup


def build_local_funding_counties(sf_data):
    """Return set of county FIPS codes that have local (non-statewide) funding."""
    counties = set()
    for _prog_id, prog in sf_data.get('programs', {}).items():
        county = prog.get('county', '')
        if county and county not in ('All', 'Selected', 'N/A'):
            counties.add(county)
    return counties


def main():
    print('Loading data sources...')
    geo_config = load_json(INPUTS['geo_config'])
    prop123 = load_json(INPUTS['prop123'])
    local_res = load_json(INPUTS['local_resources'])
    iz = load_json(INPUTS['iz'])
    soft_funding = load_json(INPUTS['soft_funding'])

    # Try ranking-index first; fall back to geo-config for the geography list
    try:
        ranking = load_json(INPUTS['ranking_index'])
        entries = ranking.get('entries', ranking.get('rankings', []))
    except Exception:
        entries = []

    # Build canonical geography list from geo-config
    all_geos = []
    for c in geo_config.get('counties', []):
        all_geos.append({'geoid': c['geoid'], 'label': c['label'], 'type': 'county',
                         'containingCounty': c['geoid']})
    for p in geo_config.get('places', []):
        all_geos.append({'geoid': p['geoid'], 'label': p['label'], 'type': 'place',
                         'containingCounty': p.get('containingCounty')})
    for d in geo_config.get('cdps', []):
        all_geos.append({'geoid': d['geoid'], 'label': d['label'], 'type': 'cdp',
                         'containingCounty': d.get('containingCounty')})

    print(f'  Geographies: {len(all_geos)}')

    # Build lookups
    p123_lookup = build_prop123_lookup(prop123)
    iz_lookup = build_iz_lookup(iz)
    local_funding_counties = build_local_funding_counties(soft_funding)

    print(f'  Prop 123 entries: {len(p123_lookup)}')
    print(f'  IZ entries: {len(iz_lookup)}')
    print(f'  Local funding counties: {local_funding_counties}')
    print(f'  Local resources keys: {len(local_res)}')

    # Score each geography
    scores = {}
    stats = {d['id']: {'true': 0, 'false': 0, 'null': 0} for d in DIMENSIONS}

    for geo in all_geos:
        geoid = geo['geoid']
        label = geo['label']
        geo_type = geo['type']
        containing_county = geo.get('containingCounty')
        norm = normalize_name(label)

        # Local resources key format: "county:08001", "place:0804000", "cdp:0815165"
        lr_key = f'{geo_type}:{geoid}'
        lr = local_res.get(lr_key)
        # For places/CDPs, inherit county-level data if no place-specific entry exists
        lr_county = local_res.get(f'county:{containing_county}') if containing_county else None

        dims = {}

        # 1. has_hna — check local-resources housingPlans for type "HNA"
        if lr and lr.get('housingPlans'):
            dims['has_hna'] = any(
                p.get('type', '').upper() in ('HNA', 'HOUSING NEEDS ASSESSMENT')
                for p in lr['housingPlans']
            )
        else:
            dims['has_hna'] = None

        # 2. prop123_committed — check prop123 jurisdictions
        p123_match = p123_lookup.get(norm)
        if not p123_match and geo_type == 'county':
            # Try without "county" suffix for county matches
            alt = norm.replace(' county', '').strip()
            p123_match = p123_lookup.get(alt)
        if p123_match:
            dims['prop123_committed'] = p123_match.get('status', '') in ('Committed', 'Commitment Met')
        else:
            # CDPs and small towns unlikely to have Prop 123 commitments — mark as false
            # Counties not found are genuinely not committed
            if geo_type in ('county', 'place'):
                dims['prop123_committed'] = False
            else:
                dims['prop123_committed'] = None

        # 3. has_housing_authority — check place entry, then fall back to county
        ha = (lr or {}).get('housingAuthority', []) or (lr_county or {}).get('housingAuthority', [])
        if ha:
            dims['has_housing_authority'] = True
        elif lr or lr_county:
            dims['has_housing_authority'] = False
        else:
            dims['has_housing_authority'] = None

        # 4. has_housing_nonprofits — check place entry, then fall back to county
        adv = (lr or {}).get('advocacy', []) or (lr_county or {}).get('advocacy', [])
        if adv:
            dims['has_housing_nonprofits'] = True
        elif lr or lr_county:
            dims['has_housing_nonprofits'] = False
        else:
            dims['has_housing_nonprofits'] = None

        # 5. has_comp_plan — check local-resources housingPlans for comp plan type
        #    Colorado counties are required to have master plans (C.R.S. § 30-28-106).
        #    Incorporated places > 2,000 population typically have comprehensive plans.
        if lr and lr.get('housingPlans'):
            dims['has_comp_plan'] = any(
                p.get('type', '').lower() in ('comprehensive plan', 'master plan', 'comp plan')
                for p in lr['housingPlans']
            )
        elif geo_type == 'county':
            # All 64 Colorado counties are required to adopt master plans
            dims['has_comp_plan'] = True
        else:
            dims['has_comp_plan'] = None

        # 6. has_iz_ordinance — check inclusionary zoning data
        #    IZ research covers all 64 counties and major municipalities.
        #    Jurisdictions not in the IZ dataset but of type 'county' or larger
        #    places are marked false (researched, no IZ found).
        iz_match = iz_lookup.get(norm)
        if iz_match:
            dims['has_iz_ordinance'] = bool(iz_match.get('has_iz'))
        elif geo_type == 'county':
            # All counties were researched; absence = no IZ ordinance
            dims['has_iz_ordinance'] = False
        else:
            dims['has_iz_ordinance'] = None

        # 7. has_local_funding — check if containing county has local funding programs
        #    Places/CDPs inherit their containing county's funding programs.
        if containing_county and containing_county in local_funding_counties:
            dims['has_local_funding'] = True
        elif geo_type == 'county' and geoid in local_funding_counties:
            dims['has_local_funding'] = True
        elif geo_type == 'county':
            # Counties without known programs — definitively no local funding
            dims['has_local_funding'] = False
        elif containing_county:
            # Places/CDPs: if their county has no funding, they don't either
            dims['has_local_funding'] = containing_county in local_funding_counties
        else:
            dims['has_local_funding'] = None

        # Calculate aggregate
        total_score = sum(1 for v in dims.values() if v is True)
        known_dims = sum(1 for v in dims.values() if v is not None)

        scores[geoid] = {
            'geoid': geoid,
            'name': label,
            'type': geo_type,
            'totalScore': total_score,
            'knownDimensions': known_dims,
            'maxPossible': len(DIMENSIONS),
            'dimensions': dims,
        }

        for dim_id, val in dims.items():
            if val is True:
                stats[dim_id]['true'] += 1
            elif val is False:
                stats[dim_id]['false'] += 1
            else:
                stats[dim_id]['null'] += 1

    # Write output
    payload = {
        'metadata': {
            'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            'version': '1.0',
            'dimensionCount': len(DIMENSIONS),
            'jurisdictionsScored': len(scores),
            'dataSources': {
                'prop123': 'data/policy/prop123_jurisdictions.json',
                'localResources': 'data/hna/local-resources.json',
                'inclusionaryZoning': 'data/market/inclusionary_zoning_co.json',
                'softFunding': 'data/policy/soft-funding-status.json',
            },
            'stats': stats,
        },
        'dimensions': DIMENSIONS,
        'scores': scores,
    }

    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, 'w', encoding='utf-8') as f:
        json.dump(payload, f)

    print(f'\nWrote {os.path.getsize(OUTPUT):,} bytes to {OUTPUT}')
    print(f'Jurisdictions scored: {len(scores)}')
    print('\nDimension coverage:')
    for d in DIMENSIONS:
        s = stats[d['id']]
        print(f"  {d['label']}: {s['true']} yes, {s['false']} no, {s['null']} unknown")


if __name__ == '__main__':
    main()
