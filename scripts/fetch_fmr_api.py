#!/usr/bin/env python3
"""
fetch_fmr_api.py — Fetch HUD Fair Market Rents (FMR) and Income Limits for Colorado.

Fetches FMR and Income Limits data from the HUD User API and writes JSON output to:
  data/market/fmr_co.json          — raw FMR API response (market data use)
  data/hud-fmr-income-limits.json  — combined FMR + IL by county (browser use)

Usage:
    HUD_API_TOKEN=<token> python3 scripts/fetch_fmr_api.py

Environment variables:
    HUD_API_TOKEN  — REQUIRED HUD User API Bearer token. As of 2025-Q4 HUD
                     locked the previously-public /fmr/statedata/<state>
                     endpoint behind authentication; without a token the
                     script exits with HTTP 401. Free registration:
                     https://www.huduser.gov/portal/dataset/fmr-api.html
                     (top-right "Sign Up"). The token is also required
                     for the Income Limits endpoint.

Output:
    data/market/fmr_co.json
    data/hud-fmr-income-limits.json
"""

from __future__ import annotations  # postpone evaluation so `str | None`
                                     # syntax (PEP 604) parses on Python 3.9

import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))

OUT_FMR_RAW     = os.path.join(_ROOT, 'data', 'market', 'fmr_co.json')
OUT_COMBINED    = os.path.join(_ROOT, 'data', 'hud-fmr-income-limits.json')
OUT_TRACT_MAP   = os.path.join(_ROOT, 'data', 'market', 'fmr_tract_map_co.json')

HUD_FMR_URL     = 'https://www.huduser.gov/hudapi/public/fmr/statedata/CO?year=2026'
HUD_FMR_URL_PREV = 'https://www.huduser.gov/hudapi/public/fmr/statedata/CO?year=2025'
HUD_IL_URL      = 'https://www.huduser.gov/hudapi/public/income/listCounties/08'  # FIPS 08 = CO
HUD_IL_DATA_URL = 'https://www.huduser.gov/hudapi/public/fmr/il/data/{entityid}?year={year}'

TIMEOUT  = 30
FY       = 2026

# HUD household-size adjustment factors used to derive income limits at sizes 1-4
# from the 4-person AMI (approximate statutory factors).
_SIZE_FACTORS = {1: 0.70, 2: 0.80, 3: 0.90, 4: 1.00}

# Colorado FMR area metro assignments (FY2025): county FIPS → area name & code
_METRO_AREAS: dict = {
    'Denver-Aurora-Lakewood HUD Metro FMR Area': {
        'code': 'METRO19740CO',
        'counties': ['08001', '08005', '08014', '08019', '08031',
                     '08035', '08039', '08047', '08059', '08093'],
    },
    'Boulder HUD Metro FMR Area': {
        'code': 'METRO14500CO',
        'counties': ['08013'],
    },
    'Colorado Springs HUD Metro FMR Area': {
        'code': 'METRO17820CO',
        'counties': ['08041', '08119'],
    },
    'Fort Collins HUD Metro FMR Area': {
        'code': 'METRO22660CO',
        'counties': ['08069'],
    },
    'Greeley HUD Metro FMR Area': {
        'code': 'METRO24540CO',
        'counties': ['08123'],
    },
    'Edwards HUD Metro FMR Area': {
        'code': 'HMFA16620CO',
        'counties': ['08037'],
    },
    'Aspen HUD Metro FMR Area': {
        'code': 'HMFA11220CO',
        'counties': ['08097'],
    },
    'Summit County HUD Metro FMR Area': {
        'code': 'HMFA44700CO',
        'counties': ['08117'],
    },
}

# Build reverse lookup: fips → (area_name, area_code)
_FIPS_TO_METRO: dict = {}
for _area_name, _area_info in _METRO_AREAS.items():
    for _fips in _area_info['counties']:
        _FIPS_TO_METRO[_fips] = (_area_name, _area_info['code'])

_CO_METRO_COUNTY_NAMES: dict[str, str] = {
    '08001': 'Adams County',
    '08005': 'Arapahoe County',
    '08013': 'Boulder County',
    '08014': 'Broomfield County',
    '08019': 'Clear Creek County',
    '08031': 'Denver County',
    '08035': 'Douglas County',
    '08037': 'Eagle County',
    '08039': 'Elbert County',
    '08041': 'El Paso County',
    '08047': 'Gilpin County',
    '08059': 'Jefferson County',
    '08069': 'Larimer County',
    '08093': 'Park County',
    '08097': 'Pitkin County',
    '08117': 'Summit County',
    '08119': 'Teller County',
    '08123': 'Weld County',
}

# F256 — Complete CO county name roster. Used as the fallback when the
# HUD county_name field is empty AND the IL API lookup doesn't have a
# match for that county. Covers all 64 CO counties so non-metro records
# (the 46 not in _CO_METRO_COUNTY_NAMES above) get proper county names.
_CO_COUNTY_NAMES_FULL: dict[str, str] = {
    '08001': 'Adams County',         '08003': 'Alamosa County',
    '08005': 'Arapahoe County',      '08007': 'Archuleta County',
    '08009': 'Baca County',          '08011': 'Bent County',
    '08013': 'Boulder County',       '08014': 'Broomfield County',
    '08015': 'Chaffee County',       '08017': 'Cheyenne County',
    '08019': 'Clear Creek County',   '08021': 'Conejos County',
    '08023': 'Costilla County',      '08025': 'Crowley County',
    '08027': 'Custer County',        '08029': 'Delta County',
    '08031': 'Denver County',        '08033': 'Dolores County',
    '08035': 'Douglas County',       '08037': 'Eagle County',
    '08039': 'Elbert County',        '08041': 'El Paso County',
    '08043': 'Fremont County',       '08045': 'Garfield County',
    '08047': 'Gilpin County',        '08049': 'Grand County',
    '08051': 'Gunnison County',      '08053': 'Hinsdale County',
    '08055': 'Huerfano County',      '08057': 'Jackson County',
    '08059': 'Jefferson County',     '08061': 'Kiowa County',
    '08063': 'Kit Carson County',    '08065': 'Lake County',
    '08067': 'La Plata County',      '08069': 'Larimer County',
    '08071': 'Las Animas County',    '08073': 'Lincoln County',
    '08075': 'Logan County',         '08077': 'Mesa County',
    '08079': 'Mineral County',       '08081': 'Moffat County',
    '08083': 'Montezuma County',     '08085': 'Montrose County',
    '08087': 'Morgan County',        '08089': 'Otero County',
    '08091': 'Ouray County',         '08093': 'Park County',
    '08095': 'Phillips County',      '08097': 'Pitkin County',
    '08099': 'Prowers County',       '08101': 'Pueblo County',
    '08103': 'Rio Blanco County',    '08105': 'Rio Grande County',
    '08107': 'Routt County',         '08109': 'Saguache County',
    '08111': 'San Juan County',      '08113': 'San Miguel County',
    '08115': 'Sedgwick County',      '08117': 'Summit County',
    '08119': 'Teller County',        '08121': 'Washington County',
    '08123': 'Weld County',          '08125': 'Yuma County',
}

_CO_STATEWIDE_DEFAULT_AMI = 107200


def _normalize_colorado_fips(raw_fips: str | int | None) -> str:
    """Normalize Colorado county FIPS values to a 5-digit string."""
    digits = re.sub(r'\D', '', str(raw_fips or ''))
    if len(digits) == 5:
        return digits
    if 0 < len(digits) <= 3:
        return '08' + digits.zfill(3)
    return digits.zfill(5) if digits else ''


def _extract_fmr_records(payload: dict) -> tuple[list, str | None]:
    """Return HUD FMR records and the detected response shape.

    Kept for backward compat — prefer _extract_fmr_records_all() to avoid
    F256-class bugs where the response contained BOTH metroareas + counties
    and one was silently dropped.
    """
    if not isinstance(payload, dict):
        return [], None

    data = payload.get('data')
    if isinstance(data, dict):
        for key in ('metroareas', 'counties', 'basicdata'):
            if isinstance(data.get(key), list) and data[key]:
                return data[key], f'data.{key}'
    elif isinstance(data, list) and data:
        return data, 'data'

    for key in ('counties', 'results', 'fmr_data'):
        if isinstance(payload.get(key), list) and payload[key]:
            return payload[key], key

    return [], None


def _extract_fmr_records_all(payload: dict) -> dict[str, list]:
    """Return ALL HUD FMR record lists keyed by shape.

    F256 — HUD's /fmr/statedata/CO endpoint returns BOTH `data.metroareas`
    (8 metro FMR areas containing 18 counties total) AND `data.counties`
    (46 non-metro CO counties — each with its own FMR record). The
    original `_extract_fmr_records()` returned only the FIRST non-empty
    list (metroareas), silently dropping the 46 non-metro counties. That
    is why our cached data/hud-fmr-income-limits.json held 17 of 64 CO
    counties and the Opportunity Finder's market-capture filter had no
    FMR for Bayfield, Ignacio, Paonia, Steamboat, Telluride, and 42 other
    rural towns.

    Now we extract EVERY known list shape and the caller combines them.
    """
    result: dict[str, list] = {}
    if not isinstance(payload, dict):
        return result

    data = payload.get('data')
    if isinstance(data, dict):
        for key in ('metroareas', 'counties', 'basicdata'):
            value = data.get(key)
            if isinstance(value, list) and value:
                result[f'data.{key}'] = value
    elif isinstance(data, list) and data:
        result['data'] = data

    for key in ('counties', 'results', 'fmr_data'):
        full_key = key  # already top-level
        if full_key not in result and isinstance(payload.get(key), list) and payload[key]:
            result[key] = payload[key]

    return result


def _match_metro_area(hud_code: str) -> tuple[str, str] | None:
    """Match a HUD metro/HMFA code to the repository's metro-area mapping."""
    for area_name, info in _METRO_AREAS.items():
        if info['code'] == hud_code:
            return area_name, info['code']

    match = re.match(r'^(?:METRO|HMFA)(\d+)', hud_code or '')
    if match:
        numeric_code = match.group(1)
        for area_name, info in _METRO_AREAS.items():
            if numeric_code in info['code']:
                return area_name, info['code']

    return None


def _expand_metroareas_to_counties(metroareas: list, il_index: dict) -> list:
    """Normalize HUD metro-area records into county-based output rows."""
    counties: list = []

    for record in metroareas:
        hud_code = str(record.get('code', '') or '')
        hud_name = str(record.get('metro_name', record.get('name', '')) or '')
        fmr = parse_fmr_record(record)
        metro_match = _match_metro_area(hud_code)

        if metro_match:
            area_name, area_code = metro_match
            for fips in _METRO_AREAS[area_name]['counties']:
                il_row = il_index.get(fips) or {}
                county_name = (
                    il_row.get('county_name')
                    or il_row.get('county')
                    or _CO_METRO_COUNTY_NAMES.get(fips, fips)
                )
                ami_4person = int(
                    il_row.get('median_income', il_row.get('ami_4person', 0)) or 0
                )
                if ami_4person <= 0:
                    ami_4person = _CO_STATEWIDE_DEFAULT_AMI

                counties.append({
                    'fips':                    fips,
                    'county_name':             county_name,
                    'fmr_area_name':           area_name,
                    'fmr_area_code':           area_code,
                    'fmr':                     fmr,
                    'income_limits':           calc_income_limits(ami_4person),
                    'affordable_rents_60pct':  calc_affordable_rents_60pct(ami_4person, fmr),
                })
            continue

        fips_match = re.search(r'NCNTY(\d{5})', hud_code) or re.search(r'(\d{5})', hud_code)
        fips = fips_match.group(1) if fips_match else ''
        if not fips.startswith('08'):
            print(
                f'  ⚠ Could not map HUD non-metro area {hud_name!r} ({hud_code!r}) to a Colorado county',
                file=sys.stderr,
            )
            continue

        il_row = il_index.get(fips) or {}
        county_name = (
            il_row.get('county_name')
            or il_row.get('county')
            or re.sub(r',?\s*(?:CO|Colorado)\b.*$', '', hud_name, flags=re.IGNORECASE).strip()
            or fips
        )
        ami_4person = int(
            il_row.get('median_income', il_row.get('ami_4person', 0)) or 0
        )
        if ami_4person <= 0:
            ami_4person = _CO_STATEWIDE_DEFAULT_AMI

        counties.append({
            'fips':                    fips,
            'county_name':             county_name,
            'fmr_area_name':           county_name + ' FMR Area',
            'fmr_area_code':           hud_code or ('NCNTY' + fips + 'CO'),
            'fmr':                     fmr,
            'income_limits':           calc_income_limits(ami_4person),
            'affordable_rents_60pct':  calc_affordable_rents_60pct(ami_4person, fmr),
        })

    return counties


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def http_get_json(url: str, token: str | None = None) -> dict | None:
    headers = {'User-Agent': 'HousingAnalytics/1.0', 'Accept': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read())
    except Exception as exc:
        print(f'⚠ HUD API error ({url}): {exc}', file=sys.stderr)
        return None


def calc_income_limits(ami_4person: int) -> dict:
    """Derive income limits at 30/50/60/80% AMI for household sizes 1-4."""
    result: dict = {'ami_4person': ami_4person}
    for pct in (30, 50, 60, 80):
        for size in (1, 2, 3, 4):
            raw = ami_4person * (pct / 100) * _SIZE_FACTORS[size]
            result[f'il{pct}_{size}person'] = int(round(raw / 50) * 50)
    return result


def calc_affordable_rents_60pct(ami_4person: int, fmr: dict) -> dict:
    """
    Calculate affordable gross rent thresholds at 60% AMI (standard LIHTC limit)
    for household sizes 1–4, cross-referenced against FMR for market context.

    Affordable rent = 30% of (60% AMI monthly income), HUD utility-allowance
    deduction is site-specific; this is the gross rent ceiling per HUD formula.
    """
    result: dict = {}
    for size in (1, 2, 3, 4):
        monthly_income_60pct = ami_4person * 0.60 * _SIZE_FACTORS[size] / 12
        affordable_gross = int(round(monthly_income_60pct * 0.30 / 10) * 10)
        # Cross-reference: affordable rent as % of FMR for that bedroom size
        br_map = {1: 'efficiency', 2: 'one_br', 3: 'two_br', 4: 'three_br'}
        fmr_br = fmr.get(br_map.get(size, 'two_br'), 0)
        pct_of_fmr = round(affordable_gross / fmr_br * 100, 1) if fmr_br > 0 else None
        result[f'rent_60pct_{size}person'] = {
            'gross_rent':   affordable_gross,
            'fmr_bedroom':  br_map.get(size, 'two_br'),
            'fmr_amount':   fmr_br,
            'pct_of_fmr':  pct_of_fmr,
        }
    return result


def build_tract_fmr_map(counties: list) -> dict:
    """
    Build a census-tract-level FMR area cross-reference from county FMR data.

    Each Colorado census tract inherits its county's FMR area designation.
    The output maps 11-digit tract GEOIDs to FMR area codes for use in
    tract-level affordability calculations.

    Tract GEOIDs are derived from the county FIPS prefix (08xxx) + tract suffix.
    For a full per-tract mapping, rebuild with build_public_market_data.py first;
    this function provides county-level FMR inheritance as a fallback.
    """
    county_map: dict = {}
    for county in counties:
        fips = county.get('fips', '')
        county_map[fips] = {
            'county_fips':     fips,
            'county_name':     county.get('county_name', ''),
            'fmr_area_code':   county.get('fmr_area_code', ''),
            'fmr_area_name':   county.get('fmr_area_name', ''),
            'fmr':             county.get('fmr', {}),
            'affordable_rents_60pct': county.get('affordable_rents_60pct', {}),
            'income_limits':   county.get('income_limits', {}),
        }
    return county_map


def parse_fmr_record(raw: dict) -> dict:
    """Convert a raw HUD FMR API county record into our canonical FMR shape."""
    return {
        'efficiency': int(raw.get('Efficiency', raw.get('efficiency', 0)) or 0),
        'one_br':     int(raw.get('One-Bedroom', raw.get('one_br', 0)) or 0),
        'two_br':     int(raw.get('Two-Bedroom', raw.get('two_br', 0)) or 0),
        'three_br':   int(raw.get('Three-Bedroom', raw.get('three_br', 0)) or 0),
        'four_br':    int(raw.get('Four-Bedroom', raw.get('four_br', 0)) or 0),
    }


def build_combined(fmr_api_data: dict, il_api_data: dict | None, generated: str) -> dict:
    """
    Build data/hud-fmr-income-limits.json by merging FMR API response with
    income limits.  Falls back to AMI-formula income limits when the IL API
    is unavailable (no token).

    fmr_api_data: parsed response from HUD_FMR_URL (statedata/CO)
    il_api_data:  parsed response from HUD_IL_URL (listCounties/08), or None
    """
    # Build an optional IL index keyed by 5-digit FIPS from the IL county list
    il_index: dict = {}
    if il_api_data and isinstance(il_api_data, list):
        for row in il_api_data:
            fips_raw = _normalize_colorado_fips(row.get('fips_code', row.get('fips', '')))
            if fips_raw.startswith('08'):
                il_index[fips_raw] = row

    # F256 — Extract ALL response shapes (metroareas + counties + …) so
    # non-metro counties aren't dropped. Process metroareas first (they
    # expand to multiple county rows) then loop over any county lists,
    # de-duping by FIPS so a county listed in both shapes wins on the
    # metro variant.
    all_records = _extract_fmr_records_all(fmr_api_data)
    print(f'  HUD response shapes detected: {list(all_records.keys()) or "none"}')

    counties: list = []
    seen_fips: set = set()

    # Pass A — metroareas → expand to multiple county records
    metro_records = all_records.get('data.metroareas') or []
    if metro_records:
        for c in _expand_metroareas_to_counties(metro_records, il_index):
            if c['fips'] in seen_fips:
                continue
            counties.append(c)
            seen_fips.add(c['fips'])

    # Pass B — county-level records (non-metro + fallback shapes).
    # HUD's /statedata/CO endpoint returns these alongside metroareas;
    # they were silently discarded before F256.
    county_records: list = []
    for shape_key in ('data.counties', 'data.basicdata', 'data', 'counties', 'results', 'fmr_data'):
        if shape_key in all_records:
            county_records.extend(all_records[shape_key])

    for raw in county_records:
        # Normalise FIPS to 5-digit string (Rule 1)
        fips = _normalize_colorado_fips(raw.get('fips_code', raw.get('fips', '')))
        if not fips.startswith('08'):
            # Try to pull FIPS out of an NCNTY-style code if fips_code is missing
            code_str = str(raw.get('code', '') or '')
            m = re.search(r'NCNTY(\d{5})', code_str) or re.search(r'(\d{5})', code_str)
            if m and m.group(1).startswith('08'):
                fips = m.group(1)
            else:
                continue

        if fips in seen_fips:
            continue

        county_name = (
            raw.get('county_name')
            or raw.get('county')
            or (il_index.get(fips) or {}).get('county_name')
            or _CO_COUNTY_NAMES_FULL.get(fips)
            or fips
        )

        # FMR area assignment
        if fips in _FIPS_TO_METRO:
            area_name, area_code = _FIPS_TO_METRO[fips]
        else:
            area_name = county_name + ' FMR Area'
            area_code = raw.get('code') or ('NCNTY' + fips + 'N' + fips)

        fmr = parse_fmr_record(raw)

        # Income limits: prefer IL API data; fall back to formula from AMI
        ami_4person = int(raw.get('median_income', raw.get('ami_4person', 0)) or 0)
        il_row = il_index.get(fips)
        if il_row:
            il_ami = int(il_row.get('median_income', il_row.get('ami_4person', ami_4person)) or ami_4person)
        else:
            il_ami = ami_4person

        # Guard against zero AMI (Rule 2)
        if il_ami <= 0:
            il_ami = _CO_STATEWIDE_DEFAULT_AMI

        income_limits = calc_income_limits(il_ami)
        affordable_rents = calc_affordable_rents_60pct(il_ami, fmr)

        counties.append({
            'fips':                    fips,
            'county_name':             county_name,
            'fmr_area_name':           area_name,
            'fmr_area_code':           area_code,
            'fmr':                     fmr,
            'income_limits':           income_limits,
            'affordable_rents_60pct':  affordable_rents,
        })
        seen_fips.add(fips)

    return {
        'meta': {
            'source':      'HUD FMR and Income Limits (FY2025)',
            'url_fmr':     'https://www.huduser.gov/portal/datasets/fmr.html',
            'url_il':      'https://www.huduser.gov/portal/datasets/il.html',
            'fiscal_year': FY,
            'state':       'Colorado',
            'state_fips':  '08',
            'generated':   generated,
            'county_count': len(counties),
            'note':        ('FY2025 Fair Market Rents and Income Limits for Colorado counties. '
                            'Includes 60% AMI affordable rent calculations for LIHTC use. '
                            'Refresh annually with scripts/fetch_fmr_api.py.'),
        },
        'counties': counties,
    }


def main() -> int:
    token = os.environ.get('HUD_API_TOKEN', '').strip() or None

    # ── 1. Fetch FMR data (public endpoint) ──────────────────────────────────
    # Try current FY first, fall back to previous FY.  Validate that we got
    # actual area records — a 200-OK error JSON (e.g. {"status":"error",...})
    # is truthy but not usable data.
    def _has_records(d):
        """Return True only when d contains a non-empty list of FMR records."""
        records, _shape = _extract_fmr_records(d)
        return bool(records)

    fmr_data = None
    for _url in (HUD_FMR_URL, HUD_FMR_URL_PREV):
        print(f'Fetching HUD Fair Market Rents for Colorado ({_url})…')
        _resp = http_get_json(_url, token)
        if _resp and _has_records(_resp):
            fmr_data = _resp
            _records, _shape = _extract_fmr_records(_resp)
            print(f'  ✓ Got {len(_records)} FMR records from response shape {_shape}')
            break
        else:
            print(f'  ⚠ No usable records from {_url}: '
                  f'{str(_resp)[:120] if _resp else "no response"}', file=sys.stderr)

    if not fmr_data:
        print('✗ HUD FMR API returned no usable data for FY2026 or FY2025.',
              file=sys.stderr)
        if not token:
            print('', file=sys.stderr)
            print('ℹ HUD\'s FMR API now requires a free Bearer token. The '
                  'previously-public /fmr/statedata/<state> endpoint returns '
                  '401 Unauthorized without one as of 2025-Q4.',
                  file=sys.stderr)
            print('  Register at https://www.huduser.gov/portal/dataset/'
                  'fmr-api.html (top-right "Sign Up" link) and re-run with:',
                  file=sys.stderr)
            print('    HUD_API_TOKEN=<your-token> python3 ' + sys.argv[0],
                  file=sys.stderr)
        return 1

    generated = utc_now()

    # Write raw FMR output (data/market/fmr_co.json)
    raw_output = {
        'meta': {
            'source':     'HUD Fair Market Rents API',
            'url':        HUD_FMR_URL,
            'state':      'Colorado',
            'state_fips': '08',
            'generated':  generated,
        },
        'data': fmr_data,
    }
    os.makedirs(os.path.dirname(OUT_FMR_RAW), exist_ok=True)
    with open(OUT_FMR_RAW, 'w', encoding='utf-8') as fh:
        json.dump(raw_output, fh)

    raw_records, raw_shape = _extract_fmr_records(fmr_data)
    print(f'✓ Wrote FMR data ({len(raw_records)} records from {raw_shape}) to {OUT_FMR_RAW}')

    # ── 2. Fetch Income Limits county list (requires token) ──────────────────
    il_data = None
    if token:
        print('Fetching HUD Income Limits county list for Colorado…')
        time.sleep(0.5)  # gentle rate-limit courtesy pause
        il_data = http_get_json(HUD_IL_URL, token)
        if il_data:
            print(f'✓ Income Limits county list: {len(il_data) if isinstance(il_data, list) else "?"} entries')
        else:
            print('⚠ Income Limits fetch failed — will use AMI-formula fallback', file=sys.stderr)
    else:
        print('ℹ No HUD_API_TOKEN set; Income Limits will be derived from AMI formula.')

    # ── 3. Build combined FMR + IL file (data/hud-fmr-income-limits.json) ────
    combined = build_combined(fmr_data, il_data, generated)
    county_count = len(combined['counties'])
    os.makedirs(os.path.dirname(OUT_COMBINED), exist_ok=True)
    with open(OUT_COMBINED, 'w', encoding='utf-8') as fh:
        json.dump(combined, fh, indent=2)
    print(f'✓ Wrote combined FMR+IL data ({county_count} counties) to {OUT_COMBINED}')

    # ── 4. Write county→FMR tract cross-reference map ────────────────────────
    tract_map = build_tract_fmr_map(combined['counties'])
    tract_map_output = {
        'meta': {
            'source':      'HUD FMR Area cross-reference by Colorado county (FY2025)',
            'state':       'Colorado',
            'state_fips':  '08',
            'generated':   generated,
            'county_count': len(tract_map),
            'note': (
                'County-level FMR area mapping for tract-level affordability analysis. '
                'Each county FIPS key contains FMR area code, FMR schedule, '
                '60% AMI affordable rent ceilings, and income limits. '
                'Rebuild via scripts/fetch_fmr_api.py'
            ),
        },
        'county_fmr_map': tract_map,
    }
    os.makedirs(os.path.dirname(OUT_TRACT_MAP), exist_ok=True)
    with open(OUT_TRACT_MAP, 'w', encoding='utf-8') as fh:
        json.dump(tract_map_output, fh, indent=2)
    print(f'✓ Wrote FMR tract cross-reference ({len(tract_map)} counties) to {OUT_TRACT_MAP}')

    return 0


if __name__ == '__main__':
    sys.exit(main())