# Codex Handoff — Phase 9: Fruita Commons Market-Study Report & Export (Screening Draft)

**For:** Codex (implementer) · **QA:** Claude Code (caveat-completeness walk, export-fidelity checks, zero-math audit, sabotage).
**Date:** 2026-08-06
**Depends on:** Phases 1–8 all merged (the Tier-2 page is live). **This is the last build phase** before statewide reuse (10) and independent QA (11).
**Spec of record:** `docs/audits/SCOPING-FRUITA-COMMONS-REVISION-2-2026-08.md` §4 (Phase 9 row); refinement §17 (the recommendation-output list) and §18 (classification display); every caveat accumulated in Phases 4–8.

**The design center:** the report is the artifact a lender, funder, or council member will actually read — so Phase 9 is an **honesty-assembly job**. Its acceptance hinges on one property: **every accumulated caveat, limitation, and pending input appears in the exported document**, with classifications visible. A report that silently drops one caveat fails QA outright.

---

## What you are building

1. **`js/project-market-study/market-study-report.js`** (new) — `buildReport(model, meta)` assembles a structured report object from a Phase-8 `buildModel` result (zero new math — same rule as Phase 8), and `renderReportHtml(report)` produces a **self-contained** HTML document string (inline styles only, no external assets, readable printed or offline).
2. **Page integration** — a seventh section on `for-sale-market-study.html`: "7. Report (screening draft)" with a preview and a **Download** button that serializes the current page state via `renderReportHtml` into a Blob download (`fruita-commons-market-study-screening-draft.html`). `js/project-market-study/market-study-page.js` gains only the wiring (build → preview → download); no other page changes.
3. **`test/market-study-report.test.js`** (new).

### Report structure (refinement §17, honest edition)

- **Title block:** "Fruita Commons — For-Sale Fundamental Market Study" with the subtitle **"SCREENING DRAFT — not a completed market study"** (verbatim, prominent, and repeated in the footer); `asOf` passed in by the caller (never `Date.now()` inside the module — house testability rule); data vintages listed (scenario `meta.as_of`, home-value `as_of`, conventions `as_of`).
- **1. Project summary** — units, mix, sizes, AMI mix, tenure form, jurisdiction; partners table with roles and **"candidate — no commitment"** on every row; the **FHA disambiguation note** (Fruita Housing Authority ≠ Federal Housing Administration) verbatim where either appears.
- **2. Affordability & gap** — the per-band ladder (max price, gap vs local price, assistance-range check with `insufficient` findings called out as findings); local price with source/scope; income-required. **No priced-out percentage anywhere** (the G2 guard extends to the report).
- **3. Costs & subsidy** — TDC-dependent rows as `not_available — owner input required`; the **`owner_inputs_pending` list rendered as its own subsection** ("What this report is waiting on"), enumerating tdc_build_up, land_value, phasing, hrwc_terms, development_partner, lender.
- **4. Land disposition** — Models A–D in dataset order with the per-model cost deltas and verify/validator badges; Model A labeled **hypothesis_to_test**; the retained-ownership property-tax nuance note.
- **5. Shared equity & settlement** — convention grid (owner outcome AND affordability outcome, never ranked); the selected settlement with retained/recaptured split; the transparency warning **always included when present**.
- **6. Demand (screening)** — the funnel table including unresolved stages with their evidence-basis strings; the protected potential-buyer-pool label verbatim; the **G2 limitation stated in prose**: CHAS cannot see above 100% HAMFI, so the 100–120% band's observed pool is structurally zero pending an above-100% income source.
- **7. Capture scenarios (screening)** — paces with denominators printed beside every rate; `competitiveSupplyNote` and `captureHumilityCaveat` verbatim; `poolDepletionModeled` flags; the zero-pool data-limitation cells.
- **8. Validation steps** — the verification-parties list (developer discussions, lender, appraiser, broker, program administrator, local jurisdiction) plus the Phase-11-bound items: legal (deed restriction/ground-lease enforceability, CDARA exposure for attached product), appraisal treatment, lender product acceptance, administrator capacity, assessor treatment of restricted value.
- **9. Classification legend** — observed / derived / modeled / user_entered / not_available definitions, and the commitment-status rule ("available is context, never money") verbatim.

### The caveat manifest (the heart of QA)

Export a `REQUIRED_CAVEATS` array from the report module — the canonical strings (or stable substrings) of every mandatory disclosure: screening-draft banner, hypothesis_to_test, owner-inputs-pending, G2 prose, competitive-supply note, capture humility, protected buyer-pool label, transparency-warning (conditional), FHA disambiguation, verification-parties, classification legend, commitment-status rule, scenario-not-prediction suffix. `buildReport` must fail loudly (`throw`) if any required caveat would be absent from its own output — **the report refuses to render dishonestly by construction.** Tests verify both the happy path (all present in preview AND downloaded HTML string) and the refusal path (strip one → throw).

## Hard rules (test-enforced or QA-bounced)
1. **Caveat completeness:** every `REQUIRED_CAVEATS` entry present in `renderReportHtml` output; the module throws rather than rendering without one (sabotage-tested per caveat).
2. **Zero new math** — report values come from the Phase-8 model object only; formatting excepted (grep-enforced, same as Phase 8).
3. **Export fidelity:** the downloaded HTML string contains everything the preview shows (byte-inclusion test of the caveat set + a sampled figure set); self-contained (no `http`/`//` asset references except citation hyperlinks; a test asserts no `<script`, no external `<link`).
4. **No priced-out %**; **no ranking language**; **no commitment language** on candidates; the not_available discipline throughout.
5. `asOf` and vintages are inputs — no `Date.now()`/`new Date()` in the module.
6. Nothing outside the allowlist; engines and existing sections untouched except the S7 wiring.

## File allowlist
`js/project-market-study/market-study-report.js` (new) · `test/market-study-report.test.js` (new) · `for-sale-market-study.html` (S7 section + script tag) · `js/project-market-study/market-study-page.js` (S7 wiring only) · `package.json` (`test:market-study-report` after `test:market-study-page`) · `README.md` inventory (+1 js file). Manifest untouched. Nothing else.

## Tests required (house conventions; real engines + fixtures)
- Full report built from a real Phase-8 `buildModel` on the baseline fixture: every REQUIRED_CAVEATS entry present in preview and export string; refusal path throws for each stripped caveat (loop the manifest).
- Sampled figure fidelity: the S2 band gap, S5 retained/recaptured (the corrected \$20k/\$80k case), and one capture denominator appear identically in report and page model.
- Default-state report (all-null funnel): demand/capture sections render the unresolved state with basis strings — the report is publishable-honest even with zero owner inputs.
- Self-containment assertions; no-Date assertions; zero-math grep; no priced-out-% regex; export filename and Blob wiring (jsdom).
- Regression: `test:market-study-page` + all six engine suites + `validate` + `test:file-manifest` — exit 0.

## Delivery
One branch, one PR, squash. PR description: the full rendered report for the default state (attach or inline), the caveat manifest list, and a "what changes when owner inputs arrive" note. **Do not merge — stop after opening the PR for Claude QA.**

## Acceptance criteria (Claude QA)
1. Caveat-completeness walk: QA checks every manifest entry in the exported HTML cold, and runs the strip-one→throw loop independently.
2. Figure fidelity spot-checks match direct Phase-8 model values (including the \$20k/\$80k settlement split).
3. Default-state export is honest and complete; self-containment holds; no Date/math/ranking/percentage violations.
4. Sabotage: remove a caveat from the manifest (report must still refuse via the render-side check); hardcode a figure; add an external script tag; render a priced-out % — each must fail.
5. Allowlist + README + regression + full `test:ci` green.
