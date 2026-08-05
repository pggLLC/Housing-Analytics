# Codex Handoff — Phase 8: For-Sale Market Study Comparison Interface

**For:** Codex (implementer) · **QA:** Claude Code (rendered-DOM verification against engine outputs, degradation/no-ranking audits, sabotage).
**Date:** 2026-08-05
**Depends on:** Phases 1–7 all merged. This is the **first Tier-2 UI phase**: a new page where the six engines (finance, lifecycle, waterfall, land-disposition, scenario, funnel, capture) meet a user. **Display only — this PR adds zero new computation**; every number on the page must come from an engine call, and a test enforces it (no arithmetic beyond formatting in the page module).
**Spec of record:** `docs/audits/SCOPING-FRUITA-COMMONS-REVISION-2-2026-08.md` §4 (Phase 8 row) + §12 (information architecture: separate workflow linked from HNA and Deal Calculator); refinement §5 (scenario comparison), §6 (land models), §12 (shared-equity comparison); the guardrails accumulated in Phases 2–7 (no-ranking, degradation, denominators, all-null defaults, screening caveats).

---

## What you are building

1. **`for-sale-market-study.html`** (new root page, house layout/CSS tokens) — the Tier-2 workflow home.
2. **`js/project-market-study/market-study-page.js`** (new; the only new JS) — loads the four scenario fixtures + policy datasets, calls the engines, renders six sections.
3. **`test/market-study-page.test.js`** (new, jsdom).
4. Two **navigation links in** (one line each): the HNA Affordable Ownership Need section and the Deal Calculator ownership mode — "For-Sale Market Study (screening)" → the new page.
5. **`sitemap.xml`** — one `<url>` entry following the existing pattern. **Do NOT touch `robots.txt` or `CNAME`.** After the sitemap edit, run `node test/pages-availability-check.js` and `npm run test:pages` locally — if any pinned assertion is affected, update the pinned test in the same PR per the deploy-gate convention and say so in the PR description.

### The six sections (each: house `chart-card`, provenance/classification pills, screening caveat, mobile-safe)

**S1 — Scenario selector + program comparison.** All four fixtures selectable (baseline default). Side-by-side: unit mix, AMI mix, per-band `maxAffordablePrice` / `gapVsLocalPrice` / `assistanceRangeCheck` from `ProjectScenario.derive` (render `insufficient` prominently — it's a finding, not decoration), TDC-dependent rows showing `not_available` with the `owner_inputs_pending` list displayed verbatim. Partners block rendered with `is_commitment: false` visible ("candidate — no commitment").

**S2 — Land-disposition comparison.** `LandDisposition.compare` rows in **dataset order** (no merit order, no highlighting a "winner"); the 15 assessment fields with `verify`+validator badges; `engineInputs` per model driven through `SharedEquityLifecycle.project` to show the **monthly-housing-cost delta per model** (the $-figures the engines already produce — the tax/ground-rent consequences made visible). Model A labeled `hypothesis_to_test` verbatim.

**S3 — Shared-equity conventions.** `SharedEquityLifecycle.fromConvention` × the three real conventions × 5/10/20/30 years × the five canonical scenarios (selector). **Owner outcome and affordability outcome side-by-side, never ranked**; `verifyParameter` conventions badged VERIFY; scenario labels carry the "not a prediction" suffix.

**S4 — Resale settlement viewer.** `ResaleWaterfall.settle` on the selected convention/year/scenario with the default config: the step table (owed/paid/shortfall), retained-vs-recaptured split, and — mandatory — the **`ownerNetTransparencyWarning` rendered as a visible warning block** whenever true.

**S5 — Effective-demand funnel.** The 11-stage table from `EffectiveDemand.run`: production defaults (all-null) render as `not_available` rows with each stage's **`basis` string displayed** ("what evidence resolves this") — the page's honest default state is mostly-unavailable, and that is correct; per-stage share inputs (session-only, no persistence) let an analyst enter assumptions, re-running the funnel live; observed stage keeps the protected label verbatim; unresolved stages listed.

**S6 — Capture scenarios.** `ForsaleCapture.run` on the current funnel: the four sellout paces, monthly/annual closings, annual capture **with the denominator rendered next to every rate**, penetration, gross contracts, cross-tabs (the G2 `pool_zero_see_data_limitations` cell rendered as a labeled data-limitation note), `competitiveSupplyNote` + `captureHumilityCaveat` displayed verbatim, `poolDepletionModeled` flagged.

**Page footer:** the standing disclosure — screening estimate, not a completed market study; the verification-parties list; methods-exposure note.

## Hard rules (test-enforced or QA-bounced)
1. **Zero new math:** the page module contains no arithmetic beyond number formatting (a test greps for arithmetic on engine outputs; all `+ - * /` on data values is a bounce — Math.round/toLocaleString formatting excepted).
2. **No ranking anywhere:** no best/recommended/preferred/winner language, no sort-by-merit, no scoring — dataset/spec order only (grep + structural).
3. **Denominator visible** wherever a capture/penetration figure renders (DOM test).
4. **Transparency warning cannot be hidden** — if the settle result carries it, the DOM must contain the warning block (sabotage-tested).
5. **`not_available` renders as labeled unavailability** — never blank, never 0, never dash-only; the funnel's all-null default state is the page's default render and must show the basis strings.
6. **Protected labels verbatim** (potential-buyer-pool, scenario suffixes, humility/supply notes).
7. House UI gates: CSS variables only (`test:phantom-css-vars`), pill contrast (`test:pill-contrast`), mobile containment, no hover-only content, counts-lead convention.
8. **No persistence** of entered assumptions (session-state only; no localStorage — entered shares must not survive reload and must never write to any dataset).
9. No changes to any engine, any `js/hna/` file beyond the one nav line, or any dataset.

## File allowlist
`for-sale-market-study.html` (new) · `js/project-market-study/market-study-page.js` (new) · `test/market-study-page.test.js` (new) · `housing-needs-assessment.html` + `deal-calculator.html` (one nav line each) · `sitemap.xml` (one entry; + `test/pages-availability-check.js` ONLY if a pinned assertion is affected — explain in PR) · `package.json` (`test:market-study-page` after `test:forsale-capture`) · `README.md` inventory (+1 top-level page, +1 total page, +1 js file — verify with `node scripts/compute-inventory.mjs`). `data/_manifest.json` untouched. Nothing else.

## Tests required (jsdom; real engines + real fixtures, never stubs)
- Each section renders from the real baseline fixture: S1 shows the four `insufficient`/`sufficient`/`unknown` states correctly; S2 rows in dataset order with cost deltas matching direct engine calls; S3 grid values equal direct `fromConvention` calls; S4 pins the worked waterfall reference numbers in the DOM; S5 default state = all-null render with basis strings; S6 capture values + denominators equal direct `ForsaleCapture.run` output.
- Interaction: entering a full assumption set re-renders S5/S6 with computed values (jsdom event test); reload/`render()` fresh loses entered values (no persistence).
- Degradation: a scenario with `not_available` TDC renders labeled unavailability in S1 (never 0).
- Greps: no-ranking vocabulary; no-arithmetic-on-data rule; protected labels present; banned `js/hna/` vocabulary absent from the HNA nav-line diff.
- Regression by exit code: all six engine suites, `test:navigation-paths`, `test:orphan-nav-cleanup`, `test:pages`, `test:pill-contrast`, `test:phantom-css-vars`, `test:mobile-overflow-containment`, `validate`, `test:file-manifest`.

## Delivery
One branch, one PR, squash. PR description: DOM snippets/screenshots of all six sections in the default (mostly-unavailable) state AND a resolved-assumptions state; the sitemap/availability-gate handling; known limitations. **Do not merge — stop after opening the PR for Claude QA.**

## Acceptance criteria (Claude QA)
1. Every rendered number equals a direct engine call (QA re-derives section values cold against the same fixtures).
2. The default page state is honest: all-null funnel renders unavailability + basis strings; owner-inputs-pending visible; no fabricated values anywhere.
3. No-ranking, denominator-visibility, transparency-warning, and protected-label rules hold under sabotage (hide the warning; add a "recommended" badge; strip a denominator; replace not_available with 0 — each must fail).
4. Zero-new-math rule holds (grep + spot inspection).
5. Nav links + sitemap + availability gate green; house UI gates green; full `test:ci` green.
