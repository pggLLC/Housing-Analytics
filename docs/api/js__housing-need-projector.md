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

Derive vacancy-deficit factor from vacancy_rate (fraction, 0-1).
vacancy_deficit_factor = max(0, 0.05 - vacancy_rate) * 10

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

### `_dolaIncrementalNeed(dolaProj)`

DOLA cumulative homes-needed series (housing_need.incremental_units_needed_dola)
at 5, 10 and 20 years past the 2024 base year, or null when absent.

### `project(fips, countyData, options)`

@param {string}  fips        5-digit FIPS (e.g. "08001")
@param {Object}  countyData  Row from co-county-demographics.json
@param {Object}  [options]
@param {Object}  [options.dolaProj]   Parsed DOLA projections JSON
@param {string}  [options.countyName]
@param {string}  [options.geoType]    Caller's selected geography type
                 ('county' | 'place' | 'cdp'). Inputs are always county
                 rows, so a place/cdp selection yields a county-scope
                 result — stamped on the output as geoScope so callers
                 can disclose the provenance.
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

### `renderProjectionSection(containerId, fips, countyData, options)`

Fetches DOLA projection if available, runs project(), injects HTML.
@param {string} containerId
@param {string} fips
@param {Object} countyData
@param {Object} [options]
@param {string} [options.geoType]  Caller's selected geography type —
                forwarded to project() so the county-scope provenance
                is stamped and disclosed for place/cdp selections.
@param {string} [options.countyName]  Display name for the county —
                demographics rows keyed by name don't carry a .name
                field, so without this the intro shows the raw FIPS.

### `mixCheckFor(rec, inputs, MixCheck, MixCheckInputs)`

The need notes and 15-year pencil check (js/mix-check.js) for the preset
recommendAmiMix picked. Percent shares stand in for units, so the mix is
tested as a nominal 100-unit building; the 100% AMI slice has no CHFA
tax-credit rent, so it is left out and named. Pure.
@param {AmiRecommendation} rec
@param {Object} inputs  MixCheckInputs.build() result
@param {Object} MixCheck
@param {Object} MixCheckInputs
@returns {{ units: Object, leftOut: number|null, result: Object, lead: string }}

### `renderAmiRecommendation(containerId, countyData, options)`

@param {string} containerId
@param {Object} countyData
@param {Object} [options]
@param {string} [options.countyFips]  enables the need notes and 15-year check
@param {string} [options.placeGeoid]  place CHAS is used when the place has it
@param {string} [options.placeName]
