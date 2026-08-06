# Fruita Commons — Step-by-Step Screening & Data Guide

**Audience:** the Fruita Housing Authority / project owner. Practical, in order, with the real numbers the tool computes today.
**Companion to:** `FRUITA-COMMONS-FORSALE-STUDY-USER-GUIDE.md` (concepts). This document is the *operating* guide: what to click, what the numbers mean, what data to gather, who to call, and what each input unlocks.
**Status of the tool:** Phases 1–9 are live. Everything below runs today at cohoanalytics.com.

---

## Part A — Run the screening (about 30 minutes, no data needed)

### Step 1. Jurisdiction screen (Tier 1)
Open **housing-needs-assessment.html**, select **Fruita (city)**. In the Affordable Ownership Need section read, in order:
1. **The Ownership Strategy ladder** — income and maximum affordable price per AMI tier under the conservative default model. Check the **provenance pill says place-scope** (Fruita's own $486,295 ZHVI, never Mesa County's number).
2. **The model selector** — switch models to see the sensitivity. Under the conservative model the Fruita median needs **~$134,000 of income (137% of AMI)**; under the 20%-down/43%-DTI conventional model, break-even drops to ~88% AMI. Read the buyer-risk note that appears on permissive models — that spread is a risk-transfer choice, not a free improvement.
3. **Programs, stewardship, authority capacity** — Fruita's Prop 123 shows *Committed*; HRWC appears as an *available* steward (candidate, not a commitment); Fruita Housing Authority shows structure `municipal`, capacity `administrative` (active-via-partnership — Fruita Mews is the evidence).
4. **The tenure recommendation** — reused from the validated HNA screen, not recomputed.

### Step 2. Project screen (Tier 2)
Open **for-sale-market-study.html**. Walk the seven sections:

- **S1 — Scenario comparison.** Baseline = the preliminary 50-unit program (4×1BR flex / 22×2BR / 22×3BR / 2×4BR; AMI mix 10/15/15/10 across 70–120%). Compare the compact, family-weighted, and broad-income variants. **Read the assistance findings column:** the 90–100% band shows **`insufficient`** — its computed gap (~**$150,204**/unit at the band midpoint) exceeds the planned $25–60k assistance range. That is your first real screening finding: the 90–100% tier does not pencil on buyer assistance alone; it needs deeper subsidy, lower TDC, or land write-down.
- **S2 — Land disposition.** Four models, dataset order, no winner. Model A (authority retains land, 99-yr ground lease) is labeled **hypothesis_to_test**. Compare the monthly-housing-cost deltas the lifecycle computes per model — the retained-land tax treatment is worth roughly **$58/month** on the screening inputs, and the zero-property-tax structure overall is worth ~**$30,000 of buyer power per unit** at 100% AMI.
- **S3 — Shared-equity conventions.** Three real Colorado conventions (WMRHC fixed-simple, APCHA lesser-of, Elevation shared-appreciation) across 5/10/20/30 years and five market paths. Owner outcome and affordability outcome sit side by side — the tool never ranks them; that trade-off is your policy call.
- **S4 — Settlement viewer.** The resale waterfall on screening inputs: public subsidy **retained $20,000 / recaptured $80,000** at year 10 under the default configuration. Watch for the owner-net transparency warning if you experiment with aggressive recapture + appreciation-share combinations.
- **S5 — Demand funnel.** **Its default state is mostly "not_available" — that is correct, not broken.** Each of the 11 stages shows exactly what evidence would resolve it. Do not type guesses in; Part C tells you how to get real numbers.
- **S6 — Capture scenarios.** Sellout paces at 24/30/36/48 months with the denominator printed beside every rate, plus two caveats to take seriously: no competing-inventory data exists yet, and even the professional Fruita Mews market area contained only 44% of its actual applicants.
- **S7 — Report.** Download the screening draft. It is publishable-honest today: every limitation is in it, and its "What this report is waiting on" section is your data to-do list.

---

## Part B — The owner inputs (in priority order)

These fill the report's `not_available` rows. For each: paste whatever you get (a PDF, a photo of a term sheet, an email) and it gets entered into the scenario with correct classifications; everything downstream recomputes.

| # | Input | Who provides it | What to ask for |
|---|---|---|---|
| 1 | **TDC build-up** | Your developer partner or a GC/cost estimator (Indibuild knows this market from Fruita Mews) | A line-item concept budget for the 50-townhome program — hard, soft, fee, contingency, sales, financing — mapped to the fixture's unit mix. Concept-level ("Class C") is fine; it enters as user-entered + verify. |
| 2 | **Land value + contribution** | Broker opinion of value now, appraisal later; Authority board for the contribution decision | Market value of the parcel AND what the Authority will do: donate, discount, or 99-yr ground lease at $X/month. This makes the S2 land comparison real. |
| 3 | **HRWC terms** | Call Housing Resources of Western Colorado | Their current deferred-second term sheet (max, rate, trigger, lien position, income limits, education requirement, lender-combination rules) — and separately whether they'd consider a **project-specific commitment** and what stewardship services they'd price. Availability fills the record; only a written award flips `is_commitment`. |
| 4 | **Development partner + lender** | Authority outreach | Which entity would build (no agreement exists — Fruita Mews is capacity evidence, not a commitment) and 1–2 lenders willing to look at the product. These are `partners[]` slots. |
| 5 | **Phasing** | The developer | One phase or two, construction duration, sales release approach. Rough is fine — capture consumes it as a scenario. |

**Priority logic:** #1 and #2 unlock the subsidy-per-unit and capital-stack math (the biggest `not_available` block in the report). #3 determines whether the `insufficient` finding at 90–100% AMI can be closed from the buyer side. #4–5 complete the partners table and pacing.

---

## Part C — The four research conversations (resolve the funnel)

Each conversation converts specific funnel nulls into defensible shares with a named basis. Enter them in S5; the funnel, capture, and report update live.

1. **A lender (CHFA-participating) + the USDA RD area office.** Ask: which products would finance a deed-restricted / ground-lease townhome in Fruita, at what ratios — and roughly what share of local pre-qual applicants clears underwriting. → resolves `down_payment_readiness`, `debt_credit_readiness`, `mortgage_readiness`; also Phase-11 product-acceptance evidence.
2. **1–2 Grand Valley residential brokers.** Ask: months of supply under $500k; who buys entry-level (locals vs in-migrants); how attached townhomes move vs detached; any comparable project's actual pace. → resolves `unit_type_preference`, `location_preference`; grounds the in-migration stage (documented range 9–56%) and S6 pacing.
3. **HRWC's counseling pipeline.** Ask: how many Mesa County households in homebuyer education now, their income bands, readiness distribution; any Fruita Mews waitlist data. → resolves `first_time_buyer_share`, `purchase_readiness_window`; your best `tenure_preference` proxy.
4. **One or two comparable absorption data points.** Any recent attainable for-sale project in Mesa/Garfield/Eagle: units/month actually sold, fallout rate. → resolves `contract_fallout`; calibrates S6 (the for-sale side currently has **no** professional benchmark, unlike the rental side).

`household_size_compatibility` and `shared_equity_acceptance` come last — the first from matching your unit mix to household-size data, the second only from actually testing buyer response to the proposed resale terms (HRWC counseling sessions are the natural venue).

---

## Part D — The verification gauntlet (Phase 11 — book these in parallel)

The report's §8 lists these; none are optional before decision-grade use:
- **Attorney:** deed-restriction / ground-lease enforceability, foreclosure survival, subordination — and **CDARA construction-defect exposure** for attached product (a build-form driver, not a footnote).
- **Lender(s):** written confirmation of product acceptance for the chosen land model (Fannie CLT rider? FHA leasehold? USDA resale-restriction compatibility?).
- **Appraiser:** how the restriction and ground lease will be appraised (leasehold interest treatment).
- **Mesa County Assessor:** restricted-value assessment treatment, and confirmation of the exempt-while-authority-owns mechanics.
- **HRWC:** stewardship capacity in writing — can they administer 50 resale-restricted homes in perpetuity, at what annual per-unit fee (the 30-year stewardship funding line no one budgets).
- **City of Fruita:** which fee waivers/deferrals (tap/PIF, permit, impact) actually exist, by-right or discretionary — currently all VERIFY placeholders.

---

## Part E — Decision milestones (what the data unlocks, in order)

1. **Land model decision** (needs B2 + assessor + attorney): test the Model-A hypothesis against B–D with real land value — the tool compares; the board decides.
2. **Resale convention decision** (needs S3 review + attorney + HRWC): pick the formula balancing owner wealth vs durable affordability; the settlement viewer shows both.
3. **AMI mix + assistance design** (needs B1 + B3): resolve the `insufficient` 90–100% finding — deeper subsidy, land write-down, TDC reduction, or re-mix.
4. **Pricing + capital stack** (needs B1 + B2 + funding commitments): only awarded/committed sources count; the report enforces it.
5. **Go / commission decision** (needs Part C + D): when the funnel is resolved with real shares and validations are in hand, decide whether to commission the professional demand/absorption study (~$15–40k) that converts the screening draft into a lender-grade document — with the tool's gap/subsidy/structure work handed to that consultant as the analytical foundation.

---

*Everything above is screening arithmetic until the inputs and validations land. The report will keep saying so — by construction.*
