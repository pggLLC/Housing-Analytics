# `js/soft-funding-tracker.js`

js/soft-funding-tracker.js
Live Soft-Funding Tracker — Phase 2.1

Displays current program availability, deadlines, and competitiveness
for soft-funding programs (CHFA HTF, DOLA HTF, HOME, local trust funds).
Data is manually updated quarterly from public program announcements.

Non-goals:
  - Does NOT guarantee funds will be available — verify with program administrators
  - Does NOT pre-apply or submit applications
  - Does NOT perform real-time API calls — all data is from local JSON

Usage:
  SoftFundingTracker.load(softFundingData).then(function () {
    var result = SoftFundingTracker.check('08013', 2026);
  });

Exposed as window.SoftFundingTracker (browser) and module.exports (Node).

@typedef {Object} FundingCheckResult
@property {number}       available       — estimated remaining dollars
@property {string}       program         — program name
@property {string|null}  deadline        — ISO date string or null
@property {number|null}  daysRemaining   — calendar days to deadline
@property {string}       competitiveness — 'high'|'moderate'|'low'
@property {string}       narrative       — human-readable summary
@property {number}       confidence      — 0–1 likelihood estimate
@property {string|null}  warning         — warning message or null
@property {Array<Object>} programs       — all matching programs for this county

## Symbols

### `_daysToDeadline(deadlineStr, refDate)`

Days between now and a deadline string (YYYY-MM-DD).

### `_computeConfidence(prog)`

Build confidence score from availability and deadline proximity.

### `_fmtDollars(n)`

Format dollar amount for display.

### `_buildNarrative(prog, days)`

Build narrative for a matched program.

### `_matchPrograms(countyFips)`

Find programs available for a given county FIPS.
"All" county programs are always included.

### `load(fundingData)`

Load soft-funding program data.
@param {Object} fundingData — parsed soft-funding-status.json
@returns {Promise<void>}

### `check(countyFips, year, projectNeed)`

Check soft funding availability for a county and year.

@param {string} countyFips  - 5-digit FIPS (e.g. '08013')
@param {number} [year]      - Target fiscal year (defaults to current year)
@param {number} [projectNeed] - Estimated project soft funding need ($)
@returns {FundingCheckResult}

### `getLastUpdated()`

Returns the last updated date string.
@returns {string|null}

### `isLoaded()`

Returns true if data has been loaded.
@returns {boolean}

### `getEligiblePrograms(countyFips, executionType, opts)`

Return all eligible programs for a county + execution type (9%, 4%, non-LIHTC).
Filters out exhausted market-source placeholders and volume-cap entries
unless specifically requested.

@param {string} countyFips    — 5-digit FIPS
@param {string} executionType — '9%' | '4%' | 'non-LIHTC'
@param {Object} [opts]
@param {boolean} [opts.includeMarket]   — include OZ, NMTC, TIF (default false)
@param {boolean} [opts.includeVolumeCap] — include PAB row (default false)
@returns {Array<Object>} sorted by available descending

### `getPabStatus()`

Return PAB volume cap status for the current year.
@returns {Object|null}

### `sumEligible(countyFips, executionType)`

Compute total eligible soft funding for a county + execution type.
Sums available amounts from all matching programs (excluding market & volume cap).

@param {string} countyFips
@param {string} executionType
@returns {{total: number, programCount: number, programs: Array}}
