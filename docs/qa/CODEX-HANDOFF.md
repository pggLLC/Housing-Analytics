# Codex Handoff — single source of truth

_Updated 2026-06-27 by Claude. **Phases 2–4 SHIPPED + MERGED (#995); Phase 3 extended-ACS cache ACTIVATED on main.** The HNA ranking-methodology arc is now a **draft PR stack (#996 → #997 → #998), all owner-gated.** See CURRENT STATE below. Phase 1 PII-history purge stays **deferred to production**. (The "Commuter Score Re-rank" work order further down is the original A1 spec — now shipped as #996 and superseded by #998's commuter handling; kept as history.)_

---

## 2026-06-27 — CURRENT STATE (HNA ranking-methodology stack)

**Draft PR stack — OWNER-GATED, do NOT merge without owner sign-off:**
- **#996** `codex/commuter-score-rerank` — A1: geo-type percentile pools + commuter 50/50 (count/ratio). *Superseded by #998's commuter handling; #996's own face-validity report is stale (compares HEAD-to-self) — moot if the stack collapses into #998.*
- **#997** `codex/hna-methodology-b1` — B1: 5-factor need index (gap / burden / affordability / future / commuter). Independent QA: **PASS**.
- **#998** `codex/qap-aligned-hna-ranking` — QAP-aligned: **Community Need 0.55 × Opportunity 0.45**; commuter is **augment-only** on community need (`× (1 + 0.15·commuter/100)`, no standalone weight). Independent QA: methodology **PASS**, but **`ci-checks` / `test:ranking-fresh` is RED** — the committed index doesn't reproduce in CI though it does locally (cross-environment float/ordering non-determinism in the new `build_opportunity_context()`).

**ACTIVE Codex work (this session):**
1. **[BLOCKER] Fix #998 freshness** — make `build_opportunity_context()` reproducible (sorted iteration over tracts / amenities / the `qct_tracts` set; deterministic float rounding), regenerate `data/hna/ranking-index.json`, confirm `npm run test:ranking-fresh` is green in CI.
2. **[minor] #998 overcrowding** — `DP04_0078E/0079E` are 100% absent → drop overcrowding from the community-need blend + `hasIncompleteData`/confidence accounting until backfilled (avoids 547/547 false incomplete flags).
3. **[separate PR] Income-to-buy home-value unification** — point `js/affordability-metrics-panel.js` (+ any homeownership-affordability calc) at the place-level `median_home_value` cascade (the source the HNA/ranking already uses) instead of stale county ACS DP04; carry confidence/as_of; add a test asserting place page + ranking + income-to-buy agree (e.g. Fruita 0828745).

**QUEUED (not started; later phases):** holistic-brief jurisdiction metric digest → brief enrichment (respecting the publish gate) → economic-drivers / service-worker layer → business-expansion news-watch.

**OWNER DECISIONS (not Codex):** stack merge strategy (collapse #996+#997+#998 vs sequential); rural-county gap-normalization + commuter α (0.10–0.20) tuning; PII history purge (deferred to production).

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
