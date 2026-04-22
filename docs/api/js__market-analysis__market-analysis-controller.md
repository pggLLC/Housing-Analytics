# `js/market-analysis/market-analysis-controller.js`

js/market-analysis/market-analysis-controller.js
Orchestration layer for the market analysis report page.
Exposes window.MAController.

Dependencies (all resolved lazily at call-time; absent deps degrade gracefully):
  window.MAState          — global state manager
  window.MAUtils          — shared utility functions
  window.SiteSelectionScore — scoring model
  window.MARenderers      — section renderers
  window.PMAEngine        — underlying PMA engine / state
  window.DataService      — JSON data loader

## Symbols

### `_state()`

@returns {object|null}

### `_utils()`

@returns {object|null}

### `_scorer()`

@returns {object|null}

### `_rend()`

@returns {object|null}

### `_pma()`

@returns {object|null}

### `_ds()`

@returns {object|null}

### `_warn(msg)`

Log a warning without throwing.
@param {string} msg

### `_log(msg)`

Log an informational message.
@param {string} msg

### `_err(msg, err)`

Log an error without throwing.
@param {string} msg
@param {*}      [err]

### `_safe(fn, defaultVal)`

Wrap a function call in a try-catch; return defaultVal on failure.
@param {function} fn
@param {*} defaultVal
@returns {*}

### `_getAcs()`

Pull ACS aggregated metrics from PMAEngine's internal state, or from
DataService as a fallback.  Returns null if unavailable.
@returns {object|null}

### `_acsMetricsCache`

@type {Array|null} Cached ACS tract metrics for direct aggregation

### `_currentSite`

@type {{lat:number,lon:number,bufferMiles:number}|null} Current site for ACS lookup

### `_barrierExcludedGeoids`

@type {Array} Tract GEOIDs excluded by barrier analysis (populated by runAnalysis)

### `_aggregateNearestAcs(lat, lon, bufferMiles, excludedGeoids)`

Aggregate ACS metrics for tracts within buffer distance of a site.
Used as last-resort fallback when PMAEngine hasn't run.
/
  /**
@param {number} lat
@param {number} lon
@param {number} bufferMiles
@param {Array}  [excludedGeoids] - GEOIDs excluded by barrier analysis

### `_getLihtc()`

Pull LIHTC features from PMAEngine's internal state, or from
DataService as a fallback.  Returns [] if unavailable.
@returns {Array}

### `_getDesignationFlags(lat, lon)`

Pull QCT / DDA designation flags from local overlay data using HudEgis.
Checks whether the given lat/lon falls within a QCT or DDA polygon using
a ray-casting point-in-polygon algorithm (see hud-egis.js for details).

QCT = Qualified Census Tract (high poverty / low-income area; IRC §42(d)(5)(B)(ii))
DDA = Difficult Development Area (high construction costs; IRC §42(d)(5)(B)(iii))
Either designation qualifies the project for up to 130% eligible basis boost.

Returns safe defaults when HudEgis is unavailable or data has not yet loaded.

@param {number} lat
@param {number} lon
@returns {{ qctFlag: boolean, ddaFlag: boolean, basisBoostEligible: boolean }}

### `_computeFmrRatio(lat, lon, acs)`

Compute the Market Rent / FMR ratio using HudFmr when available.

Derives the primary county FIPS from PMAEngine's buffered tract geoids
(the first 5 digits of a GEOID are the state+county FIPS).  Falls back
gracefully when HudFmr or the PMAEngine state is not loaded.

@param {number}      lat  Site latitude.
@param {number}      lon  Site longitude.
@param {Object|null} acs  Aggregated ACS metrics for the buffer.
@returns {number|null}    Market gross rent ÷ 2BR FMR, or null.

### `_showAllLoading()`

Show a spinner in every report section.

### `_showAllError(msg)`

Show an error message in every report section.
@param {string} msg

### `_ejiCache`

@type {Array|null} Cached EJI features for proximity lookup

### `_getEjiFeatures()`

Load EJI features from the environmental_constraints layer on the map.
Falls back to fetching the GeoJSON file directly.

### `_getEjiMetrics(lat, lon)`

Get EJI environmental burden percentile for a site location.
Finds the nearest census tract with EJI data.
@param {number} lat
@param {number} lon
@returns {{ envBurden: number|null, socialVuln: number|null, healthVuln: number|null,
            ejiPercentile: number|null, riskCategory: string, tractGeoid: string }}

### `_envBurdenToScore(envBurden)`

Convert CDC EJI environmental burden percentile (0-1) to a soil/environmental
score (0-100) for the feasibility assessment.
Higher EJI burden = LOWER site suitability score.
@param {number|null} envBurden - EJI environmental burden percentile (0-1)
@returns {number} Score 0-100 (100 = cleanest/best, 0 = worst burden)

### `_getFloodRisk(lat, lon)`

Estimate flood risk (0-3) from loaded flood zone GeoJSON data.
Uses point-in-bbox approximation for speed.
@param {number} lat
@param {number} lon
@returns {number} 0=none, 1=low, 2=moderate, 3=high

### `_tractCentroidCache`

@type {Array|null} Cached tract centroids for county FIPS derivation

### `_scorecardCache`

@type {object|null} Cached scorecard data

### `_getScorecardMetrics(lat, lon)`

Get housing policy scorecard data for the jurisdiction containing the site.
Matches by county FIPS (5-digit) from the PMA buffer tracts.
@param {number} lat
@param {number} lon
@returns {{ overlayCount: number, overlays: Array.<string>, zoningCapacity: number,
            publicOwnership: boolean, totalScore: number, jurisdictionName: string }}

### `_loadScorecard()`

Attempt to load scorecard data asynchronously at init time.

### `_loadEji()`

Attempt to load and cache EJI features asynchronously at init time.

### `runAnalysis(lat, lon, bufferMiles)`

Orchestrate a full site analysis:
 1. Set loading state.
 2. Pull ACS + LIHTC data.
 3. Compute scores.
 4. Update MAState.
 5. Invoke all section renderers.
 6. Clear loading state.

@param {number} lat         - Site latitude.
@param {number} lon         - Site longitude.
@param {number} bufferMiles - Analysis buffer radius in miles.

### `_buildOpportunities(scores)`

Derive a list of strategic opportunity items from a score result.
@param {object|null} scores
@returns {{ items: Array }}

### `resetAll()`

Reset application state and clear all rendered sections.

### `init()`

Set up event listeners and perform startup configuration.
Must be called once on DOMContentLoaded.

### `_loadTractCentroids()`

Load tract centroids for county FIPS derivation fallback.

### `_loadAcsMetrics()`

Load ACS tract metrics for direct aggregation fallback.
