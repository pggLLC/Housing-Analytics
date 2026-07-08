# Codex — Site Audit Phase 2: IA Cleanup (2026-07)

**For**: Codex (implementer)
**QA**: Claude Code reviews each item's PR against its own gate below before the owner merges. **Three separate PRs, one QA gate each. Do not start the next item until the current one is merged.** Same rhythm as Phase 0 and Phase 1.
**Owner**: paulglasow (merges; squash-merge convention)
**Repo**: `pggLLC/Housing-Analytics` · Public site: `cohoanalytics.com`
**Source**: `docs/qa/site-audit-2026-07/04-plan.md` §Phase 2 (items 2.1–2.3). Findings B-01/B-02/B-03/B-04/B-06/B-07/B-08 in `docs/qa/site-audit-2026-07/02-ia-ux-copy.md` are the underlying evidence — all citations below were independently re-verified against current code before writing this doc (not just relayed from the audit report), since Phase 0/1 work landed between the audit date and this doc and could have moved things.

## Order

Do 2.1 first — it's the narrowest, most concrete item and several of 2.3's homepage links point at pages 2.1 touches. 2.2 has no dependency on the other two and can run anytime. 2.3 should come last since it's the most visible/riskiest change (homepage) and benefits from 2.1's Data Trust Center existing as a real link target.

**Important context you must not re-litigate**: the June 2026 nav consolidation (F177/F182 in `js/navigation.js`, committed 2026-06-08/09 — a month before this audit) already reduced the Data nav group from 5 pages to 3 (`data-review-hub.html`, `data-explorer.html`, `data-map-browser.html`) and demoted `dashboard-data-quality.html`/`data-status.html` out of the top nav. **Do not redo that work.** What's still missing is described in 2.1 below: the pages themselves still read as separate operational tools, not one trust-center experience, even though the nav entry point is already decluttered.

---

## 2.1 — Data Trust Center (P1)

**Verified**: three separate, only loosely cross-linked pages currently carry the "can I trust this data" story:
- `data-review-hub.html` (nav label "Data Hub") — its own Quick Links section (~line 741) literally labels two of the other three as `Legacy: Data Sources Dashboard` and `Legacy: Data Status`, i.e. the codebase already knows these are redundant/superseded but hasn't consolidated them.
- `data-status.html` (~line 274-275) — a per-source freshness/validation view, explicitly scoped as "NOT an SLA dashboard," that links out to `dashboard-data-sources-ui.html` and `dashboard-data-quality.html` for more detail.
- `dashboard-data-quality.html` (nav-demoted, page title now "Coverage QA", ~line 191) — API config status, per-source coverage %, and the 5-layer QA status panel (schema → sentinel → bounds → freshness → plausibility), plus a place-CHAS TIGER-coverage breakdown.

A public user (not a maintainer) who wants to answer "is this data current and where does it come from" has to visit up to four pages (`data-review-hub`, `data-status`, `dashboard-data-sources-ui`, `dashboard-data-quality`) and interpret operational language ("Pipeline log," "Coverage QA," "5-Layer QA Status") that assumes maintainer context.

**Fix**: consolidate into one public entry point — reuse `data-review-hub.html` as the "Data Trust Center" (it's already the least operational-sounding of the four and already nav-anchored as "Data Hub") rather than creating a fifth new page. Add three in-page sections/tabs matching the audit's recommendation:
1. **Freshness** — pull the per-source last-pull/vintage view currently on `data-status.html`.
2. **Sources** — pull the source catalog currently on `dashboard-data-sources-ui.html`.
3. **QA Coverage** — pull (or link prominently to, if the 5-layer panel is too heavy to inline) the QA status panel currently on `dashboard-data-quality.html`.

Keep `data-status.html`, `dashboard-data-sources-ui.html`, and `dashboard-data-quality.html` alive as real pages (maintainers/QA tooling may deep-link them; do not break URLs) — this is a "make the consolidated view the primary public path" change, not a deletion. Rename nav label from "Data Hub" to "Data Trust Center" in `js/navigation.js` (the `Data` group, `data-review-hub.html` entry) if the new page content matches that framing; otherwise justify keeping "Data Hub" in the PR description.

Rewrite operational language for a non-maintainer audience per finding B-07 — e.g. reframe "Pipeline log" / "Coverage QA" / "5-Layer QA Status" sections with public-facing headers ("What data is fresh?", "What data is missing?", "What is estimated?") while keeping the technical detail available (expandable/secondary), not deleted. `dashboard-data-quality.html` already has a template for this pattern — its own H1 shows the old technical name in parentheses next to the new one (`Coverage QA <span>(was "Data Quality Dashboard")</span>`) — follow that same rename-with-breadcrumb convention rather than silently dropping the old name.

**Tests**: extend or add to `test/navigation-paths.test.js` asserting the Data Trust Center page exists and is reachable from the top nav under that label (or your justified alternative); a content test confirming all three sub-views (Freshness/Sources/QA Coverage) are present on the consolidated page, not just linked out.

**QA gate 2.1**: load the consolidated page and confirm a non-maintainer can answer "what's fresh, where does it come from, what's missing" without leaving the page or parsing operational jargon. Confirm `data-status.html`/`dashboard-data-sources-ui.html`/`dashboard-data-quality.html` still load standalone (no broken links from external references or bookmarks). Confirm the nav change (if made) doesn't reintroduce the pre-F182 5-entries-in-Data-group clutter — this should still be a small nav footprint pointing at one primary entry.

---

## 2.2 — Public/internal pipeline wording (P1)

**Verified — this is a naming decision, not a gating bug.** The word "Pipeline" is currently overloaded between two unrelated things:
1. **`pipeline.html`** — a genuinely public, unauthenticated 8-step methodology reference ("An eight-step public-data reference for how Colorado affordable housing moves from documented community need to homes residents can afford"). This is promoted via a "Developer Pipeline teaser strip" banner on `housing-needs-assessment.html` (~line 258) and `lihtc-opportunity-finder.html` (~line 1513), both reading "New: **The Affordable Housing Pipeline** — see how this fits into our 8-step public methodology," linking to `pipeline.html`.
2. **The gated "+ Add to Developer Pipeline" button** (`js/components/pipeline-add-button.js`-driven mount, referenced via F162 comments in `compare.html` ~214/267, `deal-calculator.html` ~173/1190, `market-analysis.html` ~583/2188) — an internal CRM feature for logging jurisdictions into a developer's deal pipeline. **Confirmed this does not leak to public visitors**: `_hydrate()` in `market-analysis.html` (~line 2247) sets `mount.innerHTML = ''` and returns whenever `_isIBAuthed()` is false, and the equivalent pattern holds in `compare.html`/`deal-calculator.html`. There is no rendered-but-unauthenticated state showing "Developer Pipeline" text to a public visitor today — the F-code comments (F152, F162) use the word "Pipeline" in both contexts, but that's a code-comment/maintainer-facing overlap, not a user-facing one.

**So the fix is a naming decision + rename, not a hide-the-leak fix**: pick a name for the internal CRM feature that doesn't share "Pipeline" with the public methodology page, since the shared word makes the codebase (and any future public copy referencing "the pipeline") ambiguous even though today's runtime behavior is correct. Suggested direction (confirm with the owner if it doesn't feel right before implementing): rename the internal feature to something like "Deal Tracker" or "My Pipeline" (scoped to the developer's own account, distinct from "The Affordable Housing Pipeline" public methodology) across its UI strings, `id`/class names where reasonably safe to change, and F162 code comments. Leave `pipeline.html` and the public teaser banners as-is — they're the correctly-named, correctly-public side of this.

**While you're in this code**: re-verify the gating is still correct as you touch each mount (`compare.html`, `deal-calculator.html`, `market-analysis.html`) — confirm `mount.innerHTML = ''` (or equivalent empty-state) still fires for an unauthenticated session after your rename, since a rename touching `_hydrate()`/`_isIBAuthed()` call sites is exactly the kind of change that could accidentally regress the gate. Don't broaden scope to change the gating mechanism itself — `js/developer-gate.js` and the `ib-auth-v1` session-storage check are out of scope for this item.

**Tests**: a test asserting no public, unauthenticated page render contains the renamed internal-feature string outside of gated/empty mounts (grep the built HTML + a jsdom-style empty-session render if the existing test harness supports it — check how other gated-mount tests in this repo verify empty-state, e.g. `test/data-scope.test.js`'s patterns, before inventing a new harness). Keep `test:navigation-paths` and any existing pipeline-teaser test green.

**QA gate 2.2**: grep the full diff and the built public pages for the old internal-feature name to confirm the rename is complete and consistent; confirm the public `pipeline.html` teaser banners and their copy are untouched; manually verify (or get a description of local verification, since Playwright isn't reliably available in this environment per PR #1080's noted limitation) that the gated mount still renders empty for a logged-out session on all three touched pages.

---

## 2.3 — Homepage job routing (P2)

**Verified**: `index.html`'s current structure (in order) is: hero with a "Select Jurisdiction" primary CTA and a 6-item linear workflow list (Opportunity Finder → Select Jurisdiction → Needs Assessment → Market Analysis → Scenarios → Deal Calculator, ~line 46-178) → "The LIHTC Development Workflow" section (~line 178) → "What is LIHTC" explainer (~line 263) → audience section (~line 293) → a "dignity" section (~line 330) → the statewide data snapshot (~line 353) → cited research sources (~line 443) → "From the platform" insights (~line 467). There is no jurisdiction search box on the homepage itself (the CTA links out to `select-jurisdiction.html`), and the primary framing is a single linear 6-step LIHTC workflow rather than the audit's recommended job-based routing (Understand need / Find opportunity / Test feasibility) or a place-page-first entry (483 generated place pages exist under `places/`, per finding B-06, but the homepage doesn't route to them directly).

**Scope, deliberately limited — this is a reorganization, not a rewrite**: per finding B-01, recast the top of the homepage around jurisdiction-first entry plus job routing, without discarding the existing 6-step LIHTC workflow content (it's real, useful, and heavily cross-linked) or the audience/dignity/research-sources sections below it.
1. Keep (or promote) jurisdiction selection as the first interactive element — either the existing `select-jurisdiction.html` CTA or, if scope allows, an inline jurisdiction search that also surfaces place-page results (finding B-06).
2. Add job-routing framing near the top: three paths — Understand need (→ HNA/compare), Find opportunity (→ Opportunity Finder/preservation inventory), Test a site/deal (→ Market Analysis/Deal Calculator/Land Value) — as a lightweight addition alongside (not a replacement for) the existing 6-step workflow list, since that list documents a real sequential process some users do want.
3. Link the "Data Trust Center" from 2.1 into the homepage's data-snapshot area (~line 353) so the "every stat is sourced" claim (finding B-04, ~line 356-360) has one clear place to click through to, and soften that claim's wording per B-04 if 2.1 doesn't yet guarantee full cross-surface reconciliation — do not overclaim more than the current data pipeline actually verifies.

**Do not** touch `robots.txt`, `sitemap*.xml`, `CNAME`, or `test/pages-availability-check.js` — this repo's deploy gate depends on them and they are out of scope for every phase per the phased-implementation master script's global rules.

**Tests**: `npm run test:navigation-paths` and `npm run test:public-build` must stay green. Add a content test asserting the job-routing links (Understand need / Find opportunity / Test feasibility, or your final naming) resolve to real pages, and that the jurisdiction-first CTA/search is still present above the fold in source order.

**QA gate 2.3**: this is the item most likely to need a rendered check — `UNRENDERED` mobile/blank-state gaps were explicitly flagged by finding B-09 for this whole audit. If a rendered QA pass (Phase 3 of the site-audit plan) hasn't landed yet, at minimum confirm via source inspection that job-routing and jurisdiction-first elements appear before the 6-step workflow list in DOM order, and get one manual screenshot (desktop + mobile width) attached to the PR showing the new hero/job-routing area, since this is the single highest-traffic page on the site and a source-only review isn't sufficient confidence for a homepage change.

---

## Deliverables per item (PR description template)

1. Summary of what changed and why
2. Which audit finding (B-01/B-02/B-03/B-04/B-06/B-07/B-08) this closes
3. Verification: what you independently confirmed against current code, not just what the audit/this doc said — line numbers drift, re-check them
4. Tests added and their results
5. Known limitations (e.g. if 2.3's rendered verification is limited by sandbox constraints, say so explicitly, matching PR #1080's precedent)
