# Scoping Revision 2 — Two-Tier Affordable-Homeownership System + Fruita Commons For-Sale Study

**Type:** Phase 0 plan revision — scope only, no production code changed.
**Author:** Claude Code (QA/architecture)
**Date:** 2026-08-04
**Supersedes/extends:** `docs/audits/SCOPING-FRUITA-COMMONS-FOR-SALE-MARKET-STUDY-2026-08.md` (the base audit + QA Addendum). Read that first; this document revises the *plan*, not the audit.

> **This revision integrates two owner directives:**
> 1. **User-selectable affordability model(s)** — the engine must let the user *choose* the affordability model(s) best matched to the buyer/product/lender, and the repo must *explain the implications of each*. This replaces the earlier "unify to one canonical model" recommendation with a **model registry + comparator + implications explainer** (default still reproduces today's kernel bit-for-bit).
> 2. The **20-point refinement** (two-tier product; land disposition; HRWC stewardship; project + buyer-side funding; capital-stack; needs-based assistance; subsidy waterfall; shared-equity; HOA; effective demand/capture; jurisdictional capacity; data classification), integrated into the existing phases — **not** appended as a list.
>
> No production files are modified. Existing tests and semantic guardrails are preserved. The banned forecast/capture language stays out of `js/hna/ownership-decision-chain.js`; capture/absorption remains in a separate project-market-study layer.

**Companion reference docs (new, 2026-08-04) — feed Phase 3 datasets + Tier-1 output:**
> - `docs/methodology/HOUSING-AUTHORITY-STRUCTURES-AND-POWERS.md` — the structural types of Colorado housing authorities (municipal / county / multijurisdictional / public-developer-affiliated / COG-coalition / limited / trust-CLT) and the powers each brings as an independent quasi-jurisdictional public developer (tax exemption, bonding, taxing, land banking, master-developer, perpetual stewardship). Extends the `housingAuthority` record with `structure_type`/`powers`/`taxing_authority`/`bonding_authority`/`capacity`.
> - `docs/methodology/LOCAL-JURISDICTION-HOUSING-CONTRIBUTIONS.md` — the menu of local contributions (fee **waivers/reductions/deferrals** — tap/PIF, permit, impact, use tax; land/density/parking; trust funds; linkage/in-lieu; TIF/PILOT). Adds the load-bearing **timing** distinction (`waived|reduced|deferred` + `deferral_trigger`) to the project-side funding schema (§5.2) — a deferred tap fee is a carrying-cost benefit, **not** a TDC reduction.
> - `docs/methodology/CDOH-RURAL-URBAN-DESIGNATION-AND-COMPETITIVENESS.md` — the CHFA/DOLA/CDBG/USDA **rural vs urban** designations (repo already carries `urban_rural`), what each means for a jurisdiction, and the **competitiveness checklist** (current HNA → Prop 123 → capacity → match → QAP-aligned design → rural set-aside/USDA). Adds a `funding_competitiveness` block to the jurisdiction record.
> - `docs/methodology/HOUSING-AUTHORITY-STRUCTURES-AND-POWERS.md` §5b — authority **strength/capacity tiers** (active_developer / administrative / **nominal_paper**): existence ≠ capacity; a paper authority can't develop or steward. Adds `capacity_tier` + `activity_evidence` and fires the stewardship-capacity flag.

**Standing principle — Methods exposure & mandatory verification (applies to every phase, every output):**
> Every calculation must **expose its method** (formula, inputs, source, model id, and provenance/confidence label) — no black-box numbers; this is already enforced for HNA surfaces by `test:metric-truth-crosssurface` and the ownership modules' input-echo pattern, and extends to every new surface. Every **modeled / screening / assumed** output must additionally carry an explicit **"verify via a true market study and stakeholder interviews"** flag naming the parties whose input is required — **developer discussions, lender, appraiser, broker, program administrator, and local jurisdiction** — before it is treated as a decision-grade result. The tool sizes and structures; it never asserts a modeled figure as fact. A test asserts the market-study/interview disclosure is present on every Tier-2 demand, capture, pricing, and subsidy output.

---

## 0. What changed since Revision 1 (verified against repo, 2026-08-04)

- **Affordability is now multi-model + user-selected**, not single-canonical. (Owner directive; see §1.)
- **Two explicit tiers**: Tier 1 jurisdictional assessment (every CoHO jurisdiction) and Tier 2 project market study (Fruita Commons first). (§2)
- **Fruita Housing Authority is real and already active.** `data/jurisdiction-briefs/0828745.json` documents the **Fruita Housing Authority ("FHA")**, which delivered **Fruita Mews** — a 50-unit LIHTC *rental* development. **Fruita Commons (50-unit for-sale) is the ownership sibling.** ⚠️ **Naming collision to resolve in schema:** "FHA" = *Fruita Housing Authority* in the land-control context, but the mortgage context also uses "FHA" = *Federal Housing Administration* insured loan. The schemas below disambiguate with `fruita_housing_authority` vs `fha_insured_mortgage`.
- **HRWC exists in-repo** (`data/hna/local-resources.json` → "Housing Resources of Western Colorado", `hrwc.net`) but only as `{name, url}` — needs enrichment to a stewardship/provider record.
- **Provider structure already exists and is geo-keyed** (`local-resources.json` keyed `state:08 / county:08077 / place:0828745`, with `housingAuthority[]`, `advocacy[]`, `prop123.status`). Extend it — do not invent a provider store.
- **Commitment-status vocabulary already exists**: `local-resources.json` uses `prop123.status: "Committed"`. Formalize the fuller enum (§ data classification) from this precedent.
- **Prop 123 is already encoded** (`data/policy/prop123_jurisdictions.json`) and the Deal Calculator already has a subordinate soft-funding stack pattern (CHFA HTF / Prop 123 / local PHA / sponsor loan / impact fees — `deal-calculator.js:3311`). Extend that pattern for ownership; USDA RD and FHLBank Topeka are **not** yet encoded.
- **Data bug flagged:** the Fruita `place:0828745` record in `local-resources.json` is **contaminated with Eagle County / Vail Health / Eagle County Schools** entries (wrong region). Fix in Phase 3 as part of the provider-data pass.

---

## 1. Revision Theme 1 — user-selectable affordability models + implications engine

**Directive:** *"allow the user to identify the affordability model or models for the best outcome and the repo to instruct the user on the implications of each."*

**Design:** a **model registry** (`data/policy/affordability-models.json`) consumed by the Phase 1 finance kernel. The kernel takes a `modelId` (or an array for comparison) and resolves its parameter set. The UI presents a selector, a side-by-side comparator, and an **implications panel** generated from each model's documented `implications` block.

**Guardrail (critical — bake into copy and tests):** "best outcome" means **best-matched to the actual buyer, product, and lender — not the model that makes the project pencil.** A more permissive model (higher DTI, lower down payment) shows more buying power but **transfers risk to the buyer** (higher payment-to-income, thinner equity, higher default exposure, and often lender/appraisal friction). The implications panel must state this every time, and a test must assert the tool never auto-selects the most permissive model or labels a permissive result as "affordable" without the risk disclosure. This is consistent with the repo's screening-honesty ethos and the existing banned-phrase discipline.

### Model registry (initial set)

| Model id | Name | Down | Housing ratio | Insurance | PMI/MIP | Best matched to | Effect on gap |
|---|---|---|---|---|---|---|---|
| `conservative_screening` | Conservative screening (**default**) | 10% | 30% front-end | 0.35% | PMI 0.5% | Screening / below-market for-sale planning | Most conservative; largest gap. **Reproduces today's kernel.** |
| `first_time_buyer` | First-time buyer | 5% | 30% front-end | 0.85% | PMI | FTB with DPA | Lower down → lower cash, higher payment; PMI drag |
| `conventional_dti` | Conventional lender DTI | 20% | 43% back-end | 0.85% | none | Move-up buyer, no other debt | Most permissive; smallest gap — **risk-transfer warning required** |
| `fha_insured` | Federal FHA-insured | 3.5% | 43–50% back-end | 0.85% | MIP (upfront + annual) | Credit-constrained FTB | Low cash; MIP raises monthly cost |
| `usda_rd` | USDA Rural Development | 0% | 29/41 ratios | — | guarantee fee | Income-eligible rural buyers (Fruita qualifies) | 0% down; strict income caps + site eligibility |
| `custom` | Custom | user | user | user | user | Advanced/underwriter | User owns all assumptions |

Each registry entry carries: `params` (rate, term, downPct, housingRatioType `front|back`, ratio, taxRate, insRate, pmiRate/mipRate, hoaMonthly, groundRentMonthly, borrowerMonthlyDebt), `implications` (who-it-fits, gap-direction, buyer-risk, lender/appraisal acceptance, when-not-to-use), `source`, `last_verified`, `classification` (modeled).

**Backward-compat contract (unchanged):** `maxAffordablePrice(ami, pct)` with no `modelId` resolves `conservative_screening` and returns the identical number (`289983` golden fixture, `test/hna-ownership-need.test.js:268`).

**Comparator output (grounded example, Fruita, Mesa AMI $97,600, Fruita ZHVI $486,295):** at 100% AMI, `conservative_screening` → max price $353,780 (gap −$132,515) while `conventional_dti` → $554,556 (surplus +$68,261). **Break-even AMI: 137% vs 88%.** The comparator shows this spread and the implications so the user sees the risk trade-off explicitly, not a single number.

---

## 2. Two-tier product architecture (integration map)

| | Tier 1 — Jurisdictional Assessment | Tier 2 — Project Market Study |
|---|---|---|
| Scope | Every supported CoHO jurisdiction | A selected site/scenario (Fruita Commons first) |
| Home | `housing-needs-assessment.html` ownership section (extend) | New `for-sale-market-study.html` + `js/project-market-study/` |
| Reads | `HNAOwnershipNeed`, model registry, `local-resources.json`, funding datasets | Everything Tier 1 has + `computeForSaleFeasibility`, capture module, lifecycle engine, scenario store |
| Writes back to HNA/decision-chain | **never** | **never** |
| Forecast/capture language | forbidden (guardrail) | allowed **only** inside `js/project-market-study/` files (new ban-scan keeps it from leaking into HNA files) |
| Output | ownership-strategy result (§16 of the refinement) — "not a completed market study" | full market study + export (§17) |

---

## 3. Revised phase sequence (11 phases) and dependency rationale

The refinement's 11-phase sequence is adopted with these dependency-driven adjustments (each justified):

- **Phase 1 becomes multi-model** (registry + comparator + implications), not single-model unification. *Reason: owner directive; and a registry is a cleaner backward-compat vehicle than a hard swap.*
- **Land disposition (§6), subsidy waterfall (§11), and HOA (§13) fold into Phase 2** (the lifecycle/land-control engine) because they are all resale/carrying-cost math on the same objects. *Reason: cohesion; avoids a separate pass over the same functions.*
- **The public-finance/tenure-structure layer** (Revision-1 "Phase 2.5") is split: tenure-structure math → Phase 2; funding **datasets** (project + buyer side) → Phase 3. *Reason: math vs data separation, matching the repo's module/dataset split.*
- **Provider/stewardship + funding datasets are Phase 3** (before Fruita scenario Phase 4), because the scenario references them. *Reason: dependency order.*
- **Effective demand (Phase 6) and capture (Phase 7) stay after the scenario (Phase 4/5)** and remain **screening-grade** until a for-sale supply/pipeline data source + primary research exist (QA Addendum A4). *Reason: data constraint, not code.*

| Phase | Title | Refinement sections covered | Blocked by |
|---|---|---|---|
| 0 | Audit (this doc + base audit) | 1,2,19 | — |
| 1 | Multi-model ownership finance engine | 1(theme), buyer-cost parts of 13 | — |
| 2 | Shared-equity + land-control + waterfall + HOA lifecycle engine | 6, 11, 12, 13 | P1 |
| 3 | Jurisdictional dataset + provider/funding/stewardship schema | 7, 8, 9, 15, 18 | — (parallel to P1/P2) |
| 4 | Fruita Commons scenario (unit/cost/land/HOA/funding/assistance) | 4, 5, 10 | P1,P2,P3 |
| 5 | Tier-1 jurisdictional gap & ownership-strategy interface | 3(Tier1), 16 | P1,P3 |
| 6 | Project effective-demand funnel | 14 (funnel) | P4 |
| 7 | Project capture / absorption / phased sales | 14 (capture) | P6 + supply data |
| 8 | Shared-equity + land-control + subsidy-stack comparison UI | 6, 9, 11, 12 | P2,P4 |
| 9 | Fruita Commons market study + report export | 17 | P4–P8 |
| 10 | Statewide project reuse | 3(Tier2 reuse) | P9 |
| 11 | Independent legal/lender/appraiser/admin/methodology/a11y/perf QA | all | P9 |

---

## 4. Phase-change matrix

Format: **added requirement · affected files · affected datasets · new tests · acceptance · new dependencies · implementation risk.**

### Phase 1 — Multi-model finance engine
- **Added:** model registry + selector + comparator + implications; buyer-cash-required, HOA/ground-rent/back-end-DTI/MIP options.
- **Files:** new `js/hna/ownership-finance.js`; `hna-ownership-need.js` (re-export), `deal-calculator.js:173`, `affordability-metrics-panel.js`, `hna-utils.js:1137` (delegate).
- **Datasets:** new `data/policy/affordability-models.json`.
- **Tests:** new `test/ownership-finance.test.js` — golden-value `maxAffordablePrice(100000,0.80)===289983` unchanged; each model monotonic (higher rate/HOA/tax/DTI-debt lowers price; larger down raises price); comparator returns all models; **"never auto-select most permissive" + "risk disclosure present on permissive result"**; percent/decimal not silently mixed.
- **Acceptance:** all existing ownership/deal-calc tests pass unchanged; default two-arg call identical; implications render for every model.
- **Dependencies:** none (pure).
- **Risk:** low. Main risk = accidental default drift → caught by golden fixture.

### Phase 2 — Shared-equity + land-control + waterfall + HOA lifecycle
- **Added:** compound/AMI/CPI/lesser-of/appraisal-cap formulas; land-disposition Models A–D (§6); configurable resale waterfall (§11); HOA/reserves/special-assessment/escalation as primary variables (§13); 5/10/20/30-yr × low/base/high/flat/declining scenarios.
- **Files:** new `js/project-market-study/shared-equity-lifecycle.js`, `js/project-market-study/land-disposition.js`, `js/project-market-study/resale-waterfall.js`; extend `js/hna/ownership-resale.js` (compat re-export only).
- **Datasets:** extend `data/policy/resale-conventions.json` (add compound/AMI/CPI/appraisal params, keep VERIFY discipline); new `data/policy/land-disposition-models.json`.
- **Tests:** extend `test/ownership-resale.test.js`; new `test/shared-equity-lifecycle.test.js`, `test/resale-waterfall.test.js`, `test/land-disposition.test.js` — waterfall never pays a source twice; "full recapture + large appreciation share" flagged when owner net goes non-transparent (§11 rule); preservation comparison on **all** conventions; HOA increase lowers buyer power; ban `forecast/projected/will appreciate` retained.
- **Acceptance:** 15 shared-equity models × 4 horizons × 5 markets; land Models A–D each return the §6 assessment fields; sensitivity matrix.
- **Dependencies:** P1 (kernel for future-buyer affordability).
- **Risk:** medium — formula correctness + legal validity; gated by Phase 11 legal review; parameters stay VERIFY until dated.

### Phase 3 — Jurisdictional dataset + provider/funding/stewardship schema
- **Added:** unified funding-source dataset (project + buyer side, §8); provider/stewardship relationships (§7 HRWC, §15) with commitment status (§18); needs-based buyer-assistance parameters (§10); HRWC deferred-loan schema (§7).
- **Files:** none (data + a loader in `js/project-market-study/` if needed for validation).
- **Datasets:** extend `data/hna/local-resources.json` (enrich provider records incl. HRWC + **housing-authority `structure_type`/powers per `HOUSING-AUTHORITY-STRUCTURES-AND-POWERS.md`**; **fix the Eagle-County contamination in `place:0828745`**); extend `data/policy/developer-ownership-funding.json` (add DOLA Prop 123 new-construction, FHLBank Topeka AHP/HSP, CHFA construction/first-mortgage/DPA, USDA RD 502 direct/guaranteed, employer/CRA/foundation, **+ local-jurisdiction contributions with `contribution_mechanism`/`timing`/`deferral_trigger` per `LOCAL-JURISDICTION-HOUSING-CONTRIBUTIONS.md`**) and `data/policy/homeownership-programs.json` (buyer side); new `data/policy/buyer-assistance-programs.json`, `data/policy/stewardship-providers.json`. Per-jurisdiction contribution/authority data may attach to `data/policy/jurisdiction-housing-progress.json` (`by_geoid`).
- **Tests:** new `test/funding-sources-schema.test.js`, `test/stewardship-providers.test.js`, `test/policy-data-currency.test.js` (extend) — every source has classification + commitment status + verified `source_url` + `last_verified`; **"available" ≠ counted**; no consumer/developer data duplication (extend `ownership-decision-chain.test.js:110`); HRWC not hard-coded outside its service area (§15).
- **Acceptance:** each source/provider record validates against schema; Fruita record region-correct; unverified terms render VERIFY.
- **Dependencies:** none.
- **Risk:** medium — data verification burden; every dollar term needs a dated source (VERIFY otherwise).

### Phase 4 — Fruita Commons scenario
- **Added:** editable scenario (units/bedroom mix/sizes/AMI mix/TDC/land/HOA/funding/assistance); the preliminary Fruita scenario (§5) + 3 comparison scenarios (compact / family-weighted / broad-income).
- **Files:** none (fixture + scenario namespace on `window.SubjectProject`).
- **Datasets:** new `data/fixtures/fruita-commons.scenario.json` (+ 3 comparison variants); provenance manifest `data/provenance/for-sale-market-study.json`.
- **Tests:** new `test/fruita-commons-scenario.test.js` — fixtures never leak into statewide defaults; scenario sums reconcile (§9 sources=uses); each field carries a classification.
- **Acceptance:** scenario loads, all four §5 scenarios compute per-unit price/subsidy/HOA/buyer-cash; comparison table renders.
- **Dependencies:** P1,P2,P3.
- **Risk:** low-medium — depends on real developer inputs (open questions).

### Phase 5 — Tier-1 jurisdictional interface
- **Added:** AMI/income ladder, affordable price by AMI, income-required-for-local-prices, gap, % and # priced out, owner supply by band, renter bands, FTB screening pool, local programs, stewardship capacity, public land, preliminary strategy, "requires site study" flags (§16).
- **Files:** extend `js/hna/hna-renderers.js`, `js/hna/hna-controller.js` (Tier-1 ownership section).
- **Datasets:** consumes P3 datasets + `county-ownership.json`.
- **Tests:** new `test/jurisdictional-ownership-strategy.test.js` — place-scoped pricing (provenance pill), never county-masked for a place; "not a completed market study" disclaimer present; stewardship-capacity "not established" flag when no provider.
- **Acceptance:** renders for a county AND a place; place uses place values; every jurisdiction gets the §16 result.
- **Dependencies:** P1,P3.
- **Risk:** medium — place-vs-county masking is the repo's recurring bug; strong pill tests required.

### Phase 6 — Effective-demand funnel
- **Added:** observed→modeled funnel with explicit editable reductions (§14); by AMI/unit type/bedroom.
- **Files:** new `js/project-market-study/effective-demand.js`.
- **Tests:** new `test/effective-demand-funnel.test.js` — observed and modeled stages distinct; no stage silently dropped; values cannot increase unless allowed; missing data → unavailable not zero; modeled reductions excluded from observed labels.
- **Acceptance:** funnel renders each stage with source class; every reduction editable + documented + sensitivity-tested.
- **Dependencies:** P4.
- **Risk:** **high** — no household-level credit/savings data exists; must be labeled modeled/screening; can't reach study-grade without primary research.

### Phase 7 — Capture / absorption / phased sales
- **Added:** annual capture, total penetration, 24/30/36/48-mo sellout, monthly/annual sales, fallout-adjusted gross contracts, capture by AMI/type/bedroom (§14).
- **Files:** new `js/project-market-study/forsale-capture.js` (separate UI boundary).
- **Tests:** new `test/forsale-capture.test.js` — denominator visible; annual capture ≠ total penetration; sellout math; fallout increases required contracts; **no universal acceptable-capture threshold**; **HNA ban test still passes + new ban-leak scan** (capture vocab confined to `js/project-market-study/`).
- **Acceptance:** all scenarios compute; denominator + assumptions always shown.
- **Dependencies:** P6 + **a for-sale competitive/pipeline supply data source (currently missing)**.
- **Risk:** **high** — data + primary research; screening-grade until acquired.

### Phase 8 — Comparison interface (shared-equity + land + subsidy stack)
- **Added:** side-by-side of land Models A–D, shared-equity models, and capital-stack (§9 four categories).
- **Files:** extend `for-sale-market-study.html`; `js/project-market-study/` renderers.
- **Tests:** new `test/capital-stack-reconciliation.test.js` — total sources = total uses; per-buyer contract price = first mortgage + subordinate + grants + buyer cash; no double count across categories A–D.
- **Acceptance:** comparison renders; reconciliation holds for every scenario.
- **Dependencies:** P2,P4.
- **Risk:** medium.

### Phase 9 — Fruita Commons study + export
- **Added:** the §17 recommendation output + exportable report with source/assumption classifications.
- **Files:** new report renderer reusing `js/hna/hna-export.js` patterns.
- **Tests:** new `test/fruita-study-export.test.js` — export carries provenance + commitment status; screening caveats present; hypothesis labeled as hypothesis.
- **Acceptance:** report exports; every figure classified; "hypothesis to test" framing intact.
- **Dependencies:** P4–P8.
- **Risk:** medium.

### Phase 10 — Statewide reuse · Phase 11 — Independent QA
- As Revision 1 §15 P9/P10, plus consumer-protection + legal/lender/appraiser/administrator review of the shared-equity and land-control outputs.

---

## 5. Data schemas (required response items 6–8)

All schemas reuse the existing provenance enum (`raw|transformed|modeled|live` from `js/components/source-badge.js`) plus the two enums below. Dollar terms are `null` + render "VERIFY" until dated.

### 5.1 Classification + commitment-status enums (§18)
```jsonc
// data provenance (existing): "classification": "observed|derived|modeled|user_entered|not_available"
//   observed≈raw, derived≈transformed, modeled=modeled (source-badge)
// funding/program commitment (formalize from local-resources prop123.status "Committed"):
"commitment_status": "available|anticipated|application_pending|awarded|committed|expired|unverified"
// RULE: only awarded|committed may be counted as a project source. available|anticipated are context only.
```

### 5.2 Unified funding-source schema (§8, project + buyer side)
```jsonc
{
  "id": "dola-prop123-newconstruction",
  "name": "DOLA Proposition 123 — Affordable Homeownership / New Construction",
  "funding_type": "grant|deferred_loan|equity|guarantee|in_kind|fee_waiver|land",
  "side": "project|buyer",                       // capital-stack category driver
  "capital_stack_category": "A_land|B_project_gap|C_buyer_gap|D_cash_to_close",
  "eligible_applicant": "housing_authority|developer|nonprofit|clt|buyer",
  "eligible_buyer_ami_max": 1.20,                 // decimal AMI; null if project-side
  "eligible_geography": ["08077","0828745"],      // fips/geoids or "statewide"
  "max_per_household": null, "max_per_project": null,   // VERIFY until dated
  "affordability_period_years": null,
  "lien_or_recapture": { "type": "recapture|retention|shared_appreciation|none", "terms": "VERIFY" },
  "application_cycle": "rolling|annual|competitive", "commitment_status": "available",
  "stacking_constraints": ["not_with:usda_rd_502_direct"],
  "source_url": "https://...", "last_verified": "2026-08-04",
  "classification": "modeled|observed|user_entered"
}
```

### 5.3 HRWC deferred buyer-assistance schema (§7) — a `buyer-assistance-programs.json` entry
```jsonc
{
  "id": "hrwc-deferred-second",
  "provider": "Housing Resources of Western Colorado",
  "provider_url": "https://hrwc.net/",
  "side": "buyer", "funding_type": "deferred_loan",
  "max_assistance": null, "interest_rate": null, "monthly_payment": 0,
  "repayment_trigger": "sale|refinance|non_owner_occupancy|maturity",
  "lien_priority": "subordinate", "term_years": null,
  "appreciation_share": null, "recapture_amount": null, "forgiveness": null,
  "eligible_income_ami_max": null, "eligible_geography": ["western_colorado"],
  "homebuyer_education_required": true, "primary_residence_required": true,
  "lender_combination_rules": "VERIFY",
  "commitment_status": "unverified",              // NOT committed to Fruita Commons unless awarded
  "project_specific_commitments": [],             // separate workflow (§7): add awarded commitments here
  "source_url": "https://hrwc.net/", "last_verified": null, "classification": "modeled"
}
```
> **Guardrail (§7):** general HRWC *availability* must never auto-populate a Fruita Commons *commitment*. `project_specific_commitments[]` is a separate, awarded-only list.

### 5.4 Stewardship-provider / jurisdiction relationship (§15) — extend `local-resources.json`
```jsonc
"place:0828745": {
  "stewardship_providers": [{
    "name": "Housing Resources of Western Colorado", "url": "https://hrwc.net/",
    "geography_served": ["western_colorado","08077"],
    "roles": ["homebuyer_education","counseling","credit_readiness","dpa_origination",
              "loan_servicing","owner_occupancy_monitoring","resale_administration",
              "foreclosure_intervention","program_stewardship"],
    "programs": ["hrwc-deferred-second"], "eligibility": "VERIFY",
    "commitment_status": "available", "source": "hrwc.net", "last_verified": "2026-08-04"
  }],
  "stewardship_capacity": "established"           // else flag "Permanent ownership stewardship capacity not established"
}
```

### 5.5 Capital-stack schema (§9, four non-overlapping categories)
```jsonc
{
  "A_land": { "market_land_value": null, "contributed_value": null, "ground_lease_discount": null, "per_unit_land_subsidy": null },
  "B_project_gap": { "tdc": null, "net_sales_revenue": null, "project_grants": [], "infrastructure": [], "construction_financing_benefit": null, "developer_side_ahp_or_state": [], "remaining_project_gap": null },
  "C_buyer_gap": { "contract_price": null, "first_mortgage": null, "buyer_cash": null, "subordinate_sources": [], "remaining_buyer_gap": null },
  "D_cash_to_close": { "down_payment": null, "closing_costs": null, "prepaids": null, "initial_reserves": null, "grants": [], "buyer_cash": null, "remaining_cash_need": null }
}
// TEST: sum(dev sources)=sum(dev uses); per buyer: contract_price = first_mortgage + subordinate + grants + buyer_cash. No source in >1 category.
```

### 5.6 Needs-based buyer-assistance allocation (§10)
```jsonc
{ "ami_band": "70-80", "assistance_range": [75000,110000],   // editable scenario range, NOT a commitment/limit
  "inputs": ["unit_price","household_income","first_mortgage_capacity","down_payment","closing_costs",
             "household_debt","first_mortgage_product","other_assistance","max_combined_ltv","program_limits"],
  "stackable": null }   // computed: financially + legally stackable?
```

### 5.7 Land-disposition model schema (§6)
```jsonc
{ "id": "model_a_public_land_retention",
  "assessments": { "initial_per_unit_benefit": null, "appraised_value_treatment": "VERIFY",
    "buyer_mortgageability": "VERIFY", "property_tax_implication": "exempt_while_authority_owns|restricted_value|full",
    "ground_rent_burden": null, "future_affordability": null, "public_control": "high|medium|none",
    "foreclosure_exposure": null, "resale_administration": null, "steward_replaceability": null,
    "public_subsidy_preservation": null, "admin_cost": null, "buyer_acceptance": null,
    "legal_complexity": null, "failure_risk": null } }
// Models A (retention/99-yr ground lease/CLT), B (discounted lot + covenant + recapture), C (full sale + deed restriction), D (master ground lease to steward).
```

### 5.8 Shared-equity + resale waterfall (§11/§12)
```jsonc
// resale waterfall (ordered, configurable):
["selling_costs","first_mortgage","return_buyer_down_payment?","capital_improvement_credit",
 "deferred_subordinate_loans","public_appreciation_share","net_seller_proceeds",
 "public_subsidy_retained_or_recaptured","next_buyer_restricted_price","next_buyer_additional_subsidy"]
// RULE: full subsidy repayment + large appreciation share only allowed if owner net stays transparent (test asserts a warning flag).
```

---

## 6. Fruita Commons implementation path (Tier 2)

1. **P1** select models — default `conservative_screening`; compare `first_time_buyer`, `usda_rd` (Fruita is rural-eligible), `fha_insured`.
2. **P3** enrich Fruita provider record (fix contamination; add HRWC stewardship, Fruita Housing Authority land, Prop 123 "Committed" already present).
3. **P4** load `fruita-commons.scenario.json` (50 units; the §5 unit/AMI mix) + 3 comparison scenarios; land = Fruita Housing Authority parcel (Model A hypothesis).
4. **P2/P8** test land Models A–D + shared-equity models; HOA range $175–$225 as a primary variable.
5. **P6/P7** effective demand + capture — **screening-grade, labeled**, pending supply data + primary research.
6. **P9** produce the §17 recommendation (unit mix, AMI mix, prices, subsidy, land structure, resale formula, HRWC role, FHA-insured vs Fruita-Housing-Authority roles disambiguated, HOA, stewardship, phasing, capture) as a **hypothesis to test**, exportable with classifications.

## 7. Statewide jurisdictional implementation path (Tier 1)

`local-resources.json` (geo-keyed) + funding datasets + model registry drive a per-jurisdiction §16 ownership-strategy result for every place/county. HRWC is scoped to Western Colorado only (`geography_served`); jurisdictions with no identified steward render **"Permanent ownership stewardship capacity not established."** No jurisdiction result is presented as a completed market study.

---

## 8. Test additions (summary)

Per-phase tests listed in §4. Cross-cutting new tests: model-registry monotonicity + no-auto-permissive; capital-stack reconciliation (sources=uses); commitment-status ("available"≠counted); provider-region correctness; place-scoped pricing; ban-leak scan (capture vocab confined to `js/project-market-study/`); waterfall no-double-pay + owner-net-transparency. **All existing tests preserved; none weakened.**

---

## 9. Open policy / underwriting decisions requiring human direction

1. **Which affordability models** appear in the registry and which is default (recommend `conservative_screening` default; enable `usda_rd`/`first_time_buyer`/`fha_insured` for Fruita).
2. **Reconcile the conflicting Fruita figures** (§4 of refinement): AMI $94,100 (script) vs $97,600 (repo/HUD); income $74k–$87k; price $486k (Fruita ZHVI) vs $505k (county) vs $536–594k (unsourced). Assign authoritative use per measure (value vs listing vs closed-sale) and vintage. **Trace the 87.3%/82.2% priced-out figures** before production.
3. **Land-disposition decision** — the hypothesis is Fruita Housing Authority retention (Model A / 99-yr ground lease). The tool must *test* it, not assume it.
4. **HRWC role & terms** — provisional until verified/dated; project-specific commitment requires an award, not advertised availability.
5. **"FHA" disambiguation** in all Fruita copy — Fruita Housing Authority vs Federal Housing Administration mortgage.
6. **Funding terms** — DOLA Prop 123 new-construction, FHLBank Topeka AHP/HSP, CHFA, USDA RD 502 dollar/percentage terms + stacking — all VERIFY until dated with a source.
7. **Capture threshold** — none to be invented; owner/analyst supplies market judgment.
8. Bond counsel / financial advisor / appraiser / assessor validation of the tenure-structure and property-tax outcomes (Phase 11).

---

## 10. Revised exact prompt for the next implementation phase (Phase 1)

> **Task:** Implement Phase 1 — a multi-model homeownership affordability engine. Create `js/hna/ownership-finance.js` (pure; `window.OwnershipFinance` + `module.exports`, mirroring `js/deal-calculator-math.js`) and `data/policy/affordability-models.json` (the model registry in Revision-2 §1). Route the three existing formulas through the engine **without changing any current output**.
>
> **Do:**
> 1. Move the math of `maxAffordablePrice`/`monthlyMortgageFactor`/`incomeNeededForHomeValue` (`js/hna/hna-ownership-need.js:258-328`) into the engine. Add a `modelId` argument (default `conservative_screening`) resolving params from `affordability-models.json`; support `hoaMonthly`, `groundRentMonthly`, `closingCostRate`, `backEndDtiRatio`, `borrowerMonthlyDebt`, `pmiLtvGate`, `mipRate` — all defaulting so a call with no model reproduces today's number. Add outputs `buyerCashRequired`, `maxLoan`.
> 2. Add `compareModels(ami4Person, amiPct, [modelIds])` returning per-model price + gap + the `implications` block, and a helper that **refuses to auto-select the most permissive model** and always attaches the buyer-risk disclosure to permissive results.
> 3. Populate `affordability-models.json` with `conservative_screening` (default, = current constants), `first_time_buyer`, `conventional_dti`, `fha_insured`, `usda_rd`, `custom`; each with `params`, `implications` (who-it-fits / gap-direction / buyer-risk / lender+appraisal acceptance / when-not-to-use), `source`, `last_verified`, `classification:"modeled"`.
> 4. Have `hna-ownership-need.js`, `deal-calculator.js:173`, `affordability-metrics-panel.js`, and `hna-utils.js:1137` delegate to the engine (panel keeps its ratio display, sources `required_hhi_for_home` from the engine).
> 5. Write `test/ownership-finance.test.js` (plain Node `assert`); wire `test:ownership-finance` into the `test:ci` chain.
>
> **Backward-compat contract (hard):** `OwnershipFinance.maxAffordablePrice(100000, 0.80) === 289983`; every assertion in `test/hna-ownership-need.test.js`, `test/deal-calc-for-sale-feasibility.test.js`, `test/ownership-resale.test.js`, `test/ownership-decision-chain.test.js` passes **unchanged**. Do not weaken any existing test.
>
> **Do NOT:** add Tier-2 UI, demand funnel, capture, lifecycle, land-disposition, funding datasets, or scenario code (later phases); introduce `forecast`/`capture rate`/`time-phasing` into any `js/hna/` file; auto-select the most permissive model; hard-code any Fruita value; touch `data/` beyond adding `affordability-models.json`, or any `scripts/`/workflow/deploy-gate file.
>
> **Before PR:** `npm run test:ownership-finance && npm run test:hna-ownership-need && npm run test:ownership-resale && npm run test:ownership-decision-chain && npm run test:deal-calc-for-sale-feasibility && npm run validate`.

---

## 11. Known gaps still to close (self-audit, 2026-08-04)

The plan's spine — affordability, gap, subsidy, shared-equity, land/tenure structure, funding, provider/authority, rural-urban competitiveness — is strong. The remaining gaps cluster in **for-sale development economics, Colorado-specific for-sale legal/product realities, long-run program operations, and a few strategic gates.** Severity: 🔴 first-order · 🟠 needed for study-grade · 🟡 enhancement. "(absent)" = verified 0 files in repo; "(thin)" = 1–2.

### For-sale development economics (the plan leans on rental machinery)
- 🔴 **For-sale development cash-flow pro forma over the sellout (partial).** The plan reuses the Deal Calculator's rental **NOI** + a **per-unit gap**; a for-sale deal is a **sources-and-uses + construction-carry + sales-revenue-timing** model over a 24–48-month sellout. This is a distinct pro forma that must be specified (add to Phase 2/4), not approximated by a per-unit gap.
- 🔴 **Developer fee / return + fee-reasonableness (absent).** No for-sale developer-return line or public-deal fee cap. Needed for a real capital stack.
- 🟠 **Internal cross-subsidy across the AMI mix (thin).** Higher-AMI units (100–120%) subsidizing lower-AMI units is a primary funding source the plan lists as a mix but doesn't compute.
- 🟠 **Escalation over the timeline.** Construction-cost, price, AMI, and rate drift across the build-and-sell period are not modeled (rates/AMI move the qualifying pool between month 1 and month 36).

### Colorado-specific for-sale legal / product realities
- 🔴 **Construction-defect law (CDARA) for attached for-sale (absent).** Colorado's construction-defect litigation environment historically chilled condo development and drives insurance and financing for attached for-sale product. First-order for a townhome/condo project — must be a disclosed risk + a build-form decision input.
- 🔴 **Condo vs fee-simple-townhome ownership form + mortgage warrantability (thin).** Condominium (condo-map) vs fee-simple townhome changes HOA, financing (FHA/Fannie **condo project approval / warrantability**), and construction-defect exposure. A first-order product decision the plan currently treats loosely as "townhome."
- 🟠 **Fair-housing / local-preference legal risk (thin).** Residency/employment **local preferences** and income/credit **eligibility screens** carry disparate-impact / fair-housing exposure; needs an AFHMP + preference-policy review gate (Phase 11) surfaced earlier.

### Long-run program operations
- 🔴 **Ongoing (30-year) stewardship funding model (absent).** The plan funds stewardship *startup* but not the **annual** cost of monitoring occupancy, administering resales, and enforcing restrictions for decades — a per-unit annual admin fee and its funding source. Sustainability of the whole model depends on this.
- 🟠 **Buyer pipeline / lottery / selection + affirmative marketing (thin).** Demand realization runs through a managed waitlist/lottery (an HRWC role) — the operational bridge between "effective demand" and "closings."
- 🟡 **Refinance / HELOC equity-strip policy + owner-occupancy enforcement over decades** — in the failure register but not modeled as policy parameters.

### Strategic gates & calibration
- 🟠 **"Should this even be for-sale?" gate + subsidy opportunity-cost vs rental (thin).** The project layer assumes for-sale is chosen. Add a tenure-appropriateness gate and a **same-subsidy rental-vs-ownership** comparison (deeper affordability vs wealth-building) so the tool doesn't push ownership where rental serves the need better. Ties to the existing HNA tenure-mix screen.
- 🟠 **Peer for-sale deed-restricted outcome calibration (absent).** The rental side is benchmarked (EPS, Mesa Root Policy, Fruita Mews PMA); the for-sale side has **no** calibration against real CO deed-restricted for-sale outcomes (absorption, resale velocity, owner returns — Elevation CLT, mountain-town programs, Habitat). Without it, demand/capture/lifecycle outputs are un-anchored.

### Environmental / site constraints (Western CO)
- 🟠 **Water / tap *availability* (not just fee).** Western Colorado water rights/tap availability can gate units regardless of fee — model as a feasibility constraint, not only a cost.
- 🟡 **Insurance *availability* (wildfire uninsurability), not just rate.** Some CO areas are becoming hard to insure — a gate on top of the premium assumption (G5).

### Repo / process
- 🟡 **Precompute + methodology-version stamping.** Statewide outputs must extend the precomputed `ownership-need.json` pattern (not per-request compute; G16) and stamp `data/policy/methodology-version.json` (exists) for every new method.
- 🟡 **Statewide ownership-gap comparison/ranking** (like the HNA ranking) so jurisdictions can be compared, with the coverage caveats.

### Already logged (statewide readiness review — not repeated here)
Household-size AMI (G1), priced-out traceability (G2), rate as a parameter (G3), insurance/tax currency (G5), for-sale supply data + primary research (Phases 6–7), and statewide funding/provider/pricing coverage. See `docs/audits/STATEWIDE-READINESS-AND-GAP-REVIEW-2026-08.md`.

**Phasing impact:** the 🔴 items belong in **Phase 2/4** (for-sale pro forma, developer fee, stewardship funding model) and **Phase 11 / risk register** (CDARA, condo warrantability, fair-housing) — none block **Phase 1**, which stays the finance kernel + model registry.

## Readiness

**The revised plan is READY TO PROCEED.** It preserves the existing architecture, tests, and guardrails; integrates the multi-model directive and all 20 refinement points into the phases (not as an appendix); and identifies exact integration points (`ownership-finance.js`, `affordability-models.json`, `local-resources.json`, `developer-ownership-funding.json`, `data/provenance/`).

**Next smallest safe implementation phase:** **Phase 1** exactly as prompted in §10 — a pure, additive, fully backward-compatible finance engine + model registry, no UI, no forecasting, one new dataset, one new test file. It is the foundation every later phase depends on and carries the lowest risk (a golden-value fixture guarantees no behavioral drift).

> Implementation is **not** authorized by this document. This is Phase 0 planning only. Await explicit go-ahead to open the Phase 1 PR.
