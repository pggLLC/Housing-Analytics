# Municipal Analysis Methodology

> **Document version:** 2026-03 | **Applies to:** `js/municipal-analysis.js`, `data/hna/municipal/`

---

## Overview

The municipal analysis framework provides statistically derived sub-county estimates
for Colorado municipalities. Because DOLA population projections and LEHD employment
data are published at the **county** level only, municipal figures are obtained by
scaling county data using **growth-adjusted population share** and supplementary
ACS municipal-level observations where available.

---

## 1. Population Share and Scaling

### Base share

```
share₀ = municipalPop / countyPop
```

### Growth-adjusted projected share

```
share(t) = share₀ × exp(relativeLogGrowth × t)
```

Where:

| Term | Definition |
|------|-----------|
| `t` | Years from the base year |
| `share₀` | Municipal share of county population in the base year |
| `relativeLogGrowth` | `ln(1 + municipalGrowthRate) − ln(1 + countyGrowthRate)` |

Using the log-growth formulation ensures that the share converges smoothly over
time without crossing zero or infinity, even when the municipal and county growth
rates diverge substantially.

---

## 2. Housing Stock Estimation

The module uses a three-level priority cascade:

| Priority | Source | Method |
|----------|--------|--------|
| 1 (best) | Direct | ACS DP04 housing units or local permit record |
| 2 | Household ratio | `households × (countyUnits / countyHouseholds)` |
| 3 | Population share | `countyUnits × popShare` |

**Vacancy multiplier:**  
`vacancyMultiplier = countyUnits / countyHouseholds` (minimum 1.05 if data insufficient)

---

## 3. Affordability Scaling

### Rent adjustment factor (RAF)

```
RAF = clamp(municipalRent / countyRent, 0.5, 2.0)
```

The clamp prevents extreme outliers (e.g. resort towns) from producing implausible
tier redistributions.

### AMI tier redistribution

The five AMI tiers (≤30%, 31–50%, 51–80%, 81–100%, >100%) are redistributed using
a weighted linear shift:

```
weight[i] = baseTierShare[i] × (1 + (RAF − 1) × tierPosition[i])
adjustedShare[i] = weight[i] / Σweight
```

Where `tierPosition[i] = (i − 2) / 2` maps tiers 0–4 to positions −1, −0.5, 0, 0.5, 1.

When `RAF > 1` (higher-rent municipality), mass shifts toward higher tiers.
When `RAF < 1` (lower-rent municipality), mass shifts toward lower tiers.

---

## 4. Demographic Projections

Municipal projections are anchored to the county DOLA forecast:

```
municipalPop(t) = countyPop(t) × share(t)
municipalHH(t)  = municipalPop(t) × (countyBaseHH / countyBasePop)
```

The household ratio is held constant from the base year; future headship
rate improvements are not modelled at the municipal level.

---

## 5. Employment Estimation

LEHD WAC (Workplace Area Characteristics) county totals are scaled by the
municipal population share:

```
municipalJobs = countyJobs × popShare
jobsByIndustry[i] = countyIndustryJobs[i] × popShare
```

This is a residence-weighted approximation. True place-of-work data at the
municipal level requires direct LEHD LODES query, which is planned as a
future ETL enhancement.

---

## 6. Prop 123 Baseline

The municipal 60% AMI rental baseline is derived from the county baseline:

```
renterShare            = municipalRenterHouseholds / countyTotalRenterHH
baseline60AMIRentals   = countyRentals60AMI × renterShare
growthTarget3pct       = baseline60AMIRentals × 0.03
```

---

## 7. Data Confidence Rules

### Confidence levels

| Level | Meaning |
|-------|---------|
| `DIRECT` | Directly observed data (ACS 5-year estimate, local permit record) |
| `INTERPOLATED` | Scaled from county data with known ACS-derived scaling factors |
| `ESTIMATED` | Derived via general statistical assumptions (default county ratios) |
| `UNAVAILABLE` | No usable data source |

### Confidence ceiling rule

> If `dataSource = 'interpolated'` **and** `municipalSize < 2,500`, the confidence
> level is **downgraded to ESTIMATED**.

This applies because ACS 5-year estimates for places below 2,500 population
have coefficients of variation (CVs) that exceed 40% for most housing variables,
making scaled interpolations unreliable.

---

## 8. ETL Integration

Per-municipality cache files can be stored in the following directories once an
ETL pipeline is implemented:

```
data/hna/municipal/
  municipal-config.json        — 32 featured municipalities (place + county FIPS)
  growth-rates.json            — 3/5/10-yr CAGRs + smoothed projection rate
  scaling-factors/             — ETL-generated scaling factor JSON per municipality
  demographics/                — ETL-generated demographic projection JSON per municipality
  affordability/               — ETL-generated affordability JSON per municipality
```

ETL scripts should write files named `<7-digit-place-fips>.json` in each
subdirectory. The HNA main script can load these files via `DataService.getJSON()`
and pass them directly to `window.__MunicipalAnalysis.*` functions.

---

## 9. Known Limitations

| Limitation | Impact | Mitigation |
|------------|--------|-----------|
| No DOLA municipal-level forecasts | Less accurate long-run projections | Cross-check with local housing element data |
| LEHD employment scaled by residence share | Overestimates employment in dormitory towns; underestimates in job centres | Use ACS B23025 as a sanity check |
| Headship rate held constant | Understates household formation for fast-growing places | Accept as conservative estimate |
| Small-place uncertainty (< 2,500 pop) | High CVs in ACS estimates | Confidence ceiling auto-downgrades to ESTIMATED |
| RAF clamp at [0.5, 2.0] | May understate housing cost extremes (e.g. Aspen) | Supplement with local HUD FMR data |

---

## 10. References

- U.S. Census Bureau, ACS 5-Year Estimates (DP04, B25070, S0801)
- DOLA State Demography Office, County Population Projections 2024
- LEHD LODES WAC (Workplace Area Characteristics), 2023
- HUD Fair Market Rents, 2024
- HB 22-1093 / Proposition 123, Colorado General Assembly
