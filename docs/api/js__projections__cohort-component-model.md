# `js/projections/cohort-component-model.js`

cohort-component-model.js — COHO Analytics

Client-side cohort-component demographic projection engine.
Mirrors the Python implementation in scripts/hna/demographic_projections.py
so that the interactive scenario builder can run projections entirely in-browser
without a round-trip to the server.

Standard model: Pop(t+1) = Pop(t) × Survival + Births + Net Migration
Projections are run in annual steps by interpolating 5-year age-group survival
rates. Births use age-specific fertility rates (ASFRs) applied to female cohorts.

Exposes: window.CohortComponentModel

## Symbols

### `CohortComponentModel(opts)`

@param {Object} opts
@param {Object}  opts.basePopulation - {male: float[18], female: float[18]}
@param {number}  opts.baseYear       - Start year (default 2024)
@param {number}  opts.targetYear     - End year (default 2050)
@param {Object}  [opts.scenario]     - Scenario parameter overrides
@param {number}  [opts.headshipRate] - Fraction of households per person (default 0.38)
@param {number}  [opts.vacancyTarget]- Target vacancy rate (default 0.05)
@param {number}  [opts.baseUnits]    - Existing housing units in base year
