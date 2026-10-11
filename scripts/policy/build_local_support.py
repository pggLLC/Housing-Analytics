#!/usr/bin/env python3
"""Merge per-jurisdiction local-support research into data/policy/local-support.json.

    python3 scripts/policy/build_local_support.py <research-dir> [--sources <dir>]

<research-dir> holds one <geoid>.json per jurisdiction (format: the
"jurisdictions" rows of local-support.json, without review_by). Rows already in
the file for other jurisdictions are kept; a research file replaces its
jurisdiction's row. With --sources, every evidence quote is checked by exact
substring match (whitespace collapsed) against its saved source_file, relative
to that directory, and the merge refuses on any miss. The saved source text is
not committed: many of the PDFs are large, and the quotes carry the claim.

review_by is six months after the row's checked date: council records go stale
faster than code-backed incentives.
"""
import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "policy" / "local-support.json"

METHOD = (
    "Curated, not a feed. One row per jurisdiction whose official sources were read for "
    "two scopes: plans (an adopted housing needs assessment, housing plan or strategy, or "
    "comprehensive-plan housing goals that set affordable-housing goals or targets) and "
    "council (recorded votes by the governing body or planning commission specifically on "
    "income-restricted, affordable or workforce housing: project approvals, rezonings, land "
    "contributions, funding awards, fee waivers, policy adoptions, and denials). Each item "
    "was read from the jurisdiction's own site, agenda/minutes system, code or DOLA, the "
    "text saved, and every evidence quote checked by exact substring match against the saved "
    "text (whitespace collapsed). A date the source gives only as a month or year is kept at "
    "that precision and scored as its earliest possible day. A vote count the source does not "
    "state is null. result_by_scope is records, none_found (the named sources were read and "
    "hold nothing in scope) or unreadable (blocked, a scan with no text, or a dead link). A "
    "jurisdiction with no row has not been checked, which is not the same as having nothing."
)


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def six_months_after(day: str) -> str:
    d = dt.date.fromisoformat(day)
    m = d.month + 6
    y = d.year + (m - 1) // 12
    m = (m - 1) % 12 + 1
    return dt.date(y, m, min(d.day, 28)).isoformat()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("research_dir", type=Path)
    ap.add_argument("--sources", type=Path, help="directory source_file paths are relative to")
    args = ap.parse_args()

    current = json.loads(OUT.read_text()) if OUT.exists() else {"jurisdictions": []}
    rows = {r["geoid"]: r for r in current.get("jurisdictions") or []}

    problems = []
    for f in sorted(args.research_dir.glob("08*.json")):
        row = json.loads(f.read_text())
        row["review_by"] = six_months_after(row["checked"])
        if args.sources:
            for item in row.get("items") or []:
                for ev in item.get("evidence") or []:
                    src = args.sources / ev["source_file"]
                    if not src.exists():
                        problems.append(f"{item['id']}: missing {ev['source_file']}")
                    elif norm(ev["quote"]) not in norm(src.read_text(errors="ignore")):
                        problems.append(f"{item['id']}: quote not in {ev['source_file']}: {ev['quote'][:80]}")
        rows[row["geoid"]] = row
    if problems:
        print("\n".join(problems))
        print(f"refusing to write: {len(problems)} problem(s)")
        return 1

    ordered = sorted(rows.values(), key=lambda r: r["geoid"])
    as_of = max((r["checked"] for r in ordered), default=dt.date.today().isoformat())
    out = {
        "schema": "local-support/v1",
        "meta": {
            "title": "Colorado local support for affordable housing: adopted plans and council / planning commission record",
            "as_of": as_of,
            "method": METHOD,
            "scoring": (
                "js/local-support-data.js turns this file, data/policy/fee-reductions.json and "
                "data/policy/local-housing-funds.json into the Opportunity Finder's local support "
                "bonus: +2 for an adopted plan within 5 years, +2 for a standing fee reduction, "
                "land-use incentive (other than inclusionary zoning) or dedicated fund, +2 for a "
                "recorded approval within 36 months; at most +6. Unchecked adds 0 and so changes "
                "nothing. Denials are shown in the briefs and not scored. A row past review_by "
                "stops counting until it is re-checked."
            ),
            "known_gaps": [
                ("Coverage starts with the jurisdictions that have a published or draft brief; "
                 "the monthly local-incentives research issue extends it."),
                "Many city and county sites block automated reads; those scopes are recorded as unreadable.",
            ],
        },
        "jurisdictions": ordered,
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(ordered)} jurisdiction(s), "
          f"{sum(len(r.get('items') or []) for r in ordered)} item(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
