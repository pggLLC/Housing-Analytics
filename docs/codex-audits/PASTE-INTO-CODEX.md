# Paste this into Codex (or Claude Code, Cursor, any code agent)

One block, eight phases. Methodology + per-brief strip-first repair +
source-liveness automation + renderer affordances + usability +
cross-system + final report. No Cloudflare migration in this session.

Copy everything between the fences and paste into a fresh agent
session that has this repo as its working directory.

---

Full stabilization + audit pass on the jurisdictional briefs feature. No Cloudflare migration in this session — keep the existing salida2026 password gate as UI gating. Eight phases, each ending in a commit + push.

TOOL NOTES (read before starting; pick the closest equivalent in your environment).
- "Direct URL fetch" below means: pull the actual article HTML/text via HTTP (Claude Code: WebFetch; OpenAI Codex: built-in browse / shell `curl`; Cursor: chat web tool; generic: Python `urllib.request`). NEVER substitute a search-engine summary, snippet, or paraphrase. Carbondale's repair dropped from 75% supported under WebSearch snippets to 24% under direct URL fetch.
- "Issue creation" below uses `gh issue create` when GitHub CLI is available. If it isn't, append the issue body to a "## Pending issues for human triage (<date>)" section at the bottom of docs/JURISDICTION-BRIEFS-HANDOFF.md instead. Do not skip the report.
- "Boot a dev server" below uses `npx http-server . -p 8765 --silent`. If npx isn't on PATH, try `python3 -m http.server 8765 --bind 127.0.0.1` instead, then open the same URL.
- The validator (`scripts/validate-jurisdiction-briefs.py`) now has teeth: `published:true` requires the verification report's `audit_method` to contain "direct WebFetch" or "direct URL fetch" (case-insensitive) AND every `verdict: supported` row must have a non-empty `supporting_quote`. You cannot ship a fabricated verdict past this.

PHASE 1 — Read and orient.
Read docs/JURISDICTION-BRIEFS-HANDOFF.md, then data/jurisdiction-briefs/README.md and data/jurisdiction-briefs/_decisions.md. Reference: data/jurisdiction-briefs/_verified/0812045.json (Carbondale gold standard). Fabrication incident write-up is in the HANDOFF doc. No commit.

PHASE 2 — Methodology audit.
Read these and look for loopholes that would let a fabricated source slip past:
- scripts/validate-jurisdiction-briefs.py — does rule 8 actually block all failure modes?
- js/indibuild-gate.js — confirm threat model is documented honestly (UI gating, not encryption).
- scripts/build-codex-audit-package.py — quarantine heuristic complete?
- scripts/verify-brief-sources.py — does the enumeration miss any cite-pair shapes?
- data/jurisdiction-briefs/README.md source-first discipline — can a "supported" verdict be written without running a direct URL fetch?
Write findings into "## Methodology audit findings (<date>)" appended to docs/JURISDICTION-BRIEFS-HANDOFF.md. Fix any 5-line-or-less loophole in-session. File issues (or fall back per TOOL NOTES). Commit: `audit(briefs): methodology review + findings appended to HANDOFF`. Push.

PHASE 3 — Strip-first repair of the 10 quarantined briefs.
Goal: ship honest content fast. Do NOT swap URLs or rewrite. Drop anything that doesn't verify cleanly.
For each GEOID in this exact order — smallest cite-count first — 0864255, 08045, 0803620, 08097, 0817375, 0816000, 0867280, 0830780, 0827425, 0820000:
1. Open docs/codex-audits/<geoid>.md.
2. Direct-URL-fetch every URL in the audit plan with the row's prompt block. NEVER WebSearch.
3. Write verdicts to data/jurisdiction-briefs/_verified/<geoid>.json. The `audit_method` field MUST contain "direct WebFetch" or "direct URL fetch" — the validator now enforces this. Example: `"audit_method": "direct WebFetch — strip-first repair, <YYYY-MM-DD>"`.
4. For every row with `verdict: supported`, the `supporting_quote` MUST be a non-empty verbatim quote from the article. The validator now enforces this too.
5. Walk data/jurisdiction-briefs/<geoid>.json paragraph by paragraph. If ANY cite in a paragraph has verdict `unsupported` or `inaccessible`, delete that whole paragraph. Do NOT swap URLs, find replacement sources, or rewrite. Drop it.
6. After paragraph deletions, drop any source `id` no longer referenced anywhere. Drop any section now empty. If zero sections survive, leave published:false, commit the verification report only, move on.
7. If at least one section survives: re-validate (`python3 scripts/validate-jurisdiction-briefs.py` must exit 0) and set published:true.
8. Commit: `strip(briefs): <jurisdiction> — drop unsupported claims, keep verified` with body listing paragraphs dropped and what remains. Push.
9. Update the per-brief row in docs/JURISDICTION-BRIEFS-HANDOFF.md (✓ in published, "direct WebFetch (strip)" in method).
Stopping rule: if >80% of a brief's cite-pairs come back broken, commit the verification report, leave published:false, continue to the next GEOID. Don't salvage a mostly-broken brief.

PHASE 4 — Source-liveness automation.
Goal: catch URL rot between manual audits.
Create scripts/check-source-liveness.py:
- Walks data/jurisdiction-briefs/*.json (skip files starting with `_`).
- For each source URL: HTTP HEAD with 15-second timeout, follow redirects, realistic User-Agent ("COHO-source-liveness/1.0 (+github.com/pggLLC/Housing-Analytics)").
- Record (geoid, source_id, url, status_code, final_url, last_checked, error_type) to data/jurisdiction-briefs/_liveness.json with summary counts at top.
- error_type values: `ok` (2xx), `redirect_loop`, `client_error` (4xx), `server_error` (5xx), `timeout`, `dns_failure`, `other`.
- Print tab-separated summary to stderr. Exit 0 always (the workflow interprets).
- Python stdlib only (urllib.request, urllib.error, socket). No `requests` dependency.
Create .github/workflows/source-liveness-weekly.yml:
- Cron `0 14 * * 0` (Sundays 14:00 UTC) + `workflow_dispatch`.
- Steps: checkout main → setup-python@v5 with `python-version: '3.11'` → run script → run validator → if `data/jurisdiction-briefs/_liveness.json` changed, open a PR via `peter-evans/create-pull-request@v6` titled `chore(briefs): weekly source-liveness snapshot`, labels `briefs,liveness`, branch `chore/source-liveness-weekly`.
- `permissions: { contents: write, pull-requests: write }`.
Smoke-test locally: `python3 scripts/check-source-liveness.py` produces _liveness.json listing every cited URL with a status.
Commit: `feat(briefs): weekly source-liveness check + auto-PR`. Push.

PHASE 5 — Renderer affordances: "as-of" disclaimer + "report inaccuracy" button.
Goal: calibrate user trust and capture field reports without re-audit work.
Edit js/components/jurisdiction-brief.js in two places:
(a) In `_renderBrief()`, in the existing header strip ("Last verified <date> by <curator> (<N days ago>) [↻ Update brief]"), add a third element: a button "🚩 Report inaccuracy". Click → new tab, GitHub issue prefilled with: title `briefs: inaccuracy in <jurisdiction> brief (<geoid>)`; body referencing jurisdiction + GEOID + last_curated + a checkbox list (Specific sentence is wrong / Source URL is dead / Date or number is wrong / Other); labels `briefs,inaccuracy`. Match the existing `.jbrief__update-btn` styling but use a muted warn color (background `rgba(217,119,6,.12)`, border `var(--border)`, text `var(--text)`). Add dark-mode coverage in BOTH the `@media (prefers-color-scheme: dark)` block AND the `html.dark-mode` block (existing kind-badge styles are the pattern; dark colors: background `rgba(251,191,36,.18)`, text `#fde68a`).
(b) Just below the freshness line, add a one-line italic disclaimer `.jbrief__as-of-disclaimer`: "Sources verified at the date above. Articles, ordinances, and council records can change after verification — use Report inaccuracy if you spot drift." Color `var(--muted)`, font-size `.72rem`, font-style italic. Add a class-only dark-mode override if `var(--muted)` already adapts via the site theme.
Commit: `feat(briefs): "report inaccuracy" affordance + as-of disclaimer`. Push.

PHASE 6 — Usability audit (includes verifying the new affordances).
Boot: `npx http-server . -p 8765 --silent` (fallback per TOOL NOTES). Open http://localhost:8765/indibuild-brief.html?geoid=0812045. Enter password `salida2026`. Verify on Carbondale:
- Header strip: freshness chip, ↻ Update brief, 🚩 Report inaccuracy, as-of disclaimer all render in BOTH light and dark mode, all readable, no contrast regressions.
- Summary + all sections + all sources render in order.
- Source-list contrast readable in both modes (this was a 2026-06-12 regression — the `.dark-mode` selectors weren't matching the prefers-color-scheme media query).
- ↻ Update brief opens prefilled GitHub issue URL.
- 🚩 Report inaccuracy opens prefilled GitHub issue URL with the right title/body/labels.
- Try `?geoid=08123` (Weld County, no brief): "no brief yet, draft one" affordance fires; Copy command button works or falls back to text selection.
- Mobile viewport (~380px): brief is legible, header strip wraps cleanly, source list doesn't overflow. (Use your tool's viewport-resize feature; if none, narrow the browser window.)
Document any rendering, contrast, or interaction bugs in "## Usability audit findings (<date>)" section appended to docs/JURISDICTION-BRIEFS-HANDOFF.md. Fix small ones in-session; file issues for the rest (or fall back per TOOL NOTES). Stop the dev server.
Commit (if anything changed): `fix(briefs): usability findings from <date> audit`. Push.

PHASE 7 — Cross-system audit.
- Open data/hna/local-resources.json. For each jurisdiction now published: check housingLead / contacts / plans / advocacy for duplication or contradiction with brief content. Reconcile by editing whichever is wrong; document the call in HANDOFF.
- Read js/components/watchlist.js. Confirm the Watchlist (per-device localStorage) does NOT auto-trigger anything brief-related (per the 2026-06-12 decision in _decisions.md). Flag if it does.
- Open indibuild.html, indibuild-where.html, indibuild-pipeline.html — confirm they don't accidentally render brief content outside the gated indibuild-brief.html page.
Document inconsistencies in the same audit-findings section. Reconcile in-session if 5-line fix; otherwise file issues.
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
  grep -l "direct WebFetch\|direct URL fetch" data/jurisdiction-briefs/_verified/*.json | wc -l
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
- Direct URL fetch always (whichever primitive your environment provides); never a search-engine summary or snippet as a substitute. Carbondale dropped 75% → 24% supported when method changed.
- Drop, don't rewrite. If a cite is unsupported or inaccessible, the paragraph goes. No URL hunting, no rewording, no "close enough."
- No invented sources. No paraphrased verbatim quotes (the validator now requires every `supported` verdict to carry a non-empty `supporting_quote`).
- No published:true over a single unsupported row.
- Commit and push at the boundary of every phase. Each previous phase's commit is your rollback point.
- Stop and document if: validator fails for a reason not covered above, more than 80% of a single brief's cite-pairs come back broken (leave published:false), or you'd need to invent a source. Do not paper over with WebSearch.

DONE WHEN
- Every brief that survived strip-first repair has published:true AND verification report summary unsupported:0 inaccessible:0 AND audit_method contains "direct WebFetch" / "direct URL fetch" AND every supported row has a non-empty supporting_quote.
- Briefs that didn't survive are honestly left at published:false with the report documenting why.
- scripts/check-source-liveness.py runs, produces _liveness.json, wired into weekly cron.
- Renderer shows freshness chip + Update brief + Report inaccuracy + as-of disclaimer in light AND dark mode without contrast regressions.
- Methodology, usability, cross-system, and stabilization-summary sections all appended to docs/JURISDICTION-BRIEFS-HANDOFF.md.
- python3 scripts/validate-jurisdiction-briefs.py exits 0.
- git status is clean on main.
