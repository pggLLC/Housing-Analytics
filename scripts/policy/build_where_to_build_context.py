#!/usr/bin/env python3
"""Build data/policy/where-to-build-context.json for the gated "Where to build" page.

Two inputs the page cannot read from any other file:

1. County vote results from the Colorado Secretary of State's official results.
   - Proposition 123 (2022 general), from the 2022 abstract's "Amendments and
     Propositions" page (HTML table, one row per county).
   - Presidential electors (2024 general), from the 2024 Biennial Abstract PDF,
     page 103 (read with pdftotext -layout).
   Each county row keeps the source line it was read from, as printed.

2. Parks near each town and community, and inside each county, counted from the
   OpenStreetMap park points already on the site (data/amenities/parks_co.geojson):
   parks within PARK_RADIUS_MILES of the Census Gazetteer centroid
   (data/co-place-centroids.json), or inside the county line
   (data/co-county-boundaries.json).

Usage:
  python3 scripts/policy/build_where_to_build_context.py --fetch   # read SOS, rewrite the file
  python3 scripts/policy/build_where_to_build_context.py           # recount parks, keep saved votes
  python3 scripts/policy/build_where_to_build_context.py --check   # fail if the file is out of date
"""
import argparse
import html
import json
import math
import os
import re
import subprocess
import sys
import tempfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'data', 'policy', 'where-to-build-context.json')
PARK_RADIUS_MILES = 5.0

PROP123_URL = 'https://www.sos.state.co.us/pubs/elections/Results/Abstract/2022/general/amendProp.html'
PRES_URL = 'https://www.sos.state.co.us/pubs/elections/Results/2024/2024BiennialAbstract.pdf'
ARCHIVE_URL = 'https://www.sos.state.co.us/pubs/elections/Results/Archives.html'

NUM = r'([\d,]+)'


def _int(s):
    return int(s.replace(',', ''))


def _load(rel):
    with open(os.path.join(ROOT, rel), encoding='utf-8') as f:
        return json.load(f)


def county_fips_by_name():
    out = {}
    for c in _load('data/hna/geo-config.json')['counties']:
        out[c['label'].replace(' County', '').strip().lower()] = c['geoid']
    return out


def _get(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (COHO Analytics data build)'})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def parse_prop123(page_html, fips):
    """{fips: {...}} and the statewide total row, from the 2022 abstract table."""
    text = re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', ' ', page_html)))
    start = text.find('Proposition 123 (Statutory)')
    if start < 0:
        raise SystemExit('Proposition 123 table not found on the SOS page')
    head = text.find('Turnout %', start)
    end = text.find('Total ', head)
    total = re.match(r'Total ' + ' '.join([NUM] * 5) + r' ([\d.]+)%', text[end:])
    body = text[start:end]
    rows = {}
    names = sorted(fips, key=len, reverse=True)
    pat = re.compile(r'(' + '|'.join(re.escape(n.title()) for n in names) + r') ' + ' '.join([NUM] * 5) + r' ([\d.]+)%')
    for m in pat.finditer(body):
        name = m.group(1)
        reg, cast, yes, no, tot = (_int(m.group(i)) for i in range(2, 7))
        rows[fips[name.lower()]] = {
            'county': name, 'yes': yes, 'no': no,
            'yes_share': round(yes / (yes + no), 4),
            'source_line': m.group(0),
        }
    statewide = None
    if total:
        reg, cast, yes, no, tot = (_int(total.group(i)) for i in range(1, 6))
        statewide = {'yes': yes, 'no': no, 'yes_share': round(yes / (yes + no), 4), 'source_line': total.group(0)}
    return rows, statewide


def parse_president(layout_text, fips):
    """{fips: {...}} and the total row, from page 103 of the 2024 Biennial Abstract."""
    i = layout_text.find('General Election Results - November 5, 2024', 0)
    # The general-election presidential table is the first "Presidential Electors"
    # heading after the general-election results start.
    start = layout_text.find('Presidential Electors', i)
    end = layout_text.find('Presidential Electors (continued)', start)
    block = layout_text[start:end]
    rows, statewide = {}, None
    for line in block.splitlines():
        m = re.match(r'^([A-Z][A-Za-z ]+?)\s{2,}' + r'\s+'.join([NUM] * 4), line.strip())
        if not m:
            continue
        name = m.group(1).strip()
        reg, cast, harris, trump = (_int(m.group(i)) for i in range(2, 6))
        rec = {'harris': harris, 'trump': trump,
               'two_party_harris_share': round(harris / (harris + trump), 4),
               'source_line': re.sub(r'\s+', ' ', line.strip())}
        if name == 'Total':
            statewide = rec
        elif name.lower() in fips:
            rec['county'] = name
            rows[fips[name.lower()]] = rec
    return rows, statewide


def fetch_votes():
    fips = county_fips_by_name()
    p123, p123_total = parse_prop123(_get(PROP123_URL).decode('utf-8', 'replace'), fips)
    with tempfile.TemporaryDirectory() as d:
        pdf = os.path.join(d, 'abstract.pdf')
        with open(pdf, 'wb') as f:
            f.write(_get(PRES_URL))
        txt = subprocess.run(['pdftotext', '-layout', pdf, '-'], check=True, capture_output=True, text=True).stdout
    pres, pres_total = parse_president(txt, fips)
    if len(p123) != 64 or len(pres) != 64:
        raise SystemExit(f'expected 64 counties, got Prop 123 {len(p123)}, president {len(pres)}')
    if sum(r['yes'] for r in p123.values()) != p123_total['yes'] or sum(r['harris'] for r in pres.values()) != pres_total['harris']:
        raise SystemExit('county rows do not add up to the printed totals')
    return p123, p123_total, pres, pres_total


def miles(lat1, lon1, lat2, lon2):
    r = 3958.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _in_geom(x, y, geom):
    polys = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
    for poly in polys:
        if _in_ring(x, y, poly[0]) and not any(_in_ring(x, y, h) for h in poly[1:]):
            return True
    return False


def count_parks():
    parks = [f['geometry']['coordinates'] for f in _load('data/amenities/parks_co.geojson')['features']
             if f.get('geometry') and f['geometry']['type'] == 'Point']
    places = {}
    for geoid, c in _load('data/co-place-centroids.json')['byGeoid'].items():
        places[geoid] = sum(1 for lon, lat in parks if miles(c['lat'], c['lng'], lat, lon) <= PARK_RADIUS_MILES)
    counties = {}
    for f in _load('data/co-county-boundaries.json')['features']:
        counties[f['properties']['GEOID']] = sum(1 for lon, lat in parks if _in_geom(lon, lat, f['geometry']))
    return dict(sorted(places.items())), dict(sorted(counties.items()))


def build(prev, fetch):
    if fetch:
        p123, p123_total, pres, pres_total = fetch_votes()
        import datetime
        retrieved = datetime.date.today().isoformat()
    else:
        if not prev:
            raise SystemExit('no saved votes; run with --fetch')
        v = prev['votes']
        p123, p123_total = v['prop123_2022']['counties'], v['prop123_2022']['statewide']
        pres, pres_total = v['president_2024']['counties'], v['president_2024']['statewide']
        retrieved = prev['meta']['votes_retrieved']
    park_places, park_counties = count_parks()
    parks_meta = _load('data/amenities/parks_co.geojson').get('meta', {})
    return {
        'meta': {
            'title': 'Where to build: county vote results and parks nearby',
            'generator': 'scripts/policy/build_where_to_build_context.py',
            'votes_retrieved': retrieved,
            'votes_note': 'Official certified results from the Colorado Secretary of State. County level only: every town in a county shows its county\'s result.',
            'parks_note': (f'OpenStreetMap park and playground points (data/amenities/parks_co.geojson, generated {parks_meta.get("generated", "unknown")}). '
                           f'Towns and communities: points within {PARK_RADIUS_MILES:g} miles of the Census Gazetteer centroid. Counties: points inside the county line. '
                           'City parks only: trails, trailheads and public lands are not in this count.'),
            'park_radius_miles': PARK_RADIUS_MILES,
        },
        'votes': {
            'prop123_2022': {
                'label': 'Proposition 123 (2022 general election)',
                'source_url': PROP123_URL, 'archive_url': ARCHIVE_URL,
                'statewide': p123_total, 'counties': p123,
            },
            'president_2024': {
                'label': 'Presidential electors (2024 general election)',
                'source_url': PRES_URL, 'source_page': 103, 'archive_url': ARCHIVE_URL,
                'statewide': pres_total, 'counties': pres,
            },
        },
        'parks': {'places': park_places, 'counties': park_counties},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fetch', action='store_true')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    prev = None
    if os.path.exists(OUT):
        with open(OUT, encoding='utf-8') as f:
            prev = json.load(f)
    out = build(prev, a.fetch)
    text = json.dumps(out, indent=1, ensure_ascii=False) + '\n'
    if a.check:
        with open(OUT, encoding='utf-8') as f:
            if f.read() != text:
                sys.exit('where-to-build-context.json is out of date: run scripts/policy/build_where_to_build_context.py')
        print('where-to-build-context: up to date')
        return
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(text)
    print(f'wrote {os.path.relpath(OUT, ROOT)}: {len(out["votes"]["prop123_2022"]["counties"])} counties, {len(out["parks"]["places"])} places')


if __name__ == '__main__':
    main()
