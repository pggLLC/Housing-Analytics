#!/usr/bin/env python3
"""
scripts/market/build_development_activity.py — one ledger of significant
affordable-housing development activity in Colorado, one row per project.

Every row is a project that a state agency has recorded at some stage of its
life, joined across the files the repo already builds from those agencies'
own documents:

  CHFA applicant reports      data/jurisdiction-briefs/_lihtc-applications.json
                              (scripts/funding/build_lihtc_applications.py)
  CHFA and OEDIT award lists  data/policy/funding-awards/ledger.json, with the
                              printed row from award-rows.json as the quote
                              (scripts/funding/build_funding_awards.py,
                              build_award_rows.py)
  CHFA 2026 Round One         data/affordable-housing/chfa-awards/2026-round-one.json
  DOLA Division of Housing    data/policy/funding-awards/dola-awards.json
  CHFA property list          data/chfa-lihtc.json (CHFA's tax-credit property
                              feed; its compliance status is the only stage
                              signal it carries)

Each stage a project reached is an event with its year, agency, program, the
amount as printed and the source document. A project's `stage` is the furthest
event it has. The ledger never claims a project is built or open: no source
here says so. CHFA's property feed copies the allocation year into its
placed-in-service field for recent deals (YR_PIS equals YR_ALLOC on every
2022–2025 allocation), so that field is not read.

Sponsor, owner and contact columns are never copied: this file is public-safe.
Projects listed in data/jurisdiction-briefs/_lihtc-applications-excluded.json
(by hash, so that file names nothing) are left out of every source.

Writes data/market/development-activity.json. No network.

Usage:
  python3 scripts/market/build_development_activity.py          # write
  python3 scripts/market/build_development_activity.py --check  # build, compare, write nothing
"""
from __future__ import annotations

import argparse
import difflib
import importlib.util
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
_spec = importlib.util.spec_from_file_location(
    'build_lihtc_applications', os.path.join(ROOT, 'scripts', 'funding', 'build_lihtc_applications.py'))
apps_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(apps_mod)
awards = apps_mod.awards
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'funding'))
_spec = importlib.util.spec_from_file_location(
    'build_award_rows', os.path.join(ROOT, 'scripts', 'funding', 'build_award_rows.py'))
rows_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(rows_mod)

APPLICATIONS = os.path.join(ROOT, 'data', 'jurisdiction-briefs', '_lihtc-applications.json')
EXCLUDED = os.path.join(ROOT, 'data', 'jurisdiction-briefs', '_lihtc-applications-excluded.json')
LEDGER = os.path.join(ROOT, 'data', 'policy', 'funding-awards', 'ledger.json')
AWARD_ROWS = os.path.join(ROOT, 'data', 'policy', 'funding-awards', 'award-rows.json')
DOLA = os.path.join(ROOT, 'data', 'policy', 'funding-awards', 'dola-awards.json')
ROUND_2026 = os.path.join(ROOT, 'data', 'affordable-housing', 'chfa-awards', '2026-round-one.json')
LIHTC_FEED = os.path.join(ROOT, 'data', 'chfa-lihtc.json')
GEO_CONFIG = os.path.join(ROOT, 'data', 'hna', 'geo-config.json')
CROSS_COUNTY = os.path.join(ROOT, 'data', 'hna', 'cross-county-places.json')
OUT = os.path.join(ROOT, 'data', 'market', 'development-activity.json')

FIRST_YEAR = 2016  # the award ledger's first year; older feed rows are history, not activity

# Furthest first. A project's stage is the highest-ranked event it has.
STAGES = {
    'under_construction': (5, "CHFA's property list shows it in its construction phase"),
    'funded': (4, 'A state agency awarded it credits, a grant or a loan'),
    'land_funded': (3, 'Prop 123 Land Banking paid for the land; no homes are funded yet'),
    'applied': (2, 'An application is in, and its round has not been decided'),
    'not_funded': (1, "Applied, and the round's award report does not list it"),
    'letter_of_intent': (0, 'A letter of intent is on CHFA\'s rolling list'),
}
APP_STAGE = {'awarded': None, 'not_awarded': 'not_funded', 'pending': 'applied', 'in_review': 'applied',
             'letter_of_intent': 'letter_of_intent', 'unresolved': 'applied'}

STATE_FIPS = '08'

# Awards that fund a program rather than homes in one place: down payment
# assistance, rehabilitation programs, statewide NOFAs. They are counted in
# meta.program_awards_left_out, not listed as projects.
NOT_A_PROJECT = re.compile(r'down ?payment|\bDPA\b|rehabilitation program|\bSFOO\b|\bNOFA\b|statewide|'
                           r'mortgage|\bprograms?\b|\bSFR\b|DPA\b|single family owner|first time home ?ownership|'
                           r'initiative|\bAHIF ?\d*\b|\bROC\b|Resident Ownership Capital|Impact Development Fund|'
                           r'Next Step 2 Generation', re.I)
DOLA_PROGRAM_TEXT = re.compile(r'opted[- ]in areas|various (?:addresses|locations)|\brepairs?\b|'
                               r'down ?payment|mortgage|'
                               # services and vouchers fund people in homes, not the homes
                               r'tenancy support|\bvouchers?\b', re.I)
# A Prop 123 homeownership (AHOP) award that prints no homes funds buyers or
# repairs across a service area, not homes on one site.
NO_HOMES_MEANS_PROGRAM = {'Prop 123 homeownership (AHOP)'}
# Prop 123 Modular Finance lends to factories, not to a housing site.
NOT_A_SITE_PROGRAMS = {'Prop 123 Modular Finance'}


# a rebuilt quote's Source field is the article's headline, not the award
# ("... affordable housing, down payment grants across the state")
SOURCE_FIELD = re.compile(r'(^|; )Source: [^;]*')


def core_name(name: str) -> str:
    """A project's name without a former name ("Canopy at Red Oak fka: Red Oak
    Park Phase II") or a trailing credit-type digit ("Ives II 4"), normalised."""
    name = re.split(r'\bf\.?k\.?a\b', name, flags=re.I)[0]
    # "Cañon" and "Canon" are one word; norm_name would split the ñ into a space
    name = unicodedata.normalize('NFKD', name.replace('\u2019', "'")).encode('ascii', 'ignore').decode()
    name = re.sub(r'\((phase[^)]*)\)', r' \1 ', name, flags=re.I)  # norm_name drops brackets
    n = re.sub(r' [49]$', '', apps_mod.norm_name(name))
    n = re.sub(r'\bmobile home park\b', 'mhp', n)  # "Capitol City MHP" is the same park
    # "Phase 1" is every unphased name's phase, and "PSH" describes the homes,
    # not a second project ("Marshall Homes PSH", "The Osborn - PSH"); DOLA
    # names each financing award after its fund ("Zocalo Liora CHIF" and
    # "Zocalo Liora THLF" are one development)
    n = re.sub(r'\s(?:thlf|tahlf|chif|tahg|hdg)$', '', n)
    n = re.sub(r'\sprop 123$', '', n)  # "3 Mile MHP - Prop-123" names the fund, not a second park
    # a name that is a street address reads alike however the street is
    # abbreviated: "101 W. Main St" and "101 Main" are one Frisco building
    if re.match(r'\d+ ', n):
        n = ' '.join(w for w in n.split() if w not in ADDRESS_WORDS)
    return re.sub(r'\s+', ' ', re.sub(r'\bphase (?:1|one)\b|\bpsh\b', ' ', n)).strip()


# Postal localities a source prints as the town that are neither Census places
# nor CDPs, so no registry names their county. Census 2020 gazetteer has no
# Conifer; the community sits wholly in Jefferson County (US-285 corridor).
LOCALITY_COUNTY = {'conifer': '08059'}
ADDRESS_WORDS = {'n', 's', 'e', 'w', 'north', 'south', 'east', 'west', 'st', 'street', 'ave', 'avenue',
                 'rd', 'road', 'blvd', 'boulevard', 'dr', 'drive', 'way', 'ct', 'court', 'pl', 'place',
                 'hwy', 'highway', 'pkwy', 'parkway', 'ln', 'lane'}
DESCRIPTIVE_WORDS = {'affordable'}  # read only with the same town, phase and size
ROMAN = {'iv': '4', 'v': '5', 'vi': '6', 'vii': '7', 'viii': '8', 'ix': '9'}  # norm_name maps i–iii


def phase(n: str) -> str:
    """The phase a name prints, as "phase 2" or as a trailing "2" or "II"
    ("Chris Mountain II" is "Chris Mountain Phase II", and "Lumien Apartments
    II LLC" is phase 2); a two-digit trailing number is part of the name
    ("Walden 35")."""
    m = re.search(r'\bphase (\w+)', n) or re.search(r'(?:^|\s)(\d|iv|v|vi|vii|viii|ix)(?:\s+(?:llc|lp|ltd))?$', n)
    if not m:
        return '1'
    v = m.group(1)
    return {'one': '1', 'two': '2', 'three': '3'}.get(v, ROMAN.get(v, v))


def without_phase_word(n: str) -> str:
    return ' '.join(w for w in n.split() if w != 'phase')


def same_project(a: str, b: str) -> bool:
    """The application-to-award name rule, made stricter for a ledger that joins
    five sources: different phases are different projects ("Walden 35" and
    "Walden 35 Phase II"), and two names that each carry a word the other lacks
    are different projects ("Exodus at Green Valley Ranch", "Reserves at Green
    Valley Ranch")."""
    if phase(a) != phase(b):
        return False
    a, b = without_phase_word(a), without_phase_word(b)
    if a.replace(' ', '') == b.replace(' ', ''):
        return True  # "JetWing Flats" and "Jet Wing Flats"
    if not apps_mod.similar(a, b):
        return False
    wa, wb = set(a.split()), set(b.split())
    return not (wa - wb and wb - wa) or a == b


def misspelt(p: dict, name_n: str, county: str | None, city_n: str, units: int | None) -> bool:
    """One letter off in one source ("Geteway North" for "Gateway North"):
    the same county, town, phase and size, and names that differ by a typo
    or by a word that describes the homes, or one name spelled out inside the
    other at the same home count."""
    # a row that prints no town (some DOLA awards) can agree only on the
    # county, and then only by the name rules below at the same home count
    townless = not (city_n and p['_city_n'])
    if not (county and county == p['county_fips'] and (townless or city_n == p['_city_n']) and units) \
            or phase(p['_name_n']) != phase(name_n):
        return False
    known = [e['_units'][0] for e in p['events'] if e.get('_units')]
    if not any(abs(k - units) <= 0.15 * max(k, units) for k in known):
        return False
    # "Albion Affordable Apartments" and "Albion Apartments": a word that
    # describes the homes rather than naming the building
    plain = lambda n: ' '.join(w for w in n.split() if w not in DESCRIPTIVE_WORDS)
    if plain(p['_name_n']) == plain(name_n) and (not townless or units in known):
        return True
    # "Ridgegate Parkway Affordable Senior" spells out "RidgeGate Senior": one
    # name's words all inside the other's, joined only at the same home count
    wa, wb = set(plain(p['_name_n']).split()), set(plain(name_n).split())
    if (wa <= wb or wb <= wa) and min(wa, wb, key=len) and units in known:
        return True
    if townless:
        return False  # "Mosaic PSH" (no town) is "Commons at Mosaic" (Denver), both 58
    a, b = p['_name_n'].replace(' ', ''), name_n.replace(' ', '')
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.9


def read(path: str):
    with open(path) as fh:
        return json.load(fh)


def money(v) -> str | None:
    return f'${v:,}' if isinstance(v, (int, float)) and v > 0 else None


class Ledger:
    def __init__(self, excluded: set[str], places: dict[str, str], county_names: dict[str, str]):
        self.projects: list[dict] = []
        self.excluded = excluded
        self.places = places
        self.county_names = county_names
        self.left_out = 0
        self.programs_left_out = 0
        self.supplement_duplicates = 0
        self.city_county: dict[str, str] = {}

    def place_of(self, city: str | None, county: str | None) -> str | None:
        g = self.places.get(awards.norm(city or ''))
        if ',' in (city or ''):
            return None  # a scattered site in several towns has no one place
        return g if g and (not county or g in self.county_places.get(county, ())) else None

    def find(self, name_n: str, county: str | None, city_n: str, units: int | None) -> dict | None:
        for p in self.projects:
            if not same_project(p['_name_n'], name_n) and not misspelt(p, name_n, county, city_n, units):
                continue
            if county and p['county_fips'] and p['county_fips'] != county \
                    and county not in self.city_counties.get(p['_city_n'], ()) \
                    and p['county_fips'] not in self.city_counties.get(city_n, ()):
                continue  # a town in two counties (Aurora) may be printed with either
            # two towns are two projects ("The Ridge" in Colorado Springs and in
            # Denver), unless one printing contains the other ("Pueblo CHFA")
            known = [e['_units'][0] for e in p['events'] if e.get('_units')]
            agree = bool(units and known and any(abs(k - units) <= 0.15 * max(k, units) for k in known))
            if city_n and p['_city_n'] and city_n not in p['_city_n'] and p['_city_n'] not in city_n:
                # ...except one name in one county with the same size printed
                # under two town labels: Aster Place in "Parachute" and
                # "Battlement Mesa", Shooks Run in "Colordo Springs"
                if not (county and county == p['county_fips'] and p['_name_n'] == name_n and agree):
                    continue
            # a name inside a longer name ("Park Avenue Apartments", "Park Avenue
            # West Apartments") is one project only if the unit counts agree
            if p['_name_n'] != name_n and units and known and not agree:
                continue
            return p
        return None

    def add(self, name: str, city: str | None, county: str | None, event: dict,
            units: int | None = None, restricted: int | None = None, place: str | None = None,
            counties: list[str] | None = None) -> None:
        if not name:
            return
        if NOT_A_PROJECT.search(name) or re.search(r'down ?payment', SOURCE_FIELD.sub('', event.get('quote') or ''), re.I) or event.get('program') in NOT_A_SITE_PROGRAMS \
                or awards.norm(city or '') in ('varied', 'various', 'statewide'):
            self.programs_left_out += 1
            return
        # an excluded project is added and joined like any other, so a renamed
        # alias (another source, another name) joins it and leaves with it;
        # finish() drops every project holding an excluded event
        if apps_mod.exclusion_hash(name, city or '') in self.excluded:
            event['_excluded'] = True
        name_n, city_n = core_name(name), awards.norm(city or '')
        county = county if county and county.startswith(STATE_FIPS) and len(county) == 5 else None
        if city_n and city_n not in self.city_county and ',' not in (city or ''):
            # some sources print the street before the town ("Illinois Ave Salida"):
            # keep the longest trailing run of words that names a town
            words = city_n.split()
            for k in range(min(4, len(words)), 0, -1):
                tail = ' '.join(words[-k:])
                if tail in self.city_county or tail in self.places:
                    city_n = tail
                    city = ' '.join((city or '').split()[-k:])
                    break
        if not county and city_n and ',' not in (city or ''):
            # a town wholly in one county, or a postal locality that is
            # neither a place nor a CDP (Conifer)
            county = self.city_county.get(city_n) or LOCALITY_COUNTY.get(city_n)
        elif county and city_n in self.city_county and county not in self.city_counties.get(city_n, ()) \
                and self.city_county[city_n] in (counties or ()):
            # the source itself lists the town's county beside a conflicting one:
            # the town wins (an application for "Ridge" in Denver, listed in
            # Denver and El Paso, was placed in El Paso by matching its name to
            # an older Colorado Springs property). A printed county with no such
            # conflict in its own source stands: "Denver" and "Englewood" are
            # also postal names for homes in Adams and Douglas counties
            county = self.city_county[city_n]
        p = self.find(name_n, county, city_n, units)
        if p is None:
            p = {'name': name, 'city': city or None, 'county_fips': county,
                 'county': self.county_names.get(county) if county else None,
                 'place_geoid': place or self.place_of(city, county),
                 'total_units': None, 'restricted_units': None, 'events': [],
                 '_name_n': name_n, '_city_n': city_n}
            self.projects.append(p)
        # a supplemental reading of a report the award ledger already carries
        # (the 2026 Round One file) adds nothing; the ledger's printed row wins
        if event.pop('_supplement', False) and any(
                (e['agency'], e.get('year'), e['stage'], e.get('source_url'))
                == (event['agency'], event.get('year'), event['stage'], event.get('source_url'))
                for e in p['events']):
            self.supplement_duplicates += 1
            return
        if not p['county_fips'] and county:
            p['county_fips'], p['county'] = county, self.county_names.get(county)
        # a scattered site printed with no one county but a list of counties
        # (Gypsum and Silverthorne) belongs to each of them
        if not county and counties and len(counties) > 1:
            p['_counties'] = sorted(set(p.get('_counties') or []) | {c for c in counties if c in self.county_names})
        if not p['place_geoid']:
            p['place_geoid'] = place or self.place_of(city, p['county_fips'])
            if p['place_geoid'] and city:
                # the town the place ID names, not a broader label ("Summit County")
                p['city'], p['_city_n'] = city, city_n
        # units are chosen in finish() from the latest event that prints them
        if units:
            event['_units'] = (units, restricted)
            # DOLA prints homes served, not the property's total and restricted
            # units (King's Crossing: 178 DOLA homes, CHFA 179 total / 178 LI)
            event['_units_from_homes'] = event.get('agency') == 'DOLA'
        event['_name'] = name
        # one source read twice adds nothing; two printed rows in one report
        # (Renaissance Legacy Lofts' 64- and 34-home components) are two events
        key = lambda e: (e['stage'], e.get('year'), e.get('program'), e.get('source_url'), e.get('quote'),
                         e.get('amount'))
        if any(key(e) == key(event) for e in p['events']):
            return
        p['events'].append(event)


def ev(stage: str, year, agency: str, program: str, source_url: str | None, quote: str | None,
       amount=None, amount_label: str | None = None, **extra) -> dict:
    e = {'stage': stage, 'year': year, 'agency': agency, 'program': program,
         'amount': amount if isinstance(amount, (int, float)) and amount > 0 else None,
         'amount_label': amount_label if isinstance(amount, (int, float)) and amount > 0 else None,
         'source_url': source_url, 'quote': quote}
    e.update({k: v for k, v in extra.items() if v is not None})
    return e


SPONSOR_FIELD = re.compile(
    r'\s*[^:;]*\b(sponsor|owner|developer|contact|e-?mail|phone|grantee|borrower|applicant|partner)\w*[^:;]*:', re.I)


CONTACT = re.compile(r'[\w.+-]+@[\w-]+(\.[\w-]+)+|\(?\b\d{3}\)?[-. ]\d{3}[-. ]\d{4}\b')


def strip_sponsor(quote: str | None, sponsor: str | None = None) -> str | None:
    """Quotes are printed rows; drop the sponsor / owner / contact fields so the
    public file names no company. A row printed as one line ("... 60 60 Grand
    Junction Housing Authority <contact name> <phone> <email>") has no field
    headings: it is cut where its sponsor begins, since the contact follows.
    Any e-mail address or phone number left is removed."""
    if not quote:
        return quote
    parts = [s for s in quote.split('; ')
             if not SPONSOR_FIELD.match(s)]
    out = '; '.join(parts)
    if out.startswith('Line as printed: '):
        cut = None
        if sponsor and len(sponsor) > 3 and sponsor in out:
            cut = out.index(sponsor)
        elif CONTACT.search(out):
            # no sponsor recorded: the sponsor and contact follow the last
            # number printed before the first phone or e-mail
            head = out[:CONTACT.search(out).start()]
            nums = list(re.finditer(r'(?<!\S)\$?[\d,]+(?!\S)', head))
            cut = nums[-1].end() if nums else len('Line as printed: ')
        if cut is not None:
            out = out[:cut].rstrip() + ' [sponsor and contact not copied]'
    return CONTACT.sub('[contact not copied]', out)


def load_applications(L: Ledger) -> int:
    n = 0
    for a in read(APPLICATIONS)['applications']:
        if (a.get('year') or 0) < FIRST_YEAR:
            continue
        stage = APP_STAGE.get(a.get('outcome'))
        if a.get('award_only') or stage is None:
            continue  # the award itself comes from the ledger, with its own quote
        req = a.get('federal_credit_requested') or a.get('mihtc_credit_requested')
        L.add(a['name'], a.get('city'), a.get('county_fips'),
              ev(stage, a.get('year'), 'CHFA', f"Housing tax credit {a.get('credit_type')} application",
                 a.get('source_url'), strip_sponsor(a.get('quote')), req, 'annual credit requested',
                 round=a.get('round_label'), as_of=a.get('source_as_of'), _sponsors=sponsor_keys(a.get('sponsor')) or None),
              a.get('total_units'), a.get('restricted_units'),
              a['place_geoids'][0] if len(a.get('place_geoids') or []) == 1 else None,
              a.get('county_fips_all'))
        n += 1
    return n


def printed_units(quote: str | None, parsed: int | None, field: str) -> int | None:
    """The unit count the printed row shows. A row with a "Total Units: 50"
    field is read from it; otherwise the parsed count is kept only if the row
    prints it. The ledger's parser ran a 2017 report's units into the next
    column (Valley Sun Village "3933", printed "Total Units: 50")."""
    if not quote:
        return parsed
    m = re.search(rf'(?:^|; ){field}: ([\d,]+)(?:;|$)', quote)
    if m:
        return int(m.group(1).replace(',', '')) or None
    if parsed and not re.search(rf'(?<![\d,])({re.escape(format(parsed, ","))}|{parsed})(?![\d,])', quote):
        return None
    return parsed


def load_awards(L: Ledger) -> int:
    # Each ledger award has one printed row in award-rows.json under the same
    # key (file, amount, units, counter). The printed row's name and location
    # are used: the ledger's own name column runs into the sponsor column on
    # some reports ("Adams County Housing Authority N,S Crossing Pointe Phase I").
    by_key = {r['key']: r for r in read(AWARD_ROWS)['rows']}
    ledger = read(LEDGER)['awards']
    n = 0
    for a, key in zip(ledger, rows_mod.ledger_keys(ledger)):
        if (a.get('year') or 0) < FIRST_YEAR:
            continue
        row = by_key.get(key)
        quote = row['quote'] if row else None
        sponsor = (row or {}).get('sponsor')
        name = (row or {}).get('name') or a['name']
        location = (row or {}).get('location') or a.get('location')
        land = a['program'] == 'Prop 123 Land Banking'
        if a.get('amount_awarded'):
            amt, label = a['amount_awarded'], 'awarded'
        elif a.get('federal_credit'):
            amt, label = a['federal_credit'], 'annual federal credit'
        elif a.get('mihtc_credit'):
            amt, label = a['mihtc_credit'], 'annual middle-income credit'
        else:
            amt, label = a.get('amount_requested'), 'requested (award amount not printed)'
        basis = None
        if quote is None:  # award-rows has no printed row for it: list the parsed fields instead
            basis = 'fields as parsed from the award report; no printed row matched'
            quote = '; '.join(f'{k}: {v}' for k, v in (
                ('Name', name), ('Location', location), ('Total Units', a.get('total_units')),
                ('Amount', money(amt)), ('Year', a.get('year'))) if v)
        # a scattered site whose towns lie in several counties ("Trinidad,
        # Walsenburg, Fort Garland") belongs to each, as an application's does
        county, counties = a.get('county_fips'), None
        towns = {L.city_county.get(awards.norm(t)) for t in re.split(r',|&|\band\b', location or '') if t.strip()}
        if len(towns - {None}) > 1:
            county, counties = None, sorted(towns - {None})
        L.add(name, location, county,
              ev('land_funded' if land else 'funded', a.get('year'), a['agency'], a['program'],
                 a.get('source_url'), strip_sponsor(quote, sponsor), amt, label, quote_basis=basis,
                 state_credit=a.get('state_credit'), bond_amount=a.get('bond_amount'),
                 tenure=a.get('detail') if land else None,
                 _sponsors=sponsor_keys(sponsor or a.get('sponsor')) or None),
              printed_units(row and row['quote'], a.get('total_units'), 'Total Units'),
              printed_units(row and row['quote'], a.get('restricted_units'), r'(?:Total )?(?:LI|TC) Units'),
              counties=counties)
        n += 1
    return n


def load_round_2026(L: Ledger) -> int:
    d = read(ROUND_2026)
    meta = d['metadata']
    n = 0
    for a in d['awards']:
        fed = a.get('federal_9pct_credit') or a.get('federal_4pct_credit')
        quote = '; '.join(f'{k}: {v}' for k, v in (
            ('Name', a.get('name')), ('City', a.get('city')), ('Total Units', a.get('total_units')),
            ('Federal credit', money(fed)), ('State credit', money(a.get('state_credit')))) if v)
        L.add(a['name'], a.get('city'), a.get('county_fips'),
              ev('funded', 2026, 'CHFA', '2026 Round One housing tax credits', meta.get('pdf_report_url') or meta.get('source_url'),
                 quote, fed, 'annual federal credit', announced=meta.get('announcement_date'),
                 _supplement=True),
              a.get('total_units'))
        n += 1
    return n


MONTHS = ('January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
          'October', 'November', 'December')
TABLE_TITLE = re.compile(r'^(?P<page>[^:]+): (?P<month>[A-Z][a-z]+) (?P<year>\d{4}) Awards\b.*$')


def source_title(a: dict) -> str | None:
    """A page that prints one awards table per round is recorded with one
    table's heading, and some awards carry the heading of a table announced in
    another month. The heading is kept only when its month is the award's own;
    otherwise the title names the page and the award's month, so the ledger
    never points a reader at the wrong table."""
    title = a.get('source_title')
    m = TABLE_TITLE.match(title or '')
    ann = str(a.get('announced') or '')
    if not m or not re.fullmatch(r'\d{4}-\d{2}', ann):
        return title
    month = f"{MONTHS[int(ann[5:7]) - 1]} {ann[:4]}"
    if f"{m['month']} {m['year']}" == month:
        return title
    return f"{m['page']}: awards announced {month}"


def dola_town(a: dict, known: dict) -> str | None:
    """The town a DOLA record prints, unless the parser cut it from a street
    address: "th Avenue Denver" (from "...th Avenue") is a fragment, and its
    trailing "Denver" names the street's town. A town the project name ends
    with wins ("Navigation Campus - Aurora" is in Aurora); otherwise the
    fragment's trailing words are the town when they name a known one ("th Ave.
    Denver" is Denver, "th St. between Tuxedo and Pueblo Blvd. Pueblo" is
    Pueblo), else there is no town."""
    town = a.get('town')
    if not town or not re.match(r'(?:st|nd|rd|th)\b', town):
        return town
    m = re.search(r' - ([A-Za-z .]+)$', a.get('name') or '')
    if m and awards.norm(m[1]) in known:
        return m[1].strip()
    words = town.split()
    for k in (3, 2, 1):
        tail = ' '.join(words[-k:])
        if len(words) > k and awards.norm(tail) in known:
            return tail
    return None


def dola_quote(a: dict, town: str | None = None, beds: bool = False) -> str:
    """DOLA sources print the grantee or owner beside the project (a pipe row's
    second field, a board summary's prose), so the quote is rebuilt from the
    fields that name the project only."""
    return '; '.join(f'{k}: {v}' for k, v in (
        ('Project', a.get('name')), ('Town', town), ('Program', a.get('program_as_printed') or a.get('program')),
        ('Amount', money(a.get('amount'))), ('Amount basis', a.get('amount_basis')),
        ('Shelter beds' if beds else 'Homes', a.get('homes')),
        ('Announced', a.get('announced') or a.get('year')), ('Source', source_title(a))) if v)


BEDS = re.compile(r'Target indicator:[^.;]*\(Beds\)|\bshelter beds\b', re.I)


def load_dola(L: Ledger) -> int:
    n = 0
    for a in read(DOLA)['awards']:
        if not a.get('homes') and a.get('program') in NO_HOMES_MEANS_PROGRAM:
            L.programs_left_out += 1
            continue
        # the printed award (not copied out) says when a short name ("City of
        # Pueblo", "HomesFund") is a repair, buyer-assistance or opted-in-area
        # program rather than homes on a site
        printed = ' '.join(str(a.get(k) or '') for k in ('quote', 'grantee', 'program_as_printed'))
        if DOLA_PROGRAM_TEXT.search(printed):
            L.programs_left_out += 1
            continue
        label = 'awarded' if a.get('amount_basis') == 'awarded' else 'requested (award amount not printed)'
        # a count DOLA reports in shelter beds is not homes: Navigation Campus -
        # Aurora's 255 and Fort Collins Rescue Mission's 200 are beds
        beds = bool(BEDS.search(a.get('note') or ''))
        homes = None if beds else a.get('homes')
        town = dola_town(a, L.city_county)
        L.add(a['name'], town, a.get('county_fips'),
              ev('funded', a.get('year'), 'DOLA', a['program'], a.get('source_url'), dola_quote(a, town, beds),
                 a.get('amount'), label, announced=a.get('announced'),
                 quote_basis=('fields as recorded from the source; the printed text names the grantee, '
                              'so it is not copied'),
                 confirmed=a.get('confirmed'), source_title=source_title(a),
                 homes_unavailable_reason=None if homes else (
                     'the award counts shelter beds, not homes' if beds else 'the award does not print a home count'),
                 _sponsors=sponsor_keys(a.get('grantee')) or None),
              homes)
        n += 1
    return n


def load_feed(L: Ledger) -> int:
    d = read(LIHTC_FEED)
    n = 0
    for f in d['features']:
        p = f.get('properties') or {}
        yr = p.get('YR_ALLOC') or p.get('ReservationYear')
        if not yr or yr < FIRST_YEAR:
            continue
        status = p.get('ComplianceStatus')
        building = bool(status and 'construction' in status.lower())
        quote = '; '.join(f'{k}: {v}' for k, v in (
            ('PROJECT', p.get('PROJECT')), ('PROJ_ADD', p.get('PROJ_ADD')), ('PROJ_CTY', p.get('PROJ_CTY')),
            ('N_UNITS', p.get('N_UNITS')),
            ('LI_UNITS', p.get('LI_UNITS')), ('YR_ALLOC', p.get('YR_ALLOC')), ('CREDIT', p.get('CREDIT')),
            ('ComplianceStatus', status)) if v not in (None, ''))
        L.add(p.get('PROJECT') or p.get('ReportedName'), p.get('PROJ_CTY'), p.get('CNTY_FIPS'),
              ev('under_construction' if building else 'funded', yr, 'CHFA',
                 f"Housing tax credit property list ({p.get('CREDIT') or 'credit type not printed'})",
                 d.get('source') if isinstance(d.get('source'), str) and d['source'].startswith('http') else
                 'https://www.chfainfo.com/rental-housing/housing-credit',
                 quote, compliance_status=status),
              p.get('N_UNITS'), p.get('LI_UNITS'))
        n += 1
    return n


SPONSOR_NOISE = re.compile(r'\b(inc|llc|lllp|lp|ltd|corp|corporation|co|the)\b')


def sponsor_keys(sponsor: str | None) -> frozenset:
    """The organisations a sponsor or grantee field names, normalised: "1600
    Pearl LLC/Northeast Denver Housing Center" names "northeast denver housing
    center" (a single-asset LLC named for its address is not an identity).
    Used only to match; never published."""
    keys = set()
    for part in re.split(r'[/,;&]| and ', (sponsor or '').lower()):
        k = ' '.join(SPONSOR_NOISE.sub(' ', re.sub(r'[^a-z0-9 ]', ' ', part)).split())
        if len(k) > 3 and not k[0].isdigit():
            keys.add(k)
    return frozenset(keys)


def project_size(events: list[dict]) -> int | None:
    """The total the latest unit-printing source gives, or DOLA's homes count
    when nothing else prints one. DOLA counts the homes an award serves, which
    can be part of a project: St. Louis Landing is 129 homes, and DOLA's 35
    must not make it the separate 35-home Victoria Village Building D."""
    sized = [e for e in events if e.get('_units') and not e.get('_units_from_homes')] \
        or [e for e in events if e.get('_units')]
    # the count finish() publishes: the latest source's
    return max(sized, key=lambda e: (e.get('year') or 0, STAGES[e['stage']][0]))['_units'][0] if sized else None


def sponsor_joined(projects: list[dict]) -> list[dict]:
    """A renamed project with no shared address keeps its sponsor: "1600 Pearl
    St Apartments" (Prop 123 equity) and "Pearl Street Apartments" (DOLA) are
    both Northeast Denver Housing Center's 158 homes in Denver. Rows in one
    town and county with a shared sponsor, the same phase, the same size
    and awards no more than a year apart are one project. Copies."""
    out: list[dict] = []
    for src in projects:
        p = dict(src, events=list(src['events']))
        orgs = frozenset().union(*(e.get('_sponsors') or frozenset() for e in p['events']))
        size = project_size(p['events'])
        years = {e['year'] for e in p['events'] if e.get('year')}
        for q in out:
            # a row with no town (DOLA prints none for some awards) agrees on
            # the county alone, and only at a size within 15%: Rocky Mountain
            # Lake Apartments (DOLA, 125 requested) is the Coalition's 4745 N
            # Federal Blvd (109) in Denver
            other = project_size(q['events'])
            townless = not (q['_city_n'] and p['_city_n'])
            if orgs and p['county_fips'] and q['county_fips'] == p['county_fips'] \
                    and (q['_city_n'] == p['_city_n'] or townless) \
                    and orgs & frozenset().union(*(e.get('_sponsors') or frozenset() for e in q['events'])) \
                    and phase(q['_name_n']) == phase(p['_name_n']) \
                    and size is not None and other is not None \
                    and (size == other or (townless and abs(size - other) <= 0.15 * max(size, other))) \
                    and any(abs(a - b) <= 1 for a in years for b in (e['year'] for e in q['events'] if e.get('year'))):
                q['events'] += p['events']
                break
        else:
            out.append(p)
    return out


def printed_address(quote: str | None) -> str | None:
    """The house number and street a source prints ("Address: 1675 E. 35th
    Avenue"), with directions and street-type words dropped; None when the
    quote prints no street address."""
    m = re.search(r'(?:Address|PROJ_ADD): ([^;]+)', quote or '')
    if not m:
        return None
    # "12251 and 12253 East Cornell Avenue" is the building at 12251
    street = re.sub(r'^\s*(\d+)\s*(?:and|&|-)\s*\d+\b', r'\1', m[1], flags=re.I)
    words = [w for w in re.sub(r'[^a-z0-9 ]', ' ', street.lower()).split() if w not in ADDRESS_WORDS]
    return ' '.join(words) if len(words) > 1 and words[0].isdigit() else None


def resized_by_one_sponsor(a: list[dict], b: list[dict]) -> bool:
    """At one address, the same sponsor two years apart or less is one project
    even when it was resized: Nest on 10th (181 homes, not funded 2023) came
    back as Creekside Flats (150, funded 2024), both Archway's at 5375 W. 10th."""
    orgs = lambda evs: frozenset().union(*(e.get('_sponsors') or frozenset() for e in evs))
    years = lambda evs: [e['year'] for e in evs if e.get('year')]
    return bool(orgs(a) & orgs(b)) and any(abs(x - y) <= 2 for x in years(a) for y in years(b))


def address_joined(projects: list[dict]) -> list[dict]:
    """A project renamed between application and award keeps its address: Cole
    Flats and Cole Train are both 63 homes at 1675 E. 35th Avenue. Two rows in
    one county at one printed address, in the same phase and within 15% of each
    other's size or named by one sponsor within two years, are one project;
    Kappa Tower II and III at one address stay two. Copies; the ledger is
    unchanged."""
    out: list[dict] = []
    for src in projects:
        p = dict(src, events=list(src['events']))
        addrs = {a for a in (printed_address(e.get('quote')) for e in p['events']) if a}
        sizes = [e['_units'][0] for e in p['events'] if e.get('_units')]
        for q in out:
            if addrs and q['county_fips'] and q['county_fips'] == p['county_fips'] \
                    and addrs & {a for a in (printed_address(e.get('quote')) for e in q['events']) if a} \
                    and phase(q['_name_n']) == phase(p['_name_n']) and (any(
                        abs(k - u) <= 0.15 * max(k, u)
                        for k in (e['_units'][0] for e in q['events'] if e.get('_units')) for u in sizes)
                        or resized_by_one_sponsor(p['events'], q['events'])):
                q['events'] += p['events']
                break
        else:
            out.append(p)
    return out


def town_labels_joined(projects: list[dict]) -> list[dict]:
    """One name in one county printed under two town labels, with a unit count
    the two share, is one project: Aster Place is "Parachute" in its
    application and "Battlement Mesa" in its award. find() cannot always see
    this, because the 2023 application printed 40 units and the 58-unit award
    arrived before the 58-unit property row. Copies; the ledger is unchanged."""
    out: list[dict] = []
    for src in projects:
        p = dict(src, events=list(src['events']))
        sizes = [e['_units'][0] for e in p['events'] if e.get('_units')]
        for q in out:
            if q['county_fips'] and q['county_fips'] == p['county_fips'] and q['_name_n'] == p['_name_n'] \
                    and q['_city_n'] != p['_city_n'] and any(
                        abs(k - u) <= 0.15 * max(k, u)
                        for k in (e['_units'][0] for e in q['events'] if e.get('_units')) for u in sizes):
                q['events'] += p['events']
                if not q['place_geoid'] and p['place_geoid']:
                    # the town the place ID names, not a broader label ("Summit County")
                    q['place_geoid'], q['city'], q['_city_n'] = p['place_geoid'], p['city'], p['_city_n']
                break
        else:
            out.append(p)
    return out


def twin_award_units(events: list[dict]) -> tuple[int, int | None] | None:
    """Homes across the CHFA credit awards of the project's latest award year
    when there are two or more and every pair differs by more than 15%: those
    are separate buildings or components (Vina Senior's 4% 102 and 9% 50;
    Renaissance Legacy Lofts' 64 and 34 in one 2020 report). Two awards of
    about one size are one building financed twice (Sol's 132 and 130)."""
    awards = [e for e in events if e['agency'] == 'CHFA' and e['stage'] == 'funded'
              and re.match(r'LIHTC [49]%', e.get('program') or '') and e.get('_units')]
    if not awards:
        return None
    year = max(e.get('year') or 0 for e in awards)
    parts = [e['_units'] for e in awards if e.get('year') == year]
    if len(parts) < 2 or any(abs(a[0] - b[0]) <= 0.15 * max(a[0], b[0])
                             for i, a in enumerate(parts) for b in parts[i + 1:]):
        return None
    restricted = [r for _, r in parts]
    return sum(t for t, _ in parts), (sum(restricted) if None not in restricted else None)


def finish(L: Ledger) -> list[dict]:
    out = []
    joined = sponsor_joined(address_joined(town_labels_joined(L.projects)))
    kept = [p for p in joined if not any(e.get('_excluded') for e in p['events'])]
    L.left_out = sum(len(p['events']) for p in joined) - sum(len(p['events']) for p in kept)
    for src in kept:
        p = dict(src, events=[dict(e) for e in src['events']])  # finish() leaves the ledger as it was
        p['events'].sort(key=lambda e: (e.get('year') or 0, STAGES[e['stage']][0]))
        best = max(p['events'], key=lambda e: (STAGES[e['stage']][0], e.get('year') or 0))
        # a later application after a loss is the live state, not the loss
        last = p['events'][-1]
        stage = best['stage']
        if best['stage'] == 'not_funded' and last['stage'] in ('applied', 'letter_of_intent'):
            stage = last['stage']
        sized = [e for e in p['events'] if e.get('_units') and not e.get('_units_from_homes')] \
            or [e for e in p['events'] if e.get('_units')]  # DOLA's homes only when no other source prints units
        if sized:
            order = lambda e: (e.get('year') or 0, STAGES[e['stage']][0])
            p['total_units'], p['restricted_units'] = max(sized, key=order)['_units']
            # a later source that prints only a total (OEDIT) keeps the newest
            # restricted count another source printed, if it fits in that total
            if p['restricted_units'] is None:
                kept = [e for e in sized if e['_units'][1] is not None and e['_units'][1] <= p['total_units']]
                if kept:
                    p['restricted_units'] = max(kept, key=order)['_units'][1]
            # a twin deal's 4% and 9% awards are two buildings: Vina Senior's
            # 102 homes under 4% and 50 under 9% are 152, which the property
            # list printing the 4% half alone must not undercut. Two awards
            # within 15% of each other are one building financed twice (Sol).
            twin = twin_award_units(p['events'])
            if twin and twin[0] > p['total_units']:
                p['total_units'], p['restricted_units'] = twin
        # an unknown count is null with the reason, never 0
        p['total_units_unavailable_reason'] = None if p.get('total_units') is not None else \
            ('the only count a source prints is shelter beds, not homes'
             if any('shelter beds' in (e.get('homes_unavailable_reason') or '') for e in p['events'])
             else 'no source prints a home count for this project')
        p['restricted_units_unavailable_reason'] = None if p.get('restricted_units') is not None else (
            p['total_units_unavailable_reason'] if p.get('total_units') is None else
            'no source prints an income-restricted count; '
            + ' and '.join(sorted({e['agency'] for e in sized}))
            + (' prints' if len({e['agency'] for e in sized}) == 1 else ' print') + ' total homes only')
        # the ledger's name column sometimes carries the next column's text
        # ("Tungsten Village fka: Third Street Community Boulder County Housing
        # Authority"); the shortest name a source prints is the cleanest
        p['name'] = min((e['_name'] for e in p['events']), key=lambda n: (len(n), n))  # a tie: "Gateway" before "Geteway"
        for e in p['events']:
            e.pop('_units', None)
            e.pop('_units_from_homes', None)
            e.pop('_name', None)
            e.pop('_sponsors', None)
        years = [e['year'] for e in p['events'] if e.get('year')]
        p['county_fips_all'] = p.get('_counties') if not p['county_fips'] and len(p.get('_counties') or []) > 1 else None
        row = {k: v for k, v in p.items() if not k.startswith('_')}
        row.update({'stage': stage, 'first_year': min(years) if years else None,
                    'latest_year': max(years) if years else None})
        row['id'] = re.sub(r'[^a-z0-9]+', '-', f"{p['_name_n']} {p['county_fips'] or p['_city_n']}").strip('-')
        out.append(row)
    out.sort(key=lambda r: (-(r['latest_year'] or 0), r['county_fips'] or '', r['name']))
    seen: dict[str, int] = {}
    for r in out:  # ids are unique even when two projects normalise alike
        seen[r['id']] = seen.get(r['id'], 0) + 1
        if seen[r['id']] > 1:
            r['id'] += f"-{seen[r['id']]}"
    return [{k: r[k] for k in ('id', 'name', 'city', 'county_fips', 'county_fips_all', 'county', 'place_geoid', 'stage',
                               'first_year', 'latest_year', 'total_units', 'total_units_unavailable_reason', 'restricted_units',
                               'restricted_units_unavailable_reason', 'events')}
            for r in out]


def county_summary(projects: list[dict], county_names: dict[str, str], since: int) -> dict:
    """Projects and homes by county and stage. A project with no unit count
    adds to projects_without_homes, never 0 to homes; a group whose projects
    all lack a count has homes null. A scattered site in several counties
    counts in each of them and adds to that county's multi_county_projects,
    so county rows do not sum to a statewide total."""
    def bucket():
        return {'projects': 0, 'homes': 0, 'projects_without_homes': 0}
    out = {f: dict(name=n, **bucket(), multi_county_projects=0, by_stage={s: bucket() for s in STAGES})
           for f, n in sorted(county_names.items())}
    for p, f in ((p, f) for p in projects for f in (p.get('county_fips_all') or [p['county_fips']])):
        if f not in out or (p['latest_year'] or 0) < since:
            continue
        if p.get('county_fips_all'):
            out[f]['multi_county_projects'] += 1
        for b in (out[f], out[f]['by_stage'][p['stage']]):
            b['projects'] += 1
            if p['total_units']:
                b['homes'] += p['total_units']
            else:
                b['projects_without_homes'] += 1
    for c in out.values():
        for b in [c, *c['by_stage'].values()]:
            if b['projects'] and b['projects'] == b['projects_without_homes']:
                b['homes'] = None
    return out


def read_exclusions(path: str) -> set[str]:
    """The owner exclusion list. The ledger promises an excluded project is in
    no source, so a list that cannot be read stops the build instead of
    publishing everything (fail closed)."""
    try:
        entries = read(path)['excluded']
        hashes = {e['sha256'] for e in entries}
    except (OSError, KeyError, TypeError, ValueError) as err:
        raise SystemExit(f'cannot read the owner exclusion list {path}: {err!r}; not building') from err
    if not all(isinstance(h, str) and re.fullmatch(r'[0-9a-f]{64}', h) for h in hashes):
        raise SystemExit(f'the owner exclusion list {path} holds an entry that is not a sha256; not building')
    return hashes


def build() -> dict:
    geo = read(GEO_CONFIG)
    county_names = {c['geoid']: c['label'] for c in geo['counties']}
    excluded = read_exclusions(EXCLUDED)
    L = Ledger(excluded, apps_mod.load_places(), county_names)
    L.county_places = {}
    _, city_counties = awards.load_geo()
    L.city_county = {c: next(iter(f)) for c, f in city_counties.items() if len(f) == 1}
    L.city_counties = {c: set(f) for c, f in city_counties.items()}
    for pl in read(CROSS_COUNTY)['places'].values():  # towns in more than one county
        L.city_counties.setdefault(awards.norm(pl['name']), set()).update(c['fips'] for c in pl['all_counties'])
    for p in geo['places'] + geo['cdps']:
        L.county_places.setdefault(p['containingCounty'], set()).add(p['geoid'])
    # a town in several counties is a place in each of them (Aurora in Adams,
    # Westminster in Jefferson), not only in its containingCounty
    for geoid, pl in read(CROSS_COUNTY)['places'].items():
        for c in pl['all_counties']:
            L.county_places.setdefault(c['fips'], set()).add(geoid)
    counts = {
        'chfa_applications': load_applications(L),
        'award_ledger': load_awards(L),
        'chfa_2026_round_one': load_round_2026(L),
        'dola_awards': load_dola(L),
        'chfa_property_list': load_feed(L),
    }
    projects = finish(L)
    # Both stamps come from the inputs, never the clock, so a rebuild with
    # nothing new writes the same bytes (the derived chain commits on change).
    latest = max((p['latest_year'] or 0) for p in projects)
    since = latest - 3
    stamps = [read(APPLICATIONS)['meta'].get('generated_at'), read(LEDGER)['meta'].get('generated_at'),
              read(LIHTC_FEED).get('fetchedAt'), read(DOLA)['meta'].get('captured'),
              read(ROUND_2026)['metadata'].get('parsed_at'),
              # the geography that names counties and places and joins towns to them
              read(GEO_CONFIG).get('updated'), read(CROSS_COUNTY)['meta'].get('generated_at')]
    generated = max(str(x) for x in stamps if x)
    return {
        'meta': {
            'generated_at': generated,
            'generated_at_note': 'the newest of the input files\' own stamps, not the time this ran',
            'generator': 'scripts/market/build_development_activity.py',
            'title': 'Significant affordable-housing development activity in Colorado',
            'scope': (f'Every project a state agency recorded from {FIRST_YEAR} on: CHFA tax-credit applications and '
                      'awards, OEDIT Prop 123 awards (administered by CHFA), DOLA Division of Housing awards, and '
                      "CHFA's tax-credit property list. Market-rate projects are not here; no public "
                      'source lists them project by project.'),
            'stages': {k: v[1] for k, v in sorted(STAGES.items(), key=lambda kv: -kv[1][0])},
            'stage_rule': ("A project's stage is the furthest stage any source records for it. A loss followed by "
                           'a later application reads as applied. Nothing here says a project is built or open: '
                           "CHFA's property feed copies the allocation year into its placed-in-service field for "
                           'recent deals, so that field is not used.'),
            'join_rule': ('Events are one project when their names match after normalising (the rule '
                          'scripts/funding/build_lihtc_applications.py uses to match applications to awards) and '
                          'their counties agree. A project renamed between application and award is joined when '
                          'the two rows print the same street address (same county, same phase, sizes within 15% or the '
                          'same sponsor within two years), '
                          'or name the same sponsor in the same town with the same unit count and years no more '
                          'than one apart; otherwise it stays two rows. Sponsors are used to match only and are '
                          'never published.'),
            'amount_note': ('Amounts are as printed: tax credits are ANNUAL credit amounts; grants and loans are '
                            'dollars. amount_label says which. Never add credits to dollars.'),
            'public_safety': ('Sponsor, owner and contact fields are not copied, and quotes have them removed. '
                              'Projects on the owner exclusion list are left out by hash.'),
            'inputs': {
                'chfa_applications': 'data/jurisdiction-briefs/_lihtc-applications.json',
                'award_ledger': 'data/policy/funding-awards/ledger.json (+ award-rows.json quotes)',
                'chfa_2026_round_one': 'data/affordable-housing/chfa-awards/2026-round-one.json',
                'dola_awards': 'data/policy/funding-awards/dola-awards.json',
                'chfa_property_list': 'data/chfa-lihtc.json',
            },
            'events_read': counts,
            'excluded_events': L.left_out,
            'program_awards_left_out': L.programs_left_out,
            'round_one_2026_already_in_ledger': L.supplement_duplicates,
            'program_awards_note': ('Awards that fund a program rather than homes on a site (down payment '
                                    'assistance, rehabilitation and single-family repair programs, statewide '
                                    'NOFAs, lender capital, Prop 123 Modular Finance loans to factories, and Prop '
                                    '123 homeownership awards that print no homes) are counted here and not '
                                    'listed. A site award that prints no home count is listed with units null.'),
            'project_count': len(projects),
            'summary_since': since,
            'summary_note': (f'county_summary counts projects whose latest event is {since} or later (the latest '
                             f'year any source records, {latest}, less three), by stage, '
                             'with homes as printed (total units). homes counts only projects that print a unit '
                             'count; projects_without_homes says how many do not, and homes is null when none '
                             'does. Counties with no projects are listed with zeros. A scattered site an '
                             'application places in several counties (county_fips null, county_fips_all listed) '
                             'counts in each and in multi_county_projects, so county rows can sum to more than '
                             'statewide_recent_projects.'),
            'statewide_recent_projects': sum(1 for p in projects if (p['latest_year'] or 0) >= since
                                             and (p['county_fips'] or p['county_fips_all'])),
        },
        'county_summary': county_summary(projects, county_names, since),
        'projects': projects,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='build and compare with the file on disk; write nothing')
    args = ap.parse_args()
    out = build()
    if args.check:
        try:
            prior = read(OUT)
        except OSError:
            print(f'{os.path.relpath(OUT, ROOT)} does not exist', file=sys.stderr)
            return 1
        same = json.dumps(prior, sort_keys=True) == json.dumps(out, sort_keys=True)
        print('fresh' if same else 'stale: run python3 scripts/market/build_development_activity.py')
        return 0 if same else 1
    with open(OUT, 'w') as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)
        fh.write('\n')
    m = out['meta']
    print(f"{m['project_count']} projects from {sum(m['events_read'].values())} events; "
          f"{m['excluded_events']} excluded; wrote {os.path.relpath(OUT, ROOT)}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
