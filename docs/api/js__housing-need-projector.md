# `js/housing-need-projector.js`

housing-need-projector.js

ES5 IIFE module — window.HousingNeedProjector

Projects forward-looking housing need (5/10/20 yr) for a selected Colorado
county and recommends an AMI distribution based on current income and cost-
burden data.

Data sources consumed:
  - data/co-county-demographics.json  (loaded externally or passed in)
  - data/hna/projections/{fips}.json  (DOLA household projections — optional)
  - window.HudFmr                     (HUD FMR/AMI limits — optional)
  - window.SiteState.getCounty()      (selected county context — optional)

## Symbols

### `_safeRound(n)`

Round to nearest integer, return 0 for NaN/Infinity.

### `_fmt(n)`

Format a number with comma thousands separator.

### `_vacancyDeficitFactor(vacancyRate)`

Derive vacancy-deficit factor from vacancy_rate (%).
vacancy_deficit_factor = max(0, 0.05 - vacancy_rate/100) * 10

IMPORTANT: returns null when vacancyRate is null/undefined. Callers
must treat null as "no adjustment available" — NOT as 0. A null
(missing) rate previously silently became 0 here, which then produced
the MAXIMUM deficit factor (0.5) and inflated projected need by 50%.
Missing vacancy data must not be indistinguishable from "critical
shortage."

### `_incrementalGrowth(baseHouseholds, annualRate, years)`

Compound growth: base * ((1 + rate)^years - 1)
Returns the *incremental* new households after `years`.

### `_dolaHouseholdRate(dolaProj)`

Derive a household growth rate from DOLA projection data.
Uses incremental_units_needed_dola or households_dola arrays.
Returns annual rate as a decimal, or null if data unavailable.

### `project(fips, countyData, options)`

@param {string}  fips        5-digit FIPS (e.g. "08001")
@param {Object}  countyData  Row from co-county-demographics.json
@param {Object}  [options]
@param {Object}  [options.dolaProj]   Parsed DOLA projections JSON
@param {string}  [options.countyName]
@returns {ProjectionResult}

### `_buildRationale(priority, cd)`

Build tier rationale strings.
@param {string} priority
@param {Object} cd  countyData
@returns {string[]}

### `recommendAmiMix(countyData, options)`

@param {Object}  countyData
@param {Object}  [options]
@param {number}  [options.totalUnitsNeeded]
@returns {AmiRecommendation}

### `renderProjectionSection(containerId, fips, countyData)`

Fetches DOLA projection if available, runs project(), injects HTML.
@param {string} containerId
@param {string} fips
@param {Object} countyData

### `renderAmiRecommendation(containerId, countyData)`

@param {string} containerId
@param {Object} countyData
