#!/usr/bin/env python3
"""
Build walking and biking access by route for every Colorado home block.

For each 2020 Census block with homes, this measures the distance by street
and trail (not straight line) to the nearest everyday service, and counts the
jobs reachable in a 15-minute walk or ride. Results roll up, weighted by homes,
to 2010 block groups (the EPA Smart Location Database geography the site
already maps), towns and counties.

Network, all public:
  - Streets: Census TIGER/Line 2025 All Roads, every Colorado county.
    Interstates (MTFCC S1100) and ramps (S1630) are left out for walking and
    biking.
  - Trails: Colorado Parks and Wildlife, Colorado Trail Explorer (COTREX),
    "COTREX Trails Sept Update" feature service. Only segments typed Trail or
    Interpretive Trail are added (COTREX also carries roads, which TIGER
    already has). Walking uses segments not marked hiking = no; biking uses
    segments marked bike = yes or a seasonal window. Unknown bike access is
    left out of the biking network.
Origins and destinations:
  - Homes: TIGER 2020 tabulation blocks, HOUSING20 (2020 Census housing units).
  - Jobs: LEHD LODES 8 workplace area characteristics, 2023, all jobs (C000).
  - Services: the site's own files in data/amenities/ and data/market/
    (OpenStreetMap grocery, schools, health care and parks; HRSA health
    centers; CDOT statewide fixed-route transit stops).

Speeds: walking 3 mph (10 minutes = 805 m), biking 10 mph (15 minutes =
4,023 m). Hills, sidewalks, bike lanes and crossings are not modelled.

Usage:
  pip install shapely scipy pyshp numpy
  python3 scripts/market/build_walk_bike_access.py --cache /path/to/cache

The cache folder holds the downloads (about 400 MB) and is never committed.
Outputs:
  data/market/walk_bike_access_co.json   ratings by town, county, block group
  data/market/walk_bike_map_co.json      per-town map layers (services, trails)
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import math
import sys
import time
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import shapefile  # pyshp
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree
from shapely.geometry import LineString, Point, shape
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parent.parent.parent
OUT = ROOT / 'data' / 'market' / 'walk_bike_access_co.json'
OUT_MAP = ROOT / 'data' / 'market' / 'walk_bike_map_co.json'

TIGER_ROADS_DIR = 'https://www2.census.gov/geo/tiger/TIGER2025/ROADS/'
TIGER_BLOCKS = 'https://www2.census.gov/geo/tiger/TIGER2020/TABBLOCK20/tl_2020_08_tabblock20.zip'
LODES_WAC = 'https://lehd.ces.census.gov/data/lodes/LODES8/co/wac/co_wac_S000_JT00_2023.csv.gz'
LODES_XWALK = 'https://lehd.ces.census.gov/data/lodes/LODES8/co/co_xwalk.csv.gz'
COTREX = ('https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/ArcGIS/rest/services/'
          'COTREX_Trails_Sept_Update/FeatureServer/0')
COTREX_PAGE = 'https://trails.colorado.gov/'

WALK_10 = 805.0      # 10 minutes at 3 mph
WALK_15 = 1207.0     # 15 minutes at 3 mph
BIKE_15 = 4023.0     # 15 minutes at 10 mph
SNAP_MAX = 400.0     # a home or service farther than this from any street or trail is off the network
TRAIL_LINK = 30.0    # a trail end this close to a street joins it
SERVICES = ['grocery', 'school', 'health', 'park', 'transit']
EVERYDAY = ['grocery', 'school', 'health', 'park']
BANDS = ['Strong', 'Fair', 'Limited', 'Very limited']


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def fetch(url, dest: Path):
    if dest.exists() and dest.stat().st_size > 0:
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    log('download', url)
    req = urllib.request.Request(url, headers={'User-Agent': 'coho-walk-bike-build'})
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, 'wb') as fh:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            fh.write(b)
    return dest


def hav(lon1, lat1, lon2, lat2):
    r = 6371008.8
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = p2 - p1, np.radians(lon2 - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * r * np.arcsin(np.sqrt(a))


# Metres on a plane centred on Colorado; used only to find nearest points.
KX = 111320.0 * math.cos(math.radians(39.0))
KY = 110540.0


def proj(lon, lat):
    return np.column_stack([np.asarray(lon) * KX, np.asarray(lat) * KY])


class Net:
    """Nodes keyed by coordinates rounded to 1e-6 degrees; undirected edges."""

    def __init__(self):
        self.idx = {}
        self.lon = []
        self.lat = []
        self.a = []
        self.b = []
        self.kind = []  # 0 street, 1 walk-only trail, 2 walk+bike trail, 3 link, 4 bike-only trail

    def node(self, lon, lat):
        k = (round(lon, 6), round(lat, 6))
        i = self.idx.get(k)
        if i is None:
            i = len(self.lon)
            self.idx[k] = i
            self.lon.append(k[0])
            self.lat.append(k[1])
        return i

    def line(self, coords, kind):
        prev = None
        for c in coords:
            i = self.node(c[0], c[1])
            if prev is not None and prev != i:
                self.a.append(prev)
                self.b.append(i)
                self.kind.append(kind)
            prev = i
        return prev

    def finish(self):
        self.lon = np.array(self.lon)
        self.lat = np.array(self.lat)
        self.a = np.array(self.a, dtype=np.int64)
        self.b = np.array(self.b, dtype=np.int64)
        self.kind = np.array(self.kind, dtype=np.int8)
        self.w = hav(self.lon[self.a], self.lat[self.a], self.lon[self.b], self.lat[self.b])

    def graph(self, kinds):
        m = np.isin(self.kind, kinds)
        n = len(self.lon)
        a, b, w = self.a[m], self.b[m], self.w[m]
        g = coo_matrix((np.concatenate([w, w]), (np.concatenate([a, b]), np.concatenate([b, a]))), shape=(n, n)).tocsr()
        g.sum_duplicates()
        return g, m


def read_roads(cache: Path, net: Net):
    listing = urllib.request.urlopen(TIGER_ROADS_DIR, timeout=120).read().decode()
    names = sorted(set(x for x in __import__('re').findall(r'tl_2025_08\d{3}_roads\.zip', listing)))
    if len(names) != 64:
        sys.exit('expected 64 Colorado county road files, found %d' % len(names))
    road_nodes = set()
    counts = defaultdict(int)
    for nm in names:
        z = zipfile.ZipFile(fetch(TIGER_ROADS_DIR + nm, cache / 'roads' / nm))
        base = [x for x in z.namelist() if x.endswith('.shp')][0][:-4]
        r = shapefile.Reader(shp=io.BytesIO(z.read(base + '.shp')), dbf=io.BytesIO(z.read(base + '.dbf')))
        fields = [f[0] for f in r.fields[1:]]
        im = fields.index('MTFCC')
        for sr in r.iterShapeRecords():
            mt = sr.record[im]
            counts[mt] += 1
            if mt in ('S1100', 'S1630'):
                continue
            pts = sr.shape.points
            parts = list(sr.shape.parts) + [len(pts)]
            for i in range(len(parts) - 1):
                seg = pts[parts[i]:parts[i + 1]]
                before = len(net.lon)
                net.line(seg, 0)
                road_nodes.update(range(before, len(net.lon)))
                for c in seg:
                    road_nodes.add(net.idx[(round(c[0], 6), round(c[1], 6))])
    log('roads', dict(counts))
    return names, road_nodes, dict(counts)


def read_trails(cache: Path):
    feats = []
    meta = json.loads(urllib.request.urlopen(COTREX + '?f=json', timeout=120).read())
    total = json.loads(urllib.request.urlopen(COTREX + '/query?where=1%3D1&returnCountOnly=true&f=json', timeout=120).read())['count']
    for off in range(0, total, 2000):
        p = cache / 'trails' / ('t_%d.json' % (off // 2000))
        url = (COTREX + '/query?where=1%3D1&outFields=feature_id,name,bike,hiking,type,surface,access&outSR=4326'
               '&geometryPrecision=6&orderByFields=OBJECTID&f=geojson&resultOffset=' + str(off) + '&resultRecordCount=2000')
        fetch(url, p)
        feats += load_json(p)['features']
    if len(feats) != total:
        sys.exit('COTREX returned %d of %d segments' % (len(feats), total))
    edited = meta.get('editingInfo', {}).get('dataLastEditDate')
    return feats, total, (datetime.fromtimestamp(edited / 1000, timezone.utc).date().isoformat() if edited else None)


def bike_ok(v):
    if v is None:
        return False
    v = str(v).strip().lower()
    return v != 'no' and v != ''


def add_trails(net: Net, feats, road_nodes):
    ends = []
    kept = {'walk': 0, 'bike': 0}
    for f in feats:
        p = f['properties']
        if p.get('type') not in ('Trail', 'Interpretive Trail'):
            continue
        if not f.get('geometry'):
            continue
        walk = str(p.get('hiking') or '').lower() != 'no'
        bike = bike_ok(p.get('bike'))
        if not walk and not bike:
            continue
        kind = 2 if (walk and bike) else 1 if walk else 4
        g = f['geometry']
        lines = [g['coordinates']] if g['type'] == 'LineString' else g['coordinates']
        for ln in lines:
            if len(ln) < 2:
                continue
            first = net.node(ln[0][0], ln[0][1])
            last = net.line(ln, kind)
            ends += [first, last]
        kept['walk'] += walk
        kept['bike'] += bike
    # Join trail ends to the nearest street node within TRAIL_LINK metres.
    rn = np.array(sorted(road_nodes))
    tree = cKDTree(proj(np.array(net.lon)[rn], np.array(net.lat)[rn]))
    ends = np.array(sorted(set(e for e in ends if e not in road_nodes)))
    if len(ends):
        d, j = tree.query(proj(np.array(net.lon)[ends], np.array(net.lat)[ends]), distance_upper_bound=TRAIL_LINK)
        for e, dd, jj in zip(ends, d, j):
            if np.isfinite(dd):
                net.a.append(int(e))
                net.b.append(int(rn[jj]))
                net.kind.append(3)
    log('trails kept', kept)
    return kept


def read_blocks(cache: Path):
    z = zipfile.ZipFile(fetch(TIGER_BLOCKS, cache / 'tl_2020_08_tabblock20.zip'))
    base = [x for x in z.namelist() if x.endswith('.dbf')][0]
    r = shapefile.Reader(dbf=io.BytesIO(z.read(base)))
    f = [x[0] for x in r.fields[1:]]
    ig, ih, ilat, ilon = f.index('GEOID20'), f.index('HOUSING20'), f.index('INTPTLAT20'), f.index('INTPTLON20')
    out = {}
    for rec in r.iterRecords():
        out[rec[ig]] = (float(rec[ilon]), float(rec[ilat]), int(rec[ih] or 0))
    return out


def read_csv_gz(path, key, val):
    out = {}
    with gzip.open(path, 'rt') as fh:
        for row in csv.DictReader(fh):
            out[row[key]] = row[val] if isinstance(val, str) else {k: row[k] for k in val}
    return out


def points(path, keep=None):
    d = load_json(path)
    pts = []
    for ft in d['features']:
        g = ft.get('geometry')
        if not g:
            continue
        if keep and not keep(ft.get('properties') or {}):
            continue
        if g['type'] == 'Point':
            pts.append(tuple(g['coordinates'][:2]))
        else:
            c = shape(g).representative_point()
            pts.append((c.x, c.y))
    return d.get('meta') or d.get('metadata') or {}, pts


def load_services():
    a = ROOT / 'data' / 'amenities'
    groc_types = {'supermarket', 'grocery', 'greengrocer', 'general'}
    health_types = {'clinic', 'doctors', 'hospital', 'pharmacy'}
    out, src = {}, {}

    def t(p, *keys):
        for k in keys:
            if p.get(k):
                return str(p[k]).lower()
        return ''
    m, out['grocery'] = points(a / 'grocery_co.geojson', lambda p: t(p, 'type', 'shop', 'amenity') in groc_types)
    src['grocery'] = {'file': 'data/amenities/grocery_co.geojson', 'source': m.get('source'), 'generated': m.get('generated'),
                      'kept': 'supermarket, grocery, greengrocer and general stores; convenience stores, fuel stations and wholesale clubs left out'}
    m, out['school'] = points(a / 'schools_co.geojson', lambda p: t(p, 'type', 'amenity') in {'school', 'kindergarten'})
    src['school'] = {'file': 'data/amenities/schools_co.geojson', 'source': m.get('source'), 'generated': m.get('generated'),
                     'kept': 'schools and kindergartens; colleges and universities left out'}
    m, h1 = points(a / 'healthcare_co.geojson', lambda p: t(p, 'type', 'amenity', 'healthcare') in health_types)
    m2, h2 = points(ROOT / 'data' / 'market' / 'health_centers_co.geojson')
    out['health'] = h1 + h2
    src['health'] = {'file': 'data/amenities/healthcare_co.geojson + data/market/health_centers_co.geojson',
                     'source': '%s; %s' % (m.get('source'), m2.get('source')), 'generated': '%s; HRSA record date %s' % (m.get('generated'), m2.get('hrsa_record_date')),
                     'kept': 'clinics, doctors, hospitals and pharmacies, plus HRSA community health center sites; dentists left out'}
    m, out['park'] = points(a / 'parks_co.geojson')
    src['park'] = {'file': 'data/amenities/parks_co.geojson', 'source': m.get('source'), 'generated': m.get('generated'), 'kept': 'every park in the file'}
    m, out['transit'] = points(a / 'transit_stops_statewide_co.geojson',
                               lambda p: p.get('service') == 'fixed_route' and p.get('reliability') == 'confirmed')
    src['transit'] = {'file': 'data/amenities/transit_stops_statewide_co.geojson', 'source': m.get('source'), 'generated': m.get('generated'),
                      'kept': 'confirmed fixed-route stops (CDOT or an agency feed); demand-response and OpenStreetMap-only stops left out. How often buses stop is not counted yet.'}
    return out, src


def load_json(path):
    with open(path) as fh:
        return json.load(fh)


def snap(tree, ids, lon, lat):
    d, j = tree.query(proj(lon, lat))
    node = ids[j]
    ok = d <= SNAP_MAX
    return node, d, ok


def with_source(g, lead):
    """g plus one node (index n) joined to each node in lead by an edge of that length."""
    n = g.shape[0]
    cols = np.fromiter(lead.keys(), dtype=np.int64)
    # A zero-length edge would vanish from a sparse matrix, so a service on the street is 1 cm off it.
    w = np.maximum(np.fromiter(lead.values(), dtype=float), 0.01)
    rows = np.full(len(cols), n)
    extra = coo_matrix((w, (rows, cols)), shape=(n + 1, n + 1))
    base = coo_matrix(g)
    return (coo_matrix((base.data, (base.row, base.col)), shape=(n + 1, n + 1)) + extra).tocsr()


def wmedian(vals, weights):
    """Homes-weighted median of the measured values; homes off the network (NaN or None) are left out."""
    pairs = sorted((v, w) for v, w in zip(vals, weights)
                   if v is not None and not (isinstance(v, float) and math.isnan(v)) and w > 0)
    tot = sum(w for _, w in pairs)
    if not tot:
        return None
    run = 0
    for v, w in pairs:
        run += w
        if run >= tot / 2:
            return v
    return pairs[-1][0]


def build_map(doc, trails, services):
    """Per-town map layers: service points and COTREX trails within about 500 m of the town outline."""
    from shapely.geometry import box as sbox
    pb = load_json(ROOT / 'data' / 'co-place-boundaries.geojson')
    outl = {f['properties']['geoid']: shape(f['geometry']) for f in pb['features'] if f.get('geometry')}
    tgeoms, tkinds = [], []
    for f in trails:
        p = f['properties']
        if p.get('type') not in ('Trail', 'Interpretive Trail') or not f.get('geometry'):
            continue
        walk = str(p.get('hiking') or '').lower() != 'no'
        bike = bike_ok(p.get('bike'))
        if walk or bike:
            tgeoms.append(shape(f['geometry']))
            tkinds.append('b' if bike else 'w')
    ttree = STRtree(tgeoms)
    mp = {}
    for g in doc['places']:
        o = outl.get(g)
        if o is None:
            continue
        area = o.buffer(0.005)
        bx = [round(v, 4) for v in area.bounds]
        lay = {'bbox': bx, 'services': {}}
        for s_, pts in services.items():
            lay['services'][s_] = [[round(x, 4), round(y, 4)] for x, y in pts
                                   if bx[0] <= x <= bx[2] and bx[1] <= y <= bx[3] and area.contains(Point(x, y))]
        lines = []
        for j in ttree.query(area):
            clip = tgeoms[j].intersection(area)
            if clip.is_empty:
                continue
            clip = clip.simplify(0.0004)
            parts = [clip] if clip.geom_type == 'LineString' else [x for x in getattr(clip, 'geoms', []) if x.geom_type == 'LineString']
            for ln in parts:
                cs = []
                for x, y in ln.coords:
                    c = [round(x, 4), round(y, 4)]
                    if not cs or cs[-1] != c:
                        cs.append(c)
                if len(cs) > 1:
                    lines.append([tkinds[j]] + cs)
        lay['trails'] = lines
        mp[g] = lay
    meta = doc['meta']
    OUT_MAP.write_text(json.dumps({'meta': {'generated': meta['generated'], 'generated_by': meta['generated_by'],
                                            'note': 'Per-town map layers for the walk and bike page: service points and COTREX trails within about 500 m of each town outline (2024 Census place boundaries), simplified.',
                                            'sources': ['data/amenities/', 'data/market/health_centers_co.geojson', COTREX, 'data/co-place-boundaries.geojson'],
                                            'odbl_notice': meta['odbl_notice']},
                                   'places': mp}, separators=(',', ':')) + '\n')
    log('wrote', OUT_MAP, OUT_MAP.stat().st_size, 'bytes')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', required=True)
    ap.add_argument('--map-only', action='store_true', help='rebuild only the map layers from the existing access file')
    ap.add_argument('--county', help='one county FIPS (5 digits) for a quick test; output not written')
    args = ap.parse_args()
    cache = Path(args.cache)
    t0 = time.time()
    if args.map_only:
        trails, _, _ = read_trails(cache)
        services, _ = load_services()
        build_map(load_json(OUT), trails, services)
        return

    net = Net()
    road_files, road_nodes, road_counts = read_roads(cache, net)
    trails, trail_total, trail_edit = read_trails(cache)
    trail_kept = add_trails(net, trails, road_nodes)
    net.finish()
    log('network nodes', len(net.lon), 'edges', len(net.a), 'by kind', np.bincount(net.kind).tolist())

    g_walk, _ = net.graph([0, 1, 2, 3])
    g_bike, _ = net.graph([0, 2, 3, 4])
    g_road, _ = net.graph([0])

    # Snapping index: any node touched by a street (so a home never snaps to a backcountry trail).
    rn = np.array(sorted(road_nodes))
    tree = cKDTree(proj(net.lon[rn], net.lat[rn]))

    blocks = read_blocks(cache)
    wac = read_csv_gz(fetch(LODES_WAC, cache / 'co_wac_S000_JT00_2023.csv.gz'), 'w_geocode', 'C000')
    xw = read_csv_gz(fetch(LODES_XWALK, cache / 'co_xwalk.csv.gz'), 'tabblk2020', ['stplc', 'stplcname', 'ctyname'])
    homes_ids = [b for b, v in blocks.items() if v[2] > 0 and (not args.county or b.startswith(args.county))]
    log('home blocks', len(homes_ids), 'homes', sum(blocks[b][2] for b in homes_ids))

    H = np.array([blocks[b][2] for b in homes_ids], dtype=float)
    hlon = np.array([blocks[b][0] for b in homes_ids])
    hlat = np.array([blocks[b][1] for b in homes_ids])
    hnode, hsnap, hok = snap(tree, rn, hlon, hlat)

    services, service_src = load_services()
    res = {}
    for name, pts in services.items():
        if not pts:
            sys.exit('no points for ' + name)
        plon = np.array([p[0] for p in pts])
        plat = np.array([p[1] for p in pts])
        pnode, psnap, pok = snap(tree, rn, plon, plat)
        # The walk from the street to the service counts: one extra source node joins every
        # service's street node with an edge as long as that service's snap distance.
        lead = {}
        for nd, dd in zip(pnode[pok], psnap[pok]):
            lead[int(nd)] = min(lead.get(int(nd), np.inf), float(dd))
        out = {}
        for label, g, lim in (('walk', g_walk, WALK_10), ('bike', g_bike, BIKE_15),
                              ('walk_roads', g_road, WALK_10), ('bike_roads', g_road, BIKE_15)):
            d = dijkstra(with_source(g, lead), directed=False, indices=g.shape[0], limit=lim)[:g.shape[0]]
            dist = d[hnode] + hsnap
            out[label] = np.where(hok & (dist <= lim), 1.0, 0.0)
        st = cKDTree(proj(plon, plat))
        sd, _ = st.query(proj(hlon, hlat))
        out['walk_straight'] = (sd <= WALK_10).astype(float)
        out['bike_straight'] = (sd <= BIKE_15).astype(float)
        res[name] = out
        log('service', name, len(pts), 'points; walk share', round(100 * (out['walk'] * H).sum() / H.sum(), 1))

    # Jobs reachable, per county subgraph.
    jobs_ids = [b for b in wac if b in blocks]
    jlon = np.array([blocks[b][0] for b in jobs_ids])
    jlat = np.array([blocks[b][1] for b in jobs_ids])
    jn = np.array([int(wac[b]) for b in jobs_ids], dtype=float)
    jnode, jsnap, jok = snap(tree, rn, jlon, jlat)
    jnode, jsnap, jn = jnode[jok], jsnap[jok], jn[jok]
    log('jobs', int(sum(int(wac[b]) for b in jobs_ids)), 'on network', int(jn.sum()))

    jobs_walk = np.full(len(homes_ids), np.nan)
    jobs_bike = np.full(len(homes_ids), np.nan)
    by_cty = defaultdict(list)
    for i, b in enumerate(homes_ids):
        if hok[i]:
            by_cty[b[:5]].append(i)
    pad = 0.06
    for cty, rows in sorted(by_cty.items()):
        rows = np.array(rows)
        x0, x1 = hlon[rows].min() - pad, hlon[rows].max() + pad
        y0, y1 = hlat[rows].min() - pad * 0.8, hlat[rows].max() + pad * 0.8
        sub = np.where((net.lon >= x0) & (net.lon <= x1) & (net.lat >= y0) & (net.lat <= y1))[0]
        pos = -np.ones(len(net.lon), dtype=np.int64)
        pos[sub] = np.arange(len(sub))
        jin = pos[jnode] >= 0
        jpos, jlead, jv = pos[jnode[jin]], jsnap[jin], jn[jin]
        for label, g, lim, outarr in (('walk', g_walk, WALK_15, jobs_walk), ('bike', g_bike, BIKE_15, jobs_bike)):
            gs = g[sub][:, sub]
            uniq = np.unique(hnode[rows])
            homes_at = defaultdict(list)
            for i in rows:
                homes_at[hnode[i]].append(i)
            for k in range(0, len(uniq), 48):
                chunk = uniq[k:k + 48]
                D = dijkstra(gs, directed=False, indices=pos[chunk], limit=lim)
                for n, row in zip(chunk, D):
                    # Route to each job block's street node, plus the walk from the street to the block.
                    jd = row[jpos] + jlead
                    for i in homes_at[n]:
                        outarr[i] = float(jv[jd + hsnap[i] <= lim].sum())
        log('jobs county', cty, len(rows), 'blocks', len(sub), 'nodes', round(time.time() - t0), 's')

    # 2010 block group for each home block (EPA SLD geography).
    bgfc = load_json(ROOT / 'data' / 'market' / 'epa_sld_bg_geometry_co.geojson')
    geoms, gids = [], []
    for ft in bgfc['features']:
        geoms.append(shape(ft['geometry']))
        gids.append(ft['properties'].get('geoid') or ft['properties'].get('GEOID10'))
    bgt = STRtree(geoms)
    sld = load_json(ROOT / 'data' / 'market' / 'epa_sld_co.json')
    hbg = []
    for lo, la in zip(hlon, hlat):
        p = Point(lo, la)
        hit = None
        for j in bgt.query(p):
            if geoms[j].contains(p):
                hit = gids[j]
                break
        if hit is None:
            j = bgt.nearest(p)
            hit = gids[j] if geoms[j].distance(p) < 0.0005 else None
        hbg.append(hit)
    nwi = np.array([(sld['blockGroups'].get(g) or {}).get('walkIndex') if g else None for g in hbg], dtype=object)

    def summarise(rows):
        rows = np.asarray(rows)
        h = H[rows]
        tot = h.sum()
        if tot <= 0:
            return None
        o = {'homes': int(tot), 'blocks': int(len(rows)), 'off_network_pct': round(100 * h[~hok[rows]].sum() / tot, 1)}
        for mode in ('walk', 'bike', 'walk_roads', 'bike_roads', 'walk_straight', 'bike_straight'):
            o[mode] = {s: round(100 * (res[s][mode][rows] * h).sum() / tot, 1) for s in SERVICES}
        o['walk_reach'] = round(sum(o['walk'][s] for s in EVERYDAY) / len(EVERYDAY), 1)
        o['bike_reach'] = round(sum(o['bike'][s] for s in EVERYDAY) / len(EVERYDAY), 1)
        o['walk_reach_roads'] = round(sum(o['walk_roads'][s] for s in EVERYDAY) / len(EVERYDAY), 1)
        o['bike_reach_roads'] = round(sum(o['bike_roads'][s] for s in EVERYDAY) / len(EVERYDAY), 1)
        o['walk_reach_straight'] = round(sum(o['walk_straight'][s] for s in EVERYDAY) / len(EVERYDAY), 1)
        o['transit_reach'] = o['walk']['transit']
        jw = wmedian(list(jobs_walk[rows]), list(h))
        jb = wmedian(list(jobs_bike[rows]), list(h))
        o['jobs_walk15'] = None if jw is None or (isinstance(jw, float) and math.isnan(jw)) else int(jw)
        o['jobs_bike15'] = None if jb is None or (isinstance(jb, float) and math.isnan(jb)) else int(jb)
        nv = [(nwi[i], H[i]) for i in rows if nwi[i] is not None]
        o['epa_walk_index'] = round(wmedian([v for v, _ in nv], [w for _, w in nv]), 2) if nv else None
        return o

    if args.county:
        print(json.dumps(summarise(np.arange(len(homes_ids))), indent=1))
        return

    place_rows, county_rows, bg_rows = defaultdict(list), defaultdict(list), defaultdict(list)
    for i, b in enumerate(homes_ids):
        county_rows[b[:5]].append(i)
        pl = xw.get(b, {}).get('stplc')
        if pl and len(pl) == 7 and pl.startswith('08') and not pl.endswith('99999'):
            place_rows[pl].append(i)
        if hbg[i]:
            bg_rows[hbg[i]].append(i)

    pb = load_json(ROOT / 'data' / 'co-place-boundaries.geojson')
    pnames = {f['properties']['geoid']: f['properties']['name'] for f in pb['features']}
    cf = load_json(ROOT / 'data' / 'boundaries' / 'counties_co.geojson')
    cnames = {f['properties']['GEOID']: f['properties']['NAMELSAD'] for f in cf['features']}

    places = {}
    for g, rows in sorted(place_rows.items()):
        s = summarise(rows)
        if s:
            s['name'] = pnames.get(g) or xw[homes_ids[rows[0]]]['stplcname']
            s['county'] = homes_ids[rows[0]][:5]
            places[g] = s
    counties = {}
    for g, rows in sorted(county_rows.items()):
        s = summarise(rows)
        if s:
            s['name'] = cnames.get(g, g)
            counties[g] = s
    state = summarise(np.arange(len(homes_ids)))

    # Bands from the spread of towns with at least 200 homes, so a hamlet doesn't set the cut points.
    big = [p for p in places.values() if p['homes'] >= 200]

    def cuts(key):
        v = sorted(p[key] for p in big)
        q = [v[int(len(v) * f)] for f in (0.75, 0.5, 0.25)]
        return [round(x, 1) for x in q]
    bands = {'basis': 'Quartiles of the %d Colorado towns with 200 or more homes. Strong: at or above the top-quarter cut. Fair: at or above the median. Limited: above the bottom-quarter cut. Very limited: at or below it.' % len(big),
             'labels': BANDS,
             'walk_reach': cuts('walk_reach'), 'bike_reach': cuts('bike_reach'), 'transit_reach': cuts('transit_reach')}

    def band(v, c):
        # Strong: at or above the top-quarter cut; Fair: at or above the median; Limited: above the
        # bottom-quarter cut; Very limited: at or below it (so a town with no stop at all is never Limited).
        if v is None:
            return None
        if v >= c[0]:
            return BANDS[0]
        if v >= c[1]:
            return BANDS[1]
        if v > c[2]:
            return BANDS[2]
        return BANDS[3]
    for coll in (places, counties):
        for s in coll.values():
            s['bands'] = {k: band(s[k], bands[k]) for k in ('walk_reach', 'bike_reach', 'transit_reach')}
    state['bands'] = {k: band(state[k], bands[k]) for k in ('walk_reach', 'bike_reach', 'transit_reach')}

    bgs = {}
    for g, rows in sorted(bg_rows.items()):
        rows = np.asarray(rows)
        h = H[rows]
        tot = h.sum()
        jw = wmedian(list(jobs_walk[rows]), list(h))
        jb = wmedian(list(jobs_bike[rows]), list(h))
        bgs[g] = [int(tot),
                  round(sum(100 * (res[s]['walk'][rows] * h).sum() / tot for s in EVERYDAY) / 4, 1),
                  round(sum(100 * (res[s]['bike'][rows] * h).sum() / tot for s in EVERYDAY) / 4, 1),
                  round(100 * (res['transit']['walk'][rows] * h).sum() / tot, 1),
                  None if jw is None or math.isnan(jw) else int(jw),
                  None if jb is None or math.isnan(jb) else int(jb)] + \
                 [round(100 * (res[s]['walk'][rows] * h).sum() / tot) for s in SERVICES] + \
                 [round(100 * (res[s]['bike'][rows] * h).sum() / tot) for s in SERVICES]

    now = datetime.now(timezone.utc)
    meta = {
        'title': 'Walking and biking access by route, Colorado',
        'generated': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'as_of': now.date().isoformat(),
        'generated_by': 'scripts/market/build_walk_bike_access.py',
        'method': ('Each 2020 Census block with homes is joined to the nearest street. Distance to the nearest service is the '
                   'shortest route on streets and trails. A block counts as within reach when that route is at most the limit. '
                   'Shares are of homes (2020 Census housing units). Jobs reachable is the homes-weighted median, across the '
                   "place's blocks, of LODES jobs on the network within the limit."),
        'speeds': {'walk_mph': 3, 'bike_mph': 10, 'walk_10min_m': WALK_10, 'walk_15min_m': WALK_15, 'bike_15min_m': BIKE_15},
        'off_network': 'A home or service more than %d m from any street is off the network and never counts as within reach.' % SNAP_MAX,
        'everyday_services': EVERYDAY,
        'reach_definition': 'walk_reach and bike_reach are the average, across grocery, school, health care and park, of the share of homes within a 10-minute walk or a 15-minute ride.',
        'not_modelled': ['hills', 'sidewalks and bike lanes', 'street crossings and traffic', 'how often transit runs', 'door-to-door transit trips'],
        'fields': {
            'walk / bike': 'share of homes (%) within a 10-minute walk / 15-minute ride of each service, by street and trail',
            'walk_roads / bike_roads': 'the same on streets only, so the difference is what trails add',
            'walk_straight / bike_straight': 'the same by straight-line distance, for comparison',
            'jobs_walk15 / jobs_bike15': 'jobs reachable in a 15-minute walk / ride (homes-weighted median)',
            'epa_walk_index': "EPA National Walkability Index (1 to 20), homes-weighted median of the 2010 block groups the place's homes fall in",
            'blockGroups': 'by 2010 block group: [homes, walk_reach, bike_reach, transit_reach, jobs_walk15, jobs_bike15, walk % grocery, school, health, park, transit, bike % grocery, school, health, park, transit]'},
        'bands': bands,
        'sources': [
            {'id': 'tiger-roads-2025', 'name': 'U.S. Census Bureau, TIGER/Line Shapefiles 2025, All Roads', 'url': TIGER_ROADS_DIR,
             'files': len(road_files), 'note': 'Interstates (S1100) and ramps (S1630) left out.', 'road_type_counts': road_counts},
            {'id': 'cotrex-trails', 'name': 'Colorado Parks and Wildlife, Colorado Trail Explorer (COTREX) trails, September 2025 update',
             'url': COTREX, 'page': COTREX_PAGE, 'segments': trail_total, 'data_last_edit': trail_edit,
             'kept': 'Trail and Interpretive Trail segments: %d open to walking, %d open to bikes.' % (trail_kept['walk'], trail_kept['bike'])},
            {'id': 'tiger-blocks-2020', 'name': 'U.S. Census Bureau, TIGER/Line 2020 tabulation blocks (HOUSING20, 2020 Census housing units)', 'url': TIGER_BLOCKS},
            {'id': 'lodes-wac-2023', 'name': 'U.S. Census Bureau, LEHD LODES 8, workplace area characteristics, 2023, all jobs', 'url': LODES_WAC},
            {'id': 'lodes-xwalk', 'name': 'U.S. Census Bureau, LODES 8 geography crosswalk (block to place)', 'url': LODES_XWALK},
            {'id': 'epa-sld', 'name': 'EPA Smart Location Database v3.0, National Walkability Index', 'file': 'data/market/epa_sld_co.json',
             'vintage': sld['meta'].get('vintage'), 'fetched': sld['meta'].get('fetched')},
        ],
        'services': service_src,
        'odbl_notice': 'Grocery, school, health care and park locations contain information from OpenStreetMap, made available under the Open Database License.',
        'runtime_seconds': round(time.time() - t0),
    }
    doc = {'meta': meta, 'state': state, 'counties': counties, 'places': places, 'blockGroups': bgs}
    OUT.write_text(json.dumps(doc, separators=(',', ':'), sort_keys=False) + '\n')
    log('wrote', OUT, OUT.stat().st_size, 'bytes;', len(places), 'places', len(counties), 'counties', len(bgs), 'block groups')

    build_map(doc, trails, services)


if __name__ == '__main__':
    main()
