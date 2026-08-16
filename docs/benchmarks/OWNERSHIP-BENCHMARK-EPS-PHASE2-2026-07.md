# Ownership-Need Benchmark vs EPS Phase II (2026-07-12)

**Purpose**: #1167 step 1 — validate `js/hna/hna-ownership-need.js` (tier
constants, inputs, and tenure-mix recommendations) against a professional
study before the ownership analysis carries more weight. Benchmark source:
EPS "Regional Housing Needs Assessment — Draft Phase II Report" (June 16,
2026, EPS #243156), covering Pitkin County, Garfield County, and 9
municipalities. This mirrors the rental-side benchmarking discipline
(see `docs/audits/HNA-BENCHMARK-RATIOS-2026-07-08.md` and the 5-report
comparison of 2026-07-04).

**Method**: ran the real `computeOwnershipNeed()` (vm-loaded, same as its
test harness) for all 11 EPS jurisdictions with the repo's live inputs —
`place-chas.json` / `chas_affordability_gap.json`, `co_ami_gap_by_*.json`,
`home-value-cascade.json`, `HNAUtils.AFFORD` assumptions — and compared
inputs and outputs against EPS Table 2 (cost-burdened households, ACS
2020–2024), Table 3 (households by AMI, CHAS 2018–2022), Figures 3–4
(tenure split, ACS 2020–2024), and Section 4 (policy recommendations).

## Results

| Jurisdiction | Renter % repo / EPS | Total CB % repo / EPS | ≤30% AMI repo / EPS | Repo tiers (rental/own/fit) | Afford class | Repo recommendation |
|---|---|---|---|---|---|---|
| Pitkin County | 34.9 / 37 | 36.1 / 38.1 | 9.3 / 8.3 | Moderate / Very High / High | (unavailable) | Ownership-supportive |
| Garfield County | 30.1 / 30 | 31.3 / 34.8 | 10.9 / 9.9 | Moderate / High / Very High | (unavailable) | Ownership-supportive |
| Aspen | 41.9 / 43 | 31.8 / 47.1 | 10.1 / 7.5 | Moderate / Very High / High | priced-out | Ownership-supportive |
| Snowmass Village | 27.3 / 39 | 34.4 / 32.5 | 8.7 / 8.1 | Moderate / Very High / High | priced-out | Ownership-supportive |
| Basalt | 24.8 / 41 | 43.2 / 42.4 | 8.8 / 5.9 | High / Very High / Moderate | priced-out | Rental + ownership mix |
| Carbondale | 35.7 / 36 | 33.0 / 35.2 | 12.4 / 12.4 | Moderate / Very High / High | priced-out | Ownership-supportive |
| Glenwood Springs | 42.1 / 45 | 33.3 / 40.6 | 12.7 / 14.0 | Moderate / Very High / Very High | priced-out | Ownership-supportive |
| New Castle | 21.4 / 27 | 29.5 / 46.9 | 12.6 / 11.0 | Low / Very High / High | priced-out | Ownership-supportive |
| Silt | 23.2 / 26 | 38.4 / 36.1 | 6.8 / 9.9 | Moderate / Very High / High | priced-out | Ownership-supportive |
| Rifle | 22.7 / 34 | 25.4 / 31.1 | 10.4 / 8.2 | Low / High / Very High | priced-out | Ownership-supportive |
| Parachute | 28.8 / 49 | 27.1 / 30.0 | 12.5 / 11.9 | Moderate / Low / High | priced-out | Verify locally |

## Verdict on the module and its constants

**The constants are NOT invalidated — keep them, keep the screening
caveat.** Where the repo's inputs are structurally sound (both counties,
Aspen, Carbondale, Glenwood Springs), the module's inputs track EPS within
a few points (Carbondale ≤30% AMI matches exactly at 12.4), the
priced-out affordability classifications are unambiguous and correct for
every municipality, and the tenure-mix recommendations directionally match
EPS's policy program — which is preservation + deed-restriction expansion
+ buyer programs + "alternative homeownership affordability programs"
across the region, i.e., ownership-supportive, exactly what the module
outputs for 9 of 11 jurisdictions. Basalt's "Rental + ownership mix" is
also consistent with EPS (Basalt has the region's heaviest renter CB).

## Findings (input problems, not constant problems)

### F1 — Small-town tenure mix is biased by tract apportionment (root-caused)
Renter-share divergences concentrate in small towns embedded in large
rural tracts: Parachute 28.8 vs 49 (−20 pts), Basalt 24.8 vs 41, Rifle
22.7 vs 34, Snowmass 27.3 vs 39. Cause: `place-chas` apportions tract
records into place boundaries, so a small town inherits the **tenure mix
of its host tract(s)** — owner-heavy rural surroundings — rather than the
town's own renter-heavy mix. EPS uses direct ACS place-level tables.
Parachute's EPS renter share was 49% in BOTH 2019 and 2024, so this is
structural, not vintage. All four towns carry `acs_anchor: true` (level
cap applied) but the cap preserves the biased mix.
**Fix path (data in hand)**: the place summary caches already carry
direct ACS place-level tenure (`B25003_001E`/`B25003_003E`, always-run
detail supplement since PR #1153) — rescale place-chas renter/owner
totals to the ACS place tenure split (a tenure-aware extension of the
existing acs_anchor cap). Filed as a follow-up issue.

### F2 — Basalt is a cross-county town being read in the wrong county frame
`cross-county-places.json`: 74% of Basalt's population is in Eagle County
(primary county 08037), not Pitkin. EPS reports "Basalt (total)". Any
county-context input (AMI, county fallback) using Pitkin for Basalt is
misframed. The ownership panel should use the primary county for
cross-county places. Folded into the F1 follow-up issue.

### F3 — Cost-burden divergence is mostly vintage, and it lags in the fast-moving towns
Repo CHAS is 2018–2022; EPS Table 2 is ACS 2020–2024, and EPS's own
2019→2024 deltas show the region deteriorated sharply after the CHAS
window (New Castle total CB 23.7%→46.9%; Aspen 35.1%→47.1%). The repo's
`rentalPressure` tier reads **Low** for New Castle while EPS shows 100% of
its <$75k renters cost-burdened in 2024. This is the same CHAS-vintage
lag disclosed in #1180, now with evidence it can flip a *tier*, not just
a count. No constant change recommended; the ownership panel should carry
the (existing) screening caveat plus the #1180 methodology cross-link.
Watch for the CHAS 2019–2023 refresh (blocked upstream by HUD WAF — known
deferred item) which will close most of this gap.

### F4 — Counties get no affordability classification
`affordabilityTest` returns null for both counties because
`home-value-cascade.json` covers places only. County median home values
are available (ACS DP04 county-level, already in summary caches; ZHVI
county series exists). Small gap, filed as a follow-up; matters because
the county HNA view is the default landing for most users.

## Bonus extraction — EPS Table 12 program inventory (seeds roadmap item 6)

Per-jurisdiction ownership-program presence (X = program exists), from
EPS Table 12 (June 2026):

| Program | Pitkin | Aspen | Snowmass | Basalt | Garfield | Carbondale | GWS | New Castle | Silt | Rifle | Parachute |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Deed restriction / buy-down | X | X | X | — | — | X | X | — | — | — | — |
| Inclusionary housing | X | X | X | X | X | X | X | X | — | — | — |
| Down-payment assistance | X | X | X | — | X | — | X | — | — | — | — |
| Employee housing programs | X | X | X | — | — | — | X | X | — | — | — |
| Habitat for Humanity | X | — | X | X | X | X | X | X | — | — | — |
| Rental assistance | — | X | — | — | — | — | X | — | — | — | — |
| ADU incentives | — | X | X | X | X | — | X | — | — | X | — |
| Fee waivers/reductions | — | X | — | X | X | X | X | X | — | — | — |

Plus: WMRHC "Good Deeds" buy-down program (up to 30% of purchase price
for a perpetual price-capped deed restriction; 23 restrictions purchased
as of June 2026; 1,400 hrs/yr local-work qualification) — the concrete
regional shared-equity mechanism roadmap items 5–6 should model first.
EPS policy direction: Pitkin = preserve inventory + replace expiring
restrictions + mobile-home preservation + regional CLT; Garfield =
broaden deed restrictions (income-based AND resident-occupancy), template
deed restriction, land trusts / shared equity, buyer programs.

## Roadmap consequences (#1167)

1. Benchmark step: **done** (this doc). Constants keep; caveats stand.
2. Before Tier 1 item 4 (de-islanding) surfaces ownership tiers more
   widely, land the F1/F2 tenure-mix fix — it changes `renterShare`,
   `ownershipFit`, and potentially `rentalPressure` tiers for exactly the
   small towns the roadmap cares about.
3. Tier 1 item 2 (B25075 supply metric) and item 1 (for-sale deal calc)
   are unaffected by these findings.
4. Table 12 above is the starting dataset for roadmap item 6 (ownership
   funding landscape); WMRHC Good Deeds is the model case for item 5
   (deed-restriction/shared-equity module).
