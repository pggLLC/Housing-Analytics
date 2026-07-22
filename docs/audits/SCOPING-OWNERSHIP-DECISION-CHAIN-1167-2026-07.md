> ⚠️ **PARTIALLY SUPERSEDED (2026-07-22).** This is a point-in-time scope. OWN-1 shipped in #1291 (2026-07-22): the §0 "current state" table is now stale — counties are FHFA-anchored (not null) and B25075 owner-value supply is wired (not "only a test"). OWN-1/2/3/4 have PRs (#1291/#1292/#1293/#1294); only OWN-5 (chain assembly) remains. Treat the PR-package sequence and owner decisions as current; treat the §0 status table as historical.

# Scoping — Ownership Analysis Decision Chain (#1167)

**Audience:** for-sale / ownership affordable-housing developers (deed-restricted for-sale, townhomes/condos, community land trusts, employer/for-sale workforce housing).
**Author:** Claude QA · **Date:** 2026-07-21 · **Status:** scope only — no code. #1167 was queued to start after the backlog closed; it now has.
**Grounding:** current-HEAD surface map (2026-07-21) + `docs/methodology/AFFORDABLE-OWNERSHIP-METHODOLOGY.md` + `docs/audits/OWNERSHIP-BENCHMARK-EPS-PHASE2-2026-07.md` (#1167 step 1).

## 0. What already exists (build on, don't rebuild)

| Link in the chain | Exists today | Where |
|---|---|---|
| Tenure/ownership-pressure screening | ✅ full | `js/hna/hna-ownership-need.js` (3 tiers + recommendation) |
| Modeled affordability test (PITI, max price by AMI) | ✅ but **counties null** | `hna-ownership-need.js:192-238`; cascade is places-only (benchmark F4) |
| Per-unit for-sale subsidy gap | ✅ single number | `deal-calculator.js:165-198` (`computeForSaleFeasibility`, reuses `maxAffordablePrice`) |
| Threshold constants + methodology | ✅ validated vs EPS | methodology doc `:131-154`; benchmark verdict "keep constants + caveat" |
| Consumer DPA/first-buyer programs | ✅ consumer-facing only | `homeownership-programs.js` (`:3` "consumer-facing"), `homeownership-programs.json` |
| **Owner-value supply (B25075)** | ⚠️ **data committed, unwired** | bins in `data/hna/summary/*.json`; only a test references them |
| **Sub-county FHFA HPI** | ⚠️ **artifact committed (#1255), unwired** | `data/market/fhfa_hpi_subcounty_co.json`; no JS consumer |
| Demand by price band | ❌ missing | ownership-fit uses aggregate moderate-income renter counts, not price-band distribution |
| Developer subsidy stack | ❌ missing | program data is consumer DPA cards; gap is one number with no funding mapped |
| Resale / deed-restriction | ❌ missing (prose only) | caveat text; WMRHC "Good Deeds" buy-down named as the model case (benchmark `:110-117`) |

**Standing constraints (carry into every package):** everything stays **screening-only** with the existing caveats (methodology `:194-200`, `SCREENING_CAVEAT`); the CODEX-HANDOFF-AFFORDABLE-OWNERSHIP ban on "**for-sale absorption forecast**" holds — demand work is a *current* distribution, never a time-phased forecast; no fabricated resale formulas or program dollar amounts (null + VERIFY); source/quality labels (`sourceLabel`, `dataQuality`) extend to every new surface.

## 1. Package sequence (5 PR-sized units, dependency-ordered)

### OWN-1 — Wire the committed data + close the county gap (foundation, no new claims)
- Consume **B25075 owner-value distribution** (already in summary caches) as an *owner-value supply* series, and the **FHFA sub-county HPI artifact** (#1255) as the geographic price anchor.
- **Fix benchmark F4**: counties currently get no affordability classification because `home-value-cascade.json` is places-only. Extend the cascade to counties using the sub-county FHFA HPI (or a documented county ZHVI path) so `affordabilityTest` returns a real class for counties, not null.
- Pure data-wiring + one gap fix; no new UI concepts. Tests: B25075 series non-vacuous + labeled; county affordability class now non-null for a pinned county; no change to place-level outputs.

### OWN-2 — For-sale demand by price band (current, not forecast)
- Distribute the existing **ownership-fit moderate-income household count** across **affordable price bands** derived from the AMI→max-price model already in `hna-ownership-need.maxAffordablePrice` (e.g., ≤80%, 81-100%, 101-120% AMI price ceilings).
- Cross with the OWN-1 B25075 owner-value supply bands → a **current gap-by-price-band screen** (demand at each affordable band vs owner units priced there). Framed as a static current picture; the "absorption forecast" ban means **no** time-phasing or capture-rate claims.
- Owner-decision gate below (renter→buyer conversion framing). Tests: gap-by-band recomputes from committed inputs; sabotage on the band cutpoints.

### OWN-3 — Developer subsidy stack (make programs developer-facing)
- Turn `computeForSaleFeasibility`'s single per-unit gap into a **mapped funding stack**: encode the developer-side sources from EPS **Table 12** (deed-restriction/buy-down, inclusionary, DPA layering, fee waivers, employer contributions) as a new developer-facing dataset (distinct from the consumer `homeownership-programs.json`), each entry source-verified.
- Show which sources can close the computed gap and the residual. No invented amounts — programs with unknown dollar terms render "VERIFY."
- Tests: stack sums to ≤ gap; residual disclosed; every program entry has a verified source_url.

### OWN-4 — Resale / deed-restriction module (evidence-gated on owner convention)
- Model the **shared-equity resale formula** so a developer sees the deed-restriction tradeoff (initial buy-down vs resale price cap vs owner appreciation share). WMRHC "Good Deeds" is the cited Colorado model case.
- **Blocked until the owner picks the resale convention** (decision C4 below) — do not ship a fabricated formula. Tests: pinned resale example vs the chosen convention; sabotage on the appreciation-share term.

### OWN-5 — Decision-chain assembly + disclosure
- Stitch the links into one developer-facing ownership flow (site/price context → demand-by-band → gap → feasibility → subsidy stack → resale), carrying the screening-only caveat and a mode/scope label throughout — the "full decision chain" the issue names.
- Tests: each stage renders from real inputs; caveat present on every stage; consumer "Help for Homebuyers" path unchanged (developer vs consumer separation preserved).

## 2. Owner decisions required before/within packages

- **C1 (OWN-1):** county price anchor — FHFA sub-county HPI vs a county ZHVI cascade extension. FHFA is the just-landed artifact and is public-domain; recommend it as primary, ZHVI as fallback.
- **C2 (OWN-2):** the ownership-fit tier counts moderate-income **renters**. Converting them to *for-sale demand* needs a stated framing — recommend labeling them "potential buyer pool (moderate-income renter households), not committed demand" and applying **no** conversion multiplier (screening honesty), rather than inventing a renter→buyer conversion rate.
- **C3 (OWN-3):** which EPS Table 12 program types to encode first (deed-restriction buy-down + inclusionary + DPA layering is the recommended starter set; employer/fee-waiver second).
- **C4 (OWN-4):** the resale-formula convention — fixed appreciation %, AMI-indexed resale price, or CLT-style 25% appreciation share. This is a methodology choice with real consequences and **gates OWN-4**; recommend anchoring to the WMRHC "Good Deeds" published formula rather than a generic default.

## 3. Sequencing & scope guardrails

- Strict order: OWN-1 → OWN-2 → OWN-3 → (OWN-4 when C4 decided) → OWN-5. OWN-1/2/3 are unblocked now; OWN-4 waits on C4; OWN-5 waits on all.
- Each package is one PR, QA'd with independent recompute + sabotage-able guards, screening-only caveats intact, and the developer/consumer surface separation preserved.
- **Out of scope:** any single named development's underwriting (this is a public screening tool, not a deal model); time-phased absorption forecasts (banned); replacing the rental LIHTC path (untouched).
- The methodology/benchmark verdict stands: keep the validated threshold constants + caveat; do not re-tune them inside these packages.
