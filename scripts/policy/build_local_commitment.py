#!/usr/bin/env python3
"""Build data/policy/local-commitment.json for the gated "Where to build" page.

The page's "Local commitment" group scores three things for each place:

1. A housing needs assessment (HNA). Two inputs:
   - DOLA's "SB24-174 Approved Housing Needs Assessments and Housing Action
     Plans" sheet, linked from https://dlg.colorado.gov/housing-plans (saved
     copy: data/policy/local-commitment/dola-approved-hna-2026-10-22.csv).
     The sheet's own label ("Local HNA" / "Regional HNA") is kept.
   - Our own reading of town and county websites for the top-ranked places
     (data/policy/local-commitment/research.jsonl, one row per place, each with
     the document's title, date and link).

2. A written affordable-housing goal in an adopted plan (comprehensive plan,
   housing plan or strategic plan), quoted with its link (research.jsonl).

3. The housing authority that serves the place:
   - HUD-assisted homes it runs, from HUD's Picture of Subsidized Households,
     PHA file, quarter ending 31 Dec 2025 (data/policy/local-commitment/
     hud-psh-pha-co-2025.csv; https://www.huduser.gov/portal/datasets/assthsg.html).
   - 2022–2026 CHFA tax-credit awards where the authority was sponsor,
     developer, owner, partner or bond issuer, read from the party lists in
     data/deals/*.json.
   Which places an authority serves is set by hand in AUTHORITIES below:
   a city authority serves its city, a county authority its county and every
   place in it.

Usage:
  python3 scripts/policy/build_local_commitment.py           # rewrite the file
  python3 scripts/policy/build_local_commitment.py --check   # fail if out of date
"""
import argparse
import csv
import glob
import json
import os
import re
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC_DIR = os.path.join(ROOT, 'data', 'policy', 'local-commitment')
OUT = os.path.join(ROOT, 'data', 'policy', 'local-commitment.json')

DOLA_PAGE = 'https://dlg.colorado.gov/housing-plans'
DOLA_SHEET = 'https://docs.google.com/spreadsheets/d/1ea3SU0IQSw6CYARg-YblGj9Iy2y8LUefT-NCCoWtzR4'
DOLA_COPY = '2026-10-22'
HUD_URL = 'https://www.huduser.gov/portal/datasets/assthsg.html'
HUD_AS_OF = '2025-12-31'

# DOLA sheet rows → the jurisdictions each one is for. A regional HNA covers
# whole counties; a local one covers the town or county named.
DOLA_ROWS = {
    'Archuleta County & Town of Pagosa Springs': {'counties': ['08007']},
    'Denver Regional Council of Governments': {'counties': ['08001', '08005', '08013', '08014', '08019', '08031', '08035', '08047', '08059']},
    'Town of Bennett': {'places': ['0806090']},
    'City of Montrose': {'places': ['0851745']},
    'Town of Berthoud': {'places': ['0806255']},
    'East Central Council of Local Governments': {'counties': ['08017', '08039', '08063', '08073']},
    'Town of Eaton': {'places': ['0822860']},
    'Eagle County Regional': {'counties': ['08037']},
    'Weld County': {'counties': ['08123']},
    'Commerce City': {'places': ['0816495']},
    'Town of Wellington': {'places': ['0883230']},
    'Town of Kersey': {'places': ['0840515']},
    'Town of Severance': {'places': ['0869150']},
    'City of Fruita': {'places': ['0828745']},
    'Town of Meeker': {'places': ['0849875']},
    'Town of Milliken': {'places': ['0850480']},
    'City of Golden': {'places': ['0830835']},
    'City of Colorado Springs': {'places': ['0816000']},
    'El Paso County': {'counties': ['08041']},
    'Town of Ridgway & Ouray County': {'places': ['0864200'], 'counties': ['08091']},
    'Gunnison Valley Regional': {'counties': ['08051']},
    'San Miguel County Regional': {'counties': ['08113']},
    'Town of Silt': {'places': ['0870195']},
    'Larimer County Regional': {'counties': ['08069']},
}

# Housing authorities: HUD PHA code (or None when HUD lists none), the name
# CHFA party lists use (regex), and the places or counties it serves. The
# first geoid listed is the one whose population sets "per 1,000 residents".
AUTHORITIES = [
    ('CO001', 'Denver Housing Authority', r'denver housing authority|housing authority of the city and county of denver', ['0820000', '08031']),
    ('CO028', 'Colorado Springs Housing Authority', r'colorado springs housing authority|housing authority of the city of colorado springs', ['0816000']),
    ('CO002', 'Housing Authority of the City of Pueblo', r'housing authority of the city of pueblo|pueblo housing authority', ['0862000']),
    ('CO072', 'Foothills Regional Housing (Jefferson County)', r'foothills regional housing|jefferson county housing authority', ['08059']),
    ('CO052', 'Aurora Housing Authority', r'aurora housing authority|housing authority of the city of aurora', ['0804000']),
    ('CO041', 'Housing Catalyst (Fort Collins)', r'housing catalyst', ['0827425']),
    ('CO058', 'Maiker Housing Partners (Adams County)', r'maiker|adams county housing authority|housing authority of the county of adams', ['08001']),
    ('CO049', 'Metro West Housing Solutions (Lakewood)', r'metro west housing|lakewood housing authority|housing authority of the city of lakewood', ['0843000']),
    ('CO016', 'Boulder Housing Partners', r'boulder housing partners|housing authority of the city of boulder', ['0807850']),
    ('CO051', 'Grand Junction Housing Authority', r'grand junction housing authority', ['0831660']),
    ('CO061', 'Boulder County Housing Authority', r'boulder county housing authority', ['08013']),
    ('CO035', 'Greeley-Weld Housing Authority', r'greeley-weld|housing authority of the city of greeley', ['0832155']),
    ('CO034', 'Loveland Housing Authority', r'loveland housing authority|housing authority of the city of loveland', ['0846465']),
    ('CO036', 'South Metro Housing Options (Littleton)', r'south metro housing options|littleton housing authority', ['0845255']),
    ('CO050', 'Arvada Housing Authority', r'arvada housing authority', ['0803455']),
    ('CO048', 'Englewood Housing Authority', r'englewood housing authority', ['0824785']),
    ('CO070', 'Longmont Housing Authority', r'longmont housing authority', ['0845970']),
    ('CO095', 'Garfield County Housing Authority', r'garfield county housing authority', ['08045']),
    ('CO090', 'Housing Authority of Weld County', r'weld county housing authority|housing authority of weld county', ['08123']),
    ('CO040', 'Delta Housing Authority', r'delta housing authority', ['0819850']),
    ('CO079', 'Montezuma County Housing Authority', r'montezuma county housing authority|housing authority of the county of montezuma', ['08083']),
    ('CO071', 'Fountain Housing Authority', r'housing authority of the city of fountain|fountain housing authority', ['0827865']),
    ('CO005', 'Trinidad Housing Authority', r'trinidad housing authority', ['0878610']),
    ('CO019', 'Brighton Housing Authority', r'brighton housing authority|housing authority of the city of brighton', ['0808675']),
    ('CO087', 'Montrose County Housing Authority', r'montrose county housing authority', ['08085']),
    ('CO004', 'Alamosa Housing Authority', r'housing authority of the city of alamosa|alamosa housing authority', ['0801090']),
    ('CO031', 'La Junta Housing Authority', r'la junta housing authority', ['0842110']),
    ('CO057', 'Sheridan Housing Authority', r'sheridan housing authority', ['0869645']),
    ('CO006', 'Lamar Housing Authority', r'housing authority of the city of lamar|lamar housing authority', ['0843110']),
    ('CO024', 'Las Animas Housing Authority', r'las animas housing authority', ['0843660']),
    ('CO003', 'Walsenburg Housing Authority', r'housing authority of the city of walsenburg|walsenburg housing authority', ['0882350']),
    ('CO025', 'Sterling Housing Authority', r'sterling housing authority|housing authority of the city of sterling', ['0873935']),
    ('CO103', 'Larimer County Housing Authority', r'larimer county housing authority', ['08069']),
    ('CO011', 'Fort Morgan Housing Authority', r'fort morgan housing authority', ['0827810']),
    ('CO043', 'Center Housing Authority', r'center housing authority', ['0812855']),
    ('CO037', 'Costilla County Housing Authority', r'costilla county housing authority', ['08023']),
    ('CO045', 'Rocky Ford Housing Authority', r'rocky ford housing authority', ['0865190']),
    ('CO021', 'Julesburg Housing Authority', r'julesburg housing authority', ['0839965']),
    ('CO009', 'Yuma Housing Authority', r'housing authority of the town of yuma|yuma housing authority', ['0886750']),
    ('CO013', 'Salida Housing Authority', r'housing authority of the city of salida|salida housing authority', ['0867280']),
    ('CO029', 'Fort Lupton Housing Authority', r'fort lupton housing authority|housing authority of the city of fort lupton', ['0827700']),
    ('CO101', 'Otero County Housing Authority', r'otero county housing authority', ['08089']),
    ('CO022', 'Wray Housing Authority', r'housing authority of the city of wray|wray housing authority', ['0886310']),
    ('CO012', 'Limon Housing Authority', r'housing authority of the town of limon|limon housing authority', ['0844980']),
    ('CO030', 'Burlington Housing Authority', r'burlington housing authority', ['0810600']),
    ('CO023', 'Holyoke Housing Authority', r'holyoke housing authority', ['0837270']),
    ('CO044', 'Brush Housing Authority', r'brush housing authority|housing authority of the city of brush', ['0809555']),
    ('CO008', 'Antonito Housing Authority', r'housing authority of antonito|antonito housing authority', ['0802355']),
    ('CO026', 'Cheyenne Wells Housing Authority', r'cheyenne wells', ['0814175']),
    ('CO017', 'Haxtun Housing Authority', r'haxtun housing authority|housing authority of the town of haxtun', ['0834960']),
    ('CO018', 'Kersey Housing Authority', r'kersey housing authority|housing authority of the town of kersey', ['0840515']),
    ('CO020', 'Keenesburg Housing Authority', r'keenesburg housing authority|housing authority of the town of keenesburg', ['0840185']),
    ('CO015', 'Aguilar Housing Authority', r'aguilar housing authority|housing authority of the town of aguilar', ['0800760']),
    ('CO007', 'Holly Housing Authority', r'holly housing authority|housing authority of the town of holly', ['0837215']),
    # Authorities with no HUD-assisted homes on HUD's list, found as parties to CHFA awards.
    (None, 'Douglas County Housing Partnership', r'douglas county housing partnership', ['08035', '0812415', '0857630', '0845955']),
    (None, 'Aspen/Pitkin County Housing Authority', r'aspen/pitkin county housing authority|apcha', ['08097', '0803620']),
    (None, 'Archuleta County Housing Authority', r'archuleta county housing authority', ['08007']),
    (None, 'Broomfield Housing Alliance', r'broomfield housing alliance', ['0809280', '08014']),
    (None, 'Commerce City Housing Authority', r'commerce city housing authority', ['0816495']),
    (None, 'Fraser Housing Authority', r'fraser housing authority', ['0828305']),
    (None, 'Frisco Community Housing Development Authority', r'frisco community housing', ['0828690']),
    (None, 'Summit Combined Housing Authority', r'summit combined housing authority', ['08117']),
    (None, 'Saguache County Housing Authority', r'saguache county housing authority', ['08109']),
    (None, 'Windsor Housing Authority', r'windsor housing authority', ['0885485']),
    (None, 'El Paso County Housing Authority', r'el paso county housing authority', ['08041']),
    (None, 'Arapahoe County Housing Authority', r'arapahoe county housing authority', ['08005']),
]

# A party counts when it had a hand in the deal itself; a voucher contract,
# a waitlist, management alone, or a plan the record says fell through does not.
ROLE_COUNTS = re.compile(r'sponsor|developer|owner|partner|issuer|applicant|land', re.I)
ROLE_SKIP = re.compile(r'^(voucher provider|voucher providers|property manager|waitlist partner|other funders|funders thanked|other local partners|other project team)', re.I)
NAME_SKIP = re.compile(r'not confirmed|dissolved|expressed intent', re.I)


def _date(s):
    return datetime.strptime(s.strip(), '%B %d, %Y').strftime('%Y-%m-%d')


def read_dola():
    rows = []
    with open(os.path.join(SRC_DIR, 'dola-approved-hna-2026-10-22.csv'), encoding='utf-8') as f:
        lines = list(csv.reader(f))
    head = next(i for i, r in enumerate(lines) if r and r[0] == 'Jurisdiction')
    for r in lines[head + 1:]:
        if not r or not r[0].strip():
            continue
        name = r[0].strip()
        if name not in DOLA_ROWS:
            sys.exit('DOLA row not mapped to geoids: %s (add it to DOLA_ROWS)' % name)
        rows.append({
            'jurisdiction': name,
            'approved': _date(r[1]),
            'kind': 'regional' if r[2].strip().lower().startswith('regional') else 'local',
            'title': r[3].strip().split('\n')[0].replace('.pdf', ''),
            'url': r[4].strip() or DOLA_PAGE,
            'places': DOLA_ROWS[name].get('places', []),
            'counties': DOLA_ROWS[name].get('counties', []),
        })
    return rows


def read_research():
    out = []
    with open(os.path.join(SRC_DIR, 'research.jsonl'), encoding='utf-8') as f:
        for line in f:
            if line.strip():
                out.append(json.loads(line))
    return out


def read_hud():
    by_code = {}
    with open(os.path.join(SRC_DIR, 'hud-psh-pha-co-2025.csv'), encoding='utf-8') as f:
        for r in csv.DictReader(f):
            def n(k):
                v = (r.get(k) or '').strip()
                return int(float(v)) if v else 0
            by_code[r['code']] = {'name': r['name'], 'vouchers': n('Housing Choice Vouchers'),
                                  'public_housing': n('Public Housing'), 'mod_rehab': n('Mod Rehab'),
                                  'total': n('Summary of All HUD Programs')}
    return by_code


def deal_year(award):
    m = re.search(r'(20\d\d)', award or '')
    return int(m.group(1)) if m else None


def read_deals():
    deals = []
    for path in sorted(glob.glob(os.path.join(ROOT, 'data', 'deals', '*.json'))):
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
        deals.append(d)
    return deals


def build():
    hud = read_hud()
    deals = read_deals()
    authorities = []
    for code, name, pattern, serves in AUTHORITIES:
        rx = re.compile(pattern, re.I)
        hit = {}
        for d in deals:
            year = deal_year(d.get('award'))
            if not year or year < 2022 or year > 2026:
                continue
            for p in d.get('parties', []):
                pname, role = p.get('name', ''), p.get('role', '')
                if not rx.search(pname) or NAME_SKIP.search(pname) or NAME_SKIP.search(role):
                    continue
                if ROLE_SKIP.search(role) or not ROLE_COUNTS.search(role):
                    continue
                if d['slug'] not in hit:
                    hit[d['slug']] = {'slug': d['slug'], 'name': d['name'], 'year': year, 'role': role}
        h = hud.get(code) if code else None
        authorities.append({
            'id': code or re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-'),
            'name': name,
            'serves': serves,
            'hud': {'total': h['total'], 'vouchers': h['vouchers'], 'public_housing': h['public_housing']} if h else None,
            'deals': sorted(hit.values(), key=lambda x: (-x['year'], x['slug'])),
        })

    hna = {}
    for row in read_dola():
        for g in row['places'] + row['counties']:
            hna.setdefault(g, []).append({'kind': row['kind'], 'date': row['approved'], 'dola_approved': row['approved'],
                                          'title': row['title'], 'url': row['url'], 'source': 'dola'})

    goals = {}
    for r in read_research():
        ids = [r['geoid']] + ([r['also']] if r.get('also') else [])
        h = r.get('hna') or {}
        st = h.get('status')
        kind = {'local': 'local', 'county': 'regional', 'regional': 'regional', 'in_progress': 'in_progress', 'old': 'old'}.get(st)
        if kind:
            date = h.get('date') or None
            if not date:
                m = re.search(r'\b(20\d\d)\b', h.get('title') or '')
                date = m.group(1) if m else None
            for g in ids:
                hna.setdefault(g, []).append({'kind': kind, 'date': date, 'title': h.get('title'), 'url': h.get('url'),
                                              'source': 'research', 'checked': r.get('checked')})
        gl = r.get('goal') or {}
        gst = gl.get('status')
        # A goal seen only in news coverage is left unread until the official document confirms it.
        if gst in ('specific', 'general', 'need_only', 'none') and not re.search(r'news-reported', gl.get('note') or ''):
            plan = gl.get('plan') or (r.get('plan') or {}).get('title')
            for g in ids:
                goals[g] = {'status': gst, 'quote': gl.get('quote'), 'plan': plan,
                            # With no plan link, the goal (or its absence) was read in the HNA itself.
                            'url': gl.get('url') or (r.get('plan') or {}).get('url') or h.get('url'),
                            'note': gl.get('note'), 'checked': r.get('checked')}

    return {
        'generated_by': 'scripts/policy/build_local_commitment.py',
        'sources': {
            'dola': {'label': 'DOLA SB24-174 approved housing needs assessments (copy of %s)' % DOLA_COPY, 'url': DOLA_PAGE, 'sheet': DOLA_SHEET, 'as_of': DOLA_COPY},
            'research': {'label': 'Town and county documents read for the top-ranked places (research.jsonl)', 'url': 'data/policy/local-commitment/research.jsonl', 'as_of': '2026-10-22'},
            'hud': {'label': 'HUD Picture of Subsidized Households, PHA file', 'url': HUD_URL, 'as_of': HUD_AS_OF},
            'deals': {'label': 'CHFA tax-credit award summaries, 2022–2026 (party lists)', 'url': 'data/deals/', 'count': len(deals)},
        },
        'hna': {k: hna[k] for k in sorted(hna)},
        'goals': {k: goals[k] for k in sorted(goals)},
        'authorities': authorities,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    args = ap.parse_args()
    data = build()
    text = json.dumps(data, indent=2, ensure_ascii=False) + '\n'
    if args.check:
        with open(OUT, encoding='utf-8') as f:
            if f.read() != text:
                sys.exit('data/policy/local-commitment.json is out of date: run python3 scripts/policy/build_local_commitment.py')
        print('local-commitment.json is current')
        return
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(text)
    print('wrote %s: %d HNA places, %d goals, %d authorities (%d with tax-credit deals)' % (
        os.path.relpath(OUT, ROOT), len(data['hna']), len(data['goals']), len(data['authorities']),
        sum(1 for a in data['authorities'] if a['deals'])))


if __name__ == '__main__':
    main()
