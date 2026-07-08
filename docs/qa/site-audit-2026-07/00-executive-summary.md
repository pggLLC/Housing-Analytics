# COHO Analytics Full Site And Repo Audit — Executive Summary

Audit date: 2026-07-07  
Scope: full site/repo audit, audit-only. No application code or data was changed. Reports were written only under `docs/qa/site-audit-2026-07/`. Browser rendering was not run; any visual/mobile/blank-state conclusion is marked `UNRENDERED` in the detail reports.

**Coverage note (added post-merge):** the Combined Jurisdictions module (`js/hna/combined-geo.js`, merged same day as this audit in PR #1076) was not covered by this pass. It merged with 5 of 7 QA must-fix findings still open, including two issues matching this audit's own top theme (masking-rule violations — see A-01/C-01). Tracked as Phase 0 item 0.4 in `04-plan.md` rather than re-audited here; see `03-hygiene-boundary-testing.md`'s Prior Audit Reconciliation table for detail.

## Bottom Line

The site is much more stable than the older audit docs imply. The allowed gates are green, HNA modularization is substantially covered, and several older methodology concerns are now fixed or honestly disclosed. The remaining high-risk issues are not broad breakage; they are trust/lineage issues where the site can say the right kind of thing from the wrong path.

The two must-fix classes are:

1. **One metric, multiple paths:** HNA median home value can display one value/source in the stat card and a different raw ACS value/vintage in narrative prose.
2. **Analytical label overclaim:** `preservation-candidate` currently means “member of a preservation/subsidized source feed,” but the UI explains it as an at-risk/expiring classification.

## Top 25 Findings

| Rank | ID | Severity | Finding | First action |
|---:|---|---:|---|---|
| 1 | A-01 | P0 | HNA median home value stat and narrative use different data paths and labels. | Centralize home-value display metadata and assert stat/narrative agreement. |
| 2 | A-02 | P0 | `preservation-candidate` overstates source membership as risk classification. | Split source inventory from true risk/candidate flags. |
| 3 | C-01 | P0 | Tests do not guard cross-surface metric equality/source-vintage agreement. | Add sample cross-surface tests for repeated headline metrics. |
| 4 | C-02 | P0 | Tests do not guard semantic labels like candidate/risk/recommendation. | Add schema/semantic checks for label type and evidence. |
| 5 | A-03 | P1 | Opportunity Finder verifier hard-codes stale 4% weights while app/docs use newer weights. | Share or extract weights from production source. |
| 6 | B-01 | P1 | Too many peer-level first steps in navigation. | Reframe IA around user jobs. |
| 7 | B-02 | P1 | Diagnostics pages read as product pages, not a trust center. | Consolidate as Data Trust Center. |
| 8 | B-03 | P1 | Public pages mix pipeline methodology with gated/internal workflow concepts. | Decide public vs internal pipeline language. |
| 9 | C-04 | P1 | Source-grep tests remain brittle after modularization. | Retire or replace legacy implementation-string tests. |
| 10 | C-05 | P1 | HNA compatibility stub still anchors some old tests. | Move tests to `js/hna/*` modules/rendered behavior. |
| 11 | C-06 | P1 | Soft-funding file needs freshness/URL-specific guardrails beyond tracker behavior. | Add SLA and URL sweep coverage for `contactUrl`s. |
| 12 | A-04 | P1 | Preservation overclaim appears downstream in compare/market contexts. | Rename copy until risk model exists. |
| 13 | A-05 | P2 | Lightweight deal predictor remains placeholder concept screening. | Keep finance outputs in full calculator or share primitives. |
| 14 | A-06 | P2 | DOLA vintage check passes but warns on 12 county deltas beyond +/-5%. | Add warning table to data-refresh QA review. |
| 15 | A-07 | P2 | Hardcoded ACS vintage labels remain risky where values can come from non-ACS cascade. | Use source metadata for cascade-backed values. |
| 16 | A-08 | P2 | PMA method boundary is now honestly disclosed, but rendering not validated. | Preserve disclaimer and run rendered QA. |
| 17 | A-09 | P2 | HNA benchmark ratios show meaningful consultant-method deltas. | Maintain as calibration dashboard with owner notes. |
| 18 | B-04 | P2 | Homepage “every stat is sourced” claim can overpromise cross-surface consistency. | Narrow to sourced/monitored and link limitations. |
| 19 | B-05 | P2 | HNA page is dense for first-time users. | Add a compact decision strip above detailed sections. |
| 20 | B-06 | P2 | Place pages should be primary entry points, not secondary generated artifacts. | Route homepage search to profiles first. |
| 21 | B-07 | P2 | Data quality copy uses maintainer language. | Translate to public trust questions. |
| 22 | C-07 | P2 | Public/internal docs and workflow boundaries are still mixed. | Decide build exposure for QA/audit docs. |
| 23 | C-09 | P2 | Placeholder/stub language remains without universal retirement criteria. | Create a placeholder inventory. |
| 24 | C-10 | P2 | 228 iCloud duplicate JSON files can distort repo sweeps/counts. | Add hygiene guard or cleanup process. |
| 25 | A-10/C-11 | P3 | Browser/mobile/visual behavior is `UNRENDERED`. | Run a rendered QA pass after this audit. |

## What Is Stable

| Area | Status |
|---|---|
| HNA core test suite | `npm run test:hna` passed 730/0. |
| ACS ETL/source badges | `node test/acs-etl.test.js` passed 167/0. |
| Critical data/schema gates | `npm run validate:data`, `node scripts/validate-schemas.js`, and DP04 code tests passed. |
| DOLA projection vintage | Check runs against official source; warnings are review items, not gate failure. |
| PMA disclaimers | Source text clearly says screening-only and not formal CHFA PMA. |
| Deal calculator | Full calculator contains DSCR and supportable first mortgage sections. |

## Simplification Map

| Keep as core | Consolidate | Demote / gate |
|---|---|---|
| Jurisdiction profiles | Data status + data sources + QA coverage into Data Trust Center | Legacy diagnostic dashboards from primary nav |
| HNA | Compare summary paths into HNA/profile flows where possible | Internal developer pipeline UI unless authenticated |
| Opportunity Finder | Preservation inventory into Finder/Profiles with corrected labels | Old audit docs from public user journeys |
| PMA + Deal Calculator | Deal predictor concept screening with full calculator finance outputs | Compatibility-stub-era tests |

## PR-Safe Next Move

Open a sequence of small PRs, not a broad rewrite:

1. P0 lineage PR: home-value stat/narrative shared source and tests.
2. P0 semantic-label PR: preservation inventory/risk split and downstream copy.
3. P1 test-harness PR: Opportunity Finder shared weights and legacy grep retirement plan.
4. P1 IA PR: Data Trust Center consolidation and public/internal pipeline wording.
5. P2 rendered QA PR: browser screenshots/console/mobile checks for HNA, profiles, OF, PMA, and diagnostics.
