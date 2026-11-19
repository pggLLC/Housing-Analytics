#!/usr/bin/env python3
"""
Build, for every Colorado census tract, how much of each nearby tract's population lives within a 10-, 15- and
20-minute drive of it.

Why (paul, 17-18 Nov 2026): a CHFA market area is whole census tracts, and the case for each tract is where its people
live and how far they drive. A tract's centre point says little about a large rural tract: Bayfield's tract 9706.01 is
32.5 minutes centre to centre (data/market/tract_drive_times_co.json) while 68% of its people live within 20 minutes of
town. So this file counts people, not centres: every 2020 Census block with residents is grouped into small cells
(about 2 km, never crossing a tract line, placed at the population-weighted centre of their blocks) and each cell is
routed by road from each tract's 2020 population centre (the routing points of tract_drive_times_co.json) and from each
town's and CDP's internal point (TIGER 2020 places). A site takes the nearest of these points: a town's own point for a
site in town, since a rural tract's population centre can sit miles out of town (Bayfield's tract 9706.02 centre is
4.6 miles north of the town).

It is reasons for picking whole tracts, not a market area of its own: Market check and the full Market Analysis still
count renters and tax credit homes by whole tract.

Output: data/market/tract_drive_bands_co.json
  meta    provenance, router, cell size, radius, counts, limitations
  tracts  [geoid, ...]                     same order as tract_drive_times_co.json
  pop     [2020 population, ...]           same order (2020 Census blocks, POP20)
  points  [[lat, lon], ...]                same order: each tract's routing point (its 2020 population centre)
  places  [[geoid, name, lat, lon], ...]   towns and CDPs, routed from their TIGER 2020 internal point
  from    {origin: [[to_index, p10, p15, p20], ...]}
          origin is a tract geoid (11 digits) or a place geoid (7 digits); whole percent of the destination tract's
          2020 population whose cell is within 10, 15 and 20 minutes' free-flow drive of the origin's point; only pairs
          with any population within 20 minutes.

Usage: python3 scripts/market/build_tract_drive_bands.py [--router-url URL] [--sleep 1.0] [--blocks-zip PATH]
                                                          [--places-zip PATH] [--checkpoint PATH]
"""

from __future__ import annotations

import argparse
import io
import json
import math
import os
import struct
import time
import urllib.request
import zipfile
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DRIVE_PATH = ROOT / "data" / "market" / "tract_drive_times_co.json"
OUT_PATH = ROOT / "data" / "market" / "tract_drive_bands_co.json"
BLOCKS_URL = "https://www2.census.gov/geo/tiger/TIGER2020/TABBLOCK20/tl_2020_08_tabblock20.zip"
PLACES_URL = "https://www2.census.gov/geo/tiger/TIGER2020/PLACE/tl_2020_08_place.zip"
DEFAULT_OSRM_TABLE_URL = "https://router.project-osrm.org/table/v1/driving"
BANDS = (10, 15, 20)
RADIUS_MILES = 20.0      # straight-line reach of a cell from an origin: past 20 miles no cell is within 20 minutes
CELL_DEG = 0.02          # cell size, degrees (about 2.2 km north-south, 1.7 km east-west in Colorado)
GROUP = 30               # origins per request group; destinations fill the rest of the router's 100 coordinates
MAX_COORDS = 100


def haversine_miles(lat1, lon1, lat2, lon2):
    r = 3958.8
    p = math.pi / 180
    a = math.sin((lat2 - lat1) * p / 2) ** 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def request_json(url, retries=4, timeout=120):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "HousingAnalytics/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # network errors and router hiccups are retried, then raised
            last = exc
            time.sleep(3 * (attempt + 1))
    raise RuntimeError("router request failed after %d tries: %s" % (retries, last))


def read_blocks(zip_bytes):
    """Populated 2020 blocks as (tract geoid, population, lat, lon), from the TIGER file's attribute table."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        name = [n for n in z.namelist() if n.endswith(".dbf")][0]
        data = z.read(name)
    n = struct.unpack("<I", data[4:8])[0]
    hlen, rlen = struct.unpack("<HH", data[8:12])
    fields, pos = [], 32
    while data[pos] != 0x0D:
        d = data[pos:pos + 32]
        fields.append((d[:11].split(b"\0")[0].decode(), d[16]))
        pos += 32
    want = {"GEOID20", "POP20", "INTPTLAT20", "INTPTLON20"}
    out = []
    for i in range(n):
        r = data[hlen + i * rlen: hlen + (i + 1) * rlen]
        p, rec = 1, {}
        for fname, ln in fields:
            if fname in want:
                rec[fname] = r[p:p + ln].decode("latin1").strip()
            p += ln
        pop = int(rec["POP20"] or 0)
        if pop > 0:
            out.append((rec["GEOID20"][:11], pop, float(rec["INTPTLAT20"]), float(rec["INTPTLON20"])))
    if len(out) < 90000:
        raise RuntimeError("only %d populated blocks read; the TIGER file looks wrong" % len(out))
    return out


def read_dbf_rows(zip_bytes, want):
    """Rows of a TIGER file's attribute table, only the fields asked for."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        data = z.read([n for n in z.namelist() if n.endswith(".dbf")][0])
    n = struct.unpack("<I", data[4:8])[0]
    hlen, rlen = struct.unpack("<HH", data[8:12])
    fields, pos = [], 32
    while data[pos] != 0x0D:
        d = data[pos:pos + 32]
        fields.append((d[:11].split(b"\0")[0].decode(), d[16]))
        pos += 32
    out = []
    for i in range(n):
        r = data[hlen + i * rlen: hlen + (i + 1) * rlen]
        p, rec = 1, {}
        for fname, ln in fields:
            if fname in want:
                rec[fname] = r[p:p + ln].decode("latin1").strip()
            p += ln
        out.append(rec)
    return out


def read_places(zip_bytes):
    """Colorado towns and CDPs as (geoid, name, lat, lon) at their TIGER internal point."""
    rows = read_dbf_rows(zip_bytes, {"GEOID", "NAMELSAD", "INTPTLAT", "INTPTLON"})
    out = [(r["GEOID"], r["NAMELSAD"], round(float(r["INTPTLAT"]), 5), round(float(r["INTPTLON"]), 5)) for r in rows]
    if len(out) < 400:
        raise RuntimeError("only %d places read; the TIGER place file looks wrong" % len(out))
    return sorted(out)


def make_cells(blocks):
    cells = {}
    for tract, pop, lat, lon in blocks:
        key = (tract, round(lat / CELL_DEG), round(lon / CELL_DEG))
        c = cells.setdefault(key, [tract, 0, 0.0, 0.0])
        c[1] += pop
        c[2] += lat * pop
        c[3] += lon * pop
    return [(t, p, round(la / p, 5), round(lo / p, 5)) for t, p, la, lo in cells.values()]


def fetch_bytes(url):
    req = urllib.request.Request(url, headers={"User-Agent": "HousingAnalytics/1.0"})
    with urllib.request.urlopen(req, timeout=600) as resp:
        return resp.read()


def build(router_url, sleep_seconds, blocks_zip, places_zip=None, checkpoint=None):
    drive = json.loads(DRIVE_PATH.read_text())
    tracts, points = drive["tracts"], drive["points"]
    index = {g: i for i, g in enumerate(tracts)}
    blocks = read_blocks(Path(blocks_zip).read_bytes() if blocks_zip else fetch_bytes(BLOCKS_URL))
    places = read_places(Path(places_zip).read_bytes() if places_zip else fetch_bytes(PLACES_URL))
    tract_pop = {}
    for t, p, _, _ in blocks:
        tract_pop[t] = tract_pop.get(t, 0) + p
    cells = make_cells(blocks)
    # A coarse grid so each origin looks only at cells near it.
    grid = {}
    for i, (_, _, la, lo) in enumerate(cells):
        grid.setdefault((math.floor(la * 2), math.floor(lo * 2)), []).append(i)

    def near(lat, lon):
        out = []
        for a in (-1, 0, 1):
            for b in (-1, 0, 1):
                for i in grid.get((math.floor(lat * 2) + a, math.floor(lon * 2) + b), ()):
                    if haversine_miles(lat, lon, cells[i][2], cells[i][3]) <= RADIUS_MILES:
                        out.append(i)
        return out

    # Origins: every tract's population centre, then every place's internal point. Each set in a serpentine order by
    # latitude band, so a group of origins shares most of its cells.
    origins = [(g, points[k][0], points[k][1]) for k, g in enumerate(tracts)] + [(g, la, lo) for g, _, la, lo in places]
    serp = lambda k: (math.floor(origins[k][1] * 10), (1 if math.floor(origins[k][1] * 10) % 2 == 0 else -1) * origins[k][2])
    order = sorted(range(len(tracts)), key=serp) + sorted(range(len(tracts), len(origins)), key=serp)
    within = {o[0]: {} for o in origins}   # origin -> {dest tract: [pop10, pop15, pop20]}
    requests, start = 0, 0
    # A long run can be stopped and picked up again: progress is saved after every group of origins.
    if checkpoint and Path(checkpoint).exists():
        saved = json.loads(Path(checkpoint).read_text())
        if saved.get("cells") == len(cells) and saved.get("router") == router_url:
            within.update(saved["within"])
            requests, start = saved["requests"], saved["next"]
            print("resuming at origin %d, %d requests done" % (start, requests), flush=True)
    for s in range(start, len(order), GROUP):
        grp = order[s:s + GROUP]
        dests = sorted(set(i for k in grp for i in near(origins[k][1], origins[k][2])))
        per = MAX_COORDS - len(grp)
        for d0 in range(0, len(dests), per):
            chunk = dests[d0:d0 + per]
            coords = [(origins[k][2], origins[k][1]) for k in grp] + [(cells[i][3], cells[i][2]) for i in chunk]
            url = (router_url.rstrip("/") + "/" + ";".join("%.5f,%.5f" % c for c in coords) +
                   "?sources=" + ";".join(str(x) for x in range(len(grp))) +
                   "&destinations=" + ";".join(str(len(grp) + x) for x in range(len(chunk))) +
                   "&annotations=duration")
            res = request_json(url)
            requests += 1
            if res.get("code") != "Ok":
                raise RuntimeError("router answered %s: %s" % (res.get("code"), res.get("message")))
            for si, k in enumerate(grp):
                row = res["durations"][si]
                o = origins[k][0]
                for di, ci in enumerate(chunk):
                    sec = row[di]
                    if sec is None or sec > BANDS[-1] * 60:
                        continue
                    t, pop = cells[ci][0], cells[ci][1]
                    acc = within[o].setdefault(t, [0, 0, 0])
                    for b, lim in enumerate(BANDS):
                        if sec <= lim * 60:
                            acc[b] += pop
            if sleep_seconds:
                time.sleep(sleep_seconds)
        if checkpoint:
            tmp = Path(str(checkpoint) + ".tmp")
            tmp.write_text(json.dumps({"cells": len(cells), "router": router_url, "next": s + GROUP,
                                       "requests": requests, "within": within}))
            tmp.replace(checkpoint)
        print("origins %d/%d, requests %d" % (min(s + GROUP, len(order)), len(order), requests), flush=True)

    out_from, pairs = {}, 0
    for o in [x[0] for x in origins]:
        rows = []
        for t, acc in within[o].items():
            if t not in index or not tract_pop.get(t):
                continue
            pct = [min(100, round(100 * x / tract_pop[t])) for x in acc]
            if pct[-1] > 0:
                rows.append([index[t]] + pct)
        rows.sort(key=lambda r: (-r[3], r[0]))
        out_from[o] = rows
        pairs += len(rows)
    today = date.today()
    return {
        "meta": {
            "title": "Share of each nearby tract's people within a 10-, 15- and 20-minute drive",
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "as_of": today.isoformat(),
            "review_by": (today + timedelta(days=365)).isoformat(),
            "generated_by": "scripts/market/build_tract_drive_bands.py",
            "source": "OpenStreetMap road network routed by OSRM (driving profile), from each tract's 2020 population "
                      "centre to population-weighted cells of 2020 Census blocks",
            "blocks_source": "U.S. Census Bureau, TIGER/Line 2020 tabulation blocks, Colorado (POP20, internal points)",
            "blocks_source_url": BLOCKS_URL,
            "origins": "each tract's 2020 population centre (the points of data/market/tract_drive_times_co.json) and each "
                       "town's and CDP's TIGER 2020 internal point",
            "places_source_url": PLACES_URL,
            "place_count": len(places),
            "router": {"engine": "OSRM Table API", "profile": "driving", "source_url": DEFAULT_OSRM_TABLE_URL},
            "bands_minutes": list(BANDS),
            "cell_degrees": CELL_DEG,
            "radius_miles": RADIUS_MILES,
            "cells": len(cells),
            "populated_blocks": len(blocks),
            "population": sum(tract_pop.values()),
            "tract_count": len(tracts),
            "pair_count": pairs,
            "requests": requests,
            "units": "whole percent of the destination tract's 2020 population; free-flow driving, no traffic",
            "odbl_notice": "Contains information from OpenStreetMap and OpenStreetMap Foundation, made available under "
                           "the Open Database License.",
            "osm_copyright_url": "https://www.openstreetmap.org/copyright",
            "limitations": [
                "From the nearest origin point (a tract's population centre or a town's internal point): a site some "
                "way from every such point may be some minutes nearer to or farther from a given tract.",
                "Blocks are grouped into cells of about 2 km inside each tract; a cell's people share one drive time.",
                "2020 Census population; growth since 2020 is not in the shares.",
                "Free-flow times from the road network; no traffic, season or road closures.",
                "Cells more than 20 straight-line miles from the origin are not routed.",
            ],
        },
        "tracts": tracts,
        "pop": [tract_pop.get(g, 0) for g in tracts],
        "points": [[round(p[0], 5), round(p[1], 5)] for p in points],
        "places": [list(p) for p in places],
        "from": out_from,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--router-url", default=os.environ.get("OSRM_TABLE_URL", DEFAULT_OSRM_TABLE_URL))
    parser.add_argument("--sleep", type=float, default=float(os.environ.get("TRACT_DRIVE_BANDS_SLEEP", "1.0")))
    parser.add_argument("--blocks-zip", default=None, help="a local copy of the TIGER 2020 Colorado block file")
    parser.add_argument("--places-zip", default=None, help="a local copy of the TIGER 2020 Colorado place file")
    parser.add_argument("--checkpoint", default=None, help="save progress here after each group, and resume from it")
    args = parser.parse_args(argv)
    payload = build(args.router_url, args.sleep, args.blocks_zip, args.places_zip, args.checkpoint)
    OUT_PATH.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    print("wrote %s: %d tracts, %d pairs, %d requests" % (OUT_PATH.relative_to(ROOT), payload["meta"]["tract_count"],
                                                          payload["meta"]["pair_count"], payload["meta"]["requests"]))


if __name__ == "__main__":
    main()
