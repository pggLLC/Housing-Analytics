# `js/hna/hna-renderers.js`

hna-renderers.js
Responsibility: DOM render functions for Housing Needs Assessment.
Dependencies: window.HNAState, window.HNAUtils
Exposes: window.HNARenderers

## Symbols

### `escHtml(v)`

escHtml — escape a string for safe insertion into innerHTML.
@param {*} v - value to escape
@returns {string}

### `safeUrl(url)`

safeUrl — returns the URL if it uses an http(s) scheme; otherwise returns '#'.
Prevents javascript: and data: URL injection in href attributes.
@param {string} url
@returns {string}

### `chartTheme()`

Returns a color palette object keyed to CSS custom properties.
Used by all Chart.js instances for consistent theming.

### `makeChart(ctx, config)`

makeChart — create or recreate a Chart.js chart on a canvas context.
Destroys any existing chart registered under the same canvas id so that
repeated calls do not leak Chart instances.

@param {CanvasRenderingContext2D} ctx - 2D context from canvas.getContext('2d')
@param {object} config - Chart.js configuration object
@returns {Chart} The new Chart instance

### `showChartLoading(canvasId)`

showChartLoading — show a loading overlay inside .chart-box for the given canvas ID.
@param {string} canvasId

### `hideChartLoading(canvasId)`

hideChartLoading — hide the loading overlay for the given canvas ID, or all overlays if omitted.
@param {string} [canvasId]

### `showAllChartsLoading()`

showAllChartsLoading — show loading overlays on all chart canvases in the DOM.

### `setBanner(message, level)`

setBanner — display (or clear) the top-of-page status banner.
@param {string} message - Text to display; pass '' to hide the banner.
@param {'info'|'warn'|'error'} [level='info']

### `clearStats()`

clearStats — reset all stat card text to '—' so stale data is not shown
while a new geography loads.

### `renderBoundary(gj, geoType)`

renderBoundary — draw or replace the GeoJSON boundary layer on the HNA map.
@param {GeoJSON.FeatureCollection} gj
@param {string} geoType - 'county'|'place'|'cdp'|'state'

### `renderSnapshot(profile, s0801, label, prevProfile)`

renderSnapshot — populate the executive summary stat cards.
@param {object} profile  - ACS DP-series profile object
@param {object|null} s0801 - ACS S0801 commute table (or null)
@param {string} label    - Human-readable geography label
@param {object|null} prevProfile - Prior period profile for YoY deltas

### `renderHousingCharts(profile)`

renderHousingCharts — render housing stock composition (chartStock) and
tenure mix (chartTenure) bar charts.
@param {object} profile - ACS DP04/DP05 profile

### `renderAffordChart(profile)`

renderAffordChart — render the housing affordability gap chart (chartAfford).
Shows income needed vs median HHI to afford the median rent at 30% rule.
@param {object} profile

### `renderRentBurdenBins(profile)`

renderRentBurdenBins — render cost-burden distribution by percent-of-income
bands for renters (chartRentBurdenBins).
@param {object} profile

### `renderModeShare(s0801)`

renderModeShare — render commute mode share chart (chartMode).
@param {object|null} s0801 - ACS S0801 commute table

### `renderLehd(lehd, geoType, geoid)`

renderLehd — render LEHD employment flow chart (chartLehd).
@param {object|null} lehd    - LEHD JSON data
@param {string}      geoType
@param {string}      geoid

### `renderDolaPyramid(dola)`

renderDolaPyramid — render age pyramid (chartPyramid) and senior
housing need chart (chartSenior) from DOLA SYA data.
@param {object|null} dola - DOLA SYA JSON object with age cohort data

### `renderLihtcLayer(data)`

renderLihtcLayer — render LIHTC project markers on the HNA map.
Creates a Leaflet layer with divIcon markers and popup detail panels.
Also registers all features in HNAState.allLihtcFeatures for viewport filtering.

@param {GeoJSON.FeatureCollection|null} data - LIHTC project feature collection

### `updateLihtcInfoPanel()`

updateLihtcInfoPanel — refresh the LIHTC info panel list to show only
projects currently visible within the map's viewport bounds.
Registered as a 'moveend' listener on the Leaflet map.

### `renderQctLayer(data)`

renderQctLayer — render Qualified Census Tract polygons as a GeoJSON layer.
@param {GeoJSON.FeatureCollection} data

### `renderDdaLayer(countyFips5, data)`

renderDdaLayer — render Difficult Development Area indicator for the county.
@param {string}      countyFips5 - 5-digit FIPS
@param {object|null} data        - DDA data (null = not a DDA county)

### `renderMethodology(opts)`

renderMethodology — populate the methodology accordion/section with
data-source citations, cache status, and overlay definitions.

@param {object} opts
@param {string} opts.geoType
@param {string} opts.geoid
@param {string} opts.geoLabel
@param {string} opts.usedCountyForContext
@param {object} opts.cacheFlags        - { summary, lehd, dola, projections, derived }
@param {object|null} opts.derivedEntry
@param {string[]|null} opts.derivedYears

### `renderLocalResources(geoType, geoid)`

renderLocalResources — render housing plans and key contacts panel
for the selected geography.
@param {string} geoType - 'county'|'place'|'cdp'|'state'
@param {string} geoid

### `getAssumptions()`

getAssumptions — read the current values of the projection assumption controls.
@returns {{ horizon: number, targetVac: number, headshipMode: string }}

### `renderScenarioDataQuality(geoType, geoid)`

renderScenarioDataQuality — update the scenarioDataQuality element to
indicate whether projection data is a direct county source or synthetic
(scaled from county to represent a place or CDP).

@param {string} geoType - 'county'|'place'|'cdp'|'state'
@param {string} geoid

### `clearProjectionsForStateLevel()`

clearProjectionsForStateLevel — reset projection stat cards for geographies
where county-level projection data is not applicable (e.g. full state view).
@returns {{ ok: boolean }}

### `renderProjectionChart(canvas, labels, datasets, opts)`

renderProjectionChart — draw a population projection line chart.
Called by external modules via window.__HNA_renderProjectionChart.

### `_renderScenarioSection(proj, popSel, years, baseYear, countyFips5, t)`

_renderScenarioSection — render scenario comparison charts.
@param {object} proj        - Projection data object
@param {number[]} popSel    - Selected geography population series
@param {string[]} years     - Year labels
@param {number}  baseYear   - Base year
@param {string}  countyFips5
@param {object}  t          - Chart theme

### `renderScenarioComparison(geoid, scenario_names, opts)`

renderScenarioComparison — draw a multi-scenario population comparison chart.

### `renderHouseholdDemand(geoid, scenario, affordability_tiers, opts)`

renderHouseholdDemand — draw a stacked bar chart of projected housing demand
broken out by affordability tier.
