#!/usr/bin/env python3
"""scripts/hna/build_place_od_flows.py — true place-level commute flows
aggregated from BLOCK-level LEHD LODES OD main, using the LEHD geographic
crosswalk to map blocks → places.

Why
---
Earlier place-LEHD apportionment (F39) weighted the COUNTY's flows by the
place's population share of each TRACT — accurate for single-tract small
towns, but for multi-tract metros (Aurora, Boulder, Denver) the tract-level
aggregation over-counts intra-place tract-to-tract commutes as inflow /
outflow when they're really `within`. The true answer is at the BLOCK level:
classify each LODES OD pair (home_block → work_block) by whether each end
falls inside the place.

  within(P)  = Σ jobs where home_block ∈ P AND work_block ∈ P
  inflow(P)  = Σ jobs where work_block ∈ P AND home_block ∉ P
  outflow(P) = Σ jobs where home_block ∈ P AND work_block ∉ P

build_place_lehd.py will prefer these block-derived flows over its tract-
weighted estimates when this file is present, falling back to the tract path
for places not covered by the crosswalk.

Inputs (auto-downloaded, cached under data/hna/lodes-raw/)
----------------------------------------------------------
- LODES OD main file (all workers, all jobs):
    https://lehd.ces.census.gov/data/lodes/LODES8/co/od/co_od_main_JT00_{YEAR}.csv.gz
    Columns we use: w_geocode (15-digit 2020 work block), h_geocode (home
    block), S000 (total jobs).
- LEHD geographic crosswalk:
    https://lehd.ces.census.gov/data/lodes/LODES8/co/co_xwalk.csv.gz
    Column we use: tabblk2020 (block GEOID), stplc (state-place 7-digit FIPS).

Output
------
    data/hna/place-od-flows.json
    {
      "meta": { "year": 2022, "generated_at": "...", "source": "...",
                "block_count": <int>, "place_count": <int>, "rows_streamed": <int> },
      "places": {
        "0853395": { "within": 343, "inflow": 683, "outflow": 3299,
                     "jobs": 992, "residentWorkers": 3642,
                     "name": "New Castle town" }
      }
    }

Usage
-----
    python3 scripts/hna/build_place_od_flows.py            # use cached if present
    python3 scripts/hna/build_place_od_flows.py --year 2022
    python3 scripts/hna/build_place_od_flows.py --refetch  # force re-download
"""

from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import sys
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
RAW_DIR = REPO / "data/hna/lodes-raw"
OUT_PATH = REPO / "data/hna/place-od-flows.json"

OD_URL_TMPL = "https://lehd.ces.census.gov/data/lodes/LODES8/co/od/co_od_main_JT00_{year}.csv.gz"
XWALK_URL   = "https://lehd.ces.census.gov/data/lodes/LODES8/co/co_xwalk.csv.gz"


def _download(url: str, dest: Path, refetch: bool) -> Path:
    if dest.exists() and not refetch:
        print(f"[lodes-od] cached: {dest.relative_to(REPO)}", file=sys.stderr)
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"[lodes-od] downloading {url}", file=sys.stderr)
    req = urllib.request.Request(url, headers={"User-Agent": "coho-analytics/build_place_od_flows"})
    with urllib.request.urlopen(req, timeout=120) as r, dest.open("wb") as f:
        while True:
            chunk = r.read(64 * 1024)
            if not chunk:
                break
            f.write(chunk)
    print(f"[lodes-od] saved {dest.stat().st_size:,} bytes → {dest.relative_to(REPO)}", file=sys.stderr)
    return dest


def _load_block_to_place(xwalk_path: Path) -> tuple[dict[str, str], dict[str, str]]:
    """Return ({block_geoid: stplc_geoid}, {stplc_geoid: stplcname})."""
    block_to_place: dict[str, str] = {}
    place_names: dict[str, str] = {}
    with gzip.open(xwalk_path, "rt", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            block = (row.get("tabblk2020") or "").strip()
            stplc = (row.get("stplc") or "").strip()
            if not block or not stplc or stplc == "00000000":
                continue
            # tabblk2020 is 15 digits. stplc is 2-state + 5-place = 7 digits (no
            # leading zero on the state when read as int → "8053395" — guard).
            if len(stplc) == 7:
                pass  # OK
            elif len(stplc) == 6:
                stplc = "0" + stplc  # restore leading state zero (CO=08)
            block_to_place[block] = stplc
            if stplc not in place_names:
                nm = (row.get("stplcname") or "").strip()
                if nm:
                    place_names[stplc] = nm
    return block_to_place, place_names


def _stream_od(od_path: Path, block_to_place: dict[str, str]) -> tuple[dict[str, dict[str, int]], int]:
    """Stream the OD CSV and accumulate per-place flows.

    Returns ({stplc: {within, inflow, outflow, jobs, residentWorkers}},
    rows_streamed)."""
    flows: dict[str, dict[str, int]] = defaultdict(lambda: {
        "within": 0, "inflow": 0, "outflow": 0, "jobs": 0, "residentWorkers": 0,
    })
    rows = 0
    with gzip.open(od_path, "rt", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows += 1
            try:
                jobs = int(row.get("S000") or 0)
            except ValueError:
                continue
            if jobs <= 0:
                continue
            w_block = (row.get("w_geocode") or "").strip()
            h_block = (row.get("h_geocode") or "").strip()
            wp = block_to_place.get(w_block)
            hp = block_to_place.get(h_block)
            if wp:
                flows[wp]["jobs"] += jobs
            if hp:
                flows[hp]["residentWorkers"] += jobs
            if wp and hp and wp == hp:
                flows[wp]["within"] += jobs
            else:
                if wp:
                    flows[wp]["inflow"] += jobs
                if hp:
                    flows[hp]["outflow"] += jobs
    return flows, rows


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--year", type=int, default=2022, help="LODES OD year (default 2022)")
    ap.add_argument("--refetch", action="store_true", help="force re-download even if cached")
    args = ap.parse_args()

    od_url   = OD_URL_TMPL.format(year=args.year)
    od_path  = RAW_DIR / f"co_od_main_JT00_{args.year}.csv.gz"
    xwalk_path = RAW_DIR / "co_xwalk.csv.gz"

    _download(XWALK_URL, xwalk_path, args.refetch)
    _download(od_url,    od_path,    args.refetch)

    print("[lodes-od] building block→place map…", file=sys.stderr)
    block_to_place, place_names = _load_block_to_place(xwalk_path)
    print(f"[lodes-od] {len(block_to_place):,} blocks in {len(place_names):,} places", file=sys.stderr)

    print("[lodes-od] streaming OD rows…", file=sys.stderr)
    flows, rows = _stream_od(od_path, block_to_place)
    print(f"[lodes-od] processed {rows:,} OD rows; {len(flows):,} places have flows", file=sys.stderr)

    out_places = {}
    for stplc, fl in sorted(flows.items()):
        out_places[stplc] = {
            "name":            place_names.get(stplc, ""),
            "within":          int(fl["within"]),
            "inflow":          int(fl["inflow"]),
            "outflow":         int(fl["outflow"]),
            "jobs":            int(fl["jobs"]),
            "residentWorkers": int(fl["residentWorkers"]),
        }

    out = {
        "meta": {
            "year": args.year,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "source": od_url,
            "crosswalk_source": XWALK_URL,
            "block_count": len(block_to_place),
            "place_count": len(out_places),
            "rows_streamed": rows,
            "method": (
                "Streams the LODES OD main (CSV.gz, ~14 MB compressed) and "
                "classifies every (home_block → work_block) pair against the LEHD "
                "co_xwalk.csv.gz tabblk2020→stplc mapping. within = home and work "
                "in the same place; inflow = work in place, home outside; outflow "
                "= home in place, work outside. Block-level — no intra-place "
                "double-counting (the tract-weighted F39 approximation does)."
            ),
        },
        "places": out_places,
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, sort_keys=False)
        f.write("\n")
    print(f"[lodes-od] wrote {len(out_places):,} places → {OUT_PATH.relative_to(REPO)}", file=sys.stderr)


if __name__ == "__main__":
    main()
