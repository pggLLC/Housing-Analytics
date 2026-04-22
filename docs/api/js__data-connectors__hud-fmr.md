# `js/data-connectors/hud-fmr.js`

js/data-connectors/hud-fmr.js
HUD Fair Market Rents (FMR) and Income Limits connector.

Loads FY2025 FMR and HUD income limits for all 64 Colorado counties from the
prebuilt static file at data/hud-fmr-income-limits.json.

Exposes window.HudFmr with methods for use in HNA, market-analysis, and
feasibility-oriented pages.

Usage:
  HudFmr.load().then(function () {
    var fmr = HudFmr.getFmrByFips('08031');
    // fmr.two_br → $1,802 (2-bedroom FMR, Denver County)
    var il  = HudFmr.getIncomeLimitsByFips('08031');
    // il.il50_4person → income limit at 50% AMI for a 4-person household
  });

## Symbols

### `_counties`

@type {Array.<Object>} Loaded county records.

### `_byFips`

@type {Object.<string, Object>} Index keyed by 5-digit FIPS string.

### `_meta`

@type {Object|null} File-level metadata.

### `_loaded`

@type {boolean} Whether data has been successfully loaded.

### `_loadPromise`

@type {Promise|null} In-flight or resolved load promise.

### `normFips(fips)`

Normalise a FIPS code to a 5-digit zero-padded string.
@param {string|number} fips
@returns {string}

### `fmtDollar(n)`

Format a dollar amount as a compact currency string (e.g. "$1,802").
@param {number|null|undefined} n
@returns {string}

### `buildIndex(counties)`

Index the loaded county array by FIPS for O(1) lookup.
@param {Array.<Object>} counties

### `load()`

Load FMR + income limits data from the static JSON file.
Safe to call multiple times; subsequent calls return the cached promise.

@returns {Promise<void>} Resolves when data is ready.

### `isLoaded()`

Returns true once data has been successfully loaded.
@returns {boolean}

### `getByFips(fips)`

Return the full county record for a given FIPS code.
@param {string|number} fips  5-digit county FIPS.
@returns {Object|null}

### `getFmrByFips(fips)`

Return the FMR object for a county.
Properties: efficiency, one_br, two_br, three_br, four_br (all in $USD/month).
@param {string|number} fips
@returns {{efficiency:number, one_br:number, two_br:number, three_br:number, four_br:number}|null}

### `getIncomeLimitsByFips(fips)`

Return the income limits object for a county.
Properties: ami_4person, il30_1person … il80_4person (all in $USD/year).
@param {string|number} fips
@returns {Object|null}

### `getAreaNameByFips(fips)`

Return the FMR area name for a county (e.g. "Denver-Aurora-Lakewood HUD Metro FMR Area").
@param {string|number} fips
@returns {string|null}

### `getGrossRentLimit(fips, pctAmi)`

Compute the gross rent limit for a given %AMI and bedroom size.

Uses HUD's standard formula: (AMI × pctAmi × 0.30) / 12.
When a county FIPS is provided, uses the county-specific 4-person AMI.
When no FIPS (or FIPS not found), returns null.

@param {string|number} fips     5-digit county FIPS.
@param {number}        pctAmi   AMI percentage (e.g. 30, 50, 60, 80).
@returns {number|null}          Monthly gross rent limit in $USD, or null.

### `computeFmrRatio(fips, marketRent)`

Compute the ratio of a given market rent to the 2-bedroom FMR.
Used by the market-analysis subsidy scoring engine.

@param {string|number} fips         5-digit county FIPS.
@param {number}        marketRent   Monthly market gross rent ($USD).
@returns {number|null}              Ratio (market / FMR 2BR), or null if unavailable.

### `getSummaryByFips(fips)`

Return a summary object suitable for rendering in a UI card.
@param {string|number} fips
@returns {{
  county_name: string,
  fmr_area_name: string,
  fmr: {efficiency:number, one_br:number, two_br:number, three_br:number, four_br:number},
  income_limits: Object,
  ami_4person: number
}|null}

### `getMeta()`

Return the file-level metadata object.
@returns {Object|null}

### `getAllCounties()`

Return all loaded county records (for iteration / bulk display).
@returns {Array.<Object>}

### `renderFmrTable(fips)`

Build an HTML table string showing FMR values for a county.
Suitable for injection into a card element.
@param {string|number} fips
@returns {string} HTML string, or empty string if FIPS not found.

### `renderIncomeLimitsTable(fips)`

Build an HTML table string showing income limits for a county.
Renders 30%, 50%, 80% AMI for household sizes 1–4.
@param {string|number} fips
@returns {string} HTML string, or empty string if FIPS not found.
