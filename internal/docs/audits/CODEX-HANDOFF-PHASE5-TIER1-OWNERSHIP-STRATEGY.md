# Codex Handoff — Phase 5: Tier-1 Jurisdictional Ownership-Strategy Interface

**For:** Codex (implementer) · **QA:** Claude Code (place-scoping audit, model-guardrail checks, degradation-state checks, sabotage — the usual gauntlet).
**Date:** 2026-08-04
**Depends on:** Phases 1–3 merged (#1388/#1390/#1392/#1394). Phase 3.1 (screening flag) is independent — no ordering constraint, but avoid touching `deal-calculator.js` in this PR to prevent merge conflicts.
**Spec of record:** `docs/audits/SCOPING-FRUITA-COMMONS-REVISION-2-2026-08.md` §2 (Tier-1 definition), §4 (Phase 5 row); refinement §16 (the jurisdictional output list); `docs/audits/STATEWIDE-READINESS-AND-GAP-REVIEW-2026-08.md` (coverage + degradation duties, G2/G4/G10/G11); reference docs for authority structures, local contributions, rural-urban competitiveness.
**This is the statewide deliverable** — every supported county and place gets an ownership-strategy read. It is a *screening* product and must say so; it is **not** a market study.

---

## What you are building

A new **"Ownership Strategy"** subsection inside the existing Affordable Ownership Need section of `housing-needs-assessment.html`, rendered by a **new** module `js/hna/hna-ownership-strategy.js` (keep `hna-renderers.js` churn to a wiring call). For the selected jurisdiction it composes, from data already on the page or in Phase-3 datasets:

1. **AMI / income ladder + affordable-price ladder** — per AMI tier (60–120%), income and max affordable price via `OwnershipFinance` with the **model registry**: default `conservative_screening`, a user-selectable model dropdown, and the model's `implications` panel. The comparator's risk-disclosure contract applies: a more permissive model's results always render the buyer-risk note. Household-size selector (default 4) using the engine's factors.
2. **Local price anchor + per-tier shortfall** — the jurisdiction's own price (the same place-scoped home-value cascade value the section already uses — **never county-masked for a place**; provenance pill required). Show per-tier **shortfall $** (price − tier max price) and which tiers clear the median (boolean). **Do NOT render a "% of households priced out" figure** — the income distribution tops out at 100% AMI (readiness G2); a code comment must say why it's absent.
3. **Income required to buy** — `incomeNeededForHomeValue(local price)` under the selected model, with AMI-ratio context.
4. **Attainable supply + potential buyer pool** — reuse the existing `ownerValueSupply` bands and `priceBandScreen` outputs (render, don't recompute; the "potential buyer pool … not committed demand" label is protected).
5. **Programs & funding** — from Phase-3 datasets: developer/project sources and buyer-assistance for this geography, each showing `commitment_status` with the standing rule rendered: *available is context, never money*. Screening-only application labeling per Phase 3.1 if present.
6. **Stewardship & authority capacity** — the jurisdiction's `housingAuthority` structure/capacity fields and `stewardship_providers`; where none: render the canonical flag string from `stewardship-providers.json` meta (`no_stewardship_flag`) verbatim.
7. **Public land** — count + list from `county-ownership.json` for the containing county (labeled county-scope).
8. **Funding-competitiveness checklist** — current-HNA status + Prop 123 status (`jurisdiction-housing-progress.json` where covered, else "not tracked"), rural/urban designation **only where derivable** (else "VERIFY"), and the §3 checklist items rendered done/gap/unknown. No fabricated designations.
9. **Preliminary strategy** — **reuse** the existing `tenureMixRecommendation` + detail from `computeOwnershipNeed` (render, never re-derive or re-weight).
10. **Disclosure block** — "screening estimate; not a completed project market study"; the methods-exposure principle (each figure's source/model/classification visible via the existing pill/badge patterns); and the **verification flag** naming the parties (developer discussions, lender, appraiser, broker, program administrator, local jurisdiction) required before decision-grade use.

### Degradation duties (readiness review — first-class, not afterthoughts)
- Any missing input renders a labeled "data not available for this jurisdiction" state — never zero, never blank, never a county value silently standing in for a place.
- **Zero/negative-gap jurisdictions** (price ≤ tier max): render the affirmative "market-attainable at this tier" state; do not force a subsidy narrative.
- Funding/progress data covers ~33 jurisdictions; providers cover 64 counties + ~70 places — everything else shows the not-tracked state.

## Hard rules
1. **Place-vs-county masking is the repo's recurring bug** — every data element carries the existing provenance-pill pattern; a place selection must never show county data unlabeled. QA spot-checks Fruita (0828745) and Erie (0824950) against raw JSON.
2. **Banned language** (this is `js/hna/` — the strict lane): no `forecast`, `capture rate`, `absorption`, `time-phasing`, `qualified buyer`, `mortgage-ready`; the existing banned-phrase tests must stay green. Strategy copy stays screening-framed.
3. **Model guardrail:** default is the registry default; switching to a permissive model renders `riskDisclosure`; no auto-selection of the most permissive; selections do not persist as statewide defaults.
4. **Additive only:** no changes to existing HNA calculations, scores, rankings, exports, or the existing ownership cards; no `deal-calculator.js`; no `data/` content changes (render what Phase 3 shipped).
5. House UI rules: `chart-card` markup, CSS variables only (`test:phantom-css-vars`), WCAG pills (`test:pill-contrast`), counts lead / tiers secondary, mobile containment, no hover-only content.

## File allowlist
- `js/hna/hna-ownership-strategy.js` (new — pure render module, data passed in, mirroring `hna-ownership-need.js` conventions; jsdom-testable)
- `housing-needs-assessment.html` (subsection mount + script tag + fetches for the two new policy datasets if not already loaded)
- `js/hna/hna-controller.js` and/or `js/hna/hna-renderers.js` — **wiring only** (fetch + one render call)
- `test/hna-ownership-strategy.test.js` (new)
- `package.json` (script + `test:ci` insertion after `test:hna-ownership-need`)
- `README.md` inventory (+1 js file — run `node scripts/compute-inventory.mjs`)
- `data/_manifest.json` only if a data file's bytes change (they shouldn't)
- Nothing else. **No new datasets, no Python, no workflows, no exports.**

## Tests required (jsdom + vm, house conventions)
- **Ladder correctness:** per-tier prices equal `OwnershipFinance.maxAffordablePrice(ami, tier, modelId)` exactly for two pinned jurisdiction fixtures (recomputed by QA); household-size selector changes results per engine factors; default model = registry default.
- **Risk disclosure:** rendering with `conventional_dti` selected shows the buyer-risk note; sabotage-able (removing the note must fail).
- **Place-scoping:** Fruita fixture renders place price ($ from the cascade `places` map) with a place pill; a place lacking place data renders the labeled county-fallback pill, not a silent county number.
- **No priced-out %:** rendered output contains no `% of households` / `priced out` percentage claim (regex test) — the G2 guard.
- **Commitment rule:** an `available` program renders with its status and never in an "applied/counted" position; the no-steward flag string renders verbatim for a no-provider fixture.
- **Degradation:** missing funding/progress/provider data → "not tracked/available" states (assert exact strings); zero-gap fixture → market-attainable state, no subsidy language.
- **Strategy reuse:** the recommendation string equals `computeOwnershipNeed(...).tenureMixRecommendation` for the fixture (no re-derivation).
- **Copy scan:** banned phrases absent from the new module; "screening estimate" and "not a completed project market study" present; verification-parties list present.
- **Regression:** `test:hna-ownership-need`, `test:hna`, `test:metric-truth-crosssurface`, `test:pill-contrast`, `test:phantom-css-vars`, `test:mobile-overflow-containment`, `validate` all green by exit code.

## Delivery
One branch, one PR, squash. PR description: screenshot/DOM snippet of the section for a data-rich place (Fruita), a thin place (degradation states visible), and a county; statement of which datasets are fetched and when; known limitations. **Do not merge — stop after opening the PR for Claude QA.**

## Acceptance criteria (Claude QA)
1. Ladder values match QA's independent engine calls for both pinned fixtures; model switch + disclosure behavior verified live in jsdom.
2. Place-scoping audit passes on Fruita + Erie (raw-JSON cross-check); no silent county masking anywhere in the section.
3. All degradation states render as specified against QA-constructed thin fixtures; zero-gap jurisdiction renders without subsidy framing.
4. No priced-out % anywhere; banned-language and screening-disclosure scans clean; existing HNA outputs byte-identical for a control fixture.
5. Sabotage: break a ladder tier constant; remove the risk disclosure; remove the place pill; render a % priced-out — each must fail the suite.
6. Allowlist respected; README inventory bumped once; full `test:ci` green.
