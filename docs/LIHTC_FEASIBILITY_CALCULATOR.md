# LIHTC Feasibility Calculator — Scope and Limitations

## What this tool does

The **Deal Calculator** is at [`deal-calculator.html`](../deal-calculator.html),
step 6 of the guided workflow. Its rental mode is an early-stage LIHTC financial
screen. Market Analysis supplies a subject-project rent schedule and site context;
the standalone calculator is where the financial assumptions and results are edited.

The implementation is [`js/deal-calculator.js`](../js/deal-calculator.js), with
pure financial helpers in [`js/deal-calculator-math.js`](../js/deal-calculator-math.js).
Results are planning estimates, not underwriting, an appraisal, a formal market
study or a CHFA award prediction.

## Current outputs and controls

- Annual tax credits, equity, supportable permanent debt and funding gap.
- Multi-tranche soft funding, with separate loan/grant amounts, rates and terms.
- Deferred developer fee, including an optional balancing control.
- A 30-year operating pro forma and debt-service coverage stress scenarios.
- Cash-flow and capital-event waterfalls, exit value and deferred-fee payback.
  These are simplified screens, not investor-specific partnership models.
- A unit-share applicable fraction from `computeApplicableFraction`: designated
  LIHTC units divided by total residential units. The legal applicable fraction
  is the smaller of unit fraction and floor-area fraction; the calculator does
  not separately track floor area. It is therefore a unit-share proxy.
- A QCT/DDA designation indicator. It does **not** automatically apply a 130%
  basis boost. The user must confirm eligibility and explicitly adjust the
  eligible-basis assumption to model a boost.

## Rent and geography assumptions

| Input | Current source or behavior |
|---|---|
| CHFA rent setting | Published CHFA income/rent table, resolved through [`js/chfa-rent-limits.js`](../js/chfa-rent-limits.js). Gross limits derive from HUD multifamily income limits (MTSP); FMR is a voucher comparison benchmark. |
| Contract rent | Gross rent less the utility allowance and required fees. The allowance basis comes from the Subject Project. Missing allowance data is disclosed as a gross upper bound. |
| Subject-project schedule | A complete same-county CHFA schedule supplies its rows and vacancy rate. Contract rents are already net of allowances and are not deducted twice. |
| Manual market units | Sourced ZORI distribution or a user-entered rent with a source note. Missing market rents block dependent financial outputs. |
| Non-CHFA settings | AMI-formula and market settings do not designate LIHTC units or earn credits. |
| County | Uses the selected jurisdiction/county; missing county data remains unavailable. There is no Denver MSA fallback. |
| Equity price, costs and financing | Editable assumptions. Defaults and some constants live in code/registries; source badges distinguish data, assumptions and user entries. |

HUD FMR and supported market rents help compare achievable rents. They do not
establish the §42 gross rent limit. The rent module preserves unavailable values
and blocks deductions greater than gross rent instead of producing a clamped $0.

## Relationship to the concept predictor

[`js/lihtc-deal-predictor.js`](../js/lihtc-deal-predictor.js) and its
[enhanced wrapper](../js/lihtc-deal-predictor-enhanced.js) provide concept screening
from PMA and supplied market inputs. They are distinct from the financial
calculator. CHFA project context uses the current CHFA feeds, including
`data/chfa-lihtc.json` and `data/affordable-housing/lihtc/chfa-properties.json`,
not the retired `data/chfa/chfa_lihtc_co.geojson` path. The predictor contains
screening constants; it is not entirely configured by a data file and does not
return an FMR-to-AMI rent-alignment result.

## Limitations and next steps

The calculator does not determine CHFA competitive points, independently verify
available funding, or replace a project-specific eligible-basis analysis. Its
construction carry, operating costs, financing, waterfall and exit assumptions
need professional review before an investment or application decision.

Select a county, review each input's provenance, verify the applicable CHFA table
and utility-allowance source, and test the financing assumptions with lenders and
investors. The JSON and PDF reports carry methodology, sources, assumptions and
missing-source disclosures; they remain screening reports.
