# Benchmark — Mesa County Regional HNA (Root Policy, draft) vs Repo Outputs

**Recorded:** 2026-07-19 by Claude QA from owner-provided review artifacts.
**Status of artifacts: BOTH DRAFTS — re-verify every figure against the final
publications before citing externally.**

## Artifacts

1. **Mesa County Regional Housing Needs Assessment**, Root Policy Research,
   DRAFT 2026-05-12, prepared for Mesa County + City of Grand Junction.
   State-guidance-compliant HNA (DOLA methodology), 2024 5-year ACS spine,
   2026 resident survey (n≈700–765 by question), Bray MLS sales 2025–2026Q1.
   Root is already a calibration anchor in this repo (La Plata HNA).
2. **City of Grand Junction 2026–2030 Consolidated Plan + 2026 Action Plan
   (CDBG)**, DRAFT for public comment 2026-06-14 → 2026-07-16 (window now
   closed). Standard HUD template (NA/MA/SP/AP).

## Headline convergence: the renter universe matches exactly

| Quantity | Repo (co_ami_gap_by_county, B25118) | Root (Fig VIII-1) |
|---|---:|---:|
| Mesa County total renter households | **18,123** | **18,123** |

Independently assembled from the same ACS 2024 5-year spine — exact
agreement on the demand universe. This is the strongest external validation
the repo's rental-gap denominator has received.

## Rental gap comparison — same shape, one documentable convention difference

| Cumulative through | Repo gap (4-person AMI rents) | Root gap (2-person CHFA AMI rents) |
|---|---:|---:|
| 30% AMI | −3,067 (max rent $732) | −2,012 (max rent $566) |
| 50% AMI | −455 | −1,558 |
| 60% AMI | **+88** | **−21** |

- Same sign at ≤30%, same order of magnitude, and the cumulative gap closes
  at essentially the same AMI level (repo +88 vs Root −21 at 60% — a 109-unit
  difference on an 18k universe).
- The level differences are traceable to **household-size convention**: the
  repo prices affordability at 4-person AMI ($97,600 → $732 at 30%); Root
  uses 2-person CHFA AMI ($566 at 30%), matching Mesa's average household
  size. Lower thresholds shift both demand and supply down-band.
- **Follow-up question for the repo (not a defect):** whether county-level
  gap outputs should disclose the 4-person convention more prominently, or
  offer a 2-person view where average household size warrants — Root's
  choice tracks CHFA market-study practice.
- Root additions the repo lacks: income-restricted inventory netting inside
  the supply count, and the "renting up/down" competition narrative.

## Production needs (Root, DOLA catch-up/keep-up method)

- Mesa County catch-up: **1,661 units** (717 owner / 944 renter; 773 of them
  at 0–30% AMI — 704 renter). Grand Junction: **651** (286/364).
- Inputs: rental vacancy 3.4% vs 5% target → 311 rental units; owner 0.5% vs
  2% → 717; overcrowding 1,265 households → 633 units (all allocated to
  0–30% rental per DOLA guidance).
- Keep-up: +9,212 households by 2036 (DOLA projections, 1.26%/yr) → **9,482
  units** (6,812 owner / 2,670 renter at 73% ownership rate + vacancy
  allowances).
- These are directly commensurable with the repo's DOLA-style needs outputs;
  a per-number reconciliation belongs in the follow-up issue once the FINAL
  report publishes (draft numbers may move).

## For-sale gaps — external cross-check for the ownership module (#1167)

- Root: purchase gaps concentrated <100% AMI, persisting to 120%; in Mesa
  County 34% of potential first-time buyers earn 51–100% AMI but only 16% of
  2025–2026Q1 sales priced below 100% AMI; max affordable price $280,232 at
  100% AMI (30-yr, 6.11%, 10% down, 25% of payment to non-P&I costs).
- Repo digest (Mesa County): owner stock affordable at 100% AMI **44.1%**,
  at 120% **59.6%**; ownership-need recommendation "Rental + ownership mix".
- Not apples-to-apples (Root prices *sales flow* via Bray MLS; the repo
  prices *standing stock* via B25075) — but directionally consistent: both
  find the binding ownership constraint below ~100–120% AMI. Assumption sets
  are close (repo AFFORD 6.5% rate vs Root 6.11%; both 10% down) — worth a
  one-line disclosure note when the ownership module cites external
  corroboration.

## Other Grand Valley evidence worth capturing

- **Commute (feeds the #1232 commute-shed priority):** 47% of county
  residents work outside their home city; 56% of those work in Grand
  Junction; **76% of in-commuters who considered living in Grand Junction
  cited lack of affordable housing**. Consistent with the Fruita calibration
  (F-CAL-5/-7) and the D-lite/D-full promotion.
- **GJHA voucher waitlist: 2,973 households, 94% below 50% AMI** (2025
  Unhoused Needs Survey) — a demand-side datum the repo does not track.
- Survey: 53% of renters want to own; 56% cite down payment as the barrier;
  66% interested in deed-restricted ownership — direct market evidence for
  the Help for Homebuyers surface and #1167.
- STR pressure and mobile-home-park displacement are recurring open-ended
  themes — relevant to the STR-distortion flag and preservation context.

## Consolidated Plan — effects and one time-sensitive note

- AP-15 expected resources (CDBG entitlement dollars for Grand Junction) and
  SP-25 priority needs are the natural feed for the soft-funding tracker
  (which today has no GJ CDBG entitlement entry) and local-resources housing
  plans.
- **Timing note:** the plan was drafted before the 21st Century ROAD to
  Housing Act was enacted (2026-07-11), whose §204 makes affordable-housing
  NEW CONSTRUCTION a CDBG-eligible activity. A 2026–2030 plan finalized from
  this draft may under-program that brand-new authority. Verify what the
  adopted final says before recording anything; the owner may also wish to
  raise this with the city directly while the plan is pre-adoption.

## Disposition

Follow-up data/code work is queued as a GitHub issue (see tracker): GJ CDBG
entitlement in soft-funding, GJHA waitlist as CONTEXT, Con Plan/HNA links in
local-resources, and a final-vs-draft re-verification pass when both
documents are adopted. No repo numbers change from this benchmark; the repo's
Mesa outputs stand validated within documented convention differences.
