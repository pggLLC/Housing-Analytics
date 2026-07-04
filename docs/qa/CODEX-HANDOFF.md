# Codex Handoff — single source of truth

_Updated 2026-07-04 by Claude. **See the 2026-07-04 QA/AUDIT section immediately below for the current work order** — URGENT production data hotfix (Task A), audit sweep of everything merged since the 2026-07-03 refresh (Task B), open-PR QA (Task C), one feature fix (Task D). The 2026-07-03 PHASE STATUS section and everything below it is HISTORICAL record (kept for provenance). PII-history purge stays deferred to production._

---

## 2026-07-04 — QA/AUDIT HANDOFF: AMI hotfix (URGENT) + post-07-03 merge sweep + open-PR QA
_(Current. Authored by Claude after deep-dive benchmarking of the repo HNA against five professional consultant reports — Root Policy La Plata 2025, GG+A Pueblo 2021, Ayres Milliken 2025, WSW Alamosa 2021, czbLLC Erie 2023 — which validated the repo's base data and exposed the Task A regression. Baseline for "since last handoff": commit `2ec44cbb1` (2026-07-03). All diagnoses below are VERIFIED — do not re-derive; do not re-litigate items marked settled.)_

**New QA instruments Claude added (in open PR #1030, branch `hna-hardening` — merge it first or cherry-pick):**
- `npm run test:hna-benchmarks` — repo-vs-consultant calibration ratios (`data/hna/benchmarks.json` + `scripts/hna/check_benchmarks.py`). Run after ANY gap/ranking regen; paste output in PR bodies.
- `npm run check:dola-vintage` — proves our projections track SDO's official vintage-2023 forecast (median −1.4% at 2030, 64/64 counties). Settled: our DOLA numbers are NOT understated; consultants used hotter pre-revision vintages.
- KNOWN TRAP: `gap_units_minus_households_le_ami_pct` has OPPOSITE sign conventions in `co_ami_gap_by_county.json` (negative = shortage) vs `co_ami_gap_by_place.json` (positive = shortage). Never mix; recompute from the two component fields when in doubt.

### TASK A — URGENT hotfix: per-county HUD income limits flattened (live, user-facing)
- `data/hud-fmr-income-limits.json` → `income_limits.ami_4person` = **107200 for ALL 64 counties** (CO state median); `il30_4person` = 32150 for all 64. The `fmr` block is CORRECT (47 distinct two_br values) — only income_limits is flattened.
- Correct per-county values: see commit `85bb0cd99` (16 distinct AMIs; Alamosa 08003=75,600; Pueblo 08101=87,900; La Plata 08067=103,500; Weld 08123=108,200).
- Broken by the 2026-06-05 refresh (`752741af9`, `d470dea8a`) — `scripts/fetch_fmr_api.py` income-limits path (~line 276) falls back to the state record; the FMR path works, so compare how the two query HUD's API.
- Dormant until #1032 (AMI methodology v2) switched gap builders to read this file. Consequence: ALL county/place AMI-tier thresholds are wrong on the live site (e.g. Alamosa's 30%-AMI threshold rent computed at $804 vs ~$567 → artifactual NEGATIVE gap of −94).
- Steps: (1) fix fetch_fmr_api.py per-county IL fetch; (2) regen the HUD file, assert ≥10 distinct ami_4person values; (3) add that distinctness guard to `scripts/validate-critical-data.js` (its range-only checks passed the flat file — that's the guard gap); (4) regen `co_ami_gap_by_county.json` + `co_ami_gap_by_place.json` → `ranking-index.json` → ranking scenarios (order is load-bearing); (5) verify with `test:hna-benchmarks`: Alamosa ≤30% gap back POSITIVE; La Plata ≤50% near Root Policy's 963 (it was 842 under the flat AMI; expect ~900–1,300 at the correct 103,500); (6) refresh stale "fix in flight" caveats in `data/hna/benchmarks.json`; (7) PR with before/after harness output.

### TASK B — audit sweep of everything merged since `2ec44cbb1` (2026-07-03)
Substantive merges, each with the specific check that matters:
1. **#1026 "Apply A+B ranking tuning"** — the 07-03 section below records A+B as **consciously DEFERRED (owner value-call)**, yet #1026 applied gap blend 0.4/0.6 + `COMMUTER_AUGMENT_ALPHA=0.20` (verified in `build_ranking_index.py` L84-87). Confirm the reversal was owner-approved (PR thread); verify applied values match #1013's report scenarios and the augment-only commuter invariant still holds; face-validity check the post-#1026 top-50.
2. **#1025 CAR fallback hardening** — the hardcoded `['2026-05','2026-07','2026-06','2026-04']` month list in `housing-needs-assessment.html` appears gone; verify the replacement is a dynamic newest-first month walk that (a) picks up `2026-08+` when it exists, (b) KEPT county-aware selection, (c) tolerates missing months without console noise.
3. **#1028 "Draft: Fix CAR monthly cron dependency loading"** — merged with a "Draft:" title (hygiene flag). Verify the cron workflow actually resolves its deps (dry-run the script locally); confirm the next monthly run won't fail the same way.
4. **#1027 exploratory ranking scenario overlays** — scenarios pin `ranking-index.json` generatedAt; verify they were rebuilt AFTER #1026's re-rank and get rebuilt again after Task A's regen (else ci-checks fails).
5. **#1029 ZORI capture rescue** — settled design: deal-calc scales ZORI by FMR bedroom ratios ON PURPOSE. Only verify the Finder now uses shared `zori-rent-utils.js` and its numbers match the deal-calc for 2-3 counties. Do NOT re-flag the design.
6. **#1033 projector vacancy guard** — verify "Observed active-market" renders sanely for BOTH statewide and county selections (the bug was statewide-only).
7. **#1036 statewide summary cache** — verify `data/hna/summary/08.json` DP04 semantics match county files and that the CI wiring it added actually runs.
8. **#1032 AMI v2** — logic is sound and settled (renter-household demand via B25118 corrected a 3–5× tenure-mixing bias); its data output is subsumed by Task A. Audit only that `demand_tenure:"renter"` and `methodology_version:2` stay consistent across both gap files post-regen.
9. **Quarantine-bot commits** ("Automated quarantine, audit, and documentation after merge") — spot-check the latest actually quarantined what its log claims; the bot has previously deleted generators (check git history before assuming a script is gone).

### TASK C — open-PR QA
- **#1030 (hna-hardening)** — Claude-authored and Claude-verified (byte-stability, browser popover, 730-check suite green). Merge FIRST; light review only. Merges clean (0 conflicts; only overlap with #1031 is one heading attribute in housing-needs-assessment.html).
- **#1031 (BPS permits, 69,924 additions)** — full QA: (a) UNITS not buildings from BPS; (b) GEOID crosswalk vs `geography-registry.json` + `place-phantom-aliases.json` (0800775→0801090, 0855745→0862000), report the match rate; (c) spot-check 2-3 counties vs Census's published BPS tables (Weld among the state's largest; San Juan ≈0); (d) production-vs-need must compare against county `incremental_units_needed_dola` ONLY — no place-level projections exist, and mislabeled place/county pairing recreates a known masking bug; (e) run `node test/pages-availability-check.js` + `npm run test:place-pages-fresh` (it touches 80 place pages).
- **#1034 (serverless AMI-gap v2 port)** — AFTER Task A. Check it doesn't embed/serve values derived from the corrupt file; verify endpoint output for 08067 / 0801090 / 0824950 (Erie — NOT 0824785, that's Englewood) against the regenerated gap files; confirm no request-time keyless Census API calls (repo convention: those always fail; cached JSON is the source of truth).
- **Merge order: #1030 → Task A hotfix → #1031 → #1034.**

### TASK D — seasonal/small-sample vacancy in ranking index (new PR, after Task A)
`ranking-index.json` metrics.vacancy_rate is raw ACS rental vacancy; 23/483 places exceed 15% for two indistinguishable reasons: structural seasonal (Breckenridge 50%, Vail 41.3%, Steamboat 27.1%) vs 1-yr small-sample noise (Milliken 22.4% on a ~337-unit renter base). County projections already exclude seasonal (`active_market_5to7`, `build_hna_data.py` ~L1880-1960); the ranking metric doesn't. Fix: ACS B25004 per place → seasonal share; ranking vacancy input = active-market only, with a small-sample fallback to county active-market vacancy below a documented renter-base floor. Keep raw + adjusted values in the output; regen index + scenarios; show the top-50 churn in the PR body.

---

## 2026-07-03 — PHASE STATUS: C-0 → briefs → CAR COMPLETE; NEXT = brief-generation
_(Current. Supersedes the 2026-06-29 / 06-30 / 07-01 planning sections below, which are kept as historical record.)_

**The C-0 → tuning → Briefs B1–B4 → CAR phase is DONE, merged, and live on main.**

**SHIPPED (all merged + deployed):**
- **C-0** home-value cascade — #1008/#1009 (ZHVI stamp + `build_hna_data.py` self-stamp pipeline guard; daily-refresh recurrence fixed).
- **Overcrowding (tuning candidate D)** — #1019 (`DP04_0076/0078/0079E` into `backfill_hna_extended_acs_cache.mjs`) + backfill dispatch + #1020 (compute `overcrowding_rate` replacing the `build_ranking_index.py` L1119 `None`; type-scoped percentile `overcrowding_score` at `COMMUNITY_NEED_WEIGHTS["overcrowding_score"]=0.10`; **None-skip** so no-data geos aren't penalized; `housing-type-need.js` display-bug fix → `DP04_0078PE+0079PE`). Face-validity PASS (Summit ski towns rise). **D-4/D-5/D-6 combined-re-rank ceremony intentionally SKIPPED** (owner + Claude: ranking is in good shape; ship overcrowding at 0.10 as the default).
- **Briefs** — B1 (metric-digest spine) → **B2** #1021 (self-verifying `kind:"data"` digest section; validator auto-checks `value == digest[geoid].metrics[field].value`) → **B3** #1022 (place economic / service-worker layer; `economic_housing_bridge.py` shelled from the digest builder; county-sourced terms `county_context`-labeled) → **B4** #1023 (verified business/development sections on all 12 briefs; **26/26 citations adversarially verified real, 0 fabrications**).
- **CAR county market ingest** — #1024 (`scripts/fetch-car-showingtime.mjs`: ShowingTime `sst` fetch → 64 counties; browser-UA + retries; **jsdom** parser after CodeQL flagged the hand-rolled regex; best-effort exit-0 + graceful fallback; HNA county cards + CAR/ShowingTime attribution). Surfacing verified by loader replay (Denver $718k, Adams $522k, Gunnison $825k).

**LEFT IN THIS PHASE (small):**
- **CAR closeout PR (in flight):** de-fragilize the HNA `tryLoadCARFallback` loader (`housing-needs-assessment.html` ~L1884 — it hardcodes `['2026-05','2026-07','2026-06','2026-04']`, so it prefers May and will NOT try `2026-08+` → goes stale as the calendar advances; replace with a dynamic newest-first month walk that KEEPS the county-aware selection) + verify the monthly ShowingTime fetch is self-sustaining (WAF may block CI runners → may need a manual/local seed).
- **A+B tuning — consciously DEFERRED, not applied** (`docs/qa/tuning-candidates-2026-06-30.md`): **A** = gap count/rate blend (`GAP_COUNT_WEIGHT/GAP_RATE_WEIGHT` `0.50/0.50` → `0.40/0.60` or `0.35/0.65`; **MATERIAL** re-rank, lifts small high-rate geos; an owner value-call of need-RATE vs need-COUNT). **B** = commuter alpha (`COMMUTER_AUGMENT_ALPHA` `0.15` → `0.10`/`0.20`; **MINOR**). Only D shipped. Revisit A only to weight rate over count; B is negligible.

**CORRECTION (2026-07-03):** the earlier "CAR **Gate-0** licensing" blocker was an unverified assumption with no basis in the repo or any CAR/ShowingTime terms — **dropped**. Aggregate realtor-association market stats + attribution are standard/fine; only individual MLS *listing* records are restricted (not used). (§1 GLOBAL RULE #1 + the CAR ingest bullet are already corrected.)

**NEXT PHASES (recommended order):**
1. **Brief generation / scaling** — the big lever (12 briefs curated, **173 candidates** queued, `list-brief-candidates.py`). (P1) automated adversarial **citation-verifier** — `scripts/verify-brief-citations.mjs` / a `test:brief-citations` gate that fetches every `_verified` source and confirms the verbatim quote is present (codifies the manual 26/26 QA) — **plus** a parameterized "curate brief for `<geoid>`" task [**the linchpin**]; (P2) in-site missing-brief "request" → `~/coho-backend` Worker → `workflow_dispatch` the curator; (P3) batch backlog burn-down. Human/Claude QA gate stays MANDATORY (fabrication risk — Carbondale precedent). Draft skeletons: `draft-jurisdiction-brief.py --geoid X`.
2. **Maintenance / hygiene (low-priority, anytime):** `source-url-sweep` false-positive fix (415/403/429/single-failure → "protected" not "broken"; handed, never landed); url-health heal/allow-list (§3 — mostly false-positives, verify by fetching before healing); #903 lodash.
3. **Deferred / owner-gated (surface-only — owner decides):** PII-history purge (deferred to production); CHAS/LODES vintage refreshes (HUD WAF blocks unauthenticated CHAS; LODES 2024 auto-refreshes via `rebuild-place-od-flows.yml` cron).

---

## 2026-06-29 — MASTER FORWARD PLAN (methodology merged; C-0 home-value regression — daily-refresh recurrence CONFIRMED)

**STATUS:** the ranking-methodology arc is DONE + live on main (QAP-aligned ranking + income-to-buy cascade; `test:ranking-fresh` green; 44 freshness alerts closed; #996/#997/#998 closed, superseded by #1002). **The ZHVI home-value cascade is ORPHANED — Fruita HNA shows the ACS floor $398,200 not ZHVI $486,295; income-to-own under-predicted site-wide; 17 places show income-to-rent > income-to-own. See C-0 below — top priority, absorbs the old Task C.** Build ON the live signal layer — do not re-rank or recompute except via C-0 + the TUNING PRs below. **✅ UPDATE 2026-06-30: #1008 (`c2ae091c`) RESOLVED C-0 — Claude QA PASS, `test:ci` GREEN, recurrence fixed (`build_hna_data.py` now self-stamps). See the Post-#1008 section for two small residual cleanups + open-PR housekeeping.** **✅ 2026-06-30 (later): C-0 cleanup DONE (#1009 merged); full `test:ci` GREEN on main (Claude QA). ▶ ACTIVE PHASE — Briefs B1 ∥ Tuning candidate reports, BOTH in parallel as separate draft PRs (see §"Holistic briefs" + §"Ranking tuning").**

**WHAT CLAUDE ALREADY DID ON MAIN (since the last handoff — Codex BUILD ON / RECONCILE, do not duplicate):**
- **`8a234694` (2026-06-29, DATA — temporary hotfix):** re-stamped `acsProfile.median_home_value` into all 482 summaries from committed `home-value-cascade.json` + rebuilt `ranking-index.json`. Restored Fruita to ZHVI **$486,295**; income-to-rent>own inversions **17 → 10** (7 ZHVI-coverable resolved; 10 residual = no-ZHVI towns → C-0 criterion 3). Full `test:ci` green at push. ⚠️ **The daily refresh pipeline ran 2026-06-29, rebuilt summaries STAMPLESS — this is what re-broke Fruita and WILL wipe the hotfix again on its next run.** Treat `home-value-cascade.json` as the source of truth; do NOT assume summaries carry the stamp.
- **`16d917bb` + `4fe30494` + `512e5d59` + (this) (DOCS):** this plan. Claude authors/owns this doc only; ALL data/code changes are Codex's.

### Post-#1008 — immediate cleanup + PR housekeeping (2026-06-30; do as ONE pass, SEPARATE PRs)
**C-0 shipped via #1008** (`c2ae091c`) — Claude QA PASS: `build_hna_data.py` self-stamps through `stamp_home_value_cascade.mjs` (CI-safe, idempotent; county-adjust + suppress for residual towns), renderers route through `homeValueInfo()`, all 482 stamped, `test:ci` GREEN, recurrence fixed (`.github/workflows/build-hna-data.yml:61` runs `build_hna_data.py`). Two residual cleanups + the three open PRs:

**Cleanup — ✅ DONE via #1009** (`4bc03105`, merged 2026-06-30; rebased onto current main after a stale-base first attempt; Claude QA PASS — independent `test:ci` green, mergeState CLEAN):
- **C-0a ✅** — `scripts/audit/build-data-manifest.mjs` now excludes the non-deployed `data/zillow/*.csv`; the phantom 92.9 MB data-explorer entry is gone. (QA confirmed ALL `data/zillow/*.csv` 404 on the live site — untracked city CSV + 3 tracked metro CSVs — so excluding the whole pattern was correct; tracked-status special-casing was deliberately NOT used.)
- **C-0b ✅** — the unused `medianHomeVal` raw-DP04 line in `js/hna/hna-renderers.js` removed.

**Open PRs — ✅ HANDLED 2026-06-30; just merge the 3 fresh ones when CI's green (owner clicks):**
- **#1007 → #1012** — `@dependabot rebase` recreated it as **#1012** (#1007 auto-closed). Merge #1012 when CI's green.
- **#1005 → #1010** — closed; `docs-sync` re-run opened fresh **#1010** (docs inventory + banners from current main).
- **#1001 → #1011** — closed; `source-liveness-weekly` re-run opened fresh **#1011** (source-health snapshot).
- ⚠️ Bot-authored PRs (#1010/#1011) may show CI as `action_required` — click **Approve and run** on each PR, then merge.

### 2026-07-01 — active-phase deliverables + sweep decision (Claude QA)
The B1 + tuning phase came back as 3 draft PRs:
- **#1013 tuning candidate report — ✅ QA PASS, READY TO MERGE.** Read-only (no constants/ranking-index touched); before/after rank tables for gap-blend 0.4/0.6 & 0.35/0.65 and commuter-α 0.10/0.20; augment-only invariant holds; Denver stays high, Baca/Sedgwick move modestly. Owner reads it to pick A/B values for the A+B+D re-rank.
- **#1014 B1 metric digest — ✅ QA PASS, READY TO MERGE.** 548 digests + generator + coverage report (28,444 tags · 1,961 county-context · 8,752 rate-with-denominator); `ranking-index.json` byte-identical; ci-checks green.
- **#1015 url-health — BLOCKED but the CODE IS CLEAN.** It removed 14 dead links + added the WAF allow-list and introduced **0 new dead links**. It fails only because the blocking source-URL sweep scans WHOLE changed files, so **32 PRE-EXISTING dead URLs in the jurisdiction-brief files it touched** block it.
- (All 3 also show `site-audit` red — that's the unrelated July-market issue below, not a required gate.)

**DECISION + NEW TASKS:**
- **Sweep-scoping fix (unblocks #1015 + ALL future brief work — B2 would hit the same wall):** add a diff-scoped mode to `scripts/audit/source-url-sweep.mjs` — sweep only URLs on ADDED/CHANGED (`+`) lines vs the base ref, skip pre-existing; update the ci-checks blocking step to use it (workflow-file edit → **FLAG for owner approval**, don't merge). Leave the WEEKLY non-blocking sweep scanning everything. Verify: #1015 passes; a branch that ADDS a known-dead URL still fails. Then #1015 merges (keep its 14 heals + allow-list).
- **site-audit fix (month rollover):** `site-audit` is red site-wide because the site requests `data/car-market-report-2026-07.json` (only Feb–June exist; July CO-Realtors data not published yet). Make the market section FALL BACK to the newest available `car-market-report-YYYY-MM.json` instead of hard-requiring the current calendar month (else it breaks every month-1st). Own PR.
- The url-health "heal dead links" work (§3) is now understood as pre-existing brief-citation rot → heal incrementally via the weekly non-blocking sweep; once the sweep is scoped it no longer blocks unrelated PRs.

### 2026-07-01 — OPEN PR QA + MODIFICATIONS NEEDED (Claude)
**Merge order: #1017 → rebase+merge #1013 & #1014 → sweep-scoping PR → rebase+merge #1015 → #1016.**
- **#1017** (site-audit CAR-probe tolerance) — ✅ **GREEN, NO MODS. MERGE FIRST** (mark ready). `ci-checks` + `site-audit` + contrast all pass; scope = `scripts/audit/site-audit.mjs` only. Merging it greens `site-audit` on main and unblocks the rest.
- **#1013** (tuning candidate report) — ✅ clean; **MOD: none in-PR.** `ci-checks` green; only `site-audit` red = the July car-market issue that #1017 fixes. After #1017 lands, rebase on main → green → merge. (Read it to pick the A/B tuning values.)
- **#1014** (B1 metric digest) — ✅ clean; **MOD: none in-PR.** `ci-checks` green; `ranking-index.json` byte-identical (verified); `site-audit` = same #1017 issue. Rebase after #1017 → merge.
- **#1015** (url-health cleanup) — ⛔ **MOD REQUIRED (external, not in-PR):** `ci-checks` fails on **32 PRE-EXISTING** dead URLs in the touched brief files (it introduced **0**, removed 14). Do NOT heal-all here. Land the **sweep-scoping fix** (scope the blocking `source-url-sweep` to NEW/changed URLs only — see §2026-07-01 sweep decision; PR not yet opened), then rebase #1015 → green → merge.
- **#1016** (brief backlog snapshot: `data/jurisdiction-briefs/_candidates.json` + `_stale.json`) — auto-generated (github-actions), low-stakes, no sensitive scope. **MOD: approve-and-run its bot CI**; merge when green, or close and let next month's run supersede.

### 2026-07-01 — COMPLETE-THE-PHASE: overcrowding (candidate D) → A+B+D re-rank
Merging the 5 open PRs does NOT complete the tuning phase. #1013 evaluates only A + B — candidate D
(overcrowding) is unshippable as-is: `overcrowding_rate` is real for **0 / 547** entries
(`build_ranking_index.py:1119` hardcodes it to `None`; the ACS vars are absent). **⚠️ DEEP-DIVE-CORRECTED
2026-07-02 (Census-verified):** overcrowding (>1.0/room) = `DP04_0078E` (1.01–1.50) + `DP04_0079E` (1.51+),
denominator `DP04_0076E` (occupied units); **`DP04_0080+` is home VALUE — do NOT use it.** Overcrowding is
**NOT in `COMMUNITY_NEED_WEIGHTS`** (only 4 factors: gap 0.35 / burden 0.25 / afford 0.15 / future 0.15) — so
D **ADDS a new factor** (owner picks the weight), it does not "re-wire" one. `_weighted_average` re-normalizes
around present factors, so adding it rebalances the others automatically + skips no-data entries. Also
`js/components/housing-type-need.js:171-172` has a bug (uses `0079PE + 0080PE`, off by one). Chain:
- **D-1 [Codex, ungated]** Add `DP04_0076E`, `DP04_0078E`, `DP04_0079E` (+ percent versions `DP04_0078PE`,
  `DP04_0079PE` for the display) to the var list in `scripts/backfill_hna_extended_acs_cache.mjs`, matching
  the existing BATCHES format. Do NOT add `DP04_0080` (home-value denominator, already fetched). Own DRAFT PR.
- **D-2 [owner/CI]** Dispatch `backfill-hna-extended-acs-cache.yml` (`workflow_dispatch`; `CENSUS_API_KEY`;
  run `--dry` first) → commits the vars into `data/hna/summary/*.json`. (Owner-gated dispatch; do NOT edit the workflow.)
- **D-3 [Codex, after D-2] (RE-RANKS):** (a) `overcrowding_rate` in `build_ranking_index.py` (replace L1119
  `None`) = `100 * (DP04_0078E + DP04_0079E) / DP04_0076E`; `None` when `DP04_0076E` missing/0 or below a
  min-denominator floor (mirror `_MIN_RATE_DENOMINATOR=50`). (b) `overcrowding_score` = type-scoped percentile
  rank of `overcrowding_rate` (same pattern as `cost_burden_pressure`). (c) ADD `"overcrowding_score": <W>` to
  `COMMUNITY_NEED_WEIGHTS` (default W=0.10; owner finalizes D-5) + add `(overcrowding_score, …)` to the
  `community_need_core` `_weighted_average` call (~L1441) — rely on its re-normalization, do NOT manually rescale.
  (d) FIX `housing-type-need.js:171-172` → `DP04_0078PE` (1.01–1.50) + `DP04_0079PE` (1.51+). Regenerate;
  confirm coverage rises + `hasIncompleteData` drops. Face-validity report + §Ranking-tuning VERIFY gates.
- **D-4 [Codex]** Add candidate D to the tuning report: overcrowding weight at 0 (current) / 0.05 / 0.10 /
  0.15, others at current; show >50-rank movers + Baca/Sedgwick/Denver.
- **D-5 [owner]** Pick the overcrowding weight W (and finalize A + B).
- **D-6 [Codex]** ONE combined **A+B+D re-rank PR** (per §Ranking-tuning RE-RANK/VERIFY). **The tuning payoff —
  the phase is NOT complete until it merges.**

Also note: **B1 (#1014) is a non-scoring data spine with NO consumer yet** — the briefs' user-facing
value lands at **B2** (next phase). Merging B1 + the tuning report alone ships no visible improvement;
the D-6 re-rank and B2 are what make this phase actually land.

**GLOBAL RULES (every task) — #1 is non-negotiable:**
**#1 — ALWAYS ATTRIBUTE SOURCES.** Every externally-sourced data point / statistic / citation must render with **visible source attribution** (organization name + link) wherever it appears. (Correction 2026-07-03: aggregate market statistics published by realtor associations like **CAR** are public factual data — **attribution is sufficient; there is NO republication-permission gate** for citing them. The earlier "Gate 0 / MLS-licensed" framing had no basis in the repo or in any CAR/ShowingTime terms. Only individual MLS *listing* records for specific properties are genuinely restricted — and those are not used here.)
**#2 —** OWNER-GATED — DRAFT PRs, do NOT merge/deploy. No repo-visibility / git-history / workflow / PII changes. Do NOT touch `js/qap-simulator.js`. Regenerate generated data — never hand-merge JSON. One coherent change per PR. VERIFY: `npm run test:ci` green · `git diff -- js/qap-simulator.js` empty · no unintended generated-data churn · ranking-index unchanged for non-ranking PRs. Open DRAFT for owner review + Claude QA.

**RECOMMENDED ORDER:** Task 0 → C-0 → (Briefs B1 ∥ Tuning candidate reports) → owner decides tuning → A+B+D re-rank → Briefs B2 → B3 → (B4). Maintenance anytime.

### 0. Immediate maintenance
- **#1001** (`chore/source-liveness-weekly`): rebase on fresh main (inherits #1003's sweep allow-list) → green, or close + let the weekly cron supersede. Only the two source-health snapshots.

### 1. C-0 — Home-value cascade regression — ✅ RESOLVED by #1008 (2026-06-30; kept below as the spec/record + residuals tracked in the Post-#1008 section)
**Symptom:** HNA "Median home value" + income-needed-to-buy fall back to raw ACS DP04 (Fruita **$398,200** not ZHVI **$486,295**); income-to-own under-predicted; site-wide **17/365 places show income-to-RENT > income-to-OWN** (all `acs_raw`; median price-to-rent 8.4 vs 23.2) — e.g. Federal Heights ACS $95,300 vs ZHVI $393,538.
**Root cause (CONFIRMED live 2026-06-29):** the ZHVI cascade is built but its stamp lives only in the summaries, and the **daily data-refresh pipeline (`build_hna_data.py`) rebuilds summaries from ACS WITHOUT re-stamping** — the stamp-writer `build_home_value_cascade.mjs` (L175-177) needs the gitignored city ZHVI CSV (`data/zillow/city_zhvi_…_month.csv`, absent in CI). Both consumers — `js/hna/hna-renderers.js:357` and `scripts/hna/build_ranking_index.py:1012-1019` — then fall back to `DP04_0089E`. Values survive in committed `data/hna/home-value-cascade.json` (482 places; Fruita `{value:486295, acs_raw_value:398200, confidence:high}`).
**Acceptance criteria (priority order):**
1. **DECOUPLE BOTH CONSUMERS FROM THE SUMMARY STAMP — THE fix (without it, re-breaks every daily run):** the regression hits TWO places — the ranking (`build_ranking_index.py:1012`) AND the HNA **display** (`js/hna/hna-renderers.js:357`, the code that actually shows Fruita $398,200). **Fixing only the ranking leaves the page broken.** PREFERRED (no workflow edit): make **both** read `home-value-cascade.json` DIRECTLY — `build_ranking_index.py` keyed by geoid, and have the HNA page load the cascade JSON so `hna-renderers.js` uses it instead of `acsProfile.median_home_value` (DP04_0089E labeled `acs_raw` fallback; `missing` when neither). ALTERNATIVE: re-stamp as the LAST step of the data-refresh pipeline (consumers keep reading the stamp, no consumer code change) — but the workflow-file edit is owner-gated, so **FLAG** the `.github/workflows/*` change in the PR body, do NOT edit it. Either way, a summary rebuild must never silently revert the display OR the ranking.
2. **Idempotent re-stamp script** reading the COMMITTED `home-value-cascade.json` (no CSV) → writes `acsProfile.median_home_value = {value,source,as_of,confidence}` into every summary. (Claude's hotfix used this logic ad-hoc; promote it to a committed script.)
3. **County fallback** for the ~10 no-ZHVI towns (Aetna Estates/Starkville/Crowley/Ordway-tier): **default — inherit county ZHVI-to-ACS ratio** (label `county_zhvi_adjusted`); alternative — suppress income-to-own when `acs_raw` AND price-to-rent < 10. Owner confirms; document.
4. **Minor:** `hna-renderers.js:396` caption hardcodes "ACS DP04_0089E" → cascade label (calc already uses `homeVal`).
5. **Secondary (owner decision):** income-to-own finances 100% of value (no down payment); propose 5/20% down.
**RE-RANK + VERIFY:** `python3 scripts/hna/build_ranking_index.py` → sync `chfa-watchlist.json` need_rank (9; **== overall `rank`**, mechanical) + refresh `data/_manifest.json` → ONE face-validity report vs origin/main (top-20 before/after places+counties, all >50-rank movers, Baca/Sedgwick + Denver, inversion count → ≤10) → `test:ranking-fresh` + `test_hna_ranking_integrity` + `test:hna-home-values` + `test:ci` green; Fruita HNA shows $486,295 + "Zillow ZHVI city index".
**Implementation notes (Claude verified during the hotfix):** `build_ranking_index.py` is deterministic except `generatedAt`; commit the freshly-built `ranking-index.json` TOGETHER with the stamped summaries and do NOT run `check-ranking-index-fresh.py` before committing (its cleanup `git checkout` reverts an uncommitted index). `data/_manifest.json` size_bytes is NOT in `test:ci` (audit-only). `test:hna-home-values` passes via a cascade fallback so it did NOT catch the display regression — consider asserting the summary stamp directly. `validate:data` rewrites `data/fred-data.json` as a side effect (revert before committing).

### 2. Holistic briefs (end goal — Codex designs + builds; Claude QAs each phase)
Goal: each jurisdiction brief = a holistic, SOURCED view of every site metric useful for AH analysis there. Consume the LIVE layer (single source of truth; don't recompute/re-rank).
- **B1 — metric digest (data spine, NON-scoring):** `data/hna/jurisdiction-metrics-digest/<geoid>.json` assembling every AH-relevant metric (need/supply/market/demand-drivers/demographics/opportunity), each tagged `{value, geography_level: place|county_context, confidence, source_id, as_of}`. HARD: county data labeled `county_context`; single-vintage = level not trend; min-denominator floor on rates; assert ranking-index unchanged. Tests + coverage report. *(Safe anytime — reads the ranking dynamically, so a later re-rank just refreshes the digest data, not the code; can run in PARALLEL with the §4 tuning candidate reports.)*
- **B2 — brief "metric digest" section (consumes B1):** source-cited; respects the publish gate (`scripts/validate-jurisdiction-briefs.py`); add a DATA-CITATION source kind that auto-verifies `value == dataset[geoid][field]`; no 'search'-kind sources in published briefs. *(Do AFTER C-0 + tuning land, so briefs surface the FINAL grounded ranking.)*
- **B3 — economic / service-worker layer:** extend `scripts/hna/economic_housing_bridge.py` to place level; service-worker-demand = high home value × service-sector job share (LEHD CNS18/CNS07/healthcare) × in-commute × wage gap; county trends (`data/co-housing-costs/county-trends.json`) apportioned + labeled `county_context`.
- **B4 — business-expansion news-watch (optional/last):** source-disciplined scan of local-gov/press; must pass the brief source gate (primary/press, verified) or it doesn't ship.

### 3. Maintenance (low priority)
- #903 lodash-es: bump the Lighthouse dep if a clean upgrade exists. url-health-weekly: heal genuinely-broken URLs to durable jurisdiction SEARCHES (F35 pattern); close superseded weeklies (keep newest).
- **url-health cleanup (concrete — unblocks the weekly docs/snapshot auto-PRs).** Surfaced 2026-06-30: the regenerated #1010/#1011 both failed the blocking `source-url-sweep` (pre-existing link-rot in changed files); both were closed. Two kinds of fix:
  - **HEAL** (genuinely dead 404/501 → durable jurisdiction searches, F35): `apcha.org/DocumentCenter/View/{2013,1488}`, `aspen.gov/DocumentCenter/View/15465`, `pitkincounty.com/DocumentCenter/View/{33238,30524,28580}`, `cortezco.gov/DocumentCenter/View/4133`, `cogs.us/DocumentCenter/View/9241`, `townofsilt.org/comprehensive_plan` (501), `chaffeehousingauthority.org/realestateprojects/janesplace`, the `businessden.com/2026/03/09/...` article; + 2 JSDoc-comment URLs `bouldercolorado.gov/planning/...` and `developers.regrid.com/reference/parcels-endpoint`. Find each in the citation data / source-registry / source comments and replace with a durable search.
  - **ALLOW-LIST** (live but WAF/bot-blocked 403/429 — add to `scripts/audit/source-url-sweep.mjs` + `scripts/audit/url-health-sweep.mjs`, same pattern as #1008): `data.census.gov`, `aspendailynews.com`, `kdvr.com`, `fcgov.com/socialsustainability/{landbank,developmentincentives}`, `colorado.gov/governor/news/...`, `homesfund.org/mortgage-assistance`, `themountainmail.com`.
  - Then the weekly `docs-sync` + `source-liveness-weekly` auto-PRs pass cleanly. OWNER-GATED draft PR; `test:ci` green.

### 4. Ranking tuning (OWNER-GATED; each RE-RANKS — owner picks values, Codex implements + reports)
First Codex generates **candidate-effect reports** (each param vs current, others at default) so the owner decides from real numbers. Then **batch A+B+D into ONE combined re-rank PR**. *(Home-value metric is now handled by C-0, not a separate tuning PR.)*
COMMON RE-RANK PROCEDURE: change the named constant/source → `python3 scripts/hna/build_ranking_index.py` → sync `chfa-watchlist.json` need_rank (9) + refresh `_manifest.json` + ONE face-validity report vs origin/main (top-20 before/after places+counties, all >50-rank movers, explicit Baca/Sedgwick + Denver lines) → `test:ranking-fresh` + `pytest tests/test_hna_ranking_integrity.py` + `test:ci` green.
- **A — Rural gap-normalization:** `GAP_COUNT_WEIGHT`/`GAP_RATE_WEIGHT` (build_ranking_index.py L84–85, both 0.5). Shift toward rate; candidates 0.5/0.5, 0.4/0.6, 0.35/0.65 (sum=1.0). Show rural (Baca/Sedgwick/Kiowa/Phillips) rise + metros don't collapse; confirm `_MIN_RATE_DENOMINATOR=50` keeps sub-1,000-pop CDPs out of the top.
- **B — Commuter α:** `COMMUTER_AUGMENT_ALPHA` (L82, 0.15). Candidates 0.10/0.15/0.20; show movement; augment-only invariant must hold.
- **D — Overcrowding backfill → ⚠️ SUPERSEDED by the D-1…D-6 chain in §"COMPLETE-THE-PHASE" above.** (The real mechanism is NOT `build_hna_data.py`'s fetch list — it's adding `DP04_0078E/0079E` to `scripts/backfill_hna_extended_acs_cache.mjs`, dispatching the backfill workflow, AND wiring `overcrowding_rate` in `build_ranking_index.py` which currently hardcodes it to `None` at L1119. Follow D-1…D-6, not this line.)

### 5. Other owner-gated — surface only, do NOT act
- WORKFLOW fixes (off-limits without owner sign-off): auto-regen ranking-index in the data-refresh cron (stops staleness recurring + would prevent C-0 recurrence); dedup/auto-close the data-freshness-check alerts.
- PII history purge (→ production); CHAS/LODES refreshes (sources blocked); signal-layer keep/retire; SEO: submit cohoanalytics.com/sitemap.xml to Search Console (tag wired).
- **CAR real-data ingest (buildable — NO licensing gate).** Real CAR market data is public + machine-readable via ShowingTime `sst` HTML (`marketstatsreports.showingtime.com/CAR-Colorado_hqac0/sst/<YYYYMM>/{0SF,0TC}.htm`). **Structure CONFIRMED 2026-07-03 (WebFetch reached the host):** two sections — 8 congressional districts + all **64 counties** (alphabetical, Adams→Yuma); per-row fields = **Closed Sales, New Listings, Median Sales Price, Homes-for-Sale**, each with a 1-year-change %; ~1-month lag (May data live early June). **The earlier "Gate 0 / licensing" blocker was an unverified assumption — dropped.** Citing aggregate realtor-association market stats WITH attribution is standard/fine; only individual MLS *listing* records are restricted (not used). The real constraints are PRACTICAL, not legal: (1) the host is WAF/bot-protected → a naive CI fetch is unreliable; use a **browser-UA + retries**, make the fetch **best-effort with graceful fallback to last-good** (never a hard CI gate); (2) only **4 fields per county** (DOM / $/sqft / months-supply / list-to-sale are NOT in the county report → null for counties); (3) counties are listed by NAME → need a **name→FIPS (08001–08125) map** to join the rest of the site. Attribute "CAR (via ShowingTime, sourced from Colorado MLS)". Interim placeholders (`generate-car-placeholder.mjs`, labeled "estimated") remain the fallback.

---

## 2026-06-27 — NEXT WORK ORDER for Codex: HNA Commuter Score Re-rank (OWNER-GATED)

**Why.** `overall_need_score`'s 20% commuter term uses the **raw `in_commuters` count**, percentile-ranked across ALL entries (counties + places + CDPs in one pool). Two problems: (a) big geographies dominate — Denver's 381k in-commuters maxes the axis while a small bedroom town's high commute-dependency barely registers; (b) raw count is partly **redundant** with the 50% `housing_gap_units` term (both favor size). The size-normalized `commute_ratio` IS computed (`build_ranking_index.py` ~L600/L697) but **unused**. Net: rural workforce-housing pressure is **under-weighted**.

> ⚠️ **This RE-RANKS every entry. Do NOT auto-merge.** Open a **draft PR** with a before/after face-validity report; the owner signs off before merge.

### Scope
1. **Per-geo-type percentile pools.** `compute_percentile_ranks` (`scripts/hna/build_ranking_index.py:719`) currently ranks each metric across the whole mixed pool. Add an option to rank **within geo type** (`county` / `place` / `cdp` — type is known at entry construction, ~L774). Apply to all three score components so a place is ranked against places, not against counties. *(This alone is a clear, low-risk correctness fix.)*
2. **Blend count + ratio for the commuter term.** Replace the raw-count term, e.g. `0.20 * (0.5·pctile(in_commuters) + 0.5·pctile(commute_ratio))`. **Keep some count weight** so a tiny CDP with a high ratio but trivial absolute in-commuters doesn't rocket up. Tune the split during validation.
3. **Regenerate + guard.** Regenerate `data/hna/ranking-index.json`; update `check-ranking-index-fresh.py` pinned spec values if they change; keep `test:ranking-fresh` green. Regenerate any downstream artifact that embeds rank/score.
4. **Face-validity report (in the PR).** Top-20 before/after for places and for counties; confirm rural commute-hubs (e.g. Silt) rise sensibly and metros (Denver) don't collapse; list every entry moving more than ~50 ranks.

### Guardrails
- **Draft PR only; owner approves the re-rank.** No auto-merge.
- Keep the headline **50/30/20** weights unless the face-validity review argues otherwise — the change is *inside* the commuter term + the pooling, not the top-level weights.
- Don't touch Phase 1 PII / repo visibility / git history.

### Verify
`npm run test:ci` (incl. `test:ranking-fresh`) green · `python3 scripts/hna/build_ranking_index.py` reproduces the committed index · face-validity report attached to the PR.

---

## 2026-06-27 — Codex Phases 2-4 PR Pass — ✅ MERGED (#995) + Phase 3 cache backfilled on main

### Shipped in branch `codex/seo-reliability-cleanup`
- **SEO sitemap:** `npm run build:public` now emits a deterministic generated `dist/sitemap.xml` from built HTML. The checked-in root `sitemap.xml` was refreshed from 21 to **536** URLs, including **482** `places/<geoid>.html` profile URLs plus public tool/content pages. `_template.html`, `404.html`, private developer pages, and meta-refresh redirect stubs stay excluded. `<lastmod>` now comes from git history/file metadata, not a wall-clock build timestamp.
- **JSON-LD:** `index.html` now has one `Organization` + `WebSite` JSON-LD block. `scripts/hna/build_place_pages.py` now emits one `Place` + `Dataset` JSON-LD block per generated place page; regenerated the **482** GEOID pages plus `places/index.html`.
- **Deploy gate:** `test/pages-availability-check.js` now asserts the expanded sitemap shape so deploy.yml will no longer silently accept the old 21-URL sitemap.
- **Nodemailer v9:** added `test/nodemailer-v9-smoke.test.js`, wired into `test:ci`, using Nodemailer's `jsonTransport` so the v9 `createTransport`/`sendMail` path is exercised without SMTP credentials.
- **ACS backfill failure mode:** `scripts/backfill_hna_extended_acs_cache.mjs` now fails fast when `CENSUS_API_KEY` is missing, because the Census profile API currently returns a 200 HTML "Missing Key" response even for small profile data requests.

### Deferred / blocked
- **Extended ACS place-summary cache population remains blocked in this local shell** because no `CENSUS_API_KEY` is present. Local probe against the Census profile API returned the "Missing Key" HTML page for `DP02_0002E`, `DP03_0061E`, and related batches. The repo already has `.github/workflows/backfill-hna-extended-acs-cache.yml` wired to the `CENSUS_API_KEY` repository secret; run that workflow on this branch/main to populate the remaining **482** place summaries. Current spot check remains `grep -c DP02_0002E data/hna/summary/0870195.json` = **0** until the secret-backed workflow runs.
- **CHAS + LODES vintage refreshes** remain deferred per owner direction. **Signal-layer keep/retire** remains an owner decision.

### Verification run so far
- `npm run test:ci` ✅ (includes `test:ranking-fresh`; **0 ranks moved**)
- `node test/pages-availability-check.js` ✅
- `node test/nodemailer-v9-smoke.test.js` ✅
- `node test/public-build-metadata.test.mjs` ✅ (**536** sitemap URLs, **482** place URLs)
- `npm run test:ranking-fresh` ✅ (**0 ranks moved**; ranking index fresh)
- `npm run build:public` ✅
- `npm run audit:public-artifact` ✅ (1,866 files checked)

---

## 2026-06-26 — NEXT WORK ORDER for Codex (Phases 2–4)

**Repo:** `pggLLC/Housing-Analytics` (public static site → cohoanalytics.com via GitHub Pages; **Free org / testing site**).

### Guardrails (read first)
- **Phase 1 (contact-PII) is owner-managed — do NOT touch.** The developer-pipeline CSVs were already `git rm`'d from public HEAD (commit `14443d89`), relocated to `~/coho-backend/docs/developer-pipeline-prototype/`, and `build-bundle.sh` (~line 32) was rewired to read its own copy. The 80 contacts remain only in *git history*; closing that (history purge) is **deferred to production** by owner decision (Free testing site — no paid/private). **DO NOT change repo visibility, DO NOT rewrite git history, DO NOT force-push.**
- **Never commit anything under `docs/developer-pipeline-prototype/`** (PII; lives in `~/coho-backend` now).
- **Display/SEO changes MUST NOT move HNA ranks** — keep `npm run test:ranking-fresh` green.
- **No new wall-clock timestamps** in generated output (keep no-op regen diffs clean).

### Phase 2 — SEO / discoverability  *(Priority #1)*
**Problem (verified 2026-06-26):** `sitemap.xml` ships only **21** `<loc>` URLs and omits all **483** `places/*.html`; `index.html` has **0** JSON-LD blocks. Nothing finds the site.
**Do:**
1. Auto-generate `dist/sitemap.xml` during `npm run build:public` from the built HTML — all 483 `places/*.html` + tool pages (`index`, `housing-needs-assessment`, `search`, …); **exclude** `_template.html`, redirect stubs, `404.html`; real `<lastmod>` from data vintage or git mtime (**not** wall-clock); absolute `https://cohoanalytics.com/` URLs.
2. JSON-LD: add `Organization` + `WebSite` to `index.html`; add `Place` (+ `Dataset` where the place has data) to each `places/*.html` via `scripts/hna/build_place_pages.py`.
- ⚠️ **Deploy-gate trap:** `test/pages-availability-check.js` runs *inside* `deploy.yml` and asserts the current 21-URL sitemap. De-pin/update that assertion, then run `node test/pages-availability-check.js` before merge or `deploy.yml` goes red.

### Phase 3 — Reliability  *(Priority #2)*
**Problem (verified 2026-06-26):** extended ACS vars `DP02_0002E` (household composition), `DP03_0061E` (occupation), `DP05_0037E` (race) are **absent** from `data/hna/summary/*.json` — the composition/occupation/race/education panels depend on a **live per-page-load** `fetchAcsExtended` call that can silently fail.
**Do:** precompute the `fetchAcsExtended` var list into the ETL/summary cache (model after `scripts/backfill_dp04_value_brackets.mjs`). `test:hna-acs-coverage` already guards the wiring. Verify a place page renders those panels from cache with the network blocked.

### Phase 4 — Cleanup leftovers
- **nodemailer v9 smoke-test** — dep bumped to `^9.0.1`; the v9 API is not yet exercised in `test/daily-audit-system.js`, `test/send-test-email.js`, `audit-modules/report-generator.js`.
- **CHAS + LODES** vintage refreshes — **stay deferred** (HUD WAF blocks unauthenticated CHAS; LODES 2024 picks up via `rebuild-place-od-flows.yml` cron). Don't attempt.
- **Signal-layer keep/retire** — owner decision; leave as-is.

### Verify before any merge that touches the public build
```bash
npm run test:ci
node test/pages-availability-check.js
npm run build:public
npm run audit:public-artifact
python3 scripts/check-place-pages-fresh.py
```

### When done
Update this file with what shipped + any deferrals, and report: sitemap URL count before/after, JSON-LD blocks added, ACS vars cached, and confirmation `test:ranking-fresh` stayed green (0 ranks moved).

---

## 2026-06-26 Composite Work-Order Pass — ✅ COMPLETED + VERIFIED (PASS)
> **Claude independent verification (2026-06-26):** home values correct (Fruita ZHVI **$486,295**; Aspen **$3,431,712** kept, not stale ACS), LIHTC `year_placed_in_service:null` / `award_year:2022`, projected-deficit panel present, `test:ci` **green**, **0/547 HNA ranks moved** (display-only confirmed). Shippable as-is.

### Completed in this pass
- **LIHTC year label:** `scripts/build-affordable-housing-properties.js` no longer treats CHFA/HUD `YR_PIS` as verified placed-in-service. Regenerated `data/affordable-housing/properties.json`; LIHTC records now carry `latest_year`/`award_year` as award metadata and `year_placed_in_service: null`. Developer brief and affordable-housing popup labels now say **Award year**.
- **Home value cascade:** added `scripts/hna/build_home_value_cascade.mjs`, downloaded the public Zillow city ZHVI CSV to `data/zillow/city_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv`, generated `data/hna/home-value-cascade.json` + `data/hna/zhvi-place-crosswalk.json`, and wrote `acsProfile.median_home_value = { value, source, as_of, confidence }` into all 482 place summaries. Fruita spot-check: ZHVI `$486,295` as of `2026-05-31` vs raw ACS `$398,200`; Aspen review flag fires at `4.19x`.
- **HNA labels/panel clarity:** AMI panel headers now both say “Households who need affordable rental units” and distinguish cumulative vs non-overlapping tiers. The secondary line explicitly remains net of existing ACS-priced affordable supply.
- **Existing vs projected affordable deficit:** added `#hnaProjectedDeficit` directly under the net-gap line. It shows today/+10yr/+20yr by AMI band and total, scaling today’s per-band deficit by DOLA household-growth factors while keeping existing supply constant. This is separately captioned from the vacancy-based total-units summary.
- **Vacancy summary clarity:** “Housing need summary” now labels the base cell as current requirement and the 20-year cell as **Net new units (20y)**. The note states it is total units to house projected households at target vacancy, not an income-targeted affordable deficit.
- **Partial-data caveat:** ranking rows with `hasIncompleteData=true` keep their rank and now show a visible **Partial data** caveat badge.
- **Determinism:** `scripts/hna/build_place_pages.py` no longer emits a wall-clock `Generated:` line; regenerated all 482 place pages with a stable data-vintage line.
- **Source-liveness nits:** `data/source-registry.json` is absent in this checkout. Added the recurring USDA RD and Polymarket event reference URLs to the active URL sweep allow-lists (`scripts/audit/source-url-sweep.mjs`, `scripts/audit/url-health-sweep.mjs`).
- **Backend L1:** `coho-backend/scripts/verify-bundle.mjs` now warns, non-fatally, when `.coho-build.json` `source_revision` is behind public `origin/main`.

### Notes / deviations
- Zillow city ZHVI matched **264/482** places using the strict GEOID crosswalk that stores Zillow `RegionID` and county. The work order estimated ~315; an audit found additional name-unique but county-mismatched/cross-county candidates, and this pass left those as ACS raw fallbacks rather than loosening the join.
- `acs_anchor` remains internal; no user-facing label was added in this pass.
- Ops Phase 4/5 items beyond the `verify-bundle` warning were not completed in this pass.

### New/updated checks
- Added `npm run test:hna-home-values` to `test:ci`; it guards Fruita ZHVI, Aspen `ZHVI/ACS > 3`, and 482-place cascade coverage.

_Updated 2026-06-20. **This is THE current handoff.** It (A) QA/QCs everything shipped since the prior two handoffs
and (B) evaluates the real implementation status of the planned next phases. The dated docs in this folder are
historical detail, superseded by this file. Internal doc — excluded from the public artifact via the `docs/qa` block._

> ✅ **2026-06-25 QA/QC — C1 + H1 resolved this session.** C1 was **not** a regression: commit `faef8f19` *corrected* a
> stale `ranking-index.json` (the gap source has said 157 since May-9; the spec value 60.5/205/153 was stale — **update it
> to 60.0/213/157**). H1 staleness guard added (`test:ranking-fresh`, wired into `test:ci`). **Remaining for Codex** (M2 SEO,
> M3 label cost-burden sources, L1 stale-bundle check, + the phase plan): **[`codex-qa-fixes-2026-06-25.md`](codex-qa-fixes-2026-06-25.md)**.

## TL;DR — state going in
- `main` clean, working tree clean, **0 open PRs**, **`test:ci` green end-to-end**.
- **12/12** jurisdiction briefs pass `npm run test:briefs`; the validator now gates **per-PR** (was cron-only).
- Backend `ERR_TOO_MANY_REDIRECTS` fixed + deployed — **owner: confirm a fresh login works**.
- Next phases: **1, 2, 3 = not started; 4 = partially done** (detail in Part B).
- Two pre-existing breakages were found and fixed this window: `test:ci` red since 06-17 (phantom CSS token), and iCloud `" 2"` duplicate cruft.

---

# Part A — QA/QC of everything since the last two handoffs (2026-06-19 → 06-20)

Boundary: after [`codex-qa-handoff-2026-06-18.md`](codex-qa-handoff-2026-06-18.md) and
[`codex-handoff-2026-06-19-next-phases.md`](codex-handoff-2026-06-19-next-phases.md). Full detail in
[`codex-qa-handoff-2026-06-20.md`](codex-qa-handoff-2026-06-20.md); condensed here.

### Commit inventory (substantive; cron commits omitted)
| Commit | What | Verdict |
|---|---|---|
| `6e9ced42` | Silt brief: `regional-modular-pipeline` + `silt-recent-planning` sections | ✅ source-verified |
| `0de30f49` | 11-brief repair (CHFA verified, Enterprise macro, 3 unreadable sources dropped, Towaoc fix) + `test:briefs` in `test:ci` | ✅ verified + gated |
| `82e93bb4` | Silt brief: `official-affordability-discussion` section | ✅ first-hand verified |
| `06bec5a5` | Silt cleanup: `curator`→`PG`; GCHA rows `partial`→`supported` | ✅ verbatim-confirmed |
| `890d404b` | Define phantom `--accent-weak` token (a #980 regression) | ✅ guard green |
| `~/coho-backend` | `html_handling="none"` — fix `ERR_TOO_MANY_REDIRECTS` | ⚠️ deployed; authed path needs owner confirm |

### Verdicts
- **Briefs (the bulk):** all 12 pass. Every published cited (section, paragraph, source) pair has a `_verified` row; every `supported` row has a verbatim quote. Silt (0870195) = 8 sections / 13 sources / 22 rows (**17 supported, 5 partial**). Load-bearing claims verified **first-hand** (CHFA list, Enterprise PDF, SB25-002, Post Independent ×3, the Feb-9 BOT minutes read page-by-page). **No fabricated content shipped.** Residual: the 5 `partial` rows are agent-extracted from large P&Z packets + the Riverview absence — honestly flagged, not errors.
- **11-brief repair:** CHFA 2026 R1 awards checked against the official list (14 developments; none in the 7 "not-awarded" jurisdictions). The 3 macro sources that hard-block automated fetch (Harvard JCHS ×2, KC Fed) were **removed, not faked**.
- **CI gate:** `scripts/validate-jurisdiction-briefs.py` now in `test:ci` via `npm run test:briefs` — closes the cron-only gap that let 11 invalid briefs sit on `main` ~3 days.
- **Backend redirect:** root cause was Cloudflare Assets default `auto-trailing-slash` 307-looping `/developer.html`↔`/developer`; `html_handling="none"` fixes it. Unauth verified (0 redirects); authed path not testable without the password.
- **Pre-existing, fixed:** phantom `--accent-weak` token (`search.html`, #980, **`test:ci` red since 06-17**) — defined, rendering unchanged. 34 gitignored iCloud `" 2"` duplicates cleaned (broke only the *local* `audit:public-artifact`; never in the handoff).

### Gates (run 2026-06-20, all green)
`test:ci` ✅ end-to-end · `test:briefs` ✅ 12/12 · `audit:public-artifact` ✅ 1863 files, no leaks · `test:phantom-css-vars` ✅ · briefs confirmed blocked from public dist.

---

# Part B — Next-phases implementation evaluation (checked against the code on 2026-06-20)

### Phase 1 — 🔒 Contact-PII exposure — **PREP DONE; purge DEFERRED to production** (highest stakes)
> **Update 2026-06-26:** the mechanical prep below is DONE — CSVs `git rm`'d from public HEAD (`14443d89`), relocated to `~/coho-backend/docs/developer-pipeline-prototype/`, `build-bundle.sh` (~L32) rewired to its own copy. The 80 contacts remain only in **git history** (readable at `14443d89^`, already public a while → treat as exposed). Owner **deferred the history purge to production** (Free testing site — no paid/private; going-private needs a paid plan). The "NOT STARTED / nothing has moved" text below was true at 2026-06-20 and is kept as history.
**Evidence:** all five CRM CSVs are still git-tracked in the **public** repo —
`docs/developer-pipeline-prototype/{01-signal-log,02-pipeline,03-anti-targets,04-network,05-outreach-templates}.csv`
(**`04-network.csv` = 80 contacts with name/email/phone**) plus the 4 `.md` files. `~/coho-backend/build-bundle.sh:23`
still sources the CSVs from `$REPO/docs/developer-pipeline-prototype/*.csv`. **Nothing has moved; the exposure is live.**
**Remaining:** OWNER decision (make repo private **vs** purge history). Codex can do the mechanical prep — move
`docs/developer-pipeline-prototype/` into `~/coho-backend`, rewire `build-bundle.sh:23` to the new location, `git rm`
from the public repo — but do **not** flip visibility or rewrite history autonomously. **Priority #1.**

### Phase 2 — 🔍 SEO / discoverability — **NOT STARTED**
**Evidence:** `sitemap.xml` (and `dist/sitemap.xml`) still ship **21 `<loc>` URLs** and omit all **483** `places/*.html`
profiles; `index.html` has **0** JSON-LD blocks. (`build-public-site.mjs` references "sitemap" but only passes through
the hand-maintained 21-URL file — it does not generate from the place pages.)
**Remaining:** auto-generate `dist/sitemap.xml` from built HTML (483 place profiles + tool pages; exclude
`_template.html`/redirect stubs/`404.html`; real `lastmod`; `https://cohoanalytics.com/` URLs); add `Organization`+
`WebSite` JSON-LD to `index.html` and `Place`/`Dataset` to place profiles. ⚠️ **Deploy-gate trap:**
`test/pages-availability-check.js` runs *inside* `deploy.yml` and asserts the sitemap — de-pin it, then run
`node test/pages-availability-check.js && npm run build:public && npm run audit:public-artifact` before merge.
**Priority #2** (biggest discoverability lever; "nothing finds the site").

### Phase 3 — ⚙️ Reliability / performance — **NOT STARTED**
**Evidence:** the extended ACS vars (`DP02_0002E`, `DP03_0061E`, `DP05_0037E`) are **absent** from the summary cache
(`data/hna/summary/0870195.json`) — the household-composition / occupation / race / education panels still depend on
the **live per-page-load** extended ACS fetch (the 06-19 fix), which can silently fail. The place generator
(`scripts/hna/build_place_pages.py`) still stamps a wall-clock `Generated:` line on every page (1 per page).
**Remaining:** precompute the `fetchAcsExtended` var list into the ETL/summary cache (model:
`scripts/backfill_dp04_value_brackets.mjs`; `test:hna-acs-coverage` already guards the wiring); drop the volatile
`Generated:` timestamp so a no-op regen produces a clean diff. **Priority #3.**

### Phase 4 — 🧹 Cleanup — **PARTIALLY DONE**
- ✅ **Silt brief** — `curator`→`PG`; GCHA rows `partial`→`supported` (verbatim); 3 new verified sections. **Done.**
- ✅ **Signal log** — rebuilt to **2** verified rows (`01-signal-log.csv`); retained.
- ⏳ **nodemailer** — bumped to **`^9.0.1`**; the `test/` email/audit scripts (`daily-audit-system.js`,
  `send-test-email.js`, `audit-modules/report-generator.js`) **still need a v9 API smoke-test**.
- ⏳ **CHAS + LODES** vintage refreshes — still deferred (HUD WAF blocks unauthenticated CHAS; LODES 2024 picks up via
  the `rebuild-place-od-flows.yml` cron).
- ⏳ **Signal layer keep/retire** — OWNER decision, still open (owner doesn't actively work leads → retiring is defensible).

---

## Recommended order for Codex
1. **Phase 1 prep** — but coordinate the owner's make-private-vs-purge decision *first*.
2. **Phase 2** — auto-sitemap + JSON-LD (watch the deploy-gate).
3. **Phase 3** — precompute extended ACS vars into the ETL; make the place generator deterministic.
4. **Phase 4 leftovers** — nodemailer v9 smoke-test; signal-layer keep/retire; CHAS/LODES when sources unblock.

## Owner actions (not Codex)
- **Confirm backend login** works after the redirect fix (clear cookies first).
- **Phase 1:** choose make-repo-private vs purge-history, then execute the visibility/history change.
- **Move the working copy off iCloud-synced `~/Documents`** to stop the `" 2"` duplicate churn.
- **Phase 4:** signal-layer keep/retire decision.
- **SEO:** submit `https://cohoanalytics.com/sitemap.xml` to Search Console + Bing once Phase 2 ships.

## Verification (run before any merge that touches the public build)
```bash
npm run test:ci                            # full gate (incl. the new test:briefs)
node test/pages-availability-check.js      # deploy gate (Phase 2 trap)
npm run build:public                       # dist/ + search-index + sitemap
npm run audit:public-artifact              # public-artifact guard (no private data leaks)
python3 scripts/check-place-pages-fresh.py # place pages match the data
```
