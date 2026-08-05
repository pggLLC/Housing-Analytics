# Codex Handoff — Phase 7: For-Sale Capture, Penetration & Phased-Sales Scenarios

**For:** Codex (implementer) · **QA:** Claude Code (cold recompute on real Phase-4/6 outputs, sabotage, vocabulary-boundary audit).
**Date:** 2026-08-05
**Depends on:** Phases 4 + 6 merged (#1402, #1403) — this module consumes a Phase-6 `FunnelResult` and a Phase-4 scenario doc. Verify both modules exist on your branch.
**Spec of record:** `docs/audits/SCOPING-FRUITA-COMMONS-FOR-SALE-MARKET-STUDY-2026-08.md` §9 (capture architecture); `docs/audits/SCOPING-FRUITA-COMMONS-REVISION-2-2026-08.md` §4 (Phase 7 row); refinement §14 (capture list); `docs/audits/CALIBRATION-FRUITA-MEWS-PMA-2026-07.md` (capture humility, F-CAL-3).

**The vocabulary boundary (read first):** this module is the ONE place in the repo where for-sale pacing vocabulary — *capture rate, penetration, sellout, monthly sales, absorption period* — is legal. It stays legal **only here**: the existing ban tests keep it out of `js/hna/`, and the sibling Tier-2 modules ban it too. Inside this module, **"forecast" remains banned** — every time-shaped output is a *scenario*, labeled with the 2a convention ("… — scenario, not a prediction"). The existing CHFA rental capture machinery (`subject-capture-stack.js`, `simulateCapture`, `calculateAbsorptionRisk`) is **not** reused and its thresholds are **not** ported.

---

## Resolved dependency — competitive/pipeline supply (read before designing)

The plan's stated dependency on a for-sale competitive/pipeline supply source is **resolved for Phase 7 as: explicitly out of scope.** No such data source exists in the repo (`STATEWIDE-READINESS-AND-GAP-REVIEW-2026-08.md` — none wired, a data-acquisition workstream). Therefore:
- Capture scenarios in this phase are computed **against the Phase-6 modeled buyer pool only, with no competing-inventory adjustment** — and every result must say so: `competitiveSupplyNote: 'Capture scenarios do not account for competing for-sale inventory or pipeline; no supply data source exists yet. A professional market study must supply the competitive set.'`
- **Do NOT add a placeholder `competitiveSupply` input** — an unused knob invites fake numbers. When a supply source ships (future phase), it arrives as its own dataset + a spec'd adjustment, not a free parameter.
- The only owner-enterable pacing assumptions are those specified below (`selloutMonths`, `distribution`, `poolGrowthAnnual`) — with `poolGrowthAnnual`'s production default **null**, per the Phase-6 all-null discipline.

## Phase-6 API contract (verified against merged #1403 — consume these exact shapes)

`EffectiveDemand` exports `{ STAGE_IDS, DEFAULT_ASSUMPTIONS, PROTECTED_LABEL, fromOwnershipNeed, run }`. A `run()` result carries:
- `effectiveDemand: number | 'not_available'` · `observedPool: number` · `unresolvedStages: string[]`
- `stages: [{ id, inputCount, share, outputCount, classification, assumptionClassification?, basis, verify? }]` — the fallout stage has `id: 'contract_fallout'` with its `share` (or `null`); read fallout from here and nowhere else.
- `byAmiBand / byUnitType / byBedroom`: maps of `{ value: number | 'not_available', classification, ...meta }` — divide against `.value`, never the wrapper object; AMI keys look like `'70-80'`; band meta includes `gapVsLocalPrice` and `assistanceRangeCheck` (pass through into capture cross-tab meta for report use).
- `sensitivity: {low, base, high} | null` — when present, run the capture arithmetic at all three pool values and report a capture sensitivity triple with the same keys.
- Assumption objects are `{ share, classification, basis, verify, sensitivity }` (verified key set).

## What you are building

**`js/project-market-study/forsale-capture.js`** (new, pure, dual-export) + **`test/forsale-capture.test.js`**.

```js
ForsaleCapture.run(scenarioDoc, funnelResult, pacing) → CaptureResult
ForsaleCapture.SELLOUT_SCENARIOS  // canonical: 24, 30, 36, 48 months
```

### Inputs
- `scenarioDoc` — a validated `project-scenario/v1` doc (units, mixes; `phasing` is currently null/owner-input — see below).
- `funnelResult` — a real Phase-6 `EffectiveDemand.run()` output. If `funnelResult.effectiveDemand === 'not_available'` (any unresolved stage), **every capture output is `not_available`** — capture math never runs on an unresolved funnel.
- `pacing` — `{ selloutMonths: 24|30|36|48 | custom int, distribution: 'even' | monthlyArray, poolGrowthAnnual: {share: null|number, classification, basis, verify: true} }`.

### Computations (per sellout scenario)
1. **Closings schedule** — `total_units` distributed over `selloutMonths` (`'even'` default: equal monthly closings with exact-remainder conservation, reusing the Phase-6 allocation discipline; a custom `monthlyArray` must sum to `total_units` or throw). Report monthly and annual closings.
2. **Gross contracts needed** — the funnel already applies `contract_fallout` (net). Gross contracts = closings ÷ (1 − falloutShare), where falloutShare is **read from the funnelResult's `contract_fallout` stage** — never a second input (double-count guard: a test asserts the module has no fallout parameter of its own). If the funnel's fallout stage is unresolved, gross contracts are `not_available` even when net closings are computable.
3. **Annual capture rate** = year-N closings ÷ buyer pool available in year N. The pool is the funnel's `effectiveDemand` **stock**; converting a stock to per-year availability requires `poolGrowthAnnual` (replenishment/turnover) — **its production default is `null`** (same all-null discipline as Phase 6): with null growth, year-1 capture is computable against the stock, but multi-year pools deplete (`pool − cumulative closings`, floored at 0) and the output must flag `poolDepletionModeled: true`. With a supplied growth share, pool replenishes annually (pool × (1+g) − cumulative closings).
4. **Total project penetration** = `total_units ÷ effectiveDemand` (the stock over the full period). **The denominator is always in the output** — `denominator: {value, basis: 'Phase-6 modeled effective demand', classification: 'modeled'}` — a capture number may never render without its denominator.
5. **Capture by AMI band / unit type / bedroom** — scenario units per cross-tab ÷ the funnel's corresponding cross-tab values (both already conserve totals). `not_available` propagates per-cell (e.g. the 100–120 band's observed-0 pool from the G2 limitation yields `not_available` — division by a zero pool is reported as `pool_zero_see_data_limitations`, never Infinity).
6. **Scenario set** — run all four canonical sellout paces plus any custom; label each `base/conservative/downside` only if the caller names them (no built-in judgment).

### What this module must NOT do
- **No acceptable-capture threshold.** No verdict labels (fundable/borderline/saturation-risk — that's the CHFA *rental* convention), no green/yellow/red classification, no "healthy" language. Output is numbers + denominators + caveats; judgment belongs to the analyst. A test greps for threshold/verdict vocabulary.
- **No demand math** — it consumes the funnel; it never adjusts shares.
- **No forecast framing** — every result carries `classification: 'modeled'`, a `scenarioLabel` with the "scenario, not a prediction" suffix, and the capture-humility caveat: *"Even professionally delineated market areas captured only 44% of actual applicants at the Fruita Mews benchmark; outside-area demand of 9–56% is documented. Treat capture scenarios as screening arithmetic, not achievable-sales claims."* (cite the calibration doc in a code comment).
- **No phasing invention** — if `scenarioDoc.phasing` is non-null someday it can seed the distribution, but while null the module uses only the caller's `pacing` and says so (`phasingSource: 'user_pacing — scenario phasing is an owner input pending'`).

## Hard rules (test-enforced or QA-bounced)
1. Unresolved funnel ⇒ all outputs `not_available` (never 0, never Infinity); per-cell propagation in cross-tabs.
2. Denominator object present on every capture/penetration figure.
3. Fallout read from the funnel stage only; no second fallout input (structural test: `run`'s pacing arg schema rejects a `fallout` key).
4. `poolGrowthAnnual` production default null; depletion flagged when modeled from stock.
5. Conservation: Σ monthly closings = `total_units` exactly, per scenario; Σ cross-tab capture numerators = total closings.
6. No threshold/verdict vocabulary (`fundable`, `saturation`, `borderline`, `healthy`, `red flag`, `%` cutoffs as judgments); no `forecast`; no CHFA rental threshold constants (25/35) as decision values.
7. Real-shape fixtures only: build test inputs via actual `ProjectScenario` + `EffectiveDemand.run` calls (the #1397 lesson).
8. Nothing outside the allowlist; `js/hna/` untouched; the existing ban tests must stay green (this PR must not weaken the boundary that keeps capture vocabulary out of the screening layer).

## File allowlist
`js/project-market-study/forsale-capture.js` (new) · `test/forsale-capture.test.js` (new) · `package.json` (`test:forsale-capture` after `test:effective-demand` in `test:ci`) · `README.md` inventory (+1 js file) · `data/_manifest.json` untouched (no data files). Nothing else.

## Tests required (house conventions; hand derivations on every pinned number)
- **Pinned arithmetic** on a real funnel output with illustrative resolved shares: 50 units / 30-month even pace → monthly closings 1.667-with-remainder (pin the exact integer-conserving schedule), year-1 closings 20, year-1 capture = 20 ÷ pool, penetration = 50 ÷ pool, gross contracts = closings ÷ (1 − funnel fallout share) — all recomputed by QA cold.
- Custom monthlyArray must sum to units (throw otherwise); even-distribution conservation exact.
- Unresolved-funnel cascade; fallout-unresolved → gross contracts `not_available` while net closings compute.
- Pool depletion path (null growth): multi-year pools floor at 0 with the flag; growth path replenishes.
- Zero-pool cross-tab cell → `pool_zero_see_data_limitations` (the G2 band), never Infinity/NaN.
- Denominator presence walked on every figure; humility caveat + scenario labels present.
- Vocabulary: banned-set grep (forecast/verdict/threshold terms) on the module; **and** assert `js/hna/ownership-decision-chain.js` ban test still passes (run it).
- Regression: `test:effective-demand`, `test:project-scenario`, `test:ownership-decision-chain`, `test:hna-ownership-need`, `test:file-manifest`, `validate` — exit 0.

## Delivery
One branch, one PR, squash. PR description: the pool-stock vs annual-availability design note, the fallout double-count guard, pinned derivations, and a "what this cannot say" section. **Do not merge — stop after opening the PR for Claude QA.**

## Acceptance criteria (Claude QA)
1. Pinned schedules/capture/penetration/gross-contracts match QA's cold recompute on real Phase-4+6 outputs; conservation exact.
2. Honesty mechanics: unresolved cascade, null growth default, depletion flag, per-cell zero-pool handling, denominator on every figure.
3. No thresholds/verdicts anywhere (grep + structural); humility caveat present; scenario labeling per convention.
4. Fallout single-sourcing verified structurally (QA injects a pacing.fallout key — must throw).
5. Sabotage: silence the denominator; port a 25% CHFA verdict; double-apply fallout; break closing conservation; drop the not_available cascade — each must fail the suite.
6. Allowlist + README + regression + full `test:ci` green.
