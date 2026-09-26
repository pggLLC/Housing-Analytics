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

---

## 6. Colorado fee reductions and land-use incentives — verified assessment (2026-09-26)

**Type:** screening context, not a study. **Data:** `data/policy/fee-reductions.json` (schema `fee-reductions/v1`), checked by `tests/test_fee_reductions.py`; the Housing News brief `co-fee-reductions-2026` in `data/policy_briefs_curated.json` summarises it, and each jurisdiction's verified measures appear in its Housing Needs Assessment under local resources ("What this jurisdiction does to lower affordable-housing cost").

**How it was built.** Every entry was read from the jurisdiction's own code, resolution, fee schedule, council record or program page (or its utility's or district's). The page was saved, and every quote was checked by exact substring match against the saved text. Every dollar amount and percentage an entry states appears in its own quotes. A source that could not be read is listed in `meta.known_gaps`, not filled in. Nine items rest on a news report or a reproduction of a statute and say so (`verification.level: "reported"`): three fee entries and six legal-basis items. An amount a source does not publish is `null`, never `0`. Each fee entry is a standing `program`, a one-off `project_award` (what a jurisdiction did for one project — an example, not an offer: Loveland's Mirasol Phase III, Brighton's Ravenfield, Castle Rock's Meadowmark, Montrose's VOA Rendezvous, Grand Junction's 2024 CDBG taps, Crested Butte's Whetstone deferral), or `repealed` (Grand Junction's 2024 program). The HNA lists standing programs first; a jurisdiction counts as having an active fee reduction only through a standing program.

**What the numbers below count.** The counts are recomputed by the guards from the dataset, so they cannot drift from it: 105 Colorado fee measures in 39 jurisdictions, 50 land-use or zoning incentives in 31 jurisdictions, and 21 statutes, bills and state guidance documents. That is a sample of the places checked, not a census; a jurisdiction with no entry has not been shown to have no program.

### 6.1 The fees, and why they exist

| Fee | Charged by | One-time or recurring | What it pays for |
|---|---|---|---|
| Water / sewer **tap** fee | City utility, or a separate water, sanitation or metropolitan district | One-time | Connection and a share of system capacity |
| **Plant investment fee (PIF)** / **system development charge (SDC/SDF)** | City utility or district | One-time | Buy-in to treatment and supply capacity built for growth |
| **Impact fees** — transportation, parks, police/fire/EMS, schools | City, county, or a fire district (e.g. Windsor collects the fire district's) | One-time | Capital facilities for new development |
| Building permit and plan-review fees; construction **use tax** | City or county | One-time | Review and inspection; general revenue |
| Monthly water / sewer / stormwater **rates** | Utility | Recurring | Operating the system |

Utilities describe the one-time charges as growth paying its own way. Denver Water: "An SDC is a one-time charge assessed to new development to recover the cost for the capacity required to provide service", and SDCs "serve to mitigate inequities between new and existing customers by requiring 'growth to pay its own way.'" [S1]. Brighton says its new water plant "will be funded in part by contributions from developers and in part by rates from current users" [S1]. A 2017 legal presentation hosted by the Colorado Municipal League gives the same rationale ("Growth 'pays its own way'"); it is a presentation, not a CML policy statement [S1].

**Who charges matters.** A town can only waive its own fees. Aspen says some fees "can't be waived because they are out of the city's purview", naming the Aspen School District and the sanitation district [S-aspen]. Grand Junction's program covers only city water and sewer: "Fees for Ute or Clifton Water will not be considered." [S-gj]. **Districts have their own waiver power.** Under C.R.S. 32-1-1001(1)(j)(II), a special district board "may waive or amortize all or part of the tap fees and connection fees or extend the time period for paying all or part of such fees for property within the district in order to facilitate the construction, ownership, and operation of affordable housing", and may condition that on a recorded deed restriction or lien requiring payment if the property stops being affordable housing (read from a reproduction of the 2024 C.R.S.). It is permissive. Avon's Municipal Code §18.01.020 paraphrases it as "no district shall impose a tap fee or connection fee for any property owned or used for affordable housing", which overstates the statute.

### 6.2 Legal basis

**Special districts — C.R.S. 32-1-1001(1)(j)(II):** see 6.1; a district *may* waive, amortize or defer its own taps for affordable housing.

**Impact fees — C.R.S. 29-20-104.5** (read from a reproduction of the 2024 C.R.S.; the official host could not be read from this environment) [S2].
- Fees must follow a schedule that is "(a) Legislatively adopted; (b) Generally applicable to a broad class of property; and (c) Intended to defray the projected impacts on capital facilities caused by proposed development."
- The fee must be set "at a level no greater than necessary to defray such impacts directly related to proposed development." The statute does not use the phrase "roughly proportional"; that is the federal constitutional test for individual exactions, which this assessment did not research.
- **Waiver:** "a local government may waive an impact fee or other similar development charge on the development of low- or moderate- income housing or affordable employee housing as defined by the local government." Permissive: *may*, not *must*.
- **Deferral:** nothing "shall be construed to prohibit a local government from deferring collection … until the issuance of a building permit or certificate of occupancy."

**Enterprises and TABOR — Colo. Const. art. X §20 and C.R.S. 37-45.1** (read from reproductions) [S3].
- An enterprise is "a government-owned business authorized to issue its own revenue bonds and receiving under 10% of annual revenue in grants from all Colorado state and local governments combined." Enterprise revenue is excluded from the TABOR limit; Legislative Council Staff give the State Fair Authority as an entity that lost enterprise status by receiving more than 10 percent of its revenue from state and local governments.
- For water activity enterprises, "grant" excludes "public funds paid or advanced … in exchange for an agreement by a water activity enterprise to provide services including the provision of water, the capacity of project works".
- **What follows, and what does not.** A utility that simply forgives tap revenue loses it; if a city instead pays the utility, the payment is either a grant counted against the 10% ceiling or, arguably, a purchase of capacity that is not a grant. That reading comes from the definitions only. No court decision on waiver backfill was read, so treat it as the reason cities *say* they repay utilities, not as settled law.

**Housing authorities.** Grand Junction's Resolution 45-25 recites that C.R.S. 29-4-227(1) exempts housing authorities from development-related fees due to a local government, and that the city "will not backfill those fees from the City budget" (statute cited by the city; not read directly) [S-gj]. A 2020 bill to exempt housing authorities from water conservancy district tap and impact fees (HB20-1164) was lost [S4].

**Proposition 123 — C.R.S. 29-32-105** [S5]. To stay eligible a local government must commit to annual increases in affordable units and adopt a fast-track process giving a final decision within 90 days on projects that are at least half affordable. The fast track is a review deadline; fee waivers appear nowhere in the statute, the FAQ or DOLA's guidance read. HB26-1313 (became law) adds unit credit for donated land, money from several local governments, and county property-tax exemptions; whether a fee waiver counts as money a local government "provided" is not stated in anything read (known gap).

**State bills, 2021–2026: fee relief is always optional.** [S6]
| Bill | Status | What it says about fees or land use |
|---|---|---|
| HB21-1117 | Became law | Local inclusionary zoning is allowed if the government offers options, including reducing utility charges, fees or taxes (quote below) or granting density bonuses |
| HB21-1271 | Became law | Grant menu includes "a program to subsidize or otherwise reduce local development review or fees, including … water and sewer tap fees" |
| HB22-1304 | Became law | Grants may pay construction costs "including … tap fees, building permits, and impact" fees |
| HB24-1152 (ADUs) | Became law | Keeps generally applicable impact fees; "waiving, reducing, or providing financial assistance" for ADU fees is one strategy for an "ADU supportive jurisdiction"; a $5 million grant fund reimburses local fee relief per permitted ADU |
| HB24-1313 (transit-oriented communities) | Became law | Reducing impact fees for regulated affordable housing is one listed strategy; generally applicable impact fees remain allowed |
| SB24-174 | Became law | Housing needs assessments from December 31, 2026; fee reduction is one listed strategy |
| HB24-1304 (parking) | Became law | Limits minimum parking requirements near transit in MPO areas |
| HB25-1211 | Became law | Special-district tap fees must be "reasonably related to all costs incurred by the district in funding and providing water or sanitation service", with factors such as unit size for "proportional or reduced fees"; no affordable-housing waiver |
| SB23-213; HB20-1164 | Lost | — |

The HB21-1117 option, verbatim: "Materially reduce or eliminate utility charges, regulatory fees, or taxes imposed by the local government applicable to affordable housing units". No enacted 2026 bill on fee waivers was found (HB26-1114 was lost).

**State guidance.** DOLA's Division of Housing says "Some fees may be waived by city staff while, generally, waivers of larger fees must be approved by city council or county commission" and that eligibility "can be limited to nonprofit developers, or available to all projects that meet specific and specified affordable criteria" [S7].

### 6.3 How waived fees are paid for

Only 22 of the 105 Colorado fee measures say; 83 do not (`backfill.method: not_specified`). Where a source does say:

| Method | Entries | Examples (verified) |
|---|---|---|
| General fund pays the fee fund | 11 | Grand Junction (Res. 45-25: "the General Fund or other special revenue funds … for the repayment of the fees"); Brighton, Ravenfield Senior Apartments: $871,183.60 total reduction, "$ 200,644.10" required from the general fund into the enterprise funds, appropriated in 2026 Budget Amendment No. 1; Loveland's general policy that a waived capital-related fee "be paid by the general fund or another appropriate fund" |
| Housing fund pays | 3 | Loveland, Mirasol Phase III (2018): the Community Housing Development Fund reimbursed up to $366,070 of waived utility fees; Crested Butte (general fund or affordable housing fund, reported); Dillon ADU tap reimbursement from the town's 5A housing funds (reported) |
| Grant | 2 | Grand Junction: CDBG paid sewer and tap fees for Habitat for Humanity units |
| Utility's own funds | 1 | Colorado Springs Utilities funds its share of the rebate program ($2M a year cap) |
| Not backfilled | 5 | Loveland's Mirasol capital expansion fees (up to $504,807) and permit fees (up to $96,915): "no reimbursement"; Castle Rock, Meadowmark (2023): $500,000 partial waiver, "affected funds will not be made whole"; Grand Junction housing-authority exemption; Lafayette, which may not waive enterprise fees at all |

**Pattern.** Where a city relieves *utility* fees, the source usually names another fund that repays the utility (Loveland, Brighton, Grand Junction), requires money from outside the utility (Longmont §4.79: "Subject to the appropriation of funds from other than the water, sewer and electric and broadband utility funds"), or excludes utility fees from waivers (Lafayette). Non-utility impact and permit fees are more often simply forgone (Loveland, Castle Rock). That is consistent with the enterprise rule in 6.2, though no source reviewed states the TABOR ceiling as its reason.

### 6.4 Trends

Counts from the dataset; "one-time" excludes monthly rate discounts. Adoption dates are known for 84 of the 107 entries.

**Measure mix.** 46 waived · 25 reduced · 14 reimbursed after payment (rebates, credits, fees paid on the project's behalf) · 8 deferred · 12 monthly rate discounts. **Deferral is kept apart**: Fort Collins, Lafayette, Salida, Avon, Trinidad and Crested Butte (Whetstone, reported) defer fees, which are still owed; they help construction cash flow, not total development cost.

**Direction since 2022.** Among entries with an adoption date, those adopted in 2022 or later are 19 waived, 15 reduced, 9 reimbursed, 8 rate discounts and 2 deferrals; before 2022 the figures are 17, 3, 4, 3 and 4. Partial reductions and pay-then-rebate programs are the growth area: Colorado Springs (2022, rebate after full payment — its rules say the program "does not constitute a fee reduction or waiver"), Littleton (2022, $2,500 per affordable unit), Denver (EHA, 2022), Grand Junction (2024, rebuilt in 2025), Crested Butte (2025). The counts are small; read them as direction, not rate.

**Discretion.** 60 of 92 one-time measures need council or staff approval; 25 are by right. Several are "subject to available appropriations" (Durango) or "contingent upon the allocated annual budget" (Grand Junction). A developer should count a waiver only once it is committed to the project.

**By region** (county-based: *mountain resort* = Pitkin, Eagle, Summit, San Miguel, Gunnison, Grand, Chaffee, Lake, Ouray, Archuleta, Routt; *Western Slope* = Mesa, Montrose, Delta, La Plata, Montezuma, Garfield; *Front Range and other* = the rest):

| Region | Jurisdictions | Fee measures | Mix | Eligibility |
|---|---|---|---|---|
| Mountain resort | 14 | 37 | 26 waived, 3 reduced, 3 deferred, 2 reimbursed, 3 rate | Deed restriction; only 4 of 34 one-time measures name an AMI cap |
| Western Slope | 8 | 22 | 8 waived, 7 reduced, 4 reimbursed, 3 rate | Income-tiered: 15 of 18 one-time measures name an AMI cap |
| Front Range and other | 17 | 46 | 12 waived, 15 reduced, 8 reimbursed, 5 deferred, 6 rate | Mixed: 17 of 40 name an AMI cap |

- **Mountain resort towns** waive outright for deed-restricted homes. Mountain Village charges a deed-restricted employee condo/apartment a tap fee of 21,650 against 43,300 for a single-family home (the table's `$` sits in its own column), and has waived building, planning and design-review fees for deed-restricted units since January 1, 2019. Telluride's Building Official must waive the in-town tap attributable to a deed-restricted unit; Crested Butte waives water and sewer system development fees for recognised affordable housing; Avon, Minturn, Basalt, Fraser, Ridgway and Pagosa Springs let council waive case by case.
- **The Western Slope** scales by income. Grand Junction waives 100% of city impact fees for rentals at or below 70% AMI, 75% at 71–80% AMI and 50% at 81–90% AMI, with a 30-year commitment, and 100% for Proposition 123 projects; Durango caps waivers or refunds at $15,000 per rental and $18,000 per for-sale Fair Share home; Carbondale exempts 100, 80 or 60 percent of listed town fees by unit price with a 50-year deed restriction; Montrose abated an estimated $121,738 of connection fees for one project.
- **The Front Range** leans to reductions, rebates and credits: Denver's by-right building-permit reduction of $6,500 per income-restricted unit ($10,000 in high-market areas), Fort Collins' credit of up to $14,000 per unit, Loveland's sliding scale (for a unit at 60% AMI, 70% of fees), Littleton's $2,500 per unit, and Colorado Springs' rebate of up to 100% after payment.

**Eligibility thresholds.** AMI caps in the dataset run from 30% to 150% AMI; deed-restriction terms from 5 years (Commerce City) through 20 (Loveland, Lakewood) and 30 (Grand Junction, Littleton) to 50 (Carbondale) where stated.

**Typical dollars per unit.** Where a per-unit figure is published: $2,500 (Littleton), $6,500–$10,000 (Denver), up to $14,000 (Fort Collins), up to $15,000–$18,000 (Durango). Mountain Village's deed-restricted tap is half the single-family tap. Project totals: $121,738 (Montrose), $500,000 (Castle Rock), $871,183.60 (Brighton), and for Loveland's Mirasol Phase III, up to $366,070 of utility fees plus $504,807 of capital expansion fees.

### 6.5 Monthly utility rate relief

Rate discounts are recurring and are not a development-cost reduction (`reduces_total_cost: null`).
- **Tied to the home (deed restriction):** Telluride bills small deed-restricted in-town homes $91.83 a month for wastewater against $123.03, and $40.14 for the water base fee against $61.74. Mountain Village bills a deed-restricted employee condo 45.55 a month each for water and sewer against 91.10.
- **Tied to the household (income):** Westminster credits $30 a month ($360 a year) at or below 60% of area median income; Broomfield's Utility Rate Assistance Fund pays up to $240 a year; Fort Collins Utilities gives a 25 percent discount; Longmont rebates the water service charge to low-income residents and to operators of affordable rental buildings; Durango refunds utilities to households at or below 50% of median income.
- **Senior rate classes:** Fruita's 2026 senior sewer rate is $21.95 against $54.65 for a single-family residence, for residents aged 62+ with income at or below 130% of the federal poverty level; Rifle gives a 20% senior discount; Dolores has an elderly low-income discount (amount not published). These are household programs, not affordable-housing programs.
- **Out of state, for comparison:** Bellingham, WA gives reduced water, sewer and stormwater rates to nonprofit and housing-authority properties with rents restricted below 80% AMI, and 25%, 50% or 75% bill discounts by household income.

### 6.6 Land use and zoning that lower cost

50 verified items in 31 jurisdictions: 14 inclusionary-zoning ordinances with offsets, 11 expedited reviews, 7 density bonuses, 6 parking reductions, 3 dimensional reliefs, 2 lot-size reductions, 1 land-dedication reduction, 1 administrative approval, 5 other.
- **Expedited review tied to the Proposition 123 fast-track (90 days):** Denver, Pueblo, Mesa County, Buena Vista, Leadville, Eagle, Salida; Grand Junction (Resolution 60-25).
- **Parking:** Littleton cuts required parking an additional 25% near transit and 35% for majority-affordable projects; Greeley allows up to a 75 percent reduction for units affordable at up to 30 percent AMI; Colorado Springs lets the Manager reduce parking when at least 25 percent of units are at or below 80 percent AMI; Fruita's Land Use Code has an alternative affordable-housing parking standard; Durango allows a 10% reduction; Broomfield sets lower minimums for income-aligned multifamily.
- **Density and height:** Durango allows a 30% density increase for on-site Fair Share homes; Littleton 15%; Longmont up to 25% more units and one more story; Arvada 15 feet of extra height; Denver's enhanced EHA option allows up to 7 stories where 5 are allowed.
- **Inclusionary zoning (a requirement, with offsets):** Denver, Boulder, Broomfield, Longmont, Louisville, Littleton, Durango, Glenwood Springs, Carbondale, Salida, Eagle, Avon, Crested Butte, Gunnison County.
- Fruita's density bonus is not tied to affordability, and its adopted housing plan only *recommends* fee waivers, so neither is recorded as an incentive.

### 6.7 Corrections to earlier figures

The owner's Fruita brief (September 2026) and older repo files were used as leads, then re-read at source:
- **Denver:** the repo's "use-tax + plan-review fee waiver, $50K–$300K per project" is not on Denver's pages. The verified incentive is a by-right building-permit fee reduction under the EHA ordinance. The tax-abatement inventory row now shows the verified entry.
- **Loveland:** "100% waiver ≤60% AMI" is wrong. The code's sliding scale gives 70% at 60% AMI; up to 100% only for projects meeting stricter all-affordable criteria, at council discretion, with a 20-year restriction.
- **Grand Junction:** the 2024 CAPER reports CDBG-paid sewer and tap fees for 8 Habitat units, not four. The program page now takes requests for the 2027 budget year.
- **Fruita:** Resolution 2007-76 shows the senior sewer rate already existed in 2007–2008; it does not show that resolution created it. Municipal Code §13.28.020 leaves rates to resolution. The 2026 figures are confirmed in the November 4, 2025 council packet. No Fruita development-fee waiver was found; the two Fruita placeholders in `developer-ownership-funding.json` stay unverified.
- **Longmont:** the code section is §4.79 (§4.06 is Tourism Improvement Districts).
- **Telluride:** the tap waiver is in Land Use Code §3-110.E, not Ordinance 1623 (the rate ordinance).
- **Mountain Village:** 45.55 against 91.10 applies to both the water and the sewer monthly charge.
- **Silverthorne:** the waiver is discretionary and covers deed-restricted single apartments at the 100% AMI rental rate, not deed-restricted apartments and single-family homes generally.
- **Castle Rock:** "Castle View" was the applicant (Castle View Owner, LLC) for the Meadowmark project.
- **Denver Water:** its SDC credit is for water efficiency and is not listed as an affordable-housing measure.
- **Bennett:** not verified; every bennettco.gov page returned 403.
- **Deal Calculator:** the uncited note "CO statute permits waivers for income-restricted units" is replaced by the C.R.S. 29-20-104.5(5) wording, and its dead CML link by the statute.

### 6.8 Known gaps

The full list is `meta.known_gaps` in the dataset (70 items). The main ones:
- Official C.R.S. and constitution text could not be read here; reproductions were used and are marked as reported.
- Sites that blocked reading: Bennett, Delta, Englewood, Centennial, Breckenridge, Vail, Estes Park, the Colorado Springs Utilities deferral page, and parts of Salida, Telluride and Fort Collins.
- No income-qualified *rate* discount was found at Denver Water, Aurora Water, Colorado Springs Utilities or Pueblo Water. No affordable-housing fee relief was found for Aurora, Greeley, Thornton, Parker or Douglas County; that is not the same as none.
- Water, sanitation and metro districts were checked only where a town's source named them.
- The older `data/market/inclusionary_zoning_co.json` (15 rows, unverified) was not reconciled with the verified inclusionary entries here; that is a follow-up.

### 6.9 Sources

Every entry's source URL, and each quote's section, is in the dataset. The grouped references above:
- [S1] Denver Water, System Development Charge page; Brighton water treatment plant FAQ; CML-hosted 2017 legal presentation — see legal basis `growth-pays-rationale`.
- [S2] C.R.S. 29-20-104.5 — <https://colorado.public.law/statutes/crs_29-20-104.5> (reproduction).
- [S3] Colo. Const. art. X §20 (i2i.org reproduction); C.R.S. 37-45.1-102 — <https://colorado.public.law/statutes/crs_37-45.1-102> (reproduction).
- [S4] HB20-1164 — <https://leg.colorado.gov/bills/hb20-1164>.
- [S5] C.R.S. 29-32-105 — <https://colorado.public.law/statutes/crs_29-32-105> (reproduction); HB26-1313 — <https://leg.colorado.gov/bills/hb26-1313>.
- [S6] leg.colorado.gov bill pages and bill texts for HB21-1117, HB21-1271, HB22-1304, HB24-1152, HB24-1313, SB24-174, HB24-1304, HB24-1007, HB25-1211, SB23-213.
- [S7] DOLA Division of Housing, Local Housing Policy — <https://doh.colorado.gov/local-housing-policy>; DOLA ADU toolkit, waiving or reducing fees — <https://dlg.colorado.gov/waiving-or-reducing-fees>.
- [S-gj] City of Grand Junction, Affordable and Attainable Housing Incentive Program — <https://www.gjcity.org/1459/Affordable-and-Attainable-Housing-Incent>, and Resolution 45-25.
- [S-aspen] Aspen Daily News, June 29, 2026 (reported).
