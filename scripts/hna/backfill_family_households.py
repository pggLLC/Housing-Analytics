#!/usr/bin/env python3
"""Backfill family households (ACS table B11001) into data/hna/summary/*.json.

Why: the housing-type ranking's family-rental score needs the share of
households that are families. The ACS profile has had no such line since 2019
(DP02_0003 now means "married-couple household with children under 18"), so
the score read a field no summary carried and dropped 60% of its weight for
every place. This writes B11001_001E (households) and B11001_002E (family
households) into each summary's acsProfile, stamped _b11001Year/_b11001Series.

Source: the Census Bureau's ACS 5-year table-based summary file, which needs no
API key (https://www2.census.gov/programs-surveys/acs/summary_file/). Pass a
downloaded copy with --file, or let the script fetch it.

    python3 scripts/hna/backfill_family_households.py [--year 2024] [--file PATH] [--dry]

The state summary (08.json) is skipped: its own ACS 1-year fetch refreshes it,
and it may carry only fields that fetch covers.

build_hna_data.py never requests these fields, so its merge-preserve step
carries them from disk on every rebuild. Rerun this when the ACS year moves.
"""
import argparse
import json
import os
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SUMMARY_DIR = os.path.join(ROOT, 'data', 'hna', 'summary')


def source_url(year: int) -> str:
    return ('https://www2.census.gov/programs-surveys/acs/summary_file/'
            f'{year}/table-based-SF/data/5YRData/acsdt5y{year}-b11001.dat')


def sf_geo_id(geoid: str):
    """Summary geoid -> summary-file GEO_ID (state 08, county 08xxx, place or CDP 08xxxxx)."""
    g = str(geoid)
    prefix = {2: '0400000US', 5: '0500000US', 7: '1600000US'}.get(len(g))
    return prefix + g if prefix else None


def parse_b11001(text: str) -> dict:
    lines = text.splitlines()
    head = lines[0].split('|')
    try:
        i_geo, i_tot, i_fam = head.index('GEO_ID'), head.index('B11001_E001'), head.index('B11001_E002')
    except ValueError:
        raise SystemExit('Not a B11001 summary file: ' + lines[0][:120])
    out = {}
    for line in lines[1:]:
        c = line.split('|')
        if len(c) <= max(i_geo, i_tot, i_fam) or 'US08' not in c[i_geo]:
            continue
        try:
            tot, fam = int(c[i_tot]), int(c[i_fam])
        except ValueError:
            continue
        if tot >= 0 and fam >= 0:
            out[c[i_geo]] = (tot, fam)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--year', type=int, default=2024)
    ap.add_argument('--file')
    ap.add_argument('--dry', action='store_true')
    a = ap.parse_args(argv)
    if a.file:
        with open(a.file, encoding='utf-8') as f:
            text = f.read()
    else:
        with urllib.request.urlopen(source_url(a.year), timeout=120) as r:
            text = r.read().decode('utf-8')
    rows = parse_b11001(text)
    written, missing = 0, []
    for name in sorted(os.listdir(SUMMARY_DIR)):
        if not name.endswith('.json'):
            continue
        path = os.path.join(SUMMARY_DIR, name)
        with open(path, encoding='utf-8') as f:
            raw = f.read()
        rec = json.loads(raw)
        geoid = (rec.get('geo') or {}).get('geoid') or name[:-5]
        if len(str(geoid)) == 2:
            continue  # state: refreshed by its own 1-year fetch
        prof = rec.get('acsProfile')
        row = rows.get(sf_geo_id(geoid))
        if not isinstance(prof, dict) or row is None:
            missing.append(geoid)
            continue
        if (prof.get('B11001_001E'), prof.get('B11001_002E'), prof.get('_b11001Year')) == (row[0], row[1], a.year):
            continue
        prof['B11001_001E'], prof['B11001_002E'] = row
        prof['_b11001Year'], prof['_b11001Series'] = a.year, 'acs5'
        written += 1
        if not a.dry:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(json.dumps(rec, ensure_ascii=False) + ('\n' if raw.endswith('\n') else ''))
    print(f"B11001 {a.year}: {written} summaries updated{' (dry run)' if a.dry else ''}; "
          f"{len(missing)} without a row: {', '.join(missing) or 'none'}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
