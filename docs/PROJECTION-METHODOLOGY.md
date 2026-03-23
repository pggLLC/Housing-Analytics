# Projection Methodology

This document describes the cohort-component demographic projection model used in COHO Analytics to generate 20-year housing needs projections through 2050.

---

## Overview

COHO Analytics uses a **cohort-component model** — the standard method used by the Colorado State Demography Office (DOLA), the US Census Bureau, and most state planning agencies — to project population, household formation, and housing unit demand from a base year (2024) to a target year (2050).

The model operates in **annual steps** and applies three demographic components to the base population:

1. **Mortality** — Survivors are aged into the next cohort using life-table survival rates
2. **Fertility** — Births are calculated from age-specific fertility rates applied to female cohorts
3. **Migration** — Net annual in-migration is distributed across age groups

---

## Base Population

The base population is sourced from **DOLA Single-Year-of-Age (SYA)** county files (2024 vintage), available at:  
→ https://demography.dola.colorado.gov/population/population-totals-colorado-counties/

Each county's base population is organized into **18 five-year age groups** (0–4, 5–9, … 80–84, 85+) for males and females separately.

---

## Survival Rates (Mortality Component)

Survival rates are derived from the **US life table** (CDC/NCHS) and adjusted for each scenario using a mortality multiplier:

```
annual_survival[i] = (5yr_survival[i] × mortality_multiplier)^(1/5)
```

Default 5-year survival rates by cohort:

| Age Group | Survival Rate |
|-----------|--------------|
| 0–4       | 0.9985       |
| 5–9       | 0.9990       |
| …         | …            |
| 80–84     | 0.8900       |
| 85+       | 0.7500       |

---

## Fertility (Birth Component)

Births are computed from **age-specific fertility rates (ASFRs)** applied to female cohorts aged 15–49:

```
births_per_year = Σ (female_cohort[i] × ASFR[i] × fertility_multiplier / 5)
```

for i in {15–19, 20–24, 25–29, 30–34, 35–39, 40–44, 45–49}.

Default ASFRs (per woman per 5-year period):

| Age Group | ASFR   |
|-----------|--------|
| 15–19     | 0.040  |
| 20–24     | 0.160  |
| 25–29     | 0.280  |
| 30–34     | 0.280  |
| 35–39     | 0.160  |
| 40–44     | 0.055  |
| 45–49     | 0.008  |

Sex ratio at birth: 1.05 males per female.

---

## Net Migration

Annual net migration is distributed across age cohorts proportionally:

```
migration_for_cohort[i] = net_migration_annual × age_share[i]
```

Migration is split 48% male / 52% female, reflecting observed Colorado in-migration patterns.

---

## Household Formation

Population is converted to households using a **headship rate**:

```
households = total_population × headship_rate
```

Default headship rate: **0.38** (derived from ACS 5-year estimates for Colorado).

---

## Housing Unit Demand Formula

**This is the core formula displayed in the scenario builder UI.**

```
units_needed = households / (1 − vacancy_target)
```

Where:
- `households` = projected households in the target year
- `vacancy_target` = 0.05 (5% frictional vacancy — the minimum needed for a functional market)

The **cumulative need above base** is:

```
cumulative_need = max(0, units_needed_target_year − base_units_existing)
```

---

## Three Built-In Scenarios

| Scenario       | Fertility Mult | Mortality Mult | Net Migration/yr |
|----------------|---------------|----------------|-----------------|
| Baseline       | 1.00          | 1.00           | 500             |
| Low Growth     | 0.90          | 1.02           | 250             |
| High Growth    | 1.05          | 0.98           | 1,000           |

### Data Sources for Scenarios

- **Baseline**: DOLA Components of Change (2018–2023 average net migration)
- **Low Growth**: Reduced migration reflecting FRED CPI shelter index affordability headwinds (`CUUR0000SAH1`)
- **High Growth**: Doubled migration reflecting FRED labor market expansion (`UNRATE`)

---

## Transparency and Reproducibility

All projection logic is implemented in two places:

1. **Python** — `scripts/hna/demographic_projections.py` (server-side, for data pipeline)
2. **JavaScript** — `js/projections/cohort-component-model.js` (client-side, for the interactive builder)

Both implementations use identical parameters and formulas. Users can verify results by:

- Downloading scenario projections from the builder (CSV or JSON)
- Running `python3 scripts/hna/build_cohort_projections.py` locally

---

## Limitations

- The model uses **county-level** net migration; sub-county migration patterns are not modeled
- Headship rates are **static**; actual household formation rates vary with age structure and housing costs
- The model does **not** account for zoning constraints, development pipeline, or demolition rates
- Projections beyond 10–15 years carry increasing uncertainty; ranges (low/high) should be presented alongside baseline

---

## References

- Colorado State Demography Office (DOLA): https://demography.dola.colorado.gov/
- US CDC Life Tables: https://www.cdc.gov/nchs/products/life_tables.htm
- ACS 5-Year Estimates (headship rates): https://data.census.gov/
- FRED Economic Data: https://fred.stlouisfed.org/
