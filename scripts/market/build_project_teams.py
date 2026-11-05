#!/usr/bin/env python3
"""
scripts/market/build_project_teams.py: which architects and general
contractors work on Colorado tax-credit applications, and how often those
applications win.

Source: CHFA's published application narratives, one PDF per round
(chfa-2027 QAP rounds use the same format). Each narrative is the applicant's
own description of the project, and most name the architect and the general
contractor. Outcomes come from the CHFA applicant reports already on the site
(data/jurisdiction-briefs/_lihtc-applications.json).

Rounds counted ("decided" applications): 9% Round One 2023-2026, and Round
Two (4% with state credit) 2023-2025. Round Two 2026 and rolling 4% are left
out because they are not decided or not competitive.

Success ratio = funded applications / decided applications. A project that
applied in two rounds counts twice, once per application. A firm needs at
least MIN_TO_RANK decided applications to be ranked; below that the count is
shown without a rank.

A firm is credited only where the narrative names it in that role. Names are
matched from a fixed list (FIRMS), and EXCLUDE drops mentions that are not the
project team (a design study, a bid that was not chosen, a design principle
that shares a firm's name). Narratives that name no firm are counted as
"team not named", never guessed.

Output (gated, for the developer site):
  --out  coho-backend gated/data/jurisdiction-briefs/_project-teams.json

  python3 scripts/market/build_project_teams.py --cache /tmp/chfa \
      --out ../coho-backend/gated/data/jurisdiction-briefs/_project-teams.json
"""
from __future__ import annotations

import argparse
import datetime as dt
import difflib
import importlib.util
import json
import os
import re
import subprocess
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
APPS = os.path.join(ROOT, 'data', 'jurisdiction-briefs', '_lihtc-applications.json')
MIN_TO_RANK = 3

# (year, round, label, url). TOC narratives are the same round's TOC-credit applicants.
NARRATIVES = [
    (2023, 1, '2023 Round One narratives', 'https://www.chfainfo.com/getattachment/67ec6beb-18c8-41c7-bed2-3b254157df9a/2023-Round-One-Narratives.pdf'),
    (2023, 2, '2023 Round Two narratives', 'https://www.chfainfo.com/getattachment/ef24fa13-be3f-4332-ada0-c9a682aab30f/2023-Round-Two-Narratives.pdf'),
    (2024, 1, '2024 Round One narratives', 'https://www.chfainfo.com/getattachment/673cbb77-3144-4af9-9134-cbbd48bf3e43/2024-Round-One-Narratives.pdf'),
    (2024, 2, '2024 Round Two narratives', 'https://www.chfainfo.com/getattachment/432406db-046f-4911-ae25-3a07d87cb95f/2024-Round-Two-Narratives.pdf'),
    (2025, 1, '2025 Round One narratives', 'https://www.chfainfo.com/getattachment/e041164b-26b5-4192-90db-d54d181ead00/2025-HTC-Round-One-Narratives.pdf'),
    (2025, 1, '2025 Round One TOC narratives', 'https://www.chfainfo.com/getattachment/7c175cb8-9560-4d08-8e5d-9672e656aa6c/2025-TOC-Round-One-Narratives.pdf'),
    (2025, 2, '2025 Round Two narratives', 'https://www.chfainfo.com/getattachment/7441af58-7dec-46d2-abab-1b5ac8f19575/2025-HTC-Round-Two-Application-Narratives.pdf'),
    (2025, 2, '2025 Round Two TOC narratives', 'https://www.chfainfo.com/getattachment/6935f661-2e97-4732-b427-de84231f2063/2025-TOC-Round-Two-Narratives.pdf'),
    (2026, 1, '2026 Round One narratives', 'https://www.chfainfo.com/getattachment/ef9795e3-70e4-4b42-9067-65d1f931fe40/2026-HTC-Round-One-Narratives.pdf'),
]
QAP = {
    'label': 'CHFA 2027-2028 Qualified Allocation Plan',
    'url': 'https://www.chfainfo.com/getattachment/0978a6c3-ed9b-4058-8a35-becc27dd9d8d/2027-2028-QAP.pdf',
    'quote': 'CHFA prefers, but does not require that Applicants, including those from out of state, use architects and general contractors located in Colorado whenever feasible.',
}

# Display name -> pattern. Patterns in CASE_SENSITIVE are short initials and match case.
ARCHITECTS = {
    'Shopworks Architecture': r'shop ?works', 'ALM2S': r'alm2s', 'Coburn': r'coburn', 'RATIO': r'\bRATIO\b',
    'Van Meter Williams Pollack': r'van meter|\bVMWP\b', 'Davis Partnership Architects': r'davis partnership',
    'Way Architects': r'\bway architects', 'Bryant Flink Architecture + Design': r'bryant flink|\bBFAD\b',
    'Flow Design Collaborative': r'flow design', 'Kephart': r'kephart', 'KTGY': r'\bKTGY\b',
    'Shears Adkins Rockmore': r'shears adkins|\bSAR\+|\(SAR\)', 'HHL Architects': r'\bHHL\b',
    'Radix Design': r'radix design', 'M+A Design': r'M\s?[&+]\s?A Design', 'Carvell Architects': r'carvell',
    'Cuningham': r'cuningham', 'Workshop8': r'workshop ?8', 'Santulan Architecture': r'santulan',
    'RS&H (formerly HB&A)': r'HB&A|RS&H', 'Holst Architecture': r'holst', 'Allen-Guerra Architects': r'allen[- ]guerra',
    'Studio 646 Architecture': r'studio 646', 'Cushing Terrell': r'cushing terrell', 'John Ronan Architects': r'john ronan',
    'EJ Architecture': r'\bEJ Architecture', 'Gorman Architectural': r'gorman architect', 'Studio Completiva': r'completiva',
    'Galloway & Company': r'galloway', 'STUDIO Architecture': r'\bSTUDIO Architecture', 'Rosemann & Associates': r'rosemann',
    'Todd & Associates': r'todd (&|and) associates', 'Godden Sudik': r'godden', 'Wallace Architects': r'wallace architects',
    'KCG Design Services': r'\bKCG\b', 'Jones Gillam Renz Architects': r'jones gillam', 'OZ Architecture': r'\bOZ Architecture',
    'Meridian 105 Architecture': r'meridian 105', "Lorcan O'Herlihy Architects": r'o.herlihy', 'JLA Architects': r'\bJLA\b',
    'Caddis Collaborative': r'caddis', 'CSHQA': r'CSHQA', 'Sopher Sparn Architects': r'sopher sparn', 'HGF Architects': r'\bHGF\b',
    'Hooker DeJong': r'hooker de ?jong', 'Prime Design': r'prime design', 'TDG Architecture': r'TDG ?architecture',
    'Jeffrey A. Williams Architects': r'jeffrey a\.? williams', 'Studio PBA': r'studio pba',
}
CONTRACTORS = {
    'BC Builders': r'\bB\.?\s?C\.? Build', 'Deneuve Construction Services': r'deneuve|denueve',
    'Alliance Construction Solutions': r'alliance construction', 'Palace Construction': r'palace construction',
    'FCI Constructors': r'\bFCI\b', 'I-Kota': r'i[- ]?kota', 'Taylor Kohrs': r'taylor kohrs', 'Milender White': r'milender',
    'Bryan Construction': r'bryan construction', 'Pinkard Construction': r'pinkard',
    'RealAmerica Construction': r'realamerica construction', 'Calcon Constructors': r'calcon',
    'Brinkmann Constructors': r'brinkmann\b', 'Brinkman Construction': r'brinkman\b', 'Acorn Construction': r'acorn construction', 'Alcon': r'\bAlcon\b',
    'Krische Construction (KCI)': r'[Kk]rische|KRISCHE|\bKCI\b', 'TWG Construction': r'TWG Construction',
    'Shaw Construction': r'shaw (construction|builders)', 'Pavilion Construction': r'pavilion construction',
    'Gilmore Construction': r'gilmore construction', 'Haselden Construction': r'haselden',
    'CSI Construction Company': r'CSI Construction', 'JHL Constructors': r'\bJHL\b',
    'Streamline General Contractors': r'streamline general', 'W.D. Construction': r'W\.?\s?D\.? Construction',
    'White Construction Group': r'white construction', 'Belmont Construction Company': r'belmont construction',
    'ARCO National Construction': r'\bARCO\b', 'FTK Construction Services': r'\bFTK\b', 'RA Nelson': r'RA Nelson|R\.A\. Nelson',
    'Hyder Construction': r'hyder', 'Neenan Archistruction': r'neenan', 'GH Phipps': r'phipps',
    'Saunders Construction': r'saunders construction', 'Mortenson': r'mortenson', 'Elder Construction': r'elder construction',
    'CSDI Construction': r'CSDI', 'Dohn Construction': r'dohn construction', 'HE Whitlock Construction': r'whitlock',
    'CFC Construction': r'CFC Construction',
}
CASE_SENSITIVE = {r'\bRATIO\b', r'\bSTUDIO Architecture', r'\bARCO\b', r'\bAlcon\b', r'\bEJ Architecture', r'\bOZ Architecture',
                  r'CSHQA', r'CSDI', r'\bHGF\b', r'[Kk]rische|KRISCHE|\bKCI\b', r'\bFCI\b', r'\bJHL\b', r'\bFTK\b', r'\bKCG\b',
                  r'\bJLA\b', r'\bHHL\b', r'CFC Construction', r'TWG Construction', r'CSI Construction', r'\bKTGY\b'}

# (start of project name, firm, rounds): the narrative names the firm, but not as this
# project's team. rounds is a set of (year, round), or None for every round the project applied.
EXCLUDE = [
    ('Park Avenue', 'Shopworks Architecture', None), ('Park Avenue', 'Davis Partnership Architects', None),  # a design study
    ('Link and Pin', 'Shopworks Architecture', None), ('Rendezvous', 'Shopworks Architecture', None),        # design training or a workshop
    ('StarRise', 'Shopworks Architecture', None), ('Switchgrass', 'Shopworks Architecture', None),
    ('Metro Center', 'Alliance Construction Solutions', {(2023, 2)}), ('Metro Center', 'Deneuve Construction Services', {(2023, 2)}),  # bids
    ('Canyons', 'Deneuve Construction Services', {(2024, 1)}), ('Canyons', 'Palace Construction', {(2024, 1)}),  # bids; Alliance was picked
    ('1001 Lincoln', 'Brinkmann Constructors', None),  # a second price; I-Kota is the named contractor
    ('Willoughby', 'Galloway & Company', None),  # a person's name
    ('Castleton', 'TWG Construction', None), ('123 Manitou', 'TWG Construction', None),  # the developer's usual builder; another firm estimated
    ('Evans Terrace', 'Santulan Architecture', None),  # designed a comparable property
]


# Narrative name -> applicant-report name, where the two differ and the address agrees.
ALIASES = {'The Edge Apartments Phase III': 'Edge 3'}


def _private():
    """keep(name, city): False for projects the site owner asked to leave out (same rule as the local players builder)."""
    p = os.path.join(ROOT, 'scripts', 'market', 'build_local_players.py')
    spec = importlib.util.spec_from_file_location('build_local_players', p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    excl = m.excluded_hashes()
    return lambda name, city: (m.apps_mod.exclusion_hash(name or '', city or '') not in excl
                               and not m.is_private(name) and not m.is_private(city))


def fetch_text(url, cache):
    os.makedirs(cache, exist_ok=True)
    pdf = os.path.join(cache, re.sub(r'[^A-Za-z0-9.]+', '_', url.rsplit('/', 1)[-1]))
    if not os.path.exists(pdf):
        req = urllib.request.Request(url, headers={'User-Agent': 'COHO Analytics data build'})
        with urllib.request.urlopen(req, timeout=120) as r, open(pdf, 'wb') as f:
            f.write(r.read())
    return subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True, check=True).stdout


def split_applications(text):
    """(name, address, city, body) for each application in a narrative PDF."""
    out = []
    for p in re.split(r'\n\s*Project Name\s*:\s*', text)[1:]:
        body = re.sub(r'\s+', ' ', p)
        m = re.search(r'Project Address\s*:\s*(.*?)(?:Executive Summary|EXECUTIVE SUMMARY|$)', body[:600])
        addr = (m.group(1) if m else '').strip()
        cm = re.search(r',?\s*([A-Za-z .\'-]+?),?\s+(?:CO|Colorado)\b', addr)
        out.append((p.split('\n')[0].strip(), addr, cm.group(1).strip() if cm else '', body))
    return out


def find_firms(table, text):
    return [name for name, pat in table.items() if re.search(pat, text, 0 if pat in CASE_SENSITIVE else re.I)]


def norm(s):
    s = re.sub(r'\b(the|apartments?|lp|llc|phase|senior)\b', '', (s or '').lower())
    return re.sub(r'[^a-z0-9]', '', s)


def addr_key(a):
    m = re.match(r'\s*(\d+)\s+(?:(?:north|south|east|west|[NSEW])\.?\s+)?(\w+)', a or '', re.I)
    return (m.group(1), m.group(2).lower()[:4]) if m else None


def match(name, addr, pool):
    if name in ALIASES:
        return next((x for x in pool if x['name'] == ALIASES[name]), None)
    k = addr_key(addr)
    if k:
        same = [x for x in pool if addr_key(x.get('address')) == k]
        if len(same) == 1:
            return same[0]
    n, best, score = norm(name), None, 0.0
    for x in pool:
        m = norm(x['name'])
        s = difflib.SequenceMatcher(None, n, m).ratio()
        if m and (m in n or n in m):
            s = max(s, 0.95)
        if s > score:
            best, score = x, s
    return best if score >= 0.75 else None


def excluded(name, firm, year, rnd):
    return any(name.startswith(p) and firm == f and (r is None or (year, rnd) in r) for p, f, r in EXCLUDE)


def decided(x):
    return x['outcome'] in ('awarded', 'not_awarded') and (
        (x['round'] == 1 and x['credit_type'] == '9%') or (x['round'] == 2 and x['year'] <= 2025))


def build(cache):
    keep = _private()
    apps = json.load(open(APPS, encoding='utf-8'))['applications']
    rows, unmatched = {}, []
    for year, rnd, label, url in NARRATIVES:
        pool = [x for x in apps if x['year'] == year and x['round'] == rnd]
        for name, addr, city, body in split_applications(fetch_text(url, cache)):
            if not keep(name, city):
                continue
            a = match(name, addr, pool)
            if not a:
                unmatched.append(label)  # counted only; a name the reports do not carry is never printed
                continue
            if not keep(a['name'], a.get('city')):
                continue
            arch = [f for f in find_firms(ARCHITECTS, body) if not excluded(a['name'], f, year, rnd)]
            gc = [f for f in find_firms(CONTRACTORS, body) if not excluded(a['name'], f, year, rnd)]
            k = (year, rnd, a['name'])
            r = rows.setdefault(k, {'year': year, 'round': rnd, 'credit': a['credit_type'], 'name': a['name'],
                                    'city': a.get('city'), 'county_fips': a.get('county_fips'), 'sponsor': a.get('sponsor'),
                                    'outcome': a.get('outcome'), 'architect': [], 'general_contractor': [], 'sources': []})
            r['architect'] = sorted(set(r['architect']) | set(arch))
            r['general_contractor'] = sorted(set(r['general_contractor']) | set(gc))
            r['sources'].append({'label': label, 'url': url})
    rows = sorted(rows.values(), key=lambda r: (r['year'], r['round'], r['name']))
    dec = [r for r in rows if decided({**r, 'credit_type': r['credit']})]

    def firms(role):
        out = {}
        for r in dec:
            for f in r[role]:
                o = out.setdefault(f, {'name': f, 'decided': 0, 'funded': 0, 'counties': set(), 'applications': []})
                o['decided'] += 1
                o['funded'] += r['outcome'] == 'awarded'
                if r['county_fips']:
                    o['counties'].add(r['county_fips'])
                o['applications'].append({'name': r['name'], 'year': r['year'], 'round': r['round'], 'county_fips': r['county_fips'],
                                          'funded': r['outcome'] == 'awarded', 'source_url': r['sources'][0]['url']})
        lst = []
        for o in out.values():
            o['ratio'] = round(o['funded'] / o['decided'], 3)
            o['ranked'] = o['decided'] >= MIN_TO_RANK
            o['counties'] = sorted(o['counties'])
            lst.append(o)
        lst.sort(key=lambda o: (not o['ranked'], -o['ratio'] if o['ranked'] else 0, -o['decided'], o['name']))
        return lst

    return {
        'meta': {
            'built': dt.date.today().isoformat(),
            'what': 'Architects and general contractors named in CHFA tax-credit application narratives, with how many of their applications were funded.',
            'rounds': '9% Round One 2023-2026; Round Two (4% with state credit) 2023-2025',
            'ratio': 'funded applications / decided applications; a project that applied twice counts twice',
            'min_to_rank': MIN_TO_RANK,
            'decided_applications': len(dec),
            'funded_applications': sum(r['outcome'] == 'awarded' for r in dec),
            'with_architect_named': sum(bool(r['architect']) for r in dec),
            'with_contractor_named': sum(bool(r['general_contractor']) for r in dec),
            'unmatched_narratives': len(unmatched),
            'bonding': 'No public Colorado list shows which contractors can be bonded, and the QAP sets no bonding rule. '
                       'A contractor that built a funded tax-credit project met that deal\'s lender and investor requirements; '
                       'ask for a surety letter before relying on it.',
            'qap': QAP,
            'sources': [{'label': l, 'url': u} for _, _, l, u in NARRATIVES] + [
                {'label': 'CHFA tax-credit applicant reports (outcomes)', 'path': 'data/jurisdiction-briefs/_lihtc-applications.json'}],
        },
        'architects': firms('architect'),
        'general_contractors': firms('general_contractor'),
        'applications': rows,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--cache', required=True, help='folder for the downloaded narrative PDFs')
    ap.add_argument('--out', required=True, help='gated output file')
    a = ap.parse_args()
    doc = build(a.cache)
    with open(a.out, 'w', encoding='utf-8') as f:
        json.dump(doc, f, indent=1, ensure_ascii=False)
        f.write('\n')
    m = doc['meta']
    print(f"{m['decided_applications']} decided applications ({m['funded_applications']} funded); "
          f"architect named on {m['with_architect_named']}, contractor on {m['with_contractor_named']}; "
          f"{len(doc['architects'])} architects, {len(doc['general_contractors'])} contractors; {m['unmatched_narratives']} narratives not matched")


if __name__ == '__main__':
    main()
