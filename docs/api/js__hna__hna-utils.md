# `js/hna/hna-utils.js`

hna-utils.js
Responsibility: Pure helpers, constants, formatting, and calculation utilities.
Dependencies: window.__HNA_GEO_CONFIG, window.APP_CONFIG
Exposes: window.HNAUtils

## Symbols

### `censusSourceUrl(year, series, table, geoType, geoid)`

Build a data.census.gov table URL with the correct geography filter
so users can explore the underlying data.
@param {number|null} year  - ACS vintage year (e.g. 2024)
@param {string} series    - 'acs1' or 'acs5'
@param {string} table     - table code, e.g. 'DP04', 'DP05', 'S0801'
@param {string|null} geoType - 'county', 'place', 'cdp', or null (national)
@param {string|null} geoid   - FIPS geoid (5-digit county or 7-digit place)
@returns {string|null}

### `srcLink(tableLabel, year, series, table, geoType, geoid)`

Render a source badge string (safe HTML) showing the ACS year, table label,
and a clickable [Source] link to data.census.gov.

### `countyFromGeoid(geoType, geoid)`

Map a Colorado geography (place / CDP / county / state) to its
containing 5-digit county FIPS.

Lookup order:
  1. county type → return the geoid itself
  2. state type  → return null (no single containing county)
  3. window.__HNA_GEO_CONFIG (fast in-memory path for featured geos)
  4. window.__HNA_GEOGRAPHY_REGISTRY (full 513-entry place/CDP map,
     loaded once from data/hna/geography-registry.json on first use)
  5. Otherwise return null — never fabricate a containing county.

Previously, this function defaulted to '08077' (Mesa County) for any
place/CDP not present in the small `__HNA_GEO_CONFIG` lists. That
was the source of the "Fruita/Boulder anomaly" — Boulder city
(0807850) wasn't in the config, so the comparison panel would silently
pull MESA County data and label it as Boulder. Now: missing entries
return null, callers fall back to state-level data or show a
"county unknown" message.

### `_registryLoadPromise`

Lazily load `data/hna/geography-registry.json` and cache it on
`window.__HNA_GEOGRAPHY_REGISTRY`. Idempotent. Returns the registry
object on success, or null if loading failed (e.g. file missing).

Callers should `await ensureGeographyRegistry()` before relying on
`countyFromGeoid` for non-featured places.

### `calculateJobMetrics(lehd, profile)`

Calculate high-level job metrics from LEHD data.
Supports both WAC (full) and OD-only (inflow/outflow/within) data shapes.
@param {object} lehd - LEHD JSON object
@param {object|null} profile - ACS profile for population (J:W ratio denominator)
@returns {object} metrics object

### `parseIndustries(lehd, topN)`

Parse top-N industries from LEHD WAC CNS fields.
Returns [] if no WAC data available.
@param {object} lehd
@param {number} topN
@returns {Array<{label, count}>}

### `calculateWageDistribution(lehd)`

Calculate wage distribution from LEHD WAC CE01/CE02/CE03 fields,
preferring annualWages[latest year] when available because it is
the more reliable source.

History note (2026-06-01): The static CE01/CE02/CE03 fields on
place blobs are broken — every place record has CE03 = 0 because
the tract-level LODES file at data/market/lodes_co.json itself
has high_wage = 0 for all 1,447 CO tracts (build_lodes_co.py is
dropping CS03 from the LODES WAC pull). The annualWages object is
built from a different pipeline (county-apportioned) and is
correct. Until the underlying data is rebuilt, prefer annualWages.

@param {object} lehd
@returns {{low, medium, high, total}|null}

### `REGIONAL_AMI_FACTORS`

Regional AMI factors for Prop 123 baseline estimation.
Replaces the uniform 0.70 national approximation with county-specific
factors based on HUD CHAS income-rent relationship analysis.

High-cost markets: fewer not-burdened renters are actually at ≤60% AMI
because local incomes are higher (many "not-burdened" households earn >60% AMI).
Low-cost markets: more not-burdened renters are at ≤60% AMI.

Methodology: derived from 2017-2021 CHAS B25106 cross-tabulations comparing
not-burdened renter share to actual ≤60% AMI renter share by county group.

### `calculateBaseline(profile, countyFips)`

@param {object} profile - ACS profile (DP04 fields)
@param {string} [countyFips] - 5-digit county FIPS for regional AMI factor lookup

### `calculateGrowthTarget(baseline, yearsAhead)`

Calculate the 3% annual growth target for a given baseline and year offset.
@param {number} baseline - Starting 60% AMI rental count
@param {number} yearsAhead - Years from baseline (0 = baseline year)
@returns {number}

### `checkFastTrackEligibility(population, geoType)`

Check if a jurisdiction is eligible for Prop 123 fast-track.
@param {number} population
@param {string} geoType - 'county' | 'place' | 'cdp'
@returns {{eligible, threshold, reason}}

### `getJurisdictionComplianceStatus(geoid, geoType, profile, countyFips)`

Get jurisdiction-level compliance status (single geography).
Delegates to Prop123Tracker if loaded, otherwise computes inline.

@param {string} geoid
@param {string} geoType
@param {object|null} profile - ACS profile
@returns {{
  baseline: number|null,
  current: number|null,
  target: number|null,
  pctComplete: number|null,
  status: string,
  lastFiled: string|null
}}

### `generateComplianceReport(rows)`

Generate a CSV string for compliance report across a list of jurisdiction objects.
Each item: { geoid, name, population, baseline, current, target, status, lastFiled }

@param {object[]} rows
@returns {string} CSV content

### `computeIncomeNeeded(homeValue)`

Render the fast-track timeline calculator card.
Wires up form controls inside the #fastTrackCalculator container.

### `computeActiveMarketTargetVacancy(profile)`

Compute the planning target vacancy for a county from ACS DP04
active-market vacancy rates (DP04_0004E homeowner + DP04_0005E rental),
weighted by tenure share. Floor at HUD's 5% healthy-market benchmark,
cap at 7% for genuinely distressed markets.

Returns an object: { target, observedActive, source } where
  target          = the planning value to use (decimal, 0.05 floor)
  observedActive  = the raw active-market vacancy (no floor/cap)
  source          = 'acs-tenure-weighted' | 'acs-rental-only' | 'fallback-hud-5pct'

@param {object|null} profile - ACS profile object (cached or live)
@returns {{target:number, observedActive:?number, source:string}}

### `isSmallGeography(profile)`

Check if a geography has small population where ACS estimates
may have high margins of error (30-50% for geographies <5,000).
@param {object} profile - ACS profile data
@returns {boolean}

### `getSmallGeoWarning(profile)`

Get a user-facing warning message for small geographies.
@param {object} profile - ACS profile data
@returns {string|null} Warning message or null if not small
