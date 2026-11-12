"""Property tax exemption routes and assessor track records (data/policy/tax-exemption-routes.json).

Rules, the same as the local incentive data:
  - every route rests on statute text quoted in meta.statutes;
  - every assessor history item quotes the record line it rests on, links
    the assessor, and carries its check date;
  - an exempt share is stated only if the quoted record or its own label
    shows it, and a share that the quote prints must match;
  - a county that was not read says not_researched, never an empty "none";
  - no named people or phone numbers: those stay on the member site.
"""

import json
import re
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / 'data' / 'policy' / 'tax-exemption-routes.json'
GEO = ROOT / 'data' / 'hna' / 'geo-config.json'

ROUTES = {'ownership', 'ground_lease', 'master_lease', 'gp_member'}
STATUS = {'researched', 'checked_none_found', 'not_researched'}
OUTCOMES = {'granted', 'denied', 'pilot', 'appealed'}
LEVELS = {'county', 'place'}


def load():
    return json.loads(DATA.read_text())


def geo():
    g = json.loads(GEO.read_text())
    out = {}
    for row in g.get('counties', []):
        out[row['geoid']] = row['geoid']
    for key in ('places', 'cdps'):
        for row in g.get(key, []):
            out[row['geoid']] = row.get('containingCounty')
    return out


def https(url):
    u = urlparse(url or '')
    return u.scheme == 'https' and bool(u.netloc)


def test_file_is_well_formed():
    d = load()
    assert d['schema'] == 'tax-exemption-routes/v1'
    meta = d['meta']
    as_of = date.fromisoformat(meta['as_of'])
    assert meta.get('method') and meta.get('known_gaps') and meta.get('rule')
    statutes = {s['id']: s for s in meta['statutes']}
    for s in statutes.values():
        assert https(s['source']['url']) and len(s['quote']) >= 20, s['id']
    counties = geo()
    seen = set()
    for e in d['entries']:
        g = e['geoid']
        assert g not in seen, f'{g} listed twice'
        seen.add(g)
        assert g in counties, f'{g} is not in geo-config'
        assert e['level'] in LEVELS, g
        assert e['county_geoid'] == (g if e['level'] == 'county' else counties[g]), f'{g}: wrong county_geoid'
        assert date.fromisoformat(e['checked']) <= as_of < date.fromisoformat(e['review_by']), g
        for r in e['ha_routes']:
            assert r['route'] in ROUTES, g
            assert r['statute_ids'] and set(r['statute_ids']) <= set(statutes), f'{g}: route without its quoted statute'
        if e['level'] == 'county':
            a = e['assessor']
            assert a['status'] in STATUS and https(a['url']) and a['office'], g
            if a['status'] == 'researched':
                assert a['history'], f'{g}: researched but no history'
        else:
            assert e['assessor'] is None, f'{g}: a place uses its county assessor record'
            assert e['county_geoid'] in seen or any(x['geoid'] == e['county_geoid'] for x in d['entries']), \
                f'{g}: its county has no entry to inherit from'
        assert https(e['nonprofit_exemption']['url']), g


def history_items(d):
    for e in d['entries']:
        a = e.get('assessor') or {}
        for h in a.get('history', []):
            yield e['geoid'], h
        for r in e['ha_routes']:
            for h in r.get('precedents', []):
                yield e['geoid'], h


def test_every_history_item_quotes_its_record():
    d = load()
    as_of = date.fromisoformat(d['meta']['as_of'])
    checked = 0
    for g, h in history_items(d):
        checked += 1
        assert h['outcome'] in OUTCOMES, g
        assert https(h['source_url']) and len(h['quote']) >= 12, f"{g} {h['account']}"
        assert date.fromisoformat(h['checked']) <= as_of, g
        assert h['pilot_terms'] is None or h['outcome'] == 'pilot', g
        share = h.get('exempt_share')
        printed = re.findall(r'\d+(?:\.\d+)?%', h['quote'])
        if printed:
            assert share in printed, f"{g} {h['account']}: share {share} is not the one the record prints"
        elif share not in (None, '100%'):
            raise AssertionError(f"{g} {h['account']}: a partial share must be printed in the quote")
    assert checked >= 5, 'history scan is vacuous'


def test_no_named_people_in_the_public_file():
    text = DATA.read_text()
    assert not re.search(r'\b\d{3}[-.)\s]\s?\d{3}-\d{4}\b', text), 'phone numbers belong on the member site'
    for e in load()['entries']:
        assert 'contacts' not in e and 'contact' not in e, e['geoid']
