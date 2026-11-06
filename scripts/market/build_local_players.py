#!/usr/bin/env python3
"""
scripts/market/build_local_players.py: who builds, who holds land and who
provides affordable housing and housing services in each Colorado county and
town, from public records only.

Three parts, each from sources a reader can open:

  Developers   Every sponsor or grantee on a state housing award or CHFA
               tax-credit application since 2016: the award ledger
               (data/policy/funding-awards/ledger.json), DOLA Division of
               Housing awards (dola-awards.json) and CHFA applicant reports
               (data/jurisdiction-briefs/_lihtc-applications.json), plus the
               count of CHFA tax-credit properties (data/chfa-lihtc.json).
  Land holders The Colorado Public Parcels composite (Governor's Office of
               Information Technology), which aggregates the parcel records of
               the counties that share them. Owners are grouped as printed on
               the county record. Acres come from each parcel's mapped area.
  Providers    HUD's Public Housing Authority list, HUD-approved housing
               counseling agencies, and the IRS Exempt Organizations Business
               Master File (housing and shelter charities, NTEE code L, without
               homeowner associations, plus homeless service centres, P85).

Two outputs:

  data/market/local-players.json (public, written here)
      The basic version: counts and shares by type. It names public bodies
      (housing authorities, governments that hold land) and nonprofits, and
      never names a for-profit developer, a private land owner or a person.

  <detail-dir>/<geoid>.json (gated, only with --detail-dir)
      The detailed version, for the gated developer site (coho-backend
      gated/data/jurisdiction-briefs/_local-players/). It names developers and
      organisations that hold land. People who own land are never named: they
      are counted as individuals, as are family trusts and estates.

Rules kept:
  - Nothing is invented: a county whose parcels are not in the state
    composite says so, and its land section is null, not zero.
  - Projects the site owner asked to leave out are dropped by hash (the
    applications exclusion list plus PRIVATE_PROJECT_HASHES below), and any
    name that matches scripts/lib/private-terms.mjs or the brand guard is
    dropped, so the files name no private party.
  - No contact person, email or phone is copied from any source.

Usage:
  python3 scripts/market/build_local_players.py --cache /tmp/lp-cache
  python3 scripts/market/build_local_players.py --cache /tmp/lp-cache \\
      --detail-dir ../coho-backend/gated/data/jurisdiction-briefs/_local-players
  python3 scripts/market/build_local_players.py --places 0851745,0805265 ...
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import importlib.util
import io
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'data', 'market', 'local-players.json')

PARCELS = 'https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/FeatureServer/0/query'
PARCELS_PAGE = 'https://gis.colorado.gov/public/rest/services/Address_and_Parcel/Colorado_Public_Parcels/FeatureServer/0'
PHA = 'https://services.arcgis.com/VTyQ9soqVukalItT/arcgis/rest/services/Public_Housing_Authorities/FeatureServer/0/query'
PHA_PAGE = 'https://hudgis-hud.opendata.arcgis.com/datasets/HUD::public-housing-authorities'
COUNSEL = 'https://data.hud.gov/Housing_Counselor/search?AgencyName=&City=&State=CO&RowLimit=&Services=&Languages='
COUNSEL_PAGE = 'https://apps.hud.gov/offices/hsg/sfh/hcc/hcs.cfm?webListAction=search&searchstate=CO'
IRS_BMF = 'https://www.irs.gov/pub/irs-soi/eo_co.csv'
IRS_PAGE = 'https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf'
PROPUBLICA = 'https://projects.propublica.org/nonprofits/organizations/'

SINCE = 2016          # first year the award ledger covers
# CHFA prints "Project did not proceed. Award returned by sponsor." on a returned award.
RETURNED = re.compile(r'did not proceed|award returned', re.I)
TOP_DEVELOPERS = 15
TOP_LAND = 15
TOP_NONPROFITS = 15

# Projects left out at the site owner's request, by sha256 of "<normalized
# name>|<normalized city>" (the rule build_lihtc_applications.exclusion_hash
# uses). Kept as hashes so this public file names none of them.
PRIVATE_PROJECT_HASHES = {
    'dc7174952d65d37f1b37adb9662f49a4d7375cce12a61823c2ef75fae23dc2f2',
    '155b0f4a3db9267de78ea13a8d8dc7985da9b85864b9938a377192b05f9a8c2a',
    '9836e743bc7cc0db24b74047e82befbb8843d57333851915564b336513273d91',
}

# Organisations tied to the site owner's private work, by sha256 of two consecutive
# words of their normalised name. Never named, in any file; counted by type only.
PRIVATE_BRAND_HASHES = {'2a32bcc092b902d763462f3b7aa1fd1566a83030954d549f7816ee636ee35240'}
PRIVATE_ORG_HASHES = {
    '7abfb06f9cddb3938734247ee94e3085f953ae5f44c9adead6fe7e321bee2fce',
}

NTEE_LABELS = {
    'L': 'Housing and shelter', 'L01': 'Housing alliance or advocacy', 'L02': 'Housing management',
    'L03': 'Housing research', 'L05': 'Housing research', 'L11': 'Housing single organization support',
    'L12': 'Housing fundraising', 'L19': 'Housing support', 'L20': 'Housing development, construction and management',
    'L21': 'Public housing', 'L22': 'Senior housing', 'L24': 'Independent housing for people with disabilities',
    'L25': 'Housing rehabilitation', 'L30': 'Housing search assistance', 'L40': 'Temporary housing',
    'L41': 'Homeless shelter', 'L80': 'Housing support services', 'L81': 'Home improvement and repairs',
    'L82': 'Housing expense reduction support', 'L99': 'Housing and shelter (other)',
    'P85': 'Homeless services centre',
}


# ---------------------------------------------------------------- helpers

def read_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def clean(s):
    return re.sub(r'\s+', ' ', str(s or '')).strip()


def load_module(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, rel))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def fetch(url, cache, name, data=None, timeout=180, tries=4):
    """GET (or POST data) a URL, keeping the body in the cache dir."""
    path = os.path.join(cache, name) if cache else None
    if path and os.path.exists(path):
        with open(path, 'rb') as f:
            return f.read()
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={'User-Agent': 'coho-analytics-local-players/1'})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = r.read()
            if path:
                os.makedirs(cache, exist_ok=True)
                with open(path, 'wb') as f:
                    f.write(body)
            return body
        except Exception as e:  # network: retry with backoff
            last = e
            time.sleep(2 ** (i + 1))
    raise RuntimeError(f'fetch failed for {url}: {last}')


# ---------------------------------------------------------------- privacy guards

PRIVATE_TERMS_FILE = os.path.join(ROOT, 'scripts', 'lib', 'private-terms.mjs')


def load_private_terms():
    """[first-word hash, whole-term hash] pairs from scripts/lib/private-terms.mjs."""
    with open(PRIVATE_TERMS_FILE, encoding='utf-8') as f:
        text = f.read()
    salt = re.search(r"const SALT = '([^']+)'", text).group(1)
    pairs = re.findall(r"\['([0-9a-f]{24})', '([0-9a-f]{24})', '[^']*'\]", text)
    first = defaultdict(set)
    for a, b in pairs:
        first[a].add(b)
    return salt, first


_SALT, _FIRST = load_private_terms()


def _h(phrase):
    return hashlib.sha256((_SALT + phrase).encode()).hexdigest()[:24]


def is_private(text):
    """True when the text names a private organisation or any private term (mirrors findPrivateTerms)."""
    ow = re.sub(r'[^a-z0-9 ]+', ' ', str(text or '').lower()).split()
    # The brand, written as one word or two, is held only as a hash.
    if any(hashlib.sha256(x.encode()).hexdigest() in PRIVATE_BRAND_HASHES for x in ow + [a + b for a, b in zip(ow, ow[1:])]):
        return True
    if any(hashlib.sha256(' '.join(ow[i:i + 2]).encode()).hexdigest() in PRIVATE_ORG_HASHES for i in range(len(ow) - 1)):
        return True
    import unicodedata
    w = [x for x in re.split(r'[^\w]+|_', unicodedata.normalize('NFKC', str(text or '')).lower()) if x]
    for i, word in enumerate(w):
        cands = _FIRST.get(_h(word))
        if not cands:
            continue
        for n in range(1, 4):
            if i + n <= len(w) and _h(' '.join(w[i:i + n])) in cands:
                return True
    return False


# ---------------------------------------------------------------- geography

def load_geography():
    rank = read_json(os.path.join(ROOT, 'data', 'hna', 'ranking-index.json'))['rankings']
    counties = {}
    places = {}
    for r in rank:
        if r.get('type') == 'county':
            counties[r['geoid']] = {'geoid': r['geoid'], 'name': r['name']}
        else:
            places[r['geoid']] = {'geoid': r['geoid'], 'name': r['name'], 'county': r.get('containingCounty'), 'type': r.get('type')}
    cb = read_json(os.path.join(ROOT, 'data', 'co-county-boundaries.json'))
    for f in cb['features']:
        g = f['properties']['GEOID']
        lats = []
        for ring in _rings(f['geometry']):
            lats += [p[1] for p in ring]
        if g in counties:
            counties[g]['short'] = f['properties']['NAME']
            counties[g]['lat'] = (min(lats) + max(lats)) / 2
    pb = read_json(os.path.join(ROOT, 'data', 'co-place-boundaries.geojson'))
    shapes = {f['properties']['geoid']: f['geometry'] for f in pb['features']}
    return counties, places, shapes


def _rings(geom):
    if geom['type'] == 'Polygon':
        return geom['coordinates']
    return [r for poly in geom['coordinates'] for r in poly]


def zip_to_county():
    rows = read_json(os.path.join(ROOT, 'data', 'market', 'hud_zip_tract_crosswalk_co.json'))['rows']
    best = {}
    for r in rows:
        z, c, w = r['zip'], r['tract'][:5], r.get('tot_ratio') or 0
        acc = best.setdefault(z, defaultdict(float))
        acc[c] += w
    return {z: max(v.items(), key=lambda kv: kv[1])[0] for z, v in best.items()}


def plain(name):
    return re.sub(r'\s*\((city|town|CDP|city and county)\)\s*$', '', name or '', flags=re.I).strip()


# ---------------------------------------------------------------- developers

apps_mod = load_module('build_lihtc_applications', 'scripts/funding/build_lihtc_applications.py')


def excluded_hashes():
    ex = read_json(os.path.join(ROOT, 'data', 'jurisdiction-briefs', '_lihtc-applications-excluded.json'))
    return {e['sha256'] for e in ex.get('excluded', [])} | PRIVATE_PROJECT_HASHES


ORG_NOISE = re.compile(r'\b(inc|incorporated|llc|lllp|llp|lp|ltd|corp|corporation|company|co|the|a colorado nonprofit corporation|nonprofit)\b')


def org_key(s):
    s = re.sub(r'\([^)]*\)', ' ', clean(s)).lower().replace('&', ' and ')  # "(YVHA)" is the same body
    s = re.sub(r'[^a-z0-9 ]+', ' ', s)
    return ' '.join(ORG_NOISE.sub(' ', s).split())


def split_sponsors(s):
    s = clean(s)
    if not s or not re.search(r'[A-Za-z]{3}', s):
        return []
    parts = [clean(p) for p in re.split(r'\s*/\s*|;|\s+in partnership with\s+', s, flags=re.I)]
    out = []
    for p in parts:
        # A joint sponsor written "Overland Property Group & Yampa Valley Housing Authority"
        # is two organisations; "Community Resources & Housing Development Corp." is one.
        m = re.match(r'^(.*\b' + ORG_END + r')\s+(?:&|and)\s+(.*\b' + ORG_END + r')$', p, flags=re.I)
        out += [m.group(1), m.group(2)] if m and not re.search(r'\b(city|county|town)$', m.group(1), re.I) else [p]
    return [p.strip(' ,') for p in out if re.search(r'[A-Za-z]{3}', p)]


ORG_END = r'(?:group|llc|l\.l\.c\.|inc\.?|incorporated|corp\.?|corporation|company|partners|lllp|lp|authority|communities|development)\.?'


def sponsor_kind(name, nonprofit_keys):
    n = name.lower()
    if 'housing authority' in n or re.search(r'\bhousing (partners|authority)\b', n) and 'authority' in n:
        return 'housing authority'
    if re.match(r'^(the )?(city|town|county|city and county) of\b', n) or re.search(r'\bcounty\b$', n):
        return 'local government'
    # Nonprofit only on evidence: the name is on the IRS 501(c)(3) list, or the name itself
    # says so. Words like "community development partners" are used by companies too.
    bare = org_key(re.sub(r'\([^)]*\)', ' ', name))
    bare = re.sub(r' (ii|iii|iv)$', '', bare)
    if bare in nonprofit_keys or org_key(name) in nonprofit_keys or re.search(r'habitat for humanity|volunteers of america|catholic charities|\bnon-?profit\b', n):
        return 'nonprofit'
    return 'company or other'  # includes nonprofits we could not verify


def canonical_org(k, known):
    """A sponsor the award report printed with its project name run in ("<Town> <Project>
    Housing Authority") is that town's housing authority when one is among `known`."""
    m = re.match(r'^(\w+ \w+) .+ housing authority$', k)
    if m and m.group(1) + ' housing authority' in known and k != m.group(1) + ' housing authority':
        return m.group(1) + ' housing authority'
    return k


def build_developers(counties, places, nonprofit_keys):
    """Per county and per place: sponsors and grantees of state awards and CHFA applications."""
    excl = excluded_hashes()
    events = []  # (county_fips, place_geoid|None, sponsor, project, year, homes, stage, program, url)

    def keep(name, city):
        return apps_mod.exclusion_hash(name or '', city or '') not in excl and not is_private(name) and not is_private(city)

    place_by_name = defaultdict(set)
    for g, p in places.items():
        place_by_name[(p['county'], org_key(plain(p['name'])))].add(g)

    def place_for(county, city):
        s = place_by_name.get((county, org_key(city or '')))
        return next(iter(s)) if s and len(s) == 1 else None

    led = read_json(os.path.join(ROOT, 'data', 'policy', 'funding-awards', 'ledger.json'))['awards']
    for a in led:
        if not a.get('county_fips') or not keep(a.get('name'), a.get('location')):
            continue
        if RETURNED.search(a.get('detail') or ''):
            continue  # CHFA notes the award was returned: no home was built
        for sp in split_sponsors(a.get('sponsor')):
            events.append((a['county_fips'], place_for(a['county_fips'], a.get('location')), sp, a.get('name'), a.get('year'),
                           a.get('total_units'), 'awarded', a.get('program'), a.get('source_url')))
    dola = read_json(os.path.join(ROOT, 'data', 'policy', 'funding-awards', 'dola-awards.json'))['awards']
    for a in dola:
        if not a.get('county_fips') or not keep(a.get('name'), a.get('town')):
            continue
        for sp in split_sponsors(a.get('grantee')):
            events.append((a['county_fips'], place_for(a['county_fips'], a.get('town')), sp, a.get('name'), a.get('year'),
                           a.get('homes'), 'awarded', 'DOLA ' + (a.get('program') or 'award'), a.get('source_url')))
    apps = read_json(os.path.join(ROOT, 'data', 'jurisdiction-briefs', '_lihtc-applications.json'))['applications']
    for a in apps:
        if not a.get('county_fips') or not keep(a.get('name'), a.get('city')):
            continue
        pg = (a.get('place_geoids') or [None])
        for sp in split_sponsors(a.get('sponsor')):
            events.append((a['county_fips'], pg[0] if len(pg) == 1 else place_for(a['county_fips'], a.get('city')), sp, a.get('name'),
                           a.get('year'), a.get('total_units'), 'awarded' if a.get('outcome') == 'awarded' else 'applied',
                           'CHFA ' + (a.get('credit_type') or '') + ' tax-credit application', a.get('source_url')))
    events = [e for e in events if e[4] is None or e[4] >= SINCE]
    events = [e for e in events if not is_private(e[2])]

    def summarise(evs):
        orgs = {}
        for c, pg, sp, proj, yr, homes, stage, prog, url in evs:
            k = org_key(sp)
            o = orgs.setdefault(k, {'name': sp, 'projects': {}, 'kind': sponsor_kind(sp, nonprofit_keys)})
            if len(sp) > len(o['name']) and org_key(sp) == k:
                o['name'] = o['name'] if o['name'][:1].isupper() else sp
            pk = apps_mod.norm_name(proj or '') or (proj or '?')
            p = o['projects'].setdefault(pk, {'name': clean(proj) or None, 'year': yr, 'homes': None, 'homes_applied': None, 'awarded': False, 'programs': set(), 'url': url})
            p['year'] = max([y for y in (p['year'], yr) if y is not None], default=None)
            if homes is not None:
                # Homes on an award and homes on an application that did not win are kept apart:
                # an earlier, larger application must not inflate the awarded count.
                slot = 'homes' if stage == 'awarded' else 'homes_applied'
                p[slot] = max(homes, p[slot] or 0)
            p['awarded'] = p['awarded'] or stage == 'awarded'
            if prog:
                p['programs'].add(prog)
            if stage == 'awarded' and url:
                p['url'] = url
        # A sponsor the award report printed with its project name run in ("<Town> <Project>
        # Housing Authority") joins that town's housing authority when one is on file.
        for k in list(orgs):
            to = canonical_org(k, orgs)
            if to != k:
                into = orgs[to]
                for pk, p in orgs.pop(k)['projects'].items():
                    # The run-in row lost its project name; the same homes on file already is the same project.
                    if not p['name'] and p['homes'] is not None and any(q['homes'] == p['homes'] for q in into['projects'].values()):
                        continue
                    into['projects'].setdefault(pk, p)
        out = []
        for o in orgs.values():
            projs = list(o['projects'].values())
            homes = [p['homes'] for p in projs if p['awarded'] and p['homes'] is not None]
            out.append({
                'name': o['name'], 'kind': o['kind'],
                'projects_awarded': sum(1 for p in projs if p['awarded']),
                'projects_applied_only': sum(1 for p in projs if not p['awarded']),
                'homes_awarded': sum(homes) if homes else None,
                'latest_year': max([p['year'] for p in projs if p['year'] is not None], default=None),
                'projects': sorted([{'name': p['name'], 'year': p['year'], 'homes': p['homes'] if p['awarded'] else p['homes_applied'], 'awarded': p['awarded'],
                                     'programs': sorted(p['programs']), 'source_url': p['url']} for p in projs],
                                   key=lambda p: (-(p['year'] or 0), p['name'] or ''))[:6],
            })
        out.sort(key=lambda o: (-(o['homes_awarded'] or 0), -o['projects_awarded'], -o['projects_applied_only'], o['name']))
        return out

    by_county = defaultdict(list)
    by_place = defaultdict(list)
    for e in events:
        by_county[e[0]].append(e)
        if e[1]:
            by_place[e[1]].append(e)
    def totals(evs):
        """Geography-wide counts from every event, before any top-N cut. A project named by
        two sponsors (an award report and a DOLA grantee row, say) counts once."""
        projects, orgs, kinds = {}, set(), defaultdict(set)
        keys = {org_key(e[2]) for e in evs}
        names = {}
        for e in evs:
            names.setdefault(org_key(e[2]), e[2])
        canon = {k: canonical_org(k, keys) for k in keys}
        named_homes = defaultdict(set)  # canonical org -> homes on its named projects
        for c, pg, sp, proj, yr, homes, stage, prog, url in evs:
            if apps_mod.norm_name(proj or '') and homes is not None:
                named_homes[canon[org_key(sp)]].add(homes)
        for c, pg, sp, proj, yr, homes, stage, prog, url in evs:
            if stage != 'awarded':
                continue
            k = canon[org_key(sp)]
            orgs.add(k)
            kinds[sponsor_kind(names[k], nonprofit_keys)].add(k)
            pk = apps_mod.norm_name(proj or '')
            if not pk and k != org_key(sp) and homes in named_homes[k]:
                continue  # the run-in row repeats a project its housing authority already has
            pk = pk or ('?', k, yr, homes)
            if homes is not None:
                projects[pk] = max(homes, projects.get(pk) or 0)
            else:
                projects.setdefault(pk, None)
        homes = [h for h in projects.values() if h is not None]
        return {'organisations_awarded': len(orgs), 'by_kind': {k: len(v) for k, v in sorted(kinds.items())},
                'projects_awarded': len(projects), 'homes_awarded': sum(homes) if homes else None}

    return ({g: (summarise(v), totals(v)) for g, v in by_county.items()},
            {g: (summarise(v), totals(v)) for g, v in by_place.items()})


def lihtc_stock():
    """CHFA tax-credit properties per county: count, homes and the nonprofit-sponsor share."""
    feats = read_json(os.path.join(ROOT, 'data', 'chfa-lihtc.json'))['features']
    acc = defaultdict(lambda: {'properties': 0, 'homes': 0, 'homes_not_given': 0, 'nonprofit_properties': 0, 'by_city': defaultdict(int)})
    for f in feats:
        p = f['properties']
        c = p.get('CNTY_FIPS')
        if not c or is_private(p.get('PROJECT')):
            continue
        a = acc[c]
        a['properties'] += 1
        li = p.get('LI_UNITS')
        if li is None or li == '':
            a['homes_not_given'] += 1  # missing is not zero; a published 0 stays 0
        else:
            a['homes'] += int(li)
        a['nonprofit_properties'] += 1 if p.get('NON_PROF') in (1, '1', True) else 0
        a['by_city'][org_key(p.get('PROJ_CTY'))] += 1
    return acc


# ---------------------------------------------------------------- land

# Owner types, each with the pattern that admits it. Public types are anchored and
# conservative: a company or a person whose name merely contains "County", "USA" or
# "Authority" must not be read as a government. owner_type() tries them in the
# order of OWNER_ORDER, after two screens: a legal-entity suffix (LLC, Inc, ...)
# means a private organisation, and a trust or estate word means a family trust,
# unless an earlier anchored public pattern already matched.
OWNER_TYPES = [
    # (type, label, public?, regex)
    ('federal', 'Federal government', True, r'^(THE )?(UNITED STATES|USA\b|U ?S ?A\b|U S\b|US\b|BLM\b|BUREAU OF (LAND|RECLAMATION)|FOREST SERVICE|USFS\b|DEPARTMENT OF (THE )?(INTERIOR|ENERGY|AGRICULTURE|DEFENSE|THE ARMY|THE AIR FORCE))|\bNATIONAL (FOREST|PARK|MONUMENT|GRASSLAND|RECREATION AREA|WILDLIFE REFUGE)\b|^U ?S POSTAL SERVICE'),
    ('tribal', 'Tribal nations', True, r'\b(TRIBE|SOUTHERN UTE INDIAN|UTE MOUNTAIN UTE)\b'),
    ('school', 'School districts and colleges', True, r'\b(SCHOOL DIST|SCHOOL DISTRICT|SCH DIST|UNIVERSITY|COLLEGE|BOCES)\b'),
    ('housing_authority', 'Housing authorities', True, r'\bHOUSING AUTH(ORITY)?\b'),
    ('state', 'State of Colorado', True, r'^(THE )?STATE OF COLORADO|\bSTATE BOARD OF LAND|\bSTATE LAND BOARD\b|\bBOARD OF LAND COMMISSIONERS\b|^COLORADO (DEPARTMENT|DIVISION|STATE PARKS|PARKS)|^(COLORADO )?DIVISION OF (WILDLIFE|PARKS)|^DEPARTMENT OF (PARKS|TRANSPORTATION|CORRECTIONS|HIGHWAYS|NATURAL RESOURCES)|^CDOT\b'),
    ('special_district', 'Special districts and authorities', True, r'\b(DISTRICT|DIST|AUTHORITY|SANITATION|FIRE PROTECTION)\b'),
    ('county', 'County government', True, r'^(\w+ ){1,2}COUNTY( OF COLORADO| COLORADO| COMMISSIONERS| BOARD.*| GOVERNMENT)?$|^COUNTY OF \w|^BOARD OF (THE )?COUNTY COMMISSIONERS'),
    ('municipal', 'City and town governments', True, r'^(THE )?(CITY|TOWN) OF \w|^CITY (AND|&) COUNTY OF|^(\w+[ ,]+){1,2}(CITY|TOWN) OF$|^INCORPORATED TOWN'),
    ('utility', 'Railroads, utilities and energy companies', False, r'\b(RAILROAD|RAILWAY|RAIL ROAD|ELECTRIC|ENERGY|POWER|XCEL|PUBLIC SERVICE CO|TELEPHONE|TELECOM|COMMUNICATIONS|PIPELINE|PETROLEUM|OIL|GAS|MINING|COAL|CHEVRON|EXXON|OXY)\b'),
    ('religious', 'Churches and religious bodies', False, r'\b(CHURCH|DIOCESE|PARISH|BISHOP|CONGREGATION|MINISTR(Y|IES)|LUTHERAN|BAPTIST|CATHOLIC|METHODIST|PRESBYTERIAN|LATTER|TEMPLE|SYNAGOGUE|MOSQUE|EPISCOPAL|ASSEMBLY OF GOD|CHRISTIAN|ABBEY|MONASTERY)\b'),
    ('hoa', 'Homeowner associations', False, r'\b(HOMEOWNERS|HOME OWNERS|OWNERS ASSOC|OWNERS ASSN|HOA|PROPERTY OWNERS|CONDOMINIUM ASSOC|MASTER ASSOC)\b'),
    ('nonprofit', 'Nonprofits and land trusts', False, r'\b(FOUNDATION|LAND TRUST|NATURE CONSERVANCY|CONSERVATION FUND|HABITAT FOR HUMANITY|LAND CONSERVANCY|OPEN SPACE TRUST|ASSOCIATION|ASSN|SOCIETY|CLUB|YMCA|SCOUTS)\b'),
    ('trust', 'Family trusts and estates', False, r'\b(TRUST|TRUSTS|TRUSTEE|TRUSTEES|TRS|ESTATE|LIVING TR|REVOCABLE|IRREVOCABLE|REV TR|FAMILY TR|TR UTD|UTD|LIFE ESTATE)\b'),
    ('business', 'Companies and partnerships', False, r'\b(LLC|L L C|LLLP|LLP|LP|L P|INC|INCORPORATED|CORP|CORPORATION|COMPANY|CO|LTD|PARTNERS|PARTNERSHIP|HOLDINGS|PROPERTIES|PROPERTY|INVESTMENTS?|INVESTORS|DEVELOPMENT|DEVELOPERS|ENTERPRISES|BANK|GROUP|VENTURES|CAPITAL|REALTY|HOMES|BUILDERS|LAND|RANCH(ES)?|FARMS?|CATTLE|LIVESTOCK|ORCHARDS?|VINEYARDS?|PLLC|PC|ASSOCIATES|DITCH|IRRIGATION|CANAL|RESERVOIR|WATER)\b'),
]
_OWNER_RX = {t: re.compile(rx) for t, _, _, rx in OWNER_TYPES}
TYPE_LABEL = {t: l for t, l, _, _ in OWNER_TYPES} | {'individual': 'Individuals', 'unknown': 'Owner not given'}
PUBLIC_TYPES = {t for t, _, pub, _ in OWNER_TYPES if pub}
# Owners never named: people, and family trusts and estates (they name people).
UNNAMED_TYPES = {'individual', 'trust', 'unknown'}
# CO is left out of the entity screen: owners use it for Colorado and County
# ("Jefferson Co School District", "Town of Mountain Village Co") far more than for
# Company. A trailing CO still marks a company unless the name opens like a government.
ENTITY = re.compile(r'\b(LLC|L L C|LLLP|LLP|LP|L P|INC|INCORPORATED|CORP|CORPORATION|COMPANY|LTD|PLLC)\b')
TRAILING_CO = re.compile(r' CO$')
LAND_TRUST = re.compile(r'\b(LAND TRUST|OPEN SPACE TRUST|CONSERVATION TRUST)\b|\bCONSERVANCY\b(?!.*\bDIST)')
# The legal form a government writes after its name: "City of Pueblo a Municipal
# Corporation", "Moffat County, a Body Politic", "... Airport Auth a Political Sub of
# State of CO". Only these government forms are recognised; an ordinary company
# keeps its Inc or Corp and stays private.
_CO = r'(?:(?:CO|COLORADO) )?'
GOV_FORM = re.compile(
    r'(?:^| )(?:(?:A|AN) )?(?:'
    + _CO + r'(?:HOME RULE |STATUTORY |QUASI ?)?MUNICIPAL CORP\w*'
    + r'|' + _CO + r'(?:HOME RULE )?MUNICIPALITY'
    + r'|' + _CO + r'HOME RULE CORP\w*'
    + r'|BODY (?:CORP\w*|POLITIC)(?: AND (?:POL\w*|CORP\w*))?'
    + r'|POLITICAL SUB\w*'
    + r'|(?<=A )' + _CO + r'SPECIAL DISTRICT'
    + r')(?: (?:OF|STATE OF|FINANCE) .*)?$')
PUBLIC_ORDER = ['school', 'housing_authority', 'state', 'special_district', 'county', 'municipal']
ANCHORED_PUBLIC = ['state', 'county', 'municipal']
PRIVATE_ORDER = ['utility', 'religious', 'hoa', 'nonprofit', 'business']


def _norm_owner(owner):
    o = re.sub(r'\bC/O\b.*$', '', clean(owner).upper())  # drop care-of lines
    o = re.sub(r'[.,]', ' ', o)
    return ' '.join(o.split())


def owner_type(owner):
    o = _norm_owner(owner)
    if not o:
        return 'unknown'
    g = GOV_FORM.search(o)
    if g:
        rest = o[:g.start()].strip()
        if rest and not ENTITY.search(rest):
            for t in ['federal', 'tribal'] + PUBLIC_ORDER:
                if _OWNER_RX[t].search(rest):
                    return t
            if 'MUNICIPAL' in g.group(0) or 'HOME RULE' in g.group(0):
                return 'municipal'
            return 'county' if rest.endswith('COUNTY') else 'special_district'
    if ENTITY.search(o) or (TRAILING_CO.search(o) and not any(_OWNER_RX[t].search(o) for t in ANCHORED_PUBLIC)):
        # A legal entity is a private organisation, whatever words its name borrows.
        return next((t for t in PRIVATE_ORDER if _OWNER_RX[t].search(o)), 'business')
    if _OWNER_RX['federal'].search(o):
        return 'federal'  # before the trust screen: "United States of America in trust"
    if _OWNER_RX['tribal'].search(o):
        return 'tribal'
    if LAND_TRUST.search(o):
        return 'nonprofit'
    if _OWNER_RX['trust'].search(o) or re.search(r'\b(19|20)\d\d\b', o):
        return 'trust'  # trusts and estates, and names dated like a trust instrument
    for t in PUBLIC_ORDER + PRIVATE_ORDER:
        if _OWNER_RX[t].search(o):
            return t
    return 'individual'


def owner_display(owner):
    o = re.sub(r'\s*\bC/O\b.*$', '', clean(owner), flags=re.I)  # care-of lines can name a person
    o = re.sub(r'\s+\d{3,}$', '', o)  # trailing account numbers some counties append
    return o.title().replace("'S ", "'s ").replace(' Llc', ' LLC').replace(' Lllp', ' LLLP').replace(' Lp', ' LP').replace(' Inc', ' Inc').replace(' Of ', ' of ').replace(' And ', ' and ').replace(' The ', ' the ')


SQDEG_TO_ACRES = 111320.0 ** 2 / 4046.8564224


def parcel_stats(where, geometry, order, cache, name):
    params = {
        'where': where,
        'outStatistics': json.dumps([
            {'statisticType': 'count', 'onStatisticField': 'OBJECTID', 'outStatisticFieldName': 'n'},
            {'statisticType': 'sum', 'onStatisticField': 'Shape__Area', 'outStatisticFieldName': 'sa'}]),
        'groupByFieldsForStatistics': 'owner', 'orderByFields': order, 'f': 'json'}
    if geometry:
        params.update({'geometry': json.dumps(geometry), 'geometryType': 'esriGeometryPolygon', 'inSR': '4326',
                       'spatialRel': 'esriSpatialRelIntersects'})
    body = fetch(PARCELS, cache, name, data=urllib.parse.urlencode(params).encode())
    d = json.loads(body)
    if 'error' in d:
        raise RuntimeError(f'parcel query {name}: {d["error"]}')
    return [f['attributes'] for f in d.get('features', [])]


def parcel_totals(where, geometry, cache, name):
    params = {
        'where': where,
        'outStatistics': json.dumps([
            {'statisticType': 'count', 'onStatisticField': 'OBJECTID', 'outStatisticFieldName': 'n'},
            {'statisticType': 'sum', 'onStatisticField': 'Shape__Area', 'outStatisticFieldName': 'sa'}]),
        'f': 'json'}
    if geometry:
        params.update({'geometry': json.dumps(geometry), 'geometryType': 'esriGeometryPolygon', 'inSR': '4326',
                       'spatialRel': 'esriSpatialRelIntersects'})
    d = json.loads(fetch(PARCELS, cache, name, data=urllib.parse.urlencode(params).encode()))
    if 'error' in d:
        raise RuntimeError(f'parcel totals {name}: {d["error"]}')
    a = d['features'][0]['attributes']
    return a.get('n') or 0, a.get('sa') or 0


def shared_counties(cache):
    params = {'where': '1=1', 'outStatistics': json.dumps([{'statisticType': 'count', 'onStatisticField': 'OBJECTID', 'outStatisticFieldName': 'n'}]),
              'groupByFieldsForStatistics': 'countyName,dateReceived', 'f': 'json'}
    d = json.loads(fetch(PARCELS, cache, 'parcels-counties.json', data=urllib.parse.urlencode(params).encode()))
    out = {}
    for f in d.get('features', []):
        a = f['attributes']
        if not a.get('countyName') or not a.get('n'):
            continue
        rec = out.setdefault(a['countyName'], {'parcels': 0, 'received': None})
        rec['parcels'] += a['n']
        if a.get('dateReceived'):
            v = a['dateReceived']
            if isinstance(v, (int, float)):
                day = dt.datetime.fromtimestamp(v / 1000, dt.timezone.utc).date().isoformat()
            else:
                m, d_, y = (int(x) for x in str(v).split('/'))
                day = dt.date(y, m, d_).isoformat()
            rec['received'] = max(rec['received'] or day, day)
    return out


def land_section(rows_by_acres, rows_by_count, total_n, total_sa, lat, scope_label, received):
    k = SQDEG_TO_ACRES * math.cos(math.radians(lat))
    total_acres = total_sa * k
    by_type = defaultdict(lambda: {'owners': 0, 'parcels': 0, 'acres': 0.0})
    top_orgs, public_orgs = [], []
    counted_sa = 0.0
    for r in rows_by_acres:
        owner = r.get('owner')
        if is_private(owner):
            t = 'business'  # still counted by type, never named
            named = False
        else:
            t = owner_type(owner)
            named = t not in UNNAMED_TYPES
        acres = (r.get('sa') or 0) * k
        counted_sa += r.get('sa') or 0
        bt = by_type[t]
        bt['owners'] += 1
        bt['parcels'] += r.get('n') or 0
        bt['acres'] += acres
        if named and acres >= 1:
            rec = {'owner': owner_display(owner), 'type': t, 'type_label': TYPE_LABEL[t], 'parcels': r.get('n') or 0, 'acres': round(acres)}
            (public_orgs if t in PUBLIC_TYPES else top_orgs).append(rec)
    rest_acres = max(total_acres - counted_sa * k, 0)
    types = sorted(({'type': t, 'label': TYPE_LABEL[t], 'public': t in PUBLIC_TYPES, 'owners': v['owners'], 'parcels': v['parcels'],
                     'acres': round(v['acres']), 'share': round(100 * v['acres'] / total_acres, 1) if total_acres else None}
                    for t, v in by_type.items()), key=lambda x: -x['acres'])
    most_lots = []
    for r in rows_by_count:
        owner = r.get('owner')
        if is_private(owner):
            continue
        t = owner_type(owner)
        if t in UNNAMED_TYPES or t in PUBLIC_TYPES or (r.get('n') or 0) < 5:
            continue
        most_lots.append({'owner': owner_display(owner), 'type': t, 'type_label': TYPE_LABEL[t], 'parcels': r.get('n') or 0,
                          'acres': round((r.get('sa') or 0) * k)})
    return {
        'scope': scope_label,
        'county_record_received': received,
        'parcels': total_n,
        'acres': round(total_acres),
        'largest_owners_counted': len(rows_by_acres),
        'smaller_owners_acres': round(rest_acres),
        'by_type': types,
        'largest_private_organisations': top_orgs[:TOP_LAND],
        'largest_public_owners': public_orgs[:TOP_LAND],
        'most_parcels_private_organisations': most_lots[:TOP_LAND],
    }


def place_geometry(shape):
    rings = [[[round(x, 5), round(y, 5)] for x, y in ring] for ring in _rings(shape)]
    return {'rings': rings, 'spatialReference': {'wkid': 4326}}


# ---------------------------------------------------------------- providers

def build_phas(cache, z2c):
    params = {'where': "STD_ST='CO'", 'outFields': 'PARTICIPANT_CODE,FORMAL_PARTICIPANT_NAME,STD_CITY,STD_ZIP5,CURCNTY,TOTAL_DWELLING_UNITS,SECTION8_UNITS_CNT,HA_PROGRAM_TYPE,LAST_UPDT_DTTM',
              'returnGeometry': 'false', 'resultRecordCount': '2000', 'f': 'json'}
    d = json.loads(fetch(PHA + '?' + urllib.parse.urlencode(params), cache, 'hud-pha.json'))
    out = defaultdict(list)
    for f in d.get('features', []):
        a = f['attributes']
        c = a.get('CURCNTY')
        c = ('08' + str(c)[-3:]) if c and len(str(c)) <= 3 else (str(c) if c else z2c.get(str(a.get('STD_ZIP5') or '')))
        if not c or not c.startswith('08'):
            continue
        out[c].append({'name': clean(a.get('FORMAL_PARTICIPANT_NAME')).title().replace(' Of ', ' of ').replace(' And ', ' and '),
                       'code': a.get('PARTICIPANT_CODE'), 'city': clean(a.get('STD_CITY')).title(),
                       'public_housing_units': a.get('TOTAL_DWELLING_UNITS'), 'voucher_units': a.get('SECTION8_UNITS_CNT'),
                       'program': clean(a.get('HA_PROGRAM_TYPE')) or None})
    for v in out.values():
        v.sort(key=lambda x: -((x['public_housing_units'] or 0) + (x['voucher_units'] or 0)))
    return out


def build_counselors(cache, z2c):
    rows = json.loads(fetch(COUNSEL, cache, 'hud-counselors.json'))
    out = defaultdict(list)
    for a in rows:
        z = str(a.get('zipcd') or '')[:5]
        c = z2c.get(z)
        if not c:
            continue
        out[c].append({'name': clean(a.get('nme')).title().replace(' Of ', ' of ').replace(' And ', ' and '),
                       'city': clean(a.get('city')).title(), 'agency_id': a.get('agcid'),
                       'url': a.get('weburl') if a.get('weburl') and 'notavailable' not in a.get('weburl') else None})
    return out


def build_nonprofits(cache, z2c):
    text = fetch(IRS_BMF, cache, 'irs-eo-co.csv').decode('utf-8', 'replace')
    out = defaultdict(list)
    keys = set()
    for r in csv.DictReader(io.StringIO(text)):
        ntee = (r.get('NTEE_CD') or '').strip().upper()
        name = clean(r.get('NAME'))
        if r.get('SUBSECTION') == '03':
            keys.add(org_key(name))  # any 501(c)(3) charity, to tell nonprofit sponsors from companies
        if not (ntee.startswith('L') and not ntee.startswith('L50')) and not ntee.startswith('P85'):
            continue
        if r.get('STATUS') not in ('01', '1'):
            continue
        if is_private(name):
            continue
        c = z2c.get((r.get('ZIP') or '')[:5])
        if not c:
            continue
        rev = int(r.get('REVENUE_AMT') or 0) or None
        out[c].append({'name': name.title().replace(' Of ', ' of ').replace(' And ', ' and ').replace(' For ', ' for ').replace(' Inc', ' Inc'),
                       'city': clean(r.get('CITY')).title(), 'ntee': ntee, 'activity': NTEE_LABELS.get(ntee[:3], NTEE_LABELS.get(ntee[:1])),
                       'revenue': rev, 'ein': r.get('EIN'), 'url': PROPUBLICA + str(r.get('EIN') or '')})
    for v in out.values():
        v.sort(key=lambda x: (-(x['revenue'] or 0), x['name']))
    return out, keys


# ---------------------------------------------------------------- assemble

def public_view(rec):
    """The basic version: counts, shares, public bodies and nonprofits; no company or private owner names."""
    dev = rec['developers']
    land = rec['land']
    prov = rec['providers']
    T = dev['totals']
    out = {
        'geoid': rec['geoid'], 'name': rec['name'], 'kind': rec['kind'], 'county': rec.get('county'),
        'developers': {
            'organisations': T['organisations_awarded'],
            'by_kind': T['by_kind'],
            'projects_awarded': T['projects_awarded'],
            'homes_awarded': T['homes_awarded'],
            'public_and_nonprofit': [o['name'] for o in dev['organisations'] if o['projects_awarded'] and o['kind'] in ('housing authority', 'local government', 'nonprofit')][:8],
            'tax_credit_properties': dev.get('tax_credit_properties'),
        },
        'land': None if land is None else {
            'scope': land['scope'], 'county_record_received': land['county_record_received'], 'acres': land['acres'],
            'by_type': [{k: t[k] for k in ('type', 'label', 'public', 'acres', 'share')} for t in land['by_type']],
            'smaller_owners_acres': land['smaller_owners_acres'],
            'largest_public_owners': [{k: o[k] for k in ('owner', 'type_label', 'acres')} for o in land['largest_public_owners'][:6]],
        },
        'land_unavailable_reason': rec.get('land_unavailable_reason'),
        'providers': {
            'housing_authorities': [p['name'] for p in prov['housing_authorities']],
            'counseling_agencies': [p['name'] for p in prov['counseling_agencies']],
            'housing_nonprofits': prov['housing_nonprofits_total'],  # counted before the named top-15 cut
            'largest_housing_nonprofits': [p['name'] for p in prov['housing_nonprofits'][:5]],
        },
    }
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    ap.add_argument('--cache', help='keep fetched sources here and reuse them')
    ap.add_argument('--detail-dir', help='write the gated detail files here (coho-backend gated/data/jurisdiction-briefs/_local-players)')
    ap.add_argument('--places', default='', help='comma-separated place GEOIDs that also get a town-level land section')
    ap.add_argument('--all-places', action='store_true', help='town-level land for every incorporated place (slow)')
    ap.add_argument('--check', action='store_true', help='build and print a summary; write nothing')
    args = ap.parse_args()
    today = dt.date.today().isoformat()

    counties, places, shapes = load_geography()
    z2c = zip_to_county()
    nonprofits, np_keys = build_nonprofits(args.cache, z2c)
    phas = build_phas(args.cache, z2c)
    counselors = build_counselors(args.cache, z2c)
    dev_c, dev_p = build_developers(counties, places, np_keys)
    stock = lihtc_stock()
    shared = shared_counties(args.cache)

    want_places = {g for g in args.places.split(',') if g}
    if args.all_places:
        want_places |= {g for g, p in places.items() if p.get('type') == 'place' and not re.search(r'\bCDP\b', p['name'])}

    sources = {
        'developers': [
            {'label': 'COHO award ledger (CHFA and OEDIT award reports, 2016 on)', 'path': 'data/policy/funding-awards/ledger.json'},
            {'label': 'DOLA Division of Housing awards', 'path': 'data/policy/funding-awards/dola-awards.json'},
            {'label': 'CHFA tax-credit applicant reports', 'path': 'data/jurisdiction-briefs/_lihtc-applications.json'},
            {'label': 'CHFA tax-credit property list', 'path': 'data/chfa-lihtc.json'}],
        'land': [{'label': 'Colorado Public Parcels (Governor\'s Office of Information Technology)', 'url': PARCELS_PAGE}],
        'providers': [
            {'label': 'HUD Public Housing Authorities', 'url': PHA_PAGE},
            {'label': 'HUD-approved housing counseling agencies', 'url': COUNSEL_PAGE},
            {'label': 'IRS Exempt Organizations Business Master File (Colorado)', 'url': IRS_PAGE}],
    }

    def record(geoid, name, kind, county_geoid, with_land=True):
        cty = counties[county_geoid]
        short = cty.get('short')
        dev, dev_totals = (dev_c if kind == 'county' else dev_p).get(geoid, ([], None))
        dev_totals = dev_totals or {'organisations_awarded': 0, 'by_kind': {}, 'projects_awarded': 0, 'homes_awarded': None}
        st = stock.get(county_geoid)
        if kind != 'county' and st:
            n = st['by_city'].get(org_key(plain(name)), 0)
            st_out = {'properties': n, 'scope': 'town'} if n else None
        else:
            st_out = {'properties': st['properties'], 'homes': st['homes'], 'nonprofit_properties': st['nonprofit_properties'], 'scope': 'county'} if st else None
            if st and st['homes_not_given']:
                st_out['properties_without_restricted_count'] = st['homes_not_given']
        np_all = [p for p in nonprofits.get(county_geoid, []) if kind == 'county' or org_key(p['city']) == org_key(plain(name))]
        rec = {
            'geoid': geoid, 'name': plain(name) if kind != 'county' else name, 'kind': kind,
            'county': {'geoid': county_geoid, 'name': cty['name']},
            'built': today,
            'developers': {'since': SINCE, 'organisations': dev[:TOP_DEVELOPERS], 'organisations_total': len(dev),
                           'totals': dev_totals,
                           'tax_credit_properties': st_out},
            'land': None,
            'land_unavailable_reason': None,
            'providers': {
                'housing_authorities': phas.get(county_geoid, []),
                'counseling_agencies': counselors.get(county_geoid, []),
                'housing_nonprofits': np_all[:TOP_NONPROFITS],
                'housing_nonprofits_total': len(np_all),
                'scope_note': 'Housing authorities and counseling agencies are listed for the whole county; nonprofits by the city on their IRS record.'
                if kind != 'county' else 'By the county of each organisation\'s address.',
            },
            'sources': sources,
        }
        if not with_land:
            rec['land_unavailable_reason'] = 'Town-level land holders are not built for this town yet; see its county.'
            return rec
        if short not in shared:
            rec['land_unavailable_reason'] = f'{short} County does not share its parcel records with the state composite, so its land holders are not listed. The county assessor\'s own site has them.'
            return rec
        try:
            if kind == 'county':
                where = f"countyName='{short}'"
                geom = None
                tag = county_geoid
                scope = f'All parcels in {cty["name"]}'
            else:
                if geoid not in shapes:
                    rec['land_unavailable_reason'] = 'No boundary on file for this town.'
                    return rec
                where = f"countyName='{short}'"
                geom = place_geometry(shapes[geoid])
                tag = geoid
                scope = f'Parcels inside or touching the {plain(name)} town boundary'
            by_acres = parcel_stats(where, geom, 'sa DESC', args.cache, f'parcels-{tag}-acres.json')
            by_count = parcel_stats(where, geom, 'n DESC', args.cache, f'parcels-{tag}-count.json')
            tn, tsa = parcel_totals(where, geom, args.cache, f'parcels-{tag}-total.json')
            land = land_section(by_acres, by_count, tn, tsa, cty.get('lat', 39.0), scope, shared[short]['received'])
            no_owner = sum(t['acres'] for t in land['by_type'] if t['type'] == 'unknown')
            if land['acres'] and no_owner / land['acres'] >= 0.5:
                # Some counties share parcel outlines with the owner field blank; their
                # land cannot be sorted by owner at all.
                rec['land_unavailable_reason'] = f'{short} County shares its parcel outlines with the state composite but not the owner names, so its land holders are not listed. The county assessor\'s own site has them.'
            else:
                rec['land'] = land
        except RuntimeError as e:
            rec['land_unavailable_reason'] = 'The state parcel service did not answer when this was built.'
            print('warn:', e, file=sys.stderr)
        return rec

    detail = {}
    for g, c in sorted(counties.items()):
        detail[g] = record(g, c['name'], 'county', g)
        print('county', g, c['name'], file=sys.stderr)
    for g in sorted(places):
        p = places[g]
        if not p.get('county') or p['county'] not in counties:
            continue
        detail[g] = record(g, p['name'], 'place', p['county'], with_land=g in want_places)
        if g in want_places:
            print('place', g, p['name'], file=sys.stderr)

    public = {
        'meta': {
            'title': 'Who builds, holds land and provides housing services, by Colorado county and town',
            'generator': 'scripts/market/build_local_players.py',
            'built': today,
            'method': 'Developers are sponsors and grantees on state housing awards and CHFA tax-credit applications since 2016. '
                      'Land holders come from the Colorado Public Parcels composite, grouped by owner as printed on the county record; acres are mapped parcel area. '
                      'Providers are HUD public housing authorities, HUD-approved housing counseling agencies and IRS-listed housing and shelter charities (NTEE L, without homeowner associations, plus P85 homeless service centres).',
            'public_safety': 'This public file gives counts and shares by type and names only public bodies and nonprofits. Company names, private land owners and people are in the gated detail files only; people are never named anywhere.',
            'sources': sources,
        },
        'areas': {g: public_view(r) for g, r in detail.items()},
    }
    if args.check:
        g = sorted(want_places)[0] if want_places else '08077'
        print(json.dumps(detail.get(g), indent=1)[:6000])
        return
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(public, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print('wrote', os.path.relpath(OUT, ROOT), len(public['areas']), 'areas')
    if args.detail_dir:
        os.makedirs(args.detail_dir, exist_ok=True)
        for g, r in detail.items():
            with open(os.path.join(args.detail_dir, g + '.json'), 'w', encoding='utf-8') as f:
                json.dump(r, f, indent=1, ensure_ascii=False)
                f.write('\n')
        print('wrote', len(detail), 'detail files to', args.detail_dir)


if __name__ == '__main__':
    main()
