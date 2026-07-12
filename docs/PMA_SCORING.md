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

Measures market saturation by comparing existing LIHTC supply to *LIHTC-eligible* renter households.
**Lower capture ratio → lower risk → higher score** (head-room signal).

```
capture      = (existingLihtcUnits + proposedUnits) / qualifiedRenters
captureScore = max(0, min(100, (1 − capture / 0.50) × 100))
```

**Where `qualifiedRenters` comes from (D, 2026-05):**

The denominator is the count of renter HHs ≤80% AMI — the population federal
LIHTC income limits actually cap. CHFA market studies underwrite to this pool,
not to the full ACS renter base.

1. **Preferred**: `qualifiedRenters` = sum of CHAS renter HHs in tiers
   `lte30 + 31to50 + 51to80`, apportioned across the buffer's tracts by their
   F80 polygon-clip shares. CHAS data from `data/hna/chas_affordability_gap.json`
   (HUD CHAS 2018-2022 vintage).
2. **Fallback**: when CHAS is unavailable, falls back to ACS total `renter_hh`
   from `acs_tract_metrics_co.json`. This over-counts the LIHTC demand pool
   and under-states capture risk — surfaced as `pma_data_coverage.capture_risk: "partial"`
   in the result so renderers can disclose the proxy.
3. **Last resort**: 1 (literal one) when both are missing. Coverage = `"fallback"`.

The `captureDenominator` field on the result object exposes the value used +
the source (`chas_lihtc_eligible` / `acs_total_renter_hh` / `fallback_1`) +
the per-tier breakdown for renderer disclosure.

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

Measures rental-market supply tightness via **rental vacancy** (#1163).
Very low rental vacancy signals unmet demand; 10%+ signals lease-up risk.

**The input is rental vacancy, not total vacancy.** Total ACS vacancy
(`B25004_001E`) counts seasonal and second homes as "vacant," which scored
every Colorado resort county 0 on this dimension (Summit County: 63% median
tract "vacancy") — reading the state's most workforce-housing-starved rental
markets as oversupplied. Rental vacancy follows the Census Housing Vacancy
Survey convention:

```
rental_vacancy_rate = vacant_for_rent / (renter_hh + vacant_for_rent + rented_not_occupied)
                      (B25004_002E)     (B25003_003E + B25004_002E + B25004_003E)

landScore = max(0, min(100, (1 − rental_vacancy_rate / 0.10) × 100))
```

**Both code paths use this same input and the same 0.10 ceiling**
(`PMAMarketScoring.RENTAL_VACANCY_CEILING`) — the historical 0.10-vs-0.12
divergence (#1149) is resolved:

- `scoreMarketTightness()` (`js/market-analysis-scoring.js`) — the default
  path. Buffer-level rental vacancy is derived from summed, buffer-share-
  apportioned counts (not averaged tract rates) in `aggregateAcs()`.
- `scoreLandSupplyWithBridge()` → `scoreLandSupply()`
  (`js/market-analysis/site-selection-score.js`) — the Bridge-gated path.
  Its only remaining difference is the 60/40 land-cost blend; enabling
  Bridge/MLS access no longer changes the vacancy normalization.

The 0.10 ceiling is underwriting-grounded: 10%+ vacancy is where lease-up
risk and absorption pace materially threaten LIHTC underwriting.

**Legacy fallback**: when the tract data predates the rental-vacancy fields
(or a buffer has no rental universe at all), scoring falls back to the
historical behavior — total vacancy at a 0.12 ceiling, suppressed input
defaulting to 0.05 (neutral ≈ 58) — and the dimension note discloses
`legacy_total_vacancy` as the basis. This exists only for stale data files;
current pipelines always emit the rental fields.

**Known limitation — STR contamination in resort cores.** ACS classifies
units actively listed for rent as "For rent" (`B25004_002E`) regardless of
whether they are offered as long-term housing or short-term/vacation
rentals. In STR-saturated resort markets this inflates rental vacancy far
above the long-term-market reality (2019–2023 ACS: Summit County's rental
universe is ~38% "for rent" county-wide — clearly STR stock, not workforce-
available vacancies), so buffers centered on resort cores still floor at 0
on this dimension. This is a data limitation, not a formula error: ACS has
no STR/long-term split. The switch to rental vacancy fixed the metro and
non-resort mountain counties (Denver ~5%, La Plata ~7% — sensible scores)
and removed the worst of the seasonal-homes inversion, but resort-core
Land/Supply scores should be read alongside local STR-license and
long-term-listing data until a refinement lands (see #1171).

Buffers meeting **both** of the following are automatically flagged
"STR-DISTORTED" in the dimension note (`PMAMarketScoring.isStrDistorted`,
disclosure only — the score itself is unchanged):

- `rental_vacancy_rate ≥ 0.08` (score ≤ 20 — materially depressed), and
- total `vacancy_rate ≥ 0.25` (seasonal-dominated market, the STR tell).

Calibrated against 2019–2023 county aggregates: flags Summit, Eagle,
Pitkin, Gunnison, San Miguel, and Archuleta buffers; does not flag
Denver/Boulder (low on both), La Plata (score not floored), tight-but-
seasonal towns like Leadville (rental vacancy near 0 — score not
depressed), or a genuinely soft non-seasonal market (high rental, low
total vacancy — real oversupply, not STR).

### 5. Workforce (15%)

Weighted composite score from up to 5 Colorado-specific data sources:

| Sub-source | Weight | Data File | Module |
|---|---|---|---|
| LODES job accessibility | 25% | `data/market/lodes_co.json` | `window.LodesCommute` |
| ACS income/education proxy | 25% | ACS tract metrics | (inline) |
| CDLE vacancy rates | 20% | `data/market/cdle_job_postings_co.json` | `window.CdleJobs` |
| CDE school quality | 15% | `data/market/cde_schools_co.json` | `window.CdeSchools` |
| CDOT traffic connectivity | 15% | `data/market/cdot_traffic_co.json` | `window.CdotTraffic` |

```
workforceScore = lodesScore   × 0.25
               + acsWfScore   × 0.25
               + cdleScore    × 0.20
               + cdeScore     × 0.15
               + cdotScore    × 0.15
```

Each sub-source falls back to a neutral value (40–55) when its data module is
unavailable. Coverage level is reported as `full`, `partial`, or `fallback`.

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

## Competitive Supply Share (absorption risk)

**Not a capture rate.** Capture rate (above) divides units by a *demand pool*
(income-qualified renter households). Competitive Supply Share divides supply
by supply — the proposed project's share of the competitive inventory it will
lease up against. The two move in opposite directions for the same market
signal (more existing LIHTC supply raises capture rate but lowers supply
share), so they must never share a label. Implemented by
`calculateAbsorptionRisk()` in `js/pma-competitive-set.js`:

```
competitiveSupplyShare = proposedUnits / (totalCompetitiveUnits + proposedUnits)
```

Thresholds (`SATURATION_LIMIT = 0.10`):
- **Low**: share < 5%
- **Moderate**: 5% ≤ share < 10%
- **High**: share ≥ 10%

Rendered in the "Absorption Risk — Competitive Supply Share" card on the
Market Analysis page. The result object's internal field name remains
`captureRate` for backwards compatibility; only the user-facing label
changed (#1148).

---

## Explainability

Each dimension score is displayed as a bar (0–100) in the UI alongside the
numeric value. Risk flags provide plain-language explanations tied directly
to the threshold values in this document.
