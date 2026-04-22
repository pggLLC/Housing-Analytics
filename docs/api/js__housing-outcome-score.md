# `js/housing-outcome-score.js`

js/housing-outcome-score.js
Housing Outcome Score (HOS) — composite 0-100 metric combining four
dimensions of project viability:

  1. Need Coverage  (30%) — How well does the proposed concept address
     the community's identified affordability gap?
  2. Policy Alignment (20%) — Does the jurisdiction have supportive
     housing policies, QCT/DDA designation, and Prop 123 participation?
  3. Financial Feasibility (30%) — Site selection score, deal predictor
     confidence, and capital stack health.
  4. Site Quality (20%) — Access to amenities, transit, schools; low
     environmental risk; market opportunity band.

The HOS provides a single decision-support number that integrates
data from all 5 workflow steps.  It updates incrementally as the user
completes each step — partial scores are shown with a confidence
indicator reflecting data completeness.

Depends on (all optional — degrades gracefully):
  WorkflowState, SiteState, HNAState, SiteSelectionScore,
  LIHTCDealPredictor, HousingNeedsFitAnalyzer

Exposes: window.HousingOutcomeScore

## Symbols

### `_scoreNeedCoverage(data)`

1. Need Coverage (0-100)
Sources: HNA affordability gap, HousingNeedsFitAnalyzer coverage %,
         CHAS cost burden data

### `_scorePolicyAlignment(data)`

2. Policy Alignment (0-100)
Sources: QCT/DDA flags, housing scorecard dimensions, Prop 123

### `_scoreFinancialFeasibility(data)`

3. Financial Feasibility (0-100)
Sources: site selection score, deal predictor confidence, capital stack

### `_scoreSiteQuality(data)`

4. Site Quality (0-100)
Sources: site selection access + feasibility scores, opportunity band

### `_gatherData()`

Gather all available data from the various state systems.
Returns a flat object with all input fields.

### `compute(overrides)`

Compute the Housing Outcome Score.

@param {Object} [overrides] - Optional data overrides (for testing)
@returns {{
  score:        number,       — Composite 0-100
  grade:        string,       — A/B/C/D/F letter grade
  confidence:   string,       — 'high'|'medium'|'low'
  dimensions:   Object,       — Per-dimension {score, weight, available, inputs}
  dataComplete: number,       — 0-100 pct of data dimensions available
  summary:      string        — One-sentence narrative
}}
