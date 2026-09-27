#!/usr/bin/env python3
"""Were the transit amenity outputs built from the stop file as it is now?

data/amenities/transit_stops_statewide_co.geojson is rewritten by
fetch-parcel-zoning-data.yml every week, with a new meta.generated stamp even
when no stop changed. Two outputs are built from it:

  data/derived/market-analysis/neighborhood_access.json  (meta.transit)
  data/hna/ranking-index.json                           (metadata.transitStops)

Each records the stop file's content fingerprint
(scripts/lib/transit_stops.content_fingerprint: its features, never its
stamps). This compares both with the file. A sibling of
check_transit_zone_copy.py, and gated the same way: a stamp-only refresh is
current, any change to a stop is stale.

Exit codes:
  0  both outputs were built from the current stop content
  1  at least one was not; the workflow rebuilds neighborhood access, then
     runs `npm run rebuild:derived`
  2  the check itself could not run (treat as a failure, not as "current")
"""
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "scripts", "lib"))

import transit_stops  # noqa: E402

OUTPUTS = {
    "data/derived/market-analysis/neighborhood_access.json": ("meta", "transit"),
    "data/hna/ranking-index.json": ("metadata", "transitStops"),
}


def disagreements(root: str = ROOT) -> list[str]:
    """Which outputs record a different stop content than the file holds.

    Raises when the stop file or an output cannot be read: that must never
    look like "current".
    """
    current = transit_stops.content_fingerprint(os.path.join(root, transit_stops.STATEWIDE_STOPS_REL))
    if current is None:
        raise RuntimeError(f"{transit_stops.STATEWIDE_STOPS_REL} could not be read")
    stale = []
    for rel, (top, key) in OUTPUTS.items():
        with open(os.path.join(root, rel), encoding="utf-8") as fh:
            block = (json.load(fh).get(top) or {}).get(key) or {}
        if block.get("stops_content_sha256") != current:
            stale.append(rel)
    return stale


def main() -> int:
    try:
        stale = disagreements()
    except Exception as exc:  # noqa: BLE001 — any failure must not read as "current"
        print(f"check_transit_stop_copies: could not run: {exc}", file=sys.stderr)
        return 2
    if stale:
        print("Built from different transit stop content than the committed stop file: "
              + ", ".join(stale) + ". Rebuild neighborhood access, then `npm run rebuild:derived`.")
        return 1
    print("Transit amenity outputs agree with the stop file's content (stamps ignored).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
