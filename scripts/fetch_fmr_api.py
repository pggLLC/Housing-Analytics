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

# Static fallback county names for the 18 Colorado metro-area counties.
# Used when the Income Limits API is unavailable and a county name cannot be
# derived from the HUD metro-area record (which names the MSA, not the county).
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


def _extract_fmr_records(payload: dict) -> tuple[list, str | None]:
    """Return (records, shape_key) from any supported HUD API response shape.

    Detects and returns the list of FMR area records together with the key name
    under which they were found.  Supported shapes:

    - ``{'data': {'metroareas': [...], 'year': '...'}}``: current HUD state endpoint
    - ``{'data': {'counties': [...]}}``:  alternate nested shape
    - ``{'data': [...]}``:                legacy flat-list shape
    - ``{'results': [...]}`` / ``{'fmr_data': [...]}``: other legacy shapes
    """
    data = payload.get('data', {}) if isinstance(payload, dict) else {}

    # Nested dict shape (current HUD statedata endpoint)
    if isinstance(data, dict):
        for key in ('metroareas', 'counties', 'basicdata'):
            if isinstance(data.get(key), list) and data[key]:
                return data[key], key
    # Legacy: flat list directly under 'data'
    elif isinstance(data, list) and data:
        return data, 'list'

    # Other legacy top-level key names (fall through from the dict branch too)
    for key in ('results', 'fmr_data'):
        val = payload.get(key) if isinstance(payload, dict) else None
        if isinstance(val, list) and val:
            return val, key

    # Nothing usable found — log the keys we saw for diagnostics
    if isinstance(data, dict):
        print(f'  HUD payload data keys: {list(data.keys())}', file=sys.stderr)
    return [], None


def _match_metro_area(hud_code: str) -> tuple[str, str] | None:
    """Match a HUD area code to an entry in ``_METRO_AREAS``.

    Returns ``(area_name, area_code)`` using the internal codes stored in
    ``_METRO_AREAS``, or ``None`` if the code does not match any known metro
    area.

    HUD sometimes encodes the CBSA numeric ID differently across endpoints
    (e.g. ``METRO14500M14500`` vs ``METRO14500CO``).  This function handles
    both the exact match and the numeric-extraction fallback.
    """
    # 1. Direct code match
    for area_name, info in _METRO_AREAS.items():
        if info['code'] == hud_code:
            return area_name, info['code']
    # 2. Extract numeric CBSA/HMFA ID from codes like METRO14500M14500 or HMFA16620M16620
    m = re.match(r'^(?:METRO|HMFA)(\d+)', hud_code)
    if m:
        numeric = m.group(1)
        for area_name, info in _METRO_AREAS.items():
            if numeric in info['code']:
                return area_name, info['code']
    return None


def _expand_metroareas_to_counties(metroareas: list, il_index: dict) -> list:
    """Normalize HUD metro-area FMR records into per-county output records.

    The HUD ``/fmr/statedata/<state>`` endpoint returns one record per FMR
    area (metro MSA/HMFA and non-metro county areas) rather than one record
    per county.  This function:

    * Expands metro-area records to all constituent counties via ``_METRO_AREAS``.
    * Maps non-metro county-area records to their single county by extracting
      the 5-digit FIPS from the area code (e.g. ``NCNTY08003CO`` → ``08003``).

    County names and AMI values are taken from ``il_index`` (keyed by 5-digit
    FIPS) when available, with static and formula-based fallbacks.
    """
    counties: list = []

    for record in metroareas:
        hud_code = record.get('code', '')
        hud_name = record.get('metro_name', record.get('name', ''))
        fmr = parse_fmr_record(record)

        # ── Try to match a known metro/HMFA area ─────────────────────────────
        metro_match = _match_metro_area(hud_code)
        if metro_match:
            area_name, area_code = metro_match
            for fips in _METRO_AREAS[area_name]['counties']:
                il_row = il_index.get(fips)
                if il_row:
                    county_name = (il_row.get('county_name')
                                   or il_row.get('county') or '')
                    ami_4person = int(
                        il_row.get('median_income',
                                   il_row.get('ami_4person', 0)) or 0
                    )
                else:
                    county_name = _CO_METRO_COUNTY_NAMES.get(fips, fips)
                    ami_4person = 0
                if ami_4person <= 0:
                    ami_4person = 107200  # CO statewide fallback
                income_limits = calc_income_limits(ami_4person)
                affordable_rents = calc_affordable_rents_60pct(ami_4person, fmr)
                counties.append({
                    'fips':                   fips,
                    'county_name':            county_name,
                    'fmr_area_name':          area_name,
                    'fmr_area_code':          area_code,
                    'fmr':                    fmr,
                    'income_limits':          income_limits,
                    'affordable_rents_60pct': affordable_rents,
                })
            continue

        # ── Non-metro county area: extract FIPS from code ─────────────────────
        fips = None
        m = re.search(r'NCNTY(\d{5})', hud_code)
        if m:
            fips = m.group(1)
        if not fips:
            m = re.search(r'(\d{5})', hud_code)
            if m and m.group(1).startswith('08'):
                fips = m.group(1)

        if not fips or not fips.startswith('08'):
            print(f'  ⚠ Could not extract CO county FIPS from code {hud_code!r} '
                  f'({hud_name!r}) — skipping', file=sys.stderr)
            continue

        il_row = il_index.get(fips)
        if il_row:
            county_name = (il_row.get('county_name')
                           or il_row.get('county') or '')
            ami_4person = int(
                il_row.get('median_income',
                           il_row.get('ami_4person', 0)) or 0
            )
        else:
            # Parse county name from HUD area name: strip ", CO..." suffix
            county_name = re.sub(
                r',?\s*(?:CO|Colorado)\b.*$', '', hud_name,
                flags=re.IGNORECASE,
            ).strip()
            ami_4person = 0

        if ami_4person <= 0:
            ami_4person = 107200

        area_code = hud_code or f'NCNTY{fips}CO'
        area_name = (county_name + ' FMR Area') if county_name else f'NCNTY{fips}CO FMR Area'
        income_limits = calc_income_limits(ami_4person)
        affordable_rents = calc_affordable_rents_60pct(ami_4person, fmr)
        counties.append({
            'fips':                   fips,
            'county_name':            county_name,
            'fmr_area_name':          area_name,
            'fmr_area_code':          area_code,
            'fmr':                    fmr,
            'income_limits':          income_limits,
            'affordable_rents_60pct': affordable_rents,
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
            fips_raw = str(row.get('fips_code', row.get('fips', '')) or '').zfill(5)
            if fips_raw.startswith('08'):
                il_index[fips_raw] = row

    # Detect the HUD response shape and extract the list of FMR area records
    records, shape_key = _extract_fmr_records(fmr_api_data)
    print(f'  HUD response shape: {shape_key!r} ({len(records)} records)')

    if shape_key == 'metroareas':
        # Current HUD statedata endpoint: list of metro + county FMR areas
        counties = _expand_metroareas_to_counties(records, il_index)
    else:
        # Legacy shapes: flat list of county records (each record has a fips field)
        raw_counties = records
        counties = []
        for raw in raw_counties:
            # Normalise FIPS to 5-digit string (Rule 1)
            fips = str(raw.get('fips_code', raw.get('fips', '')) or '').zfill(5)
            if not fips.startswith('08'):
                continue

            county_name = raw.get('county_name', raw.get('county', fips))

            # FMR area assignment
            if fips in _FIPS_TO_METRO:
                area_name, area_code = _FIPS_TO_METRO[fips]
            else:
                area_name = county_name + ' FMR Area'
                area_code = 'NCNTY' + fips + 'CO'

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
                il_ami = 107200  # CO statewide fallback

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
        """Return True when d contains a non-empty list of FMR area records."""
        if not isinstance(d, dict):
            return False
        data = d.get('data')
        # Legacy: top-level list of county records
        if isinstance(data, list) and data:
            return True
        # Current HUD state endpoint: nested dict with metroareas/counties/basicdata
        if isinstance(data, dict):
            return any(
                isinstance(data.get(k), list) and bool(data[k])
                for k in ('metroareas', 'counties', 'basicdata')
            )
        # Other legacy key names
        payload = d.get('results') or d.get('fmr_data')
        return isinstance(payload, list) and bool(payload)

    fmr_data = None
    for _url in (HUD_FMR_URL, HUD_FMR_URL_PREV):
        print(f'Fetching HUD Fair Market Rents for Colorado ({_url})…')
        _resp = http_get_json(_url, token)
        if _resp and _has_records(_resp):
            fmr_data = _resp
            _recs, _shape = _extract_fmr_records(_resp)
            print(f'  ✓ Loaded {len(_recs)} HUD FMR area records (shape: {_shape!r})')
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

    _raw_recs, _raw_shape = _extract_fmr_records(fmr_data)
    print(f'✓ Wrote FMR data ({len(_raw_recs)} {_raw_shape!r} records) to {OUT_FMR_RAW}')

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