# PMA Scoring Methodology

This document defines each dimension of the Public Market Analysis (PMA) score,
its weight, the formula used to normalise it to 0–100, and the risk flag thresholds
that trigger user-visible warnings.

---

## Overview

The PMA score summarises affordable housing site viability in five dimensions:

| Dimension | Weight | Signal |
|---|---|---|
| **Demand** | 30% | Affordability pressure, renter household share |
| **Capture Risk** | 25% | Existing + proposed units vs. qualified renters |
| **Rent Pressure** | 15% | Market rent vs. affordable rent threshold |
| **Land / Supply** | 15% | Vacancy rate bands |
| **Workforce** | 15% | Placeholder (future: LODES workforce data) |

A higher score means **stronger market support** for an affordable housing project.

---

## Dimension Definitions

### 1. Demand (30%)

Measures unmet rental housing need driven by cost burden and renter household prevalence.

```
cbScore     = min(100, (cost_burden_rate / 0.55) × 100)
renterScore = min(100, (renter_share / 0.60) × 100)
demandScore = cbScore × 0.60 + renterScore × 0.40
```

Where:
- `cost_burden_rate` = share of renters paying ≥30% of income on rent
- `renter_share`     = renter_hh / total_hh

### 2. Capture Risk (25%)

Measures market saturation by comparing existing LIHTC supply to qualified renters.
**Lower capture ratio → lower risk → higher score** (head-room signal).

```
capture     = (existingLihtcUnits + proposedUnits) / renter_hh
captureScore = max(0, min(100, (1 − capture / 0.50) × 100))
```

### 3. Rent Pressure (15%)

Measures the gap between market rent and the affordable rent threshold.
If market rents substantially exceed affordable rents, demand is unmet.

```
affordableRent = (AMI × 0.60 × 0.30) / 12     # 60% AMI, 30% rule, monthly
rentRatio      = median_gross_rent / affordableRent
rentScore      = max(0, min(100, (rentRatio − 0.70) / (1.50 − 0.70) × 100))
```

Where `AMI` = Colorado statewide Area Median Income. See [HUD Income Limits](https://www.huduser.gov/portal/datasets/il.html) for the current AMI value and vintage year.

### 4. Land / Supply (15%)

Measures housing supply tightness via vacancy rate.
Very low vacancy signals unmet demand.

```
landScore = max(0, min(100, (1 − vacancy_rate / 0.12) × 100))
```

### 5. Workforce (15%)

**Placeholder** — currently returns a constant score of 60.
Future implementation will integrate LODES (Longitudinal Employer-Household Dynamics)
commute-shed data to measure workforce demand near the site.

---

## Overall Score

```
score = demandScore × 0.30
      + captureScore × 0.25
      + rentScore    × 0.15
      + landScore    × 0.15
      + workforceScore × 0.15
```

### Score tiers

| Range | Tier | Interpretation |
|---|---|---|
| 80–100 | **Strong** | Strong market support; high viability |
| 60–79 | **Moderate** | Reasonable support; review risk flags |
| 40–59 | **Marginal** | Limited market support; further study needed |
| 0–39 | **Weak** | Weak signal; site may face absorption challenges |

---

## Risk Flag Thresholds

| Flag | Threshold | Severity |
|---|---|---|
| High capture risk | capture rate ≥ 25% | ⚠ Warning |
| High cost-burden pressure | cost_burden_rate ≥ 45% | ✕ High |
| Elevated rent pressure | rent ratio ≥ 1.10 | ⚠ Warning |

When no flag is triggered, a "No critical risk flags" ✓ OK flag is displayed.

---

## Capture-rate Simulator

The capture-rate simulator (CHFA-style) computes:

```
captureRate = proposedUnits / renter_hh
```

Risk levels:
- **Low**: capture < 15%
- **Moderate**: 15% ≤ capture < 25%
- **High**: capture ≥ 25%

The AMI mix inputs (`30%`, `40%`, `50%`, `60%`, `80%`) allow users to test
different unit mixes. When the sum of AMI-mix units is > 0, it overrides
the "Total proposed units" field.

---

## Explainability

Each dimension score is displayed as a bar (0–100) in the UI alongside the
numeric value. Risk flags provide plain-language explanations tied directly
to the threshold values in this document.
