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
# 2018-2022 released December 23, 2025.  Prior vintage: 2017-2021 (September 2024).
# Try newest vintage first; fall back to prior vintage if the primary URL 404s.
CHAS_STATE_URL = (
    'https://www.huduser.gov/portal/datasets/cp/2018thru2022-140-csv.zip'
)
CHAS_STATE_URL_FALLBACK = (
    'https://www.huduser.gov/portal/datasets/cp/2017thru2021-140-csv.zip'
)
COLORADO_FIPS = '08'
VINTAGE = '2018-2022'
TIMEOUT = 300  # 234 MB download needs more time

# Local cache so re-runs don't re-download 234 MB
CACHE_PATH = os.path.join(REPO_ROOT, '.cache', 'chas_140_csv.zip')

# ── CHAS Table 1 Column Mapping ─────────────────────────────────────
# HUD CHAS Table 1 cross-tabulates households by tenure × AMI × cost burden.
# Column numbering changes between vintages. This mapping is verified against
# the official data dictionaries:
#   2016-2020: https://www.huduser.gov/portal/datasets/cp/CHAS/CHAS-data-dictionary-16-20.xlsx
#   2017-2021: same structure as 2016-2020 (confirmed by HUD)
#   2018-2022: https://www.huduser.gov/portal/datasets/cp/CHAS/CHAS-data-dictionary-18-22.xlsx
#
# Table 1 structure (consistent across 2016-2020 through 2018-2022):
#   T1_est1  = Total occupied units
#   T1_est2  = Total renter-occupied
#   T1_est3  = Renter, ≤30% AMI, total
#   T1_est4  = Renter, ≤30% AMI, cost burden ≤30% (not burdened)
#   T1_est5  = Renter, ≤30% AMI, cost burden 30-50% (moderately burdened)
#   T1_est6  = Renter, ≤30% AMI, cost burden >50% (severely burdened)
#   T1_est7  = Renter, ≤30% AMI, not computed
#   T1_est8  = Renter, 31-50% AMI, total
#   ... (pattern repeats: total, ≤30%, 30-50%, >50%, not computed)
#
# The pattern: each AMI tier is 5 columns (total + 4 sub-categories).
# Renter section starts at T1_est2 (renter total), AMI tiers at T1_est3.
# Owner section starts at T1_est27 (owner total), AMI tiers at T1_est28.
#
# IMPORTANT: The mapping below uses the CORRECTED column layout from HUD
# data dictionaries. The prior mapping (T1_est26-based) was WRONG and caused
# systematic data corruption across all 64 counties.
RENTER_TOTAL_COL = 'T1_est2'
RENTER_AMI_COLS = {
    'lte30': {
        'total':             'T1_est3',
        'not_burdened':      'T1_est4',
        'mod_burdened':      'T1_est5',   # 30–50% of income
        'severely_burdened': 'T1_est6',   # >50% of income
    },
    '31to50': {
        'total':             'T1_est8',
        'not_burdened':      'T1_est9',
        'mod_burdened':      'T1_est10',
        'severely_burdened': 'T1_est11',
    },
    '51to80': {
        'total':             'T1_est13',
        'not_burdened':      'T1_est14',
        'mod_burdened':      'T1_est15',
        'severely_burdened': 'T1_est16',
    },
    '81to100': {
        'total':             'T1_est18',
        'not_burdened':      'T1_est19',
        'mod_burdened':      'T1_est20',
        'severely_burdened': 'T1_est21',
    },
}

# Owner-occupied section starts after the renter section
# Owner total is T1_est27, then same 5-column pattern per AMI tier
OWNER_TOTAL_COL = 'T1_est27'
OWNER_AMI_COLS = {
    'lte30': {
        'total':             'T1_est28',
        'not_burdened':      'T1_est29',
        'mod_burdened':      'T1_est30',
        'severely_burdened': 'T1_est31',
    },
    '31to50': {
        'total':             'T1_est33',
        'not_burdened':      'T1_est34',
        'mod_burdened':      'T1_est35',
        'severely_burdened': 'T1_est36',
    },
    '51to80': {
        'total':             'T1_est38',
        'not_burdened':      'T1_est39',
        'mod_burdened':      'T1_est40',
        'severely_burdened': 'T1_est41',
    },
    '81to100': {
        'total':             'T1_est43',
        'not_burdened':      'T1_est44',
        'mod_burdened':      'T1_est45',
        'severely_burdened': 'T1_est46',
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


def _extract_fips_from_geoid(geoid: str) -> str:
    """Extract the raw numeric FIPS from a CHAS geoid string.

    CHAS geoid formats across vintages:
      - '14000US08001012345'  (prefixed with summary-level + 'US')
      - '08001012345'          (raw 11-digit tract FIPS)
    Returns the numeric portion (e.g. '08001012345') or '' on failure.
    """
    geoid = str(geoid).strip()
    # Strip any prefix like '14000US', '05000US', etc.
    if 'US' in geoid:
        geoid = geoid.split('US', 1)[1]
    # Remove any remaining non-digit characters
    digits = ''.join(c for c in geoid if c.isdigit())
    return digits


def build_county_fips(row: dict) -> str:
    """Derive 5-digit county FIPS from a CHAS CSV row (Rule 1).

    Tries multiple strategies:
    1. 'st' + 'cnty' fields (some vintages have these)
    2. geoid field (prefixed or raw) — extract first 5 digits of the numeric FIPS
    """
    # Strategy 1: separate st/cnty fields
    st_raw   = row.get('st', row.get('state', row.get('stfips', '')))
    cnty_raw = row.get('cnty', row.get('county', row.get('cntyfips', '')))
    if st_raw and cnty_raw:
        st   = str(st_raw).strip().zfill(2)
        cnty = str(cnty_raw).strip().zfill(3)
        if st == COLORADO_FIPS and len(cnty) == 3 and cnty.isdigit():
            return st + cnty

    # Strategy 2: extract from geoid (handles '14000US08001012345' format)
    geoid = str(row.get('geoid', ''))
    digits = _extract_fips_from_geoid(geoid)
    if len(digits) >= 5 and digits[:2] == COLORADO_FIPS:
        return digits[:5]

    return ''


def _is_colorado_row(row: dict) -> bool:
    """Check if a CHAS CSV row belongs to Colorado using multiple strategies."""
    # Strategy 1: direct state field
    state_val = (row.get('st') or row.get('state') or
                 row.get('stfips') or row.get('stateId') or '')
    if state_val:
        if str(state_val).strip().zfill(2) == COLORADO_FIPS:
            return True
    # Strategy 2: check geoid for Colorado prefix
    geoid = str(row.get('geoid', ''))
    digits = _extract_fips_from_geoid(geoid)
    if len(digits) >= 2 and digits[:2] == COLORADO_FIPS:
        return True
    return False


def extract_table1_records(zf: zipfile.ZipFile) -> list:
    """Return all rows from Table1.csv (or equivalent) in the CHAS ZIP.

    Handles:
    - Files at ZIP root or inside subdirectories (path contains 'table1')
    - Case variations (Table1, TABLE1, table1)
    - Vintage differences in state-field naming (st / state / stateId / stfips)
    """
    import posixpath
    names = zf.namelist()

    def _norm(s):
        return s.lower().replace(' ', '').replace('-', '').replace('_', '')

    # Primary: any CSV whose basename (not full path) contains 'table1'
    candidates = [n for n in names
                  if n.lower().endswith('.csv')
                  and 'table1' in _norm(posixpath.basename(n))]
    # Fallback: any CSV with 'Table' in its full path
    if not candidates:
        candidates = [n for n in names
                      if n.lower().endswith('.csv') and 'table' in n.lower()]
    # Last resort: any CSV (HUD sometimes ships a single table)
    if not candidates:
        candidates = [n for n in names if n.lower().endswith('.csv')]

    records = []
    for csv_name in candidates[:1]:   # only Table 1
        print(f'  Reading CHAS CSV: {csv_name}')
        with zf.open(csv_name) as cf:
            reader = csv.DictReader(io.TextIOWrapper(cf, encoding='latin-1'))
            # Log first row's keys to aid debugging column-name issues
            peek = next(reader, None)
            if peek is None:
                print(f'  ⚠ CSV {csv_name} is empty', file=sys.stderr)
                continue
            all_cols = list(peek.keys())
            print(f'  CSV columns (first 15): {all_cols[:15]}')
            t1_cols = sorted([c for c in all_cols if c.startswith('T1_est')],
                             key=lambda x: int(x.replace('T1_est', '')) if x.replace('T1_est', '').isdigit() else 0)
            print(f'  T1_est columns found: {len(t1_cols)} ({t1_cols[:8]}...)')

            # Validate that our expected columns exist in the CSV
            missing_renter = [c for t in RENTER_AMI_COLS.values() for c in t.values() if c not in all_cols]
            missing_owner = [c for t in OWNER_AMI_COLS.values() for c in t.values() if c not in all_cols]
            if RENTER_TOTAL_COL not in all_cols:
                missing_renter.insert(0, RENTER_TOTAL_COL)
            if missing_renter:
                print(f'  ❌ Missing RENTER columns: {missing_renter}', file=sys.stderr)
                print(f'  Available T1_est columns: {t1_cols}', file=sys.stderr)
                print(f'  The column mapping may not match this CHAS vintage.', file=sys.stderr)
            if missing_owner:
                print(f'  ⚠ Missing OWNER columns: {missing_owner}', file=sys.stderr)

            # Show first Colorado row values for key columns (debugging aid)
            if _is_colorado_row(peek):
                print(f'  Sample values (first CO row):')
                for col in [RENTER_TOTAL_COL] + [v for t in list(RENTER_AMI_COLS.values())[:1] for v in t.values()]:
                    print(f'    {col}: {peek.get(col, "MISSING")}')

            # Check if this first row is Colorado
            if _is_colorado_row(peek):
                records.append(dict(peek))
            for row in reader:
                if _is_colorado_row(row):
                    records.append(dict(row))
    if not records:
        print(f'  ⚠ No Colorado rows found in {candidates[:1]} '
              f'(files in ZIP: {names[:10]})', file=sys.stderr)
    else:
        print(f'  Found {len(records)} Colorado tract rows')
    return records


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

    result = dict(accum)

    # ── Post-aggregation validation ─────────────────────────────────
    # Check that sub-components never exceed totals. If they do, the
    # column mapping is wrong for this CHAS vintage.
    validation_errors = 0
    for fips5, county in result.items():
        for tenure_key in ('renter', 'owner'):
            tiers = county.get(tenure_key, {})
            for tier_name, tier_data in tiers.items():
                total = tier_data.get('total', 0)
                nb = tier_data.get('not_burdened', 0)
                mb = tier_data.get('mod_burdened', 0)
                sb = tier_data.get('severely_burdened', 0)
                sum_parts = nb + mb + sb
                # Validation: parts should approximately equal total
                # (CHAS includes a "not computed" residual, so sum_parts <= total)
                if total > 0 and sum_parts > total * 1.1:
                    validation_errors += 1
                    if validation_errors <= 5:
                        print(f'  ⚠ Validation fail: {fips5} {tenure_key} {tier_name}: '
                              f'total={total}, sum(nb+mb+sb)={sum_parts} (exceeds total)',
                              file=sys.stderr)
                # Also check: if total is 0 but sub-components are large, column mapping is wrong
                if total == 0 and (mb + sb) > 100:
                    validation_errors += 1
                    if validation_errors <= 5:
                        print(f'  ⚠ Validation fail: {fips5} {tenure_key} {tier_name}: '
                              f'total=0 but burden={mb + sb} (likely wrong column mapping)',
                              file=sys.stderr)

    if validation_errors > 0:
        print(f'\n  ❌ {validation_errors} validation errors detected.',
              file=sys.stderr)
        print(f'  The CHAS column mapping (T1_est* constants) may not match this data vintage.',
              file=sys.stderr)
        print(f'  Download the data dictionary from https://www.huduser.gov/portal/datasets/cp/CHAS/data_doc_chas.html',
              file=sys.stderr)
        print(f'  and verify the column numbering for Table 1 renter/owner cost-burden tiers.',
              file=sys.stderr)
    else:
        print(f'  ✓ Aggregation validation passed for {len(result)} counties')

    return result


def _burden_tier_record(tier_data: dict) -> dict:
    """Convert accumulated tier counts to burden metrics including 30% and 50% thresholds."""
    total      = tier_data.get('total', 0)
    mod_cb     = tier_data.get('mod_burdened', 0)    # 30–50% of income
    scb        = tier_data.get('severely_burdened', 0)  # >50% of income
    cb_30plus  = mod_cb + scb                           # ≥30% cost burden
    # Guard: clamp cost-burdened counts to total (prevents ETL field-mapping corruption)
    if total > 0 and cb_30plus > total:
        cb_30plus = total
    if total > 0 and scb > total:
        scb = total
    if cb_30plus > 0 and scb > cb_30plus:
        scb = cb_30plus
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


def _download_or_cache() -> bytes:
    """Download the CHAS ZIP or return a cached copy."""
    # Check cache first
    if os.path.isfile(CACHE_PATH):
        print(f'  Using cached ZIP: {CACHE_PATH}')
        with open(CACHE_PATH, 'rb') as f:
            return f.read()

    raw = None
    for url in (CHAS_STATE_URL, CHAS_STATE_URL_FALLBACK):
        try:
            print(f'  Trying {url}')
            raw = http_get(url, timeout=TIMEOUT)
            print(f'  ✓ Downloaded {len(raw):,} bytes')
            break
        except Exception as exc:
            print(f'  ✗ {exc}', file=sys.stderr)
    if raw:
        os.makedirs(os.path.dirname(CACHE_PATH), exist_ok=True)
        with open(CACHE_PATH, 'wb') as f:
            f.write(raw)
        print(f'  Cached to {CACHE_PATH}')
    return raw


def main() -> int:
    print('Fetching HUD CHAS data for Colorado…')
    raw = _download_or_cache()
    if not raw:
        print('✗ All CHAS download URLs failed.', file=sys.stderr)
        return 1

    records = []
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as zf:
            print(f'  ZIP contents ({len(zf.namelist())} files): {zf.namelist()[:10]}')
            records = extract_table1_records(zf)
    except Exception as exc:
        print(f'⚠ Could not parse CHAS ZIP: {exc}', file=sys.stderr)
        return 1

    if not records:
        print('✗ No Colorado tract records found in CHAS Table 1.', file=sys.stderr)
        return 1

    # ── Aggregate tracts to counties ──────────────────────────────────────
    generated = utc_now()
    county_map = aggregate_to_counties(records)

    if not county_map:
        print('✗ Aggregation produced 0 counties (column mismatch?).', file=sys.stderr)
        return 1

    print(f'  Aggregated {len(records)} tracts into {len(county_map)} counties')

    # ── Write county-level chas_co.json ───────────────────────────────────
    county_records = []
    for fips5 in sorted(county_map):
        county_records.append(finalize_county_record(fips5, county_map[fips5]))

    raw_output = {
        'meta': {
            'source': 'HUD CHAS (Comprehensive Housing Affordability Strategy)',
            'url': 'https://www.huduser.gov/portal/datasets/cp.html',
            'state': 'Colorado',
            'state_fips': COLORADO_FIPS,
            'vintage': VINTAGE,
            'generated': generated,
            'record_count': len(county_records),
            'note': 'County-level aggregation of tract-level CHAS Table 1 data. '
                    'Rebuild via scripts/fetch_chas.py',
        },
        'records': county_records,
    }
    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(raw_output, f, ensure_ascii=False)
    print(f'✓ Wrote {len(county_records)} county records to {OUT_FILE}')

    # ── Build and write county-level affordability gap summary ─────────────
    existing_gap = load_existing_gap(GAP_FILE)
    gap_output = build_gap_output(county_map, generated)
    # Preserve stub counties that are missing from CHAS data
    existing_counties = existing_gap.get('counties', {})
    for fips5 in existing_counties:
        if fips5 not in gap_output['counties']:
            gap_output['counties'][fips5] = existing_counties[fips5]
    gap_output['meta']['county_count'] = len(gap_output['counties'])
    print(f'✓ Built county gap data for {len(county_map)} counties from CHAS Table 1')

    os.makedirs(os.path.dirname(GAP_FILE), exist_ok=True)
    with open(GAP_FILE, 'w', encoding='utf-8') as f:
        json.dump(gap_output, f, ensure_ascii=False)
    print(f'✓ Wrote affordability gap data to {GAP_FILE}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
