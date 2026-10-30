#!/usr/bin/env python3
"""
scripts/hud/build_hud_s8_contracts.py

Colorado's project-based rental assistance contracts, from HUD's Multifamily
Assistance & Section 8 Contracts database, written to
data/market/hud_s8_contracts_co.json for the Preservation page.

HUD publishes two workbooks, refreshed about monthly, and says to join them on
property_id: one row per contract (term dates, assisted units, program) and one
row per property (name, address, county). Source page:
https://www.hud.gov/hud-partners/multifamily-assist-section8-database

    python3 scripts/hud/build_hud_s8_contracts.py --as-of 2026-10-06
    python3 scripts/hud/build_hud_s8_contracts.py --from-dir DIR --as-of 2026-10-06

--as-of is the "Current as of" date printed on HUD's page; the workbooks carry
no date of their own.

What it keeps: property and contract facts only. The property workbook also
lists owner and management-agent names, phone numbers and email addresses;
none of those are copied (named-person contacts never go in this public repo).

"Term ends" is HUD's tracs_overall_expiration_date, the end of the contract's
overall term. Owners can renew, so an ending term is a date to watch, not a
loss of the homes.
"""

import argparse
import json
import re
import sys
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_FILE = ROOT / 'data' / 'market' / 'hud_s8_contracts_co.json'

PAGE = 'https://www.hud.gov/hud-partners/multifamily-assist-section8-database'
DOWNLOAD = 'https://www.hud.gov/sites/dfiles/Housing/documents/{name}'
PROPERTIES = 'MF-Properties-with-Assistance-Sec8-Contracts1.xlsx'
CONTRACTS = 'MF-Assistance-Sec8-Contracts1.xlsx'
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

# HUD's program_type_group_name, in plain words.
PROGRAMS = {
    'S8 State Agency': 'Section 8 (state housing agency)',
    'PRAC 202/811': 'Section 202/811 rental assistance (PRAC)',
    'Sec. 202': 'Section 202 with Section 8',
    'S8 Loan Mgmt': 'Section 8 Loan Management',
    'Other S8 New': 'Section 8 New Construction',
    'S8 FmHA': 'Section 8 with a USDA (FmHA) loan',
    'S8 RAD Mod Rehab Con': 'RAD conversion (Moderate Rehabilitation)',
    '811 PRA Demo': 'Section 811 Project Rental Assistance',
    'S8 Prop. Disp.': 'Section 8 Property Disposition',
    'Other S8 Rehab': 'Section 8 Substantial Rehabilitation',
    'S8 RAD PH Conv': 'RAD conversion (public housing)',
    'S8 Preservation': 'Section 8 Preservation',
    'S8 RAD PRAC Conv': 'RAD conversion (PRAC)',
}

EPOCH = datetime(1899, 12, 30)


def read_xlsx(path):
    """Rows of the first sheet as dicts keyed by the header row. Stdlib only."""
    with zipfile.ZipFile(path) as z:
        sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
        ns = sheet.tag[1:sheet.tag.index('}')]
        q = lambda name: '{%s}%s' % (ns, name)
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall(q('si')):
                shared.append(''.join(t.text or '' for t in si.iter(q('t'))))
    rows = []
    for row in sheet.iter(q('row')):
        vals = {}
        for c in row.findall(q('c')):
            col = re.match(r'[A-Z]+', c.get('r')).group(0)
            v = c.find(q('v'))
            if c.get('t') == 'inlineStr':
                vals[col] = ''.join(t.text or '' for t in c.iter(q('t')))
            elif v is None:
                vals[col] = None
            elif c.get('t') == 's':
                vals[col] = shared[int(v.text)]
            else:
                vals[col] = v.text
        rows.append(vals)
    header = {k: (v or '').strip() for k, v in rows[0].items()}
    return [{header[k]: v for k, v in r.items() if k in header} for r in rows[1:]]


def text(v):
    return re.sub(r'\s+', ' ', str(v or '')).strip()


def to_int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def to_date(v):
    """HUD's dates arrive as Excel serial numbers."""
    try:
        return (EPOCH + timedelta(days=float(v))).date().isoformat()
    except (TypeError, ValueError):
        return None


def fetch(name, dest):
    req = urllib.request.Request(DOWNLOAD.format(name=name), headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, 'wb') as f:
        f.write(r.read())


def build(props_rows, contract_rows, as_of):
    props = {}
    for p in props_rows:
        if text(p.get('state_code')) != 'CO':
            continue
        cc = text(p.get('county_code')).zfill(3)
        props[text(p.get('property_id'))] = {
            'property_id': text(p.get('property_id')),
            'property_name': text(p.get('property_name_text')),
            'address': text(p.get('address_line1_text')),
            'city': text(p.get('city_name_text')).title(),
            'zip': text(p.get('zip_code')),
            'county_fips': '08' + cc if re.fullmatch(r'\d{3}', cc) else None,
            'county_name': text(p.get('county_name_text')),
            'property_units': to_int(p.get('property_total_unit_count')),
            'category': text(p.get('property_category_name')),
        }
    contracts = []
    unknown = set()
    for c in contract_rows:
        p = props.get(text(c.get('property_id')))
        if not p:
            continue
        group = text(c.get('program_type_group_name'))
        if group not in PROGRAMS:
            unknown.add(group)
        contracts.append(dict(p, **{
            'contract_number': text(c.get('contract_number')),
            'status': text(c.get('tracs_status_name')),
            'program_group': group,
            'program': PROGRAMS.get(group, group),
            'program_type': text(c.get('program_type_name')),
            'assisted_units': to_int(c.get('assisted_units_count')),
            'term_ends': to_date(c.get('tracs_overall_expiration_date')),
            'rent_to_fmr': text(c.get('rent_to_FMR_description')) or None,
        }))
    if unknown:
        raise ValueError('new HUD program groups, add plain names to PROGRAMS: %s' % sorted(unknown))
    if len(props) < 250 or len(contracts) < 250:
        raise ValueError('only %d Colorado properties and %d contracts; HUD lists about 340 of each'
                         % (len(props), len(contracts)))
    if any(not c['county_fips'] for c in contracts):
        raise ValueError('a Colorado property has no county code')
    contracts.sort(key=lambda c: (c['term_ends'] or '9999', c['property_name']))
    fetched = date.today()
    return {
        'meta': {
            'source': 'HUD Multifamily Assistance & Section 8 Contracts database',
            'source_url': PAGE,
            'downloads': [DOWNLOAD.format(name=n) for n in (PROPERTIES, CONTRACTS)],
            'as_of': as_of,
            'fetched': fetched.isoformat(),
            'review_by': (fetched + timedelta(days=45)).isoformat(),
            'built_by': 'scripts/hud/build_hud_s8_contracts.py',
            'term_ends_field': 'tracs_overall_expiration_date: the end of the contract\'s overall term. Owners can renew.',
            'excluded': 'Owner and management-agent names, phone numbers and email addresses are not copied.',
            'property_count': len(props),
            'contract_count': len(contracts),
        },
        'contracts': contracts,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    ap.add_argument('--from-dir', help='read the two saved workbooks instead of downloading')
    ap.add_argument('--as-of', required=True, help='"Current as of" date on HUD\'s page, YYYY-MM-DD')
    args = ap.parse_args()
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', args.as_of):
        ap.error('--as-of must be YYYY-MM-DD')
    if args.from_dir:
        d = Path(args.from_dir)
    else:
        import tempfile
        d = Path(tempfile.mkdtemp())
        for name in (PROPERTIES, CONTRACTS):
            fetch(name, d / name)
    try:
        out = build(read_xlsx(d / PROPERTIES), read_xlsx(d / CONTRACTS), args.as_of)
    except ValueError as e:
        print('build_hud_s8_contracts: %s; file left unchanged' % e, file=sys.stderr)
        return 1
    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write('\n')
    m = out['meta']
    print('wrote %s: %d properties, %d contracts (HUD as of %s)'
          % (OUT_FILE.relative_to(ROOT), m['property_count'], m['contract_count'], m['as_of']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
