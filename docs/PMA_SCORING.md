# PMA Scoring Reference

## Overview

The Market Analysis scoring system uses a **CHFA-leaning** composite score
to approximate the risk and opportunity assessment used in LIHTC market studies.
All inputs are derived from public data (ACS 5-year, TIGERweb, HUD LIHTC).

---

## CHFA-Leaning Mode

CHFA-leaning mode emphasizes **market depth** and **capture/penetration risk** —
the two dimensions most scrutinized in Colorado CHFA market study reviews —
while retaining affordability pressure framing.

### Weights

| Dimension         | Weight | Rationale |
|-------------------|--------|-----------|
| Market Demand     | 35%    | Renter household depth is the primary underwriting signal |
| Capture Risk      | 35%    | Capture rate is the core metric in LIHTC market studies |
| Rent Pressure     | 20%    | Affordability gap signals unmet need |
| Land Supply       | 7%     | Home-value-to-income proxy for construction feasibility |
| Workforce Gap     | 3%     | Rent vs. 30%-of-income threshold |

**Sum = 1.00**

```javascript
const WEIGHTS = {
  demand: 0.35,
  capture: 0.35,
  rentPressure: 0.20,
  landSupply: 0.07,
  workforce: 0.03
};
```

---

## Sub-Score Formulas

### 1. Market Demand (`scoreDemand`)

Based on the number of renter-occupied households in the county
(derived from ACS `DP02_0001E × DP04_0046PE / 100`).

| Renter Households | Score |
|-------------------|-------|
| ≥ 50,000          | 100   |
| ≥ 20,000          | 85    |
| ≥ 10,000          | 72    |
| ≥ 5,000           | 60    |
| ≥ 2,000           | 48    |
| < 2,000           | 35    |

---

### 2. Capture Risk (`scoreCapture`)

**Formula:**
```
capture_rate = (existing_affordable_units + proposed_units) / qualified_renter_households
```

where `qualified_renter_households` is estimated as:
```
qualified_renter_hh = renter_households × AMI_band_fraction
```

**Tightened thresholds (market-study style):**
`>25%` starts to look risky; `<15%` is strong.

| Capture Rate   | Score | Interpretation |
|----------------|-------|----------------|
| < 12%          | 100   | Very strong market depth |
| 12% – <15%     | 90    | Strong |
| 15% – <20%     | 75    | Moderate |
| 20% – <25%     | 60    | Approaching threshold |
| 25% – <30%     | 45    | Elevated risk |
| ≥ 30%          | 30    | High capture requirement |

**Returned inputs include:**
- `qualified_renter_households`
- `existing_affordable_units`
- `proposed_units`
- `capture_rate`

---

### 3. Rent Pressure (`scoreRentPressure`)

Based on ACS `DP04_0146PE` (% of renters paying ≥ 35% of income for rent)
as the cost-burden proxy. Adjusted by the **Rent Pressure Index (RPI)**:

```
RPI = (median_gross_rent × 12) / (median_household_income × 0.30)
```

| Cost Burden Rate | Base Score |
|------------------|------------|
| ≥ 50%            | 100        |
| ≥ 45%            | 88         |
| ≥ 40%            | 76         |
| ≥ 35%            | 64         |
| ≥ 30%            | 52         |
| < 30%            | 40         |

RPI ≥ 1.20 → +10; RPI ≥ 1.10 → +5; RPI < 0.90 → −10 (capped 0–100).

---

### 4. Land Supply (`scoreLandSupply`)

Proxy: median home value ÷ median household income
(ACS `DP04_0089E ÷ DP03_0062E`).

| HV/Income Ratio | Score |
|-----------------|-------|
| < 3.5           | 85    |
| 3.5 – <5.0      | 70    |
| 5.0 – <7.0      | 55    |
| 7.0 – <10.0     | 40    |
| ≥ 10.0          | 25    |

---

### 5. Workforce Gap (`scoreWorkforce`)

```
affordable_rent = median_household_income × 0.30 / 12
gap = median_gross_rent − affordable_rent
```

| Gap ($) | Score |
|---------|-------|
| < 0     | 40    |
| 0–99    | 50    |
| 100–249 | 65    |
| 250–499 | 80    |
| ≥ 500   | 95    |

---

## Composite Score

```
score = 0.35 × demand + 0.35 × capture + 0.20 × rentPressure + 0.07 × landSupply + 0.03 × workforce
```

| Score Range | Label          |
|-------------|----------------|
| ≥ 70        | Strong Market  |
| 50 – 69     | Moderate Market|
| < 50        | Elevated Risk  |

---

## Band Capture and Overall Penetration Proxy

### Band Capture Rate

```
band_capture = (existing_affordable_units + proposed_units) / qualified_renter_hh
```

`qualified_renter_hh` = `renter_households × AMI_band_fraction`

AMI band fractions (public-data approximations):

| Band     | Fraction |
|----------|----------|
| ≤30% AMI | 0.12     |
| 31–50%   | 0.25     |
| 51–60%   | 0.33     |
| 61–80%   | 0.45     |

### Overall Penetration Proxy

Uses 70% of total renter households as a broad cross-AMI denominator:

```
overall_penetration_proxy = (existing_affordable_units + proposed_units) / (0.70 × renter_households)
```

This approximates PMA/capture logic using public data only (no proprietary household survey).

---

## Risk Flags

| Condition                    | Flag Level |
|------------------------------|------------|
| `capture_rate ≥ 0.25`        | High       |
| `cost_burden_rate ≥ 0.45`    | High       |
| `rent_pressure_index ≥ 1.10` | Medium     |
| `capture_rate ≥ 0.20`        | Medium     |
| `cost_burden_rate ≥ 0.35`    | Medium     |

---

## Data Sources

| Metric              | Source                              | Variable(s) |
|---------------------|-------------------------------------|-------------|
| Renter households   | ACS 5-year DP02, DP04               | DP02_0001E, DP04_0046PE |
| Cost burden         | ACS 5-year DP04                     | DP04_0146PE |
| Median rent         | ACS 5-year DP04                     | DP04_0134E  |
| Median income       | ACS 5-year DP03                     | DP03_0062E  |
| Median home value   | ACS 5-year DP04                     | DP04_0089E  |
| Existing LIHTC units| HUD LIHTC Database                  | N_UNITS     |
| County boundaries   | TIGERweb REST API                   | State_County/MapServer |
