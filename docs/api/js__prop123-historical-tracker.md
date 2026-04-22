# `js/prop123-historical-tracker.js`

## Symbols

### `getHistoricalAffordableData(geoType, geoid, baseline)`

Return a synthetic historical dataset for a geography.
In production this would load from cached ACS snapshots; here we return
the best available estimate from available data plus null placeholders for
future reporting years.

@param {string} geoType  - 'county' | 'place' | 'cdp'
@param {string} geoid    - FIPS / place code
@param {number} baseline - baseline60Ami count from calculateBaseline()
@returns {{ years: number[], actuals: (number|null)[] }}

### `calculateComplianceTrajectory(baseline, actuals, currentYear)`

Compare actual affordable-unit counts against the 3% compounding requirement.

@param {number}          baseline    - Baseline unit count (year 0)
@param {(number|null)[]} actuals     - Array of actual unit counts per year (index 0 = baseline year)
@param {number}          currentYear - e.g. 2026
@returns {{
  onTrack: boolean|null,
  yearsAhead: number,
  yearsOffTargetCount: number,
  gapAtCurrentYear: number,
  trendLine: number[],
  targets: number[]
}}

### `getDolaFilingDeadlines()`

Return DOLA filing deadline information for the current and next cycles.

@returns {{
  nextDeadline: string,      // ISO date "YYYY-MM-DD"
  filed: boolean,            // always false (runtime has no filing registry access)
  filingYear: number,        // year the report covers
  daysUntilDeadline: number
}}

### `renderHistoricalComplianceChart(canvasId, baseline, historicalData, currentYear)`

Render the historical compliance line chart onto a <canvas> element.
Requires Chart.js to be loaded on the page.

@param {string}  canvasId
@param {number}  baseline
@param {{years: number[], actuals: (number|null)[]}} historicalData
@param {number}  currentYear

### `renderDolaFilingStatus(containerId)`

Render the DOLA filing deadline status badge into a container element.

@param {string} containerId - ID of the container element
