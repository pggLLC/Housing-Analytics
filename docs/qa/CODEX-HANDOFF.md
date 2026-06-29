# Codex Handoff — single source of truth

_Updated 2026-06-28 by Claude. **The HNA ranking-methodology arc is COMPLETE + MERGED on main** — #1000 (data refresh), #1003 (citation fix), #999 (income-to-buy cascade), #1002 (collapsed QAP-aligned methodology: Community Need 0.55 × Opportunity 0.45, commuter augment-only α=0.15). main is fresh; 44 freshness alerts closed; #996/#997/#998 closed (superseded by #1002). See MASTER FORWARD PLAN below for what's outstanding — **now led by C-0, an orphaned-ZHVI-cascade regression (Fruita HNA shows ACS $398,200, not ZHVI $486,295).** PII-history purge stays deferred to production._

---

## 2026-06-28 (rev) — MASTER FORWARD PLAN (methodology merged; C-0 home-value regression found)

**STATUS:** the ranking-methodology arc is DONE + live on main (QAP-aligned ranking + income-to-buy cascade; `test:ranking-fresh` green; 44 freshness alerts closed; #996/#997/#998 closed, superseded by #1002). **NEW (this session): the ZHVI home-value cascade is ORPHANED — Fruita HNA shows the ACS floor $398,200 not ZHVI $486,295; income-to-own under-predicted site-wide; 17 places show income-to-rent > income-to-own. See C-0 below — it is the new top priority and absorbs the old Task C.** Build ON the live signal layer — do not re-rank or recompute except via C-0 + the TUNING PRs below.

**GLOBAL RULES (every task):** OWNER-GATED — DRAFT PRs, do NOT merge/deploy. No repo-visibility / git-history / workflow / PII changes. Do NOT touch `js/qap-simulator.js`. Regenerate generated data — never hand-merge JSON. One coherent change per PR. VERIFY: `npm run test:ci` green · `git diff -- js/qap-simulator.js` empty · no unintended generated-data churn · ranking-index unchanged for non-ranking PRs. Open DRAFT for owner review + Claude QA.

**RECOMMENDED ORDER:** Task 0 → C-0 → (Briefs B1 ∥ Tuning candidate reports) → owner decides tuning → A+B+D re-rank → Briefs B2 → B3 → (B4). Maintenance anytime.

### 0. Immediate maintenance
- **#1001** (`chore/source-liveness-weekly`): rebase on fresh main (inherits #1003's sweep allow-list) → green, or close + let the weekly cron supersede. Only the two source-health snapshots.

### 1. C-0 — Home-value cascade regression (NEW — top priority; absorbs old Task C; re-ranks affordability)
**Symptom:** Fruita HNA "Median home value" shows **$398,200** (raw ACS floor) not **$486,295** (ZHVI); income-needed-to-buy follows it (understated); site-wide **17/365 places show income-to-RENT > income-to-OWN** (all `acs_raw`; median price-to-rent 8.4 vs 23.2) — e.g. Federal Heights ACS $95,300 vs ZHVI $393,538.
**Root cause:** the ZHVI cascade is built but ORPHANED. Both consumers — `js/hna/hna-renderers.js:357` and `scripts/hna/build_ranking_index.py:1012-1019` — read the cascade OBJECT stamped into `data/hna/summary/*.json` `acsProfile.median_home_value`; that stamp is `None` for ALL entries → ranking-index is **477 `acs_raw` + 70 missing, 0 ZHVI**. The stamp is only written by `build_home_value_cascade.mjs` (L175-177), which REQUIRES the gitignored city ZHVI CSV (`data/zillow/city_zhvi_…_month.csv`, not present locally) → every summary rebuild silently drops it → the recurrence. Values survive in committed `data/hna/home-value-cascade.json` (Fruita `{value:486295, acs_raw_value:398200, confidence:high}`).
**Fix (durable — read the COMMITTED cascade; do NOT depend on re-running the CSV builder):**
1. New idempotent re-stamp script reading committed `home-value-cascade.json` → writes `acsProfile.median_home_value = {value,source,as_of,confidence}` into every summary (no CSV needed).
2. Make `build_ranking_index.py` read `median_home_value` from `home-value-cascade.json` DIRECTLY (DP04_0089E labeled `acs_raw` fallback; `missing` when neither) — so it can't silently revert on a summary rebuild.
3. County fallback for the ~10 no-ZHVI towns (Aetna Estates/Starkville/Crowley/Ordway-tier): inherit county ZHVI-to-ACS ratio (label `county_zhvi_adjusted`) OR suppress income-to-own when `acs_raw` AND price-to-rent < 10. Pick one; document.
4. RE-RANK (procedure under §4) + report income-to-rent>own inversion count before/after (target 17 → ≤10).
5. PIPELINE GUARD: the data-refresh workflow must re-stamp AFTER any summary rebuild — FLAG the change, do NOT edit `.github/workflows/*`.
6. Minor: `hna-renderers.js:396` caption hardcodes "ACS DP04_0089E" → update to the cascade label (the calc already uses `homeVal`).
7. Secondary (owner decision): income-to-own finances 100% of value (no down payment); propose 5%/20% down.
**Verify:** Fruita HNA shows $486,295 + source "Zillow ZHVI city index"; `test:ranking-fresh` + `test_hna_ranking_integrity` green; ranking diff = affordability only.

### 2. Holistic briefs (end goal — Codex designs + builds; Claude QAs each phase)
Goal: each jurisdiction brief = a holistic, SOURCED view of every site metric useful for AH analysis there. Consume the LIVE layer (single source of truth; don't recompute/re-rank).
- **B1 — metric digest (data spine, NON-scoring):** `data/hna/jurisdiction-metrics-digest/<geoid>.json` assembling every AH-relevant metric (need/supply/market/demand-drivers/demographics/opportunity), each tagged `{value, geography_level: place|county_context, confidence, source_id, as_of}`. HARD: county data labeled `county_context`; single-vintage = level not trend; min-denominator floor on rates; assert ranking-index unchanged. Tests + coverage report. *(Safe anytime — reads the ranking dynamically, so a later re-rank just refreshes the digest data, not the code; can run in PARALLEL with the §4 tuning candidate reports.)*
- **B2 — brief "metric digest" section (consumes B1):** source-cited; respects the publish gate (`scripts/validate-jurisdiction-briefs.py`); add a DATA-CITATION source kind that auto-verifies `value == dataset[geoid][field]`; no 'search'-kind sources in published briefs. *(Do AFTER C-0 + tuning land, so briefs surface the FINAL grounded ranking.)*
- **B3 — economic / service-worker layer:** extend `scripts/hna/economic_housing_bridge.py` to place level; service-worker-demand = high home value × service-sector job share (LEHD CNS18/CNS07/healthcare) × in-commute × wage gap; county trends (`data/co-housing-costs/county-trends.json`) apportioned + labeled `county_context`.
- **B4 — business-expansion news-watch (optional/last):** source-disciplined scan of local-gov/press; must pass the brief source gate (primary/press, verified) or it doesn't ship.

### 3. Maintenance (low priority)
- #903 lodash-es: bump the Lighthouse dep if a clean upgrade exists. url-health-weekly: heal genuinely-broken URLs to durable jurisdiction SEARCHES (F35 pattern); close superseded weeklies (keep newest).

### 4. Ranking tuning (OWNER-GATED; each RE-RANKS — owner picks values, Codex implements + reports)
First Codex generates **candidate-effect reports** (each param vs current, others at default) so the owner decides from real numbers. Then **batch A+B+D into ONE combined re-rank PR**. *(Home-value metric is now handled by C-0, not a separate tuning PR.)*
COMMON RE-RANK PROCEDURE: change the named constant/source → `python3 scripts/hna/build_ranking_index.py` → sync `chfa-watchlist.json` need_rank (9) + refresh `_manifest.json` + ONE face-validity report vs origin/main (top-20 before/after places+counties, all >50-rank movers, explicit Baca/Sedgwick + Denver lines) → `test:ranking-fresh` + `pytest tests/test_hna_ranking_integrity.py` + `test:ci` green.
- **A — Rural gap-normalization:** `GAP_COUNT_WEIGHT`/`GAP_RATE_WEIGHT` (build_ranking_index.py L84–85, both 0.5). Shift toward rate; candidates 0.5/0.5, 0.4/0.6, 0.35/0.65 (sum=1.0). Show rural (Baca/Sedgwick/Kiowa/Phillips) rise + metros don't collapse; confirm `_MIN_RATE_DENOMINATOR=50` keeps sub-1,000-pop CDPs out of the top.
- **B — Commuter α:** `COMMUTER_AUGMENT_ALPHA` (L82, 0.15). Candidates 0.10/0.15/0.20; show movement; augment-only invariant must hold.
- **D — Overcrowding backfill:** add `DP04_0078E/0079E` to the fetch list in `scripts/hna/build_hna_data.py`; DISPATCH `.github/workflows/backfill-hna-extended-acs-cache.yml` (CENSUS_API_KEY set; do NOT edit it) to populate summaries; confirm `overcrowding_rate` gets coverage + hasIncompleteData stops over-flagging; it re-enters `COMMUNITY_NEED_WEIGHTS`.

### 5. Other owner-gated — surface only, do NOT act
- WORKFLOW fixes (off-limits without owner sign-off): auto-regen ranking-index in the data-refresh cron (stops staleness recurring + would prevent C-0 recurrence); dedup/auto-close the data-freshness-check alerts.
- PII history purge (→ production); CHAS/LODES refreshes (sources blocked); signal-layer keep/retire; SEO: submit cohoanalytics.com/sitemap.xml to Search Console (tag wired).

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
