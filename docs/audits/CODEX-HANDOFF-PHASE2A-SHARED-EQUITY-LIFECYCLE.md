# Codex Handoff — Phase 2a: Shared-Equity Lifecycle Engine

**For:** Codex (implementer)
**QA:** Claude Code will review the PR against the acceptance criteria at the bottom. Deviations from the file allowlist or the semantic guardrails will bounce the PR — read this whole doc before writing code.
**Date:** 2026-08-04
**Blocked by:** PR #1388 (ownership finance engine) must be **merged** first — this module consumes `OwnershipFinance`. Do not start before it lands on main.
**Spec of record:** `docs/audits/SCOPING-FRUITA-COMMONS-REVISION-2-2026-08.md` §4 (Phase 2 row), §5.8; assignment §J/§K in `docs/audits/SCOPING-FRUITA-COMMONS-FOR-SALE-MARKET-STUDY-2026-08.md` §10.
**Scope note:** Revision 2's Phase 2 is split for reviewability. **This PR is 2a only: the lifecycle computation engine.** Phase 2b (resale waterfall + land-disposition comparison) is a separate later handoff. Do not build 2b features.

---

## What you are building

A pure calculation module, `js/project-market-study/shared-equity-lifecycle.js`, that projects a deed-restricted / shared-equity home over time under a chosen resale formula, and reports both the **owner's outcome** and the **public/affordability outcome** at 5, 10, 20, and 30 years, under low / base / high / flat / declining market scenarios.

This is the machinery that answers: *does the subsidy survive resale, and does the owner build wealth?* — the two questions the current `js/hna/ownership-resale.js` screen (single holding period, today's-price comparison only) cannot answer.

### Architecture position

- **New directory** `js/project-market-study/` — the Tier-2 project layer. This is deliberately OUTSIDE `js/hna/` because forecast-adjacent computation lives here, never in the HNA screening layer.
- Pure functions; no DOM, no fetch; dual export (`window.SharedEquityLifecycle` + `module.exports`) mirroring `js/hna/ownership-finance.js`.
- **Consumes** (never modifies): `OwnershipFinance` (mortgage math, `incomeNeededForHomeValue`, household-size factors) and `data/policy/resale-conventions.json` conventions passed in by the caller.
- `js/hna/ownership-resale.js` is **untouched**. It remains the screening-layer surface; a later phase may delegate it. Do not refactor it in this PR.

## Hard rules (each is test-enforced or QA-bounced)

1. **Time paths are scenario projections, clearly labeled.** Every output object carries `classification: 'modeled'` and `scenarioLabel` (e.g. `'base market (3%/yr) — scenario, not a prediction'`). The words **"forecast"**, **"will appreciate"**, and **"projected"** must not appear in module strings — use "scenario" / "modeled path" (matches the ban in `test/ownership-resale.test.js:141-144`, which will be extended to this file).
2. **No capture/absorption/demand language or math** — that is Phase 6/7. Banned in this file: `capture rate`, `absorption`, `sellout`, `time-phasing`.
3. **Concept separation (assignment §J):** deed restriction ≠ resale-price cap ≠ shared appreciation ≠ subsidy retention ≠ subsidy recapture ≠ CLT ≠ ground lease ≠ subordinate debt. Each is an independent, composable input — never a bundled preset that conflates them.
4. **VERIFY discipline:** convention parameters with `parameter_status != 'verified'` (APCHA CPI leg, Elevation 25% share) still compute, but the output carries `verifyParameter: true` and the caveat string. Never invent a parameter value.
5. **No neutrality violations:** never emit copy implying shared equity is "better" because it preserves affordability longer — outputs report both sides (owner wealth AND affordability preservation) without ranking them.
6. **No Fruita constants** hard-coded. Everything arrives via inputs.

## Module spec

```js
SharedEquityLifecycle.project(input) → LifecycleResult
```

**Input** (single object; all rates decimal — reuse `OwnershipFinance`'s percent/decimal guard pattern):

```js
{
  // initial position
  unrestrictedValue,          // market value at purchase ($)
  restrictedPrice,            // buyer's actual purchase price ($)
  downPayment,                // $ (not a rate)
  subordinateDebt: [ { label, principal, interestRate, structure } ],
    // structure: 'deferred' | 'amortizing' | 'forgivable' (forgivable needs termYears)
  firstMortgage: { rateAnnual, termYears },       // principal derived: restrictedPrice − downPayment − Σ subordinate applied at closing
  // carrying costs (monthly $ or annual rates, named like OwnershipFinance)
  hoaMonthly, hoaEscalationRate, groundRentMonthly, groundRentEscalationRate,
  propertyTaxRate, insuranceRate, pmiRate,
  // resale formula (one of, validated):
  formula: { type: 'fixed_simple' | 'fixed_compound' | 'ami_indexed' | 'cpi_indexed'
                 | 'lesser_of' | 'shared_appreciation',
             annualRate,                  // fixed_simple / fixed_compound
             appreciationShare,           // shared_appreciation (owner share)
             legs: ['fixed','cpi','ami','appraisal'],  // lesser_of components
             appraisalCap: true|false },  // cap formula price at modeled market value
  // growth scenario (annual rates)
  scenario: { label, marketGrowth, amiGrowth, cpiGrowth },
  // context
  ami4Person, amiPct, householdSize,      // for future-buyer affordability via OwnershipFinance
  sellingCostRate,                        // share of resale price
  capitalImprovements: [ { year, amount, creditShare } ],
  publicSubsidyAtClosing,                 // $ (grants/land write-down counted as public investment)
  horizons: [5, 10, 20, 30],              // years (default)
}
```

**Output** per horizon (`results[year]`), all `Math.round`ed dollars, no NaN/undefined anywhere (walk-tested):

1. `formulaResalePrice` — per the formula type
2. `unrestrictedMarketValue` — initial value compounded at `marketGrowth`
3. `appraisalConstrainedPrice` — `min(formulaResalePrice, unrestrictedMarketValue)` when `appraisalCap`, else formula price, with `appraisalBinding: true|false`
4. `remainingFirstMortgagePrincipal` — real amortization (compute it; do NOT take it as an input — closes the §3.14 gap)
5. `subordinateBalances[]` — per structure (deferred accrues simple interest unless stated; forgivable declines linearly)
6. `sellingCosts`
7. `ownerGrossEquity` = resale price − first-mortgage balance − selling costs
8. `capitalImprovementCredit`
9. `ownerNetProceeds` = gross equity − subordinate payoff + improvement credit (never counts a forgiven balance as owed)
10. `effectiveAnnualOwnerReturn` — IRR-style annualized return on `downPayment` (+ improvements) → `null` with `note` when proceeds ≤ 0 (no fake negative-IRR precision)
11. `monthlyHousingCost` at that year (P&I + escalated HOA/ground rent + tax/ins on current value + PMI while LTV > 80%)
12. `futureBuyerIncomeNeeded` = `OwnershipFinance.incomeNeededForHomeValue(resale price, same carrying assumptions incl. escalated HOA)`
13. `futureBuyerAmiRatio` = that income ÷ (ami4Person grown at `amiGrowth`)
14. `futureAffordabilityGap` = resale price − `OwnershipFinance.maxAffordablePrice(grown AMI, amiPct, …)`
15. `additionalSubsidyRequiredForNextBuyer` = `max(0, futureAffordabilityGap)`
16. `publicSubsidyOutstanding` — subsidy retained in the home vs recaptured at sale (report both; do not conflate — rule 3)
17. `preservesAffordability` = resale price ≤ next-buyer max price (boolean + one-line label)
18. `negativeEquity: true|false` (declining scenarios can produce it — handle, don't clamp silently)

Also export: `SCENARIOS` (canonical five: low 0.01 / base 0.03 / high 0.06 / flat 0.00 / declining −0.02 market growth — named constants, documented as scenario conventions not predictions), `runMatrix(input, scenarios)` convenience, and `fromConvention(conventionDoc, conventionId, input)` that maps a `resale-conventions.json` entry onto a `formula` (honoring `parameter_status`).

### Formula definitions (get these exactly right)

- `fixed_simple`: `price × (1 + rate × years)` (matches `OwnershipResale.fixedSimpleCap`)
- `fixed_compound`: `price × (1 + rate)^years`
- `ami_indexed`: `price × (amiAtYear / amiAtPurchase)`
- `cpi_indexed`: `price × Π(1 + cpiGrowth)` (compound)
- `lesser_of`: min of the computed legs listed in `legs` (each leg computed per its own definition; `appraisal` leg = unrestricted market value)
- `shared_appreciation`: `price + share × max(0, marketValue − price)` — owner receives `share` of appreciation; **do not** add selling costs into the cap (the existing screen's `+ costs` term is a screening artifact — document the difference in a code comment, do not replicate it)

## File allowlist (exact expected diff)

- `js/project-market-study/shared-equity-lifecycle.js` (new)
- `test/shared-equity-lifecycle.test.js` (new)
- `package.json` (add `test:shared-equity-lifecycle`, insert into `test:ci` after `test:ownership-finance`)
- Nothing else. No HTML (no UI in 2a), no `data/` changes, no edits to `ownership-resale.js`, `ownership-finance.js`, or any existing test.

## Tests required (plain Node `assert`, match `test/ownership-finance.test.js` conventions)

**Formula correctness** — hand-computed pinned cases for all six formula types (e.g. fixed_simple $400k/3%/10yr → $520,000; fixed_compound → $537,566; shared_appreciation $400k restricted / $500k market / 25% share / base 3% at 10yr — pin the number you derive by hand and show the derivation in a comment).
**Amortization** — remaining principal at year 5/10/30 for a pinned loan matches closed-form amortization (30yr = ~0 balance).
**Lesser-of** — each leg can bind; appraisal cap binds under `declining`; `appraisalBinding` flag correct.
**Owner outcome** — net proceeds waterfall arithmetic; forgivable subordinate at term → $0 owed; negative-equity flagged under declining; return `null` (not −∞) when proceeds ≤ 0.
**Future buyer** — AMI-indexed formula with `amiGrowth == marketGrowth` keeps `preservesAffordability` stable; fixed 3% with market 6% drifts affordable; fixed 3% with AMI 1% drifts UNaffordable (the assignment's "AMI slower than market" case).
**Scenario matrix** — all 5 scenarios × 4 horizons run with no NaN/undefined anywhere (recursive walk).
**Guardrails** — module source contains no banned strings (`forecast`, `will appreciate`, `projected`, `capture rate`, `absorption`, `sellout`); every result carries `classification: 'modeled'` + `scenarioLabel`; `fromConvention` on APCHA/Elevation entries sets `verifyParameter: true`; no output copy ranks shared equity as "better".
**Integration** — `fromConvention` against the real `data/policy/resale-conventions.json` (read-only) produces results for all three conventions; `futureBuyerIncomeNeeded` agrees with calling `OwnershipFinance.incomeNeededForHomeValue` directly.
**Wiring** — package.json self-check (script exists + in `test:ci`), same pattern as ownership-finance.

## Delivery

One branch, one PR against `main`, squash-merge convention, no unrelated files. PR description: summary, formula derivations for the pinned test values, known limitations (e.g. monthly-vs-annual compounding choices — state them), and any owner decisions needed. Before opening: `npm run test:shared-equity-lifecycle && npm run test:ownership-finance && npm run test:ownership-resale && npm run validate`.

## Acceptance criteria (Claude QA judges exactly this)

1. All six formulas match independently hand-computed values (QA recomputes them cold).
2. Remaining principal is computed (not input) and matches closed-form amortization.
3. The five-scenario × four-horizon matrix is NaN/undefined-free on a realistic Fruita-like input AND on hostile inputs (zero down, 100% subordinate, declining market, 0% rates).
4. Owner outcome and affordability outcome are both reported, never ranked; banned-language greps clean.
5. VERIFY discipline intact for unverified convention parameters.
6. File allowlist respected; existing tests untouched and green; `test:ci` chain green end-to-end.
7. Sabotage checks: QA will break a formula constant, delete a scenario, and remove `classification` — the new suite must fail each time.
