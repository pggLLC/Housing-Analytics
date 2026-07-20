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

renderAffordChart — render the homeownership affordability chart
(chartAfford). Bar 1 = median household income for the selected
geography; Bar 2 = annual income required to afford the typical
owner-occupied home under a 30-yr fixed PITI mortgage at AFFORD.*
assumptions, computed by U().computeIncomeNeeded(homeValue).

Previously this computed rent-based affordability ((rent*12)/0.30)
while the surrounding HTML claimed "mortgage model" — fixed.

@param {object} profile

### `renderModeShare(s0801)`

renderModeShare — render commute mode share chart (chartMode).
@param {object|null} s0801 - ACS S0801 commute table

### `renderLehd(lehd, geoType, geoid)`

renderLehd — render LEHD employment flow chart (chartLehd).
@param {object|null} lehd    - LEHD JSON data
@param {string}      geoType
@param {string}      geoid

### `renderDolaPyramid(dola, placeCoh, ctx)`

renderDolaPyramid — render age pyramid (chartPyramid) and senior
housing need chart (chartSenior) from DOLA SYA + ACS B01001 data.

F185 — Accepts EITHER county DOLA data, EITHER place ACS cohorts, or
BOTH. When both are present (place geography selected), each chart
renders two side-by-side bar groups: the place from ACS B01001
5-year estimates + the containing county from DOLA SYA projections.

@param {object|null} dola      - DOLA SYA JSON (county/state) — null on place-only
@param {object|null} placeCoh  - ACS B01001 cohort response — null on county/state
@param {object|null} ctx       - F186: explicit { geoType, geoid, geoLabel, contextCounty }
                                 passed by the controller BEFORE state.current is updated.
                                 Without it, labels lagged one selection behind (e.g. user
                                 switched Acres Green → Fruita, chart still said Acres Green).
                                 Falls back to S().state.current for back-compat.

### `_rankRecencyCache`

/* F179 — LIHTC recency badge. Reads ranking-index.json (augmented
     with latest_lihtc_year / drought_years / recency_score / recency_
     basis by scripts/augment_ranking_index_recency.mjs) and renders a
     compact badge above the stat cards in the LIHTC panel. Cached so
     repeated render passes share one fetch. Safe to call before the
     ranking-index is loaded — the renderer just clears the slot until
     data arrives.

### `renderLihtcLayer(data, placeCtx)`

renderLihtcLayer — render LIHTC project markers on the HNA map.
Creates a Leaflet layer with divIcon markers and popup detail panels.
Also registers all features in HNAState.allLihtcFeatures for viewport filtering.

@param {GeoJSON.FeatureCollection|null} data - LIHTC project feature collection

### `updateLihtcInfoPanel()`

updateLihtcInfoPanel — refresh the affordable-housing info panel.

F126 — lists EVERY affordable property in the current map viewport,
not just the CHFA LIHTC records. Pulls from properties.json (shared
cache via AffordableHousingLayer) so HUD MF, USDA RD, PBV-local
(e.g. Silt Senior Housing), and CHFA preservation records all
appear in the same list with color-coded category badges + per-
category hover tooltips explaining what each program is.

Registered as a 'moveend' listener on the Leaflet map.

### `renderQctLayer(data)`

renderQctLayer — render Qualified Census Tract polygons as a GeoJSON layer.
@param {GeoJSON.FeatureCollection} data

### `renderDdaLayer(countyFips5, data, placeCtx)`

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

### `_renderMajorEmployersSection(jurisName, r)`

F133 — "Major employers & workforce-housing partners" section.

For each curated place we keep an array of headline employers
(5-8 typical), each with optional notes about their workforce-
housing program if they run one (Vail Resorts dorms, Aspen
Skiing Co housing, Aspen Valley Hospital staff units, etc.).
Each entry links directly to the employer's careers / housing
page; an "All top employers" search link is always appended.

For uncurated places, falls back to a single Google search
"largest employers in [jurisdiction], Colorado" — same durable-
search pattern used everywhere else in this panel.

Why this section exists separately from Community Institutions:
  1. Top employers determine the AMI mix you should be designing
     for (resort towns concentrate around 60-100% AMI service
     jobs; tech corridors stretch to 120%+).
  2. Many large employers have published workforce-housing
     programs that a developer can plug into — sometimes via
     master-lease, sometimes via direct-build partnership.
  3. Several major Colorado employers own surplus / developable
     land near their facilities.

### `_renderCommunityInstitutionsSection(jurisName, r)`

F131 — "Community institutions & faith-based partners" section.
Renders durable Google Maps + Google searches for the four most
frequently-useful local institutions in any Colorado town:

  - Churches in town. Faith-based partners often own developable
    parcels (parking lots, surplus lots, old rectories) and are
    active in housing ministries. Google Maps "Churches near X"
    is the most reliable way to surface them — denominations are
    so varied that no curated list scales.

  - School district serving the town. Districts increasingly run
    workforce-housing programs for teachers (Eagle County, Aspen,
    Summit, Telluride have famous ones); also a major employer
    informing AMI mix decisions.

  - Public library + community / rec centers. The buildings
    themselves are where housing town-halls happen and where
    organizers post flyers; the institutions sometimes co-fund
    affordable-housing programs.

Curated school-district data for known places (Roaring Fork + a
few others) renders as a direct link; everywhere else falls back
to a "find your district" search. All other links are searches —
curated content here would rot fast.

### `_deriveGovDomain(r)`

F95 — Derive the jurisdiction's official .gov domain from any URL
present in the local-resources record. Used to build site-scoped
agenda searches. Returns null when no usable URL is found.

Returns hostname like "denvergov.org" or "www.bouldercolorado.gov".

### `_renderAgendaSearchSection(jurisName, govDomain, r)`

F95 — "Housing on the agenda" section. Renders durable searches
across the jurisdiction's own website (for council/planning-commission
agendas + minutes) and across CO housing news (Coloradan, Colorado Sun,
Westword) for related coverage. The searches are scoped to the last
year by default so users see CURRENT items, not legacy filings.

Always rendered, even for jurisdictions without curated entries.

### `_renderTargetedAgendaSearchSection(jurisName, geoType)`

F162 — "Search city or county agendas for housing topics" section.

Distinct from _renderAgendaSearchSection above (which is the F95
generic-Google panel): this calls window.AgendaSearchLinks.build
for laser-targeted queries with quoted phrases, OR groups,
after:YYYY-MM-DD time bounds, tbs=qdr:m12 / m6 recency filters,
filetype:pdf for actual agenda PDFs, and BoCC / County Planning
Commission language for county geographies.

Rendered as a 2-column grid of pill-style buttons (visually
distinct from the bullet-list pattern used by the other sections)
so users can spot it as a separate, actionable tool.

### `_renderBoardsAndAdvocatesSection(jurisName, govDomain, r)`

F95 — "Boards & advocates" section. The curated `r.advocacy` list
already covers known orgs; this section adds search fallbacks for
jurisdiction-specific boards (Housing Advisory, Housing Authority
board) + local advocate orgs that aren't on file yet.

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

### `_lehdFor(geoid)`

Get the LEHD blob for a given geoid out of the controller's cache.
Returns null if the cache hasn't been populated yet (e.g. state-level
selection that didn't fetch a county file).

### `_placeholderInBox(canvas, message)`

Render an inline "no data" placeholder inside a chart container so
an empty canvas doesn't pretend to be a working chart. Used by the
stubs-now-implemented Labor Market + Economic Indicators panels.

### `_countyLabel(fips)`

Look up a Colorado county's display label from a 5-digit FIPS,
consulting the in-memory geography config first then the canonical
registry. Returns the geoid if neither config has a hit so callers
never paste raw FIPS into user-facing copy.

### `_renderCountyScopeNote(sectionId, geoType, countyFips, dataKind, opts)`

Inject (or update) a "county-scope" disclosure note inside a section
when the user has picked a place/cdp but the section's data only
exists at county granularity (LEHD, DOLA SYA, BLS QCEW). Hides
itself for county / state selections.

Two modes:
  - 'county' (default) — amber "County-level data" warning. Shown
    when the renderer is consuming the raw county blob.
  - 'place-apportioned' — green confirmation. Shown when a TIGER
    spatial-join place blob (e.g. place-LEHD from
    scripts/hna/build_place_lehd.py) replaced the county data.
    Optional `confidence` field surfaces the coverage_share
    bucket so the user can spot low-confidence apportionments.

Matches the visual pattern of chartChasGap's proxy note: colored
left-border, muted background, role="note" for screen-reader
announcement.

@param {string} sectionId  ID of the parent <section>.
@param {string} geoType    'state' | 'county' | 'place' | 'cdp'.
@param {string} countyFips Containing-county 5-digit FIPS.
@param {string} dataKind   Short label for the data source, e.g.
                           "LEHD employment data", "DOLA age pyramid".
@param {object} [opts]
@param {string} [opts.mode]       'county' | 'place-apportioned'
@param {string} [opts.confidence] 'high' | 'medium' | 'low'

### `renderDecadeAffordTrend(geoType, geoid, contextCounty)`

F199 — Decade affordability trend. Three ACS cohorts (2009 / 2014 / 2024)
× {median rent, median HHI, rent burden 30+} plus FHFA HPI relative to
the 15-year baseline (= 2009). Renders:
  1. Summary cards: rent change, income change, HPI change, burden change
  2. Side-by-side bar chart (2009 vs 2014 vs 2024) for rent + income
  3. Affordability ratio table: annual rent / annual income at each cohort
     → tells you whether housing got more or less affordable.

Falls back to "not available" for non-county geographies (we don't have
place-level historical ACS in the parquet) — placeholder with a link to
the data.census.gov tables so the user can pull it themselves.

### `renderHousingTypePace(geoType, geoid, contextCounty)`

F200 — Housing type pace (Census BPS annual permits).

Bar chart of annual permitted units for the active county over the
Census Building Permits Survey vintage range (2020-2024 in the current
parquet). Surfaces the relationship between permitting pace and the
jurisdiction's housing-gap need.

Caveat shown inline: Census BPS publishes total units only at the
county-by-year level — structure-type breakdown (1-unit / 2-4 / 5+) is
not exposed in the current parquet. To get structure breakdown you'd
need to ingest the raw BPS file (cf. https://www.census.gov/construction/bps/).
The summary table is the most accurate slice available now.

### `renderProp123BaselineAndFastTrack(profile, geoType, geoLabel)`

Populate the Prop 123 baseline / fast-track cards on HNA. The HTML
ships these with "Select a geography…" placeholders that never
cleared because no renderer touched them. With a profile in hand
we can derive a directional baseline (6% of housing stock) and
surface the fast-track eligibility check the utility already
computes (population threshold per HB 22-1093).

The baseline is intentionally a directional estimate — the
jurisdiction-specific number comes from CDOLA Prop 123
commitment filings. Labelled so the user knows it's an estimate.

### `renderGapCoverageStats(countyFips5, chasData, acsAmiData, selectedGeo, placeAmiData, profile)`

renderGapCoverageStats — populate the "Affordability Gap by AMI Tier"
panel with 7 cumulative AMI bands (30/40/50/60/70/80/100). Primary
source is the ACS-derived gap file (co_ami_gap_by_county.json), which
is the only feed with 7-band granularity. Falls back to a 4-band HUD
CHAS estimate when ACS is unavailable for a geography.

"Gap" semantics: the shortfall is computed PER BAND — within each AMI
band, households minus affordable units, clamped at zero (surplus supply
in one band can't backfill another). The cumulative row is the running
sum of those per-band shortfalls, so it is monotonic and the ≤100% AMI
figure is the total cumulative gap (not a sum across bands).

@param {string} countyFips5 - 5-digit county FIPS or null for statewide
@param {object|null} chasData - parsed chas_affordability_gap.json
@param {object|null} acsAmiData - parsed co_ami_gap_by_county.json

### `_setProvenanceBadge(state)`

Set the provenance badge next to the CHAS chart title to make the
methodology stamp glance-able. Three states:
  'tiger'         → green "TIGER 2024 place-level"
  'county'        → blue "County" (clean — user picked a county directly)
  'county-approx' → amber "County-approx" (user picked a place/cdp not in
                    TIGER coverage; chart shows containing county data)
  'none'          → hidden

### `renderBedroomNeed(b25009)`

F188 — Renter need by bedroom count.

Reads ACS B25009 renter HH counts by household size, translates each
size class to a needed bedroom count using the HUD "max 2 people per
bedroom" standard, and renders a horizontal bar chart of
needed-bedroom-count → renter HH count.

Translation rule (HUD min-bedroom guidance, max 2 ppl/BR):
  1-person HH → 50% studio, 50% 1BR  (singles split between the two)
  2-person HH → 1BR
  3-person HH → 2BR
  4-person HH → 2BR
  5-person HH → 3BR
  6-person HH → 3BR
  7+-person HH → 4BR+

Also writes the resulting shares to S().state.bedroomNeed so the
Market Analysis concept recommender can blend them with its
concept-type defaults instead of using the defaults alone (F188-b).

@param {object|null} b25009 - { renterTotal, renterBySize: {1..7+} } or null
