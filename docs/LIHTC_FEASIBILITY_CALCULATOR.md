# LIHTC Feasibility Calculator — Scope and Limitations

## What This Tool Does

The **LIHTC Feasibility Calculator** (in `js/deal-calculator.js`, rendered in `market-analysis.html`) is an **early-stage feasibility sizing tool**. It produces planning-level estimates to help developers and analysts quickly assess whether a proposed LIHTC development is in a plausible financial range.

### Outputs
- Estimated annual tax credit amount (9% or 4% credit rate)
- Gross equity proceeds
- Estimated permanent financing gap
- Per-unit cost and credit benchmarks

---

## What This Tool Does NOT Do

This calculator is **not** a final underwriting model, a CHFA award prediction, or a full LIHTC pro forma. Specifically, it does **not**:

- Model actual CHFA QAP competitive scoring or set-aside priorities
- Account for the full layering of soft debt, deferred developer fees, or reserves
- Predict equity pricing beyond a configurable default assumption
- Calculate basis, eligible basis, or applicable fraction
- Model permanent loan underwriting (DSCR, LTV)
- Simulate subsidy layering (HOME, CDBG, local trust fund gaps)
- Factor in QCT/DDA 30% basis boost eligibility (displayed for awareness only)
- Account for construction loan interest, carry, and fees during lease-up

---

## Outputs Depend on Assumptions

Outputs are highly sensitive to:
- **Total Development Cost (TDC)** — cost per unit benchmarks vary widely by location, type, and market conditions
- **AMI mix** — choosing a lower AMI % reduces rents and increases the financing gap
- **Equity price per dollar** — LIHTC equity prices fluctuate with the tax credit market
- **Local soft-funding availability** — CHFA and local programs change annually

---

## Future Deal Predictor

A more comprehensive deal prediction module is scaffolded in `js/lihtc-deal-predictor.js`. When implemented, it will incorporate:
- PMA demand score from the site analysis pipeline
- Affordability gap data (30% AMI units needed by county)
- HUD FMR / AMI data for the selected county
- QCT/DDA designation
- 4% vs 9% logic including Private Activity Bond volume cap
- Risk modeling and scenario sensitivity
- CHFA historical award pattern analysis

Until that module is complete, the Feasibility Calculator should be treated as a **planning-level conversation starter**, not a deal predictor.

---

## Methodology Notes

| Input              | Source                                    |
|--------------------|-------------------------------------------|
| AMI gross rent limits | HUD FY2025 Income Limits (via `js/data-connectors/hud-fmr.js`) |
| Default: Denver MSA | Denver-Aurora-Lakewood MSA if no county selected |
| Credit rates       | User-selectable: 9% (competitive) or 4% (bond-financed) |
| Equity price       | Configurable default (0.90 per dollar of annual credit) |
| Mortgage constant  | Standard fully-amortising formula at user-specified interest rate |

---

## Accessing This Tool

The calculator is embedded in the Market Analysis page:
- URL: `market-analysis.html#dealCalcMount`
- Section: Scrollable below the PMA results and site selection report

---

## Recommended Use

1. Use the calculator to set a rough order-of-magnitude budget and understand the financing gap
2. Confirm eligibility with HUD EGIS for QCT/DDA overlays (displayed on the map)
3. Engage a LIHTC syndicator to validate equity assumptions
4. Commission a full LIHTC pro forma before submitting a CHFA application
