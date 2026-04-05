#!/usr/bin/env python3
"""
merge_pha_resources.py — Match HUD eGIS PHAs to jurisdictions and update local-resources.json.

Reads:
  - data/market/hud_egis_co.geojson  (PHA data from HUD eGIS)
  - data/hna/local-resources.json     (existing jurisdiction resources)
  - data/hna/geo-config.json          (jurisdiction list with county assignments)

Writes:
  - data/hna/local-resources.json     (updated with housingAuthority entries)

Matching logic:
  1. Extract city/county/town names from PHA formal names.
  2. Match against jurisdiction labels in geo-config.json.
  3. For county-level PHAs, assign to the county jurisdiction and all places in that county.
  4. Log matches and mismatches for review.

Usage:
    python3 scripts/policy/merge_pha_resources.py
"""

import json
import os
import re
import sys
from collections import defaultdict

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))

PHA_FILE = os.path.join(ROOT, 'data', 'market', 'hud_egis_co.geojson')
RESOURCES_FILE = os.path.join(ROOT, 'data', 'hna', 'local-resources.json')
GEO_CONFIG_FILE = os.path.join(ROOT, 'data', 'hna', 'geo-config.json')


def load_json(path: str) -> dict:
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_json(path: str, data: dict) -> None:
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f'  Wrote {path}')


def normalize(name: str) -> str:
    """Lowercase, strip parenthetical suffixes like (city), remove punctuation."""
    name = re.sub(r'\s*\(.*?\)\s*', ' ', name)
    name = name.lower().strip()
    name = re.sub(r'[^a-z0-9\s]', '', name)
    return re.sub(r'\s+', ' ', name).strip()


def extract_locality_from_pha(formal_name: str) -> tuple:
    """
    Extract the locality name and type (city/county/town) from a PHA formal name.

    Returns (locality_name, type) where type is 'city', 'county', 'town', or 'other'.
    Examples:
      "Housing Authority of the City of Aurora" -> ("Aurora", "city")
      "Boulder County Housing Authority"        -> ("Boulder", "county")
      "Housing Authority of the Town of Yuma"   -> ("Yuma", "town")
      "Fort Collins Housing Authority"          -> ("Fort Collins", "city")
      "Denver Housing Authority"                -> ("Denver", "city")
    """
    name = formal_name.strip()

    # Skip statewide/non-local entities
    statewide = ['Colorado Division of Housing', 'Colorado Housing Finance Authority',
                 'Colorado Bluesky Enterprises']
    for sw in statewide:
        if sw.lower() in name.lower():
            return (None, 'statewide')

    # Pattern: "Housing Authority of the City of <Name>"
    m = re.search(r'Housing Authority (?:of|for) the City of (.+)', name, re.I)
    if m:
        return (m.group(1).strip(), 'city')

    # Pattern: "Housing Authority of the Town of <Name>"
    m = re.search(r'Housing Authority (?:of|for) the Town of (.+)', name, re.I)
    if m:
        return (m.group(1).strip(), 'town')

    # Pattern: "Housing Authority of the City and County of <Name>"
    m = re.search(r'Housing Authority of the City and County of (.+)', name, re.I)
    if m:
        return (m.group(1).strip(), 'city_county')

    # Pattern: "Housing Authority of the County of <Name>"
    m = re.search(r'Housing Authority (?:of|for) the County of (.+)', name, re.I)
    if m:
        return (m.group(1).strip(), 'county')

    # Pattern: "<County> County Housing Authority"
    m = re.match(r'(.+?)\s+County Housing Authority', name, re.I)
    if m:
        return (m.group(1).strip(), 'county')

    # Pattern: "Housing Authority of <County> County"
    m = re.search(r'Housing Authority of (.+?)\s+County', name, re.I)
    if m:
        return (m.group(1).strip(), 'county')

    # Pattern: "<Name> Housing Authority" (generic city/town)
    m = re.match(r'(.+?)\s+Housing (?:Authority|Partners)', name, re.I)
    if m:
        extracted = m.group(1).strip()
        # Don't match if the name is too generic
        if len(extracted) > 2:
            return (extracted, 'city')

    return (None, 'unknown')


def build_geo_indexes(geo_config: dict) -> tuple:
    """
    Build lookup indexes from geo-config.json.

    Returns:
      - name_to_jurisdictions: dict mapping normalized name -> list of (key, geoid, county_geoid)
      - county_geoid_to_key: dict mapping county geoid -> resource key (e.g. "county:08001")
      - county_geoid_to_places: dict mapping county geoid -> list of place/cdp resource keys
    """
    name_to_jurisdictions = defaultdict(list)
    county_geoid_to_key = {}
    county_geoid_to_places = defaultdict(list)

    # Index counties
    for c in geo_config.get('counties', []):
        geoid = c['geoid']
        label = c['label']
        key = f'county:{geoid}'
        county_geoid_to_key[geoid] = key

        # Extract county name without "County" suffix
        county_name = label.replace(' County', '').strip()
        name_to_jurisdictions[normalize(county_name)].append({
            'key': key, 'geoid': geoid, 'type': 'county', 'label': label
        })

    # Index featured items (these are the ones in local-resources)
    for item in geo_config.get('featured', []):
        geoid = item['geoid']
        label = item['label']
        itype = item.get('type', 'county')
        containing_county = item.get('containingCounty')

        if itype == 'county':
            key = f'county:{geoid}'
        elif itype == 'cdp':
            key = f'cdp:{geoid}'
        else:
            key = f'place:{geoid}'

        # Extract place name (remove parenthetical like "(city)", "(CDP)")
        place_name = re.sub(r'\s*\(.*?\)\s*$', '', label).strip()
        name_to_jurisdictions[normalize(place_name)].append({
            'key': key, 'geoid': geoid, 'type': itype, 'label': label,
            'containingCounty': containing_county
        })

        if containing_county:
            county_geoid_to_places[containing_county].append(key)

    # Also index all places (not just featured) for broader matching
    for item in geo_config.get('places', []):
        geoid = item['geoid']
        label = item['label']
        containing_county = item.get('containingCounty')
        key = f'place:{geoid}'

        place_name = re.sub(r'\s*\(.*?\)\s*$', '', label).strip()
        norm = normalize(place_name)
        # Only add if not already present from featured
        existing_keys = {j['key'] for j in name_to_jurisdictions.get(norm, [])}
        if key not in existing_keys:
            name_to_jurisdictions[norm].append({
                'key': key, 'geoid': geoid, 'type': 'place', 'label': label,
                'containingCounty': containing_county
            })

        if containing_county:
            if key not in county_geoid_to_places.get(containing_county, []):
                county_geoid_to_places[containing_county].append(key)

    # Index CDPs
    for item in geo_config.get('cdps', []):
        geoid = item['geoid']
        label = item['label']
        containing_county = item.get('containingCounty')
        key = f'cdp:{geoid}'

        place_name = re.sub(r'\s*\(.*?\)\s*$', '', label).strip()
        norm = normalize(place_name)
        existing_keys = {j['key'] for j in name_to_jurisdictions.get(norm, [])}
        if key not in existing_keys:
            name_to_jurisdictions[norm].append({
                'key': key, 'geoid': geoid, 'type': 'cdp', 'label': label,
                'containingCounty': containing_county
            })

        if containing_county:
            if key not in county_geoid_to_places.get(containing_county, []):
                county_geoid_to_places[containing_county].append(key)

    return name_to_jurisdictions, county_geoid_to_key, county_geoid_to_places


def build_pha_entry(props: dict) -> dict:
    """Build a housingAuthority entry from PHA GeoJSON properties."""
    entry = {
        'name': props.get('FORMAL_PARTICIPANT_NAME', ''),
    }
    email = props.get('HA_EMAIL_ADDR_TEXT')
    if email:
        entry['contact'] = email
    total = props.get('TOTAL_UNITS', 0)
    s8 = props.get('SECTION8_UNITS_CNT', 0)
    combined = (total or 0) + (s8 or 0)
    if combined > 0:
        entry['totalUnits'] = combined
    code = props.get('PARTICIPANT_CODE')
    if code:
        entry['phaCode'] = code
    return entry


def main() -> int:
    print('=== merge_pha_resources.py ===')

    # Load data
    print('Loading data files…')
    pha_data = load_json(PHA_FILE)
    resources = load_json(RESOURCES_FILE)
    geo_config = load_json(GEO_CONFIG_FILE)

    features = pha_data.get('features', [])
    print(f'  PHAs loaded: {len(features)}')
    print(f'  Jurisdictions in local-resources: {len(resources)}')

    # Build indexes
    name_to_jurisdictions, county_geoid_to_key, county_geoid_to_places = build_geo_indexes(geo_config)

    # Track matching stats
    matched_phas = []
    unmatched_phas = []
    jurisdiction_updates = defaultdict(list)  # key -> list of PHA entries

    # Match each PHA to jurisdictions
    print('\nMatching PHAs to jurisdictions…')
    for feat in features:
        props = feat.get('properties', {})
        formal_name = props.get('FORMAL_PARTICIPANT_NAME', '')
        city = props.get('STD_CITY', '')

        locality, loc_type = extract_locality_from_pha(formal_name)

        if loc_type == 'statewide':
            print(f'  SKIP (statewide): {formal_name}')
            continue

        pha_entry = build_pha_entry(props)
        matched = False

        if loc_type == 'county':
            # County-level PHA: assign to the county
            norm_loc = normalize(locality)
            matches = name_to_jurisdictions.get(norm_loc, [])
            county_matches = [m for m in matches if m['type'] == 'county']
            if county_matches:
                for cm in county_matches:
                    jurisdiction_updates[cm['key']].append(pha_entry)
                    print(f'  MATCH (county): {formal_name} -> {cm["key"]} ({cm["label"]})')
                matched = True

        elif loc_type in ('city', 'town', 'city_county'):
            # City/town PHA: match to place, then also to containing county
            norm_loc = normalize(locality)
            matches = name_to_jurisdictions.get(norm_loc, [])

            # Try place matches first
            place_matches = [m for m in matches if m['type'] in ('place', 'cdp')]
            if place_matches:
                for pm in place_matches:
                    jurisdiction_updates[pm['key']].append(pha_entry)
                    print(f'  MATCH (place): {formal_name} -> {pm["key"]} ({pm["label"]})')
                    # Also add to containing county
                    cc = pm.get('containingCounty')
                    if cc and f'county:{cc}' in resources:
                        jurisdiction_updates[f'county:{cc}'].append(pha_entry)
                        print(f'    +county: {formal_name} -> county:{cc}')
                matched = True

            # If city_county type (e.g. Denver), also match county directly
            if loc_type == 'city_county':
                county_matches = [m for m in matches if m['type'] == 'county']
                for cm in county_matches:
                    if cm['key'] not in jurisdiction_updates or pha_entry not in jurisdiction_updates[cm['key']]:
                        jurisdiction_updates[cm['key']].append(pha_entry)
                        print(f'  MATCH (city_county): {formal_name} -> {cm["key"]} ({cm["label"]})')
                matched = True

            # If no place match, try matching by STD_CITY field
            if not matched and city:
                norm_city = normalize(city)
                city_matches = name_to_jurisdictions.get(norm_city, [])
                place_city_matches = [m for m in city_matches if m['type'] in ('place', 'cdp')]
                if place_city_matches:
                    for pm in place_city_matches:
                        jurisdiction_updates[pm['key']].append(pha_entry)
                        print(f'  MATCH (city field): {formal_name} -> {pm["key"]} ({pm["label"]})')
                        cc = pm.get('containingCounty')
                        if cc and f'county:{cc}' in resources:
                            jurisdiction_updates[f'county:{cc}'].append(pha_entry)
                    matched = True

        if not matched and locality:
            # Last resort: try matching locality against all jurisdiction names
            norm_loc = normalize(locality)
            all_matches = name_to_jurisdictions.get(norm_loc, [])
            if all_matches:
                for m in all_matches:
                    jurisdiction_updates[m['key']].append(pha_entry)
                    print(f'  MATCH (fallback): {formal_name} -> {m["key"]} ({m["label"]})')
                matched = True

        if not matched and city:
            # Very last resort: match by STD_CITY
            norm_city = normalize(city)
            city_matches = name_to_jurisdictions.get(norm_city, [])
            if city_matches:
                for m in city_matches:
                    jurisdiction_updates[m['key']].append(pha_entry)
                    print(f'  MATCH (city fallback): {formal_name} -> {m["key"]} ({m["label"]})')
                matched = True

        if matched:
            matched_phas.append(formal_name)
        else:
            unmatched_phas.append(formal_name)
            print(f'  UNMATCHED: {formal_name} (locality={locality}, city={city})')

    # Apply updates to local-resources
    print(f'\nApplying updates…')
    updated_count = 0
    new_count = 0

    for key, pha_list in jurisdiction_updates.items():
        if key not in resources:
            # Only create entries for keys that exist in local-resources already
            continue

        existing = resources[key].get('housingAuthority', [])
        existing_names = {normalize(e.get('name', '')) for e in existing}

        added = 0
        for pha in pha_list:
            norm_name = normalize(pha['name'])
            if norm_name not in existing_names:
                existing.append(pha)
                existing_names.add(norm_name)
                added += 1
                new_count += 1

        if added > 0 or 'housingAuthority' not in resources[key]:
            resources[key]['housingAuthority'] = existing
            updated_count += 1

    # Summary
    print(f'\n=== Summary ===')
    print(f'  PHAs matched:    {len(matched_phas)} / {len(features)}')
    print(f'  PHAs unmatched:  {len(unmatched_phas)}')
    print(f'  Jurisdictions updated: {updated_count}')
    print(f'  New PHA entries added: {new_count}')

    if unmatched_phas:
        print(f'\n  Unmatched PHAs:')
        for name in sorted(unmatched_phas):
            print(f'    - {name}')

    # Save updated resources
    print(f'\nSaving updated local-resources.json…')
    save_json(RESOURCES_FILE, resources)

    return 0


if __name__ == '__main__':
    sys.exit(main())
