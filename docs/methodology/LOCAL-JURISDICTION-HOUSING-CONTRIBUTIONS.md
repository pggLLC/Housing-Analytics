# Local Jurisdiction Contributions to Affordable Housing — Reference

**Type:** methodology/reference. Feeds the **project-side** capital stack (Revision-2 §5.2, category **A_land** / **B_project_gap**) and Tier-1 jurisdictional capacity output.
**Date:** 2026-08-04 · **Status:** reference; every specific program/rate is **jurisdiction-specific and VERIFY** — confirm against the local municipal code and current fee schedule before counting.
**Why this exists:** local government contributions — **fee waivers, reductions, and deferrals (tap/plant-investment fees, permit and impact fees), land, density, and trust-fund dollars** — are frequently the **largest non-cash subsidy** in an affordable-ownership deal and directly reduce total development cost, which shrinks the affordability gap. The repo already models several as soft-funding tranches (`js/deal-calculator.js:3311,5130`) but treats them as rental subordinate debt and misses the **timing dimension** (waived vs reduced vs **deferred**) that the user flagged. This document gives the full menu and how to model it.

---

## 1. Why local contributions matter to the gap

A jurisdiction rarely writes a large check; it more often **reduces or defers costs**. Every dollar of avoided or deferred cost lowers total development cost (TDC) → lowers the per-unit subsidy needed to hit an AMI target. For a housing-authority project these **stack on top of** the authority's own land contribution and tax exemption (see `HOUSING-AUTHORITY-STRUCTURES-AND-POWERS.md`). Two distinct benefits must be modeled separately:

- **Cost reduction** (waiver/reduction) — permanently lowers TDC.
- **Cost timing** (deferral) — the fee is still owed, but **paid later** (at certificate of occupancy or at unit sale) — which lowers **construction-period carrying cost and financing need**, improving feasibility even when the nominal fee is unchanged. *This is the "deferred tap fee" case and must not be modeled as a permanent TDC reduction.*

---

## 2. The menu (taxonomy)

### A. Fee waivers, reductions, and deferrals
Each carries a **timing** attribute: `waived` (not owed) · `reduced` (partial) · `deferred` (owed later).

- **Water/sewer tap fees / plant investment fees (PIFs)** — often the single largest fee; commonly **deferred to CO or first sale**, sometimes reduced/waived for deed-restricted units.
- **Building permit fees**; **plan review fees**; **planning/zoning application & rezoning fees**.
- **Development impact fees** (parks, transportation, drainage, public safety, school-land) — waiver/reduction/deferral; the repo's `impact_fee_loan` tranche models the deferral-as-loan form.
- **Construction use tax** (on building materials) — rebate or waiver.
- **Stormwater/drainage fees**; **metro-district fee coordination**.

### B. Land & entitlement contributions
- **Public land donation** or **below-market conveyance** (land write-down) — inventoried in `data/policy/county-ownership.json`.
- **Ground lease** at nominal/discounted rent (pairs with land-disposition Model A/D).
- **Density bonus** — more units per acre → lower per-unit land cost.
- **Parking-requirement reduction/waiver** — frequently a large hard-cost saver (structured parking is expensive).
- **Height / dimensional-standard flexibility**; **modified development standards**.
- **Expedited / priority permit processing** and **pre-approved plans** — time = carrying cost.
- **Annexation / utility-extension support**; jurisdiction-built **public infrastructure** (roads, utilities, sidewalks).

### C. Direct financial contributions
- **Local/regional housing trust funds** — grants or soft loans (repo names **Denver AHTF, Boulder HTF, Aspen HTF**; `deal-calculator.js:5106`).
- **Dedicated revenue sources** feeding those funds: **inclusionary in-lieu / linkage fees** (commercial), lodging tax, dedicated sales/use-tax set-aside, short-term-rental fees/taxes, cannabis tax, general-fund allocations.
- **Predevelopment grants/loans**; **gap financing** (soft second loans).
- **CDBG / HOME** pass-through (entitlement cities/counties).
- **Tax-increment financing (TIF) / urban renewal (URA)** — note: conflicts with tax-exempt public ownership (increment suppressed; see study QA Addendum A3).
- **PILOT** (payment in lieu of taxes) and, where authorized, **property-tax rebates/abatements**.
- **Initial HOA-reserve capitalization** / **stewardship startup** / **repurchase-reserve** funding.

### D. Regulatory / policy offsets (non-cash)
- **Inclusionary zoning** offsets and alternatives; **fee-in-lieu** structures.
- **Vacant/under-used land activation**, **public-private land partnerships**.

---

## 3. The deferral emphasis (model it correctly)

A **deferred tap fee** is not free money and not a TDC cut — it is a **cash-flow and financing benefit**. Model it as:
- fee **still in TDC** (nominal amount owed),
- but **paid at CO or at unit sale** (per the `deferral_trigger`),
- reducing **construction-loan draw / carrying cost** over the build-and-sell period,
- and, for for-sale, potentially **passed to the buyer's closing** or covered by sale proceeds.

Conflating deferral with waiver overstates the subsidy. The tool must keep `timing` explicit so a deferral shows a carrying-cost benefit, and only a `waived`/`reduced` amount reduces TDC.

---

## 4. Integration into the model

Extend the project-side funding-source schema (Revision-2 §5.2) with contribution fields:

```jsonc
{
  "id": "fruita-tap-fee-deferral",
  "name": "Fruita water/sewer tap fee deferral (affordable units)",
  "funding_type": "fee_waiver",                 // fee_waiver | land | in_kind | grant | deferred_loan
  "side": "project", "capital_stack_category": "B_project_gap",
  "contribution_mechanism": "tap_fee|plant_investment_fee|building_permit|plan_review|impact_fee|use_tax|land_donation|ground_lease|density_bonus|parking_reduction|expedited_review|trust_fund|in_lieu_linkage|infrastructure|tif_ura|pilot|predevelopment|gap_loan|cdbg|home",
  "timing": "waived|reduced|deferred",          // the load-bearing distinction
  "deferral_trigger": "certificate_of_occupancy|first_sale|maturity|null",
  "value_basis": "per_unit|per_project|per_sqft|per_tap|percent_of_fee",
  "amount": null,                                // VERIFY against local fee schedule
  "eligibility_condition": "deed_restricted_units_only",
  "authorizing_code": "VERIFY (local ordinance / fee schedule)",
  "eligible_geography": ["0828745"],
  "commitment_status": "available",             // only awarded|committed counts (§18)
  "source_url": "...", "last_verified": null, "classification": "modeled|user_entered"
}
```

- **Reuse** the Deal Calculator's existing soft-funding-stack pattern (`deal-calculator.js:3311` — `impact_fee_loan`, `local_pha`, etc.) rather than inventing a new UI; add the ownership project-side sources to the developer dataset `data/policy/developer-ownership-funding.json`.
- **Per-jurisdiction data** can attach to the existing `data/policy/jurisdiction-housing-progress.json` (`by_geoid`) or `data/hna/local-resources.json`, listing which mechanisms each jurisdiction offers.
- **Capital-stack placement:** land contributions → category **A_land**; fee/infrastructure/trust-fund → **B_project_gap**. Never double-count (a waiver reduces uses; a trust-fund grant is a source — not both).

**Tier-1 output** should list, per jurisdiction, the **local contribution mechanisms available** (fee waivers/deferrals, trust fund, density/parking policy, land) as part of the §16 ownership-strategy result — with the caveat that these are highly local and require confirmation against the municipal code.

---

## 5. Guardrails

- **Highly jurisdiction-specific.** Every mechanism, rate, and eligibility rule differs by city/county and changes with the annual fee schedule — mark **VERIFY** and cite the local code; never assume one city's program applies to another.
- **Availability ≠ commitment.** A mechanism a jurisdiction *offers* is context; only an **awarded/committed** contribution counts toward closing the gap (§18 commitment-status enum).
- **Deferral ≠ waiver.** Keep `timing` explicit; a deferral is a carrying-cost benefit, not a TDC reduction.
- **No double counting.** A fee waiver reduces development *uses*; a trust-fund grant is a *source*. The capital-stack reconciliation test (sources = uses) enforces this.
- **Authority to waive.** Some waivers require council/board action or an enabling ordinance — flag whether the mechanism is by-right or discretionary.
