# Affordability Methodology

This document describes how COHO Analytics calculates housing affordability gaps, both for homeownership and rental housing.

---

## 1. Homeownership Affordability (PITI Model)

COHO Analytics uses a **realistic mortgage underwriting model** — not the simplified 3× income rule — to estimate the income required to purchase a home. This approach mirrors the standards used by lenders and is sometimes called the **PITI model** (Principal + Interest + Taxes + Insurance).

### Formula

**Monthly PITI payment:**

```
PITI = P&I + Monthly Property Taxes + Monthly Insurance + PMI (if applicable) + HOA
```

**Principal & Interest (P&I):**

```
loan_amount = median_home_price × (1 − down_payment_pct)
monthly_rate = annual_interest_rate / 12
P&I = loan_amount × [monthly_rate × (1 + monthly_rate)^360]
                   / [(1 + monthly_rate)^360 − 1]
```

**Required annual income to qualify:**

```
required_income = (PITI / max_DTI_ratio) × 12
```

### Default Assumptions

| Parameter | Default Value | Source / Rationale |
|-----------|--------------|-------------------|
| Down payment | 20% | Standard conventional loan |
| Interest rate | 6.5% (30-yr fixed) | Approximate 2024-2026 market rate |
| Property tax rate | 0.65% of value/yr | Colorado statewide average (county-specific rates used when FIPS provided) |
| Homeowner insurance | 0.85% of value/yr | Industry standard estimate |
| HOA fees | $0/month | Conservative default; adjustable per property |
| PMI | 0.85% of value/yr | Applies only when down payment < 20% |
| Max DTI ratio | 43% | Standard back-end ratio per Fannie Mae/Freddie Mac guidelines |
| Loan term | 30 years | Standard amortization |

### County-Specific Tax Rates

When a 5-digit Colorado county FIPS code is provided, the model uses that county's effective property tax rate. Rates for 12 major counties are hard-coded; all others fall back to the statewide average (0.65%).

### Scenarios

The model always returns two scenarios:

- **Standard (20% down)** — conventional loan; no PMI
- **First-time buyer (5% down)** — includes PMI; higher required income

### Why Not Use the 3× Income Rule?

The old 3× rule (`affordable_price = income × 3`) is a rough heuristic that:
- Ignores current interest rates (rate changes alone can shift affordability by 20-40%)
- Ignores property taxes and insurance (adds $500-$1,500/month in Colorado)
- Ignores PMI for low-down-payment buyers
- Uses a single income multiple rather than a DTI-based qualification threshold

**Example — Denver metro (2026):**

| Metric | 3× Rule | PITI Model |
|--------|---------|-----------|
| Median home price | $560,000 | $560,000 |
| Median household income | $86,000 | $86,000 |
| Estimated affordable price | $258,000 | $258,000 |
| Gap (% over affordable) | ~117% | ~206% |
| Required income to qualify | $86,000 ÷ 3 × 3 ≈ $187k | ~$133k (20% down, 6.5%) |

The PITI model shows a larger gap because it reflects the actual cash flow impact on buyers.

---

## 2. Rental Affordability

Rental affordability uses the **30% of gross income standard**:

```
max_affordable_monthly_rent = annual_income × 0.30 / 12
income_needed              = median_monthly_rent / 0.30 × 12
```

**Rent burden** is defined as gross rent / annual income × 100%.

---

## 3. Wage-Affordability Gap (Economic Bridge)

The `WageAffordabilityGap` class in `scripts/hna/economic_housing_bridge.py` connects labor-market wages to housing costs:

- For **rental**: compares median annual wage to income needed to afford median rent at 30%
- For **ownership**: compares median annual wage to income needed to qualify for a 30-yr mortgage at 28% front-end ratio (P&I only, conservative)

The `compute_ownership_affordability()` function in the same module uses the full PITI model for more realistic projections.

---

## 4. Implementation

### JavaScript (`js/api-integrations.js`)

```javascript
const result = new DataAPIIntegrations().calculateAffordabilityGap(
    medianIncome,    // annual household income
    medianHomePrice, // median sale price
    {
        interestRate: 0.065,    // 6.5%
        downPaymentPct: 0.20,   // 20%
        propertyTaxRate: 0.0065,
        insuranceRate: 0.0085,
        maxDtiRatio: 0.43,
    }
);
// result.gap                     — affordability gap % (primary scenario)
// result.incomeNeeded            — required annual income
// result.scenarios.standard_20pct_down
// result.scenarios.first_time_buyer_5pct_down
// result.assumptions             — all parameters used
```

### Python (`scripts/hna/economic_housing_bridge.py`)

```python
from scripts.hna.economic_housing_bridge import compute_ownership_affordability

result = compute_ownership_affordability(
    median_price=560000,
    median_income=86000,
    county_fips="08031",   # Denver
)
# result["monthly_payment"]
# result["required_annual_income"]
# result["affordability_gap_percent"]
# result["scenarios"]["first_time_buyer_5pct_down"]
```

---

## 5. Data Sources

| Data | Source | Update Frequency |
|------|--------|-----------------|
| Median home prices | Colorado Association of REALTORS (CAR) | Monthly |
| Median household income | U.S. Census ACS 5-year | Annual (1-year lag) |
| 30-year mortgage rate | Federal Reserve (FRED: MORTGAGE30US) | Weekly |
| County property tax rates | CO Division of Property Taxation | Annual |
| HUD Area Median Income (AMI) | HUD FMR/Income Limits API | Annual |

---

## 6. Limitations

- Property tax rates and insurance rates are **estimates**; actual costs vary by property, insurer, and local jurisdiction.
- HOA fees default to $0; in practice, many Colorado communities have HOAs ranging from $100–$500+/month.
- The model uses median income vs. median price, which masks distributional effects; lower-income households face larger gaps.
- ACS income data lags by 1-3 years; FRED mortgage rates are updated weekly.
