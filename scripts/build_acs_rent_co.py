#!/usr/bin/env python3
"""Publish official 2020–2024 ACS B25064 place/county median gross rents.

The HNA summary producer stores B25064_001E as DP04_0134E (the equivalent
profile variable). Read that jurisdiction's published median directly. A mean
of tract medians is neither its median nor a replacement for a suppressed one.

A geography of 65,000 or more has a 1-year profile (acsProfile._acsSeries
"acs1"); its 5-year figures are in the summary's acs5Profile, so every row here
is the same 5-year series.
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SUMMARY_DIR = REPO_ROOT / 'data/hna/summary'
GEOGRAPHIES = REPO_ROOT / 'data/hna/geo-config.json'
OUT = REPO_ROOT / 'data/market/acs_median_rent_co.json'


def number(value):
    if value is None or value == '':
        return None
    try:
        n = float(value)
        return n if math.isfinite(n) and n >= 0 else None
    except (TypeError, ValueError):
        return None


def five_year_profile(summary):
    """The summary's 5-year profile: acsProfile, or for a 1-year geography its
    acs5Profile twin. None when a 1-year summary has no twin yet: its 1-year
    figures are never published here as 5-year ones."""
    profile = summary.get('acsProfile') or {}
    if profile.get('_acsSeries') == 'acs1':
        return summary.get('acs5Profile')
    return profile


def build_artifact(summary_dir=SUMMARY_DIR, geographies=GEOGRAPHIES):
    config = json.loads(geographies.read_text())
    result = {'meta': {
        'source': 'Census American Community Survey 2020–2024 5-year estimates, B25064',
        'source_url': 'https://www.census.gov/data/developers/data-sets/acs-5year/2024.html',
        'derived_from': 'data/hna/summary/',
        'source_table': 'B25064',
        'summary_field': 'DP04_0134E',
        'method': 'Published place or county median gross rent; no tract averaging',
        'vintage': '2020–2024',
        'acs_year': 2024,
        'notes': 'Each row is the published median for that geography. Suppressed or missing estimates stay null with a reason; no county or tract value is substituted.'
    }, 'counties': {}, 'places': {}}
    on_vintage = 0
    for kind in ('counties', 'places', 'cdps'):
        for geo in config[kind]:
            geoid = geo['geoid']
            path = summary_dir / (geoid + '.json')
            summary = json.loads(path.read_text())
            profile = five_year_profile(summary)
            reason = 'acs_median_gross_rent_unavailable'
            if profile is None:
                profile, reason = {}, 'acs5_estimate_not_in_summary'
            elif str(profile.get('_acsYear')) != '2024' or profile.get('_acsSeries') != 'acs5':
                # A profile that fell back to an older year is not this
                # file's 2020–2024 figure; it waits for the next build.
                profile, reason = {}, 'acs5_2024_not_in_summary'
            else:
                on_vintage += 1
            rent = number(profile.get('DP04_0134E'))
            rent = int(rent) if rent is not None and rent > 0 else None
            row = {
                'name': geo['label'],
                'median_gross_rent': rent,
                'total_renter_hh': number(profile.get('DP04_0047E')),
                'county_fips': geoid if kind == 'counties' else geo.get('containingCounty'),
                'source_file': 'data/hna/summary/' + geoid + '.json',
                'unavailable_reason': reason if rent is None else None
            }
            result['counties' if kind == 'counties' else 'places'][geoid] = row
    if not on_vintage:
        # Every summary on another vintage means the meta above is out of date.
        raise ValueError('no summary is 2020–2024 ACS 5-year; update this file\'s vintage')
    result['meta']['scope'] = f"Colorado: {len(result['counties'])} counties, {len(result['places'])} places and CDPs (including unavailable rows)"
    return result


def main():
    result = build_artifact()
    previous = json.loads(OUT.read_text()) if OUT.exists() else {}
    old_stamp = previous.get('meta', {}).pop('generated_at_utc', None)
    result['meta']['generated_at_utc'] = old_stamp if result == previous else datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
    OUT.write_text(json.dumps(result, indent=2) + '\n')
    print(f"Wrote {OUT}: {len(result['counties'])} counties, {len(result['places'])} places/CDPs")


if __name__ == '__main__':
    main()
