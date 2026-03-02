# PMA Scoring Reference

## Score Components

### 1. Demand (weight: 30%)

Measures the unmet need for affordable rental housing within the PMA.

**Inputs:**
- `costBurdenedPct` — share of households spending ≥ 30% of income on gross rent (ACS B25070)
- `renterShare` — renter-occupied households ÷ total occupied (ACS B25003)

**Formula:**
```
Demand = min(100, (costBurdenedPct / 0.40) × 55 + (renterShare / 0.60) × 45)
```

**Risk flags:**
- Score < 40: "Cost-burden rate below 20% — limited unmet need signal."

---

### 2. Capture Risk (weight: 25%)

Measures the risk of over-saturation from existing affordable supply. **Higher = lower risk.**

**Inputs:**
- `lihtcCount` — number of existing HUD LIHTC projects within PMA buffer

**Formula:**
```
CaptureRisk = max(0, 100 − (lihtcCount / 10) × 100)
```

**Risk flags:**
- Score < 40: "High existing LIHTC supply — elevated capture risk."

---

### 3. Rent Pressure (weight: 15%)

Measures upward pressure on market rents relative to the Colorado median.

**Inputs:**
- `medianGrossRent` — median gross rent (ACS B25064); Colorado median benchmark: $1,400/month

**Formula:**
```
RentPressure = min(100, (medianGrossRent / 1400) × 70)
```

---

### 4. Land/Supply (weight: 15%)

Measures how tight the housing supply is. Low vacancy = high pressure = favorable for affordable development.

**Inputs:**
- `vacancyPct` — vacant units ÷ total housing units (ACS B25004); benchmark: 8%

**Formula:**
```
LandSupply = max(0, (1 − min(vacancyPct / 0.08, 1)) × 100)
```

**Risk flags:**
- Vacancy > 10%: "Vacancy rate above 10% — soft rental market."

---

### 5. Workforce (weight: 15%)

Measures the local labor force capacity as a proxy for economic stability and rental demand.

**Inputs:**
- `laborForceParticipation` — labor force ÷ civilian non-institutional population 16+ (ACS B23025); benchmark: 70%

**Formula:**
```
Workforce = min(100, (lfpRate / 0.70) × 100)
```

---

## Overall Score Calculation

```
Overall = (Demand × 0.30)
        + (CaptureRisk × 0.25)
        + (RentPressure × 0.15)
        + (LandSupply × 0.15)
        + (Workforce × 0.15)
```

Result is rounded to the nearest integer and clamped to [0, 100].

---

## Explainability Logic

### Top 3 Drivers

The top 3 dimension scores (highest values) are displayed as positive drivers with human-readable labels:

| Dimension key | Human label |
|---------------|-------------|
| `demand` | High cost-burden / renter demand |
| `captureRisk` | Low competing supply |
| `rentPressure` | Elevated rent pressure |
| `landSupply` | Tight vacancy / limited supply |
| `workforce` | Strong labor-force participation |

### Risk Flags

Flags are triggered when a dimension score or derived metric falls outside acceptable thresholds:

| Condition | Flag message |
|-----------|-------------|
| `captureRisk < 40` | High existing LIHTC supply — elevated capture risk. |
| `vacancyPct > 0.10` | Vacancy rate above 10% — soft rental market. |
| `captureRate > 0.25` | Capture rate exceeds CHFA 25% guideline. |
| `costBurdenedPct < 0.20` | Cost-burden rate below 20% — limited unmet need signal. |

---

## CHFA Capture Rate Guideline

The Colorado Housing and Finance Authority (CHFA) uses a **25% capture rate** as a key threshold
in its site evaluation process. The capture rate is calculated as:

```
Capture Rate = Proposed Units / Estimated Income-Qualified Renter Households
```

Where income-qualified renter households are estimated as:
```
Qualified HH ≈ renterHouseholds × (costBurdenedPct + 0.10)
```

The +0.10 adjustment accounts for households that are not yet cost-burdened but would qualify
at the proposed AMI levels.

**Projects exceeding 25% capture rate should be reviewed carefully for market over-saturation.**

---

## Score Interpretation Guide

| Overall Score | Market Signal |
|---------------|---------------|
| 70–100 | **Strong** — High unmet need, limited supply, favorable workforce |
| 45–69 | **Moderate** — Mixed signals; site-specific factors should be reviewed |
| 0–44 | **Weak** — Low demand signals or significant existing supply competition |
