# `js/pma-ui-controller.js`

js/pma-ui-controller.js
UI controller for the enhanced PMA delineation tool on market-analysis.html.

Responsibilities:
 - Tab switching between buffer / commuting / hybrid methods
 - Show/hide layer picker for non-buffer modes
 - Hook into the existing pmaRunBtn click to trigger PMAAnalysisRunner
 - Drive the progress bar (step label, fill width, %, step count)
 - Render justification narrative, subsidy-expiry risk, and incentive badges
 - "Explain Score" and "Export Audit Trail" buttons

Depends on (loaded before this script, all deferred):
  window.PMAAnalysisRunner   — js/pma-analysis-runner.js
  window.PMAJustification    — js/pma-justification.js
  window.PMAEngine           — js/market-analysis.js

Backward-compatible: when PMAAnalysisRunner is absent the existing
buffer-based flow continues to work uninterrupted.

## Symbols

### `_applyChfaAwards(dealInputs, countyFips, chfaData)`

Count CHFA awards in a county from the last 5 years (2021-2026).

### `_applyAmiGap(dealInputs, countyFips, amiGapData)`

Look up the county affordability gap score from AMI gap data.

### `_showFieldError(inputId, msg)`

Show an inline validation error for a form field.
Sets aria-invalid on the input and un-hides the companion error span.

@param {string} inputId - The input element's id (e.g. 'pmaAmi30')
@param {string} msg     - Human-readable error message

### `_clearFieldError(inputId)`

Clear an inline validation error for a form field.

@param {string} inputId - The input element's id

### `_AMI_FIELDS`

Clear all AMI field errors.

### `_validateAmiInputs()`

Validate the capture-rate simulator inputs.
Returns true when valid; shows inline errors and returns false otherwise.

### `_writePermalink(lat, lon, options)`

Encode analysis parameters into the URL hash so the run can be shared
or bookmarked. Format: #pma=lat,lon,method,bufferMiles,proposedUnits

@param {number} lat
@param {number} lon
@param {object} options

### `_readPermalink()`

Parse a PMA permalink from the URL hash and return an object with
{ lat, lon, method, bufferMiles, proposedUnits } or null when absent.

@returns {{ lat:number, lon:number, method:string, bufferMiles:number, proposedUnits:number }|null}

### `_restoreLastRun()`

On page load, restore the last PMA run from localStorage (if within TTL)
OR from a URL permalink hash.  The URL hash takes priority so shared
links always reproduce the correct analysis context.

When a restorable state is found, the form controls are pre-populated
and an informational banner is shown near the run button.
