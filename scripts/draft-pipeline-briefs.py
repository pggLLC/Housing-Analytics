#!/usr/bin/env python3
"""
scripts/draft-pipeline-briefs.py

Recurring bridge: draft a skeleton jurisdiction brief for every pipeline
item in an active stage (Signal / Screen / Outreach) that doesn't already
have one. Reuses the scope + skeleton logic of
``scripts/draft-jurisdiction-brief.py`` (no duplicated logic) so the output
is identical to a manual ``--geoid`` draft and passes ``test:briefs``.

Why this exists
---------------
Pipeline items live in the gated backend's prototype CSV (outside this
public repo). This script reads that CSV, finds active-stage jurisdictions
missing a brief, and drafts the ``published: false`` skeletons into
``data/jurisdiction-briefs/`` (curator backlog, hidden from the public
site). Run it manually or on a cron whenever the pipeline changes.

Scope
-----
By default it honors the brief-scope rule (counties, or incorporated places
with ACS pop >= 2,000; CDPs excluded) — the same gate as the underlying
generator. Pass ``--include-below-threshold`` to also draft sub-2,000
pipeline targets (e.g. small resort towns you're actively pursuing).

Usage
-----
  # Dry run against the default backend pipeline CSV
  python3 scripts/draft-pipeline-briefs.py --dry-run

  # Actually draft the missing ones
  python3 scripts/draft-pipeline-briefs.py

  # Point at a specific pipeline CSV / different stages / include small towns
  python3 scripts/draft-pipeline-briefs.py \
      --pipeline-csv ~/coho-backend/docs/developer-pipeline-prototype/02-pipeline.csv \
      --stages Signal,Screen,Outreach --include-below-threshold
"""
import argparse
import csv
import importlib.util
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GENERATOR = ROOT / "scripts" / "draft-jurisdiction-brief.py"
DEFAULT_PIPELINE_CSV = os.path.expanduser(
    "~/coho-backend/docs/developer-pipeline-prototype/02-pipeline.csv"
)
DEFAULT_STAGES = ["Signal", "Screen", "Outreach"]


def _load_generator():
    """Import scripts/draft-jurisdiction-brief.py (hyphenated) as a module."""
    spec = importlib.util.spec_from_file_location("djb", GENERATOR)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _csv_get(row, *names):
    for name in names:
        for key in row:
            if key and key.lower().strip() == name:
                return (row[key] or "").strip()
    return ""


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--pipeline-csv", default=DEFAULT_PIPELINE_CSV,
                    help="Path to the pipeline CSV (default: backend prototype CSV)")
    ap.add_argument("--stages", default=",".join(DEFAULT_STAGES),
                    help="Comma-separated stages to draft for (default: Signal,Screen,Outreach)")
    ap.add_argument("--include-below-threshold", action="store_true",
                    help="Also draft incorporated places below the pop>=2000 brief-scope rule")
    ap.add_argument("--dry-run", action="store_true",
                    help="Report what would be drafted without writing")
    ap.add_argument("--force", action="store_true",
                    help="Overwrite existing briefs (default: skip)")
    args = ap.parse_args()

    csv_path = Path(os.path.expanduser(args.pipeline_csv))
    if not csv_path.exists():
        print(f"error: pipeline CSV not found: {csv_path}", file=sys.stderr)
        print("       (point --pipeline-csv at the backend's 02-pipeline.csv)", file=sys.stderr)
        return 2

    stages = {s.strip().lower() for s in args.stages.split(",") if s.strip()}
    djb = _load_generator()
    registry = djb._registry_index()

    with csv_path.open() as fh:
        rows = list(csv.DictReader(fh))

    drafted, skipped_existing, skipped_scope, missing_geog = [], [], [], []
    seen = set()
    for row in rows:
        if _csv_get(row, "stage").lower() not in stages:
            continue
        geoid = _csv_get(row, "geoid", "geo_id", "id")
        label = _csv_get(row, "jurisdiction", "name", "place") or geoid
        if not geoid or geoid in seen:
            continue
        seen.add(geoid)

        if (djb.BRIEFS / f"{geoid}.json").exists() and not args.force:
            skipped_existing.append((geoid, label))
            continue

        geog = registry.get(geoid)
        if not geog:
            missing_geog.append((geoid, label))
            continue

        if not djb._in_scope(geog) and not args.include_below_threshold:
            skipped_scope.append((geoid, label))
            continue

        if args.dry_run:
            drafted.append((geoid, label))
            continue

        brief = djb._build_skeleton(geog)
        djb._write_brief(brief, args.force)
        drafted.append((geoid, label))

    verb = "would draft" if args.dry_run else "drafted"
    print(f"[pipeline-briefs] {verb}: {len(drafted)}")
    for gid, label in drafted:
        print(f"    + {gid}  {label}")
    if skipped_existing:
        print(f"[pipeline-briefs] already had a brief: {len(skipped_existing)}")
    if skipped_scope:
        print(f"[pipeline-briefs] skipped (below pop>=2000 scope; use --include-below-threshold): {len(skipped_scope)}")
        for gid, label in skipped_scope:
            print(f"    - {gid}  {label}")
    if missing_geog:
        print(f"[pipeline-briefs] skipped (geoid not in registry): {len(missing_geog)}")
        for gid, label in missing_geog:
            print(f"    ? {gid}  {label}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
