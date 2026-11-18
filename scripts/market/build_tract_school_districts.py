#!/usr/bin/env python3
"""
Build each Colorado census tract's share of 2020 population by public school district.

CHFA's Market Study Guide (2027-28 QAP, Appendix A, "Identification of Market Boundaries") lists school district
boundaries among the things a primary market area should take into account. Market check shows, for each tract it
suggests, how much of the tract's population is in the site's school district. Every populated 2020 Census block is
placed by its internal point in a TIGER 2024 unified school district (Colorado has only unified districts).

Output: data/market/tract_school_districts_co.json
  meta       provenance, counts
  districts  [[geoid, name], ...]                        index order
  tracts     {tract geoid: [[district_index, percent], ...]}   whole percent of the tract's 2020 population, largest first

Usage: python3 scripts/market/build_tract_school_districts.py [--blocks-zip PATH] [--districts-zip PATH]
"""

from __future__ import annotations

import argparse
import io
import json
import struct
import urllib.request
import zipfile
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

from build_tract_drive_bands import BLOCKS_URL, read_blocks

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_PATH = ROOT / "data" / "market" / "tract_school_districts_co.json"
DISTRICTS_URL = "https://www2.census.gov/geo/tiger/TIGER2024/UNSD/tl_2024_08_unsd.zip"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "HousingAnalytics/1.0"})
    with urllib.request.urlopen(req, timeout=600) as resp:
        return resp.read()


def read_dbf(data):
    n = struct.unpack("<I", data[4:8])[0]
    hlen, rlen = struct.unpack("<HH", data[8:12])
    fields, pos = [], 32
    while data[pos] != 0x0D:
        d = data[pos:pos + 32]
        fields.append((d[:11].split(b"\0")[0].decode(), d[16]))
        pos += 32
    recs = []
    for i in range(n):
        r = data[hlen + i * rlen: hlen + (i + 1) * rlen]
        p, rec = 1, {}
        for name, ln in fields:
            rec[name] = r[p:p + ln].decode("latin1").strip()
            p += ln
        recs.append(rec)
    return recs


def read_polygons(shp):
    """Polygon records of a shapefile as (bbox, rings); every ring is kept, and the even-odd test handles holes."""
    out, off = [], 100
    while off < len(shp):
        _, clen = struct.unpack(">II", shp[off:off + 8])
        body = shp[off + 8: off + 8 + clen * 2]
        off += 8 + clen * 2
        if struct.unpack("<i", body[:4])[0] != 5:
            out.append(None)
            continue
        bbox = struct.unpack("<4d", body[4:36])
        npart, npt = struct.unpack("<ii", body[36:44])
        parts = list(struct.unpack("<%di" % npart, body[44:44 + 4 * npart])) + [npt]
        p0 = 44 + 4 * npart
        pts = [struct.unpack("<2d", body[p0 + 16 * k: p0 + 16 * k + 16]) for k in range(npt)]
        out.append((bbox, [pts[parts[k]:parts[k + 1]] for k in range(npart)]))
    return out


def inside(x, y, rings):
    ins = False
    for ring in rings:
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                ins = not ins
            j = i
    return ins


def build(blocks_zip, districts_zip):
    blocks = read_blocks(Path(blocks_zip).read_bytes() if blocks_zip else fetch(BLOCKS_URL))
    zb = Path(districts_zip).read_bytes() if districts_zip else fetch(DISTRICTS_URL)
    with zipfile.ZipFile(io.BytesIO(zb)) as z:
        dbf = z.read([n for n in z.namelist() if n.endswith(".dbf")][0])
        shp = z.read([n for n in z.namelist() if n.endswith(".shp")][0])
    recs, polys = read_dbf(dbf), read_polygons(shp)
    districts = [(r["GEOID"], r["NAME"]) for r in recs]
    tract_pop, by = {}, {}
    unplaced = 0
    for tract, pop, lat, lon in blocks:
        tract_pop[tract] = tract_pop.get(tract, 0) + pop
        hit = None
        for k, pg in enumerate(polys):
            if not pg:
                continue
            b = pg[0]
            if b[0] <= lon <= b[2] and b[1] <= lat <= b[3] and inside(lon, lat, pg[1]):
                hit = k
                break
        if hit is None:
            unplaced += pop
            continue
        d = by.setdefault(tract, {})
        d[hit] = d.get(hit, 0) + pop
    out = {}
    for tract, d in by.items():
        rows = [[k, round(100 * p / tract_pop[tract])] for k, p in d.items()]
        rows = [r for r in rows if r[1] > 0]
        rows.sort(key=lambda r: -r[1])
        out[tract] = rows
    today = date.today()
    return {
        "meta": {
            "title": "Each census tract's 2020 population by public school district",
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "as_of": today.isoformat(),
            "review_by": (today + timedelta(days=365)).isoformat(),
            "generated_by": "scripts/market/build_tract_school_districts.py",
            "districts_source": "U.S. Census Bureau, TIGER/Line 2024 unified school districts, Colorado",
            "districts_source_url": DISTRICTS_URL,
            "blocks_source": "U.S. Census Bureau, TIGER/Line 2020 tabulation blocks, Colorado (POP20, internal points)",
            "blocks_source_url": BLOCKS_URL,
            "district_count": len(districts),
            "tract_count": len(out),
            "population": sum(tract_pop.values()),
            "population_not_in_a_district": unplaced,
            "units": "whole percent of the tract's 2020 population; shares under 0.5% are left out",
            "why": "CHFA 2027-28 QAP, Appendix A, Identification of Market Boundaries: school district boundaries are "
                   "among the things a primary market area should take into account.",
        },
        "districts": [list(d) for d in districts],
        "tracts": out,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--blocks-zip", default=None)
    parser.add_argument("--districts-zip", default=None)
    args = parser.parse_args(argv)
    payload = build(args.blocks_zip, args.districts_zip)
    OUT_PATH.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    print("wrote %s: %d districts, %d tracts, %d people outside any district" % (
        OUT_PATH.relative_to(ROOT), payload["meta"]["district_count"], payload["meta"]["tract_count"],
        payload["meta"]["population_not_in_a_district"]))


if __name__ == "__main__":
    main()
