# Codex Handoff — Phase 6: Project Effective-Demand Funnel (Screening-Grade)

**For:** Codex (implementer) · **QA:** Claude Code (real-shape recompute, monotonicity audit, sabotage — the usual gauntlet).
**Date:** 2026-08-05
**Blocked by:** the Phase 4 PR (project scenario) must be **merged** first — this module consumes `project-scenario/v1` docs. Do not start before it lands; verify `js/project-market-study/project-scenario.js` and `data/fixtures/fruita-commons.scenario.json` exist on your branch.
**Spec of record:** `docs/audits/SCOPING-FRUITA-COMMONS-REVISION-2-2026-08.md` §4 (Phase 6 row); refinement §14 (funnel stages); assignment §H; `docs/audits/STATEWIDE-READINESS-AND-GAP-REVIEW-2026-08.md` (why this stays screening-grade).
**Framing (non-negotiable):** this module produces a **screening-grade modeled funnel**, not a market study. Census/CHAS data supplies the *pool*; it never supplies mortgage-readiness, savings, or preferences. Every modeled reduction is a user-ownable assumption, and the output must say when a professional study and primary research are required.

---

## What you are building

**`js/project-market-study/effective-demand.js`** (new, pure, dual-export) — a funnel that starts from **observed/derived** jurisdictional households and applies **explicit, editable, modeled reductions** to reach modeled effective demand for a specific project scenario, by AMI band, unit type, and bedroom count. Plus **`test/effective-demand.test.js`**.

### Funnel architecture

```js
EffectiveDemand.run(scenarioDoc, observedInputs, assumptions) → FunnelResult
```

**Stage 0 — observed base (never reduced silently):** from `observedInputs` (caller passes parsed CHAS/ownership-need data — the same shapes the HNA modules use; renter households by AMI band, tenure totals, the existing `priceBandScreen` potential-buyer-pool counts). Each carries `classification: 'observed'|'derived'` + source label. The protected label "potential buyer pool (moderate-income renter households) - not committed demand" is preserved verbatim wherever that count is displayed.

**Stages 1–N — modeled reductions** (refinement §14 list, in this order, each a named stage object):
`household_size_compatibility`, `first_time_buyer_share`, `tenure_preference`, `down_payment_readiness`, `debt_credit_readiness`, `mortgage_readiness`, `unit_type_preference`, `location_preference`, `shared_equity_acceptance`, `purchase_readiness_window`, `contract_fallout`.

Each reduction is `{ share: number 0..1 | null, classification: 'modeled'|'user_entered', basis: string, verify: true, sensitivity: {low, base, high} | null }`:
- **`share: null` means the stage is unresolved** → the funnel result from that stage onward is `not_available` (never a silent pass-through, never 0). Effective demand is only computable when every stage has a value — that is the honesty mechanism.
- **No stage may increase the count** — with one explicit exception: an optional `in_migration` stage (`allowIncrease: true` required on it, and only it), mirroring the professionally documented 9–56% outside-PMA range recorded in `docs/audits/CALIBRATION-FRUITA-MEWS-PMA-2026-07.md`. Any other stage whose share > 1 throws.
- **No stage may be silently dropped:** `run()` output includes every stage in order with its input count, share, output count, and classification — including unresolved ones.

**Cross-tabs:** the funnel runs per AMI band (from the scenario's `ami_mix`), and the band results allocate to unit types/bedrooms via the scenario's `unit_mix` (proportional allocation, stated as a named convention; `household_size_compatibility` uses the Phase-4 bedroom→household-size convention).

**Default assumption set:** ship a named `DEFAULT_ASSUMPTIONS` where **every reduction share is `null`** with a `basis` string saying what evidence would resolve it (e.g. `down_payment_readiness: { share: null, basis: 'Requires lender pre-qualification data or HRWC counseling-pipeline data; not derivable from ACS/CHAS.' }`). A separate `ILLUSTRATIVE_ASSUMPTIONS` fixture (test-only, in the test file, clearly labeled) provides non-null values so the math is testable. **Do not ship non-null production defaults** — inventing conversion rates is exactly what this program forbids.

### Output contract

`FunnelResult`: `{ stages: [...], byAmiBand: {...}, byUnitType: {...}, byBedroom: {...}, effectiveDemand: number|'not_available', observedPool: number, unresolvedStages: [...], classification: 'modeled', screeningCaveat, professionalStudyNote, sensitivity: {low, base, high} | null }` — `sensitivity` runs the full funnel at each reduction's low/base/high when all stages have sensitivity ranges; `professionalStudyNote` names what a study/primary research must supply (broker/lender input, comparable-project absorption, buyer surveys), mirroring the disclosure discipline of `subject-capture-stack.js`'s caveat block.

## Hard rules (test-enforced or QA-bounced)

1. **Observed vs modeled never blend:** observed counts render/report only with observed classifications; any figure downstream of a modeled stage is `modeled`. A test walks the result asserting no `observed` classification appears after stage 0.
2. **Monotonic non-increasing** except the explicit `in_migration` stage; violation throws.
3. **`null` ⇒ `not_available`,** never 0, never pass-through — pinned by test on a funnel with one unresolved middle stage.
4. **No production non-null defaults** — a test asserts every `DEFAULT_ASSUMPTIONS` share is null.
5. **Banned language in this module:** `capture rate`, `capture rates`, `absorption`, `sellout`, `time-phasing`, `forecast`, `will buy`, `qualified buyer`, `mortgage-ready buyers` (the *stage id* `mortgage_readiness` is a modeled assumption name and is fine; prose claiming households ARE mortgage-ready is not). Sales pacing and capture are **Phase 7** — nothing time-phased here beyond the single `purchase_readiness_window` share.
6. **Scenario values never leak** into module constants (same fixture-leak grep as Phase 4).
7. No edits to existing modules/tests; `js/hna/` untouched.

## File allowlist
`js/project-market-study/effective-demand.js` (new) · `test/effective-demand.test.js` (new) · `package.json` (`test:effective-demand` after `test:project-scenario` in `test:ci`) · `README.md` inventory (+1 js file) · `data/_manifest.json` only if data bytes change (they shouldn't). Nothing else.

## Tests required (house conventions; engine-/module-generated fixtures, not hand-rolled shapes — the #1397 lesson)
- **Pinned arithmetic:** ILLUSTRATIVE assumptions on the real Fruita baseline scenario fixture + a real CHAS-shaped observed input (built via the same normalization the HNA module uses, not an invented shape): pin the stage-by-stage counts with hand derivations (QA recomputes cold).
- Monotonicity: share > 1 throws (except flagged in_migration); in_migration without `allowIncrease` throws.
- Unresolved stage → `not_available` end-to-end; `unresolvedStages` lists it; no zeros.
- DEFAULT_ASSUMPTIONS all-null; every stage present in output in order; observed/modeled classification wall (walk test).
- Sensitivity: low ≤ base ≤ high on the illustrative set.
- Cross-tab conservation: Σ byAmiBand = Σ byUnitType = Σ byBedroom = effectiveDemand (rounding-stated).
- Banned-language grep; fixture-leak grep; scenario adapter works on all four Phase-4 fixtures.
- Regression: `test:project-scenario`, `test:shared-equity-lifecycle`, `test:hna-ownership-need`, `test:file-manifest`, `validate` — exit 0.

## Delivery
One branch, one PR, squash. PR description: stage-order rationale, the allocation convention, pinned derivations, and an explicit "what this cannot say" section. **Do not merge — stop after opening the PR for Claude QA.**

## Acceptance criteria (Claude QA)
1. Pinned funnel matches QA's cold recompute on real-shape inputs; conservation holds.
2. Honesty mechanics verified: null ⇒ not_available (no zeros/pass-throughs), all-null production defaults, observed/modeled wall, monotonicity + the single explicit increase.
3. Sabotage: make a null stage pass through; set a production default non-null; blend an observed label downstream; add a capture/absorption string; break conservation — each must fail.
4. Allowlist + README + manifest + regression + full `test:ci` green.
