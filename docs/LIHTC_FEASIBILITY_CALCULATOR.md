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
- Itemized development costs. Each cost line is marked in or out of eligible
  basis; land and reserves are never in basis. An existing building's purchase
  counts only after the user confirms it meets 26 U.S.C. 42(d)(2), including a
  rehabilitation that qualifies under 42(e). The invented example budget is a
  placeholder to replace with the project's own lines.
- Qualified basis and credit, computed in
  [`js/deal-cost-basis.js`](../js/deal-cost-basis.js) from the cost lines and the
  sourced rules file [`data/policy/lihtc-underwriting-rules.json`](../data/policy/lihtc-underwriting-rules.json).
  Federally funded grants come out of basis. CHFA's contractor and developer fee
  limits take any excess out of basis.
- The applicable fraction is the smaller of the unit fraction and the floor-space
  fraction. Floor space is needed only when some units are not LIHTC units.
- The 30% basis boost applies only when the user names a QCT, DDA, SADDA or CHFA
  designation and records the evidence for it.
- Credit capacity is the smaller of CHFA's Method One (qualified basis times the
  credit rate, under the per-project limit) and Method Two (the gap after every
  source except credit equity, including any deferred developer fee). While
  Method Two cannot run, capacity is unknown. Method Three, CHFA's cost basis
  limits, is published only in CHFA's Excel application and is not checked. The
  per-project limits assume the applicant and its affiliates have no other active
  CHFA applications; requests in those count against the same limits.
- Two CHFA conditions are disclosed beside the figures they limit but not yet
  checked: the tax-exempt bond aggregate basis test for 4% credits, and CHFA's
  minimum rehabilitation hard costs (the greater of 20% of the building's
  adjusted basis or $20,000 per unit) for acquisition and rehabilitation.
- State credit counts as a source only once CHFA has awarded it, because CHFA
  sizes it with a three-test calculation this calculator does not model. Each
  CHFA state credit application has its own limit; the 9% pairing is a fixed
  $500,000 a year.

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
