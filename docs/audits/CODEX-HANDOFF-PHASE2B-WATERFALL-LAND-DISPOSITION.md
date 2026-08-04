# Codex Handoff — Phase 2b: Resale/Subsidy Waterfall + Land-Disposition Comparison

**For:** Codex (implementer)
**QA:** Claude Code reviews the PR against the acceptance criteria at the bottom — pinned values are recomputed independently and sabotage checks are run, exactly as in the Phase 2a QA (PR #1390). Deviations from the file allowlist or guardrails bounce the PR.
**Date:** 2026-08-04
**Depends on:** PR #1390 (SharedEquityLifecycle) — **merged**. This phase consumes `js/project-market-study/shared-equity-lifecycle.js` and `js/hna/ownership-finance.js`; verify both exist on your branch before starting.
**Spec of record:** `docs/audits/SCOPING-FRUITA-COMMONS-REVISION-2-2026-08.md` §4 (Phase 2 row), §5.7 (land-disposition schema), §5.8 (waterfall); assignment §6 (land models) and §11 (waterfall) in the refinement; `docs/methodology/HOUSING-AUTHORITY-STRUCTURES-AND-POWERS.md` and `docs/methodology/LOCAL-JURISDICTION-HOUSING-CONTRIBUTIONS.md` for the tax/tenure background.
**Carry-over from the 2a QA (PR #1390 comment):** subsidy treatment in 2a is retention-only with the label "no separate recapture instruction was supplied" — **this phase supplies the recapture instruction.** 2a's `negativeEquity` flag is net-proceeds framing; this phase adds the distinct loan-vs-value concept (see waterfall outputs).

---

## What you are building

Two pure computation modules in the Tier-2 project layer:

1. **`js/project-market-study/resale-waterfall.js`** — a configurable **closing snapshot** (lien priority, combined LTV, buyer cash, recurring monthly cost, repayment conditions) and **resale waterfall** that distributes limited sale proceeds by priority, accounts for public subsidy **retained vs recaptured** (separately — never conflated), and derives the next buyer's position.
2. **`js/project-market-study/land-disposition.js`** — a structured comparison of land-control **Models A–D** (public retention/ground lease · discounted lot + covenant · full sale + deed restriction · master ground lease to a steward), producing the 15 assessment fields per model and the **engine inputs** each model implies (property-tax treatment, ground rent, price basis) — so a land choice flows into the lifecycle/finance math instead of staying prose.

Plus one dataset: **`data/policy/land-disposition-models.json`** (schema below).

No UI in this phase (comparison UI is Phase 8). No demand/capture (Phases 6–7).

## Hard rules (test-enforced or QA-bounced)

1. **The tool must not recommend a land model.** The Fruita hypothesis (Model A) is something the tool *tests*, not assumes. No ranking, no scores, no "recommended"/"best"/"preferred" language anywhere in the land module or dataset — a test greps for it. Output is comparison rows + labeled trade-offs; the human decides.
2. **Retention vs recapture are separate numbers.** `publicSubsidyRetainedInHome + publicSubsidyRecapturedAtSale === publicSubsidyAtClosing` exactly, always (a reconciliation test pins this).
3. **No double payment.** Each waterfall recipient is paid at most once; total distributions === resale price exactly (to the rounding dollar). A reconciliation test pins `sellingCosts + firstMortgagePayoff + ownerDownPaymentReturned + improvementCreditPaid + subordinatePaid + publicAppreciationSharePaid + ownerResidual === resalePrice`.
4. **Owner-net transparency rule (assignment §11):** when the configuration both recaptures the full subsidy AND takes a public appreciation share, the result MUST carry `ownerNetTransparencyWarning: true` with a plain-language note whenever `ownerNetProceeds < ownerDownPaymentReturned + totalOwnerCashInvested − ownerDownPaymentReturned` — i.e. whenever the owner walks away with less cash than they put in. The engine computes it; it never silently drops it.
5. **Shortfall honesty:** when proceeds cannot cover a step, later steps receive 0 (or partial), each step reports `paid` vs `owed` with `shortfall`, and the result carries `proceedsShortfall: true`. Never clamp silently. The distinct flag `loanExceedsValue` (first-mortgage balance > market value) is reported separately from 2a's net-proceeds `negativeEquity`.
6. **Property-tax truth (land module):** Model A/D tax treatment is `exempt_while_authority_owns` — the exemption **ends on fee-simple sale**; the buyer in Model B/C pays tax (possibly at restricted-value assessment, which is `VERIFY` with the county assessor). These treatments carry `verify: true` and an assessor/counsel note. Never present a tax outcome as settled law.
7. **Banned language** (same set as 2a, test-greps both new modules + dataset): `forecast`, `will appreciate`, `projected`, `capture rate`, `absorption`, `sellout`, `time-phasing` — plus, in the land module/dataset: `recommended`, `best model`, `preferred model`.
8. **Every output object** carries `classification: 'modeled'` (or `'user_entered'` where it echoes config) and, where scenario-dependent, the `scenarioLabel` passed through from the lifecycle result.
9. **No Fruita constants** in production files. No edits to any existing module or test.

## Module spec — `resale-waterfall.js`

```js
ResaleWaterfall.closingSnapshot(input) → ClosingResult
ResaleWaterfall.settle(lifecycleYearResult, config) → WaterfallResult
```

### closingSnapshot(input)
Input: `{ restrictedPrice, downPayment, firstMortgage: {principal, rateAnnual, termYears}, subordinateDebt: [{label, principal, interestRate, structure, termYears?, publicSource: bool, repaymentTrigger: 'sale'|'refinance'|'maturity'|'non_owner_occupancy'}], publicSubsidyAtClosing, monthlyCarrying: {hoaMonthly, groundRentMonthly, taxMonthly, insuranceMonthly, pmiMonthly} }`
Output: ordered `lienPriority[]` (first mortgage then subordinates in array order), `combinedLtv` (= (first + Σsubordinate)/restrictedPrice), `buyerCashAtClosing` (= downPayment), `publicSubsidyAtClosing`, `recurringMonthlyCost` (mortgage P&I + Σ amortizing subordinate payments + carrying), `repaymentConditions[]` (echoed per lien). All dollar outputs rounded; rates validated with the same decimal-rate guard convention as 2a (reuse the pattern, ≥1 throws).

### settle(lifecycleYearResult, config)
**Consumes a Phase 2a per-year result** (`resultAtYear` shape: `appraisalConstrainedPrice`, `remainingFirstMortgagePrincipal`, `subordinateBalances[]`, `unrestrictedMarketValue`, `capitalImprovementCredit`, `year`, `scenarioLabel`) — it does **not** recompute formulas or amortization.

`config`:
```js
{
  order: ['selling_costs','first_mortgage','owner_down_payment_return','improvement_credit',
          'subordinate_debt','public_appreciation_share'],   // default; reorderable; each key at most once
  sellingCostRate: 0.06,                    // OR sellingCosts fixed $ (one or the other)
  returnOwnerDownPayment: true|false,       // step 3 exists only when true
  ownerDownPayment: <$ from closing>,
  originalRestrictedPrice: <$>,             // appreciation base
  publicAppreciationShare: 0..1,            // share of max(0, resalePrice − originalRestrictedPrice); pays from remaining pool (min with remainder)
  subsidyRecovery: { countSubordinatePublicSources: true, countAppreciationShare: true },
      // which paid amounts count toward public-subsidy recovery (only items whose lien had publicSource: true)
  publicSubsidyAtClosing: <$>,
  nextBuyerPricing: 'formula' | 'ami_anchored',
      // 'formula' → nextBuyerRestrictedPrice = lifecycleYearResult.appraisalConstrainedPrice
      // 'ami_anchored' → nextBuyerRestrictedPrice = lifecycleYearResult.nextBuyerMaxAffordablePrice
  totalOwnerCashInvested: <$>,              // down payment + improvements (for the transparency rule)
}
```

**Semantics (the part that must be exact):** the waterfall is a **priority distribution of a limited pool** starting at `pool = appraisalConstrainedPrice`. Steps consume in `order`; a step receives `min(owed, remaining pool)`; the owner's residual is whatever remains after the last configured step. `ownerNetProceeds = ownerDownPaymentReturned + improvementCreditPaid + ownerResidual`. Then subsidy accounting: `publicRecovery` = Σ paid amounts flagged into recovery by `subsidyRecovery`; `publicSubsidyRecapturedAtSale = min(publicRecovery, publicSubsidyAtClosing)`; `publicSubsidyRetainedInHome = publicSubsidyAtClosing − recaptured` (floor 0); recovery beyond the subsidy is reported as `publicAppreciationGain`. Finally: `nextBuyerRestrictedPrice` per `nextBuyerPricing`, `additionalSubsidyRequiredForNextBuyer = max(0, nextBuyerRestrictedPrice − lifecycleYearResult.nextBuyerMaxAffordablePrice)` (0 by construction for `ami_anchored`).

**Worked reference example (pin this exact case as a test — full derivation in a comment):**
Lifecycle year-10 result: price 520,000; first-mortgage balance 206,667 (0% loan); one deferred public subordinate 50,000; improvement credit 5,000. Config: default order, selling 6%, return 40,000 down payment, appreciation share 25% of (520,000 − 400,000), subsidy 100,000, both recovery flags true.
Pool: 520,000 → selling 31,200 → 488,800 → first 206,667 → 282,133 → down-payment return 40,000 → 242,133 → improvement credit 5,000 → 237,133 → subordinate 50,000 → 187,133 → public share min(30,000, 187,133) = 30,000 → **owner residual 157,133**.
`ownerNetProceeds = 40,000 + 5,000 + 157,133 = 202,133`. `publicRecovery = 50,000 + 30,000 = 80,000` → `recaptured 80,000`, `retainedInHome 20,000`, `appreciationGain 0`. Reconciliation: 31,200+206,667+40,000+5,000+50,000+30,000+157,133 = 520,000 ✓.

Also pin: a **shortfall case** (declining market: pool too small to reach the subordinate step → subordinate `shortfall > 0`, owner residual 0, `proceedsShortfall: true`, retained+recaptured still sums to the subsidy) and a **transparency-warning case** (full recapture + large share leaving the owner below cash-in).

## Module spec — `land-disposition.js`

```js
LandDisposition.MODELS               // from data/policy/land-disposition-models.json
LandDisposition.assess(modelId, params) → AssessmentResult
LandDisposition.engineInputs(modelId, params) → { propertyTaxRate, propertyTaxTreatment, groundRentMonthly,
                                                  groundRentEscalationRate, priceIncludesLand, landBenefitPerUnit }
LandDisposition.compare(params) → one AssessmentResult per model (NO ranking, NO ordering by merit)
```

`params`: `{ landValuePerUnit, groundRentMonthly, groundRentEscalationRate, marketPropertyTaxRate, restrictedValueAssessment: bool, unitPrice }`.

**Computed per model:** `initialPerUnitAffordabilityBenefit` (A/D: `landValuePerUnit` excluded from price basis; B: the discount amount = user-entered share of land value; C: 0 unless a write-down is entered) and the `engineInputs` that feed OwnershipFinance/SharedEquityLifecycle (A/D: `propertyTaxTreatment: 'exempt_while_authority_owns'` → improvements-basis rate with `verify: true`; ground rent flows through; B/C: full or restricted-value rate, `verify: true`).

**Assessed (qualitative, from the dataset — labeled, not scored):** the 15 fields of assignment §6 — appraised-value treatment, buyer mortgageability, property-tax implication, ground-rent burden, future affordability, public control, foreclosure exposure, resale administration, steward replaceability, public-subsidy preservation, administrative cost, buyer acceptance, legal-document complexity, failure risk (steward/project), initial benefit. Every legal/lender/appraisal field carries `verify: true` + the responsible validator (`appraiser`, `lender`, `assessor`, `attorney`, `administrator`).

### Dataset — `data/policy/land-disposition-models.json`
```jsonc
{ "schema": "land-disposition-models/v1",
  "meta": { "as_of": "…", "note": "Comparison inputs only; the tool does not rank or recommend a model.",
            "source_verification_note": "Legal, tax, lender, and appraisal treatments are VERIFY until confirmed by the named validator." },
  "models": [ { "id": "model_a_public_land_retention", "label": "Public land retention (99-yr ground lease / CLT-style)",
      "price_includes_land": false, "property_tax_treatment": "exempt_while_authority_owns",
      "assessments": { "appraised_value_treatment": {"value": "leasehold_interest", "verify": true, "validator": "appraiser"},
                        "buyer_mortgageability": {"value": "lender_program_dependent", "verify": true, "validator": "lender"},
                        /* …all 15 fields, each {value, verify, validator, note?} … */ } },
    /* model_b_discounted_lot_covenant, model_c_full_sale_deed_restriction, model_d_master_ground_lease */ ] }
```
Populate all four models × 15 fields. Use enumerated values + notes, not free-flowing prose. Cite `HOUSING-AUTHORITY-STRUCTURES-AND-POWERS.md` / `LOCAL-JURISDICTION-HOUSING-CONTRIBUTIONS.md` semantics for the tax fields.

## File allowlist (exact expected diff)

- `js/project-market-study/resale-waterfall.js` (new)
- `js/project-market-study/land-disposition.js` (new)
- `data/policy/land-disposition-models.json` (new)
- `test/resale-waterfall.test.js`, `test/land-disposition.test.js` (new)
- `package.json` — `test:resale-waterfall` + `test:land-disposition`, inserted into `test:ci` immediately after `test:shared-equity-lifecycle`
- `README.md` — inventory line 259 → **261** (run `node scripts/compute-inventory.mjs` to confirm)
- Nothing else. No UI, no edits to existing modules/tests/data.

## Tests required (plain Node `assert`, 2a conventions; show hand derivations for every pinned number)

**Waterfall:** the worked reference example above, pinned end-to-end; reconciliation invariant (distributions sum to price) on 20+ randomized configs (seed the randomness deterministically — no `Math.random()`; derive cases from a fixed array); retained + recaptured === subsidy always; shortfall case (partial payment, `proceedsShortfall`, `shortfall` per step, owner residual 0); `loanExceedsValue` distinct from net-proceeds negative equity; transparency-warning fires on full-recapture+share and does NOT fire on either alone; reorderable `order` changes who absorbs a shortfall (pin one reordered case); duplicate step key throws; `returnOwnerDownPayment: false` removes the step; `nextBuyerPricing: 'ami_anchored'` yields `additionalSubsidyRequiredForNextBuyer === 0`; integration: `settle` on a REAL `SharedEquityLifecycle.project` year-result (not a hand-built stub).
**Land:** all four models return all 15 assessment fields with `{value, verify, validator}`; Model A/D `engineInputs` produce tax-exempt-while-retained treatment + ground-rent passthrough; Model C passes the market tax rate; `restrictedValueAssessment` flag switches B/C treatment; `initialPerUnitAffordabilityBenefit` arithmetic pinned for each model; `compare()` output order is dataset order (not merit order) and contains no `score`/`rank` field; banned-language + no-recommendation grep over both modules and the dataset; integration: `engineInputs` fed into `SharedEquityLifecycle.project` changes `monthlyHousingCost` in the expected direction (ground rent up → cost up; tax-exempt → cost down).
**Wiring:** package.json self-check (both scripts exist + in `test:ci` in order).

## Delivery

One branch, one PR against `main`, squash convention. PR description: summary, the worked waterfall derivation, ordering-semantics choices stated explicitly, known limitations, owner decisions needed. Before opening: `npm run test:resale-waterfall && npm run test:land-disposition && npm run test:shared-equity-lifecycle && npm run test:ownership-finance && npm run validate && node scripts/compute-inventory.mjs` — all by exit code. **Do not merge — stop after opening the PR for Claude QA.**

## Acceptance criteria (Claude QA judges exactly this)

1. The worked reference example matches QA's independent cold recomputation, line by line.
2. Reconciliation invariants hold on QA's own adversarial configs (shortfalls, zero pools, reordered steps, 100% appreciation share).
3. Retention vs recapture always sum to the subsidy; never conflated; `publicAppreciationGain` separated.
4. Transparency warning fires exactly per rule 4; sabotaging it out fails the suite.
5. Land module: no ranking/recommendation anywhere (grep + structural check for score/rank fields); all VERIFY fields carry validators; engine-input integration moves lifecycle outputs in the correct direction.
6. File allowlist respected; README inventory current; existing tests untouched and green; `test:ci` chain green.
7. Sabotage checks QA will run: double-pay the subordinate step; flip retained/recaptured; remove the transparency warning; add a `rank` field to the dataset; break the reconciliation sum — the new suites must fail each time.
