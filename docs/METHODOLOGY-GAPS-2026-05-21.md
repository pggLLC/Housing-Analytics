# Methodology Gaps & Analysis Risks — Deep Dive
**Session date:** 2026-05-21
**Scope:** Fixes shipped today (#854, #855, #857, #859) + what's left unaddressed
**Audience:** Site operator + future developers using this platform for site-selection decisions

---

## What today's PRs improved

| PR | Bug class | What it fixed |
|---|---|---|
| #854 | Content error | LIHTC equity-math example was scaled wrong (claimed $78.3M was "per $1M annual credit") |
| #854 | UX confusion | Data Review Hub showed two "Total Sources" counters (62 vs 71) both labeled identically |
| #854 | A11y | Deal Calculator `<h1>` accessible name was polluted by an inline glossary tooltip |
| #855 | Data exposure | Compare page showed 3 of 5 CHAS renter cost-burden tiers; 81-100% and 100+% AMI rows were missing |
| #855 | Data fallback | Owner Housing Cost Burden showed "unavailable" whenever ACS DP04 SMOCAPI bins were small-N suppressed (every CDP) |
| #857 | **Data correctness** | Rental vacancy was emitted as 0% for every county. The build script treated DP04_0005E as a count, but it's a percentage. Denver now correctly reads 5.8% instead of 0.0%. |
| #857 | Data context | Added % multifamily, % single-family detached, % 2-4 unit to ranking-index + Compare |
| #857 | UX | Top Industry card now shows count + share instead of just the industry label |
| #859 | UX | New consolidated PMA Site Summary card + methodology disclosure (transit rural-fallback explicitly documented) |

These are real bug fixes, not cosmetic. The vacancy-rate fix in particular affected every county-level score that touched market-tightness, which is a 20% weighted component of the PMA composite score.

---

## What's missing — gaps that will create analysis problems

The following are not bugs in what we ship; they're **inherent limitations of the public-data methodology** that users need to understand. Treating these tools as if they were professional market studies (which they're not) will produce wrong decisions.

### 1. Multifamily-vs-single-family vacancy split — not publicly available below the metro level
**What the user asked for:** vacancy broken down by multifamily vs single-family.
**Why we can't ship it directly:** ACS DP04 publishes vacancy at the housing-unit level. It does *not* publish a structure-type cross-tab. The only public source that does is Census **HVS** (Housing Vacancy Survey), which is quarterly but only published for about **75 MSAs** nationwide — Denver-Aurora-Lakewood is included; Grand Junction, Pueblo, Greeley, Boulder are *not*, and no Colorado place outside the Denver MSA has a public MF-vs-SF split at quarterly frequency.

**What we shipped instead:** % multifamily + % single-family + % 2-4 unit composition rows on Compare, so users can interpret the single whole-market vacancy figure against the housing stock makeup. A 5% vacancy in Denver (46% MF) means something different than 5% in Mesa (9% MF).

**Risk if a user ignores this caveat:** Underwriting a 100-unit MF deal in a non-Denver MSA against the whole-market vacancy will misprice lease-up risk. MF vacancy is typically 1-3 points higher than SF in any given market — under-budgeting absorption rate by that much can blow a 9% LIHTC IRR.

**Mitigations the platform should offer (not yet built):**
- Surface Denver HVS quarterly MF vacancy as a metro-level overlay for any Denver-MSA site.
- Display a "MF vacancy proxy" computed as `whole_market_vacancy × (renters_in_5plus_units / total_renters)` with explicit "modeled estimate" framing.
- Subscription path: CoStar / Yardi / RealPage MultifamilyTrack are the industry-standard MF-specific sources at $5K-$25K/year per market. Document this clearly so users know when to escalate.

### 2. Rental vacancy at place/CDP granularity is unstable
**Status:** Fixed in #857 with a rental-N ≥ 50 gate that emits null for very small samples.
**Residual problem:** ACS publishes 0.0% for some places that genuinely have low vacancy AND some places where the sample happened to find no vacant rentals. The two are indistinguishable from the number alone.

**Why this matters:** Compare shows Fruita at 0.0% rental vacancy. Some of that is real (Fruita's a tight market); some is sample noise. A user comparing two CDPs both at 0% can't tell which is genuine.

**Mitigation:** The new structure-type rows on Compare let users see whether the market is even big enough to have meaningful rental vacancy. A 95% SF-detached place with 50 rental units is structurally not a 100-unit-LIHTC site regardless of what the vacancy number says.

### 3. CHAS data is 2018-2022 vintage — three+ years stale
**Where it shows up:** Renter Cost Burden by Income Tier (Compare), AMI gap calculations (Ranking + Compare), owner cost-burden fallback (#855), and the chartChasGap chart on HNA.

**Why this matters:** HUD CHAS lags. The 2018-2022 vintage includes the early COVID rent freeze + the 2021-2022 rent acceleration but doesn't capture the 2023-2024 post-pandemic equilibrium. For a deal closing in 2026, the cost-burden tiers may understate current stress in fast-growing Front Range markets and overstate it where rent growth has actually decelerated.

**Mitigations:**
- We label vintage explicitly on every CHAS chart and the Compare panel. The page also notes that HUD CHAS 2019-2023 is published but our ETL hasn't ingested it yet.
- Document a regeneration plan: when CHAS 2019-2023 lands in the build pipeline, every place + county rate should refresh in the same place-CHAS + county-CHAS files; downstream consumers don't need code changes.

### 4. HUD FMR cache is FY2025 — FY2026 was published 2026-04-01
**Where it shows up:** Deal Calculator rent ceilings, PMA rent-pressure dimension, AMI-required-to-purchase calculations.

**Why this matters:** FMR caps move LIHTC pro forma revenue assumptions ~2-4% year-over-year in CO MSAs. FY2026 caps are higher than FY2025 in 9 of 11 CO HUD areas. Underwriting against FY2025 caps in 2026 will *under-estimate* maximum chargeable rents — which is conservatively fine for screening but understates the real opportunity.

**Mitigation:** The FY2025 label is now visible on the relevant cards. Refresh script `scripts/fetch_fmr_api.py` exists; needs a cron entry to pull FY2026.

### 5. LEHD WAC vintage is 2021 — five-year lag
**Where it shows up:** Top Industries by Employment (HNA + Compare), Wage Distribution (LEHD CE01-CE03 wage bands), commuting flows, Top Industry card.

**Why this matters:** A 2021-vintage employment mix misses post-pandemic shifts: remote-work effects on office-using industries, Front Range tourism rebound, in-migration-driven services growth. The Top Industry card for Denver County reads "Professional & Technical Services" today — that was already true in 2021 and remains true, so the directional signal is sound. But the *magnitude* (we report 14.7% share) is point-estimate-stale. Plus or minus 2 points by 2026 is plausible.

**Mitigation:** LEHD LODES8 publishes annually; 2023 vintage typically lands Q3-Q4 of 2025 (so already published — pipeline just hasn't ingested). The wage-band CE01-CE03 cutpoints also adjust slightly each year; using 2021 cutpoints when underwriting a 2026 deal slightly under-prices "high-wage" jobs in absolute dollars.

### 6. PMA boundary = circular buffer, not commuting shed
**Where it shows up:** Every PMA-page calculation, including the new Site Summary card in #859.

**Why this matters:** A circular buffer crossing a state highway, a river, or an income-segregated neighborhood line will include census tracts whose residents don't actually compete for the same housing. Two 5-mile buffers centered on different sides of Federal Boulevard in Denver might score identically on demand metrics while serving completely separate sub-markets.

**The PMA card now explicitly documents this** — the methodology details say "buffer screening misses commuting-shed cuts (a 5-mile buffer can cross a 4-lane state highway that no LIHTC tenant would walk across)."

**The right answer:** the next iteration should integrate the LEHD LODES OD (origin-destination) flows that are already in `data/market/lodes_od_arcs_co.geojson` to construct an actual commuting-shed boundary. Right now those arcs are visualized as a map overlay but don't feed the PMA boundary.

### 7. Transit data is RTD-biased and rural sparse
**Status:** Documented in the new PMA card's methodology disclosure (#859).
**Risk:** A site in Sterling or Trinidad may show "no transit stop in OSM data" — accurate, but the implication isn't necessarily "no LIHTC viability"; rural projects often score well in CHFA's geographic-distribution category *because* they lack transit. The platform shouldn't penalize rural sites for failing TOD criteria when CHFA's QAP awards them other points instead.

**Mitigation deferred:** The Risk Flags panel should explicitly suppress "no transit" warnings when the site is in a CHFA-designated rural county (the QAP has a list). Not in this PR — flagged for backlog.

### 8. Owner cost burden via CHAS fallback is structurally different from ACS SMOCAPI
**Where it shows up:** Compare page's "% Owners Cost-Burdened" row, when the fallback fires (#855).
**The technical issue:** ACS SMOCAPI measures *Selected Monthly Owner Costs* (mortgage P&I + tax + insurance + utilities) as a percentage of household income. HUD CHAS measures *all housing costs* as a percentage of income across all owner households. For owner-occupied units with mortgages, the two are close; for paid-off owners (especially seniors in older Colorado mountain-town homes), CHAS will under-state the burden because property tax + insurance + utilities alone rarely exceed 30% of income.

**Why this matters:** The Compare card now shows Fruita at 24.7% owners cost-burdened from CHAS fallback. For a 2026 underwriting analysis, this is meaningful but not directly comparable to a 2024 ACS SMOCAPI figure from a different geography.

**What's shipped:** The disclosure note above the Compare homeownership table tells the user when each side is CHAS-vs-ACS. That's the right signal. We could also add a "see methodology" link that opens the technical detail.

### 9. Place-CHAS apportionment is area-weighted, not population-weighted
**Where it shows up:** Every place-level CHAS value on Compare and HNA after #849 (last week's PR).
**The technical issue:** When a place's TIGER polygon crosses two census tracts, the build script apportions the CHAS values by *area* (share of each tract that falls inside the place). Population-weighted apportionment would be more accurate for housing analysis because tract population is concentrated unevenly.

**Why this matters in practice:** For dense urban places (Denver, Boulder, Aurora), area and population approximations are close. For places like Fort Collins that span tracts with very different densities (downtown vs. CSU campus), area-weighting can over-represent low-density tracts.

**Mitigation deferred:** A population-weighted re-apportionment is a build-script change. Risk is moderate — we'd need to re-validate Compare + Ranking spot-checks. Worth a future PR with the test plan written ahead.

### 10. Vacancy is "one number" — doesn't distinguish lease-up phase, naturally vacant, or seasonally vacant
**The technical reality:** ACS DP04_0005E is a snapshot. It doesn't tell you whether a 5% vacancy is "5% naturally vacant" (healthy) or "5% in lease-up" (project just opened, will absorb).

**Industry standard practice:** A market study would distinguish stabilized vacancy from concession-adjusted effective vacancy from lease-up vacancy. None of these are in public data.

**Implication:** Treat the vacancy figure on this platform as a *trend indicator and screening filter only*. It should never be the sole basis for an absorption-rate assumption in a pro forma.

---

## Summary recommendations

**Must-fix-before-next-deploy (small lifts):**
1. Refresh the HUD FMR cache to FY2026. Script exists. Schedule it.
2. Surface the CHAS vintage prominently on Compare's owner-burden row (currently it says "HUD CHAS" but not "2018-2022"). Match the renter-burden pill convention.
3. Add a "rural" override on the Risk Flags so "no transit" doesn't fire for CHFA-designated rural counties.

**Should-fix-soon (medium lifts):**
4. Refresh CHAS to 2019-2023 vintage. Build pipeline change + data regeneration.
5. Refresh LEHD WAC to 2023 vintage. Similar effort to CHAS refresh.
6. Re-apportion place-CHAS using population weights (not area). Validate Compare + Ranking spot-checks before shipping.

**Worth-investing-in (larger):**
7. Build a commuting-shed PMA boundary alternative using `lodes_od_arcs_co.geojson`. Lets advanced users pick "buffer" vs. "commuting shed" delineation methods.
8. Document a paid-data escalation path on the PMA page: "For deals over X units or below Y AMI, consider commissioning a CoStar MultifamilyTrack pull + a professional market study." Make the platform's screening role explicit, not implicit.

**Out of scope for this platform (be honest about it):**
9. Project-level absorption rate forecasting — needs CoStar/Yardi data + manual underwriting judgment.
10. Site-specific traffic / noise / school-quality assessments — needs paid GIS tools or local consultants.

---

## Cross-cutting risk: the user-trust gap

The biggest analytical risk isn't any single missing data point — it's the temptation for a user to treat the platform's confident-looking numbers as a substitute for a market study. We've added a lot of small "Screening tool only" disclaimers, but they get faded out by familiarity.

**Recommended UX intervention** (not in any current PR but should be):
- On the PMA page's Run Analysis button, after the FIRST analysis runs in a session, show a one-time modal: "This is screening data. It will help you decide whether to commission a real market study, not replace one. Click to acknowledge." Store the ack in localStorage; reset every 30 days.
- On the Deal Calculator, the "Screening tool only" note in the H1's lead-paragraph is easy to miss after the user has run the calc once. Move it inside the Equity output card so it's adjacent to the headline output number.

This is a behavioral-design problem, not a data problem. Solving it requires intentional friction, not more data.

---

*End of methodology gap analysis.*
