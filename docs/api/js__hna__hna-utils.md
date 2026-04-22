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

Calculate wage distribution from LEHD WAC CE01/CE02/CE03 fields.
Falls back to annualWages[latest year] when root CE fields are absent
(e.g. state-aggregate file stores wage tiers under annualWages[year].low/medium/high).
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

Estimate count of 60% AMI rental units from ACS profile data.
Uses ACS DP04 GRAPI bins as a proxy:
  - Total renter-occupied units (DP04_0003E - vacant, or derived from tenure pct)
  - Affordability proxy: units paying < 30% income (not rent-burdened) as a proxy for
    units affordable at ≤60% AMI.  This is an approximation — true 60% AMI counts
    require ACS B25106 cross-tabulations not in the DP04 profile.

ACS DP04 fields used:
  DP04_0001E  - Total housing units
  DP04_0047PE - Renter-occupied (%)
  DP04_0003E  - Occupied housing units
  DP04_0144PE - GRAPI <15%
  DP04_0145PE - GRAPI 15-19.9%
  DP04_0146PE - GRAPI 20-24.9%  (not burdened)

@param {object} profile - ACS profile (DP04 fields)
@returns {{baseline60Ami, totalRentals, pctOfStock, method}|null}
/

  /**
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

### `isSmallGeography(profile)`

renderProjectionChart — draw a line chart of projected population for one
scenario over a custom year range.

@param {string}   geoid    - 5-digit county FIPS (or place FIPS)
@param {string}   scenario - 'baseline' | 'low_growth' | 'high_growth'
@param {number}   years    - projection horizon (e.g. 10)
@param {Object}   opts
@param {Element}  opts.canvas  - <canvas> element to draw on
@param {Array}    opts.basePopSeries  - [{year, population}, ...] from loaded projections
/


  window.HNAUtils = {
    // constants
    STATE_FIPS_CO,
    ACS_VINTAGES,
    ACS_YEAR_PRIMARY,
    ACS_YEAR_FALLBACK,
    DEBUG_HNA,
    DEFAULTS,
    AFFORD,
    FEATURED,
    PATHS,
    SOURCES,
    GITHUB_PAGES_BASE,
    NAICS_LABELS,
    WAGE_BAND_ANNUAL,
    PROP123_MUNICIPALITY_THRESHOLD,
    PROP123_COUNTY_THRESHOLD,
    PROP123_GROWTH_RATE,
    LIHTC_FALLBACK_CO,
    QCT_FALLBACK_CO,
    DDA_FALLBACK_CO,
    CO_DDA,
    BOUNDARY_STYLES,
    PROJECTION_SCENARIOS,
    AMI_TIER_LABELS,
    AMI_TIER_COLORS,
    // functions
    redactKey,
    fmtNum,
    fmtMoney,
    fmtPct,
    censusSourceUrl,
    srcLink,
    safeNum,
    computeIncomeNeeded,
    rentBurden30Plus,
    calculateJobMetrics,
    parseIndustries,
    calculateWageDistribution,
    calculateBaseline,
    calculateGrowthTarget,
    checkFastTrackEligibility,
    calculateFastTrackTimeline,
    getJurisdictionComplianceStatus,
    generateComplianceReport,
    lihtcSourceInfo,
    lihtcPopupHtml,
    countyFromGeoid,
    censusKey,
    lihtcFallbackForCounty,
    isSmallGeography,
    getSmallGeoWarning,
  };

  /**
Check if a geography has small population where ACS estimates
may have high margins of error (30-50% for geographies <5,000).
@param {object} profile - ACS profile data
@returns {boolean}

### `getSmallGeoWarning(profile)`

Get a user-facing warning message for small geographies.
@param {object} profile - ACS profile data
@returns {string|null} Warning message or null if not small
