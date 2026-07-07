# Affordable Ownership Need Methodology

## Plain-English Summary

Affordable Ownership Need is a screening layer inside the Housing Needs Assessment. It does not replace the rental need analysis and it does not determine whether households can buy a home. It separates tenure signals so a jurisdiction can see where LIHTC rental, deed-restricted ownership, shared-equity homes, down-payment assistance, owner stabilization, or local policy work may need to be considered together.

All outputs are screening estimates. Before using them for a project decision, verify local sales prices, HOA costs, mortgage assumptions, down-payment assistance, household size, employer demand, household readiness, and deed-restriction policy.

## Intended Use

Use this section to answer four screening questions:

- How large is the renter cost-burdened household count?
- How large is the owner cost-burdened household count?
- Is there a moderate-income renter base that may make ownership tools worth local verification?
- Does the tenure strategy read as rental priority, mixed rental and ownership, ownership-supportive, deep affordability priority, or verify locally?

The section is additive. It does not change any existing HNA score, AMI gap, projection, or ranking.

## Data Sources

- HUD CHAS 2018-2022, via `data/hna/place-chas.json` for places/CDPs and `data/hna/chas_affordability_gap.json` for counties.
- ACS anchor metadata in `place-chas.json`; where `acs_anchor.applied === true`, household counts were capped to ACS occupied units to avoid apportionment overcount.
- Rental AMI gap context from `data/co_ami_gap_by_place.json` and `data/co_ami_gap_by_county.json`.
- Home-value context from `data/hna/home-value-cascade.json` for places/CDPs and the already-loaded ACS profile value for counties.
- Shared HNA affordability assumptions from `HNAUtils.AFFORD`, so the ownership screen and adjacent HNA affordability panels use the same carrying-cost model.

## CHAS Bands

The module uses only CHAS-native HAMFI bands:

- `lte30`
- `31to50`
- `51to80`
- `81to100`
- `100plus`

The moderate-income ownership-fit screen is `51to80 + 81to100`. The `100plus` band is reported only as above the published CHAS threshold; it is not split further. Sub-band splits that are not published in CHAS are not derived or inferred.

## Core Formulas

### Rental Pressure

Inputs:

- Renter households cost-burdened at the 30% threshold.
- Renter households cost-burdened at the 50% threshold.
- Renter share of all occupied households.

Formula:

```text
renter_cb30_share = renter_cb30_count / total_renter_hh
renter_cb50_share = renter_cb50_count / total_renter_hh
renter_share = total_renter_hh / (total_renter_hh + total_owner_hh)
```

Each input is scored against fixed cutpoints, then averaged into a Low, Moderate, High, or Very High tier.

### Ownership Pressure

Inputs:

- Owner households cost-burdened at the 30% threshold.
- Owner households cost-burdened at the 50% threshold.
- Moderate-income owner cost-burdened share.

Formula:

```text
owner_cb30_share = owner_cb30_count / total_owner_hh
owner_cb50_share = owner_cb50_count / total_owner_hh
moderate_owner_cb_share =
  (owner_cb30_count_51to80 + owner_cb30_count_81to100) /
  (owner_hh_51to80 + owner_hh_81to100)
```

### Potential Shared-Equity Fit

Inputs:

- Moderate-income renter household count.
- Moderate-income renter share of renter households.
- Modeled ownership affordability classification.

Formula:

```text
moderate_income_renter_hh = renter_hh_51to80 + renter_hh_81to100
moderate_income_renter_share = moderate_income_renter_hh / total_renter_hh
```

This is not a readiness screen. It only indicates whether the local renter base makes ownership-oriented tools worth further verification.

## Ownership Affordability Test

The affordability test compares the selected geography's median home value with modeled maximum affordable purchase prices for a four-person household at county AMI thresholds.

Assumptions are read from the shared `HNAUtils.AFFORD` object:

- Mortgage rate: 6.50%.
- Term: 30 years.
- Front-end housing ratio: 30% of gross income to PITI and PMI.
- Down payment: 10%.
- Property tax: 0.65% of value per year.
- Insurance: 0.35% of value per year.
- PMI: 0.50% of loan balance per year while loan-to-value is above 80%.

Formula:

```text
monthly_budget = annual_income * 0.30 / 12
loan_share = 1 - down_payment_rate
monthly_mortgage_factor =
  r * (1 + r)^n / ((1 + r)^n - 1)
monthly_cost_per_price_dollar =
  loan_share * monthly_mortgage_factor
  + (property_tax_rate + insurance_rate) / 12
  + loan_share * pmi_rate / 12
max_affordable_price = monthly_budget / monthly_cost_per_price_dollar
```

Classification:

- `market-attainable`: median home value is at or below the lower modeled threshold. Fit tier is capped at Moderate and the recommendation emphasizes down-payment assistance and owner stabilization.
- `stretch`: median home value is between the two modeled thresholds. Fit tier stands on the renter-base term and the section asks for local verification.
- `priced-out`: median home value is above the upper modeled threshold. Ownership fit depends on deed restriction, subsidy, shared equity, or similar affordability design.

If home value is missing or flagged for review, the affordability term is omitted and data quality is capped at Medium. Missing or flagged home-value input does not silently cap the fit tier; it removes only the affordability-price term.

## Threshold Constants

Cutpoints are fixed round-number approximations of statewide county quartiles from `data/hna/chas_affordability_gap.json`, computed on 2026-07-06.

| Input | County quartiles | Fixed cutpoints |
| --- | ---: | ---: |
| Renter cost-burdened share | 0.3451 / 0.4152 / 0.4726 | 0.35 / 0.42 / 0.47 |
| Severe renter cost-burdened share | 0.1511 / 0.2108 / 0.2442 | 0.15 / 0.21 / 0.24 |
| Renter share of households | 0.2353 / 0.2829 / 0.3194 | 0.24 / 0.28 / 0.32 |
| Owner cost-burdened share | 0.1875 / 0.2129 / 0.2459 | 0.19 / 0.21 / 0.25 |
| Severe owner cost-burdened share | 0.0777 / 0.0874 / 0.1000 | 0.08 / 0.09 / 0.10 |
| Moderate-income owner cost-burdened share | 0.1782 / 0.2875 / 0.3634 | 0.18 / 0.29 / 0.36 |
| Moderate-income renter household count | 190 / 525.5 / 1415 | 200 / 500 / 1400 |
| Moderate-income renter share | 0.2965 / 0.3298 / 0.3551 | 0.30 / 0.33 / 0.36 |
| Deep renter severe-burden share | 0.4420 / 0.5691 / 0.7369 | High trigger: 0.57 |
| Deep renter severe-burden count | 1.4 / 7.5 / 43.5 | Minimum trigger: 150 |
| Deep renter severe-burden share of all households | 0.0124 / 0.0251 / 0.0512 | Minimum trigger: 0.03 |

Each tiered component receives a score from 0 to 3 based on these cutpoints. Component scores are averaged, then translated as:

- Low: below 0.75
- Moderate: 0.75 to below 1.75
- High: 1.75 to below 2.5
- Very High: 2.5 or higher

## Recommendation Logic

The recommendation follows this order:

```text
if rentalHigh and ownershipHigh:
  Rental + ownership mix
else if rentalHigh and fitLow:
  Rental priority
else if ownershipHigh and fitModerateOrUp:
  Ownership-supportive strategy
else if deepAffordabilityHigh:
  Deep affordability priority
else:
  Verify locally
```

The deep affordability branch requires all three conditions: the <=30% HAMFI severe-burden rate is at least 57%, the affected count is at least 150 households, and the affected count is at least 3% of all occupied households. In the current statewide place-CHAS file, this gates the branch to 43 of 453 place records with usable <=30% renter-band data, or 9.5%.

Rental and ownership strategies are complementary. The recommendation is not a market study, underwriting conclusion, or funding determination.

## Data Quality

- High: full summary and all renter/owner AMI bands are present.
- Medium: summary is present but AMI bands are partial; or `low_confidence`; or `acs_anchor.applied === true`; or home value is missing/flagged.
- Low: county fallback is used for a place/CDP, or only partial summary is available.
- Unavailable: tenure and cost-burden data are missing.

Every card displays a provenance pill (`place-CHAS`, `county-CHAS`, or `county-CHAS fallback`) so a place selection never silently displays county-scope data.

AMI-gap sign convention is normalized before the calculator runs. Place AMI-gap records use positive values as shortages; county AMI-gap records use positive values as surplus. Each selected gap record is tagged as `place` or `county`, so a county fallback cannot fabricate a positive place shortage from a county surplus.

## Limitations

- CHAS is an income-band and cost-burden source, not a household readiness file.
- The affordability test is modeled from assumptions; it does not observe current listings, HOA dues, insurance quotes, credit, assets, down-payment assistance, or local deed restrictions.
- A true current median purchase price may differ from ACS or ZHVI-derived home-value inputs.
- The rental AMI gap row is context only; it remains a rental supply signal, not an ownership count.
- This module does not alter HNA rankings, projections, place pages, jurisdiction digests, or briefs in Phase 1.
