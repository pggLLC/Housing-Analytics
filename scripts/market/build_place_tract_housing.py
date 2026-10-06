#!/usr/bin/env python3
"""Aggregate Census 2020 block HU100 to place × tract, never land area.

The PL geographic header assigns each block to its 2020 place and tract.
Unincorporated blocks remain in tract denominators, not a fictitious place.
"""
from __future__ import annotations
import argparse
import csv
import hashlib
import io
import json
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'data/market/census2020-place-tract-housing-co.json'
SOURCE_URL = 'https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171/Colorado/co2020.pl.zip'
LAYOUT_URL = 'https://www2.census.gov/programs-surveys/decennial/rdo/about/2020-census-program/Phase3/SupportMaterials/2020_PLSummaryFile_FieldNames.xlsx'
# Zero-based positions from the official "2020 P.L. Geoheader Fields" row.
FIELDS = {'SUMLEV': 2, 'GEOVAR': 3, 'GEOCOMP': 4, 'GEOID': 8, 'STATE': 12,
          'COUNTY': 14, 'PLACE': 29, 'TRACT': 32, 'BLOCK': 34, 'HU100': 91}


def aggregate(stream, names):
    tracts = defaultdict(int)
    overlaps = defaultdict(lambda: defaultdict(int))
    seen = set()
    statewide_units = None
    for values in csv.reader(stream, delimiter='|'):
        if len(values) != 97:
            raise ValueError('Census PL geographic-header layout changed')
        r = {k: values[i] for k, i in FIELDS.items()}
        if r['STATE'] != '08' or r['GEOVAR'] != '00' or r['GEOCOMP'] != '00':
            continue
        if r['SUMLEV'] == '040':
            statewide_units = int(r['HU100'])
        if r['SUMLEV'] != '750':
            continue
        if r['GEOID'] in seen:
            raise ValueError('Duplicate Census block: ' + r['GEOID'])
        seen.add(r['GEOID'])
        hu = int(r['HU100'])
        if hu < 0:
            raise ValueError('Negative block housing units')
        tract = r['STATE'] + r['COUNTY'] + r['TRACT']
        tracts[tract] += hu
        if r['PLACE'] and r['PLACE'] != '99999':
            overlaps['08' + r['PLACE']][tract] += hu
    if not seen or statewide_units is None or sum(tracts.values()) != statewide_units:
        raise ValueError('Block housing units do not reconcile with the published state total')
    places = {}
    for geoid, counts in sorted(overlaps.items()):
        places[geoid] = {'name': names.get(geoid, geoid), 'housing_units': sum(counts.values()),
            'tracts': [{'tract_geoid': tract, 'housing_units': units,
                        'tract_housing_units': tracts[tract]}
                       for tract, units in sorted(counts.items())]}
    return {'meta': {'source': '2020 Census PL 94-171 geographic header, block HU100',
        'source_url': SOURCE_URL, 'layout_url': LAYOUT_URL, 'vintage': 2020,
        'method': 'Sum block housing units within each Census-assigned place and tract; divide by all housing units in the tract, including unincorporated blocks.',
        'limitations': '2020 block/place boundaries and housing counts; subsequent annexation and construction are not inferred from land area.',
        'block_count': len(seen), 'county_count': len({t[:5] for t in tracts}),
        'state_housing_units': statewide_units},
        'tract_housing_units': dict(sorted(tracts.items())), 'places': places}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, help='Cached official co2020.pl.zip')
    args = parser.parse_args()
    raw = args.source.read_bytes() if args.source else urllib.request.urlopen(SOURCE_URL, timeout=180).read()
    cfg = json.loads((ROOT / 'data/hna/geo-config.json').read_text())
    names = {g['geoid']: g['label'] for kind in ('places', 'cdps') for g in cfg[kind]}
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        with io.TextIOWrapper(z.open('cogeo2020.pl'), encoding='latin1') as stream:
            result = aggregate(stream, names)
    result['meta']['source_sha256'] = hashlib.sha256(raw).hexdigest()
    OUT.write_text(json.dumps(result, indent=2) + '\n')
    print(f"Wrote {OUT}: {result['meta']['block_count']} blocks, {len(result['places'])} places")


if __name__ == '__main__':
    main()
