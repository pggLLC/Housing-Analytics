# Paste this into Codex

One block, eight phases. Methodology + per-brief strip-first repair +
source-liveness automation + renderer affordances + usability +
cross-system + final report. No Cloudflare migration in this session.

Copy everything between the fences and paste into a fresh Codex (or
Claude Code, Cursor) session that has this repo as its working
directory.

---

Full stabilization + audit pass on the jurisdictional briefs feature. No Cloudflare migration in this session — keep the existing salida2026 password gate as UI gating. Eight phases, each ending in a commit + push.

PHASE 1 — Read and orient.
Read docs/JURISDICTION-BRIEFS-HANDOFF.md, then data/jurisdiction-briefs/README.md and data/jurisdiction-briefs/_decisions.md. The gold-standard reference for what a verified brief + clean verification report looks like is data/jurisdiction-briefs/_verified/0812045.json (Carbondale, repaired 2026-06-12 via direct WebFetch). The fabrication incident write-up is in the HANDOFF doc. No commit in this phase.

PHASE 2 — Methodology audit.
Read these and look for loopholes that would let a fabricated source slip past:
- scripts/validate-jurisdiction-briefs.py — does rule 8 actually block all failure modes? Can a brief be published with a lying _verified/<geoid>.json?
- js/indibuild-gate.js — password is SHA-256 of "salida2026". Confirm the threat model is documented honestly (UI gating, not encryption).
- scripts/build-codex-audit-package.py — quarantine heuristic: does it skip any brief that should be queued?
- scripts/verify-brief-sources.py — does the enumeration miss any cite-pair shapes?
- data/jurisdiction-briefs/README.md source-first discipline — can a "supported" verdict be written without running WebFetch?
Write findings into "## Methodology audit findings (<date>)" appended to docs/JURISDICTION-BRIEFS-HANDOFF.md. Fix any 5-line-or-less loophole in-session; open GitHub issues (`gh issue create`, title prefix `[briefs]`) for bigger ones. Commit: `audit(briefs): methodology review + findings appended to HANDOFF`. Push.

PHASE 3 — Strip-first repair of the 10 quarantined briefs.
Goal: ship honest content fast. Do NOT swap URLs or rewrite. Drop anything that doesn't verify cleanly.
For each GEOID in this exact order — smallest cite-count first — 0864255, 08045, 0803455, 08097, 0817375, 0816000, 0867280, 0830780, 0827425, 0820000:
1. Open docs/codex-audits/<geoid>.md.
2. WebFetch every URL in the audit plan with the row's prompt block. NEVER WebSearch — Carbondale dropped from 75% supported under WebSearch snippets to 24% under direct WebFetch.
3. Write verdicts to data/jurisdiction-briefs/_verified/<geoid>.json with audit_method = "direct WebFetch (strip-first repair, <YYYY-MM-DD>)".
4. Walk data/jurisdiction-briefs/<geoid>.json paragraph by paragraph. If ANY cite in a paragraph has verdict `unsupported` or `inaccessible`, delete that whole paragraph. Do NOT swap URLs, find replacement sources, or rewrite. Drop it.
5. After paragraph deletions, drop any source `id` no longer referenced anywhere. Drop any section now empty. If zero sections survive, leave published:false, commit the verification report only, move on.
6. If at least one section survives: re-validate (`python3 scripts/validate-jurisdiction-briefs.py` must exit 0) and set published:true.
7. Commit: `strip(briefs): <jurisdiction> — drop unsupported claims, keep verified` with body listing paragraphs dropped and what remains. Push.
8. Update the per-brief row in docs/JURISDICTION-BRIEFS-HANDOFF.md (✓ in published, "direct WebFetch (strip)" in method).
Stopping rule: if >80% of a brief's cite-pairs come back broken, commit the verification report, leave published:false, continue to the next GEOID. Don't salvage a mostly-broken brief.

PHASE 4 — Source-liveness automation.
Goal: catch URL rot between manual audits.
Create scripts/check-source-liveness.py:
- Walks data/jurisdiction-briefs/*.json (skip files starting with `_`).
- For each source URL: HTTP HEAD with 15-second timeout, follow redirects, realistic User-Agent.
- Record (geoid, source_id, url, status_code, redirect_chain, last_checked, error_type) to data/jurisdiction-briefs/_liveness.json with summary counts at top.
- Treat any non-2xx (after redirects) as a problem. Print tab-separated summary to stderr. Exit 0 always.
- Standard library only (urllib.request). No `requests` dependency.
Create .github/workflows/source-liveness-weekly.yml:
- Cron: `0 14 * * 0` (Sundays 14:00 UTC) + workflow_dispatch.
- Steps: checkout main → setup Python 3.11 → run script → run validator → if `_liveness.json` changed, open a PR via peter-evans/create-pull-request titled `chore(briefs): weekly source-liveness snapshot`, labels `briefs,liveness`.
Smoke-test locally: `python3 scripts/check-source-liveness.py` produces _liveness.json listing every cited URL with a status.
Commit: `feat(briefs): weekly source-liveness check + auto-PR`. Push.

PHASE 5 — Renderer affordances: "as-of" disclaimer + "report inaccuracy" button.
Goal: calibrate user trust and capture field reports without re-audit work.
Edit js/components/jurisdiction-brief.js in two places:
(a) In `_renderBrief()`, in the existing header strip that shows "Last verified <date> by <curator> (<N days ago>) [↻ Update brief]", add a third element: a button "🚩 Report inaccuracy". Click → new tab, GitHub issue prefilled with: title `briefs: inaccuracy in <jurisdiction> brief (<geoid>)`; body referencing jurisdiction + GEOID + last_curated + checkbox list (Specific sentence is wrong / Source URL is dead / Date or number is wrong / Other); labels `briefs,inaccuracy`. Match the existing `.jbrief__update-btn` styling but use a muted warn-color background (NOT accent). Add dark-mode coverage in BOTH the `@media (prefers-color-scheme: dark)` block AND the `html.dark-mode` block (existing kind-badge styles are the pattern).
(b) Just below the freshness line, add a one-line italic disclaimer `.jbrief__as-of-disclaimer`: "Sources verified at the date above. Articles, ordinances, and council records can change after verification — use Report inaccuracy if you spot drift." Light text color, smaller font. Dark-mode coverage same dual-rule pattern.
Commit: `feat(briefs): "report inaccuracy" affordance + as-of disclaimer`. Push.

PHASE 6 — Usability audit (includes verifying the new affordances).
Boot: `npx http-server . -p 8765 --silent` (background). Open http://localhost:8765/indibuild-brief.html?geoid=0812045. Enter password `salida2026`. Verify on Carbondale:
- Header strip: freshness chip, ↻ Update brief, 🚩 Report inaccuracy, as-of disclaimer all render in BOTH light and dark mode, all readable, no contrast regressions.
- Summary + all sections + all sources render in order.
- Source-list contrast readable in both modes (this was a 2026-06-12 regression).
- ↻ Update brief opens prefilled GitHub issue URL.
- 🚩 Report inaccuracy opens prefilled GitHub issue URL with the right title/body/labels.
- Try `?geoid=08123` (Weld County, no brief): "no brief yet, draft one" affordance fires; Copy command button works or falls back to text selection.
- Mobile viewport (~380px): brief is legible, header strip wraps cleanly, source list doesn't overflow.
Document any rendering, contrast, or interaction bugs in "## Usability audit findings (<date>)" section appended to docs/JURISDICTION-BRIEFS-HANDOFF.md. Fix small ones in-session; open issues for the rest. Stop the dev server.
Commit (if anything changed): `fix(briefs): usability findings from <date> audit`. Push.

PHASE 7 — Cross-system audit.
- Open data/hna/local-resources.json. For each jurisdiction now published: check housingLead / contacts / plans / advocacy for duplication or contradiction with brief content. Reconcile by editing whichever is wrong; document the call in HANDOFF.
- Read js/components/watchlist.js. Confirm the Watchlist (per-device localStorage) does NOT auto-trigger anything brief-related (per the 2026-06-12 decision in _decisions.md). Flag if it does.
- Open indibuild.html, indibuild-where.html, indibuild-pipeline.html — confirm they don't accidentally render brief content outside the gated indibuild-brief.html page.
Document inconsistencies in the same audit-findings section. Reconcile in-session if 5-line fix; otherwise open issues.
Commit (if anything changed): `fix(briefs): cross-system reconciliation`. Push.

PHASE 8 — Final report + verification.
Append "## Codex stabilization summary (<date>)" to docs/JURISDICTION-BRIEFS-HANDOFF.md with:
- Strip-first repair counts: how many briefs went to published:true, how many stayed published:false because >80% of cite-pairs were broken, total cite-pairs dropped.
- Methodology gaps found (with file:line refs) — fixed inline vs. left as issues.
- New automation: link to the weekly source-liveness workflow + script.
- Renderer affordances: link to relevant commit(s).
- Usability bugs found + fixed vs. flagged.
- Cross-system inconsistencies + resolutions.
- Recommended follow-ups in priority order.
- Token / time cost of the audit, for next reviewer's budgeting.
Run the final verification block and put outputs in your closing message:

  python3 scripts/validate-jurisdiction-briefs.py
  python3 scripts/check-source-liveness.py
  grep -l "direct WebFetch" data/jurisdiction-briefs/_verified/*.json | wc -l
  python3 -c "
  import json, glob
  n_pub = n_total = 0
  for p in sorted(glob.glob('data/jurisdiction-briefs/*.json')):
      if p.split('/')[-1].startswith('_'): continue
      d = json.load(open(p))
      n_total += 1
      if d.get('published') is True: n_pub += 1
  print(f'{n_pub} of {n_total} briefs published')
  "
  git status

Commit: `docs(briefs): stabilization pass summary`. Push.

DISCIPLINE
- Direct WebFetch always; never WebSearch as a substitute. Carbondale dropped 75% → 24% supported when method changed.
- Drop, don't rewrite. If a cite is unsupported or inaccessible, the paragraph goes. No URL hunting, no rewording, no "close enough."
- No invented sources, no paraphrased verbatim quotes, no published:true over a single unsupported row.
- Commit and push at the boundary of every phase. Each previous phase's commit is your rollback point.
- Stop and document if: validator fails for a reason not in the codex-audit packages, more than 80% of a single brief's cite-pairs come back broken (leave published:false), or you'd need to invent a source. Do not paper over with WebSearch.

DONE WHEN
- Every brief that survived strip-first repair has published:true AND verification report summary unsupported:0 inaccessible:0.
- Briefs that didn't survive are honestly left at published:false with the report documenting why.
- scripts/check-source-liveness.py runs, produces _liveness.json, wired into weekly cron.
- Renderer shows freshness chip + Update brief + Report inaccuracy + as-of disclaimer in light AND dark mode without contrast regressions.
- Methodology, usability, cross-system, and stabilization-summary sections all appended to docs/JURISDICTION-BRIEFS-HANDOFF.md.
- python3 scripts/validate-jurisdiction-briefs.py exits 0.
- git status is clean on main.
