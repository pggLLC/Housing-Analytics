#!/usr/bin/env python3
"""
scripts/hud/build_hud_lihtc_match.py

Match CHFA's Colorado LIHTC records (data/chfa-lihtc.json) to HUD's LIHTC
database and write data/hud-lihtc-co-match.json, which
scripts/fetch-chfa-lihtc.js copies onto each matched record.

Why offline: huduser.gov answers automated downloads with an empty page, so
the source is a browser download of https://www.huduser.gov/lihtc/lihtcpub.zip
(LIHTCPUB.xlsx inside). Rerun after each HUD update (HUD adds a placed-in-service
year each spring):

    python3 scripts/hud/build_hud_lihtc_match.py path/to/LIHTCPUB.xlsx

What it carries (HUD's codes, from "LIHTC Data Dictionary 2024"):
  NON_PROF  nonprofit sponsor            1=Yes 2=No
  BASIS     increase in eligible basis   1=Yes 2=No
  QCT       tract is a QCT               1=In 2=Not in
  DDA       tract in a DDA               0=Not 1=Metro 2=Non-metro 3/4=GO Zone
HUD bases QCT and DDA on the placed-in-service year, not the allocation year
that governs the basis boost, so those two are stored as *_pis and are never
written into the records' QCT/DDA columns.

Matching is deliberately strict. A pair is accepted only when the award and
allocation years are within two years, unit counts agree within 10% (or 2),
any phase numbers agree, and the name, street address or map point agree; a
pair is dropped if a second candidate scores close to it, on either side.
Unmatched records keep null: no value is ever guessed.
"""

import argparse
import difflib
import hashlib
import json
import math
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
CHFA_FILE = ROOT / 'data' / 'chfa-lihtc.json'
OUT_FILE = ROOT / 'data' / 'hud-lihtc-co-match.json'

SOURCE = {
    'label': 'HUD LIHTC database',
    'url': 'https://www.huduser.gov/portal/datasets/lihtc/property.html',
    'download': 'https://www.huduser.gov/lihtc/lihtcpub.zip',
    'dictionary': 'LIHTC Data Dictionary 2024 (inside lihtcpub.zip)',
}

def read_xlsx(path):
    """Rows of the first sheet as dicts. Stdlib only: HUD's file trips openpyxl."""
    with zipfile.ZipFile(path) as z:
        sheet = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
        # SpreadsheetML namespace, taken from the file rather than spelled out.
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
                text = ''.join(t.text or '' for t in c.iter(q('t')))
            elif v is None:
                text = None
            elif c.get('t') == 's':
                text = shared[int(v.text)]
            else:
                text = v.text
            vals[col] = text
        rows.append(vals)
    header = {k: (v or '').upper() for k, v in rows[0].items()}
    return [{header[k]: v for k, v in r.items() if k in header} for r in rows[1:]]


def read_csv(path):
    import csv
    with open(path, newline='', encoding='latin-1') as f:
        return [{k.upper(): v for k, v in r.items()} for r in csv.DictReader(f)]


ABBR = {'street': 'st', 'avenue': 'ave', 'boulevard': 'blvd', 'drive': 'dr', 'road': 'rd',
        'court': 'ct', 'place': 'pl', 'lane': 'ln', 'parkway': 'pkwy', 'circle': 'cir',
        'north': 'n', 'south': 's', 'east': 'e', 'west': 'w', 'highway': 'hwy', 'terrace': 'ter'}
STOP = {'apartments', 'apartment', 'apts', 'apt', 'the', 'at', 'of', 'homes', 'lp', 'llc', 'and'}
ROMAN = {'i': '1', 'ii': '2', 'iii': '3', 'iv': '4', 'v': '5', 'vi': '6', 'vii': '7',
         'viii': '8', 'ix': '9', 'x': '10', 'one': '1', 'two': '2', 'three': '3'}


def words(s):
    return re.sub(r'[^a-z0-9 ]', ' ', str(s or '').lower()).split()


def norm_addr(s):
    return ' '.join(ABBR.get(w, w) for w in words(s))


def norm_name(s):
    return ' '.join(w for w in words(s) if w not in STOP)


def house_number(s):
    m = re.match(r'\s*(\d+)', str(s or ''))
    return m.group(1) if m else None


def phases(s):
    w = words(s)
    out = set()
    for k, t in enumerate(w):
        if t in ROMAN and (t not in ('v', 'x') or k == len(w) - 1):
            out.add(ROMAN[t])
        elif re.fullmatch(r'\d[a-z]?', t):
            out.add(t)
        elif k > 0 and w[k - 1] in ('phase', 'building', 'bldg', 'ph'):
            out.add(ROMAN.get(t, t))
    return out


def to_int(v):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return None


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def ratio(a, b):
    return difflib.SequenceMatcher(None, a, b).ratio()


def candidate(p, coords, h):
    """Score one CHFA/HUD pair, or None when it fails a hard rule."""
    award = to_int(p.get('AwardYear') or p.get('YR_ALLOC'))
    h_alloc, h_pis = to_int(h.get('YR_ALLOC')), to_int(h.get('YR_PIS'))
    if award is None:
        return None
    if h_alloc and h_alloc != 8888:
        ydiff = abs(award - h_alloc)
        if ydiff > 2:
            return None
    elif h_pis and h_pis != 8888:
        ydiff = None
        if not -1 <= h_pis - award <= 5:
            return None
    else:
        return None

    u, hu = to_int(p.get('N_UNITS')), to_int(h.get('N_UNITS'))
    if not (u and hu and abs(u - hu) <= max(2, 0.1 * max(u, hu))):
        return None
    pa, pb = phases(p.get('PROJECT')), phases(h.get('PROJECT'))
    if pa and pb and pa != pb:
        return None

    nr = ratio(norm_name(p.get('PROJECT')), norm_name(h.get('PROJECT')))
    ar = ratio(norm_addr(p.get('PROJ_ADD')), norm_addr(h.get('PROJ_ADD')))
    hn = house_number(p.get('PROJ_ADD'))
    same_number = bool(hn) and hn == house_number(h.get('PROJ_ADD'))
    same_city = norm_addr(p.get('PROJ_CTY')) == norm_addr(h.get('PROJ_CTY'))
    lat, lon = to_float(h.get('LATITUDE')), to_float(h.get('LONGITUDE'))
    km = None
    if lat is not None and lon is not None and coords:
        km = math.hypot((coords[1] - lat) * 111, (coords[0] - lon) * 85)

    evidence = []
    if nr >= 0.8:
        evidence.append('name')
    if same_number and ar >= 0.75:
        evidence.append('address')
    if km is not None and km < 0.25:
        evidence.append('location')
    ok = (('name' in evidence and (same_city or 'location' in evidence or 'address' in evidence))
          or ('address' in evidence and same_city and nr >= 0.4)
          or ('location' in evidence and nr >= 0.5)
          # Renamed properties: same street address, city and unit count, a year apart.
          or ('address' in evidence and same_city and ar >= 0.85 and u == hu
              and ydiff is not None and ydiff <= 1))
    if not ok:
        return None
    score = (nr * 3 + ar * 2 + (1 if same_city else 0) + (1.5 if 'location' in evidence else 0)
             + (1 if ydiff == 0 else 0) + (1 if u == hu else 0))
    return score, evidence


def match(chfa, hud, margin=0.75):
    pairs, reverse = {}, {}
    for i, f in enumerate(chfa):
        p, coords = f['properties'], (f.get('geometry') or {}).get('coordinates')
        for j, h in enumerate(hud):
            c = candidate(p, coords, h)
            if c:
                pairs.setdefault(i, []).append((c[0], j, c[1]))
                reverse.setdefault(j, []).append((c[0], i))
    out = {}
    for i, cands in pairs.items():
        cands.sort(key=lambda t: -t[0])
        score, j, evidence = cands[0]
        if len(cands) > 1 and cands[1][0] > score - margin:
            continue
        rev = sorted(reverse[j], key=lambda t: -t[0])
        if rev[0][1] != i or (len(rev) > 1 and rev[1][0] > rev[0][0] - margin):
            continue
        out[i] = (j, evidence)
    return out


def code(v):
    n = to_int(v)
    return None if n is None else n


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('lihtcpub', help='LIHTCPUB.xlsx or LIHTCPUB.csv from lihtcpub.zip')
    ap.add_argument('--downloaded', default=date.today().isoformat(),
                    help='date the zip was downloaded (YYYY-MM-DD)')
    args = ap.parse_args()

    src = Path(args.lihtcpub)
    rows = read_csv(src) if src.suffix.lower() == '.csv' else read_xlsx(src)
    hud = [r for r in rows if (r.get('PROJ_ST') or '').strip() == 'CO']
    chfa = json.loads(CHFA_FILE.read_text())['features']
    missing_id = sum(1 for f in chfa if f['properties'].get('CHFA_RecordID') is None)
    if missing_id:
        sys.exit(f'{missing_id} CHFA records have no CHFA_RecordID; '
                 'rerun node scripts/fetch-chfa-lihtc.js first')

    pis_years = [y for y in (to_int(h.get('YR_PIS')) for h in hud) if y and y != 8888]
    matched = match(chfa, hud)
    records = {}
    for i, (j, evidence) in sorted(matched.items()):
        p, h = chfa[i]['properties'], hud[j]
        dda = code(h.get('DDA'))
        qct = code(h.get('QCT'))
        records[str(p['CHFA_RecordID'])] = {
            'chfa_project': p.get('PROJECT'),
            'hud_id': h.get('HUD_ID'),
            'hud_project': h.get('PROJECT'),
            'yr_alloc': code(h.get('YR_ALLOC')),
            'yr_pis': code(h.get('YR_PIS')),
            'non_prof': code(h.get('NON_PROF')),
            'basis': code(h.get('BASIS')),
            # HUD codes normalised to 1 = in, 0 = not in; HUD blank stays null.
            'qct_pis': {1: 1, 2: 0}.get(qct),
            'dda_pis': None if dda is None else (1 if dda > 0 else 0),
            'dda_pis_kind': {1: 'metro', 2: 'non-metro', 3: 'metro GO Zone',
                             4: 'non-metro GO Zone'}.get(dda),
            'evidence': evidence,
        }

    out = {
        'source': dict(SOURCE,
                       downloaded=args.downloaded,
                       sha256=hashlib.sha256(src.read_bytes()).hexdigest(),
                       colorado_projects=len(hud),
                       placed_in_service_through=max(pis_years) if pis_years else None),
        'note': ('HUD bases QCT and DDA on the placed-in-service year; the basis boost turns '
                 'on the list in force at allocation (9%) or bond issuance (4%). qct_pis and '
                 'dda_pis are HUD\'s flags, not the governing designation.'),
        'chfa_records': len(chfa),
        'matched': len(records),
        'records': records,
    }
    OUT_FILE.write_text(json.dumps(out, indent=1, ensure_ascii=False) + '\n')
    print(f'{len(records)} of {len(chfa)} CHFA records matched to {len(hud)} HUD Colorado projects '
          f'-> {OUT_FILE.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
