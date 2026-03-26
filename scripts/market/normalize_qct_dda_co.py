#!/usr/bin/env python3
"""
normalize_qct_dda_co.py — Normalize QCT/DDA designations into map-ready format
===============================================================================
Reads  : data/market/qct_dda_designations_co.json
Writes : data/market/qct_dda_designations_co_normalized.json

The input file (produced by scripts/market/fetch_qct_dda.py) has the shape:

  {
    "meta": { … },
    "designations": [
      { "geoid": "08013950100", "type": "QCT", "county_fips": "08013", … },
      …
    ]
  }

The output has a standardized structure suitable for county choropleth and
tract-level overlays:

  {
    "meta": { … (original meta + normalization audit fields) },
    "counties": {
      "08013": { "fips": "08013", "qct_tracts": […], "dda_tracts": [], "is_dda": false },
      …
    },
    "tracts": [
      {
        "geoid":        "08013950100",   // 11-digit census tract GEOID
        "county_fips":  "08013",         // 5-digit county FIPS (Rule 1)
        "state_fips":   "08",
        "tract_code":   "950100",
        "designation":  "QCT",           // "QCT" | "DDA" | "BOTH"
        "year":         2025,
        "is_qct":       true,
        "is_dda":       false
      },
      …
    ]
  }

The normalization handles:
  - FIPS padding (county 5-digit, state 2-digit, tract 6-digit)  — Rule 1
  - Missing / null field defaults                                  — Rule 2
  - De-duplication (a tract can appear once as QCT and once as DDA;
    they are merged into a single record with designation = "BOTH")
  - County-level rollup (qct_tracts / dda_tracts lists)
  - Validation script: scripts/market/validate_qct_dda_co.py
"""

import json
import os
import sys
import datetime

INPUT_PATH  = os.path.join(os.path.dirname(__file__), '..', '..',
                           'data', 'market', 'qct_dda_designations_co.json')
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), '..', '..',
                           'data', 'market', 'qct_dda_designations_co_normalized.json')

STATE_FIPS = '08'   # Colorado


def pad_fips(value: str, length: int) -> str:
    """Zero-pad a FIPS code to the required length (Rule 1)."""
    return str(value).strip().zfill(length)


def normalize(raw: dict) -> dict:
    """Return the normalized output structure."""
    meta_in = raw.get('meta', {})
    designations = raw.get('designations', [])

    # ── Pass 1: normalise individual records ─────────────────────────────────
    tract_map = {}   # geoid → normalised tract dict

    for rec in designations:
        raw_geoid       = str(rec.get('geoid') or '').strip()
        raw_county_fips = str(rec.get('county_fips') or '').strip()
        raw_type        = str(rec.get('type') or '').strip().upper()
        year_raw        = rec.get('year') or rec.get('designation_year') or \
                          meta_in.get('designation_year') or 2025

        # Pad FIPS codes (Rule 1)
        if len(raw_geoid) == 11:
            geoid = raw_geoid
        elif len(raw_geoid) >= 6:
            # Assume last 6 chars are tract code, prefix with county or state+county
            if raw_county_fips:
                geoid = pad_fips(raw_county_fips, 5) + pad_fips(raw_geoid[-6:], 6)
            else:
                geoid = pad_fips(raw_geoid, 11)
        else:
            geoid = pad_fips(raw_geoid, 11)

        county_fips = pad_fips(raw_county_fips, 5) if raw_county_fips else geoid[:5]
        state_fips  = county_fips[:2] if len(county_fips) >= 2 else STATE_FIPS
        tract_code  = geoid[5:] if len(geoid) >= 11 else geoid.zfill(6)[-6:]

        # Validate type (default QCT if unrecognised — Rule 2)
        if raw_type not in ('QCT', 'DDA'):
            raw_type = 'QCT'

        year = int(year_raw) if str(year_raw).isdigit() else 2025

        if geoid in tract_map:
            existing = tract_map[geoid]
            if existing['designation'] != raw_type:
                existing['designation'] = 'BOTH'
                existing['is_qct'] = True
                existing['is_dda'] = True
        else:
            tract_map[geoid] = {
                'geoid':       geoid,
                'county_fips': county_fips,
                'state_fips':  state_fips,
                'tract_code':  tract_code,
                'designation': raw_type,
                'year':        year,
                'is_qct':      raw_type in ('QCT', 'BOTH'),
                'is_dda':      raw_type in ('DDA', 'BOTH'),
            }

    tracts = sorted(tract_map.values(), key=lambda t: t['geoid'])

    # ── Pass 2: county-level rollup ───────────────────────────────────────────
    counties = {}
    for t in tracts:
        cfips = t['county_fips']
        if cfips not in counties:
            counties[cfips] = {
                'fips':       cfips,
                'qct_tracts': [],
                'dda_tracts': [],
                'is_dda':     False,
            }
        if t['is_qct']:
            counties[cfips]['qct_tracts'].append(t['geoid'])
        if t['is_dda']:
            counties[cfips]['dda_tracts'].append(t['geoid'])
            counties[cfips]['is_dda'] = True

    # ── Assemble output ───────────────────────────────────────────────────────
    now_iso = datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat().replace('+00:00', 'Z')

    meta_out = dict(meta_in)
    meta_out['normalized_at']     = now_iso
    meta_out['normalizer_version'] = '1.0'
    meta_out['tract_count']        = len(tracts)
    meta_out['county_count']       = len(counties)
    meta_out['qct_tract_count']    = sum(1 for t in tracts if t['is_qct'])
    meta_out['dda_tract_count']    = sum(1 for t in tracts if t['is_dda'])
    meta_out['dda_county_count']   = sum(1 for c in counties.values() if c['is_dda'])

    return {
        'meta':     meta_out,
        'counties': counties,
        'tracts':   tracts,
    }


def main() -> int:
    print(f'Reading  : {INPUT_PATH}')

    if not os.path.exists(INPUT_PATH):
        print(f'ERROR: input file not found: {INPUT_PATH}', file=sys.stderr)
        return 1

    with open(INPUT_PATH, encoding='utf-8') as fh:
        raw = json.load(fh)

    output = normalize(raw)

    # Write
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as fh:
        json.dump(output, fh, indent=2)
        fh.write('\n')

    meta = output['meta']
    print(f'Wrote    : {OUTPUT_PATH}')
    print(f'  Tracts : {meta["tract_count"]} ({meta["qct_tract_count"]} QCT, '
          f'{meta["dda_tract_count"]} DDA)')
    print(f'  Counties: {meta["county_count"]} ({meta["dda_county_count"]} with DDA)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
