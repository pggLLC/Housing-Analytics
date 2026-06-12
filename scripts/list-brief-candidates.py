#!/usr/bin/env python3
"""
scripts/list-brief-candidates.py

Lists Colorado jurisdictions that should have a jurisdictional housing-
history brief but don't yet — the source of truth for the monthly bulk-
generation cron.

Scope rules (per product decision 2026-06-11):
  - INCLUDE: counties (all 64)
  - INCLUDE: incorporated places with ACS population ≥ 2000
  - EXCLUDE: CDPs (every one)
  - EXCLUDE: incorporated places with population < 2000

Population is read from data/hna/summary/<geoid>.json acsProfile.DP05_0001E
(ACS 5-year total population). When a summary is missing or the population
is unknown, the place is excluded (conservative — better to skip than to
draft a brief for a place that's actually below the threshold).

Output:
  - JSON to stdout: a list of {geoid, name, type, population} candidates
    sorted by population desc.
  - Optionally writes data/jurisdiction-briefs/_candidates.json when run
    with --write.

Usage:
  python3 scripts/list-brief-candidates.py
  python3 scripts/list-brief-candidates.py --write
  python3 scripts/list-brief-candidates.py --top 30   # only top-N
"""
import json
import sys
from pathlib import Path
from typing import Optional

ROOT       = Path(__file__).resolve().parent.parent
REGISTRY   = ROOT / "data" / "hna" / "geography-registry.json"
SUMMARY    = ROOT / "data" / "hna" / "summary"
BRIEFS     = ROOT / "data" / "jurisdiction-briefs"

PLACE_MIN_POPULATION = 2000


def _read_population(geoid):
    # type: (str) -> Optional[int]
    p = SUMMARY / f"{geoid}.json"
    if not p.exists():
        return None
    try:
        d = json.loads(p.read_text())
        pop = d.get("acsProfile", {}).get("DP05_0001E")
        if isinstance(pop, (int, float)) and pop >= 0:
            return int(pop)
    except Exception:
        return None
    return None


def _existing_brief_geoids():
    if not BRIEFS.exists():
        return set()
    return {p.stem for p in BRIEFS.glob("*.json") if not p.name.startswith("_")}


def main():
    args = sys.argv[1:]
    write = "--write" in args
    top_n = None
    if "--top" in args:
        idx = args.index("--top")
        try:
            top_n = int(args[idx + 1])
        except (IndexError, ValueError):
            print("--top requires an integer argument", file=sys.stderr)
            return 2

    registry = json.loads(REGISTRY.read_text())
    have     = _existing_brief_geoids()
    out      = []

    for g in registry.get("geographies", []):
        geoid = g.get("geoid", "")
        gtype = g.get("type")
        name  = g.get("name") or g.get("label") or ""
        if geoid in have:
            continue
        if gtype == "cdp":
            continue
        if gtype == "county":
            pop = _read_population(geoid) or 0
            out.append({
                "geoid": geoid, "name": name, "type": "county",
                "population": pop, "priority": pop,
            })
        elif gtype == "place":
            pop = _read_population(geoid)
            if pop is None or pop < PLACE_MIN_POPULATION:
                continue
            out.append({
                "geoid": geoid, "name": name, "type": "place",
                "population": pop, "priority": pop,
            })

    out.sort(key=lambda x: x["priority"], reverse=True)
    if top_n is not None:
        out = out[:top_n]

    if write:
        BRIEFS.mkdir(parents=True, exist_ok=True)
        (BRIEFS / "_candidates.json").write_text(
            json.dumps({"generated": "auto", "scope_rules": {
                "include_counties": True,
                "include_places_min_population": PLACE_MIN_POPULATION,
                "exclude_cdps": True,
            }, "candidates": out}, indent=2)
        )
        print(f"[candidates] wrote {len(out)} to {BRIEFS / '_candidates.json'}", file=sys.stderr)
    else:
        print(json.dumps(out, indent=2))
    print(f"[candidates] {len(out)} candidate(s) "
          f"(skipping CDPs and places < {PLACE_MIN_POPULATION} pop)",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
