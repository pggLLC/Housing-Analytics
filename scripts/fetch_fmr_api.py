#!/usr/bin/env python3
"""
fetch_fmr_api.py — Fetch HUD Fair Market Rents (FMR) and Income Limits for Colorado.

Fetches FMR and Income Limits data from the HUD User API and writes JSON output to:
  data/market/fmr_co.json          — raw FMR API response (market data use)
  data/hud-fmr-income-limits.json  — combined FMR + IL by county (browser use)

Usage:
    python3 scripts/fetch_fmr_api.py

Environment variables:
    HUD_API_TOKEN  — optional HUD User API token for higher rate limits.
                     Required for Income Limits endpoint; FMR endpoint is public.

Output:
    data/market/fmr_co.json
    data/hud-fmr-income-limits.json
"""

import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))

OUT_FMR_RAW     = os.path.join(_ROOT, 'data', 'market', 'fmr_co.json')
OUT_COMBINED    = os.path.join(_ROOT, 'data', 'hud-fmr-income-limits.json')

HUD_FMR_URL     = 'https://www.huduser.gov/hudapi/public/fmr/statedata/CO'
HUD_IL_URL      = 'https://www.huduser.gov/hudapi/public/income/listCounties/08'  # FIPS 08 = CO
HUD_IL_DATA_URL = 'https://www.huduser.gov/hudapi/public/fmr/il/data/{entityid}?year={year}'

TIMEOUT  = 30
FY       = 2025

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
    """Derive income limits at 30/50/80% AMI for household sizes 1-4."""
    result: dict = {'ami_4person': ami_4person}
    for pct in (30, 50, 80):
        for size in (1, 2, 3, 4):
            raw = ami_4person * (pct / 100) * _SIZE_FACTORS[size]
            result[f'il{pct}_{size}person'] = int(round(raw / 50) * 50)
    return result


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
    raw_counties: list = []
    if isinstance(fmr_api_data.get('data'), list):
        raw_counties = fmr_api_data['data']
    elif isinstance(fmr_api_data.get('counties'), list):
        raw_counties = fmr_api_data['counties']

    # Build an optional IL index keyed by 5-digit FIPS from the IL county list
    il_index: dict = {}
    if il_api_data and isinstance(il_api_data, list):
        for row in il_api_data:
            fips_raw = str(row.get('fips_code', row.get('fips', '')) or '').zfill(5)
            if fips_raw.startswith('08'):
                il_index[fips_raw] = row

    counties: list = []
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

        counties.append({
            'fips':           fips,
            'county_name':    county_name,
            'fmr_area_name':  area_name,
            'fmr_area_code':  area_code,
            'fmr':            fmr,
            'income_limits':  income_limits,
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
            'note':        ('FY2025 Fair Market Rents and Income Limits for Colorado counties. '
                            'Refresh annually with scripts/fetch_fmr_api.py.'),
        },
        'counties': counties,
    }


def main() -> int:
    token = os.environ.get('HUD_API_TOKEN', '').strip() or None

    # ── 1. Fetch FMR data (public endpoint) ──────────────────────────────────
    print('Fetching HUD Fair Market Rents for Colorado…')
    fmr_data = http_get_json(HUD_FMR_URL, token)
    if not fmr_data:
        print('✗ Failed to fetch HUD FMR data.', file=sys.stderr)
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

    raw_count = len(fmr_data.get('data', []) if isinstance(fmr_data.get('data'), list) else [])
    print(f'✓ Wrote FMR data ({raw_count} records) to {OUT_FMR_RAW}')

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

    return 0


if __name__ == '__main__':
    sys.exit(main())
