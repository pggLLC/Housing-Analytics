#!/usr/bin/env python3
"""
scripts/build-codex-audit-package.py

Generates a self-contained audit package for a code-review agent
("Codex") to walk one brief through the source-first verification +
rewrite workflow. Each package is a single markdown file at
`docs/codex-audits/<geoid>.md` that contains:

  - The brief content inlined verbatim
  - Per-paragraph (claim, source URL) enumeration
  - The exact WebFetch prompt Codex must use
  - The verification-report JSON schema
  - The decision rules (supported / partial / unsupported / inaccessible)
  - The rewrite-or-strip branching policy
  - The validator + commit steps

The agent reads ONE package, performs the audit, writes the report,
edits the brief if needed, validates, and commits — all from the
instructions inlined in the file.

Usage:
  # One specific brief
  python3 scripts/build-codex-audit-package.py --geoid 0820000

  # All briefs without a clean direct-WebFetch verification report
  python3 scripts/build-codex-audit-package.py --all-quarantined

  # Force regenerate even if package exists
  python3 scripts/build-codex-audit-package.py --geoid 0820000 --force
"""
import argparse
import json
import sys
from pathlib import Path

ROOT      = Path(__file__).resolve().parent.parent
BRIEFS    = ROOT / "data" / "jurisdiction-briefs"
VERIFIED  = BRIEFS / "_verified"
PACKAGES  = ROOT / "docs" / "codex-audits"


def _is_quarantined(geoid):
    """A brief is 'quarantined' if it lacks a clean direct-fetch
    verification report. Heuristic: report missing, or `audit_method`
    field mentions 'WebSearch' (the unreliable fallback that several
    subagents used)."""
    brief_path = BRIEFS / f"{geoid}.json"
    if not brief_path.exists():
        return False
    try:
        brief = json.loads(brief_path.read_text())
    except Exception:
        return True
    if brief.get("published") is not True:
        # not published → quarantine candidate
        report_path = VERIFIED / f"{geoid}.json"
        if not report_path.exists():
            return True
        try:
            report = json.loads(report_path.read_text())
        except Exception:
            return True
        method = (report.get("audit_method") or "").lower()
        # Trust only reports whose audit_method explicitly cites direct WebFetch
        # or the equivalent direct URL fetch primitive.
        if "websearch" in method:
            return True
        if "direct webfetch" not in method and "direct url fetch" not in method:
            return True
        # otherwise assume reliable
        return False
    return False


def _build_package(geoid):
    brief_path = BRIEFS / f"{geoid}.json"
    if not brief_path.exists():
        print(f"error: brief {brief_path} not found", file=sys.stderr)
        return None
    brief = json.loads(brief_path.read_text())

    jurisdiction = brief.get("jurisdiction") or geoid
    sections = brief.get("sections") or []
    sources_by_id = {s.get("id"): s for s in (brief.get("sources") or [])}

    # Enumerate cite-pairs
    rows = []
    for sec in sections:
        sid = sec.get("id") or ""
        for p_idx, p in enumerate(sec.get("paragraphs") or []):
            cites = p.get("cites") or []
            claim = (p.get("text") or "").strip()
            for cid in cites:
                src = sources_by_id.get(cid) or {}
                rows.append({
                    "section_id": sid,
                    "paragraph_index": p_idx,
                    "claim": claim,
                    "source_id": cid,
                    "source_label": src.get("label", ""),
                    "source_url": src.get("url", ""),
                    "source_kind": src.get("kind", ""),
                })

    # Pretty-print brief inlined as a code block
    brief_json = json.dumps(brief, indent=2, ensure_ascii=False)

    # Build the audit-plan table
    plan_lines = [
        "| # | Section · ¶ | Source | Kind | URL |",
        "|---|---|---|---|---|",
    ]
    for i, r in enumerate(rows, 1):
        plan_lines.append(
            f"| {i} | `{r['section_id']}` · ¶{r['paragraph_index']} | "
            f"`{r['source_id']}` | {r['source_kind']} | "
            f"<{r['source_url']}> |"
        )
    plan_table = "\n".join(plan_lines)

    # Build the per-row detail blocks (claim + URL + prompt)
    detail_blocks = []
    for i, r in enumerate(rows, 1):
        block = (
            f"### Row {i} — `{r['section_id']}` ¶{r['paragraph_index']} · {r['source_id']}\n\n"
            f"**URL:** {r['source_url']}\n\n"
            f"**Source label:** {r['source_label']}\n\n"
            f"**Source kind:** `{r['source_kind']}`\n\n"
            f"**Claim (verbatim from the brief):**\n\n"
            f"> {r['claim']}\n\n"
            f"**WebFetch prompt to use (copy verbatim into the WebFetch call):**\n\n"
            f"```\n"
            f"Does the article at this URL materially support the following claim "
            f"from a curated brief? Quote the supporting sentences VERBATIM, or "
            f"say 'NOT SUPPORTED' if the article does not contain or directly "
            f"imply this claim. Claim: {r['claim']}\n"
            f"```\n"
        )
        detail_blocks.append(block)
    details_md = "\n---\n\n".join(detail_blocks)

    # The instructional preamble + workflow
    package = f"""# Codex audit package — {jurisdiction} (`{geoid}`)

> **Audience:** the AI code-review agent (Codex / Claude Code / Cursor /
> similar) performing the source-first audit of one brief. Self-contained
> — do not require any context outside this file plus the repo on disk.

## Why you are here

A spot-check of the Carbondale brief on 2026-06-12 exposed a fabricated
source-to-claim mapping: a cited URL did not contain what the brief
claimed it contained. The Carbondale brief was then re-audited via
**direct WebFetch** of every cited URL — only 24% of cite-pairs came
back fully supported. The other ten briefs in this batch were audited
by the original subagents using **WebSearch** when WebFetch was sandbox-
denied; that method overstates "supported" by matching topical
keywords without verifying the article's actual text.

Your job: re-audit **this one brief** using direct WebFetch (not
WebSearch). If a cite-pair is unsupported or its URL is inaccessible,
either fix the claim to match what the source actually says, swap the
URL for one that does support the claim (re-verifying via WebFetch),
or drop the paragraph. When the brief is clean end-to-end, set
`published: true` and commit.

**Read first:** [`docs/JURISDICTION-BRIEFS-HANDOFF.md`](../JURISDICTION-BRIEFS-HANDOFF.md)
and [`data/jurisdiction-briefs/README.md`](../../data/jurisdiction-briefs/README.md).
The forensic trail of how Carbondale was repaired is the reference
example.

---

## Scope of this package

- **GEOID:** `{geoid}`
- **Jurisdiction:** {jurisdiction}
- **Cite-pairs to verify:** {len(rows)}
- **Brief on disk:** [`data/jurisdiction-briefs/{geoid}.json`](../../data/jurisdiction-briefs/{geoid}.json)
- **Verification report target:** `data/jurisdiction-briefs/_verified/{geoid}.json`
  (the validator refuses `published: true` without a clean report).

---

## Workflow

1. **Walk every row in the plan table below.** For each row, run
   WebFetch on the source URL with the prompt block in the row's detail
   section. Do not paraphrase the prompt.

2. **Record a verdict per row.** Verdicts:

   - `supported` — the article materially backs the claim. Capture
     the verbatim quote that backs it.
   - `partial` — the article touches the topic but doesn't fully back
     the specific claim. Note exactly what's missing.
   - `unsupported` — the article doesn't mention or contradicts the
     claim. **Blocking for publish.**
   - `inaccessible` — WebFetch failed (404 / 429 / unreadable PDF /
     login wall). **Blocking for publish.**

   Be conservative — when uncertain, mark unsupported. The
   Carbondale re-audit went from ~75% supported under search-snippet
   verification to 24% supported under direct WebFetch. Treat optimistic
   verdicts as a smell.

3. **Write the verification report** to
   `data/jurisdiction-briefs/_verified/{geoid}.json` using the schema
   in the next section. Set `audit_method` to a string containing the
   phrase "direct WebFetch" so the next reviewer (or the
   build-codex-audit-package.py script's heuristic) can tell this
   report is reliable.

4. **Fix the brief if needed.** For each row whose verdict is NOT
   `supported` or `partial`:

   - **Best:** replace the source URL with one that *does* support
     the claim, then WebFetch the new URL and confirm the verdict
     before writing it in.
   - **Acceptable:** rewrite the brief sentence to match what the
     current source actually says, then re-verify.
   - **Acceptable:** drop the paragraph entirely (and the source if
     orphaned) — a smaller honest brief is fine.
   - **Forbidden:** keep the unsupported claim. Never set
     `published: true` over an unsupported or inaccessible row.

5. **Re-run the validator and the verifier.**

   ```bash
   python3 scripts/validate-jurisdiction-briefs.py
   ```

   Validator rule 8 enforces: `published: true` requires the
   verification report at `_verified/{geoid}.json` to exist with every
   row in `supported` or `partial` state. Validator must exit 0.

6. **Set `published: true`** on `{geoid}.json` only after the validator
   is green.

7. **Commit** with a descriptive message. Suggested format:

   ```
   audit(briefs): {jurisdiction} ({geoid}) — direct-WebFetch verification

   <N> cite-pairs audited: <N_supp> supported, <N_part> partial,
   <N_unsup> unsupported, <N_inacc> inaccessible.

   <List of any corrections made to the brief content.>
   ```

---

## Verification report schema

Write to `data/jurisdiction-briefs/_verified/{geoid}.json`:

```json
{{
  "brief_geoid": "{geoid}",
  "brief_jurisdiction": "{jurisdiction}",
  "audited_at": "<YYYY-MM-DD>",
  "audit_method": "Direct WebFetch — every cited URL fetched; verbatim quotes captured below.",
  "rows": [
    {{
      "section_id": "<section.id>",
      "paragraph_index": <int>,
      "source_id": "<sN>",
      "source_url": "<url>",
      "verdict": "supported|partial|unsupported|inaccessible",
      "supporting_quote": "<verbatim from article when supported; empty otherwise>",
      "notes": "<one-liner; mandatory unless verdict=supported>"
    }}
  ],
  "summary": {{
    "total": <int>,
    "supported": <int>,
    "partial": <int>,
    "unsupported": <int>,
    "inaccessible": <int>
  }}
}}
```

---

## Audit plan ({len(rows)} cite-pairs)

{plan_table}

---

## Per-row detail (use these prompts verbatim)

{details_md}

---

## Brief content (inlined as of package build)

```json
{brief_json}
```

---

## Done-when checklist

- [ ] Every row in the plan has a verdict in `_verified/{geoid}.json`.
- [ ] No row is `unsupported` or `inaccessible` (fix or drop those).
- [ ] `audit_method` contains "direct WebFetch".
- [ ] Validator exits 0.
- [ ] `published: true` set on `{geoid}.json`.
- [ ] Committed with the suggested message format.
- [ ] HANDOFF.md per-brief status table updated to reflect the new state
      (if the row was previously marked unreliable / not audited).

The repo is ready when the per-brief status table in
[`docs/JURISDICTION-BRIEFS-HANDOFF.md`](../JURISDICTION-BRIEFS-HANDOFF.md)
shows ✓ in the `published` column and "direct WebFetch" in the audit
method for this GEOID.
"""
    return package


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--geoid", help="One specific 5- or 7-digit GEOID")
    g.add_argument("--all-quarantined", action="store_true",
                   help="Build packages for every brief that lacks a clean direct-WebFetch report")
    ap.add_argument("--force", action="store_true",
                    help="Overwrite an existing package (default: skip)")
    args = ap.parse_args()

    PACKAGES.mkdir(parents=True, exist_ok=True)
    targets = []
    if args.geoid:
        targets = [args.geoid]
    else:
        for p in sorted(BRIEFS.glob("*.json")):
            if p.name.startswith("_"):
                continue
            if _is_quarantined(p.stem):
                targets.append(p.stem)

    written = skipped = 0
    for geoid in targets:
        out_path = PACKAGES / f"{geoid}.md"
        if out_path.exists() and not args.force:
            skipped += 1
            continue
        body = _build_package(geoid)
        if body is None:
            continue
        out_path.write_text(body, encoding="utf-8")
        written += 1
    print(f"[codex-pkg] {written} written, {skipped} skipped "
          f"({len(targets)} candidate(s); writing to {PACKAGES.relative_to(ROOT)}/)",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
