# Scoping — Fruita Commons For-Sale Market Study & Reusable Homeownership Analysis Module (Phase 0)

**Type:** Phase 0 architecture audit — scope only, no production code changed.
**Author:** Claude Code (QA/architecture)
**Date:** 2026-08-03
**Repo:** `pggLLC/Housing-Analytics` · site: `cohoanalytics.com`
**Grounding:** direct current-HEAD read of the ownership stack + `docs/methodology/AFFORDABLE-OWNERSHIP-METHODOLOGY.md`, `docs/audits/SCOPING-OWNERSHIP-DECISION-CHAIN-1167-2026-07.md`, `docs/audits/OWNERSHIP-BENCHMARK-EPS-PHASE2-2026-07.md`, `docs/audits/CALIBRATION-FRUITA-MEWS-PMA-2026-07.md`, `docs/audits/CODEX-HANDOFF-AFFORDABLE-OWNERSHIP.md`.

> **Scope note.** This document does not modify any production application file. It inspects and traces the existing architecture and recommends how to extend it. Every file, function, and line reference below was verified against current HEAD (branch `agent/durango-brief-1360`, ownership modules last touched by #1302 / #1294).

---

## 1. Executive recommendation

**PROCEED TO PHASE 1**, scoped as a **shared project-level ownership financial engine** that consolidates the *three* divergent affordability formulas already in the repo behind one authoritative, tested calculation path — with a strict backward-compatibility contract that leaves `HNAOwnershipNeed.maxAffordablePrice()` behaving bit-for-bit identically. Everything else (demand funnel, capture/absorption, expanded shared-equity lifecycle, Fruita scenario, report export) is deferred to later phases and must live in a **new `project-market-study` layer that consumes ownership outputs but never writes forecasting/capture language back into the HNA screening modules.**

The repository is much further along than a greenfield exercise would assume. The five "core" files named in the assignment all exist and are wired end-to-end: `HNAOwnershipNeed.maxAffordablePrice()` → `DealCalculator.computeForSaleFeasibility()` → `computeDeveloperOwnershipFundingStack()` → `OwnershipResale.evaluateAll()`, assembled by `OwnershipDecisionChain.build()`. The consumer/developer separation the assignment asks us to preserve is already real and already test-enforced. The semantic guardrails ("potential buyer pool … not committed demand", the banned-phrase ban) already exist and are protected by tests.

The single most important architectural fact for this effort: **the entire PMA / market-analysis / "capture" stack is LIHTC-rental by construction.** "Capture rate" everywhere in the codebase means *proposed rental units ÷ income-qualified renter households*. Reusing that vocabulary or those denominators for a for-sale study would be a category error and would trip existing guardrails. A for-sale capture/absorption model must be a **parallel, separately-labeled module**, reusing only the product-agnostic geometry and scaffolding.

The three blockers below are *methodology decisions*, not code problems, and are why Phase 1 is deliberately small.

---

## 2. Verified current architecture

### 2.1 File existence & role confirmation

Every file named in the assignment exists. Two data files are **empty (0 bytes) and referenced by the methodology doc as county sources — a live latent bug:**

| File | Lines | Verified role | Status |
|---|---:|---|---|
| `js/hna/hna-ownership-need.js` | 599 | HNA ownership screening + `maxAffordablePrice`, `incomeNeededForHomeValue`, `ownerValueSupplySeries`, `priceBandDemandScreen` | ✅ as described |
| `js/deal-calculator.js` | 5743 | `computeForSaleFeasibility` (:167), developer funding stack (:260), resale bridge (:208) | ✅ |
| `js/deal-calculator-math.js` | 29 | `mortgageConstant`, `computeApplicableFraction` (LIHTC) — **not used by the ownership path** | ⚠️ see §6 |
| `js/hna/ownership-decision-chain.js` | 197 | Developer-facing chain assembly (HTML stages) | ✅ |
| `js/hna/ownership-resale.js` | 125 | Resale conventions: fixed-simple, lesser-of, shared-appreciation | ✅ (preliminary — §9) |
| `js/components/homeownership-programs.js` | 129 | **Consumer** homebuyer cards (separate lane) | ✅ |
| `js/components/subject-capture-stack.js` | 244 | **CHFA rental** capture (renter HHs denominator) | ⚠️ rental, not for-sale |
| `js/affordability-metrics-panel.js` | 381 | County affordability ratios — **its own divergent formula** | ⚠️ duplicate (§6/§7) |
| `data/policy/resale-conventions.json` | 60 | 3 conventions, WMRHC default | ✅ |
| `data/policy/developer-ownership-funding.json` | 80 | 3 developer programs (EPS Table 12) | ✅ |
| `data/policy/homeownership-programs.json` | 262 | Consumer DPA/first-buyer programs | ✅ |
| `data/policy/county-ownership.json` | 128 | Public parcels + CLT orgs by county (vintage 2025) | ✅ |
| `data/hna/ownership-need.json` | 12592 | `hna-ownership-need/v1` precomputed records | ✅ |
| `data/hna/home-value-cascade.json` | 4782 | `{places, counties, review_flags}` ZHVI cascade | ✅ (now has `counties`) |
| `data/hna/place-chas.json` | 54166 | CHAS place records | ✅ |
| `data/hna/chas_affordability_gap.json` | 1 (166 KB) | County CHAS `{meta,state,counties}` — **populated (minified)** | ✅ (see correction) |
| `data/market/chas_co.json` | 1 (162 KB) | **populated (minified)** | ✅ (see correction) |
| `data/co_ami_gap_by_place.json` / `_by_county.json` | 30419 / 4017 | B25118 renter demand + gap | ✅ |
| `data/market/redfin_place_market_tracker_co.json` | 54160 | `{meta, places}` | ✅ |
| `data/market/fhfa_hpi_subcounty_co.json` | 17921 | `{meta, counties, tracts, places}` HPI | ✅ |
| `data/market/acs_tract_metrics_co.json` | 50671 | ACS tract metrics | ✅ |

**Finding A0 — RETRACTED (QA 2026-08-04).** An earlier draft of this audit reported these two files as "0 bytes / empty blocker." **That was wrong** — it came from misreading `wc -l` (both files are **minified single-line JSON with 0 newlines but 166 KB / 162 KB of content**). `chas_affordability_gap.json` parses to `{meta, state, counties}` and is fully populated; `chas_co.json` likewise. There is **no empty-file blocker.** This correction is retained deliberately as a QA-integrity note and is an object lesson in the repo's own memory rule (verify against reality, not line counts).

### 2.2 The end-to-end call graph (as built today)

```
HNAOwnershipNeed.computeOwnershipNeed(input)        [hna-ownership-need.js:449]
  ├─ maxAffordablePrice(ami, pct, assumptions)      [:265]  ← the ONE reused affordability kernel
  ├─ affordabilityTest → market-attainable|stretch|priced-out  [:292]
  ├─ ownerValueSupplySeries (ACS B25075)            [:158]
  └─ priceBandDemandScreen                          [:349]  label = "potential buyer pool … not committed demand"

DealCalculator.computeForSaleFeasibility(input)     [deal-calculator.js:167]
  ├─ maxAffordablePrice(...)  ← REUSES HNAOwnershipNeed helper (input.maxAffordablePrice || window.HNAOwnershipNeed.maxAffordablePrice)  [:173]
  ├─ subsidyGapPerUnit = max(0, tdcPerUnit − maxSalePrice)   [:187]
  ├─ computeDeveloperOwnershipFundingStack(...)     [:260]  greedy gap fill from developer-ownership-funding.json
  └─ computeOwnershipResale(...) → OwnershipResale.evaluateAll()  [:208]

OwnershipDecisionChain.build(result, options)       [ownership-decision-chain.js:110]
  └─ computeFeasibility() calls window.__DealCalc.computeForSaleFeasibility  [:62]
     → 5 HTML stages (site/price, demand-by-band, per-unit gap, funding stack, resale)
```

This is a clean, layered design. `maxAffordablePrice` is the shared kernel and is **already** reused across the HNA screen and the Deal Calculator via dependency injection (`input.maxAffordablePrice` with a `window.HNAOwnershipNeed` fallback). **Do not fork it.**

### 2.3 Guardrails confirmed present and test-enforced

- **Consumer vs developer separation** is real: `homeownership-programs.js` header (`:3`) says "consumer-facing"; the developer stack reads `developer-ownership-funding.json` only. `test/ownership-decision-chain.test.js:110,113-114` assert the chain and Deal Calc never read consumer data and that `homeownership-programs.json` stays byte-identical.
- **Banned-language ban** lives in `test/ownership-decision-chain.test.js:111-126`: it lowercases `js/hna/ownership-decision-chain.js` and asserts absence of `forecast`, `time-phasing`, `time phasing`, `capture rate`, `capture rates`. **Nuance for planning:** the needle is space-separated `capture rate`; **hyphenated `capture-rate` is NOT caught**, and `sales-forecast` is caught only transitively via `forecast`. A parallel, stronger ban over `hna-ownership-need.js` lives at `test/hna-ownership-need.test.js:351-368` (adds `qualified buyer(s)`, `mortgage-ready`, `buyer qualification`, `guaranteed demand`, `investment opportunity`, `absorption forecast`, `homeownership prediction`). `test/ownership-resale.test.js:141-144` bans `forecast`, `projected`, `will appreciate` in the resale module.
- **Screening caveat** is present in every ownership module as a `SCREENING_CAVEAT` constant and rendered on every decision-chain stage (`ownership-decision-chain.test.js:105-108`).

---

## 3. Existing-function lineage (targeted audit — assignment §F)

Legend: **units** = dollars unless noted; **rounding** noted per function; **UI consumers** = where the output is rendered.

### 3.1 Max affordable purchase price
- **File/fn:** `js/hna/hna-ownership-need.js:265` `maxAffordablePrice(ami4Person, amiPct, assumptions)`
- **Inputs:** `ami4Person` ($), `amiPct` (decimal, e.g. 0.80); `assumptions` merged over `CONSTANTS.affordabilityAssumptions` (rate 0.065, term 30, down 0.10, propTax 0.0065, ins 0.0035, PMI 0.005, front-end 0.30).
- **Method:** `monthlyBudget = income*0.30/12`; `monthlyCostPerDollar = loanShare*mortgageFactor + (tax+ins)/12 + loanShare*pmi/12`; price = budget ÷ costPerDollar. `loanShare = 0.90`.
- **Output:** price ($), `round(...,0)`. Returns `null` if income is 0/NaN.
- **Assumptions/weakness:** PMI applied **unconditionally** (no LTV>80% gate — benign here at 10% down, but wrong if down payment ever ≥20%); no HOA, no closing costs, no buyer existing debt, no back-end DTI; front-end 30% only. Property tax rate is a single statewide 0.65% (no county rate, unlike `AFFORDABILITY-METHODOLOGY.md`).
- **Validation/tests:** `test/hna-ownership-need.test.js:266-269` (`maxAffordablePrice(100000,0.80)==289983`, hand-checkable).
- **UI consumers:** HNA ownership section; Deal Calculator for-sale mode; decision chain; resale affordability benchmark.
- **Duplicate implementations:** **YES — three** (see §6). This is the authoritative one and the only one that should survive as the kernel.

### 3.2 Income required for a home value
- **File/fn:** `hna-ownership-need.js:313` `incomeNeededForHomeValue(homeValue, assumptions)` — binary-search inversion of `maxAffordablePrice` at 100% AMI (32 iterations, `round(...,0)`).
- **Duplicates:** `HNAUtils.computeIncomeNeeded(homeValue)` (`js/hna/hna-utils.js:1137`, closed-form from `AFFORD`); `requiredIncome()` in `js/hna/hna-comparison.js:434` (per test coverage agent, tested only in `test/phase3-comparison-ideas.test.js`). **Three code paths, two assumption sets.**
- **Tests:** `incomeNeededForHomeValue` has **no direct test** in the 8 audited ownership tests (coverage gap #2).

### 3.3 Home affordability classification
- **File/fn:** `hna-ownership-need.js:292` `affordabilityTest(amiGapEntry, homeValueEntry, assumptions)` → `market-attainable | stretch | priced-out` vs `max80`/`max100`. Skips entries flagged by `isFlaggedHomeValue` (`:284`). `method: 'MODELED'`.
- **Tests:** `test/hna-ownership-need.test.js:250-264` (all three classes + null on missing value).

### 3.4 Price-band demand screen
- **File/fn:** `hna-ownership-need.js:349` `priceBandDemandScreen(amiGapEntry, ownerValueSupply, chas, assumptions)`. Rows: `lte80`, `81to100`, `101to120`. `potentialBuyerPoolHouseholds` = renter CHAS band totals; `ownerValueSupplyUnits` from B25075; `currentGapHouseholds = max(0, pool − supply)`. Flags: `screeningOnly:true`, `noConversionMultiplierApplied:true`. Label = `PRICE_BAND_SCREEN_LABEL` (the protected string).
- **Weakness:** the 101-120% row has empty `demandBands` (CHAS cannot split above 100% HAMFI) → pool always 0 there; documented in the row caveat.
- **Tests:** `test/hna-ownership-need.test.js:311-338` (incl. `noConversionMultiplierApplied===true`).

### 3.5 Owner-value supply by price range
- **File/fn:** `ownerValueSupplySeries(profile, options)` (`:158`, ACS B25075 25 bins) + `supplyUnitsInPriceRange(supply, lowerExcl, upperIncl)` (`:330`, overlap sum). `dataQuality` High/Medium by bin completeness. `source:'ACS B25075'`.
- **Tests:** `test/hna-ownership-need.test.js:271-285`.

### 3.6 For-sale TDC per unit
- **File/fn:** `deal-calculator.js:185` `tdcPerUnit = tdc/units` inside `computeForSaleFeasibility`. **User-entered TDC**; no cost build-up (hard/soft/land/fee).
- **Tests:** `test/deal-calc-for-sale-feasibility.test.js:122`.

### 3.7 Max affordable sale price
- **File/fn:** `deal-calculator.js:186` `maxSalePrice = maxAffordablePrice(ami4Person, targetAmiPct, input.assumptions)` (default targetAmiPct 0.80). **Delegates to §3.1** — good.
- **Tests:** `deal-calc-for-sale-feasibility.test.js:121` asserts equality with the HNA helper; `:197` no fabricated price when AMI missing.

### 3.8 / 3.9 Per-unit & total subsidy gap
- **File/fn:** `deal-calculator.js:187-197`: `rawGapPerUnit = tdcPerUnit − maxSalePrice`; `subsidyGapPerUnit = max(0, raw)`; `totalSubsidyGap = subsidyGapPerUnit*units`; `surplusPerUnit = max(0,−raw)`.
- **Tests:** `deal-calc-for-sale-feasibility.test.js:123-124`.

### 3.10 Developer funding stack
- **File/fn:** `deal-calculator.js:260` `computeDeveloperOwnershipFundingStack(feasibility, {units, programs})`. Greedy fill of the gap from **active** programs; `_developerFundingAmountPerUnit` (`:240`) handles `fixed_dollar_cap` and `percent_purchase_price` (basis = TDC or max-sale-price). Non-quantified programs → `verifySources` (VERIFY, not counted). Output: `appliedAmountPerUnit`, `residualGapPerUnit`, applied/verify lists.
- **Weakness:** greedy order = array order (no priority/eligibility logic); `apply_to_gap` and `status:active` are the only gates.
- **Tests:** `deal-calc-for-sale-feasibility.test.js:125-132,175-178` (applied ≤ gap; residual; VERIFY sources).

### 3.11-3.16 Resale / shared-equity
- **File:** `js/hna/ownership-resale.js`.
- **3.11 Fixed simple cap** `fixedSimpleCap(price,years,rate)=price*(1+r*hold)` (`:26`). Tests `ownership-resale.test.js:71-82`.
- **3.12 Lesser-of-fixed-or-CPI** (`evaluateConvention` type `lesser_of_fixed_cpi`, `:70`): uses the **fixed leg only as a conservative upper bound**; CPI leg is `VERIFY` — no CPI path estimated. `verifyParameter=true`. Tests `:84-94`.
- **3.13 Shared-appreciation** `sharedAppreciationCap(price, appreciation, share, sellingCosts)=price + share*appreciation + costs` (`:34`). Tests `:96-108`.
- **3.14 Remaining principal** — **input only** (`:62`), never computed. An amortization/remaining-balance routine exists at `deal-calculator.js:3348-3393` but is **not** wired to resale and **not** tested there. **Gap.**
- **3.15 Owner gross equity** `equity = cap − remainingPrincipal − sellingCosts` (`:81`). Tests `:81,107`.
- **3.16 Affordability-preservation comparison** `preserves = cap <= affordabilityBenchmark` where benchmark = `maxAffordablePrice(ami, targetAmiPct)` (`:82-83`). Compares resale cap to **today's** AMI-affordable price only (no future AMI/CPI path). Tests `:82,124-126` — but **only on the `fixed_simple` path**.

**Lineage summary:** 13 of 16 calculations have direct test coverage. Gaps: **#2 income-required** (tested elsewhere, not in ownership suite), **#14 remaining-principal** (input only, real amortization untested for resale), and **#16 preservation on non-fixed conventions**.

---

## 4. Existing-data lineage

| Dataset | Shape (verified) | Provenance today | Consumers | Note |
|---|---|---|---|---|
| `data/hna/ownership-need.json` | `{schema:'hna-ownership-need/v1', generated_from, records}` | precomputed from CHAS/AMI/home-value | HNA render/export | regenerate when inputs change |
| `data/hna/home-value-cascade.json` | `{meta, places, counties, review_flags}`; place entry `{value, source:'zhvi', as_of, confidence, zillow_region_id, acs_raw_value}` | ZHVI cascade w/ ACS fallback | affordabilityTest, affordability panel | **now has `counties`** — the F4 gap from #1167 §0 is closed |
| `data/hna/place-chas.json` | places[geoid] w/ `summary`, `renter_hh_by_ami`, `owner_hh_by_ami`, `acs_anchor`, `low_confidence` | HUD CHAS 2018-2022 | ownership need | acs_anchor cap (see memory) |
| `data/hna/chas_affordability_gap.json` | **empty** | — | methodology names it | **A0 blocker** |
| `data/co_ami_gap_by_{place,county}.json` | B25118 renter demand + gap; **sign conventions load-bearing** | Census B25118 | rental gap context, capture stack | never `abs()` a gap |
| `data/market/redfin_place_market_tracker_co.json` | `{meta, places}` | Redfin tracker | (available; wire-in candidate for market price) | for-sale price signal |
| `data/market/fhfa_hpi_subcounty_co.json` | `{meta, counties, tracts, places}` | FHFA HPI (#1255) | (price anchor candidate) | public-domain |
| `data/market/acs_tract_metrics_co.json` | tract metrics | ACS | PMA/market analysis | rental-oriented today |
| `data/policy/resale-conventions.json` | `ownership-resale-conventions/v1`, 3 conventions, `default_convention:fixed_simple` | WMRHC/APCHA/Elevation, verified URLs | OwnershipResale | 2 params VERIFY |
| `data/policy/developer-ownership-funding.json` | `developer-ownership-funding/v1`, 3 programs | EPS Table 12 | funding stack | consumer dataset cross-linked, kept separate |
| `data/policy/homeownership-programs.json` | consumer programs (federal/colorado/metro) | official pages | consumer page only | **keep out of developer path** |
| `data/policy/county-ownership.json` | `counties[fips].{publicParcels, cltOrganizations}` vintage 2025 | County assessor GIS | (site/land context) | Fruita/Mesa `08077` land inputs |

---

## 5. Reuse-vs-refactor decisions

| Component | Decision | Rationale |
|---|---|---|
| `maxAffordablePrice` kernel | **Reuse, extend behind flags** | Already the shared kernel; injected into Deal Calc. Extend via an **options object** (add HOA/closing/DTI/PMI-gate) that defaults to today's values so existing callers are unchanged. |
| `computeForSaleFeasibility` | **Reuse, extend** | Correct per-unit gap. Add cost build-up and buyer-cash outputs as **new fields**, never change existing field meanings. |
| `OwnershipResale` | **Refactor/expand into a lifecycle engine (Phase 2)** | Today it screens caps at one holding period vs today's price. Lifecycle needs time paths, subsidy waterfall, future-buyer affordability. |
| `affordability-metrics-panel.js` `compute()` | **Deprecate its private formula; delegate to kernel** | Divergent assumptions (FRED ~7%, PITI×1.25 proxy, requiredHHI). County display can keep its ratios but should call the kernel for `required_hhi_for_home`. |
| `HNAUtils.computeIncomeNeeded` / `hna-comparison.requiredIncome` | **Consolidate to `incomeNeededForHomeValue`** | Three inversions of the same math; converge on the tested one. |
| PMA capture/absorption (`subject-capture-stack`, `simulateCapture`, `calculateAbsorptionRisk`) | **Do NOT reuse for demand** | Rental/LIHTC denominators. Build a **parallel** for-sale module. |
| PMA geometry, `market-analysis-utils/state`, `site-comparison`, confidence scaffold, `buildCompetitiveSet` radius/merge plumbing | **Reuse as-is** | Product-agnostic (per PMA trace). |
| `deal-calculator-math.js` | **Leave for LIHTC** | `mortgageConstant`/`computeApplicableFraction` are LIHTC; ownership path uses `monthlyMortgageFactor` in `hna-ownership-need.js`. Do not merge. |
| Provenance | **Extend `source-badge` enum + `data/provenance/*.json`** | §13. |

---

## 6. Financial-engine gap matrix (assignment §G)

Baseline capability of the **authoritative kernel** (`maxAffordablePrice`) + `computeForSaleFeasibility`. "Elsewhere" = present in another file with different assumptions.

| Capability | Status | Evidence |
|---|---|---|
| % property tax | ✅ supported (0.0065 fixed) | `hna-ownership-need.js:279` |
| Fixed-$ property tax | ❌ unsupported | only a % rate |
| % insurance | ✅ (0.0035) | `:279` |
| Fixed-$ insurance | ❌ | — |
| Fixed HOA | ❌ unsupported in kernel | not modeled (methodology `:167` notes HOA default $0 elsewhere) |
| Escalating HOA | ❌ | — |
| Fixed ground rent | ❌ | — |
| Escalating ground rent | ❌ | — |
| PMI | ⚠️ partial — applied **unconditionally**, no LTV>80% gate | `:280` (vs gated in `hna-utils.js:1150`) |
| Existing borrower debt | ❌ | no back-end DTI |
| Housing-only DTI (front-end) | ✅ (0.30) | `:275` |
| Total DTI (back-end) | ❌ unsupported in kernel; **43% appears in `AFFORDABILITY-METHODOLOGY.md`/`api-integrations.js`** | duplicate model, §7 |
| Mortgage term | ✅ (30) | `:277` |
| Interest rate | ✅ (0.065) | `:269` |
| Down payment | ✅ (0.10) | `:271` |
| Closing costs | ❌ | — |
| Required reserves | ❌ | — |
| Subordinate financing | ⚠️ **supported elsewhere** — resale takes `remainingPrincipal`; funding stack layers sources — but not in the buyer-qualification kernel | resale `:62`; stack `:260` |
| Multiple first-mortgage products | ❌ | single product |
| Maximum loan | ⚠️ derived implicitly (price×loanShare); not returned | — |
| Maximum purchase price | ✅ (the kernel output) | `:281` |
| Required household income | ✅ via `incomeNeededForHomeValue`; ⚠️ **duplicated** in `affordability-metrics-panel.js:100` and `hna-utils.js:1153` | §3.2 |
| Buyer cash required (down+closing) | ❌ | not computed anywhere in the ownership path |
| Negative capacity handling | ✅ (`max(0,...)` on gap; `null` on 0 income) | `deal-calculator.js:188`, `hna-ownership-need.js:267` |
| Zero-interest handling | ✅ | `monthlyMortgageFactor` `:261` returns `1/n` when `r==0`; `deal-calculator-math.js:15` returns 0 |
| Consistent % input format | ⚠️ **risk** — kernel uses decimals (0.065); `affordability-metrics-panel.js` uses whole-number FRED rate (7.0) then `/100` (`:94`) | mixing hazard |

**Authoritative path recommendation:** one engine, `js/hna/ownership-finance.js` (new, pure), exporting `maxAffordablePrice`/`incomeNeeded`/`monthlyPITI`/`buyerCashRequired` with an **options object** whose defaults reproduce today's `CONSTANTS.affordabilityAssumptions`. `hna-ownership-need.js` re-exports from it for backward compatibility; Deal Calc, the affordability panel, and `hna-utils` delegate to it. **Backward-compatibility contract:** existing `maxAffordablePrice(ami, pct)` with no options must return the exact same number (locked by a golden-value test using the existing `289983` fixture).

---

## 7. Duplicate-formula register (critical)

There are **three divergent homeownership-affordability formulas** in production:

1. **Ownership kernel** — `hna-ownership-need.js:265` + `HNAUtils.AFFORD` (`hna-utils.js:39`): 6.5%, 30yr, **10% down**, tax 0.65%, ins **0.35%**, PMI 0.5%, **front-end 30%**. The ownership module keeps its **own copy** of these numbers in `CONSTANTS.affordabilityAssumptions` (`:63-73`) rather than importing `AFFORD` — a **drift risk** (methodology doc claims they are shared).
2. **Affordability metrics panel** — `affordability-metrics-panel.js:83`: **FRED rate (~7% fallback)**, **PITI = P&I × 1.25 proxy** (no explicit tax/ins/PMI), `requiredHHI = annualPITI/0.30`, plus a crude affordability-rate proxy (`:104`).
3. **`docs/AFFORDABILITY-METHODOLOGY.md` + `js/api-integrations.js`**: **20% down**, 6.5%, tax 0.65%, ins **0.85%**, **43% back-end DTI**, HOA $0, county-specific tax rates, two scenarios (20%/5% down).

These will produce materially different "required income" and "priced-out %" numbers for the same home. **Before any Fruita priced-out figure ships, pick one model.** The kernel (model 1) is the tested, guardrailed, most-reused one and should win; models 2 and 3 should delegate to it (model 3's county tax rates and two-scenario down-payment idea are worth folding into the kernel's options).

---

## 8. Demand-funnel data matrix (assignment §H)

Start from `priceBandDemandScreen` (already labels renters "potential buyer pool … not committed demand", applies **no** conversion multiplier). The funnel must keep observed and modeled stages visually and structurally distinct.

| Funnel stage | Class | Source today | Available? |
|---|---|---|---|
| Total households | observed | CHAS/ACS place-chas | ✅ |
| Households by income band | observed | `place-chas.json` `*_hh_by_ami` (5 HAMFI bands only) | ✅ |
| Renter HHs by income band | observed | `renter_hh_by_ami` | ✅ |
| Household size | observed (partial) | ACS; not wired to ownership | ⚠️ |
| Tenure | observed | B25003 in summary caches | ✅ |
| Owner-value supply | observed | B25075 (`ownerValueSupplySeries`) | ✅ |
| Local market prices | observed | ZHVI cascade / Redfin / FHFA (Redfin+FHFA unwired to ownership) | ⚠️ |
| First-time-buyer proxy (age etc.) | derived | not present | ❌ (must caveat heavily) |
| Tenure preference | modeled/user | none | ❌ |
| First-time-buyer share | modeled/user | none | ❌ |
| Credit readiness | modeled/user | none | ❌ (never claim from ACS) |
| Debt qualification | modeled/user | none | ❌ |
| Liquid savings / down-payment readiness | modeled/user | none | ❌ |
| Interest in townhomes / in Fruita Commons | user | none | ❌ |
| Acceptance of shared-equity restriction | user | none | ❌ |
| Contract fallout | modeled/user | none | ❌ |
| Annual purchase timing | modeled/user | none | ❌ (forecast — see §S guardrail) |

**Rule (enforced by test §12):** every modeled reduction must be visible, editable, documented, sensitivity-tested, and **excluded from observed-demand labels**. **CHAS/ACS supply the *pool*, never mortgage-readiness.**

**Scenario infra check:** the repo already has `window.SubjectProject` (a subscribe-able scenario store used by `subject-capture-stack.js:88,238`) and `test:scenario-presets` / `hna-scenario-builder-saved.test.js`. This is the right home for editable modeled assumptions — reuse it rather than inventing a store (see §11).

---

## 9. Capture & absorption architecture (assignment §I)

**Do not** put capture math in `js/hna/ownership-decision-chain.js` — the ban test forbids it and it is the wrong layer.

**Confirmed:** all existing "capture" is LIHTC-rental. `subject-capture-stack.js:9-16` = *Subject units ÷ qualifying renter HHs* (CHFA <25% fundable). `pma-competitive-set.js:276` `calculateAbsorptionRisk` = supply-share saturation. `simulateCapture` (`market-analysis.js:1308`) = units ÷ qualified renters. `pma-ui-controller.js:557-559` explicitly *reserves* the term "capture rate" for the rental demand-pool metric. Reusing any of these for for-sale is a category error.

**Recommendation:** a **new** `js/project-market-study/forsale-capture.js` (separate UI boundary), computing:
- `annual capture rate = annual planned closings ÷ adjusted effective annual buyer pool`
- `total project penetration = total project units ÷ adjusted effective buyer pool over the analyzed period`
- with **the denominator always displayed**, and support for 24/30/36/48-month sellout, monthly/annual pacing, capture by AMI / unit type / bedroom, fallout, and base/conservative/downside scenarios.
- **No universal acceptable-capture threshold.** (The CHFA <25% rule in `subject-capture-stack.js` is rental; do not port it.)

**Reuse from PMA (product-agnostic):** boundary geometry, `market-analysis-utils.js`, `market-analysis-state.js`, `site-comparison.js`, the confidence composite/badge scaffold, `buildCompetitiveSet` radius/merge/GeoJSON plumbing. **Build new:** the buyer-pool denominator, and a for-sale/deed-restricted competitive inventory source (none wired in `DataService` today).

**Naming caution:** because the ban test only catches space-separated `capture rate` inside `ownership-decision-chain.js`, keep all capture code in the new module's files and **still** avoid the phrase in any file the ban test reads. Add the new module to a ban-scan of its own that *permits* the vocabulary there but forbids it leaking back into HNA files.

---

## 10. Shared-equity lifecycle architecture (assignment §J/§K)

**What `ownership-resale.js` does today:** given a purchase price, holding years, remaining principal, and selling costs, it computes a resale cap for three conventions and compares it to *today's* AMI-affordable price. **What it does NOT do:** compound appreciation, AMI-indexed or CPI-indexed paths (CPI is `VERIFY` only), subsidy retention/recapture waterfall, ground-lease/CLT lifecycle, down-payment-assistance recapture, appraisal cap, future-buyer affordability, homeowner return, or any multi-year projection.

**Planned lifecycle engine (Phase 2, new file `js/project-market-study/shared-equity-lifecycle.js`)** covering the 15 model types (fixed simple/compound, AMI-indexed, CPI-indexed, lesser-of, shared-appreciation, subsidy retention, subsidy recapture, deferred subordinate, DPA recapture, CLT, ground-lease, LEC, hybrid, public/nonprofit purchase option) and producing the 21 lifecycle outputs at 5/10/20/30 years under the shared assumption set (unrestricted value, restricted price, down payment, first mortgage, subordinate debt, rate/term, taxes/ins/HOA/ground rent, market/AMI/CPI growth, capital improvements, maintenance, selling costs, public appreciation share, appraisal, future rate).

**Concept-distinction guardrail (must not conflate):** deed restriction ≠ resale-price cap ≠ shared appreciation ≠ shared equity ≠ subsidy retention ≠ subsidy recapture ≠ CLT ≠ ground lease ≠ subordinate debt ≠ owner-occupancy ≠ income eligibility ≠ purchase option ≠ foreclosure survival. Model each as an independent, composable parameter, not a preset bundle.

**Sensitivity matrix to test:** low/base/high appreciation, flat, declining, AMI-slower-than-market, AMI-faster, high-HOA-growth, high-resale-rate, short-hold.

---

## 11. Fruita Commons scenario schema (assignment §M)

**Storage convention to reuse:** `window.SubjectProject` (subscribe-able scenario store; already drives the capture stack and unit-mix rows) + the saved-scenario infra behind `test:scenario-presets` and `hna-scenario-builder-saved.test.js`. **Do not invent a new persistence pattern.** Add a `projectMarketStudy` namespace to the scenario object rather than a parallel store.

Every field classified per §13 vocabulary (**observed / derived / modeled / user-entered / not-available**):

| Field group | Fields | Class |
|---|---|---|
| Program | total units (50 baseline), bedroom mix, unit types, unit sizes | user-entered |
| AMI targets | 60/70/80/90/100/110/120% AMI | user-entered (AMI $ = observed from HUD) |
| Pricing | proposed restricted price, unrestricted value | user-entered / derived (unrestricted from ZHVI/Redfin = observed) |
| Costs | TDC, land value, land contribution, developer fee, soft/hard cost, contingency, sales cost, financing cost | user-entered (benchmarkable = derived) |
| Carrying | HOA, tax, insurance, PMI, ground rent | user-entered (tax rate observed by county) |
| Buyer | down payment, closing costs, buyer assistance, subordinate financing | user-entered / modeled |
| Subsidy | public subsidy, shared-equity model | derived / user-entered |
| Phasing | construction phasing, sales phasing, carrying cost, contract fallout, stewardship cost | modeled / user-entered |

**Provisional Fruita inputs (from assignment §D) — treat as scenario fixtures, never statewide defaults:** Mesa County AMI $94,100; 30% housing cap; 6.5% rate; local median HHI ~$74,000; median price $536k-$594k; required income ~$120,000; gap ~$46,000; **87.3% of first-time buyers priced out of an average home; 82.2% priced out of a bottom-tier home.** The two priced-out percentages have **no traced source in the repo** — they must be reproduced from the chosen affordability model (§7) against a named income distribution before they appear in production. Fruita context is corroborated by `docs/audits/CALIBRATION-FRUITA-MEWS-PMA-2026-07.md` (site tract 15.03, Mesa 08077) but that doc is a *rental* PMA benchmark, not a for-sale source.

---

## 12. Proposed information architecture (assignment §N)

Three candidates evaluated:
1. **Inside HNA** as a linked extension — rejected as the *home* (would pressure the HNA screening modules toward forecasting; ban tests guard against exactly that).
2. **Inside the Deal Calculator** — rejected as the *home* (Deal Calc is per-deal underwriting UI, not a multi-stage study workflow; already 5,743 lines).
3. **Separate For-Sale Market Study workflow, linked from both HNA and Deal Calculator** — **RECOMMENDED.**

**Recommended workflow** (new page `for-sale-market-study.html`, new `js/project-market-study/`):
`jurisdiction → project/site → project assumptions → buyer-income ladder → homeownership gap → pricing & subsidy → effective-demand funnel → absorption & capture → shared-equity lifecycle → stewardship & risk → report export.`

**Boundaries:**
- **consumes** `HNAOwnershipNeed` outputs (screen, price-band, supply) read-only;
- **consumes** the shared finance kernel (§6) for all mortgage math;
- **consumes** `DealCalculator.computeForSaleFeasibility` for the per-unit gap;
- **links to** PMA/market-analysis for geometry only;
- **writes nothing** back into HNA/decision-chain modules;
- **reuses** `SubjectProject` for scenario state and the report-export patterns in `js/hna/hna-export.js`.

---

## 13. Provenance / classification recommendation (assignment §O)

**An existing convention exists — extend it, do not compete.** Canonical enum: `js/components/source-badge.js:36-41` `{raw, transformed, modeled, live}`, mirrored by the `type` field in `data/provenance/*.json`. `data/provenance/deal-calculator.json` already carries a `model` block and per-assumption `{value,label,source,notes}` where `source:"User input / planning assumption"` — the existing analog to *user-entered*.

Map the required classes onto existing anchors:

| Required class | Existing anchor |
|---|---|
| observed | `raw` (source-badge `:37`) |
| derived | `transformed` (source-badge `:38`; note `pma-vintage-strip.js:50` calls it `derived` — inconsistency to unify) |
| modeled | `modeled` (source-badge `:39`) |
| user-entered | `"User input / planning assumption"` (`data/provenance/deal-calculator.json:44`) — formalize as `user-entered` |
| not-available | `placeholder`/`unknown` (`pma-provenance.js:35`, `data-source-inventory.js` status) |
| (live) | `live` (source-badge `:40`) |

**Action:** add a `for-sale-market-study.json` provenance manifest under `data/provenance/`, classify every scenario field (§11) with this enum, and reuse `MethodFooter`'s `high|med|low` confidence semantics (`method-footer.js:100-113`). Guard with the metric-truth pattern (`test/metric-truth-crosssurface.test.js`). Note `data/provenance/*.json` currently has **no runtime consumer** — wiring the new module to read/validate it is the cleanest extension point. Unify the `transformed`/`derived` drift as part of this work.

---

## 14. Test plan (assignment §P)

Repo convention: plain Node scripts using built-in `assert` (no framework), `vm`/`jsdom`/`require` loaders, wired into the single `test:ci` `&&` chain in `package.json`. New scripts follow `test:<name>` = `node test/<file>.test.js` and are appended to `test:ci`.

**Financial engine (new `test/ownership-finance.test.js`):**
- higher rate / HOA / tax / insurance / ground rent each lowers buying power; larger down payment raises max price; borrower debt lowers total-DTI qualification; no available P&I → zero mortgage (already covered by `monthlyMortgageFactor` r=0 path — assert it); percent-vs-decimal cannot be mixed silently (§6 hazard); **golden-value backward-compat: `maxAffordablePrice(100000,0.80)===289983` unchanged** (reuse existing fixture); Deal Calc and HNA return identical results under identical assumptions (extend `deal-calc-for-sale-feasibility.test.js:121`).

**Shared equity (extend `test/ownership-resale.test.js` + new lifecycle test):**
- fixed simple / fixed compound / AMI-indexed / CPI-indexed / lesser-of / shared-appreciation formulas; subsidy-recapture waterfall; subsidy-retention; subordinate-debt payoff; capital-improvement credit; appraisal cap; market decline; negative equity; future-buyer affordability; net proceeds; public-subsidy accounting; **preservation comparison on all conventions, not just fixed_simple** (closes §3.16 gap).

**Demand & capture (new `test/forsale-capture.test.js`):**
- observed and modeled stages remain distinct; no stage silently dropped; funnel values cannot increase unless explicitly allowed; capture denominator visible; annual capture ≠ total penetration; sellout math correct; fallout increases required gross sales; missing data → unavailable, not zero; **existing decision-chain ban test remains intact** (assert it still passes and add a ban-leak scan that forbids capture vocabulary in HNA files).

**Data & UX:** source classification appears; vintage appears; scenario values never become statewide defaults (assert Fruita fixtures are not in any default constant); mobile layout (`test:mobile-overflow-containment`); export consistency; a11y (`test:pill-contrast`/`test:inline-contrast`); no duplication of consumer & developer funding data (extend `ownership-decision-chain.test.js:110`).

---

## 15. Phased implementation plan (assignment §Q/§R)

Each phase: **purpose · scope · files · functions · new files · dependencies · tests · acceptance · exclusions · rollback.** The assignment's default sequence is sound; only the ordering caveat below is added.

### PHASE 1 — Shared ownership finance kernel (SMALL, reviewable)
- **Purpose:** one authoritative buyer-side math path; kill formula drift.
- **Scope:** extract `maxAffordablePrice`/`incomeNeeded`/`monthlyPITI` into a new pure module with an options object; add HOA, closing costs, buyer-cash-required, PMI LTV gate, optional back-end DTI — **all defaulting to today's behavior**.
- **Files:** new `js/hna/ownership-finance.js`; `hna-ownership-need.js` re-exports; `deal-calculator.js` / `affordability-metrics-panel.js` / `hna-utils.js` delegate.
- **Functions:** `maxAffordablePrice`, `incomeNeededForHomeValue`, `computeForSaleFeasibility` (consume kernel).
- **New files:** `js/hna/ownership-finance.js`, `test/ownership-finance.test.js`.
- **Dependencies:** none (pure).
- **Tests:** §14 financial-engine; golden-value backward-compat.
- **Acceptance:** every existing ownership test passes **unchanged**; `289983` fixture identical; no new UI; `test:ci` green.
- **Exclusions:** no UI, no demand funnel, no capture, no lifecycle, no Fruita scenario, no report.
- **Rollback:** delete new module + revert re-export lines (delegation is additive).

### PHASE 2 — Expanded shared-equity lifecycle engine + policy schema
- Purpose: time-path resale/subsidy lifecycle. Files: new `js/project-market-study/shared-equity-lifecycle.js`; extend `data/policy/resale-conventions.json` (add compound/AMI/CPI params, keep VERIFY discipline). Tests: §14 shared-equity. Acceptance: 15 models × 5/10/20/30yr; sensitivity matrix; ban test (`ownership-resale.test.js:141`) intact. Exclusions: no UI. Rollback: additive module.

### PHASE 3 — Fruita Commons scenario schema + fixtures
- Purpose: scenario shape on `SubjectProject`. Files: new `data/fixtures/fruita-commons.scenario.json`, provenance manifest. Tests: fixtures never leak into defaults. Rollback: delete fixtures.

### PHASE 4 — Homeownership-gap & price-ladder interface
### PHASE 5 — Effective-demand funnel (observed/modeled separation enforced)
### PHASE 6 — For-sale capture & absorption module (parallel to PMA, new UI boundary)
### PHASE 7 — Shared-equity comparison interface
### PHASE 8 — Fruita Commons report & export (reuse `hna-export.js` patterns)
### PHASE 9 — Statewide jurisdiction/site reuse
### PHASE 10 — Independent methodology/lender/appraiser/legal/consumer-disclosure/a11y/perf QA

**Ordering caveat (repo evidence):** resolve the **§7 formula-unification decision** before Phase 4+ (it swings the break-even AMI from ~88% to ~137% — see QA Addendum §A2), and land the **#1167 F1/F2 tenure-mix fix** (documented in the EPS benchmark) before surfacing any *county* for-sale demand, since it can flip small-town tiers. (The earlier "A0 empty-file" blocker was a misread and is retracted.)

---

## 16. Exact Phase 1 implementation prompt

> **Task:** Create `js/hna/ownership-finance.js`, a pure (no DOM/fetch) module that becomes the single authoritative homeownership-affordability engine, and route the three existing formulas through it **without changing any current output**.
>
> **Do:**
> 1. Move the math of `maxAffordablePrice` (`js/hna/hna-ownership-need.js:265-282`), `monthlyMortgageFactor` (`:258`), and `incomeNeededForHomeValue` (`:313-328`) into `ownership-finance.js`, exported on `window.OwnershipFinance` (mirror the IIFE/`window` + `module.exports` pattern of `js/deal-calculator-math.js`).
> 2. Signature: `maxAffordablePrice(ami4Person, amiPct, assumptions)` where `assumptions` merges over the **existing** `CONSTANTS.affordabilityAssumptions` defaults so a two-arg call returns the identical number. Add optional keys: `hoaMonthly` (default 0), `closingCostRate` (default 0), `groundRentMonthly` (default 0), `pmiLtvGate` (default false → current unconditional PMI), `backEndDtiRatio` (default null → not applied), `borrowerMonthlyDebt` (default 0). Add outputs `buyerCashRequired = price*downPaymentRate + price*closingCostRate` and `maxLoan`.
> 3. Have `hna-ownership-need.js` `require`/reference `OwnershipFinance` and re-export `maxAffordablePrice`/`incomeNeededForHomeValue` so `window.HNAOwnershipNeed` keeps its current surface. Have `deal-calculator.js:173` and `affordability-metrics-panel.js` and `hna-utils.js:1137` delegate to the kernel (panel keeps its ratio display but sources `required_hhi_for_home` from the kernel).
> 4. Write `test/ownership-finance.test.js` (plain Node `assert`) and wire `test:ownership-finance` into `test:ci`.
>
> **Backward-compat contract (hard):** `maxAffordablePrice(100000, 0.80) === 289983` and every assertion in `test/hna-ownership-need.test.js`, `test/deal-calc-for-sale-feasibility.test.js`, `test/ownership-resale.test.js`, `test/ownership-decision-chain.test.js` passes **unchanged**. Do not weaken or edit any existing test.
>
> **Do NOT:** add UI, demand funnel, capture/absorption, lifecycle, Fruita scenario, or report code; introduce the words `forecast`/`capture rate`/`time-phasing` into any HNA file; touch `data/`, `scripts/`, workflows, or deploy-gate files; hard-code any Fruita value.
>
> **Before PR:** `npm run test:hna-ownership-need && npm run test:ownership-resale && npm run test:ownership-decision-chain && npm run test:deal-calc-for-sale-feasibility && npm run test:ownership-finance && npm run validate`.

---

## 17. Open questions repository inspection cannot answer

1. ~~**A0:** empty county CHAS files~~ **RESOLVED / not a blocker** — files are populated (minified). No action.
2. **§7:** Which affordability model is canonical — the ownership kernel (10% down / 30% front-end) or the `AFFORDABILITY-METHODOLOGY.md` model (20% down / 43% back-end)? This changes every priced-out %.
3. **§11:** Source of the **87.3% / 82.2%** Fruita priced-out figures — which income distribution, which price tier, which affordability model? (Needs owner/analyst input; not in repo.)
4. Which shared-equity resale convention governs **Fruita Commons specifically** (WMRHC Good Deeds vs a Mesa/Fruita local deed restriction)? Requires the actual project deed restriction.
5. Real Fruita Commons unit mix, TDC build-up, land contribution, and phasing (a live development — needs the developer).
6. Is there an existing or intended **for-sale competitive-inventory data source** (new/resale listings, deed-restricted ownership registry)? None is wired in `DataService`.
7. Lender/appraiser/attorney/administrator validation of every modeled reduction and resale formula (§S).

---

## 18. Assumptions requiring external validation (assignment §S)

Lender: DTI ratios, PMI rules, multiple-product qualification, reserves. Appraiser: appraisal-constrained resale value, unrestricted-value basis. Attorney: deed-restriction/ground-lease/CLT enforceability, foreclosure survival, subordinate-debt subordination, inheritance. Administrator: stewardship capacity, capital-improvement credits, repurchase funding, eligible-buyer pool. Broker/survey: buyer interest, tenure preference, first-time-buyer share, fallout, absorption pacing. Local stakeholder: Fruita/Mesa program terms, fee waivers, land contribution.

---

## Appendix — Deed-restricted ownership failure-mode register (assignment §L)

For each: **likelihood / impact / warning signal / mitigation / responsible party / policy req / doc req / reserve req / CoHO capability** (calculate / flag / disclose only).

| Failure mode | Lk | Imp | Warning signal | Mitigation | Owner | CoHO can |
|---|---|---|---|---|---|---|
| Insufficient owner wealth creation | H | H | resale cap growth < AMI growth over hold | choose formula w/ adequate appreciation share | policy/admin | **calculate** (lifecycle §10) |
| Resale formula exceeds appraisal | M | H | formula cap > appraised value | appraisal cap in formula | admin/appraiser | **calculate** (appraisal-cap output) |
| Resale price outruns buyer incomes | M | H | future formula price > future AMI-affordable price | AMI-indexed cap | policy | **calculate** (future-buyer affordability) |
| HOA dues undermine affordability | H | M | HOA growth > income growth | HOA cap / escalating-HOA model | HOA/dev | **calculate** (escalating HOA) |
| Special assessments | M | H | reserve study shortfall | reserve requirement | HOA | **flag/disclose** |
| Escalating ground rent | M | H | ground rent schedule > income growth | fixed/indexed ground rent | CLT | **calculate** |
| Lender rejection of restriction | M | H | non-conforming resale formula | use lender-accepted (e.g. Fannie CLT) forms | lender/attorney | **disclose** |
| Appraiser uncertainty | M | M | thin comparable set | appraiser guidance packet | appraiser | **disclose** |
| Refinancing limitations | M | M | equity-strip refi requests | refi policy in deed | admin | **disclose** |
| Foreclosure extinguishes restriction | L | H | subordinate lien position | recorded first-position restriction / repurchase option | attorney | **flag/disclose** |
| Subordinate-debt conflicts | M | M | DPA + buy-down stacking | subordination agreement | attorney | **calculate** (subordinate payoff) |
| Inadequate administrator capacity | M | H | slow resale turnaround | funded stewardship | admin | **disclose** |
| Slow resales / narrow buyer pool | M | M | long marketing time | broaden eligibility bands | admin | **calculate/flag** (buyer-pool effect) |
| Forced repurchase without capital | L | H | no repurchase reserve | repurchase reserve | admin | **flag** (reserve req) |
| Unclear improvement credits | M | M | disputed capital-improvement claims | documented credit schedule | policy | **calculate** (cap-improvement credit) |
| Transaction costs consume equity | M | M | selling costs > equity gain | selling-cost cap | admin | **calculate** (net proceeds) |
| Inheritance conflicts | L | M | heir ineligible | inheritance clause | attorney | **disclose** |
| Maintenance disincentives | M | M | deferred maintenance | maintenance reserve | HOA | **disclose** |
| Poor disclosure | M | H | buyer confusion at resale | plain-language disclosure | admin | **disclose** (report §8) |
| Punitive enforcement | L | M | disputes/litigation | proportionate remedies | policy | **disclose** |
| Negative equity | L | H | declining market path | downside scenario | — | **calculate** (declining-market test) |
| Early resale | M | M | resale < min hold | min-hold clause | policy | **calculate** (short-hold test) |
| Inferior product quality/warranty | L | M | warranty gaps | builder warranty req | dev | **disclose** |
| Public subsidy leakage | M | H | recapture not enforced | recapture waterfall | policy | **calculate** (subsidy recapture) |
| Inconsistent administrator decisions | M | M | ad-hoc pricing | written pricing policy | admin | **disclose** |

---

---

# QA Addendum (2026-08-04) — phase realism, production cost, and the gap to reach ownership AMIs

This addendum QA's the phasing against the standard of a *true* for-sale fundamental market study, prices out production, and grounds the homeownership gap in the repo's own kernel. All dollar figures below were computed by loading the real `HNAOwnershipNeed.maxAffordablePrice` (the way the tests do) — not asserted.

## A1. Corrections to the original audit (QA integrity)

| Claim in original draft | Corrected finding |
|---|---|
| `chas_affordability_gap.json` / `chas_co.json` are **0 bytes / empty blocker (A0)** | **False** — both are populated minified JSON (166 KB / 162 KB). Misread `wc -l`. **A0 retracted.** |
| Mesa County AMI (4-person) = **$94,100** (from the ChatGPT script) | Repo/HUD value is **$97,600** (`data/co_ami_gap_by_county.json`, fips 08077). Use the repo value; the script's figure is stale. |
| Median price $536k–$594k (from the script) | **Unverified in repo.** Repo place-level data: **Fruita (place 0828745) ZHVI = $486,295** (2026-05-31, high confidence); Mesa County = $505,589 (FHFA-anchored). The $536-594k figure may be current listings / new-construction / townhome-specific and must be sourced before use. |

**Jurisdiction-level pricing is a hard requirement (per owner direction + repo history).** A study for a *municipality* (Fruita) must anchor to **Fruita place-level** home values, never Mesa County. This is not optional polish: place-vs-county masking is this repo's most recurring bug (`docs/audits/CODEX-HANDOFF-AFFORDABLE-OWNERSHIP.md:161`; project memory). The study module must (a) resolve the jurisdiction's own price series (Fruita ZHVI / Fruita Redfin / Fruita FHFA-place), (b) show a provenance pill proving it is place-scoped, and (c) fall back to county **only** as an explicitly labeled last resort. Ideally it uses **product-specific** comps (townhome sales), not all-homes ZHVI, since Fruita Commons is townhomes.

## A2. The gap to reach homeownership AMIs — Fruita, kernel-grounded

Using the authoritative kernel (Model A: 10% down, 30% front-end, 6.5%, tax 0.65%, ins 0.35%, PMI 0.5%), Mesa AMI **$97,600**, Fruita ZHVI **$486,295**:

| AMI % | Household income | Max affordable price | Gap vs Fruita $486,295 |
|---:|---:|---:|---:|
| 60% | $58,560 | $212,268 | **−$274,027** |
| 70% | $68,320 | $247,646 | **−$238,649** |
| 80% | $78,080 | $283,024 | **−$203,271** |
| 90% | $87,840 | $318,402 | **−$167,893** |
| 100% | $97,600 | $353,780 | **−$132,515** |
| 110% | $107,360 | $389,158 | **−$97,137** |
| 120% | $117,120 | $424,536 | **−$61,759** |

- **Income needed to buy the Fruita median at market: $134,158 = 137% of AMI.** Even a 120% AMI household is ~$62k short of the median price. This corroborates the script's *direction* (income gap) while correcting its magnitudes.
- **Per-unit subsidy gap** (market price − max affordable price) to reach a **100% AMI** buyer = **$132,515**; to reach an **80% AMI** buyer = **$203,271**. For a 50-unit project targeting 80% AMI at market cost, that is **~$10.2M** of gap before any land write-down, fee waiver, or tax relief — the number the capital stack must close.

**Model sensitivity (the single most consequential methodology choice — §7).** The same gap under Model C (`AFFORDABILITY-METHODOLOGY.md`: 20% down, 43% back-end DTI, ins 0.85%):

| AMI % | Model A (kernel) | Model C (20%/43% DTI) | Swing |
|---:|---:|---:|---:|
| 80% | $283,024 | $443,645 | +$160,621 |
| 100% | $353,780 | $554,556 | +$200,776 |
| 120% | $424,536 | $665,467 | +$240,931 |

- **Break-even AMI to afford the Fruita median: 137% (Model A) vs 88% (Model C).** Under Model C the 100% AMI buyer shows a *surplus* (−$68k gap → affordable), under Model A a $132k *shortfall*. **The choice of affordability model changes whether the project needs $10M of subsidy or none.** This is why §7 (unify the formula) is Phase 1 and why no priced-out % should ship until the model is chosen. Model A is the conservative, tested, guardrailed default; Model C is more permissive (bigger down payment assumed, higher DTI). A defensible study likely reports **both** as a bracket and names the underwriting assumptions explicitly — which is exactly what a CHFA-grade study does.

## A3. Housing authority as master developer, zero property tax, and bond finance

This is a structuring layer the current tool does **not** model and the study module should add as a distinct **public-finance capital-stack layer** (separate from the buyer-side kernel and the per-unit gap).

**A3.1 — Zero property tax: mechanism and limits (Colorado).** Property owned by a housing authority is exempt from taxation as public property for an essential governmental purpose (C.R.S. Title 29, Art. 4; the Deal Calculator already cites the related §39-3-112.5 exemption for a 501(c)(3) owner + ≤60% AMI use restriction at `deal-calculator.js:755`). **Critical nuance for *for-sale*:** the exemption holds only while the authority/municipality **retains ownership**. The moment a unit is sold fee-simple to a homeowner, that homeowner owes normal property tax. Perpetual zero-property-tax **and** fee-simple homeownership is generally **not** achievable. To carry a tax benefit into occupancy you need a **retained-ownership structure**:
- **Community Land Trust / ground lease** — authority (or CLT) retains the *land* (assessed low or exempt as public/charitable), buyer owns the *improvements* and pays tax on a lower base. This is the standard way to combine ownership with a durable tax reduction, and it composes naturally with the shared-equity resale conventions already in `resale-conventions.json` (Elevation CLT is already an entry).
- **Restricted-value assessment** — Colorado permits deed-restricted affordable units to be assessed at their *restricted* (actual deed) value rather than unrestricted market value, materially lowering the tax base for the owner-occupant. (Verify current assessor practice with the Mesa County Assessor — §18.)
- **Fee-simple sale** — buyer pays full tax; no exemption. Highest owner wealth, no ongoing public tax cost.

**A3.2 — What zero property tax is worth to affordability (kernel-computed).** Setting the kernel's property-tax rate to 0 (retained-ownership / restricted-assessment structure):

| AMI % | Baseline max price (0.65% tax) | Zero-tax max price | Buyer-power gain |
|---:|---:|---:|---:|
| 80% | $283,024 | $307,146 | +$24,122 |
| 100% | $353,780 | $383,933 | +$30,153 |
| 120% | $424,536 | $460,719 | +$36,183 |

Zero property tax **shrinks the 100% AMI per-unit gap from $132,515 to $102,362**. Combined with removing PMI (e.g. buyer assistance to 20% down, or a CLT structure lenders treat favorably), the 100% AMI max price rises to **$408,008** and the gap falls to **$78,287** — roughly a 40% reduction in required subsidy purely from structure, before any cash subsidy. **The study should model tenure/ownership structure as an input that drives the property-tax and PMI terms**, because it is one of the largest non-cash levers on the gap.

**A3.3 — Master-developer & bond/funding sources (to encode as a developer-side dataset, mirroring `developer-ownership-funding.json`).** A Colorado housing authority has statutory power (Title 29, Art. 4) to act as master developer, own and assemble land, install horizontal infrastructure, phase vertical construction under a Master Development Agreement, and issue bonds. Candidate sources for a multiphase, municipally-owned, zero-property-tax structure — each must be verified with bond counsel / a municipal financial advisor before use (this is general structuring information, not investment or legal advice):

- **Housing authority revenue bonds** (tax-exempt governmental or private-activity), C.R.S. Title 29, Art. 4 — the core master-developer instrument; not general-obligation, repaid from project/authority revenues.
- **Private Activity Bonds / Mortgage Revenue Bonds + Mortgage Credit Certificates** — buyer-side financing (below-market first mortgages / tax credits to buyers), allocated via CHFA/state PAB cap.
- **Proposition 123 (2022) affordable-housing financing** — DOLA/DOH; for-sale is eligible; the Deal Calculator already lists it (`deal-calculator.js:5102`).
- **DOLA grants (HDG), CDBG, HOME, CHFA down-payment assistance** — three of these are already in `developer-ownership-funding.json` (WMRHC buy-down, inclusionary, CHFA DPA); extend the dataset with the bond/authority sources.
- **Land write-down / contribution** — `data/policy/county-ownership.json` already inventories public parcels + CLT orgs by county (Mesa = 08077); municipal land contribution is often the single largest subsidy and pairs with the retained-land CLT structure.
- **FHLB Affordable Housing Program; Opportunity Zone equity** — check Fruita tract OZ status (the repo carries OZ designation data, fixed by #1252).
- **Fee waivers / expedited entitlement** — non-cash, already benchmarked in EPS Table 12.

**Structuring tensions the study must surface (do not hide):**
- **Metro/special districts (Title 32)** finance infrastructure via a **mill levy = property tax** — directly at odds with a "zero property tax" objective. Usable for horizontal infra but note the conflict for the vertical for-sale product.
- **TIF / urban renewal** relies on rising assessed value / property-tax increment; **tax-exempt municipal ownership suppresses the increment**, weakening TIF capacity. Zero-tax and TIF partially cancel.
- **Tax-exempt bond + for-sale exit**: tax-exempt bond proceeds financing units that are then sold fee-simple can raise arbitrage/private-use questions — bond counsel gate.

**Recommended addition to the plan:** a **Phase 2.5 "public-finance & tenure-structure layer"** (between the lifecycle engine and the scenario) that models: ownership structure (fee-simple / ground-lease-CLT / retained-rental-to-own) → drives the property-tax & PMI inputs; and a bond/authority capital-stack dataset → sizes the sources against the A2 gap. This is where "housing authority as master developer with zero property tax" becomes a first-class, quantified scenario rather than prose.

## A4. Are the phases correct & realistic for a *true* market study?

**The central QA finding: the original 10 phases build a reusable *software product*; a *true* for-sale fundamental market study is an *analytical deliverable*.** They share components but have different critical paths, and two gaps make the software phases unable to reach study-grade on code alone:

1. **No for-sale supply/pipeline data exists.** A true study's spine is competitive supply: existing for-sale inventory, active/planned *pipeline* (competing subdivisions, other deed-restricted resales), months-of-supply, and absorption of comparable projects. The repo has **zero** for-sale competitive inventory wired (`DataService` has LIHTC/NHPD *rental* only — confirmed in the PMA trace). Phases 5–6 (demand funnel, capture/absorption) **cannot** be study-grade until this data source is acquired. This is the binding constraint, and it is a *data-acquisition* problem, not a coding one.

2. **The forecast ban vs. what a market study is *for*.** The repo intentionally forbids absorption forecasts / time-phasing / capture-rate language in the screening layer (and I recommend keeping that). But a true market study's entire purpose is forward **demand, absorption, and capture over time**. The §9 "parallel module" resolves the *architecture* tension, but it does not resolve the *evidence* tension: credible absorption/capture requires **primary research** (broker interviews, comparable-project absorption histories, migration analysis, lender pre-qualification data) that no automated pipeline produces. **Phases 5, 6, and 8 have a non-code primary-research workstream** the original plan under-stated.

**Components a true for-sale market study includes that the phases under-weight or omit:**

| True-study component | In the phases? | Gap |
|---|---|---|
| Site & regional analysis | Partial (Phase 3/9) | fine |
| PMA delineation | Reuse PMA geometry | fine (rental PMA geometry is product-agnostic) |
| **Economic/employment base & demand drivers** | ❌ | add — jobs, wages, drivers; not modeled |
| Demographic base & household growth | Partial (CHAS/ACS) | ACS is *current*, not *projected* growth |
| **Demand = growth + turnover + pent-up + in-migration** | ❌ (funnel is static by ban) | study needs forward demand; needs primary research |
| **Competitive & pipeline supply (for-sale)** | ❌ (no data) | **binding blocker** — acquire data |
| **Pricing / comparable-sales analysis (product-level)** | Partial (Redfin/FHFA unwired; not townhome-specific) | wire + product comps |
| Affordability gap & subsidy sizing | ✅ (strong — A2) | best-covered piece |
| Absorption / capture / penetration | Phase 6 (parallel module) | needs supply data + primary research |
| Shared-equity/resale & stewardship | ✅ (Phase 2/7) | strong |
| **Public-finance / capital stack (bonds, tax structure)** | ❌ (A3) | add Phase 2.5 |
| Conclusions / recommendations / disclosure | ✅ (Phase 8/10) | fine |

**Verdict on the phases:** the *ordering* is sound and the *ownership-finance* spine (Phases 1–2, 7) is genuinely strong and realistic — it's the part CoHO can do better than a spreadsheet. But **Phases 5, 6, and 8 are over-scoped as pure software** and mislabeled as "study." They should be re-cast as **"screening-grade demand & capture with explicit study-grade caveats"** (mirroring how `subject-capture-stack.js` already discloses "when to commission a professional market study"), with the honest statement that reaching CHFA/appraiser-grade requires (a) a for-sale supply data source and (b) primary research. The tool's right role is to do the **affordability-gap, subsidy-sizing, shared-equity, and public-finance structuring** to a high standard, and to *frame and feed* the demand/absorption question rather than claim to answer it.

## A5. Production cost & effort estimate

Effort in engineer-weeks (this repo's conventions: pure-JS modules, Node `assert` tests, one PR per unit). "Data/external" = non-engineering cost.

| Phase | Eng-weeks | Data / external cost | Reaches study-grade? |
|---|---:|---|---|
| 1 — finance kernel unification | 1–2 | none | n/a (foundation) |
| 2 — shared-equity lifecycle engine | 2–3 | legal review of formulas (~$3–8k) | yes (formulas) |
| 2.5 — public-finance / tenure structure (**new, A3**) | 2–3 | bond counsel + financial advisor review (~$10–25k) | yes (structuring) |
| 3 — Fruita scenario schema/fixtures | 1 | developer inputs (unit mix, TDC) | n/a |
| 4 — gap & price-ladder UI | 1–2 | none | yes |
| 5 — effective-demand funnel | 2–3 | **primary research** (broker/lender/migration) | **no** without research |
| 6 — capture/absorption module | 3–4 | **for-sale supply/pipeline data source** (build or license) + comparable-absorption research | **no** without data |
| 7 — shared-equity comparison UI | 1–2 | none | yes |
| 8 — Fruita report/export | 2 | analyst authoring + review | partial |
| 9 — statewide reuse | 3–5 | jurisdiction pricing/supply data at scale | screening only |
| 10 — independent QA (methodology/lender/appraiser/legal/a11y/perf) | 2–3 | external reviewers (~$15–40k) | gate |

**Totals:** ~**22–33 engineer-weeks** (≈5–8 months for one engineer; ~3–4 months for two) for the software product, **plus ~$30–80k of external validation/data**, of which the **for-sale supply data source (Phase 6) and primary research (Phase 5) are the cost-and-risk drivers** and the reason those phases can't be fully automated.

**Cheaper alternative to weigh:** for **one** Fruita Commons study, a professional consultant produces a CHFA-grade for-sale market study in ~6–10 weeks for roughly **$15–40k**. Building the CoHO module is only worth it if the goal is **repeatable, statewide** studies (Phase 9) — which is the stated product direction. **Recommended split:** build Phases 1–4 + 2.5 + 7 (the affordability-gap, subsidy-sizing, shared-equity, and public-finance engine — CoHO's genuine edge, ~9–13 eng-weeks) to production, and for Fruita Commons specifically, **pair the tool's gap/subsidy/structuring output with a commissioned professional demand/absorption study** rather than trying to automate Phases 5–6 to study-grade first.

## A6. Revised recommendation

**PROCEED TO PHASE 1**, unchanged and low-risk. But re-scope the roadmap's second half with eyes open:
- Phases 1–2, 2.5 (new), 4, 7 are realistic to build to production and are CoHO's real value — affordability gap, subsidy sizing, shared-equity lifecycle, and public-finance/tenure structuring.
- Phases 5–6 (demand/absorption/capture) are **screening-grade until a for-sale supply data source and primary research exist** — label them honestly and do not claim study-grade.
- The **canonical-affordability-model decision (§7 / A2)** is the highest-leverage open item: it swings the Fruita per-unit subsidy gap between ~$0 and ~$132k per unit and the break-even AMI between 88% and 137%.
- The **zero-property-tax / housing-authority master-developer structure (A3)** is a first-class lever worth ~$30k of buyer power per 100% AMI unit and should be modeled explicitly (Phase 2.5), including the retained-ownership requirement (CLT/ground-lease) and the metro-district/TIF tensions.

---

## Recommendation

**PROCEED TO PHASE 1.**

Evidence: the ownership stack exists, is layered cleanly, and is test-guarded; `maxAffordablePrice` is already the shared kernel injected into the Deal Calculator; the consumer/developer and screening/underwriting separations are real and enforced. The clear, low-risk, high-value first step is consolidating the **three divergent affordability formulas** (§7) behind one tested kernel with a strict backward-compatibility contract (§16) — no UI, no forecasting, no new claims. The genuine open items (the canonical-model decision, which swings the break-even AMI from ~88% to ~137%; the untraced 87.3%/82.2% Fruita figures) are **methodology decisions that Phase 1 does not touch**, which is exactly why Phase 1 can start now while those are resolved in parallel for Phases 4+.

> See the **QA Addendum (2026-08-04)** below for: the retraction of the false A0 blocker; a kernel-grounded Fruita gap-to-AMI analysis; the affordability-model sensitivity; the housing-authority master-developer / bond / zero-property-tax structuring and its effect on the gap; a realism critique of the phases against a *true* market study; and a production cost/effort estimate.
