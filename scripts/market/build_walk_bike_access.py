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
    biking, and so is any street piece lying along a CDOT Bicycles Prohibited
    freeway stretch.
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

State and local layers (public ArcGIS services, fetched into the cache):
  - CDOT Bicycling Map: "Bicycles Prohibited" freeway stretches are taken out
    of the walking and biking networks; CDOT bike paths are added.
  - Bike facility inventories: DRCOG regional inventory (Denver region),
    City of Colorado Springs and City of Grand Junction. Off-street paths join
    the network. Bike lanes, separated lanes, bike boulevards and sidepaths
    mark the street beside them.
  - Sidewalks: DRCOG 2024 planimetric sidewalk centerlines (Denver region)
    and City of Colorado Springs sidewalks. Sidewalk figures are reported only
    where at least 80 percent of a place's homes fall inside the mapped area.

Speeds: walking 3 mph (10 minutes = 805 m), biking 10 mph (15 minutes =
4,023 m). Hills, crossings and traffic speed are not modelled.

Three extra measures use the local layers:
  - bike_calm_reach: the bike reach using only local streets, trails, paths
    and state or US highways (TIGER S1200) that have a mapped bike lane or
    path alongside. Outside the three inventories no S1200 counts.
  - sidewalk_pct: share of street length (S1200 and S1400, 30 m or longer)
    with a mapped sidewalk alongside.
  - walk_sidewalk_reach: the walk reach using only streets with a mapped
    sidewalk, plus trails, paths and walkways.

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
import urllib.parse
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
from shapely.geometry import Point, shape
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
CDOT_BIKE = 'https://dtdapps.codot.gov/server/rest/services/BikeMap/Bike_Byways/MapServer/'
DRCOG_RDC = 'https://gis.drcog.org/server/rest/services/RDC/'
COS_TRANS = 'https://gis.coloradosprings.gov/arcgis/rest/services/GeneralUse/Transportation/MapServer/'
GJ_TRANS = 'https://external-gis.gjcity.org/arcgis/rest/services/Hub/Transportation_Hub/MapServer/'
LOCAL_LAYERS = {
    # key: (layer url, fields, name, page)
    'cdot_bike_prohibited': (CDOT_BIKE + '7', ['OBJECTID', 'ROUTE'], 'CDOT Bicycling Map, Bicycles Prohibited', 'https://www.codot.gov/programs/bikeped'),
    'cdot_bike_paths': (CDOT_BIKE + '10', ['OBJECTID', 'PathName'], 'CDOT Bicycling Map, CDOT Bike Paths', 'https://www.codot.gov/programs/bikeped'),
    'drcog_bike': (DRCOG_RDC + 'BICYCLE_FACILITY_INVENTORY/MapServer/0', ['objectid', 'fac_type', 'status', 'on_off', 'name'],
                   'DRCOG Bicycle Facility Inventory', 'https://data.drcog.org/'),
    'drcog_sidewalks_2024': (DRCOG_RDC + 'PLANIMETRICS_2024_CENTERLINE_SIDEWALKS_TOTAL/MapServer/0', ['OBJECTID', 'Type'],
                             'DRCOG Planimetrics 2024, sidewalk centerlines', 'https://data.drcog.org/'),
    'cos_bike': (COS_TRANS + '2', ['OBJECTID', 'Code', 'Existence', 'Route'], 'City of Colorado Springs, Bike Facilities', COS_TRANS.rstrip('/')),
    'cos_sidewalks': (COS_TRANS + '4', ['OBJECTID', 'DesignType', 'SurfaceType', 'SharedUse'], 'City of Colorado Springs, Sidewalks', COS_TRANS.rstrip('/')),
    'cos_crosswalks': (COS_TRANS + '3', ['OBJECTID', 'ControlType'], 'City of Colorado Springs, Crosswalks', COS_TRANS.rstrip('/')),
    'gj_bike': (GJ_TRANS + '267', ['OBJECTID', 'TRL_NAME', 'LAYER', 'RouteName'], 'City of Grand Junction, Bike Routes', GJ_TRANS.rstrip('/')),
}
# Facility types counted as a bike lane or path. Shoulders, signed routes, shared-lane markings and
# crossings are not.
DRCOG_PATH = {'SHARED USE PATH', 'LOCAL PATH', 'UNPAVED PATH', 'SIDEPATH'}
DRCOG_LANE = {'BICYCLE LANE', 'SEPARATED BICYCLE LANE', 'BICYCLE BOULEVARD'}
COS_LANE = {'Bike Lane', 'Buffered Bike Lane', 'Protected Bike Lane', '2-Way Cycle Track', 'Bike Boulevard',
            'Contra-Flow Bike Lane', 'Climbing Lane'}
GJ_PATH = {'Detached Bike-Ped Trails', 'Attached Bike-Ped Trails', 'Pedestrian Park Path', 'Neighborhood Interconnections'}
GJ_LANE = {'Striped Bike Lanes', 'Buffered Bike Lanes', 'Protected Bike Lanes', 'Raised Cycle Track', 'Bike-Friendly Sidewalks'}
DRCOG_SIDEWALK = {'Sidewalk', 'Other Path', 'Best-fit line'}
# Counties in the DRCOG region (its bike inventory and planimetrics cover these).
DRCOG_COUNTIES = {'08001', '08005', '08013', '08014', '08019', '08031', '08035', '08047', '08059'}
LOCAL_PLACES = {'0816000': 'cos', '0831660': 'gj'}
SIDEWALK_NEAR = 25.0   # a sidewalk centerline this close to a street, along it, counts as alongside
BIKE_NEAR = 20.0       # same for a bike lane or path
BANNED_NEAR = 15.0     # a highway segment this close to a Bicycles Prohibited line is closed to bikes
DENSIFY = 5.0          # sidewalk and facility lines become points every 5 m for the nearness tests
CELL = 500.0           # sidewalk coverage grid, metres
SIDEWALK_MIN_COVER = 80.0
SIDEWALK_MIN_EDGE = 30.0
# Road classes per edge: 1 S1200 (state or US highway), 2 S1400 (local street), 3 other vehicle road,
# 4 walkway, stairway or bike path. Non-road edges are -1.
ROAD_CLASS = {'S1200': 1, 'S1400': 2, 'S1710': 4, 'S1720': 4, 'S1820': 4}

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
        self.kind = []  # 0 street, 1 walk-only trail, 2 walk+bike trail, 3 link, 4 bike-only trail, 5 local path
        self.cls = []   # road class (ROAD_CLASS) for streets, -1 otherwise

    def node(self, lon, lat):
        k = (round(lon, 6), round(lat, 6))
        i = self.idx.get(k)
        if i is None:
            i = len(self.lon)
            self.idx[k] = i
            self.lon.append(k[0])
            self.lat.append(k[1])
        return i

    def line(self, coords, kind, cls=-1):
        prev = None
        for c in coords:
            i = self.node(c[0], c[1])
            if prev is not None and prev != i:
                self.a.append(prev)
                self.b.append(i)
                self.kind.append(kind)
                self.cls.append(cls)
            prev = i
        return prev

    def finish(self):
        self.lon = np.array(self.lon)
        self.lat = np.array(self.lat)
        self.a = np.array(self.a, dtype=np.int64)
        self.b = np.array(self.b, dtype=np.int64)
        self.kind = np.array(self.kind, dtype=np.int8)
        self.cls = np.array(self.cls, dtype=np.int8)
        self.w = hav(self.lon[self.a], self.lat[self.a], self.lon[self.b], self.lat[self.b])

    def graph(self, kinds, mask=None):
        m = np.isin(self.kind, kinds) if mask is None else mask
        n = len(self.lon)
        a, b, w = self.a[m], self.b[m], self.w[m]
        r, c, w = np.concatenate([a, b]), np.concatenate([b, a]), np.concatenate([w, w])
        keep = r != c
        r, c, w = r[keep], c[keep], w[keep]
        # Parallel records (a street and a trail on the same line, or a repeated street) keep the
        # shortest length; building the matrix directly would add their lengths together.
        o = np.lexsort((w, c, r))
        r, c, w = r[o], c[o], w[o]
        first = np.ones(len(r), dtype=bool)
        first[1:] = (r[1:] != r[:-1]) | (c[1:] != c[:-1])
        g = coo_matrix((w[first], (r[first], c[first])), shape=(n, n)).tocsr()
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
                net.line(seg, 0, ROAD_CLASS.get(mt, 3))
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
                net.cls.append(-1)
    log('trails kept', kept)
    return kept


def arcgis_layer(key, cache: Path):
    """One ArcGIS line layer, paged by OBJECTID order, cached as gzip JSON {meta, rows: [attrs..., paths]}."""
    url, fields, name, page = LOCAL_LAYERS[key]
    dest = cache / 'local' / (key + '.json.gz')
    if not (dest.exists() and dest.stat().st_size > 0):
        def get(u):
            for t in range(5):
                try:
                    req = urllib.request.Request(u, headers={'User-Agent': 'coho-walk-bike-build'})
                    with urllib.request.urlopen(req, timeout=180) as r:
                        d = json.loads(r.read())
                    if 'error' in d:
                        raise RuntimeError(str(d['error']))
                    return d
                except Exception:
                    if t == 4:
                        raise
                    time.sleep(2 * (t + 1))
        q = lambda **k: url + '/query?' + urllib.parse.urlencode(dict(where='1=1', f='json', **k))
        n = get(q(returnCountOnly='true'))['count']
        step = min(2000, get(url + '?f=json').get('maxRecordCount') or 1000)
        rows = []
        log('download', key, n, 'features')
        for off in range(0, n, step):
            d = get(q(outFields=','.join(fields), outSR=4326, geometryPrecision=6, orderByFields=fields[0],
                      resultOffset=off, resultRecordCount=step, returnGeometry='true'))
            rows += [[f['attributes'].get(k) for k in fields] + [f['geometry'].get('paths')]
                     for f in d['features'] if f.get('geometry')]
        if len(rows) != n:
            sys.exit('%s returned %d of %d features' % (key, len(rows), n))
        dest.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(dest, 'wt') as fh:
            json.dump({'meta': {'layer': url, 'fields': fields, 'count': n,
                                'fetched': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, 'rows': rows}, fh)
    with gzip.open(dest, 'rt') as fh:
        d = json.load(fh)
    if len(d['rows']) != d['meta']['count']:
        sys.exit('cached %s is incomplete' % key)
    return d


def load_local(cache: Path):
    """State and local bike and sidewalk layers, sorted into the lists the build uses."""
    L = {k: arcgis_layer(k, cache) for k in LOCAL_LAYERS}
    out = {'banned': [], 'paths': [], 'lanes': [], 'sidewalks': [], 'missing': [], 'swcover': {'drcog': [], 'cos': []},
           'counts': {}, 'fetched': {k: v['meta']['fetched'][:10] for k, v in L.items()}}
    cnt = defaultdict(int)

    def lines(paths):
        return [p for p in (paths or []) if p and len(p) > 1]
    for r in L['cdot_bike_prohibited']['rows']:
        out['banned'] += lines(r[-1])
    for r in L['cdot_bike_paths']['rows']:
        out['paths'] += [('cdot', ln) for ln in lines(r[-1])]
        cnt['cdot_path'] += 1
    for r in L['drcog_bike']['rows']:
        ft, st = r[1], r[2]
        if st and st != 'EXISTING':
            continue
        if ft in DRCOG_PATH:
            out['paths'] += [('drcog', ln) for ln in lines(r[-1])]
            cnt['drcog_path'] += 1
        elif ft in DRCOG_LANE:
            out['lanes'] += [('drcog', ln) for ln in lines(r[-1])]
            cnt['drcog_lane'] += 1
    for r in L['cos_bike']['rows']:
        if r[2] == 'Existing' and r[1] in COS_LANE:
            out['lanes'] += [('cos', ln) for ln in lines(r[-1])]
            cnt['cos_lane'] += 1
    for r in L['gj_bike']['rows']:
        if r[2] in GJ_PATH:
            out['paths'] += [('gj', ln) for ln in lines(r[-1])]
            cnt['gj_path'] += 1
        elif r[2] in GJ_LANE:
            out['lanes'] += [('gj', ln) for ln in lines(r[-1])]
            cnt['gj_lane'] += 1
    for r in L['drcog_sidewalks_2024']['rows']:
        t = r[1]
        ls = lines(r[-1])
        out['swcover']['drcog'] += ls
        if t in DRCOG_SIDEWALK:
            out['sidewalks'] += ls
            cnt['drcog_sidewalk'] += 1
        elif t == 'Possible Missing Sidewalk':
            out['missing'] += ls
            cnt['drcog_missing'] += 1
    for r in L['cos_sidewalks']['rows']:
        ls = lines(r[-1])
        out['swcover']['cos'] += ls
        out['sidewalks'] += ls
        cnt['cos_sidewalk'] += 1
    for r in L['cos_crosswalks']['rows']:
        out['swcover']['cos'] += lines(r[-1])
    out['counts'] = dict(cnt)
    out['layers'] = {k: {'name': LOCAL_LAYERS[k][2], 'url': LOCAL_LAYERS[k][0], 'page': LOCAL_LAYERS[k][3],
                         'features': L[k]['meta']['count'], 'fetched': L[k]['meta']['fetched'][:10]} for k in LOCAL_LAYERS}
    log('local layers', out['counts'])
    return out


def densify(lines, with_dir=False):
    """Points every DENSIFY metres along each line, in projected metres, and the length each point stands for
    (and, with_dir, the unit direction of the line at each point)."""
    segs = []
    for ln in lines:
        a = np.asarray(ln, dtype=float)[:, :2]
        if len(a) > 1:
            segs.append(np.column_stack([a[:-1], a[1:]]))
    if not segs:
        return (np.zeros((0, 2)), np.zeros(0)) + ((np.zeros((0, 2)),) if with_dir else ())
    S = np.concatenate(segs)
    p0, p1 = proj(S[:, 0], S[:, 1]), proj(S[:, 2], S[:, 3])
    L = np.hypot(*(p1 - p0).T)
    k = np.maximum(1, np.ceil(L / DENSIFY)).astype(np.int64)
    seg = np.repeat(np.arange(len(S)), k)
    start = np.repeat(np.cumsum(k) - k, k)
    t = (np.arange(len(seg)) - start + 0.5) / k[seg]
    xy = p0[seg] + (p1 - p0)[seg] * t[:, None]
    if with_dir:
        u = (p1 - p0) / np.maximum(L, 1e-9)[:, None]
        return xy, (L / k)[seg], u[seg]
    return xy, (L / k)[seg]


PARALLEL = math.cos(math.radians(25))  # a line counts as running along a street within 25 degrees


def near_along(net, edges, dense, dist):
    """True for each edge whose points at a quarter, half and three quarters of its length all lie within
    dist metres of the densified line, running the same way (within 25 degrees). A line that crosses the
    street, such as a freeway under a bridge or a sidewalk on the cross street, does not count."""
    pts, _, dirs = dense
    ok = np.zeros(len(edges), dtype=bool)
    if not len(edges) or not len(pts):
        return ok
    tree = cKDTree(pts)
    a, b = net.a[edges], net.b[edges]
    pa = proj(net.lon[a], net.lat[a])
    pb = proj(net.lon[b], net.lat[b])
    v = pb - pa
    v = v / np.maximum(np.hypot(v[:, 0], v[:, 1]), 1e-9)[:, None]
    ok[:] = True
    for f in (0.25, 0.5, 0.75):
        # The nearest few points, so a corner ramp or crosswalk nearest the street does not hide the
        # sidewalk running beside it.
        d, j = tree.query(pa + (pb - pa) * f, k=8, distance_upper_bound=dist)
        hit = np.isfinite(d)
        jj = np.where(hit, j, 0)
        par = hit & (np.abs((dirs[jj] * v[:, None, :]).sum(axis=2)) >= PARALLEL)
        ok &= par.any(axis=1)
    return ok


def add_paths(net: Net, paths, road_nodes):
    """Local off-street bike and walking paths: walk+bike edges (kind 5), ends joined to streets like trails."""
    ends = []
    for _, ln in paths:
        first = net.node(ln[0][0], ln[0][1])
        last = net.line(ln, 5)
        ends += [first, last]
    rn = np.array(sorted(road_nodes))
    tree = cKDTree(proj(np.array(net.lon)[rn], np.array(net.lat)[rn]))
    ends = np.array(sorted(set(e for e in ends if e not in road_nodes)))
    linked = 0
    if len(ends):
        d, j = tree.query(proj(np.array(net.lon)[ends], np.array(net.lat)[ends]), distance_upper_bound=TRAIL_LINK)
        for e, dd, jj in zip(ends, d, j):
            if np.isfinite(dd):
                net.a.append(int(e))
                net.b.append(int(rn[jj]))
                net.kind.append(3)
                net.cls.append(-1)
                linked += 1
    log('local paths', len(paths), 'ends linked', linked)


def cell_keys(xy):
    return (xy[:, 0] // CELL).astype(np.int64) * 1000003 + (xy[:, 1] // CELL).astype(np.int64)


def cells_of(xy):
    return np.unique(cell_keys(xy))


def in_cells(cells, xy):
    return np.isin(cell_keys(xy), cells)


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


def build_map(doc, trails, services, local):
    """Per-town map layers: service points, COTREX trails and local bike lanes and paths within about 500 m of the town outline."""
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
    from shapely.geometry import LineString
    bgeoms = [LineString(ln) for _, ln in local['lanes']] + [LineString(ln) for src, ln in local['paths'] if src != 'cdot']
    bkinds = ['l'] * len(local['lanes']) + ['p'] * (len(bgeoms) - len(local['lanes']))
    btree = STRtree(bgeoms)
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
        for gs_, ks_, tr_, out_ in ((tgeoms, tkinds, ttree, lines), (bgeoms, bkinds, btree, [])):
            for j in tr_.query(area):
                clip = gs_[j].intersection(area)
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
                        out_.append([ks_[j]] + cs)
            if out_ is not lines:
                lay['bikeways'] = out_
        lay['trails'] = lines
        mp[g] = lay
    meta = doc['meta']
    OUT_MAP.write_text(json.dumps({'meta': {'generated': meta['generated'], 'generated_by': meta['generated_by'],
                                            'note': 'Per-town map layers for the walk and bike page: service points, COTREX trails and local bike lanes (l) and paths (p) from the DRCOG, Colorado Springs and Grand Junction inventories, within about 500 m of each town outline (2024 Census place boundaries), simplified.',
                                            'sources': ['data/amenities/', 'data/market/health_centers_co.geojson', COTREX, 'data/co-place-boundaries.geojson'] +
                                                       [LOCAL_LAYERS[k][0] for k in ('drcog_bike', 'cos_bike', 'gj_bike')],
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
        build_map(load_json(OUT), trails, services, load_local(cache))
        return

    net = Net()
    road_files, road_nodes, road_counts = read_roads(cache, net)
    trails, trail_total, trail_edit = read_trails(cache)
    trail_kept = add_trails(net, trails, road_nodes)
    local = load_local(cache)
    add_paths(net, local['paths'], road_nodes)
    net.finish()
    log('network nodes', len(net.lon), 'edges', len(net.a), 'by kind', np.bincount(net.kind).tolist())

    # Street flags from the state and local layers.
    road = net.kind == 0
    R = np.where(road)[0]
    banned = np.zeros(len(net.a), dtype=bool)
    fac = np.zeros(len(net.a), dtype=bool)
    sidewalk = np.zeros(len(net.a), dtype=bool)
    banned[R] = near_along(net, R, densify(local['banned'], True), BANNED_NEAR) & (net.cls[R] != 4)
    fac[R] = near_along(net, R, densify([ln for _, ln in local['paths']] + [ln for _, ln in local['lanes']], True), BIKE_NEAR)
    sidewalk[R] = near_along(net, R, densify(local['sidewalks'], True), SIDEWALK_NEAR)
    cover = {k: cells_of(densify(v)[0]) for k, v in local['swcover'].items()}
    mid = proj((net.lon[net.a] + net.lon[net.b]) / 2, (net.lat[net.a] + net.lat[net.b]) / 2)
    log('streets closed to bikes', int(banned.sum()), 'with bike lane or path', int(fac.sum()), 'with sidewalk', int(sidewalk.sum()))

    # The stretches CDOT closes to bikes are all freeways, where walking is not allowed either. Interstates are
    # already out; this takes out any other TIGER street piece drawn along one of them.
    g_walk, _ = net.graph(None, np.isin(net.kind, [0, 1, 2, 3, 5]) & ~banned)
    g_bike, _ = net.graph(None, np.isin(net.kind, [0, 2, 3, 4, 5]) & ~banned)
    g_road, _ = net.graph(None, road & ~banned)
    g_road_bike = g_road
    # Calmer biking: local streets, trails and paths; a state or US highway only with a lane or path beside it.
    calm = np.isin(net.kind, [2, 3, 4, 5]) | (road & ~banned & (np.isin(net.cls, [2, 3, 4]) | ((net.cls == 1) & fac)))
    g_calm, _ = net.graph(None, calm)
    # Sidewalk walking: streets with a mapped sidewalk, walkways, trails and paths.
    g_side, _ = net.graph(None, np.isin(net.kind, [1, 2, 3, 5]) | (road & ~banned & (sidewalk | (net.cls == 4))))

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
    hxy = proj(hlon, hlat)
    hcov = {k: in_cells(c, hxy) for k, c in cover.items()}
    hcov_any = np.logical_or.reduce(list(hcov.values()))

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
                              ('walk_roads', g_road, WALK_10), ('bike_roads', g_road_bike, BIKE_15),
                              ('bike_calm', g_calm, BIKE_15), ('walk_side', g_side, WALK_10)):
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
        o['bike_calm'] = {s: round(100 * (res[s]['bike_calm'][rows] * h).sum() / tot, 1) for s in SERVICES}
        o['bike_calm_reach'] = round(sum(o['bike_calm'][s] for s in EVERYDAY) / len(EVERYDAY), 1)
        cv = round(100 * h[hcov_any[rows]].sum() / tot, 1)
        o['sidewalk_mapped_homes_pct'] = cv
        if cv >= SIDEWALK_MIN_COVER:
            o['sidewalk_source'] = max(hcov, key=lambda k: h[hcov[k][rows]].sum())
            o['walk_side'] = {s: round(100 * (res[s]['walk_side'][rows] * h).sum() / tot, 1) for s in SERVICES}
            o['walk_sidewalk_reach'] = round(sum(o['walk_side'][s] for s in EVERYDAY) / len(EVERYDAY), 1)
        else:
            o['sidewalk_source'] = None
            o['walk_side'] = None
            o['walk_sidewalk_reach'] = None
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

    # Street-length measures by town and county outline: sidewalk share, possible missing sidewalk,
    # mapped bike lanes and paths.
    import shapely
    cov_all = np.unique(np.concatenate(list(cover.values())))
    E = np.where(road & np.isin(net.cls, [1, 2]) & (net.w >= SIDEWALK_MIN_EDGE))[0]
    E = E[in_cells(cov_all, mid[E])]
    ept = shapely.points(mid[E][:, 0] / KX, mid[E][:, 1] / KY)
    mxy, mw = densify(local['missing'])
    mpt = shapely.points(mxy[:, 0] / KX, mxy[:, 1] / KY)
    lxy, lw = densify([ln for _, ln in local['paths'] if _ != 'cdot'] + [ln for _, ln in local['lanes']])
    lpt = shapely.points(lxy[:, 0] / KX, lxy[:, 1] / KY)

    def by_outline(feats, key):
        ids = [f['properties'][key] for f in feats if f.get('geometry')]
        t = STRtree([shape(f['geometry']) for f in feats if f.get('geometry')])

        def tot(pts, w):
            if not len(w):
                return np.zeros(len(ids))
            pr = t.query(pts, predicate='within')
            return np.bincount(pr[1], weights=w[pr[0]], minlength=len(ids))
        st = tot(ept, net.w[E])
        sw = tot(ept, net.w[E] * sidewalk[E])
        mi = tot(mpt, mw)
        bk = tot(lpt, lw)
        return {g: (st[i], sw[i], mi[i], bk[i]) for i, g in enumerate(ids)}
    edge_pl = by_outline(pb['features'], 'geoid')
    edge_ct = by_outline(cf['features'], 'GEOID')

    def bike_inventory(g, cty):
        return LOCAL_PLACES.get(g) or ('drcog' if cty in DRCOG_COUNTIES else None)
    for coll, eb, is_place in ((places, edge_pl, True), (counties, edge_ct, False)):
        for g, s_ in coll.items():
            st_, sw_, mi_, bk_ = eb.get(g, (0, 0, 0, 0))
            ok = s_['sidewalk_source'] is not None and st_ > 0
            s_['sidewalk_pct'] = round(100 * sw_ / st_, 1) if ok else None
            s_['street_km_mapped'] = round(st_ / 1000, 1) if ok else None
            s_['missing_sidewalk_km'] = round(mi_ / 1000, 1) if ok and s_['sidewalk_source'] == 'drcog' else None
            # A county counts as inventoried only in the DRCOG region; the two city inventories cover the city alone.
            inv = bike_inventory(g, s_['county']) if is_place else ('drcog' if g in DRCOG_COUNTIES else None)
            s_['bike_inventory'] = inv
            s_['bike_facility_km'] = round(bk_ / 1000, 1) if inv else None
    for k in ('sidewalk_pct', 'street_km_mapped', 'missing_sidewalk_km', 'bike_inventory', 'bike_facility_km'):
        state[k] = None

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
                 [round(100 * (res[s]['bike'][rows] * h).sum() / tot) for s in SERVICES] + \
                 [round(sum(100 * (res[s]['bike_calm'][rows] * h).sum() / tot for s in EVERYDAY) / 4, 1),
                  round(sum(100 * (res[s]['walk_side'][rows] * h).sum() / tot for s in EVERYDAY) / 4, 1)
                  if h[hcov_any[rows]].sum() >= SIDEWALK_MIN_COVER / 100 * tot else None]

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
        'not_modelled': ['hills', 'street crossings and traffic speed', 'bike lanes outside the DRCOG region, Colorado Springs and Grand Junction',
                         'sidewalks outside the DRCOG region and Colorado Springs', 'how often transit runs', 'door-to-door transit trips'],
        'bike_closed': ('Freeway stretches CDOT maps as Bicycles Prohibited are out of every walking and biking measure: '
                        '%d TIGER street pieces drawn along them (interstates themselves are already left out).' % int(banned.sum())),
        'bike_calm_definition': ('bike_calm_reach is bike_reach using only local streets (TIGER S1400 and smaller), trails and paths, plus state '
                                 'or US highways (S1200) with a mapped bike lane, separated lane, bike boulevard or path alongside. Shoulders '
                                 'and signed routes do not count. Outside the three bike inventories (bike_inventory) no S1200 counts, '
                                 'so it may understate where lanes exist but are not mapped.'),
        'sidewalk_definition': ('Reported only where at least %d%% of homes lie in %d m grid cells the sidewalk inventory covers. '
                                'sidewalk_pct is the share of street length (S1200 and S1400 pieces at least %d m long) with a mapped '
                                'sidewalk within %d m along it. walk_sidewalk_reach is walk_reach using only streets with a sidewalk, '
                                'walkways, trails and paths. missing_sidewalk_km is the length DRCOG marks Possible Missing Sidewalk.'
                                % (SIDEWALK_MIN_COVER, CELL, SIDEWALK_MIN_EDGE, SIDEWALK_NEAR)),
        'local_counts': local['counts'],
        'fields': {
            'walk / bike': 'share of homes (%) within a 10-minute walk / 15-minute ride of each service, by street and trail',
            'walk_roads / bike_roads': 'the same on streets only, so the difference is what trails add',
            'walk_straight / bike_straight': 'the same by straight-line distance, for comparison',
            'jobs_walk15 / jobs_bike15': 'jobs reachable in a 15-minute walk / ride (homes-weighted median)',
            'epa_walk_index': "EPA National Walkability Index (1 to 20), homes-weighted median of the 2010 block groups the place's homes fall in",
            'bike_calm / bike_calm_reach': 'share of homes within a 15-minute ride avoiding state and US highways without a bike lane or path',
            'walk_side / walk_sidewalk_reach': 'share of homes within a 10-minute walk on sidewalks, walkways, trails and paths (null where sidewalks are not mapped)',
            'sidewalk_mapped_homes_pct': 'share of homes inside the mapped sidewalk area',
            'sidewalk_source / bike_inventory': 'which local inventory covers the place: drcog, cos (Colorado Springs) or gj (Grand Junction)',
            'sidewalk_pct / street_km_mapped / missing_sidewalk_km': 'street length with a sidewalk (%), street length measured (km), DRCOG possible missing sidewalk (km)',
            'bike_facility_km': 'km of mapped bike lanes and local paths inside the town outline (local inventories only, not COTREX)',
            'blockGroups': 'by 2010 block group: [homes, walk_reach, bike_reach, transit_reach, jobs_walk15, jobs_bike15, walk % grocery, school, health, park, transit, bike % grocery, school, health, park, transit, bike_calm_reach, walk_sidewalk_reach]'},
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
        ] + [
            {'id': k.replace('_', '-'), 'name': v['name'], 'url': v['url'], 'page': v['page'], 'features': v['features'], 'fetched': v['fetched']}
            for k, v in local['layers'].items()
        ] + [
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

    build_map(doc, trails, services, local)


if __name__ == '__main__':
    main()
