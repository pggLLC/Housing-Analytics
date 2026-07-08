# Pass D — Implementation Plan

Audit date: 2026-07-07  
Principle: small PRs, one behavior boundary at a time. Do not bundle IA redesign with calculation fixes.

## Phase 0 — Guardrails Before More Features

| PR | Priority | Scope | Deliverables | Regression gate |
|---|---:|---|---|---|
| 0.1 Home-value single source | P0 | HNA home-value stat/narrative only | Shared display metadata helper; narrative consumes same value/source/vintage as stat; examples for raw ACS, ZHVI, county-adjusted, suppressed values. | `npm run test:hna`, `node test/hna-home-value-cascade.test.js`, new cross-surface test. |
| 0.2 Preservation label split | P0 | Affordable housing property build/render/copy only | Rename broad source-membership tag or add `risk_status`; update legend/compare/market copy; keep existing inventory counts. | Property schema test plus targeted render/source tests. |
| 0.3 Semantic label guard | P0 | Tests/schema only | Guard for labels containing candidate/risk/recommendation/classification to declare evidence type: computed, curated, source membership, or modeled. | New semantic-label test. |

## Phase 1 — QA Harness Reliability

| PR | Priority | Scope | Deliverables | Regression gate |
|---|---:|---|---|---|
| 1.1 Opportunity Finder verifier source-of-truth | P1 | `js/lihtc-opportunity-finder.js`, `scripts/audit/verify-opportunity-finder.mjs`, optional shared JSON | Remove copied stale 4% weights; verifier reads shared weights or extracts them deterministically. | `npm run test:lihtc-opportunity-finder-zori`, `npm run audit:opportunity-finder` if available. |
| 1.2 HNA stub-era test retirement | P1 | Tests only | Inventory tests still reading `js/housing-needs-assessment.js`; migrate high-value assertions to `js/hna/*` or rendered DOM; mark remaining stub checks as compatibility-only. | `npm run test:hna`, targeted migrated tests. |
| 1.3 Soft-funding freshness guard | P1 | Data QA scripts/tests only | All non-null `contactUrl`s swept; `lastUpdated` SLA asserted or owner-waived; no program amount/deadline refresh. | `npm run validate:data`, URL sweep dry/diff mode as appropriate. |

## Phase 2 — IA Cleanup

| PR | Priority | Scope | Deliverables | Gate |
|---|---:|---|---|---|
| 2.1 Data Trust Center | P1 | Data/diagnostic pages and nav | Consolidate `data-status`, `data-review-hub`, data sources, QA coverage under a single public trust entry. Preserve legacy pages but demote. | Navigation path tests, public build. |
| 2.2 Public/internal pipeline wording | P1 | Public HNA/OF/PMA teasers and developer-gated mounts | Decide naming: public methodology vs internal CRM. Hide or relabel gated mounts accordingly. | Public build, navigation tests. |
| 2.3 Homepage job routing | P2 | `index.html` and nav only | Jurisdiction search first; route to Profiles, Housing Need, Opportunity Finder, Site/Deal Feasibility, Data Trust. | Screenshot/rendered QA required. |

## Phase 3 — Rendered QA

| PR | Priority | Scope | Deliverables | Gate |
|---|---:|---|---|---|
| 3.1 Core rendered smoke | P2 | Tests/audit scripts only | Browser smoke for HNA, one county profile, one place profile, OF, PMA, Data Trust. Capture console errors, blank cards, mobile overflow. | Playwright/site-audit output attached to PR. |
| 3.2 Screenshot evidence pack | P2 | Docs/QA only | Desktop/mobile screenshots and disposition table for the core flows. | Manual QA evidence. |

## Phase 4 — Calibration And Owner Decisions

| Item | Priority | Decision needed |
|---|---:|---|
| DOLA warning deltas | P2 | Are 12 county +/-5% warnings acceptable under current projection method, or do inputs need refresh? |
| HNA benchmark ratios | P2 | Which consultant deltas are expected method differences versus model drift? |
| Public docs boundary | P2 | Should `docs/qa` and `docs/audits` remain public-facing, or be excluded/demoted? |
| Placeholder inventory | P2 | Which placeholders are acceptable public limitations vs unfinished product promises? |

## Revised IA Target

| Top-level | Primary question | Main pages |
|---|---|---|
| Jurisdiction Profiles | “What is true here?” | Search, generated place/county profiles. |
| Housing Need | “How severe is need?” | HNA, compare. |
| Opportunity Finder | “Where should we look?” | LIHTC locator, preservation/source inventory. |
| Site And Deal Feasibility | “Can this site/deal work?” | PMA, deal calculator, land value. |
| Data Trust Center | “Can I trust the data?” | Freshness, sources, QA coverage, methodology. |
| Methodology | “How is this calculated?” | Guides, glossary, pipeline explainer. |

## Homepage Wireframe Outline

1. Jurisdiction search and “start with a place” route.
2. Three task buttons: Understand need, Find opportunity, Test feasibility.
3. Compact statewide signal strip with source/vintage labels.
4. Data Trust strip with last refresh and known limitations.
5. Methodology/guide links below the fold.
6. Footer with diagnostics and repo/docs links.

## Definition Of Done For Follow-Up PRs

- One PR per task.
- PR description includes before/after evidence and exact tests run.
- No broad data refresh hidden inside link/copy/test PRs.
- New claims identify whether values are raw, transformed, modeled, source-membership, or owner-curated.
- Rendered UI changes include desktop/mobile screenshots or explicit `UNRENDERED` deferral.
