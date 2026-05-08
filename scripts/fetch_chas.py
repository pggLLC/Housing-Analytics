#!/usr/bin/env python3
"""
fetch_chas.py — Fetch HUD CHAS (Comprehensive Housing Affordability Strategy) data for Colorado.

Downloads CHAS Table 7 (Tenure × Household Income (5) × Household Type ×
Cost Burden) from HUD, filters to Colorado, aggregates the 1,447 tract
rows to 64-county summaries, and writes:

  data/market/chas_co.json              — raw Colorado county records
  data/hna/chas_affordability_gap.json  — county-level affordability gap for HNA dashboard

Why Table 7 (not Table 9): Table 9 cross-tabs cost burden by RACE, not by
income tier — the prior parser confused Table 9's race-position cells for
HAMFI tiers and produced ~0.6% lte30 across all CO counties (real range
18–28%). Table 7 is the documented standard for cost-burden-by-AMI.

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

# ── CHAS Table 7 Column Mapping ─────────────────────────────────────
# Table 7: "Tenure by Household Income (5 categories) by Household Type (5)
#          by Housing Cost Burden (3)"
#
# Why Table 7 (not Table 9): Table 9 cross-tabs cost burden by RACE, not by
# income tier — it's the wrong table for cost-burden-by-AMI metrics. The
# 2026-04 audit caught this: prior parser produced ~0.6% lte30 across all
# CO counties (real range 18-28%) because Table 9's "income positions"
# weren't HAMFI bands at all. Switching to Table 7 (validated against
# the HUD CHAS data dictionary 2018-2022) gives the correct cross-tab.
#
# Table 7 layout (213 columns):
#   T7_est1   = Total occupied (renter + owner)
#   T7_est2   = Owner total (all incomes, all HH types, all CB)
#   T7_est3-23   = Owner ≤30% HAMFI block (21 cells)
#   T7_est24-44  = Owner >30-50% HAMFI block
#   T7_est45-65  = Owner >50-80% HAMFI block
#   T7_est66-86  = Owner >80-100% HAMFI block
#   T7_est87-107 = Owner >100% HAMFI block
#   T7_est108 = Renter total
#   T7_est109-129 = Renter ≤30% HAMFI block
#   T7_est130-150 = Renter >30-50% HAMFI block
#   T7_est151-171 = Renter >50-80% HAMFI block
#   T7_est172-192 = Renter >80-100% HAMFI block
#   T7_est193-213 = Renter >100% HAMFI block
#
# Each 21-cell HAMFI block:
#   offset 0     = tier subtotal (all HH types, all CB)
#   offset 1     = HH type 1 (elderly family) subtotal
#   offset 2-4   = HH type 1 × CB (≤30%, 30-50%, >50%)
#   offset 5     = HH type 2 (small family) subtotal
#   offset 6-8   = HH type 2 × CB
#   offset 9-12  = HH type 3 (large family) sub + 3 CB
#   offset 13-16 = HH type 4 (elderly non-family) sub + 3 CB
#   offset 17-20 = HH type 5 (other non-elderly non-family) sub + 3 CB
#
# To compute cost-burden by HAMFI tier (ignoring HH type detail):
#   Total at tier T          = tier subtotal cell
#   Not-burdened (CB ≤30%)   = sum of 5 cells at offsets 2, 6, 10, 14, 18
#   Moderately burdened (CB 30-50%) = sum at offsets 3, 7, 11, 15, 19
#   Severely burdened (CB >50%)     = sum at offsets 4, 8, 12, 16, 20
#   Cost-burdened (≥30% income) = mod + severe

CHAS_TABLE = 'table7'
CHAS_TABLE_PREFIX = 'T7_est'

# Renter / Owner total subtotal column indices
RENTER_TOTAL_COL = 'T7_est108'
OWNER_TOTAL_COL = 'T7_est2'

# HAMFI tier block start indices (subtotal for "all HH types, all CB").
# Within each block: offsets 0..20 inclusive — see layout comment above.
RENTER_HAMFI_BLOCKS = {
    'lte30':    109,   # ≤30% HAMFI
    '31to50':   130,   # >30% but ≤50% HAMFI
    '51to80':   151,   # >50% but ≤80% HAMFI
    '81to100':  172,   # >80% but ≤100% HAMFI
    '100plus':  193,   # >100% HAMFI
}
OWNER_HAMFI_BLOCKS = {
    'lte30':     3,
    '31to50':   24,
    '51to80':   45,
    '81to100':  66,
    '100plus':  87,
}

# Within each 21-cell HAMFI block, these offsets locate the cost-burden
# detail cells. There are 5 household types; for each, 4 cells:
#   [HH-type subtotal, CB ≤30%, CB 30-50%, CB >50%]. We extract the 3 CB
# cells and sum across the 5 HH types.
HH_TYPE_CB_OFFSETS = [
    # (cb_lte30_offset, cb_30to50_offset, cb_gt50_offset) per HH type
    (2, 3, 4),     # HH type 1: elderly family
    (6, 7, 8),     # HH type 2: small family
    (10, 11, 12),  # HH type 3: large family
    (14, 15, 16),  # HH type 4: elderly non-family
    (18, 19, 20),  # HH type 5: other (non-elderly non-family)
]

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

AMI_TIERS = ['lte30', '31to50', '51to80', '81to100', '100plus']
AMI_TIER_LABELS = {
    'lte30':    '\u226430% AMI',
    '31to50':   '31\u201350% AMI',
    '51to80':   '51\u201380% AMI',
    '81to100':  '81\u2013100% AMI',
    '100plus':  '>100% AMI',
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

    # Primary: Table 7 (Tenure × HH-Income(5) × HH-Type × Cost-Burden) —
    # the standard cross-tab for cost-burden by HAMFI tier.
    # Match 'table7' but NOT 'table7?' siblings like 'table17a'.
    def _is_table7(name):
        base = _norm(posixpath.basename(name))
        # 'table7' must appear and NOT be followed by another digit
        idx = base.find('table7')
        if idx < 0:
            return False
        next_chr_idx = idx + len('table7')
        if next_chr_idx < len(base) and base[next_chr_idx].isdigit():
            return False
        return True

    candidates = [n for n in names
                  if n.lower().endswith('.csv') and _is_table7(n)]
    # Fallback: try table1 (broad cross-tab) if table7 not present
    if not candidates:
        candidates = [n for n in names
                      if n.lower().endswith('.csv')
                      and 'table1' in _norm(posixpath.basename(n))
                      and not any(_norm(posixpath.basename(n)).startswith(f'table1{d}') for d in '0123456789')]
    # Last resort: any CSV with 'Table' in path
    if not candidates:
        candidates = [n for n in names
                      if n.lower().endswith('.csv') and 'table' in n.lower()]
    # Last resort: any CSV (HUD sometimes ships a single table)
    if not candidates:
        candidates = [n for n in names if n.lower().endswith('.csv')]

    records = []
    for csv_name in candidates[:1]:   # only the chosen table
        print(f'  Reading CHAS CSV: {csv_name}')
        with zf.open(csv_name) as cf:
            reader = csv.DictReader(io.TextIOWrapper(cf, encoding='latin-1'))
            # Log first row's keys to aid debugging column-name issues
            peek = next(reader, None)
            if peek is None:
                print(f'  ⚠ CSV {csv_name} is empty', file=sys.stderr)
                continue
            print(f'  CSV columns (first 15): {list(peek.keys())[:15]}')
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


def _extract_tier_from_block(col_sums: dict, block_start: int) -> dict:
    """Compute one HAMFI tier's cost-burden breakdown from a Table 7 block.

    Each 21-cell HAMFI block in Table 7:
      [tier_subtotal, hhtype1_sub, hhtype1_cb_lte30, hhtype1_cb_30to50,
       hhtype1_cb_gt50, hhtype2_sub, hhtype2_cb_lte30, ..., hhtype5_cb_gt50]

    Returns:
      {
        'total':              <tier subtotal — all HH types, all CB>,
        'not_burdened':       <sum of CB ≤30% across 5 HH types>,
        'mod_burdened':       <sum of CB 30-50% across 5 HH types>,
        'severely_burdened':  <sum of CB >50% across 5 HH types>,
      }
    """
    def _cell(off: int) -> int:
        return int(col_sums.get(f'{CHAS_TABLE_PREFIX}{block_start + off}', 0) or 0)

    total = _cell(0)
    not_burdened = sum(_cell(off_lte30) for off_lte30, _, _ in HH_TYPE_CB_OFFSETS)
    mod_burdened = sum(_cell(off_30to50) for _, off_30to50, _ in HH_TYPE_CB_OFFSETS)
    severely_burdened = sum(_cell(off_gt50) for _, _, off_gt50 in HH_TYPE_CB_OFFSETS)
    return {
        'total':             total,
        'not_burdened':      not_burdened,
        'mod_burdened':      mod_burdened,
        'severely_burdened': severely_burdened,
    }


def aggregate_to_counties(records: list) -> dict:
    """Aggregate tract-level CHAS Table 7 records to county-level summaries.

    For each county and each of the 5 HAMFI tiers (≤30, 30-50, 50-80,
    80-100, 100+), extract the tier subtotal and the three cost-burden
    detail counts (≤30% / 30-50% / >50% of income), summed across all
    five household types. See top-of-file comment for the Table 7 layout.

    Returns dict keyed by 5-digit county FIPS:
      {fips5: {'renter': {tier: {total, not_burdened, mod_burdened, severely_burdened}},
               'owner':  {tier: {...}}}}
    """
    col_sums = defaultdict(lambda: defaultdict(int))

    has_data = False
    for row in records:
        if not has_data:
            if RENTER_TOTAL_COL not in row:
                print(f'⚠ Column {RENTER_TOTAL_COL!r} not found. '
                      f'Available columns: {[k for k in row.keys() if k.startswith("T")][:15]}',
                      file=sys.stderr)
                break
            has_data = True

        fips5 = build_county_fips(row)
        if not fips5 or len(fips5) != 5:
            continue

        for k, v in row.items():
            if k.startswith(CHAS_TABLE_PREFIX):
                col_sums[fips5][k] += _int(v)

    if not has_data:
        return {}

    accum = {}
    for fips5, csums in col_sums.items():
        renter_tiers = {
            tier_name: _extract_tier_from_block(csums, block_start)
            for tier_name, block_start in RENTER_HAMFI_BLOCKS.items()
        }
        owner_tiers = {
            tier_name: _extract_tier_from_block(csums, block_start)
            for tier_name, block_start in OWNER_HAMFI_BLOCKS.items()
        }
        accum[fips5] = {
            'renter': renter_tiers,
            'owner':  owner_tiers,
        }

    print(f'  Aggregated {len(records)} tracts into {len(accum)} counties (Table 7)')

    # Post-aggregation validation: parts (not_burdened + mod + severe) should
    # ≈ total per tier. CHAS includes a "Not computed" sub-cell that's part of
    # the tier total but not counted in any of our 3 burden classes, so allow
    # parts < total. parts > total*1.1 indicates a column-mapping bug.
    validation_errors = 0
    for fips5, county in accum.items():
        for tenure_key in ('renter', 'owner'):
            for tier_name, td in county.get(tenure_key, {}).items():
                total = td.get('total', 0)
                nb = td.get('not_burdened', 0)
                mb = td.get('mod_burdened', 0)
                sb = td.get('severely_burdened', 0)
                sum_parts = nb + mb + sb
                if total > 0 and sum_parts > total * 1.1:
                    validation_errors += 1
                    if validation_errors <= 5:
                        print(f'  ⚠ Validation: {fips5} {tenure_key} {tier_name}: '
                              f'total={total}, sum(parts)={sum_parts}', file=sys.stderr)

    if validation_errors > 0:
        print(f'  ⚠ {validation_errors} validation warnings (parts > total)',
              file=sys.stderr)
    else:
        print(f'  ✓ Validation passed for {len(accum)} counties')

    # Sanity: state-wide ≤30% HAMFI renter HH count should be > 100K for CO.
    # Pre-fix Table 9 parsing produced ~3K total — would have caught the bug.
    state_lte30_renter = sum(
        c.get('renter', {}).get('lte30', {}).get('total', 0)
        for c in accum.values()
    )
    print(f'  Statewide CO renter HH at ≤30% HAMFI: {state_lte30_renter:,}')
    if state_lte30_renter < 100_000:
        raise RuntimeError(
            f'Table 7 parsing produced implausibly low statewide ≤30% HAMFI '
            f'renter count ({state_lte30_renter:,}); expected > 100,000. '
            f'Likely a column-mapping regression.'
        )

    return accum


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
