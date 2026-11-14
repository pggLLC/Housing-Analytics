#!/usr/bin/env python3
"""
Build Colorado tract-to-tract drive times for market-area screening.

For every Census tract, the driving minutes from its 2020 population centre (the
Census Bureau's centre of population, where people live, so it sits near the roads
they use) to that of every other tract within RADIUS_MILES straight-line miles,
routed by OSRM over
OpenStreetMap (the same router and terms as build_travel_time_matrix.py). The
Market check reads it in the browser to say how far each tract is from a site by
road, so a market area does not take in tracts a mountain range or a long detour
cuts off. Nothing is sent anywhere at run time: the file is built here, offline.

Output: data/market/tract_drive_times_co.json
  meta    provenance, router, radius, counts
  tracts  [geoid, ...]                       index order
  points  [[lat, lon], ...]                  each tract's routing point, same order, so a page can
                                               start from the point nearest a site
  from    {geoid: [[to_index, minutes], ...]}  minutes to one decimal, from the
                                               tract's population centre to each other tract

Usage: python3 scripts/market/build_tract_drive_times.py [--router-url URL] [--sleep 1.0] [--recheck-only FILE]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import time
import urllib.request
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
CENTROIDS_PATH = ROOT / "data" / "market" / "tract_centroids_co.json"
OUT_PATH = ROOT / "data" / "market" / "tract_drive_times_co.json"
CENPOP_URL = "https://www2.census.gov/geo/docs/reference/cenpop2020/tract/CenPop2020_Mean_TR08.txt"
DEFAULT_OSRM_TABLE_URL = "https://router.project-osrm.org/table/v1/driving"
RADIUS_MILES = 15.0
CELL_MILES = 15.0
RECHECK_MINUTES = 20
RECHECK_PER_MILE = 6
BLOCK = 50  # sources and destinations per request: 100 coordinates, the public router's table limit


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
        except Exception as exc:  # pragma: no cover - live network path
            last = exc
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"router request failed: {last}")


def population_centres(url):
    """Census 2020 centres of population by tract: {geoid: (lat, lon, population)}."""
    req = urllib.request.Request(url, headers={"User-Agent": "HousingAnalytics/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        text = resp.read().decode("utf-8-sig")
    out = {}
    for line in text.splitlines()[1:]:
        p = [x.strip() for x in line.split(",")]
        if len(p) >= 6 and p[0]:
            out[p[0] + p[1] + p[2]] = (float(p[4]), float(p[5]), int(p[3]))
    return out


def chunks(items, n):
    for i in range(0, len(items), n):
        yield items[i:i + n]


def build(router_url, sleep_seconds):
    doc = json.loads(CENTROIDS_PATH.read_text(encoding="utf-8"))
    pop = population_centres(CENPOP_URL)
    tracts = []
    from_internal = 0
    for t in doc["tracts"]:
        c = pop.get(t["geoid"])
        if c and c[2] > 0:
            tracts.append({"geoid": t["geoid"], "lat": c[0], "lon": c[1]})
        elif t.get("lat") is not None and t.get("lon") is not None:
            # No residents in 2020: the tract's TIGER internal point.
            tracts.append({"geoid": t["geoid"], "lat": t["lat"], "lon": t["lon"]})
            from_internal += 1
    tracts.sort(key=lambda t: t["geoid"])
    index = {t["geoid"]: i for i, t in enumerate(tracts)}
    # Group sources into grid cells so each request's sources share most of their neighbours.
    lat0 = min(t["lat"] for t in tracts)
    lon0 = min(t["lon"] for t in tracts)
    deg_lat = CELL_MILES / 69.0
    deg_lon = CELL_MILES / 53.0
    cells = {}
    for t in tracts:
        key = (int((t["lat"] - lat0) / deg_lat), int((t["lon"] - lon0) / deg_lon))
        cells.setdefault(key, []).append(t)
    out = {t["geoid"]: {} for t in tracts}
    requests = 0
    unroutable = 0
    for key in sorted(cells):
        for src in chunks(cells[key], BLOCK):
            # Every tract within the radius of any source in this block.
            near = [t for t in tracts if any(haversine_miles(s["lat"], s["lon"], t["lat"], t["lon"]) <= RADIUS_MILES for s in src)]
            for dst in chunks(near, BLOCK):
                coords = src + dst
                url = (router_url.rstrip("/") + "/" + ";".join(f"{c['lon']:.6f},{c['lat']:.6f}" for c in coords)
                       + "?annotations=duration"
                       + "&sources=" + ";".join(str(i) for i in range(len(src)))
                       + "&destinations=" + ";".join(str(len(src) + j) for j in range(len(dst))))
                data = request_json(url)
                requests += 1
                if data.get("code") != "Ok":
                    raise RuntimeError(f"router answered {data.get('code')}: {data.get('message')}")
                for i, s in enumerate(src):
                    row = data["durations"][i]
                    for j, d in enumerate(dst):
                        if d["geoid"] == s["geoid"]:
                            continue
                        if haversine_miles(s["lat"], s["lon"], d["lat"], d["lon"]) > RADIUS_MILES:
                            continue
                        sec = row[j]
                        if sec is None:
                            unroutable += 1
                            continue
                        out[s["geoid"]][index[d["geoid"]]] = round(sec / 60.0, 1)
                if sleep_seconds:
                    time.sleep(sleep_seconds)
    pairs = sum(len(v) for v in out.values())
    now = datetime.now(timezone.utc).replace(microsecond=0)
    return {
        "meta": {
            "title": "Drive times between nearby Colorado census tracts",
            "generated": now.isoformat().replace("+00:00", "Z"),
            "as_of": date.today().isoformat(),
            "review_by": (date.today() + timedelta(days=365)).isoformat(),
            "generated_by": "scripts/market/build_tract_drive_times.py",
            "source": "OpenStreetMap road network routed by OSRM (driving profile), tract population centre to tract population centre",
            "points_source": "U.S. Census Bureau, 2020 Centers of Population by census tract, Colorado",
            "points_source_url": CENPOP_URL,
            "points_from_internal_point": from_internal,
            "router": {"engine": "OSRM Table API", "profile": "driving", "source_url": router_url},
            "tract_source": "data/market/tract_centroids_co.json",
            "tract_centroids_generated": doc.get("meta", {}).get("generated"),
            "radius_miles": RADIUS_MILES,
            "tract_count": len(tracts),
            "pair_count": pairs,
            "unroutable_pairs": unroutable,
            "requests": requests,
            "units": "minutes, to one decimal, free-flow driving (no traffic)",
            "odbl_notice": "Contains information from OpenStreetMap and OpenStreetMap Foundation, made available under the Open Database License.",
            "osm_copyright_url": "https://www.openstreetmap.org/copyright",
            "limitations": [
                "Population centre to population centre: a site at the edge of a large rural tract may be some minutes nearer or farther.",
                "Tracts with no 2020 residents use the TIGER internal point, which can sit far from a public road.",
                "Free-flow times from the road network; no traffic, season or road closures.",
                "Pairs farther apart than the radius in a straight line are not stored.",
            ],
        },
        "tracts": [t["geoid"] for t in tracts],
        "points": [[round(t["lat"], 5), round(t["lon"], 5)] for t in tracts],
        "from": {g: [[j, m] for j, m in sorted(v.items())] for g, v in out.items()},
    }


def recheck(payload, router_url, sleep_seconds):
    """Second pass on suspiciously long pairs.

    A routing point can land on a road cut off from the network nearby (a gated street, a base, a forest road), and
    the router then goes a long way round. For every pair over RECHECK_MINUTES and more than RECHECK_PER_MILE minutes
    per straight-line mile, route again from each tract's population centre and its TIGER internal point, and keep
    the shortest of the four. A real barrier (a canyon, a range) stays long from both points; a bad snap does not.
    """
    doc = json.loads(CENTROIDS_PATH.read_text(encoding="utf-8"))
    internal = {t["geoid"]: (t["lat"], t["lon"]) for t in doc["tracts"] if t.get("lat") is not None}
    tracts, points = payload["tracts"], payload["points"]
    pairs = {}
    for g, row in payload["from"].items():
        i = tracts.index(g)
        for j, m in row:
            mi = haversine_miles(points[i][0], points[i][1], points[j][0], points[j][1])
            if m > RECHECK_MINUTES and m / max(mi, 0.5) > RECHECK_PER_MILE:
                pairs.setdefault(g, []).append(j)
    rechecked = shortened = requests = 0
    for g, js in sorted(pairs.items()):
        i = tracts.index(g)
        src = [tuple(points[i])] + ([internal[g]] if g in internal else [])
        for part in chunks(js, (100 - len(src)) // 2):
            dst = []
            for j in part:
                dst.append(tuple(points[j]))
                dst.append(internal.get(tracts[j], tuple(points[j])))
            coords = src + dst
            url = (router_url.rstrip("/") + "/" + ";".join(f"{c[1]:.6f},{c[0]:.6f}" for c in coords)
                   + "?annotations=duration"
                   + "&sources=" + ";".join(str(k) for k in range(len(src)))
                   + "&destinations=" + ";".join(str(len(src) + k) for k in range(len(dst))))
            data = request_json(url)
            requests += 1
            if data.get("code") != "Ok":
                raise RuntimeError(f"router answered {data.get('code')}: {data.get('message')}")
            row = dict((j, m) for j, m in payload["from"][g])
            for n, j in enumerate(part):
                secs = [data["durations"][a][2 * n + b] for a in range(len(src)) for b in range(2)]
                secs = [x for x in secs if x is not None]
                rechecked += 1
                if secs:
                    best = round(min(secs) / 60.0, 1)
                    if best < row[j]:
                        row[j] = best
                        shortened += 1
            payload["from"][g] = [[j, m] for j, m in sorted(row.items())]
            if sleep_seconds:
                time.sleep(sleep_seconds)
    m = payload["meta"]
    m["recheck"] = {
        "rule": f"pairs over {RECHECK_MINUTES} minutes and more than {RECHECK_PER_MILE} minutes per straight-line mile, routed again from each tract's population centre and internal point; shortest kept",
        "pairs_rechecked": rechecked,
        "pairs_shortened": shortened,
        "requests": requests,
    }
    return payload


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--router-url", default=os.environ.get("TRACT_DRIVE_TIMES_ROUTER_URL", DEFAULT_OSRM_TABLE_URL))
    parser.add_argument("--sleep", type=float, default=float(os.environ.get("TRACT_DRIVE_TIMES_SLEEP", "1.0")))
    parser.add_argument("--out", default=str(OUT_PATH))
    parser.add_argument("--recheck-only", metavar="FILE", help="run only the second pass on an existing output file")
    args = parser.parse_args(argv)
    if args.recheck_only:
        payload = json.loads(Path(args.recheck_only).read_text(encoding="utf-8"))
    else:
        payload = build(args.router_url, args.sleep)
    payload = recheck(payload, args.router_url, args.sleep)
    Path(args.out).write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    m = payload["meta"]
    print(f"tract drive times: {m['pair_count']} pairs, {m['tract_count']} tracts, {m['requests']} requests, {m['unroutable_pairs']} unroutable; "
          f"rechecked {m['recheck']['pairs_rechecked']}, shortened {m['recheck']['pairs_shortened']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
