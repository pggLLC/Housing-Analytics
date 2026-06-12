# Paste this into Codex

One block. Copy everything between the fences. The agent does the
full audit: methodology, per-brief verification, usability, cross-
system consistency, and a written report — not just brief verdicts.

---

Full audit of the jurisdictional briefs feature in this repo.

PHASE 1 — Read and orient (~10 min).
Read docs/JURISDICTION-BRIEFS-HANDOFF.md, then data/jurisdiction-briefs/README.md and data/jurisdiction-briefs/_decisions.md. The gold-standard reference for what a verified brief + clean verification report looks like is data/jurisdiction-briefs/_verified/0812045.json (Carbondale, repaired 2026-06-12 via direct WebFetch). The fabrication incident write-up is in the HANDOFF doc.

PHASE 2 — Methodology audit (~20 min, no brief content yet).
Read these and look for loopholes that would let a fabricated source slip through to a published brief:
- scripts/validate-jurisdiction-briefs.py — does rule 8 actually block all the failure modes? Can a brief be published with `_verified/<geoid>.json` that has lying verdicts?
- js/indibuild-gate.js — password is SHA-256 of "salida2026". Is the threat model documented honestly? (It's UI gating, not encryption.)
- scripts/build-codex-audit-package.py — quarantine heuristic: does it skip any brief that should have been queued?
- scripts/verify-brief-sources.py — does the enumeration miss any cite-pair shapes?
- Source-first discipline in data/jurisdiction-briefs/README.md — is it possible to write a "supported" verdict without actually running WebFetch?
Write findings into a new section "## Methodology audit findings (<date>)" appended to docs/JURISDICTION-BRIEFS-HANDOFF.md. Open GitHub issues (`gh issue create`) for anything you can't fix in-session.

PHASE 3 — Audit and repair each quarantined brief.
Order, smallest cite-count first: 0864255, 08045, 0803455, 08097, 0817375, 0816000, 0867280, 0830780, 0827425, 0820000.
For each:
1. Open docs/codex-audits/<geoid>.md.
2. WebFetch every URL with the prompt block from each row's detail. NEVER use WebSearch instead — it gives false positives (Carbondale went from 75% supported under WebSearch snippets to 24% under direct WebFetch).
3. Write the verdict report to data/jurisdiction-briefs/_verified/<geoid>.json with audit_method containing the literal string "direct WebFetch".
4. For any unsupported or inaccessible row: fix the brief sentence to match what the source actually says, swap the URL for one that DOES support the claim (re-verifying via WebFetch), or drop the paragraph and its orphaned sources. Never keep an unsupported claim.
5. Run: python3 scripts/validate-jurisdiction-briefs.py — must exit 0.
6. Set published: true on the brief.
7. Commit and push: "audit(briefs): <jurisdiction> — direct-WebFetch verification".
8. Update the brief's row in docs/JURISDICTION-BRIEFS-HANDOFF.md to show ✓ and "direct WebFetch".

PHASE 4 — Usability audit (~30 min, after Phase 3).
Boot a dev server: `npx http-server . -p 8765 --silent` (background it). Open http://localhost:8765/indibuild-brief.html?geoid=0812045 in a browser-like context. Enter password `salida2026` to unlock the page. Verify on Carbondale:
- Brief renders with header strip ("Last verified <date> by <curator>", freshness dot, ↻ Update brief button).
- Summary, all 5 sections, all 15 sources render in order.
- Source-list contrast is readable in BOTH light and dark mode (this was a regression caught 2026-06-12 — the `.dark-mode` selectors weren't matching the prefers-color-scheme media query).
- ↻ Update brief button opens a prefilled GitHub issue URL.
- The "no brief yet, draft one" affordance fires for a GEOID with no brief on file (try `?geoid=08123` for Weld County) — Copy command button must work or fall back to text selection.
- Mobile viewport (~380px): brief is legible, header strip wraps cleanly, source list doesn't overflow.
Document any rendering, contrast, or interaction bugs in a "## Usability audit findings (<date>)" section appended to docs/JURISDICTION-BRIEFS-HANDOFF.md.

PHASE 5 — Cross-system audit (~20 min).
- Open data/hna/local-resources.json. For each jurisdiction that now has a published brief, check whether local-resources content (housingLead, contacts, plans, advocacy) duplicates or contradicts brief content. Reconcile by editing whichever is wrong; document the call.
- Read js/components/watchlist.js. Confirm the Watchlist (per-device localStorage) does NOT auto-trigger anything brief-related (per the 2026-06-12 decision in _decisions.md). If it does, flag it.
- Open the IndiBuild pages: indibuild.html, indibuild-where.html, indibuild-pipeline.html. Confirm they don't accidentally render brief content outside the gated indibuild-brief.html page.
- Document any cross-system inconsistencies in the same audit-findings section.

PHASE 6 — Final report.
Append "## Codex audit summary (<date>)" to docs/JURISDICTION-BRIEFS-HANDOFF.md with:
- Counts: how many briefs went green, how many rows were unsupported / inaccessible across all 10
- Methodology gaps you found (with file:line references)
- Usability bugs you found (and which ones you fixed inline)
- Cross-system inconsistencies (and resolutions)
- Recommended follow-ups (in priority order)
- The token / time cost of this audit, for the next reviewer's budgeting.
Open GitHub issues for anything that needs human judgment to resolve. Commit + push the final HANDOFF.md update.

DISCIPLINE
- Direct WebFetch always. Never WebSearch as a substitute for source verification.
- No invented sources. No paraphrased quotes posing as verbatim.
- Commit and push between phases — small commits are easier to review.
- Stop and document if: validator fails for unfamiliar reasons, more than 50% of any single brief's cite-pairs come back unsupported, or you'd need to invent a source to make a claim work. Do not paper over with WebSearch.

DONE WHEN
- All 11 briefs have `published: true` (or are honestly stripped to verified-only content).
- All 11 verification reports under data/jurisdiction-briefs/_verified/ have audit_method containing "direct WebFetch" and summary.unsupported = 0, summary.inaccessible = 0.
- docs/JURISDICTION-BRIEFS-HANDOFF.md has appended sections for methodology, usability, cross-system, and summary findings.
- `python3 scripts/validate-jurisdiction-briefs.py` exits 0.
- Repo working tree is clean on main.

---

After Codex finishes, verify with:

```bash
python3 scripts/validate-jurisdiction-briefs.py
grep -l "direct WebFetch" data/jurisdiction-briefs/_verified/*.json
python3 -c "
import json, glob
for p in sorted(glob.glob('data/jurisdiction-briefs/*.json')):
    if p.split('/')[-1].startswith('_'): continue
    d = json.load(open(p))
    print(f\"{d['geoid']}  {'✓' if d.get('published') else ' '}  {d['jurisdiction']}\")
"
```

You want 11 ✓s, 11 reports matching `"direct WebFetch"`, and a green validator.
