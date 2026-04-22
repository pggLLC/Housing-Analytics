# `js/hna/hna-renderers.js`

hna-renderers.js
Responsibility: DOM render functions for Housing Needs Assessment.
Dependencies: window.HNAState, window.HNAUtils
Exposes: window.HNARenderers

## Symbols

### `renderLaborMarketSection(lehd, profile, geoType)`

Main Labor Market section renderer.
@param {object|null} lehd
@param {object|null} profile

### `renderEmploymentTrend(geoid)`

Render a multi-year employment trend line chart with YoY labels.
Reads annualEmployment and yoyGrowth from the cached LEHD file.

@param {string|null} geoid - 5-digit county FIPS (used for data lookup); null for state-level

### `renderWageTrend(geoid)`

Render a dual-axis line chart: nominal wage trend vs. annual housing cost.
Reads data from the LEHD wage bands and ACS profile.

@param {string|null} geoid - 5-digit county FIPS; null for state-level

### `renderIndustryAnalysis(geoid)`

Render an industry analysis combining a horizontal bar chart and
an HHI concentration badge.

@param {string|null} geoid - 5-digit county FIPS; null for state-level

### `renderEconomicIndicators(geoid)`

Render a 4-card economic indicator dashboard showing:
  1. Total jobs (latest year)
  2. YoY employment growth
  3. CAGR over available years
  4. Industry diversity (HHI)

@param {string|null} geoid - 5-digit county FIPS; null for state-level

### `renderWageGaps(geoid, profile)`

Render a wage-gap affordability table showing each LEHD wage tier vs.
local median rent.

@param {string} geoid   - 5-digit county FIPS
@param {object} profile - ACS profile (for median rent DP04_0134E)

### `renderProp123Section(profile, geoType, countyFips)`

Main Prop 123 section renderer.
@param {object|null} profile - ACS profile data
@param {string} geoType

### `renderFastTrackCalculatorSection()`

Calculate fast-track approval timeline under HB 22-1093 / Prop 123.

@param {number} projectUnits       - Total units in project
@param {number} ami_pct            - AMI percentage (e.g. 60 for 60% AMI)
@param {string} jurisdiction_type  - 'county' | 'place' | 'cdp'
@returns {{
  standardDays: number,
  fastTrackDays: number,
  timelineSavings: string,
  eligible: boolean,
  conditions: string[]
}}

### `renderHistoricalSection(baselineData, geoType, geoid)`

Render the historical compliance section using Prop123Tracker (if loaded).

@param {object|null} baselineData - from U().calculateBaseline()
@param {string}      geoType
@param {string}      geoid

### `renderComplianceTable(histData, traj, baseline, container)`

Render the multi-year compliance table.

### `renderChasAffordabilityGap(countyFips5, chasData)`

renderChasAffordabilityGap — render a stacked bar chart showing renter
cost burden by AMI tier from HUD CHAS data for the selected county.

@param {string} countyFips5 - 5-digit county FIPS (e.g. '08031') or null for statewide
@param {object|null} chasData - pre-loaded chas_affordability_gap.json, or null to skip

### `clearProjectionsForStateLevel()`

Clear projection stat cards and set an informative note for geography types
(such as state-level) where county-based projections do not apply.
@returns {{ ok: boolean }}

### `renderScenarioComparison(geoid, scenario_names, opts)`

renderScenarioComparison — draw a multi-line chart comparing several
projection scenarios on a single axis.

@param {string}   geoid          - 5-digit county or place FIPS
@param {string[]} scenario_names - array of scenario keys to compare
@param {Object}   opts
@param {Element}  opts.canvas        - <canvas> element
@param {Object}   opts.seriesByScenario - {scenarioKey: [{year, population}, ...], ...}
@param {number}   [opts.years=10]   - projection horizon

### `renderHouseholdDemand(geoid, scenario, affordability_tiers, opts)`

renderHouseholdDemand — draw a stacked bar chart of projected housing demand
broken out by affordability tier (AMI bands) for owner and renter segments.

@param {string}   geoid               - 5-digit FIPS
@param {string}   scenario            - scenario key
@param {string[]} affordability_tiers - subset of AMI tier keys to display
@param {Object}   opts
@param {Element}  opts.canvas          - <canvas> element
@param {Array}    opts.demandSeries    - array of demand-projection records:
                                         [{year_offset, demand_by_ami: {owner: {...}, renter: {...}}}, ...]
@param {string}   [opts.tenure='renter'] - 'owner' | 'renter' | 'both'

### `showChartLoading(canvasId)`

Show a loading overlay inside a .chart-box container for the given canvas ID.

### `hideChartLoading(canvasId)`

Hide the loading overlay for the given canvas ID (or all overlays if no id given).

### `showAllChartsLoading()`

Show loading overlays on all chart canvases currently in the DOM.

### `renderIncomeDistribution(profile)`

renderIncomeDistribution — Household income distribution chart (DP03 income brackets)

### `renderHousingAgeChart(profile)`

renderHousingAgeChart — Age of housing stock (DP04 year built)

ACS 5-year 2023 confirmed variable codes (DP04 YEAR STRUCTURE BUILT):
  DP04_0017E = Built 2020 or later
  DP04_0018E = Built 2010 to 2019
  DP04_0019E = Built 2000 to 2009
  DP04_0020E = Built 1990 to 1999
  DP04_0021E = Built 1980 to 1989
  DP04_0022E = Built 1970 to 1979
  DP04_0023E = Built 1960 to 1969
  DP04_0024E = Built 1950 to 1959
  DP04_0025E = Built 1940 to 1949
  DP04_0026E = Built 1939 or earlier
Note: DP04_0027E–DP04_0032E are ROOMS variables, not year-built.

### `renderBedroomMixChart(profile)`

renderBedroomMixChart — Bedroom mix (DP04 bedrooms)

ACS 5-year 2023 confirmed variable codes (DP04 BEDROOMS):
  DP04_0039E = No bedroom
  DP04_0040E = 1 bedroom
  DP04_0041E = 2 bedrooms
  DP04_0042E = 3 bedrooms
  DP04_0043E = 4 bedrooms
  DP04_0044E = 5 or more bedrooms
Note: DP04_0045E–DP04_0047E are HOUSING TENURE variables, not bedrooms.

### `renderOwnerCostBurdenChart(profile)`

renderOwnerCostBurdenChart — Owner housing cost burden (DP04 selected monthly costs as % of income)

### `renderHousingGapSummary(profile, geoType)`

renderHousingGapSummary — Render housing gap stats panel.
Shows estimated housing gap at each AMI tier based on profile data.

### `renderSpecialNeedsPanel(profile)`

renderSpecialNeedsPanel — Senior and disability housing analysis

### `renderExtendedAnalysis(profile, geoType)`

renderExtendedAnalysis — Orchestrates all extended HNA section renders.

### `renderBlsLabourMarket(countyFips5, geoType, econData)`

Render BLS Labour Market KPI cards (unemployment rate + 5-yr job growth)
into #blsLabourMarketCards using data from co-county-economic-indicators.json.

@param {string|null} countyFips5 - 5-digit county FIPS for the selected geography
@param {string} geoType - 'county' | 'place' | 'cdp' | 'state'
@param {object|null} econData - parsed co-county-economic-indicators.json

### `renderGapCoverageStats(countyFips5, chasData)`

renderGapCoverageStats — populate the "Affordability Gap by AMI Tier"
stat cards in the Executive Snapshot.  Derives gap = cost_burdened
households (those paying >30% income on housing) at each AMI tier.

@param {string} countyFips5 - 5-digit county FIPS or null for statewide
@param {object|null} chasData - pre-loaded chas_affordability_gap.json
