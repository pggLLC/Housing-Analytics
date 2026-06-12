#!/usr/bin/env python3
"""
scripts/verify-brief-sources.py

Source-provenance auditor. For every paragraph in a brief, lists each
cited source URL alongside the verbatim claim text — so a human (or a
WebFetch-equipped agent) can confirm that the source actually supports
the claim before the brief is re-published.

This script does NOT call out to the network. It enumerates the
verification plan as JSON. The actual source-fetch + claim-check pass
happens in a separate workflow (CI job or interactive agent) that walks
the plan, runs WebFetch per (claim, url) pair, and writes verdicts back
to a verification report. The plan/report split keeps the cheap step
(enumeration) decoupled from the expensive step (network fetch).

Output:
  - Plan JSON to stdout: array of {brief_geoid, brief_jurisdiction,
    section_id, paragraph_index, claim_text, source_id, source_label,
    source_url, source_kind} rows.
  - Optionally writes data/jurisdiction-briefs/_verification-plan.json
    with --write.
  - --geoid X scopes to one brief.
  - --unverified-only lists only published:false briefs (the post-fab
    quarantine state) — handy for the cron.

Pair this with scripts/apply-verification-report.py (next) which reads
back the verdict JSON and (a) prints unsupported claims, (b) flips
published:true on briefs that pass end-to-end, (c) refuses to flip on
any brief with even one refuted claim.

Usage:
  python3 scripts/verify-brief-sources.py
  python3 scripts/verify-brief-sources.py --geoid 0812045
  python3 scripts/verify-brief-sources.py --unverified-only --write
"""
import argparse
import json
import sys
from pathlib import Path

ROOT   = Path(__file__).resolve().parent.parent
BRIEFS = ROOT / "data" / "jurisdiction-briefs"


def _load_brief(p):
    try:
        return json.loads(p.read_text())
    except Exception as e:
        print(f"warn: {p.name} unreadable: {e}", file=sys.stderr)
        return None


def _enumerate(brief):
    """Walk one brief and yield (claim, source) verification rows. A
    paragraph cited against N sources produces N rows. Paragraphs flagged
    `needs_source: true` with no cites are listed once with source_url=null
    so the curator backlog still surfaces them.
    """
    geoid  = brief.get("geoid", "")
    juris  = brief.get("jurisdiction", "")
    by_id  = {s.get("id"): s for s in (brief.get("sources") or []) if isinstance(s, dict)}
    for sec in (brief.get("sections") or []):
        sid = sec.get("id") or ""
        for p_idx, para in enumerate(sec.get("paragraphs") or []):
            text  = para.get("text") or ""
            cites = para.get("cites") or []
            if not cites and para.get("needs_source"):
                yield {
                    "brief_geoid": geoid,
                    "brief_jurisdiction": juris,
                    "section_id": sid,
                    "paragraph_index": p_idx,
                    "claim_text": text,
                    "source_id": None,
                    "source_label": None,
                    "source_url": None,
                    "source_kind": None,
                    "verification_status": "needs_source",
                }
                continue
            for cid in cites:
                src = by_id.get(cid) or {}
                yield {
                    "brief_geoid": geoid,
                    "brief_jurisdiction": juris,
                    "section_id": sid,
                    "paragraph_index": p_idx,
                    "claim_text": text,
                    "source_id": cid,
                    "source_label": src.get("label"),
                    "source_url": src.get("url"),
                    "source_kind": src.get("kind"),
                    "verification_status": "pending",
                }


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--geoid", help="Scope to one brief")
    ap.add_argument("--unverified-only", action="store_true",
                    help="Only include briefs where published is not True")
    ap.add_argument("--write", action="store_true",
                    help="Write to data/jurisdiction-briefs/_verification-plan.json")
    args = ap.parse_args()

    if not BRIEFS.exists():
        print(json.dumps([]))
        return 0

    plan = []
    briefs_seen = 0
    for p in sorted(BRIEFS.glob("*.json")):
        if p.name.startswith("_"):
            continue
        if args.geoid and p.stem != args.geoid:
            continue
        d = _load_brief(p)
        if d is None:
            continue
        if args.unverified_only and d.get("published") is True:
            continue
        briefs_seen += 1
        plan.extend(_enumerate(d))

    if args.write:
        BRIEFS.mkdir(parents=True, exist_ok=True)
        target = BRIEFS / "_verification-plan.json"
        target.write_text(json.dumps({
            "rows": plan,
            "briefs_in_plan": briefs_seen,
            "row_count": len(plan),
        }, indent=2) + "\n")
        print(f"[verify-plan] wrote {len(plan)} row(s) for {briefs_seen} "
              f"brief(s) to {target}", file=sys.stderr)
    else:
        print(json.dumps(plan, indent=2))
    print(f"[verify-plan] {len(plan)} row(s) across {briefs_seen} brief(s)",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
