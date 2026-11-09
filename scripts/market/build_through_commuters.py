#!/usr/bin/env python3
"""Build data/market/through-commuters.json: who drives THROUGH each Colorado town to work.

A through-commuter for a town is a worker who lives outside it, works in a job
centre outside it, and whose drive between the two passes the town. Example:
people who live east of Bayfield and work in Durango drive past Bayfield on
US-160. LODES has no routes, so the route is modelled:

1. Workers: LEHD LODES 2024 origin-destination, primary jobs (JT01), so each
   worker counts once. Home and work are 2020 census blocks.
2. Job centres: every town or Census community with at least MIN_CENTER_JOBS
   primary jobs.
3. Roads: Census TIGER/Line all-roads files for the 64 counties, with a speed
   by road class (ROAD_MPH). One shortest-time search runs out from each job
   centre (its job-weighted centre), so every home has one modelled route to it.
4. Passing a town: the route touches a road point inside the town boundary
   (TIGER/Line places) or within PASS_METERS of it.

Left out on purpose, so the count is not inflated:
- Homes in the town itself or in the job centre, and trips under MIN_MILES or
  over MAX_MILES straight-line.
- Homes, job centres and towns in the five Front Range metro areas (METRO_CBSA).
  There nearly every trip crosses some suburb, so a through count means little.
- Towns are only credited when the route passes them; a town near the road but
  off it gets nothing.

The roads and LODES files are downloaded into --cache once.

Usage:
  python3 scripts/market/build_through_commuters.py --cache /path/to/cache
  python3 scripts/market/build_through_commuters.py --cache DIR --check-place 0805265
"""
import argparse
import array
import collections
import csv
import datetime
import gzip
import heapq
import json
import math
import os
import re
import struct
import sys
import urllib.error
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'data', 'market', 'through-commuters.json')

YEAR = 2024
TIGER_YEAR = 2025
LODES = 'https://lehd.ces.census.gov/data/lodes/LODES8/co/'
OD = f'od/co_od_main_JT01_{YEAR}.csv.gz'
XWALK = 'co_xwalk.csv.gz'
TIGER = f'https://www2.census.gov/geo/tiger/TIGER{TIGER_YEAR}/'
PLACES = f'PLACE/tl_{TIGER_YEAR}_08_place.zip'

MIN_CENTER_JOBS = 1000
MIN_MILES = 5.0
MAX_MILES = 75.0
PASS_METERS = 200.0
SAMPLE_METERS = 300.0  # below 2 x PASS_METERS; see Graph.add_line
MIN_SHOWN = 25          # a town's total under this is published as null (too small to read)
# Front Range metro areas (2023 CBSA codes in the LODES crosswalk).
METRO_CBSA = {
    '19740': 'Denver-Aurora-Centennial',
    '14500': 'Boulder',
    '17820': 'Colorado Springs',
    '22660': 'Fort Collins-Loveland',
    '24540': 'Greeley',
}
# Free-flow speed by TIGER MTFCC road class. Classes not listed are not driven.
ROAD_MPH = {
    'S1100': 65.0,   # primary road (interstate, limited access)
    'S1200': 50.0,   # secondary road (US and state highways)
    'S1400': 25.0,   # local road, county road
    'S1630': 35.0,   # ramp
    'S1640': 20.0,   # service drive
    'S1740': 15.0,   # private road for service vehicles
}
NO_PLACE = ('', '9999999', '99999')
# "Bayfield town" -> "Bayfield (town)", the form the other commute files use.
KIND = re.compile(r'^(.*) (city and county|city|town|CDP)$')
EARN = (('SE01', 'le_1250'), ('SE02', '1251_3333'), ('SE03', 'gt_3333'))
AGE = (('SA01', 'under_30'), ('SA02', '30_54'), ('SA03', '55_plus'))
M_PER_DEG_LAT = 111320.0


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def fetch(url, path):
    if os.path.exists(path):
        return path
    tmp = path + '.part'
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'COHO-Analytics data build'})
            with urllib.request.urlopen(req, timeout=180) as r, open(tmp, 'wb') as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
            os.replace(tmp, path)
            return path
        except (urllib.error.URLError, OSError) as e:
            log(f'{url}: {e}; retry {attempt + 1}')
    sys.exit(f'{url}: download failed; rerun, the cache keeps finished files')


def renter_shares():
    """Renter share of occupied homes per county, ACS 5-year DP04 as stored for the HNA pages."""
    out, vintage = {}, None
    folder = os.path.join(ROOT, 'data', 'hna', 'summary')
    for name in os.listdir(folder):
        if len(name) != 10 or not name.endswith('.json'):
            continue
        with open(os.path.join(folder, name), encoding='utf-8') as f:
            d = json.load(f)
        v = (d.get('acsProfile') or {}).get('DP04_0047PE')
        if isinstance(v, (int, float)):
            out[name[:5]] = v / 100.0
        vintage = vintage or (d.get('source') or {}).get('acs_profile_endpoint')
    return out, vintage


def miles(a, b):
    """Straight-line miles between (lon, lat) points."""
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dla, dlo = la2 - la1, math.radians(b[0] - a[0])
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


# ── Minimal shapefile reader (polyline and polygon records, dBASE attributes) ──

def read_dbf(data, fields):
    n, hlen, rlen = struct.unpack('<IHH', data[4:12])
    cols, off, pos = {}, 1, 32
    while data[pos] != 0x0D:
        name = data[pos:pos + 11].split(b'\0')[0].decode('ascii')
        size = data[pos + 16]
        cols[name] = (off, size)
        off += size
        pos += 32
    out = []
    for i in range(n):
        rec = data[hlen + i * rlen: hlen + (i + 1) * rlen]
        out.append({k: rec[cols[k][0]:cols[k][0] + cols[k][1]].decode('latin-1').strip() for k in fields})
    return out


def read_shp(data):
    """Yield the parts (lists of (lon, lat)) of each record, in file order."""
    pos = 100
    while pos < len(data):
        _, length = struct.unpack('>II', data[pos:pos + 8])
        body = data[pos + 8: pos + 8 + 2 * length]
        pos += 8 + 2 * length
        stype = struct.unpack('<i', body[:4])[0]
        if stype == 0:
            yield []
            continue
        nparts, npts = struct.unpack('<ii', body[36:44])
        starts = list(struct.unpack('<%di' % nparts, body[44:44 + 4 * nparts])) + [npts]
        pts = struct.unpack('<%dd' % (2 * npts), body[44 + 4 * nparts: 44 + 4 * nparts + 16 * npts])
        yield [[(pts[2 * j], pts[2 * j + 1]) for j in range(starts[p], starts[p + 1])] for p in range(nparts)]


def read_zip_shapefile(path, fields):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        shp = z.read(next(n for n in names if n.endswith('.shp')))
        dbf = z.read(next(n for n in names if n.endswith('.dbf')))
    return list(zip(read_shp(shp), read_dbf(dbf, fields)))


# ── Geometry helpers ──

def point_in_rings(x, y, rings):
    inside = False
    for ring in rings:
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                inside = not inside
            j = i
    return inside


def near_rings(x, y, rings, meters):
    """True when (x, y) lies within `meters` of a ring edge."""
    kx = M_PER_DEG_LAT * math.cos(math.radians(y))
    ky = M_PER_DEG_LAT
    lim = meters * meters
    for ring in rings:
        for i in range(len(ring) - 1):
            ax, ay = (ring[i][0] - x) * kx, (ring[i][1] - y) * ky
            bx, by = (ring[i + 1][0] - x) * kx, (ring[i + 1][1] - y) * ky
            dx, dy = bx - ax, by - ay
            L = dx * dx + dy * dy
            t = 0.0 if L == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / L))
            px, py = ax + t * dx, ay + t * dy
            if px * px + py * py <= lim:
                return True
    return False


# ── Road graph ──

class Graph:
    def __init__(self):
        self.index = {}
        self.x = array.array('d')
        self.y = array.array('d')
        self.adj = []

    def node(self, pt):
        key = (round(pt[0], 6), round(pt[1], 6))
        n = self.index.get(key)
        if n is None:
            n = len(self.x)
            self.index[key] = n
            self.x.append(key[0])
            self.y.append(key[1])
            self.adj.append([])
        return n

    def add_line(self, pts, mph):
        # Long segments get interior points every SAMPLE_METERS or less. A route that crosses a town's
        # boundary then has a node within SAMPLE_METERS / 2 of the crossing, inside the PASS_METERS
        # buffer, so the node test cannot miss a passage because TIGER stored few vertices.
        dense = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            k = int(math.ceil(miles(a, b) * 1609.344 / SAMPLE_METERS))
            for i in range(1, k):
                t = i / k
                dense.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            dense.append(b)
        prev = self.node(dense[0])
        for pt in dense[1:]:
            cur = self.node(pt)
            if cur == prev:
                continue
            mi = miles((self.x[prev], self.y[prev]), (self.x[cur], self.y[cur]))
            sec = mi / mph * 3600.0
            self.adj[prev].append((cur, sec, mi))
            self.adj[cur].append((prev, sec, mi))
            prev = cur


def build_graph(cache, counties):
    g = Graph()
    for fips in counties:
        rel = f'ROADS/tl_{TIGER_YEAR}_{fips}_roads.zip'
        path = fetch(TIGER + rel, os.path.join(cache, os.path.basename(rel)))
        for parts, attrs in read_zip_shapefile(path, ['MTFCC']):
            mph = ROAD_MPH.get(attrs['MTFCC'])
            if not mph:
                continue
            for p in parts:
                if len(p) > 1:
                    g.add_line(p, mph)
    log(f'roads: {len(g.x):,} nodes')
    return g


class Snapper:
    """Nearest road node to a point, on a 0.02-degree grid."""
    CELL = 0.02

    def __init__(self, g):
        self.g = g
        self.cells = collections.defaultdict(list)
        for n in range(len(g.x)):
            if g.adj[n]:
                self.cells[(int(g.x[n] // self.CELL), int(g.y[n] // self.CELL))].append(n)

    def nearest(self, x, y):
        cx, cy = int(x // self.CELL), int(y // self.CELL)
        best, bd = None, None
        for r in range(0, 6):
            for i in range(cx - r, cx + r + 1):
                for j in range(cy - r, cy + r + 1):
                    if r and max(abs(i - cx), abs(j - cy)) != r:
                        continue
                    for n in self.cells.get((i, j), ()):
                        d = ((self.g.x[n] - x) * 0.8) ** 2 + (self.g.y[n] - y) ** 2
                        if bd is None or d < bd:
                            best, bd = n, d
            if best is not None and r >= 1:
                return best
        return best


def shortest_tree(g, src, max_sec):
    """Shortest-time tree from src: parent, seconds and miles per reached node."""
    dist = {src: 0.0}
    dmi = {src: 0.0}
    parent = {src: -1}
    heap = [(0.0, src)]
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist[u] or d > max_sec:
            continue
        for v, sec, mi in g.adj[u]:
            nd = d + sec
            if nd < dist.get(v, 1e18):
                dist[v] = nd
                dmi[v] = dmi[u] + mi
                parent[v] = u
                heapq.heappush(heap, (nd, v))
    return parent, dist, dmi


# ── Build ──

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', required=True)
    ap.add_argument('--check-place', help='print one place and stop')
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)

    xpath = fetch(LODES + XWALK, os.path.join(args.cache, XWALK))
    odpath = fetch(LODES + OD, os.path.join(args.cache, os.path.basename(OD)))
    ppath = fetch(TIGER + PLACES, os.path.join(args.cache, os.path.basename(PLACES)))

    # Blocks: place, county, metro flag, point.
    blk = {}
    place_name, place_county = {}, {}
    counties, county_name = set(), {}
    with gzip.open(xpath, 'rt', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            plc = r['stplc'] if r['stplc'] not in NO_PLACE else ''
            blk[r['tabblk2020']] = (plc, r['cty'], r['cbsa'] in METRO_CBSA, float(r['blklondd']), float(r['blklatdd']))
            counties.add(r['cty'])
            county_name[r['cty']] = r['ctyname'].replace(', CO', '')
            if plc:
                place_name[plc] = KIND.sub(r'\1 (\2)', r['stplcname'].replace(', CO', ''))
                place_county.setdefault(plc, collections.Counter())[r['cty']] += 1
    log(f'blocks: {len(blk):,}; places: {len(place_name)}')

    # Flows by (home block, work place); job counts and job-weighted centres.
    flows = collections.defaultdict(lambda: collections.Counter())
    jobs = collections.Counter()
    wsum = collections.defaultdict(lambda: [0.0, 0.0, 0])
    with gzip.open(odpath, 'rt', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            w = blk.get(r['w_geocode'])
            h = blk.get(r['h_geocode'])
            if not w or not h or not w[0]:
                continue
            n = int(r['S000'])
            jobs[w[0]] += n
            s = wsum[w[0]]
            s[0] += w[3] * n
            s[1] += w[4] * n
            s[2] += n
            c = flows[(r['h_geocode'], w[0])]
            c['S000'] += n
            for k, _ in EARN + AGE:
                c[k] += int(r[k])
    metro_place = {}
    for b, v in blk.items():
        if v[0]:
            metro_place[v[0]] = metro_place.get(v[0], False) or v[2]
    # Job centres in the metro areas are left out too, as meta.metro_note says.
    centers = [p for p, n in jobs.items() if n >= MIN_CENTER_JOBS and not metro_place.get(p)]
    centers.sort(key=lambda p: -jobs[p])
    log(f'job centres: {len(centers)}')

    # Place boundaries, for towns outside the metro areas.
    shapes = {}
    for parts, attrs in read_zip_shapefile(ppath, ['GEOID']):
        if attrs['GEOID'] in place_name and not metro_place.get(attrs['GEOID']):
            shapes[attrs['GEOID']] = parts

    g = build_graph(args.cache, sorted(counties))
    snap = Snapper(g)

    # Road nodes that touch each town.
    deg = PASS_METERS / M_PER_DEG_LAT * 1.4
    node_places = collections.defaultdict(list)
    for geoid, rings in shapes.items():
        xs = [p[0] for r in rings for p in r]
        ys = [p[1] for r in rings for p in r]
        x0, x1, y0, y1 = min(xs) - deg, max(xs) + deg, min(ys) - deg, max(ys) + deg
        for i in range(int(x0 // Snapper.CELL), int(x1 // Snapper.CELL) + 1):
            for j in range(int(y0 // Snapper.CELL), int(y1 // Snapper.CELL) + 1):
                for n in snap.cells.get((i, j), ()):
                    x, y = g.x[n], g.y[n]
                    if x0 <= x <= x1 and y0 <= y <= y1 and (point_in_rings(x, y, rings) or near_rings(x, y, rings, PASS_METERS)):
                        node_places[n].append(geoid)
    log(f'towns with boundaries: {len(shapes)}; road points touching a town: {len(node_places):,}')

    # Home blocks to route, grouped by job centre.
    by_center = collections.defaultdict(list)
    for (hb, wp), c in flows.items():
        if wp not in jobs or jobs[wp] < MIN_CENTER_JOBS or metro_place.get(wp):
            continue
        h = blk[hb]
        if h[2] or h[0] == wp:
            continue
        by_center[wp].append((hb, c))

    snapped = {}
    through = collections.defaultdict(lambda: {
        'workers': 0, 'centers': collections.Counter(), 'counties': collections.Counter(),
        'earn': collections.Counter(), 'age': collections.Counter(), 'mi': 0.0, 'min': 0.0})
    for k, wp in enumerate(centers):
        homes = by_center.get(wp)
        if not homes:
            continue
        s = wsum[wp]
        cx, cy = s[0] / s[2], s[1] / s[2]
        src = snap.nearest(cx, cy)
        parent, dist, dmi = shortest_tree(g, src, max_sec=MAX_MILES / 25.0 * 3600.0)
        memo = {}

        def passed(n):
            """Towns on the path from n back to the centre, nearest first (memoised)."""
            chain = []
            while n != -1 and n not in memo:
                chain.append(n)
                n = parent.get(n, -1)
            acc = memo.get(n, frozenset()) if n != -1 else frozenset()
            for m in reversed(chain):
                here = node_places.get(m)
                if here:
                    acc = acc.union(here)
                memo[m] = acc
            return acc

        for hb, c in homes:
            h = blk[hb]
            d = miles((h[3], h[4]), (cx, cy))
            if d < MIN_MILES or d > MAX_MILES:
                continue
            n = snapped.get(hb)
            if n is None:
                n = snapped[hb] = snap.nearest(h[3], h[4])
            if n is None or n not in parent:
                continue
            for p in passed(n):
                if p == h[0] or p == wp:
                    continue
                t = through[p]
                w = c['S000']
                t['workers'] += w
                t['centers'][wp] += w
                t['counties'][h[1]] += w
                for f, key in EARN:
                    t['earn'][key] += c[f]
                for f, key in AGE:
                    t['age'][key] += c[f]
                t['mi'] += dmi[n] * w
                t['min'] += dist[n] / 60.0 * w
        if (k + 1) % 10 == 0:
            log(f'routed {k + 1}/{len(centers)} job centres')

    renter, acs_endpoint = renter_shares()
    places = {}
    for geoid in sorted(shapes):
        t = through.get(geoid)
        cf = place_county[geoid].most_common(1)[0][0]
        rec = {'name': place_name[geoid], 'county': county_name.get(cf, ''), 'county_fips': cf}
        if not t or t['workers'] < MIN_SHOWN:
            rec['through'] = None
            rec['under_min'] = bool(t)
        else:
            w = t['workers']
            rec.update({
                'through': w,
                'to': [[place_name[p], n] for p, n in t['centers'].most_common(5)],
                'from_counties': [[county_name.get(cf, cf), n] for cf, n in t['counties'].most_common(5)],
                'earnings': {k: t['earn'][k] for _, k in EARN},
                'age': {k: t['age'][k] for _, k in AGE},
                'avg_route_miles': round(t['mi'] / w, 1),
                # Renter share where they live now, weighted by home county.
                'renter_share_at_home': (round(sum(n * renter[cf] for cf, n in t['counties'].items() if cf in renter) /
                                               max(1, sum(n for cf, n in t['counties'].items() if cf in renter)), 3)
                                         if any(cf in renter for cf in t['counties']) else None),
                'avg_drive_minutes': round(t['min'] / w),
            })
        places[geoid] = rec

    if args.check_place:
        print(json.dumps(places.get(args.check_place), indent=1))
        return

    out = {
        'meta': {
            'generated': datetime.date.today().isoformat(),
            'generator': 'scripts/market/build_through_commuters.py',
            'lodes_year': YEAR,
            'source': LODES + OD,
            'crosswalk': LODES + XWALK,
            'roads': f'{TIGER}ROADS/ (TIGER/Line {TIGER_YEAR} all-roads, 64 counties)',
            'boundaries': TIGER + PLACES,
            'definition': ('Workers whose primary job is in a job centre (a town or Census community with at least '
                           f'{MIN_CENTER_JOBS:,} primary jobs) and whose modelled drive from home to that centre passes the town '
                           f'(a road point inside its boundary or within {int(PASS_METERS)} m). Homes in the town or the centre, '
                           f'and trips under {MIN_MILES:g} or over {MAX_MILES:g} straight-line miles, are left out.'),
            'route_model': ('Shortest free-flow time on TIGER/Line roads, speed by road class: '
                            + ', '.join(f'{k} {int(v)} mph' for k, v in ROAD_MPH.items())
                            + '. Times are free-flow, so real peak and winter drives run longer.'),
            'metro_excluded': sorted(METRO_CBSA.values()),
            'metro_note': ('Towns, homes and job centres in these five metro areas are not counted: nearly every trip there '
                           'crosses some suburb, so a through count would not mean anything.'),
            'min_shown': MIN_SHOWN,
            'renter_share_source': (f'{acs_endpoint} DP04_0047PE (renter-occupied share), home counties weighted by workers; '
                                    'read from data/hna/summary/<county>.json'),
            'use': ('A pool of workers who might move closer to their job, never demand by itself. A market study can add '
                    'part of it to demand only with comparable-property evidence of tenants moving in (CHFA 2027-28 QAP, '
                    'Market Study Guide, In-migration).'),
            'limits': ('LODES assigns some jobs to an employer\'s main office rather than the worksite, blurs home '
                       'locations for privacy, and is about two years old when published. Earnings bands are per job, '
                       'not household income.'),
        },
        'places': places,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1, sort_keys=False)
        f.write('\n')
    shown = sum(1 for p in places.values() if p.get('through'))
    log(f'wrote {OUT}: {len(places)} towns, {shown} with a through count')


if __name__ == '__main__':
    main()
