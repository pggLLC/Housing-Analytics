# `js/lihtc-concept-card-renderer.js`

js/lihtc-concept-card-renderer.js
Full-featured LIHTC concept recommendation card renderer.

Renders a complete, accessible concept recommendation card that replaces
the minimal stub used in buffer mode.  Works for both the map-click
(buffer) flow and the enhanced PMA (commuting/hybrid) flow.

Features rendered:
  • Recommended execution (4% vs 9%) with confidence badge (🟢🟡🔴)
  • Concept type and estimated total unit count
  • Suggested unit mix (studio, 1BR, 2BR, 3BR+)
  • Suggested AMI mix (30%, 50%, 60%) with unit counts
  • Why this fits — 3–4 rationale bullets
  • Key risks — ⚠ warning flags
  • Alternative path (when applicable)
  • Indicative capital stack (collapsible <details>)
  • Important caveats (yellow warning box)
  • Housing Needs Fit section — HNA alignment, coverage %, gaps
  • Export JSON button

Depends on (all optional — card gracefully degrades):
  window.HousingNeedsFitAnalyzer — housing-needs-fit-analyzer.js

Exposes: window.LIHTCConceptCardRenderer

## Symbols

### `_esc(str)`

HTML-escape a string.

### `_cap(str)`

Capitalise first letter.

### `_fmtM(n)`

Format dollar amount as "$1.4M" / "$250K" / "$18K".

### `_trow(label, value)`

Build an HTML table row with a label/value pair.

### `_sumObj(obj)`

Sum all numeric values in an object.

### `render(container, rec, hnsFit, constraints)`

Renders the full concept card into `container`.

@param {HTMLElement}  container    - Target DOM element (e.g. #lihtcConceptCard).
@param {Object}       rec          - DealRecommendation from LIHTCDealPredictor.predictConcept().
@param {Object|null}  [hnsFit]     - Optional HNSFit from HousingNeedsFitAnalyzer.analyzeHousingNeedsFit().
@param {Object|null}  [constraints] - Optional constraint data { environmental, publicLand, softFunding, chfaCompetitiveness }
