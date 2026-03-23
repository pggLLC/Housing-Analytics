#!/usr/bin/env python3
"""
fetch_chas.py — Fetch HUD CHAS (Comprehensive Housing Affordability Strategy) data for Colorado.

Downloads CHAS Table 1 from HUD, filters to Colorado, aggregates tract-level
records to county-level cost-burden-by-AMI summaries, and writes:

  data/market/chas_co.json              — raw Colorado CHAS records
  data/hna/chas_affordability_gap.json  — county-level affordability gap for HNA dashboard

Usage:
    python3 scripts/fetch_chas.py

Output:
    data/market/chas_co.json
    data/hna/chas_affordability_gap.json
"""

import csv
import io
import json
import os
import sys
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone

REPO_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..'))
OUT_FILE = os.path.join(REPO_ROOT, 'data', 'market', 'chas_co.json')
GAP_FILE = os.path.join(REPO_ROOT, 'data', 'hna', 'chas_affordability_gap.json')

# HUD CHAS data — most recent available vintage (sub-county 140-jurisdiction download)
# URL pattern: https://www.huduser.gov/portal/datasets/cp.html
CHAS_STATE_URL = (
    'https://www.huduser.gov/portal/datasets/cp/2016thru2020-140-csv.zip'
)
COLORADO_FIPS = '08'
VINTAGE = '2016-2020'
TIMEOUT = 120

# CHAS Table 1 (2016-2020) column mapping for renter households by AMI × cost burden.
# Source: HUD CHAS 2016-2020 data dictionary (Table 1, renter section).
# Columns T1_est26–T1_est50 cover renter income/cost-burden cross-tabulations.
# Each AMI tier has 5 columns: total, not burdened, moderately burdened (30-50%),
# severely burdened (>50%), not computed.
RENTER_TOTAL_COL = 'T1_est26'
RENTER_AMI_COLS = {
    'lte30': {
        'total':             'T1_est27',
        'not_burdened':      'T1_est28',
        'mod_burdened':      'T1_est29',  # 30–50% of income
        'severely_burdened': 'T1_est30',  # >50% of income
    },
    '31to50': {
        'total':             'T1_est32',
        'not_burdened':      'T1_est33',
        'mod_burdened':      'T1_est34',
        'severely_burdened': 'T1_est35',
    },
    '51to80': {
        'total':             'T1_est37',
        'not_burdened':      'T1_est38',
        'mod_burdened':      'T1_est39',
        'severely_burdened': 'T1_est40',
    },
    '81to100': {
        'total':             'T1_est42',
        'not_burdened':      'T1_est43',
        'mod_burdened':      'T1_est44',
        'severely_burdened': 'T1_est45',
    },
}

# CHAS Table 1 owner-occupied household columns by AMI tier
# Source: HUD CHAS 2016-2020 data dictionary (Table 1, owner section)
# Columns T1_est51–T1_est75 cover owner-occupied income/cost-burden cross-tabs.
OWNER_TOTAL_COL = 'T1_est51'
OWNER_AMI_COLS = {
    'lte30': {
        'total':             'T1_est52',
        'not_burdened':      'T1_est53',
        'mod_burdened':      'T1_est54',
        'severely_burdened': 'T1_est55',
    },
    '31to50': {
        'total':             'T1_est57',
        'not_burdened':      'T1_est58',
        'mod_burdened':      'T1_est59',
        'severely_burdened': 'T1_est60',
    },
    '51to80': {
        'total':             'T1_est62',
        'not_burdened':      'T1_est63',
        'mod_burdened':      'T1_est64',
        'severely_burdened': 'T1_est65',
    },
    '81to100': {
        'total':             'T1_est67',
        'not_burdened':      'T1_est68',
        'mod_burdened':      'T1_est69',
        'severely_burdened': 'T1_est70',
    },
}

# Colorado county FIPS → name mapping (Rule 1: always 5-digit strings)
CO_COUNTY_NAMES = {
    '08001': 'Adams', '08003': 'Alamosa', '08005': 'Arapahoe', '08007': 'Archuleta',
    '08009': 'Baca', '08011': 'Bent', '08013': 'Boulder', '08014': 'Broomfield',
    '08015': 'Chaffee', '08017': 'Cheyenne', '08019': 'Clear Creek', '08021': 'Conejos',
    '08023': 'Costilla', '08025': 'Crowley', '08027': 'Custer', '08029': 'Delta',
    '08031': 'Denver', '08033': 'Dolores', '08035': 'Douglas', '08037': 'Eagle',
    '08039': 'Elbert', '08041': 'El Paso', '08043': 'Fremont', '08045': 'Garfield',
    '08047': 'Gilpin', '08049': 'Grand', '08051': 'Gunnison', '08053': 'Hinsdale',
    '08055': 'Huerfano', '08057': 'Jackson', '08059': 'Jefferson', '08061': 'Kiowa',
    '08063': 'Kit Carson', '08065': 'Lake', '08067': 'La Plata', '08069': 'Larimer',
    '08071': 'Las Animas', '08073': 'Lincoln', '08075': 'Logan', '08077': 'Mesa',
    '08079': 'Mineral', '08081': 'Moffat', '08083': 'Montezuma', '08085': 'Montrose',
    '08087': 'Morgan', '08089': 'Otero', '08091': 'Ouray', '08093': 'Park',
    '08095': 'Phillips', '08097': 'Pitkin', '08099': 'Prowers', '08101': 'Pueblo',
    '08103': 'Rio Blanco', '08105': 'Rio Grande', '08107': 'Routt', '08109': 'Saguache',
    '08111': 'San Juan', '08113': 'San Miguel', '08115': 'Sedgwick', '08117': 'Summit',
    '08119': 'Teller', '08121': 'Washington', '08123': 'Weld', '08125': 'Yuma',
}

AMI_TIERS = ['lte30', '31to50', '51to80', '81to100']
AMI_TIER_LABELS = {
    'lte30':   '\u226430% AMI',
    '31to50':  '31\u201350% AMI',
    '51to80':  '51\u201380% AMI',
    '81to100': '81\u2013100% AMI',
}


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def http_get(url: str, timeout: int = TIMEOUT) -> bytes:
    req = urllib.request.Request(url, headers={'User-Agent': 'HousingAnalytics/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def _int(value: str) -> int:
    """Parse an integer from a CHAS CSV cell; return 0 on failure."""
    try:
        return max(0, int(str(value).strip()))
    except (ValueError, TypeError):
        return 0


def extract_table1_records(zf: zipfile.ZipFile) -> list:
    """Return all rows from Table1.csv (or equivalent) in the CHAS ZIP."""
    candidates = [n for n in zf.namelist() if n.lower().endswith('.csv')
                  and 'table1' in n.lower().replace(' ', '').replace('-', '').replace('_', '')]
    if not candidates:
        candidates = [n for n in zf.namelist() if n.endswith('.csv') and 'Table' in n]
    records = []
    for csv_name in candidates[:1]:  # only Table 1
        with zf.open(csv_name) as cf:
            reader = csv.DictReader(io.TextIOWrapper(cf, encoding='utf-8-sig'))
            for row in reader:
                if str(row.get('st', '')).zfill(2) == COLORADO_FIPS:
                    records.append(dict(row))
    return records


def build_county_fips(row: dict) -> str:
    """Derive 5-digit county FIPS from a CHAS CSV row (Rule 1)."""
    # CHAS rows include 'st' (state, 2-digit) and 'cnty' (county, 3-digit) fields.
    st   = str(row.get('st',   '')).zfill(2)
    cnty = str(row.get('cnty', '')).zfill(3)
    if st == COLORADO_FIPS and len(cnty) == 3:
        return st + cnty
    # Fallback: geoid may contain the full 11-digit tract FIPS; first 5 digits are county.
    geoid = str(row.get('geoid', ''))
    if len(geoid) >= 5:
        return geoid[:5]
    return ''


def aggregate_to_counties(records: list) -> dict:
    """Aggregate tract/sub-county CHAS records to county-level cost-burden summaries.

    Returns a dict keyed by 5-digit county FIPS with renter and owner sub-dicts.
    """
    def _empty_tier():
        return {k: 0 for k in ('total', 'not_burdened', 'mod_burdened', 'severely_burdened')}

    accum = defaultdict(lambda: {
        'renter': {tier: _empty_tier() for tier in AMI_TIERS},
        'owner':  {tier: _empty_tier() for tier in AMI_TIERS},
    })

    renter_col_present = None
    owner_col_present = None
    for row in records:
        if renter_col_present is None:
            renter_col_present = RENTER_TOTAL_COL in row
            owner_col_present = OWNER_TOTAL_COL in row
            if not renter_col_present:
                print(
                    f'⚠ CHAS Table 1 column {RENTER_TOTAL_COL!r} not found in CSV. '
                    'County gap data will not be updated.',
                    file=sys.stderr,
                )
                break

        fips5 = build_county_fips(row)
        if not fips5 or len(fips5) != 5:
            continue

        # Accumulate renter data
        for tier, cols in RENTER_AMI_COLS.items():
            for metric, col in cols.items():
                accum[fips5]['renter'][tier][metric] += _int(row.get(col, 0))

        # Accumulate owner data (if columns present in this vintage)
        if owner_col_present:
            for tier, cols in OWNER_AMI_COLS.items():
                for metric, col in cols.items():
                    accum[fips5]['owner'][tier][metric] += _int(row.get(col, 0))

    return dict(accum)


def _burden_tier_record(tier_data: dict) -> dict:
    """Convert accumulated tier counts to burden metrics including 30% and 50% thresholds."""
    total      = tier_data.get('total', 0)
    mod_cb     = tier_data.get('mod_burdened', 0)    # 30–50% of income
    scb        = tier_data.get('severely_burdened', 0)  # >50% of income
    cb_30plus  = mod_cb + scb                           # ≥30% cost burden
    pct_cb_30  = round(cb_30plus / total, 4) if total > 0 else 0.0
    pct_cb_50  = round(scb / total, 4) if total > 0 else 0.0
    return {
        'total':                 total,
        'cost_burdened_30pct':   cb_30plus,    # paying ≥30% of income
        'cost_burdened_50pct':   scb,           # paying ≥50% of income (severe)
        'pct_cost_burdened_30':  pct_cb_30,
        'pct_cost_burdened_50':  pct_cb_50,
        # Legacy keys for backward compatibility
        'cost_burdened':         cb_30plus,
        'severely_burdened':     scb,
        'pct_cost_burdened':     pct_cb_30,
    }


def finalize_county_record(fips5: str, tier_data: dict) -> dict:
    """Convert accumulated integer counts to the output record shape.

    Accepts both old-format (dict of tier → metrics) and new-format
    (dict with 'renter' / 'owner' sub-dicts) for backward compatibility.
    """
    # Detect new vs old format
    if 'renter' in tier_data:
        renter_tiers = tier_data['renter']
        owner_tiers  = tier_data['owner']
    else:
        renter_tiers = tier_data
        owner_tiers  = {}

    renter_hh_by_ami = {}
    for tier in AMI_TIERS:
        renter_hh_by_ami[tier] = _burden_tier_record(renter_tiers.get(tier, {}))

    owner_hh_by_ami = {}
    for tier in AMI_TIERS:
        owner_hh_by_ami[tier] = _burden_tier_record(owner_tiers.get(tier, {}))

    # Cross-tenure totals
    total_renter = sum(renter_hh_by_ami[t]['total'] for t in AMI_TIERS)
    total_owner  = sum(owner_hh_by_ami[t]['total'] for t in AMI_TIERS)
    cb30_renter  = sum(renter_hh_by_ami[t]['cost_burdened_30pct'] for t in AMI_TIERS)
    cb50_renter  = sum(renter_hh_by_ami[t]['cost_burdened_50pct'] for t in AMI_TIERS)
    cb30_owner   = sum(owner_hh_by_ami[t]['cost_burdened_30pct'] for t in AMI_TIERS)
    cb50_owner   = sum(owner_hh_by_ami[t]['cost_burdened_50pct'] for t in AMI_TIERS)

    return {
        'fips': fips5,
        'name': CO_COUNTY_NAMES.get(fips5, fips5),
        'renter_hh_by_ami': renter_hh_by_ami,
        'owner_hh_by_ami':  owner_hh_by_ami,
        'summary': {
            'total_renter_hh':        total_renter,
            'total_owner_hh':         total_owner,
            'renter_cb30_count':      cb30_renter,
            'renter_cb50_count':      cb50_renter,
            'owner_cb30_count':       cb30_owner,
            'owner_cb50_count':       cb50_owner,
            'pct_renter_cb30':        round(cb30_renter / total_renter, 4) if total_renter else 0.0,
            'pct_renter_cb50':        round(cb50_renter / total_renter, 4) if total_renter else 0.0,
            'pct_owner_cb30':         round(cb30_owner / total_owner, 4) if total_owner else 0.0,
            'pct_owner_cb50':         round(cb50_owner / total_owner, 4) if total_owner else 0.0,
        },
    }


def build_gap_output(county_map: dict, generated: str) -> dict:
    """Build the chas_affordability_gap.json output structure."""
    counties_out = {}
    # Populate any county that appeared in the CHAS data
    for fips5, tier_data in sorted(county_map.items()):
        counties_out[fips5] = finalize_county_record(fips5, tier_data)

    # Compute state aggregate — handle both new (renter/owner) and old format
    def _empty_tenure_tiers():
        return {tier: {k: 0 for k in ('total', 'not_burdened', 'mod_burdened', 'severely_burdened')}
                for tier in AMI_TIERS}

    state_accum = {'renter': _empty_tenure_tiers(), 'owner': _empty_tenure_tiers()}
    for td in county_map.values():
        if 'renter' in td:
            renter_tiers = td['renter']
            owner_tiers  = td['owner']
        else:
            renter_tiers = td
            owner_tiers  = {}
        for tier in AMI_TIERS:
            for metric in ('total', 'not_burdened', 'mod_burdened', 'severely_burdened'):
                state_accum['renter'][tier][metric] += renter_tiers.get(tier, {}).get(metric, 0)
                if owner_tiers:
                    state_accum['owner'][tier][metric] += owner_tiers.get(tier, {}).get(metric, 0)

    state_entry = finalize_county_record('08', state_accum)
    state_entry['fips'] = '08'
    state_entry['name'] = 'Colorado'

    return {
        'meta': {
            'source': 'HUD CHAS (Comprehensive Housing Affordability Strategy)',
            'url': 'https://www.huduser.gov/portal/datasets/cp.html',
            'state': 'Colorado',
            'state_fips': COLORADO_FIPS,
            'vintage': VINTAGE,
            'generated': generated,
            'county_count': len(counties_out),
            'ami_tiers': AMI_TIERS,
            'tier_labels': AMI_TIER_LABELS,
            'cost_burden_thresholds': {
                '30pct': 'Households paying ≥30% of gross income on housing costs (moderately + severely burdened)',
                '50pct': 'Households paying ≥50% of gross income on housing costs (severely burdened)',
            },
            'tenure_breakdown': 'Separate renter and owner cost burden metrics included per county',
            'note': 'Rebuild via scripts/fetch_chas.py',
        },
        'state': state_entry,
        'counties': counties_out,
    }


def load_existing_gap(path: str) -> dict:
    """Load the existing gap file so we can merge/fall back gracefully."""
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}


def main() -> int:
    print('Fetching HUD CHAS data for Colorado…')
    try:
        raw = http_get(CHAS_STATE_URL)
    except Exception as exc:
        print(f'✗ Failed to download CHAS data: {exc}', file=sys.stderr)
        return 1

    records = []
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            records = extract_table1_records(zf)
            # Also collect all Colorado CSV rows for the raw output file
            all_co_records = records[:]
            table1_files = set(n for n in zf.namelist() if 'table1' in n.lower())
            other_tables = [n for n in zf.namelist() if n.endswith('.csv')
                            and 'Table' in n and n not in table1_files]
            for csv_name in other_tables[:2]:
                with zf.open(csv_name) as cf:
                    reader = csv.DictReader(io.TextIOWrapper(cf, encoding='utf-8-sig'))
                    for row in reader:
                        if str(row.get('st', '')).zfill(2) == COLORADO_FIPS:
                            all_co_records.append(dict(row))
    except Exception as exc:
        print(f'⚠ Could not parse CHAS ZIP: {exc}', file=sys.stderr)
        all_co_records = records

    # ── Write raw Colorado CHAS data ───────────────────────────────────────
    generated = utc_now()
    raw_output = {
        'meta': {
            'source': 'HUD CHAS (Comprehensive Housing Affordability Strategy)',
            'url': 'https://www.huduser.gov/portal/datasets/cp.html',
            'state': 'Colorado',
            'state_fips': COLORADO_FIPS,
            'vintage': VINTAGE,
            'generated': generated,
            'record_count': len(all_co_records),
        },
        'records': all_co_records,
    }
    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(raw_output, f)
    print(f'✓ Wrote {len(all_co_records)} CHAS records to {OUT_FILE}')

    # ── Build and write county-level affordability gap summary ─────────────
    existing_gap = load_existing_gap(GAP_FILE)
    county_map = aggregate_to_counties(records)

    if county_map:
        gap_output = build_gap_output(county_map, generated)
        # Preserve stub counties that are missing from CHAS data
        existing_counties = existing_gap.get('counties', {})
        for fips5 in existing_counties:
            if fips5 not in gap_output['counties']:
                gap_output['counties'][fips5] = existing_counties[fips5]
        gap_output['meta']['county_count'] = len(gap_output['counties'])
        print(f'✓ Built county gap data for {len(county_map)} counties from CHAS Table 1')
    else:
        # CHAS columns not found or data empty — keep existing gap file intact,
        # only update the generated timestamp.
        gap_output = existing_gap
        if gap_output:
            gap_output.setdefault('meta', {})['generated'] = generated
            print('⚠ No county-level CHAS cost-burden data found; existing gap file preserved')
        else:
            print('⚠ No gap data available and no existing file to preserve', file=sys.stderr)
            return 1

    os.makedirs(os.path.dirname(GAP_FILE), exist_ok=True)
    with open(GAP_FILE, 'w', encoding='utf-8') as f:
        json.dump(gap_output, f, ensure_ascii=False)
    print(f'✓ Wrote affordability gap data to {GAP_FILE}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
