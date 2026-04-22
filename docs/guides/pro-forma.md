# Operating Pro Forma

A 15-year (configurable 5–30) operating pro-forma projection surfaced inline in the Deal Calculator. Projects Year-1 NOI forward at constant growth rates and fixed debt service, producing an annual cash-flow + DSCR trajectory with a chart visualization.

**Primary code**: [`js/pro-forma.js`](../../js/pro-forma.js)
**Tests**: [`test/pro-forma.test.js`](../../test/pro-forma.test.js) — 24 assertions covering mortgage-constant math, render shape, and horizon clamping
**Surfaces in**: [`deal-calculator.html`](../../deal-calculator.html) via the `#proFormaMount` container

---

## What it does

Given a Year-1 operating picture (rents, vacancy, opex, reserves, property tax, debt service) the pro-forma compounds each line forward by a per-category growth rate, recomputing NOI, debt-service coverage, cash flow, and cumulative cash flow for each year of the projection horizon. Default output is a **15-row table** + line chart of NOI / Debt Service / Cash Flow over time.

---

## Inputs

Two categories: **deal-calculator inputs** (read from other `#dc-*` fields) and **pro-forma-specific assumptions** (inputs exposed in the pro-forma section itself).

### From the deal calculator
| `#dc-*` id | Purpose |
|---|---|
| `dc-units` | Total unit count — drives per-unit expenses |
| `dc-vacancy`, `dc-opex`, `dc-rep-reserve`, `dc-prop-tax` | Annual cost assumptions per unit |
| `dc-tax-exempt` | Property-tax exemption fraction (0 / 50% / 100%) |
| `dc-rate`, `dc-term` | Mortgage terms for debt service |
| `dc-r-rents` | Year-1 annual gross rents (read-only span; derived from AMI-tier unit allocation) |
| `dc-r-mortgage` | Supportable first mortgage (read-only span) |
| `dc-auto-noi` | **Toggle.** Must be on for the pro-forma table to render |

### Pro-forma-specific
| Input id | Default | Range | Purpose |
|---|---|---|---|
| `pf-rent-growth` | 2% | 0–5% | Annual rent escalation |
| `pf-exp-growth` | 3% | 0–6% | Annual operating-expense escalation |
| `pf-years` | 15 | 5–30 | Projection horizon (clamped; see `test/pro-forma.test.js`) |

---

## Methodology

### Year-1 starting values

Gross rents = Σ (AMI-tier unit count × FMR-adjusted rent × 12). Read from `#dc-r-rents` text content (computed upstream by the deal calculator).

Vacancy loss = gross rents × vacancy rate.
EGI (effective gross income) = gross rents − vacancy loss.
Operating expenses = opex/unit × 12 × units.
Replacement reserve = reserve/unit × units.
Property tax = prop-tax/unit × units × (1 − exemption fraction).
NOI = EGI − opex − reserve − property tax.

### Forward projection (`render` + `update` functions)

For each year `y > 1`:
- Rents grow at `(1 + rent-growth)^(y−1)`
- Expenses / reserve / property tax grow at `(1 + exp-growth)^(y−1)`
- Debt service is **fixed** at the Year-1 amortized value (`mortgage × mortgageConstant(rate, term)`)

Cash flow = NOI − debt service. DSCR = NOI / debt service. Cumulative CF = running sum from Year 1.

### Mortgage constant

`mortgageConstant(rate, termYears)` computes the annual constant (rate / (1 − (1 + rate)^−term)) — the per-dollar-of-loan annual debt service. Used to derive Year-1 DS from the supportable mortgage and then held flat across the horizon.

### Auto-NOI gating

The pro-forma table only renders when `#dc-auto-noi` is checked. Rationale: without the toggle, all the derived costs (opex, reserve, prop tax) are unpopulated — a Year-1 row would be meaningless. A placeholder message (_\"Enable Auto-compute NOI in the deal calculator above and ensure AMI tier units are configured\"_) appears instead.

> **Known UX footgun.** Auto-NOI is **off** by default, so first-time users see the placeholder. Worth a future default-on toggle (tracked informally via [#550 QA comment](https://github.com/pggLLC/Housing-Analytics/issues/550#issuecomment-4284360744)).

---

## Outputs

Table columns (per year):
1. **Year** (1 through N)
2. **Gross rents** — escalated from Year 1
3. **Vacancy loss** — gross × vacancy rate (rate held constant)
4. **EGI** — gross − vacancy
5. **Operating exp** — escalated
6. **Rep reserve** — escalated
7. **Prop tax** — escalated
8. **NOI** — EGI minus the three expense lines
9. **Debt service** — fixed at the Year-1 amortized amount
10. **Cash flow** — NOI − DS
11. **DSCR** — NOI / DS
12. **Cumulative CF** — running sum

A line chart (`#pf-chart`, Chart.js) plots NOI, Debt Service, and Cash Flow over the horizon.

---

## Limitations

| Limitation | Detail |
|---|---|
| Constant growth rates | Rent/expense escalations are flat across the horizon — real markets fluctuate |
| Fixed debt service | Assumes no refinancing, rate reset, or interest-rate adjustment event |
| No scenario / Monte-Carlo | Single deterministic projection. For sensitivity analysis see the [Deal Predictor's scenario output](./deal-predictor.md) or the QAP Simulator |
| Property-tax exemption is linear | Modeled as a 0%/50%/100% reduction, not a real CHFA / 501(c)(3) / housing-authority exemption schedule |
| AMI mix must be configured upstream | Gross rents are derived from the `#dc-units-{30,40,50,60}` inputs — inconsistent or empty AMI tiers break NOI |
| Screening tool, not underwriting | Disclaimer banner is inside the pro-forma card itself. Not a substitute for an investor pro-forma |

---

## Related

- [Deal Predictor guide](./deal-predictor.md) — recommends the execution path whose deal this pro-forma projects
- [QAP Simulator guide](./qap-simulator.md) — CHFA competitiveness scoring for the same deal
- [PMA Analysis guide](./pma-analysis.md) — market-context signals feeding rent and vacancy assumptions

## Change log
- 2026-04-21: impact-fee grant mode added in [#661](https://github.com/pggLLC/Housing-Analytics/pull/661). Grants reduce eligible basis under §42(d)(5)(A) and skip the debt-service line; loan-mode impact fees remain amortized across the horizon.
