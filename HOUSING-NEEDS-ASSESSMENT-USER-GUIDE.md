# Housing Needs Assessment — User Guide

> **Version:** 1.0 · **Data vintage:** ACS 5-year 2022, DOLA SDO 2024 forecasts
> **Last updated:** 2024-11-15

---

## Table of Contents

1. [Quick Start](#1-quick-start)
2. [Executive Snapshot Walkthrough](#2-executive-snapshot-walkthrough)
3. [Housing Stock by Structure Type](#3-housing-stock-by-structure-type)
4. [Affordability Analysis](#4-affordability-analysis)
5. [Rent Burden Distribution](#5-rent-burden-distribution)
6. [Commuting Patterns & Labor Market](#6-commuting-patterns--labor-market)
7. [Demographic Projections](#7-demographic-projections)
8. [Scenario-Based Projections](#8-scenario-based-projections)
9. [Prop 123 Compliance Tracking](#9-prop-123-compliance-tracking)
10. [Municipal Analysis Methodology](#10-municipal-analysis-methodology)
11. [Data Sources & Update Schedule](#11-data-sources--update-schedule)
12. [Troubleshooting & FAQ](#12-troubleshooting--faq)

---

## 1. Quick Start

### Selecting a Geography

1. Open **housing-needs-assessment.html** in your browser.
2. Use the **Geography type** dropdown to choose:
   - **County** — full county-level analysis using ACS, DOLA, and LEHD data directly.
   - **Municipality** — incorporated city or town; metrics are a blend of direct Census place
     data and county-level data scaled to the municipality.
   - **Census-Designated Place (CDP)** — unincorporated communities; treated like municipalities
     but with a slightly lower data confidence ceiling (see §10).
3. Use the **Select geography** dropdown to pick your community.
4. Click **Refresh** to load data (or it loads automatically on selection change).

### Interpreting the Data Quality Badge

Next to the geography name pill you will see a **Data Quality badge**:

| Badge colour | Label | Meaning |
|---|---|---|
| 🟢 Green | **Direct** | Metric comes directly from Census place-level data (highest accuracy). |
| 🔵 Blue | **Interpolated** | County data scaled by municipal population share and relative growth rate. |
| 🟡 Amber | **Estimated** | Extrapolated from county trends + market indicators (use with caution). |
| ⚫ Grey | **Unavailable** | No data; shown as N/A with an explanation. |

For **county** geographies every metric is **Direct** (straight from ACS / DOLA county tables).
For **municipalities** some metrics will be **Interpolated** or **Estimated** — this is expected
and unavoidable because the Census publishes many variables only at the county level.

---

## 2. Executive Snapshot Walkthrough

The **Executive Snapshot** card at the top of the page shows eight headline indicators:

| Indicator | Source | Notes |
|---|---|---|
| **Population** | ACS 5-yr DP05 | Total resident population |
| **Median household income (MHI)** | ACS 5-yr DP03 | Pre-tax household income |
| **Median home value** | ACS 5-yr DP04 | Owner-occupied units only |
| **Median gross rent** | ACS 5-yr DP04 | Includes utilities (GRAPI basis) |
| **Tenure** | ACS 5-yr DP04 | % owner-occupied vs. renter-occupied |
| **Rent burdened (≥30%)** | ACS 5-yr DP04 (GRAPI bins) | Fraction of renters paying ≥30% of income |
| **Income needed to buy** | Estimated | Assumes 10% down, 30-yr fixed at 7%, 30% payment-to-income |
| **Mean commute time** | ACS 5-yr S0801 | Workers 16+ who commute to work |

### Municipal vs. County Comparison Panel

When a **Municipality** or **CDP** is selected, a **"Municipal vs. County Context"** panel
appears below the stats strip. It shows:

- **Population share** — The municipality's population as a % of the containing county.
- **Est. housing units** — Municipal housing unit estimate (households ÷ (1 − vacancy rate)).
- **Rent vs. county** — How the municipal median rent compares to the county median
  (a factor > 1 means the municipality is more expensive than the county average).
- **Est. jobs in place** — Jobs estimated to be located within the municipality, scaled from
  county LEHD WAC data using the population share.

A **"How municipal metrics are estimated"** accordion at the bottom of the panel explains
the interpolation methodology in plain language.

---

## 3. Housing Stock by Structure Type

The **Housing Stock** section breaks down the total housing inventory by:

- **Structure type:** single-family detached, single-family attached (townhome), multifamily
  (2–4 units, 5–9 units, 10–19 units, 20+ units), mobile home / manufactured housing.
- **Tenure:** owner-occupied vs. renter-occupied units.
- **Vacancy:** total vacant units and vacancy rate.

**For counties:** Data comes directly from ACS 5-year DP04 (selected housing characteristics).

**For municipalities:** Structure-type proportions use county ACS distributions as a baseline.
Where Census publishes place-level structure data (larger municipalities), the direct figures
are used and labelled *Direct*. Smaller places may show county proportions applied to the
estimated municipal total, labelled *Interpolated*.

---

## 4. Affordability Analysis

### AMI Tier Explanation

Housing affordability is measured relative to **Area Median Income (AMI)** — the median
income for a 4-person household in the county or HUD metro area.

| AMI Tier | Household income as % of AMI | Typical label |
|---|---|---|
| 0–30% | Extremely low income | Deep subsidy required |
| 30–60% | Very low / low income | Tax credits, vouchers |
| 60–80% | Low-moderate income | Workforce housing |
| 80–120% | Moderate income | "Middle" housing gap |
| 120%+ | Above moderate | Market-rate |

### County Affordability Tiers

County-level AMI tier distributions come from ACS DP04 GRAPI (Gross Rent as a % of
Income) bins combined with ACS DP03 income distribution data.

### Municipal Affordability Tiers

For municipalities, the county tier distribution is *adjusted* based on the ratio of
the municipal median rent to the county median rent:

- If the municipality is **more expensive** than the county → households shift toward
  lower tiers (more cost-burdened).
- If the municipality is **less expensive** → households shift toward higher tiers
  (less cost-burdened).

This adjustment is a statistical approximation; confidence is labelled *Interpolated*.

---

## 5. Rent Burden Distribution

The **30% threshold** is the standard planning benchmark: households paying ≥30% of
gross income on housing are considered **cost-burdened**; those paying ≥50% are
**severely cost-burdened**.

### GRAPI Bins (ACS DP04)

The ACS publishes renter households in six GRAPI bins:

| Bin | % of income paid on rent |
|---|---|
| < 15% | Not burdened |
| 15–19.9% | Slightly burdened |
| 20–24.9% | Moderately burdened |
| 25–29.9% | Near threshold |
| 30–34.9% | Cost-burdened |
| ≥ 35% | Severely cost-burdened |

The HNA aggregates the top two bins (30–34.9% + ≥35%) to produce the **"rent burdened ≥30%"**
headline figure.

For municipalities, the rent burden rate is scaled from the county GRAPI using the
municipal rent adjustment factor (municipal median rent ÷ county median rent).

---

## 6. Commuting Patterns & Labor Market

### Data Source

The **Labor Market** section uses LEHD LODES WAC (Workplace Area Characteristics)
snapshots, which provide county-level employment data by wage tier and NAICS sector.

Available snapshots: 2019, 2020, 2021, 2022, 2023 (updated annually with a 12–18 month lag).

### Wage Tier Definitions

| LEHD field | Monthly wage range | Annual equivalent |
|---|---|---|
| CE01 | ≤ $1,250/mo | ≤ $15,000/yr |
| CE02 | $1,251–$3,333/mo | $15,001–$40,000/yr |
| CE03 | > $3,333/mo | > $40,000/yr |

### Commuting Flows

The commuting flows table shows:

- **Jobs in place** — Workers whose *workplace* is in the selected geography.
- **Resident workers** — Workers who *live* in the geography (ACS S0801).
- **Net flow** — Positive = more workers commuting *in* than out (employment hub);
  negative = more workers commuting *out* (bedroom community).

**For municipalities:** Job counts are estimated by applying the municipal population share
to county LEHD totals. This is labelled *Estimated* because LEHD WAC is only available at
the county / workforce area level; place-level LEHD data (RAC) requires a separate API call
and may not be available for all geographies.

---

## 7. Demographic Projections

### Age Pyramid

The age pyramid (population pyramid) shows the current-year age-sex distribution
from ACS 5-year DP05 data. It is useful for identifying:

- **Young adult bulge** (20–34) → near-term household formation pressure.
- **Baby boomer cohort** (60–74) → approaching retirement / downsizing.
- **Senior pressure** (75+) → demand for age-restricted, accessible, and assisted housing.

### 20-Year Outlook

The 20-year population outlook uses **DOLA/SDO county components-of-change** forecasts
(births, deaths, net migration) as the baseline. Key outputs:

| Output | How it is calculated |
|---|---|
| **Projected population** | DOLA SDO county forecast |
| **Households** | Population × headship rate |
| **Units needed** | Households ÷ (1 − target vacancy) |
| **Incremental units** | Units needed − current stock |

**Headship rate assumptions:**

- **Hold:** headship rate stays constant at the base-year level.
- **Trend:** headship rate changes at the historical slope (derived from ACS trend data).
  Use this for communities experiencing family formation or aging trends.

**For municipalities:** Population is scaled from county using the municipal population
share and relative growth rate (see §10 for methodology). The headship rate is set to the
county rate unless a municipal-specific ETL-derived value is available.

---

## 8. Scenario-Based Projections

The HNA provides three growth scenarios to bracket the range of plausible futures:

| Scenario | Description | When to use |
|---|---|---|
| **Low** | Population growth at 50% of baseline; higher mortality, lower fertility, lower in-migration | Conservative planning; infrastructure capacity analysis |
| **Baseline** | DOLA SDO forecast components; mid-range assumptions | Standard HNA reporting |
| **High** | Population growth at 150% of baseline; lower mortality, higher fertility, higher in-migration | Stress-test; capital improvement planning |

### Multiplier Mechanics

Each scenario applies multipliers to DOLA's three components of change:

- **Fertility:** scales birth rates relative to the baseline age-specific fertility schedule.
- **Mortality:** scales age-specific survival rates.
- **Migration:** scales annual net migration as a fraction of county population.

See [`scripts/hna/projection_scenarios.json`](scripts/hna/projection_scenarios.json) for
the exact multiplier values.

---

## 9. Prop 123 Compliance Tracking

### What is Prop 123 / HB 22-1093?

Proposition 123 (November 2022) directs DOLA to allocate funds to jurisdictions that
commit to increasing their affordable rental housing stock at a **3% annual rate**.
HB 22-1093 codified the fast-track land-use approval requirement.

### Eligibility Requirements

| Jurisdiction type | Minimum population threshold |
|---|---|
| Municipality (city / town) | ≥ 1,000 residents |
| County | ≥ 5,000 residents |

### Establishing a Baseline

The **baseline** is the number of rental housing units affordable at ≤ 60% AMI
in the jurisdiction as of the filing date.

The HNA estimates the baseline using:

1. County GRAPI distribution (% of renter households below 60% AMI).
2. Municipal renter household estimate (county renter % × municipal households).
3. Baseline = municipal renters × county 60%-AMI renter fraction.

### 3% Annual Growth Target

Once a jurisdiction files a commitment with DOLA, the growth target is:

```
Target(year N) = Baseline × (1.03)^N
```

The **Growth Tracking** chart shows actual or projected unit counts against the 3%-per-year
target trajectory.

### Compliance Checklist

The checklist tracks five key steps:

1. **Establish baseline** — Document current 60% AMI rental inventory.
2. **Adopt 3% growth target** — Pass a council/board resolution.
3. **Document fast-track process** — Establish a ministerial (≤ 90-day) approval path.
4. **File notice with DOLA** — Annual deadline is **January 31**.
5. **Annual reporting** — Submit progress report to DOLA.

### Annual Filing Deadline

**January 31** each year — file your commitment notice at
[DOLA Commitment Filings Portal](https://cdola.colorado.gov/commitment-filings).

---

## 10. Municipal Analysis Methodology

### Overview

When a municipality or CDP is selected, the HNA uses a **county-to-municipal scaling
framework** to produce sub-county estimates. This is necessary because the Census
ACS 5-year program publishes many variables only at the county level (or with unreliable
margins of error at the place level for small communities).

### Population Share Method

The core scaling formula:

```
Municipal Metric ≈ County Metric × Municipal Scale Factor

Scale Factor = municipal_pop / county_pop
             × (1 + municipal_growth_rate) / (1 + county_growth_rate)   [optional adjustment]
```

Where:
- `municipal_pop` — ACS 5-year place population.
- `county_pop` — ACS 5-year county population.
- `municipal_growth_rate` — 5-year CAGR from ACS trend data (see `data/hna/municipal/growth-rates.json`).
- `county_growth_rate` — DOLA SDO county historical CAGR.

### Housing Unit Estimation

```
Total housing units = municipal households ÷ (1 − county vacancy rate)
Renter units        = total units × county renter rate
Owner units         = total units − renter units
```

### Affordability Tier Redistribution

When a municipal median rent differs from the county:

1. Compute `rent_adj_factor = municipal_rent / county_rent` (clamped 0.5–2.0).
2. Apply a graduated weight to each AMI tier:
   - If `rent_adj_factor > 1` (more expensive): shift weight toward lower tiers.
   - If `rent_adj_factor < 1` (cheaper): shift weight toward higher tiers.
3. Renormalise so all tier fractions sum to 1.

### Data Confidence Scoring

| Source | Score | Label | Condition |
|---|---|---|---|
| Direct Census place data | 100 | Direct | Variable available in ACS place-level table |
| County-scaled by municipal characteristics | 80 | Interpolated | Place pop ≥ 2,500 |
| County-scaled only | 60 | Estimated | Place pop < 2,500 *or* key adjustment factors missing |
| No data | 0 | Unavailable | Variable not in ACS or county data absent |

### Small Place Handling

For municipalities **< 1,000 population**:
- 5-year ACS margins of error are typically very high (>20%).
- The HNA uses county data as the floor; no place-specific adjustments are made.
- Projected growth uses the **10-year smoothed** rate from `growth-rates.json` rather
  than the volatile 3-year rate.
- Confidence is capped at **Estimated**.

For municipalities **< 2,500 population**:
- Confidence is capped at **Estimated** for all interpolated metrics.
- Use 5-year ACS (not 1-year ACS) data; 1-year ACS is not published for places < 65,000.

### Limitations

1. **LEHD WAC is county-level only.** Place-level employment estimates are calculated
   by applying the population share to county totals — this assumes uniform job density
   across the county, which is often not true. The confidence label for employment
   metrics is always *Estimated*.

2. **Commuting flows are unavailable at place level** in the standard HNA data pipeline.
   Only county-level LEHD OD (Origin-Destination) tables are cached.

3. **Vacation / resort communities** (e.g. Vail, Breckenridge) have highly seasonal
   resident populations and large second-home inventories. ACS 5-year resident
   population may differ significantly from year-round occupancy patterns.
   Treat affordability and housing unit estimates for these communities with caution.

4. **Annexation and boundary changes** between Census vintages can cause apparent
   population changes that are not real demographic shifts.

---

## 11. Data Sources & Update Schedule

| Data Layer | Source | Typical Update Frequency | Notes |
|---|---|---|---|
| Population, income, housing | ACS 5-year | Annually (Nov/Dec) | 2022 vintage is the current default |
| Commute time | ACS 5-year S0801 | Annually (Nov/Dec) | |
| County components-of-change | DOLA / SDO | Annually (Jan/Feb) | `data/hna/projections/` |
| Age-sex distribution | ACS 5-year DP05 / DOLA SYA | Annually | `data/hna/dola_sya/` |
| Employment / wages | LEHD LODES WAC | Annually (12–18 mo lag) | `data/hna/lehd/` |
| LIHTC projects | HUD ArcGIS / CHFA | Monthly | `data/hna/lihtc/` |
| QCT / DDA designations | HUD | Annually (Dec) | `data/qct-colorado.json` |
| Municipal growth rates | ACS 5-year trend | Annually | `data/hna/municipal/growth-rates.json` |
| Municipal configuration | ACS 5-year / TIGERweb | Annually | `data/hna/municipal/municipal-config.json` |

---

## 12. Troubleshooting & FAQ

**Q: Why is municipal data different from the county?**

A: Municipal data is interpolated or estimated from county-level sources using the population
share method (see §10). Direct Census place-level data is used where available, but many
ACS variables are only reliable at the county level, especially for smaller communities.

**Q: Why do projections seem low / high?**

A: Check the **Horizon** and **Headship** controls in the Projections section. Projections
use DOLA SDO county forecasts as the baseline; if DOLA forecasts slow growth, the projections
will reflect that. For municipalities, the municipal population share is applied to the county
projection — if the municipality is growing faster or slower than the county, set the
**municipalGrowthRate** in `data/hna/municipal/growth-rates.json` accordingly.

**Q: What does "data not yet available" mean?**

A: The ACS 5-year for a specific place may not have been fetched yet by the ETL pipeline,
or the place is too small for the Census to publish reliable estimates. In the latter case,
county data is displayed as context.

**Q: How accurate are these estimates?**

A: County-level metrics (labelled *Direct*) are ACS 5-year estimates with published
margins of error. Interpolated and estimated municipal metrics are planning-grade
approximations. They are suitable for identifying broad needs and trends, but should
not substitute for a formal housing market analysis using current local data.

**Q: Why is my municipality not in the dropdown?**

A: The geography selector is populated from `data/hna/geo-config.json` (for featured
geographies with cached data) and `data/hna/municipal/municipal-config.json` (for the
broader set). If your community is not listed, it can be added to the municipal config
file or fetched live via the Census TIGERweb API by selecting the geography type and
entering the FIPS code manually.

**Q: The map boundary did not load — is that a problem?**

A: No. The boundary is fetched from Census TIGERweb on demand. If TIGERweb is slow or
unavailable, the HNA will show a warning banner but all statistical sections will still
populate from cached data.

**Q: What is the "Show County Context" option?**

A: When a municipality is selected, the Municipal vs. County Comparison panel shows
county-relative metrics automatically. The containing county data is always loaded in
the background so you can see whether the municipality is above or below the county median
for key indicators.

**Q: How do I update the municipal growth rates?**

A: Edit `data/hna/municipal/growth-rates.json` and update the `cagr_3yr`, `cagr_5yr`,
`cagr_10yr`, and `smoothed_rate` values for the relevant `geoid`. Re-run the ETL pipeline
or commit the updated file directly for immediate effect.
