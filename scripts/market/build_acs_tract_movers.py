#!/usr/bin/env python3
"""
Build, for every Colorado census tract, how many people in rented homes moved in from another county, another state
or abroad in the past year (ACS 5-year table B07013, geographical mobility by tenure).

CHFA counts in-migration in a demand table only "when it is demonstrated from other comparable projects" (2027-28
QAP, Appendix A). Market check shows this figure as context for each tract and area, never in a capture rate. It
counts people, not households, and tract margins are wide; both are in the file.

Output: data/market/acs_tract_movers_co.json
  meta    provenance, vintage, table, fields
  tracts  {geoid: [renter_people, same_county, other_county, other_state, abroad, moe_from_outside]}
          people in renter-occupied homes, by where they lived a year earlier; moe_from_outside is the 90% margin of
          error of other_county + other_state + abroad (root of the sum of squares). null where the Census
          published no estimate.

Usage: python3 scripts/market/build_acs_tract_movers.py [--year 2024]
"""

from __future__ import annotations

import argparse
import json
import math
import urllib.request
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_PATH = ROOT / "data" / "market" / "acs_tract_movers_co.json"
API = "https://data.census.gov/api/access/data/table?id=ACSDT5Y{year}.B07013&g=040XX00US08$1400000"
# B07013 renter-occupied rows: 003 total, 006 same house, 009 moved within the county, 012 from another county in
# the state, 015 from another state, 018 from abroad.
FIELDS = {"renter_people": "003", "same_county": "009", "other_county": "012", "other_state": "015", "abroad": "018"}


def fetch(year):
    url = API.format(year=year)
    req = urllib.request.Request(url, headers={"User-Agent": "HousingAnalytics/1.0"})
    with urllib.request.urlopen(req, timeout=180) as resp:
        return json.loads(resp.read().decode("utf-8")), url


def num(v):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return None if x < 0 else int(round(x))  # the Census marks a missing estimate with a negative sentinel


def build(year):
    payload, url = fetch(year)
    rows = payload["response"]["data"]
    head = rows[0]
    at = {k: head.index(k) for k in head}
    out = {}
    for r in rows[1:]:
        geo = r[at["GEO_ID"]]
        g = geo[-11:]
        if not g.startswith("08") or len(g) != 11:
            continue
        vals = [num(r[at["B07013_%sE" % FIELDS[k]]]) for k in ("renter_people", "same_county", "other_county", "other_state", "abroad")]
        moes = [num(r[at["B07013_%sM" % FIELDS[k]]]) for k in ("other_county", "other_state", "abroad")]
        moe = None if any(m is None for m in moes) else int(round(math.sqrt(sum(m * m for m in moes))))
        out[g] = vals + [moe]
    if len(out) < 1400:
        raise RuntimeError("only %d Colorado tracts in the answer" % len(out))
    today = date.today()
    return {
        "meta": {
            "title": "People in rented homes who moved in from another county, state or abroad in the past year, by tract",
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "as_of": today.isoformat(),
            "review_by": (today + timedelta(days=365)).isoformat(),
            "generated_by": "scripts/market/build_acs_tract_movers.py",
            "source": "U.S. Census Bureau, American Community Survey %d-%d 5-year estimates, table B07013" % (year - 4, year),
            "source_url": url,
            "vintage": str(year),
            "fields": ["renter_people", "same_county", "other_county", "other_state", "abroad", "moe_from_outside"],
            "universe": "Population 1 year and over in households in renter-occupied housing units (people, not households)",
            "use": "Context only. CHFA counts in-migration only when shown from comparable projects (2027-28 QAP, "
                   "Appendix A); this is never added to a capture rate.",
            "tract_count": len(out),
        },
        "tracts": out,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--year", type=int, default=2024)
    args = parser.parse_args(argv)
    payload = build(args.year)
    OUT_PATH.write_text(json.dumps(payload, separators=(",", ":")) + "\n")
    print("wrote %s: %d tracts" % (OUT_PATH.relative_to(ROOT), payload["meta"]["tract_count"]))


if __name__ == "__main__":
    main()
