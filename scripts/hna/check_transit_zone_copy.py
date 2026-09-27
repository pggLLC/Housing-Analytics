#!/usr/bin/env python3
"""Is the ranking index's display-only transit zone copy still current? (#1971)

data/hna/ranking-index.json carries a copy of
data/hna/transit-zone-by-geography.json (build_ranking_index.py,
load_transit_zone). fetch-parcel-zoning-data.yml rewrites that source every
week, and every rewrite carries new `generated` / `stops_generated` stamps even
when no geography changed. Rebuilding the derived chain on a stamp-only change
would commit ~570 timestamp-only files a week, so the workflow gates on this
script instead of on a file diff: it compares CONTENT — every row's copied
block and the copied meta fields — never the stamps.

Exit codes:
  0  the index copy agrees with the source; no rebuild needed
  1  it disagrees; run `npm run rebuild:derived`
  2  the check itself could not run (treat as a failure, not as "current")
"""
import importlib.util
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
INDEX = os.path.join(ROOT, "data", "hna", "ranking-index.json")


def main() -> int:
    try:
        spec = importlib.util.spec_from_file_location(
            "build_ranking_index", os.path.join(ROOT, "scripts", "hna", "build_ranking_index.py")
        )
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        with open(INDEX, encoding="utf-8") as fh:
            index = json.load(fh)
        stale = builder.transit_zone_copy_disagreements(index)
    except Exception as exc:  # noqa: BLE001 — any failure must not read as "current"
        print(f"check_transit_zone_copy: could not run: {exc}", file=sys.stderr)
        return 2
    if stale:
        print(f"ranking-index.json transit zone copy is STALE: {len(stale)} disagreement(s), "
              f"e.g. {stale[:5]}. Run `npm run rebuild:derived`.")
        return 1
    print("ranking-index.json transit zone copy agrees with the source (stamps ignored).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
