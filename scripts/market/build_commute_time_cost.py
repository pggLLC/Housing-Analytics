#!/usr/bin/env python3
"""
Commute time and drive cost for the Commuting and jobs page (paul, 17 Nov 2026:
"commute times would be better than distance... and the cost associated with
commuting and low paid jobs... causing economic stress").

For every town in data/market/commute-strength.json:

  work   how long people who WORK in the town travel to get there, one way:
         ACS 5-year table B08603 (Travel Time to Work for Workplace Geography).
  home   how long people who LIVE in the town travel to work, one way:
         ACS 5-year table B08303 (Travel Time to Work).
         Both: workers 16 and over who do not work from home, every way of getting
         there. Each band is [estimate, margin of error at 90%]. Bands are the
         table's own, grouped into five: under 15, 15-29, 30-44, 45-59, 60+ minutes
         (the margin of a group is the root of the sum of squares, the Census
         Bureau's approximation). A town the tables do not publish has no entry.
  from   for each home town in commute-strength.json's "from" list (the five that
         send the most workers): the drive to the town in minutes and road miles.
  to     the same for the "to" list (where residents work).
         Drives are routed by OSRM over OpenStreetMap (driving profile, no
         traffic), the router build_tract_drive_times.py uses. Each drive runs
         from where the home town's working residents live to where the work
         town's jobs are: for each Colorado town, the Census block nearest the
         job-weighted centre of its home blocks, or of its work blocks, in the
         same LODES file and year as the commute counts. A county in another
         state ("San Juan County, NM") starts at its 2020 centre of population,
         where its people live, not its land centre. A start or end more than a
         mile from a routable road is not routed.

Nothing here prices the drive: the page does that from the road miles at rates it
cites (AAA running cost, IRS full cost) so the rates sit beside their sources.

Output: data/market/commute-time-cost.json
Usage:  python3 scripts/market/build_commute_time_cost.py [--cache DIR] [--router-url URL] [--sleep 1.1]
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import time
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
COMMUTE = ROOT / 'data' / 'market' / 'commute-strength.json'
OUT = ROOT / 'data' / 'market' / 'commute-time-cost.json'

ACS_YEAR = 2024
ACS_LABEL = 'ACS 2020-2024 5-year'
ACS_URL = ('https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/'
           'acsdt5y2024-{t}.dat')
TABLES = {
    'work': ('b08603', 'B08603', 'Travel Time to Work for Workplace Geography'),
    'home': ('b08303', 'B08303', 'Travel Time to Work'),
}
# Table rows 002-013, grouped. Row 002 is under 5 minutes; 011 is 45 to 59; 012 60 to 89; 013 90 or more.
BANDS = [
    ('under_15', 'Under 15 minutes', (2, 3, 4)),
    ('15_29', '15 to 29 minutes', (5, 6, 7)),
    ('30_44', '30 to 44 minutes', (8, 9, 10)),
    ('45_59', '45 to 59 minutes', (11,)),
    ('60_plus', 'An hour or more', (12, 13)),
]
GAZ_PLACES = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip'
LODES_OD = 'https://lehd.ces.census.gov/data/lodes/LODES8/co/od/co_od_main_JT01_{y}.csv.gz'
LODES_XWALK = 'https://lehd.ces.census.gov/data/lodes/LODES8/co/co_xwalk.csv.gz'
# A start point more than this far from the nearest routable road is not trusted (metres).
MAX_SNAP_M = 1609
# A routed drive of 10 road miles or more averaging under 20 mph is not trusted either: in Colorado that means the
# router took a dirt or closed-road detour (OpenStreetMap had CO-145 near Placerville routing Norwood to Telluride,
# 33 miles, at 139 minutes). Such a drive is left out rather than shown.
SLOW_MILES, SLOW_MPH = 10, 20
CENPOP_COUNTY = 'https://www2.census.gov/geo/docs/reference/cenpop2020/county/CenPop2020_Mean_CO{st}.txt'
STATE_FIPS = {'AL': '01', 'AZ': '04', 'AR': '05', 'CA': '06', 'CO': '08', 'CT': '09', 'DE': '10', 'DC': '11', 'FL': '12',
              'GA': '13', 'HI': '15', 'ID': '16', 'IL': '17', 'IN': '18', 'IA': '19', 'KS': '20', 'KY': '21', 'LA': '22',
              'ME': '23', 'MD': '24', 'MA': '25', 'MI': '26', 'MN': '27', 'MS': '28', 'MO': '29', 'MT': '30', 'NE': '31',
              'NV': '32', 'NH': '33', 'NJ': '34', 'NM': '35', 'NY': '36', 'NC': '37', 'ND': '38', 'OH': '39', 'OK': '40',
              'OR': '41', 'PA': '42', 'RI': '44', 'SC': '45', 'SD': '46', 'TN': '47', 'TX': '48', 'UT': '49', 'VT': '50',
              'VA': '51', 'WA': '53', 'WV': '54', 'WI': '55', 'WY': '56'}
DEFAULT_ROUTER = 'https://router.project-osrm.org/table/v1/driving'
METERS_PER_MILE = 1609.344


def fetch(url: str, cache: Path, retries: int = 4) -> bytes:
    path = cache / url.rsplit('/', 1)[1]
    if path.exists():
        return path.read_bytes()
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'HousingAnalytics/1.0'})
            with urllib.request.urlopen(req, timeout=180) as resp:
                body = resp.read()
            path.write_bytes(body)
            return body
        except Exception as exc:  # pragma: no cover - live network failure path
            last = exc
            time.sleep(2 ** attempt)
    raise RuntimeError(f'could not fetch {url}: {last}')


def acs_rows(body: bytes, wanted: set[str]) -> dict:
    """GEO_ID 1600000US08xxxxx -> [E001, M001, E002, M002, ...] as numbers, Colorado places only."""
    out = {}
    lines = body.decode('utf-8').splitlines()
    head = lines[0].split('|')
    for line in lines[1:]:
        if not line.startswith('1600000US08'):
            continue
        cells = line.split('|')
        geoid = cells[0][-7:]
        if geoid in wanted:
            out[geoid] = dict(zip(head[1:], cells[1:]))
    return out


def as_int(v):
    try:
        n = int(float(v))
    except (TypeError, ValueError):
        return None
    return n if n >= 0 else None


def bands(row: dict, table: str):
    total = as_int(row.get(f'{table}_E001'))
    if not total:
        return None
    out = {'total': [total, as_int(row.get(f'{table}_M001'))], 'bands': []}
    for key, label, cols in BANDS:
        est = [as_int(row.get(f'{table}_E{c:03d}')) for c in cols]
        moe = [as_int(row.get(f'{table}_M{c:03d}')) for c in cols]
        if any(e is None for e in est):
            return None
        m = round(math.sqrt(sum((x or 0) ** 2 for x in moe))) if all(x is not None for x in moe) else None
        out['bands'].append([key, sum(est), m])
    if sum(b[1] for b in out['bands']) != total:
        raise ValueError(f'{table} bands do not add to the total')
    return out


LEHD_TYPES = ('city and county', 'city', 'town', 'CDP', 'village')


def lehd_name(gaz_name: str) -> str:
    """'Silverthorne town' -> 'Silverthorne (town)', the way the LEHD crosswalk names places."""
    for t in LEHD_TYPES:
        if gaz_name.endswith(' ' + t):
            return gaz_name[: -len(t) - 1] + ' (' + ('city' if t == 'city and county' else t) + ')'
    return gaz_name


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=str(ROOT / '.cache' / 'commute-time-cost'))
    ap.add_argument('--router-url', default=DEFAULT_ROUTER)
    ap.add_argument('--sleep', type=float, default=1.1)
    a = ap.parse_args()
    cache = Path(a.cache)
    cache.mkdir(parents=True, exist_ok=True)

    C = json.loads(COMMUTE.read_text())
    places = C['places']

    # ACS travel time, both tables.
    acs = {}
    for side, (fname, table, _) in TABLES.items():
        rows = acs_rows(fetch(ACS_URL.format(t=fname), cache), set(places))
        acs[side] = {g: bands(r, table) for g, r in rows.items()}

    # End points. A drive starts in the home town where its working residents live and ends in the work town where
    # its jobs are. Each is one real Census block from the LODES file and year the commute counts use: of the town's
    # home blocks (or work blocks), the one nearest their centre weighted by primary jobs. A weighted centre alone
    # can land on a lake or a mountainside between two halves of a town (Keystone CDP's Census internal point is up
    # a campground road), so the block nearest it is used instead. A town with no blocks in LODES uses its Census
    # Gazetteer internal point; a county in another state its 2020 centre of population.
    import gzip
    # Blocks by town, keyed by the town's Census place code, and each town under the name the commute file uses
    # (the ranking index's name, else the crosswalk's), as build_commute_strength.py labels them.
    ranking = {}
    rpath = ROOT / 'data' / 'hna' / 'ranking-index.json'
    if rpath.exists():
        for row in json.loads(rpath.read_text()).get('rankings', []):
            ranking[str(row.get('geoid'))] = row.get('name')
    blk, code_name = {}, {}
    with gzip.open(io.BytesIO(fetch(LODES_XWALK, cache)), 'rt', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            pc = r['stplc'].strip()
            if pc and pc not in ('9999999', '0899999') and not pc.endswith('99999'):
                code_name[pc] = ranking.get(pc) or r['stplcname'].replace(', CO', '')
                blk[r['tabblk2020']] = (pc, float(r['blklatdd']), float(r['blklondd']))
    side_blocks = {'home': {}, 'work': {}}
    with gzip.open(io.BytesIO(fetch(LODES_OD.format(y=C['meta']['lodes_year']), cache)), 'rt', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            n = int(r['S000'])
            for side, code in (('home', r['h_geocode']), ('work', r['w_geocode'])):
                b = blk.get(code)
                if b:
                    d = side_blocks[side].setdefault(b[0], {})
                    d[code] = d.get(code, 0) + n

    def medoid(blocks):
        tot = sum(blocks.values())
        la = sum(blk[c][1] * n for c, n in blocks.items()) / tot
        lo = sum(blk[c][2] * n for c, n in blocks.items()) / tot
        k = math.cos(math.radians(la))
        c = min(blocks, key=lambda c: (blk[c][1] - la) ** 2 + ((blk[c][2] - lo) * k) ** 2)
        return (blk[c][1], blk[c][2])
    ends = {side: {code_name[pc]: medoid(b) for pc, b in d.items() if b} for side, d in side_blocks.items()}
    homes = {k: v + ('residents',) for k, v in ends['home'].items()}
    jobs_at = {k: v + ('jobs',) for k, v in ends['work'].items()}
    gaz = {}
    with zipfile.ZipFile(io.BytesIO(fetch(GAZ_PLACES, cache))) as z:
        name = [n for n in z.namelist() if n.endswith('.txt')][0]
        with z.open(name) as raw:
            for r in csv.DictReader(io.TextIOWrapper(raw, encoding='utf-8'), delimiter='\t'):
                r = {k.strip(): v.strip() for k, v in r.items()}
                if r['USPS'] == 'CO':
                    gaz[lehd_name(r['NAME'])] = (float(r['INTPTLAT']), float(r['INTPTLONG']), 'gazetteer')
    def county_centre(label: str):
        county, st = label.rsplit(', ', 1)
        body = fetch(CENPOP_COUNTY.format(st=STATE_FIPS[st]), cache).decode('utf-8-sig')
        for r in csv.DictReader(io.StringIO(body)):
            r = {k.strip(): v.strip() for k, v in r.items()}
            if r['COUNAME'] + ' County' == county or r['COUNAME'] == county.replace(' County', '') or r['COUNAME'] == county:
                return (float(r['LATITUDE']), float(r['LONGITUDE']), 'population_centre')
        return None

    starts = {}
    missing = set()
    for p in places.values():
        for n, _ in p['from'] + p['to']:
            if n in starts or n in missing:
                continue
            if n in homes:
                starts[n] = homes[n]
            elif n in gaz:
                starts[n] = gaz[n]
            elif ', ' in n and n.rsplit(', ', 1)[1] in STATE_FIPS:
                pt = county_centre(n)
                if pt:
                    starts[n] = pt
                else:
                    missing.add(n)
            else:
                missing.add(n)

    # Drives: one OSRM table call per town, home towns as sources and the town as destination,
    # then the town as source and its residents' work towns as destinations.
    route_cache = cache / 'routes.json'
    routes = json.loads(route_cache.read_text()) if route_cache.exists() else {}
    def table(coords, sources, dests):
        key = json.dumps([coords, sources, dests])
        if key in routes and 'snap_src' in routes[key]:
            return routes[key]
        url = (a.router_url + '/' + ';'.join(f'{lon:.5f},{lat:.5f}' for lat, lon in coords) +
               '?sources=' + ';'.join(map(str, sources)) + '&destinations=' + ';'.join(map(str, dests)) +
               '&annotations=duration,distance')
        last = None
        for attempt in range(4):
            try:
                req = urllib.request.Request(url, headers={'User-Agent': 'HousingAnalytics/1.0'})
                with urllib.request.urlopen(req, timeout=120) as resp:
                    body = json.loads(resp.read().decode('utf-8'))
                if body.get('code') != 'Ok':
                    raise RuntimeError(body.get('code'))
                routes[key] = {'duration': body['durations'], 'distance': body['distances'],
                               'snap_src': [w.get('distance') for w in body['sources']],
                               'snap_dst': [w.get('distance') for w in body['destinations']]}
                route_cache.write_text(json.dumps(routes))
                time.sleep(a.sleep)
                return routes[key]
            except Exception as exc:  # pragma: no cover - live network failure path
                last = exc
                time.sleep(2 ** attempt + a.sleep)
        raise RuntimeError(f'router failed: {last}')

    def drive(rows, home, inbound):
        # Inbound: from each home town (where its residents live) to this town's jobs.
        # Outbound: from where this town's residents live to each work town's jobs.
        named = [(n, c, (starts.get(n) if inbound else (jobs_at.get(n) or starts.get(n)))) for n, c in rows]
        known = [x for x in named if x[2]]
        out = []
        if known:
            coords = [(x[2][0], x[2][1]) for x in known] + [home]
            k = len(known)
            if inbound:
                t = table(coords, list(range(k)), [k])
                cell = lambda i, f: t[f][i][0]
                snap = lambda i: max(t['snap_src'][i] or 0, t['snap_dst'][0] or 0)
            else:
                t = table(coords, [k], list(range(k)))
                cell = lambda i, f: t[f][0][i]
                snap = lambda i: max(t['snap_src'][0] or 0, t['snap_dst'][i] or 0)
        idx = {x[0]: i for i, x in enumerate(known)}
        for n, c, pt in named:
            if not pt:
                out.append([n, c, None, None, None, None])
                continue
            i = idx[n]
            sec, met = cell(i, 'duration'), cell(i, 'distance')
            if snap(i) > MAX_SNAP_M:
                far_snap.append([n, round(snap(i))])
                sec = met = None
            elif met is not None and sec and met / METERS_PER_MILE >= SLOW_MILES and (met / METERS_PER_MILE) / (sec / 3600) < SLOW_MPH:
                too_slow.append([cur[0], n, round(sec / 60, 1), round(met / METERS_PER_MILE, 1)])
                sec = met = None
            out.append([n, c, None if sec is None else round(sec / 60, 1), None if met is None else round(met / METERS_PER_MILE, 1), round(pt[0], 4), round(pt[1], 4)])
        return out

    far_snap, too_slow, cur = [], [], ['']
    result = {}
    for geoid, p in sorted(places.items()):
        name = p['name']
        cur[0] = name
        job_end = jobs_at.get(name, (p['lat'], p['lon']))[:2]
        home_end = homes.get(name, (p['lat'], p['lon']))[:2]
        result[geoid] = {
            'work': acs['work'].get(geoid),
            'home': acs['home'].get(geoid),
            'from': drive(p['from'], job_end, True),
            'to': drive(p['to'], home_end, False),
            'jobs_at': [round(job_end[0], 4), round(job_end[1], 4)],
            'homes_at': [round(home_end[0], 4), round(home_end[1], 4)],
        }

    payload = {
        'meta': {
            'generated': date.today().isoformat(),
            'generator': 'scripts/market/build_commute_time_cost.py',
            'commute_file': 'data/market/commute-strength.json',
            'commute_generated': C['meta']['generated'],
            'lodes_year': C['meta']['lodes_year'],
            'acs': {
                'label': ACS_LABEL, 'year': ACS_YEAR,
                'work': {'table': 'B08603', 'title': TABLES['work'][2], 'url': ACS_URL.format(t='b08603')},
                'home': {'table': 'B08303', 'title': TABLES['home'][2], 'url': ACS_URL.format(t='b08303')},
                'universe': 'Workers 16 years and over who did not work from home; every means of transportation; one way.',
                'bands': [[k, label] for k, label, _ in BANDS],
                'moe': '90% margin of error; a grouped band\'s margin is the root of the sum of squared margins (Census Bureau approximation).',
            },
            'router': {
                'engine': 'OSRM Table API', 'profile': 'driving', 'source_url': a.router_url,
                'units': 'minutes and road miles to one decimal, free-flow driving (no traffic)',
                'odbl_notice': 'Contains information from OpenStreetMap and OpenStreetMap Foundation, made available under the Open Database License.',
                'osm_copyright_url': 'https://www.openstreetmap.org/copyright',
            },
            'start_points': {
                'colorado': 'a home town starts at the Census block nearest the job-weighted centre of its home blocks, and a work town ends at the block nearest the centre of its work blocks: LODES ' + str(C['meta']['lodes_year']) + ' (' + LODES_OD.format(y=C['meta']['lodes_year']) + ', block points from ' + LODES_XWALK + '); a town with no blocks uses its Census Gazetteer internal point (' + GAZ_PLACES + ')',
                'other_states': CENPOP_COUNTY.format(st='{state fips}'),
                'town_ends': 'each town\'s own ends are in jobs_at and homes_at',
            },
            'unrouted': sorted(missing),
            'not_routed_far_from_road': far_snap,
            'not_shown_too_slow': too_slow,
            'slow_rule': f'drives of {SLOW_MILES}+ road miles averaging under {SLOW_MPH} mph are left out',
            'start_kinds': {k: sum(1 for v in starts.values() if v[2] == k) for k in ('residents', 'gazetteer', 'population_centre')},
            'places_with_acs_work': sum(1 for v in result.values() if v['work']),
            'places_with_acs_home': sum(1 for v in result.values() if v['home']),
        },
        'places': result,
    }
    OUT.write_text(json.dumps(payload, separators=(',', ':')) + '\n')
    print(f"{len(result)} towns; ACS work {payload['meta']['places_with_acs_work']}, home {payload['meta']['places_with_acs_home']}; unrouted {len(missing)}")


if __name__ == '__main__':
    main()
