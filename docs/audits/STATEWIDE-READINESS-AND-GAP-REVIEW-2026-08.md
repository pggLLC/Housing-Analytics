# Statewide Readiness & Gap Review — Affordable-Homeownership System

**Type:** Phase 0 deep-dive (no production code changed).
**Date:** 2026-08-04 · **Author:** Claude Code (QA)
**Companion to:** the Fruita Commons scoping audit, Revision 2 plan, and the two reference docs (housing-authority structures; local-jurisdiction contributions).
**Question answered:** *Will this apply statewide, and what is missing?* — answered against **measured repo coverage**, not assertion.

---

## 1. Will it apply statewide? — short answer

**The core affordability/gap engine: YES, statewide.** The richer strategy, funding, pricing, and demand layers: **NO — they are county-only or top-33 today and must degrade gracefully.** The single most important design requirement this review adds: **the tool must show, per jurisdiction, what data it has and what it lacks, and never present thin data as a complete answer.**

## 2. Measured coverage (2026-08-04)

| Layer | Coverage | Statewide-ready? |
|---|---|---|
| County AMI (`co_ami_gap_by_county.json`) | **64 / 64 counties** | ✅ full |
| Household income distribution by AMI (`households_le_ami_pct`) | 64 counties + **482 places** | ✅ but **tops out at 100% AMI** (see gap G2) |
| CHAS ownership need (`place-chas.json`) | **482 places**, 0 low-confidence, 24 (4%) acs_anchor | ✅ good |
| Home value (`home-value-cascade.json`) | 482 places + 64 counties — **but 53 places (11%) have no value, and 218 (45%) use weaker ACS-raw, only 264 are ZHVI** | ⚠️ usable, quality varies |
| Owner-value supply (ACS B25075) | statewide summary caches | ✅ |
| Providers / housing authorities (`local-resources.json`) | **64 counties + only 70 of 482 places** (115 authorities total) | ⚠️ county-complete, place-sparse |
| Local funding / fee-contribution / Prop 123 (`jurisdiction-housing-progress.json`) | **33 jurisdictions only** | ❌ not statewide |
| Product-tier pricing (entry / bottom / townhome / condo / new-construction) | ZHVI all-homes + Redfin **121 places, single series** — **no product-type breakdown** | ❌ not available statewide |
| For-sale competitive & pipeline supply (for demand/capture) | **none wired** (DataService is rental-only) | ❌ absent |

**Interpretation.** Tier-1's *affordability gap* (income ladder → max price → gap → who's priced out → owner supply) can run for **every county and 482 places today**. But the layers that make it a *strategy* — local funding/fees (33), product-specific pricing (0 statewide), provider/stewardship for places (70/482), and any demand/capture (0) — are thin or absent outside the top jurisdictions. Present those as explicit "data not available for this jurisdiction" states, not zeros.

## 3. What's missing — prioritized gap register

### P1 — must fix before statewide "% priced out" or per-unit gap ships

- **G1 · Household-size AMI adjustment (methodology).** The kernel uses **`ami_4person` flat** (grep: 30 uses; no `ami_1/2/3person`). HUD income limits vary materially by household size, and townhome buyers are often 1–3 person. Using 4-person AMI **overstates** the income of the typical smaller buyer and understates the gap. HUD publishes limits by size (`HudFmr.getIncomeLimits`), so this is a **wiring + kernel** fix, not a data gap. **Add a household-size dimension to the Phase 1 engine** (default 4-person reproduces today's number for backward-compat).
- **G2 · "% priced out" is not traceable from repo data (methodology/data).** The income distribution (`households_le_ami_pct`) **stops at 100% AMI**, but the Fruita median requires **137% AMI** (kernel). So the share priced out *of the median* cannot be computed precisely — it needs an above-100% income breakdown (ACS B19001) or an interpolation that must be disclosed. **This is exactly why the 87.3% / 82.2% figures are unreproducible from the repo** — do not ship them as production results until sourced. The current `affordability-metrics-panel.js` "% can afford" uses a crude median-ratio proxy (`:104`), which is not defensible for a study.
- **G3 · Interest rate is static (finance).** 6.5% is hard-set; rate moves swing affordability 20–40%. A live FRED rate exists (`affordability-metrics-panel.js:65`). **Make rate a first-class model/scenario parameter** (part of the user-selectable model registry) with a documented as-of date.
- **G4 · Price provenance not reconciled (data).** ZHVI (typical *value*) vs Redfin (*sale* price) vs *list* vs product type — the refinement §4 reconciliation is a real gap: 45% of places fall back to ACS-raw value, 11% have none, and no townhome/new-construction series exists statewide. **Assign an authoritative measure per use and disclose vintage/source; never silently substitute county for place** (the recurring masking bug).

### P2 — needed for a credible study; can phase in

- **G5 · Insurance & property-tax assumptions may be stale (finance).** Insurance is fixed at **0.35%/yr** — likely low for 2026 Colorado (wildfire/hail premium spikes; some markets hard to insure). Property tax is a flat **0.65%** with no county rate and no reflection of recent CO residential-assessment-rate changes. **Expose both as model parameters and revisit the defaults**; carrying-cost errors flow straight into the gap.
- **G6 · Employment / wage / economic base absent from demand.** A study needs demand drivers (jobs, wages, migration). `scripts/hna/economic_housing_bridge.py` (wage-affordability bridge) exists but is **unwired to ownership**. Connect it for the demand-driver layer.
- **G7 · Mortgageability by ownership structure (finance/legal).** Lender acceptance of CLT ground-lease / deed-restriction / leasehold (Fannie/Freddie riders, FHA leasehold, USDA resale-restriction compatibility) is a **feasibility gate** that varies by structure. Flag it per land-disposition model (§6) — a structure the tool "prefers" for affordability may be hard to finance.
- **G8 · Demand beyond renters.** The funnel converts renters→buyers, but move-up buyers, in-migration, and equity-rich downsizers are real for-sale demand. Include them (with proxies + caveats).
- **G9 · Existing deed-restricted resale inventory** as both supply and recurring demand — not modeled.

### P3 — statewide correctness & edge cases

- **G10 · Jurisdictions with no ownership gap.** On the eastern plains and some rural counties the market may be at/near parity or surplus — the tool must handle **zero/negative gap gracefully** and not force a subsidy narrative. Add a **market-type classification** (resort / metro / rural / plains) so ratios and messaging fit context.
- **G11 · Cross-county places (Basalt F1/F2).** The known tenure-mix / wrong-county-frame bug (EPS benchmark) must be resolved before statewide place-level ownership output.
- **G12 · Tribal / special jurisdictions** (Southern Ute, Ute Mountain Ute; Montezuma/La Plata) — distinct AMI, land, and authority context; verify handling.
- **G13 · Metro-district buyer disclosure & condo vs townhome product nuances** (HOA, financing, assessment differ).

### P4 — repo / UX / process

- **G14 · Tier-1 UI does not exist yet** — today's HNA ownership section is screening cards, not the full §16 ladder/strategy output (planned Phase 5).
- **G15 · Scenario persistence & report export** — `window.SubjectProject` + `test:scenario-presets` exist to reuse; study-report export is new (reuse `hna-export.js` patterns).
- **G16 · Performance** — running the model for 482 places on the fly needs the precomputed `ownership-need.json` pattern extended, not per-request compute.
- **G17 · Consumer-protection / fair-housing review** of eligibility screens (steering / disparate-impact) and the `test:public-facing-numbers` guardrail applies to any published priced-out %.

## 4. Adjustments to the Revision-2 plan

- **Phase 1** (finance engine) gains: **household-size AMI ladder (G1)**, **rate as a model parameter (G3)**, and **insurance/tax as model parameters (G5)** — all defaulting to today's values so the `289983` golden fixture is unchanged.
- **Phase 3** (datasets) gains: statewide expansion path for provider/funding/fee data (64 counties + 70 places → broader), flagged as a **data-acquisition workstream** with graceful degradation until filled.
- **Phase 5** (Tier-1 UI) gains: **coverage/degradation states (G2/G4/G10)**, a **defensible "% priced out" methodology with above-100% handling and disclosure (G2)**, **market-type classification and zero-gap handling (G10)**, and cross-county correctness (G11). **Do not ship 87.3%/82.2% until traced.**
- **Phase 2/8** (structures) gains: **mortgageability-by-structure flag (G7)**.
- **Phase 6/7** (demand/capture): confirmed **screening-grade statewide** (no supply data), with the wage-bridge connection (G6) and non-renter demand (G8) as enhancements.

## 5. Verdict & next step

**Statewide-ready for the affordability *gap* (64 counties, 482 places); not yet for the *strategy/funding/pricing/demand* layers** — those are county-only or top-33 and must degrade honestly. **None of this blocks Phase 1** — in fact Phase 1 gets *better* by absorbing G1/G3/G5 (household-size + rate + carrying-cost as model parameters), which the user's multi-model directive already motivates.

**Recommended next smallest safe step (unchanged, now enriched): Phase 1** — the pure, additive, backward-compatible finance engine + model registry, extended to carry household-size, rate, insurance, and tax as documented, user-selectable parameters. Draft `data/policy/affordability-models.json` (and a Fruita/Mesa local-contribution fixture) as **planning fixtures only** — implementation still awaits explicit go-ahead.

> **Do not ship any "% priced out" figure (including 87.3% / 82.2%) as a production result until it is reproduced from a named income distribution with above-100%-AMI handling and disclosed vintage/geography (G2).**
