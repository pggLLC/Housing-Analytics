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

### `renderHouseholdCompositionPanel(profile)`

renderRentBurdenBins — render cost-burden distribution by percent-of-income
bands for renters (chartRentBurdenBins).
@param {object} profile
/
  /* F169 — Render the Household-composition / occupation / labor-force
     section: hydrate the six headline stat cards, draw the household-type
     mix chart (chartHouseholdSize — kept as the canvas id for backwards
     compatibility), draw the occupation-mix chart (chartOccupationMix),
     and compute the retiree-vs-working-age not-in-labor-force breakdown
     that goes in the bottom callout.

     NOTE on the chart shape: the 2023 ACS DP02 profile does NOT publish
     1- through 7+-person household-size bins (older guides mislabel
     DP02_0034-0040E — those slots are marital/fertility in the current
     vintage). True household-size distribution lives in detail table
     B11016, which is on a different endpoint. So this panel shows
     household *type* (married couple / cohabiting / single parent /
     living alone / other) instead — that's also a more useful lens for
     housing-need framing (single-parent and living-alone households are
     the canonical 1- and 2-BR demand drivers).

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

F198 — Wages vs Housing Affordability panel.

Closes the loop between "what do workers earn here?" (LEHD wage tiers)
and "what does housing cost here?" (ACS median rent + median home value).
Renders:
  1. Three required-income rows: rent median, buy median, AMI-60% LIHTC
     Each shows: required annual, required hourly (FT 2080hr), what % of
     median household income that represents, and the share of workers
     earning enough (from LEHD wage tier distribution).
  2. Industry table: top 6 NAICS sectors × estimated mean wage from LEHD
     wage tier distribution within that sector (LEHD doesn't publish
     sector × tier directly at jurisdiction level — we use the same
     $7.5K / $27.5K / $60K midpoints as Wage Distribution and weight
     by the per-sector share of total jobs).

Methodology notes shown inline:
  • Rent affordability uses the 30% rule: required annual = monthly × 12 / 0.30.
  • Buy affordability reuses U().computeIncomeNeeded() which is already
    wired to the same constants the Income-to-Buy stat tile uses
    (20% down, 30y mortgage, prevailing rate, prop tax + insurance).
  • AMI-60% income limit comes from HUD income-limits cache for the
    containing county (4-person, the LIHTC reference unit size).

Data sources read:
  • profile.DP04_0089E (median home value)
  • profile.DP04_0134E (median gross rent)
  • profile.DP03_0062E (median household income, for context)
  • lehd.annualWages[year].{low, medium, high} via calculateWageDistribution
  • parseIndustries(lehd, 6) for top sectors
  • HUD income limits via _hudFmrFor(countyFips) if available
/
  // F243 — Downtown redevelopment panel for HNA pages. Mirrors OF detail
  // panel F236 but tuned for HNA's "is there a path to actually build
  // here?" framing. Surfaces URA presence (TIF + land write-down), OZ
  // overlap (capital-gains deferral), adaptive-reuse pattern menu (hotel-
  // to-housing, office-to-residential, parking-lot infill, underutilized
  // commercial), and acquisition + environmental cleanup tools.
  //
  // Lazy-fetches three reference files. Hides the panel on data failure.
  function _renderHnaRedevPanel(profile, countyFips5) {
    var panel = document.getElementById('hnaRedevPanel');
    if (!panel) return;
    // Normalize county FIPS to 5-digit
    var c5 = countyFips5 || '';
    if (c5 && c5.length === 3) c5 = '08' + c5;

    var jurisName = (profile && (profile.NAME || profile.name || profile.geoName)) || 'this jurisdiction';
    // F244 audit fix — county name was always falling back to "this county"
    // because profile doesn't carry countyName/_countyName. Resolve from
    // an inlined CO county FIPS map (64 entries, ~2KB) so we don't have
    // to fetch chas_affordability_gap.json just for one name lookup.
    var CO_COUNTY_NAMES = {
      '08001':'Adams','08003':'Alamosa','08005':'Arapahoe','08007':'Archuleta','08009':'Baca',
      '08011':'Bent','08013':'Boulder','08014':'Broomfield','08015':'Chaffee','08017':'Cheyenne',
      '08019':'Clear Creek','08021':'Conejos','08023':'Costilla','08025':'Crowley','08027':'Custer',
      '08029':'Delta','08031':'Denver','08033':'Dolores','08035':'Douglas','08037':'Eagle',
      '08039':'Elbert','08041':'El Paso','08043':'Fremont','08045':'Garfield','08047':'Gilpin',
      '08049':'Grand','08051':'Gunnison','08053':'Hinsdale','08055':'Huerfano','08057':'Jackson',
      '08059':'Jefferson','08061':'Kiowa','08063':'Kit Carson','08065':'Lake','08067':'La Plata',
      '08069':'Larimer','08071':'Las Animas','08073':'Lincoln','08075':'Logan','08077':'Mesa',
      '08079':'Mineral','08081':'Moffat','08083':'Montezuma','08085':'Montrose','08087':'Morgan',
      '08089':'Otero','08091':'Ouray','08093':'Park','08095':'Phillips','08097':'Pitkin',
      '08099':'Prowers','08101':'Pueblo','08103':'Rio Blanco','08105':'Rio Grande','08107':'Routt',
      '08109':'Saguache','08111':'San Juan','08113':'San Miguel','08115':'Sedgwick','08117':'Summit',
      '08119':'Teller','08121':'Washington','08123':'Weld','08125':'Yuma'
    };
    var countyName = (profile && (profile.countyName || profile._countyName)) ||
      (c5 && CO_COUNTY_NAMES[c5] ? CO_COUNTY_NAMES[c5] + ' County' : 'this county');

    // Normalize jurisdiction name for URA matching
    function normalizeJurisdName(s) {
      if (!s) return '';
      return String(s).toLowerCase()
        .replace(/^(city|town|city and county) of /, '')
        .replace(/,?\s+(co|colorado).*$/, '')
        .replace(/\s+(city|town|cdp)$/, '')
        .replace(/\s+/g, ' ').trim();
    }
    var target = normalizeJurisdName(jurisName);

    Promise.all([
      fetch('data/market/co-urban-renewal-authorities.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('data/market/co-adaptive-reuse-references.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      fetch('data/market/opportunity_zones_co.geojson').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (parts) {
      var uraData = parts[0], reuseData = parts[1], ozData = parts[2];
      if (!uraData && !reuseData && !ozData) {
        panel.hidden = true;
        return;
      }
      // Find URA match by jurisdiction name
      var ura = null;
      if (uraData && uraData.uras) {
        for (var i = 0; i < uraData.uras.length; i++) {
          var u = uraData.uras[i];
          if (normalizeJurisdName(u.jurisdiction) === target) { ura = u; break; }
        }
      }
      // Count OZ tracts in county
      var ozCount = 0;
      if (ozData && ozData.features && c5) {
        ozData.features.forEach(function (f) {
          var p = f && f.properties;
          if (p && p.county_fips === c5 && p.designated !== false) ozCount++;
        });
      }
      var patterns = (reuseData && reuseData.patterns) || {};
      var PATTERN_LABELS = {
        hotel_motel_to_residential: { icon: '🏨', label: 'Hotel / motel → residential' },
        office_to_residential:      { icon: '🏢', label: 'Office → residential' },
        surface_parking_infill:     { icon: '🅿️', label: 'Surface parking infill' },
        underutilized_commercial_parcel: { icon: '🏚️', label: 'Underutilized commercial parcel' }
      };

      var html = '<h2 style="font-size:1rem;">🏗️ Downtown redevelopment opportunities</h2>' +
        '<p style="color:var(--muted);font-size:.88rem;line-height:1.5;margin-bottom:14px;">' +
          'How could affordable housing get built here? Downtown infill — old hotels, vacant offices, ' +
          'surface parking lots, underutilized commercial — stacks 4-5 LIHTC cap-stack tools ' +
          '(basis boost · URA TIF · OZ deferral · Historic Tax Credit · brownfield grants) ' +
          'that greenfield sites can\'t access.' +
        '</p>';

      // 1. URA presence
      html += '<div style="margin:10px 0;padding:10px 12px;border-radius:6px;background:var(--bg2);">' +
        '<div style="font-weight:700;font-size:.95rem;margin-bottom:6px;">Urban Renewal Authority (URA)</div>';
      if (ura) {
        var tifText = ura.annual_tif_revenue_estimate_M
          ? '~$' + ura.annual_tif_revenue_estimate_M + 'M/yr TIF capacity'
          : 'TIF capacity not published';
        var plans = (ura.active_plans && ura.active_plans.length)
          ? ura.active_plans.slice(0, 4).join(' · ')
          : 'plan areas not published';
        html += '<div style="font-size:.85rem;line-height:1.55;">' +
          '<strong><a href="' + ura.url + '" target="_blank" rel="noopener" style="color:var(--accent);">' +
            ura.name + '</a></strong> — ' + tifText + '.<br>' +
          '<span style="color:var(--muted);"><strong>Active plan areas:</strong> ' + plans + '</span>';
        if (ura.lihtc_track_record) {
          html += '<div style="margin-top:6px;font-size:.82rem;color:var(--muted);font-style:italic;">' +
            '<strong style="font-style:normal;color:var(--text);">LIHTC track record:</strong> ' + ura.lihtc_track_record +
          '</div>';
        }
        html += '</div>';
      } else {
        html += '<div style="font-size:.85rem;color:var(--muted);line-height:1.55;">' +
          'No active URA on file for ' + jurisName + '. Smaller cities sometimes operate via a Downtown Development Authority (DDA) or county economic-development arm — worth confirming with the municipality directly. ' +
          '<a href="https://cdola.colorado.gov/funding-programs/urban-renewal" target="_blank" rel="noopener" style="color:var(--accent);">DOLA URA program ↗</a>' +
        '</div>';
      }
      html += '</div>';

      // 2. Opportunity Zone overlap
      html += '<div style="margin:10px 0;padding:10px 12px;border-radius:6px;background:var(--bg2);">' +
        '<div style="font-weight:700;font-size:.95rem;margin-bottom:6px;">Opportunity Zone overlap</div>';
      if (ozCount > 0) {
        html += '<div style="font-size:.85rem;line-height:1.55;">' +
          '<strong>' + ozCount + ' designated OZ tract' + (ozCount === 1 ? '' : 's') + '</strong> in ' +
          countyName + '. Property within these tracts qualifies for federal capital-gains deferral via Qualified Opportunity Fund equity — stacks with LIHTC + state credit.<br>' +
          '<a href="https://www.cdfifund.gov/opportunity-zones" target="_blank" rel="noopener" style="color:var(--accent);">HUD CDFI OZ map ↗</a>' +
        '</div>';
      } else {
        html += '<div style="font-size:.85rem;color:var(--muted);">' +
          'No Opportunity Zones designated in ' + countyName + '. OZ designations are permanent (2018 selections) — no path to add new ones.' +
        '</div>';
      }
      html += '</div>';

      // 3. Adaptive-reuse pattern menu (collapsed by default)
      html += '<details style="margin:10px 0;padding:10px 12px;border-radius:6px;background:var(--bg2);">' +
        '<summary style="cursor:pointer;font-weight:700;font-size:.95rem;">' +
          'Adaptive-reuse patterns to evaluate ' +
          '<span style="color:var(--muted);font-weight:400;font-size:.85rem;">(' +
            Object.keys(patterns).length + ' patterns · cost · timeline · CO examples)</span>' +
        '</summary>' +
        '<div style="margin-top:10px;display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:10px;">';
      Object.keys(patterns).forEach(function (key) {
        var p = patterns[key];
        var pmeta = PATTERN_LABELS[key] || { icon: '🏗️', label: key.replace(/_/g, ' ') };
        html += '<div style="padding:10px 12px;border:1px solid var(--border);border-radius:5px;font-size:.84rem;line-height:1.55;">' +
          '<div style="font-weight:700;margin-bottom:4px;">' + pmeta.icon + ' ' + pmeta.label + '</div>' +
          '<div style="color:var(--muted);">' +
            '<strong style="color:var(--text);">Cost:</strong> $' + (p.typical_cost_per_unit_K || '—') + 'K/unit · ' +
            '<strong style="color:var(--text);">Timeline:</strong> ' + (p.typical_timeline_months || '—') + ' months' +
          '</div>' +
          '<div style="margin-top:4px;color:var(--muted);">' + (p.what_it_is || '') + '</div>';
        if (p.colorado_examples && p.colorado_examples.length) {
          html += '<div style="margin-top:4px;color:var(--muted);font-size:.78rem;">' +
            '<strong style="color:var(--text);">CO examples:</strong> ' + p.colorado_examples.slice(0, 2).join(' · ') +
          '</div>';
        }
        html += '</div>';
      });
      html += '</div></details>';

      // 4. Tools
      html += '<div style="margin:10px 0;font-size:.82rem;color:var(--muted);">' +
        '<strong>Environmental + acquisition tools:</strong> ' +
        '<a href="https://www.epa.gov/brownfields" target="_blank" rel="noopener" style="color:var(--accent);">EPA Brownfields ↗</a> · ' +
        '<a href="https://cdphe.colorado.gov/voluntary-cleanup-program" target="_blank" rel="noopener" style="color:var(--accent);">CO Voluntary Cleanup ↗</a> · ' +
        '<a href="https://cdola.colorado.gov/brownfields-revolving-loan-fund" target="_blank" rel="noopener" style="color:var(--accent);">DOLA Brownfields RLF ↗</a> · ' +
        '<a href="https://www.nps.gov/subjects/taxincentives/index.htm" target="_blank" rel="noopener" style="color:var(--accent);">Federal Historic Tax Credit ↗</a>' +
      '</div>';
      html += '<p style="font-size:.74rem;color:var(--muted);font-style:italic;margin:6px 0 0;">' +
        'Source: DOLA URA registry; HUD CDFI Opportunity Zones (2018 designations); COHO adaptive-reuse reference (CHFA + Novogradac case studies). ' +
        'URA active plans + TIF capacity change frequently — confirm with the URA executive director before pitching.' +
      '</p>';

      panel.innerHTML = html;
      panel.hidden = false;
    }).catch(function () { panel.hidden = true; });
  }

  function renderWageAffordability(profile, lehd, countyFips5) {
    var panel = document.getElementById('wagesVsAffordPanel');
    if (!panel) return;
    var u = U();
    var fmtMoney = u.fmtMoney;
    var fmtNum = u.fmtNum;

    var medHomeVal = Number(profile && profile.DP04_0089E);
    var medRent    = Number(profile && profile.DP04_0134E);
    var medHHI     = Number(profile && profile.DP03_0062E);

    // ── Required incomes ──────────────────────────────────────────────
    // Rent: 30%-of-gross convention. Required annual = monthly × 40.
    var rentReqAnnual = Number.isFinite(medRent) && medRent > 0
      ? medRent * 12 / 0.30 : null;
    var rentReqHourly = rentReqAnnual ? rentReqAnnual / 2080 : null;

    // Buy: reuse the same computeIncomeNeeded the Income-to-Buy stat tile
    // uses so the numbers are consistent across the page.
    var buyRes = (typeof u.computeIncomeNeeded === 'function')
      ? u.computeIncomeNeeded(medHomeVal) : null;
    var buyReqAnnual = buyRes && Number.isFinite(buyRes.annualIncome)
      ? buyRes.annualIncome : null;
    var buyReqHourly = buyReqAnnual ? buyReqAnnual / 2080 : null;

    // AMI-60% LIHTC unit: required income to afford = 60% × HUD 4-person AMI
    // for the containing county. The CHFA §42 rent ceiling = 30% × that.
    // If HUD cache hasn't loaded for this geography, fall back to 60% of
    // median HHI as a conservative proxy with a "(approximated)" tag.
    var ami60Annual = null;
    var ami60IsApprox = false;
    try {
      // HudFmr is loaded by data-connectors/hud-fmr.js and exposed globally.
      // getIncomeLimitsByFips returns the per-county record with the AMI
      // 4-person value HUD publishes annually for the LIHTC reference unit.
      var il = (window.HudFmr && typeof window.HudFmr.getIncomeLimitsByFips === 'function')
        ? window.HudFmr.getIncomeLimitsByFips(countyFips5) : null;
      var ami4p = il && (il.ami_4person || il.ami_4 || il.ami || null);
      if (Number.isFinite(Number(ami4p)) && Number(ami4p) > 0) {
        ami60Annual = Number(ami4p) * 0.60;
      }
    } catch (_) { /* no-op */ }
    // F224 — Subscribe to HudFmr:loaded so we re-render when the data finally
    // arrives. Without this, a cold-load that hit the renderer before HudFmr
    // resolved would PERMANENTLY show the `medHHI × 0.60` approximation —
    // never recovering even after the real number was available 50ms later.
    if (!ami60Annual && window.HudFmr && typeof window.HudFmr.load === 'function') {
      // Trigger load (idempotent) + listen once for the resolve event.
      try { window.HudFmr.load(); } catch (_) {}
      var _reRender = function () {
        document.removeEventListener('HudFmr:loaded', _reRender);
        renderWageAffordability(profile, lehd, countyFips5);
      };
      document.addEventListener('HudFmr:loaded', _reRender, { once: true });
    }
    if (!ami60Annual && Number.isFinite(medHHI) && medHHI > 0) {
      ami60Annual = medHHI * 0.60;
      ami60IsApprox = true;
    }
    var ami60Hourly = ami60Annual ? ami60Annual / 2080 : null;

    // ── LEHD wage tier shares for "% workers earning enough" ──────────
    // LEHD WAC wage bins: CE01 ≤ $1,250/mo (~$15K/yr), CE02 $1,251-$3,333/mo
    // (~$15K-$40K/yr), CE03 > $3,333/mo (~$40K+). We approximate the share
    // of workers earning ≥ a target by checking which tier the target falls
    // into + adding the higher tiers in full.
    var dist = lehd && u.calculateWageDistribution
      ? u.calculateWageDistribution(lehd) : null;
    var totalJobs = dist ? (dist.low + dist.medium + dist.high) : 0;
    function _shareEarningAtLeast(annualTarget) {
      if (!dist || !totalJobs) return null;
      // < $15K → all three tiers cover the requirement
      if (annualTarget <= 15000) return 1.0;
      // $15K-$40K → medium + high cover it (rough — we don't know the
      // distribution within medium, so we assume midpoint $27.5K as the
      // medium tier's center; if target > $27.5K, only high covers).
      if (annualTarget < 27500) {
        return (dist.medium + dist.high) / totalJobs;
      }
      if (annualTarget < 40000) {
        // Partial credit within medium: linear from 100% of medium at
        // $15K target → 0% of medium at $40K target. Approximate as 1 -
        // ((target - 15K) / 25K).
        var partial = 1 - ((annualTarget - 15000) / 25000);
        return ((dist.medium * Math.max(0, partial)) + dist.high) / totalJobs;
      }
      // > $40K → only high tier earns enough. Above some reasonable
      // ceiling ($120K) we extrapolate that even high-tier shrinks; for
      // simplicity we treat anything above the threshold as "high" then
      // apply a linear haircut from $40K (100% of high) to $150K (10% of
      // high) since we have no data on the high-tier distribution.
      if (annualTarget < 150000) {
        var highPartial = 1 - ((annualTarget - 40000) / 110000) * 0.9;
        return (dist.high * Math.max(0.1, highPartial)) / totalJobs;
      }
      return (dist.high * 0.1) / totalJobs;
    }

    var rentShare = _shareEarningAtLeast(rentReqAnnual);
    var buyShare = _shareEarningAtLeast(buyReqAnnual);
    var amiShare = _shareEarningAtLeast(ami60Annual);

    // ── Render ────────────────────────────────────────────────────────
    function _row(label, baseAmt, reqAnnual, reqHourly, share, isApprox) {
      var reqAnnStr = reqAnnual ? fmtMoney(reqAnnual) : '—';
      var reqHrStr = reqHourly ? '$' + reqHourly.toFixed(2) + '/hr' : '—';
      var baseStr = baseAmt ? fmtMoney(baseAmt) : '—';
      var shareStr = (share != null) ? (share * 100).toFixed(0) + '%' : '—';
      var shareColor = (share == null) ? 'var(--muted)' :
        share >= 0.60 ? 'var(--good)' :
        share >= 0.30 ? 'var(--warn)' : 'var(--bad)';
      var hhiCmp = (Number.isFinite(medHHI) && medHHI > 0 && reqAnnual)
        ? (reqAnnual / medHHI * 100).toFixed(0) + '% of median HH income'
        : '';
      return '<tr>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);font-weight:600;">' + label + (isApprox ? ' <span style="font-size:.72rem;color:var(--muted);font-weight:400;">(approximated)</span>' : '') + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;">' + baseStr + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;font-weight:700;color:var(--text-strong);">' + reqAnnStr + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;color:var(--accent);font-weight:600;">' + reqHrStr + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;color:var(--muted);font-size:.85rem;">' + hhiCmp + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid var(--border);text-align:right;color:' + shareColor + ';font-weight:700;">' + shareStr + '</td>' +
      '</tr>';
    }

    var rowsHtml = '';
    rowsHtml += _row('Rent the median apartment',  medRent,    rentReqAnnual, rentReqHourly, rentShare, false);
    rowsHtml += _row('Buy the median home',        medHomeVal, buyReqAnnual,  buyReqHourly,  buyShare,  false);
    rowsHtml += _row('Afford an AMI-60% LIHTC unit', null,     ami60Annual,   ami60Hourly,   amiShare,  ami60IsApprox);

    // F231 — NLIHC Out of Reach county-level "housing wage" benchmark.
    // Loaded async; appended to the panel as a new section below the
    // main table when the fetch resolves. The "housing wage" is the
    // hourly wage a full-time renter needs to afford the HUD 2-BR FMR
    // without spending more than 30% of income on housing.
    var panel = document.getElementById('wagesVsAffordPanel');
    if (panel && countyFips5) {
      fetch('data/affordable-housing/nlihc-out-of-reach-co.json').then(function (r) {
        return r.ok ? r.json() : null;
      }).then(function (j) {
        if (!j || !j.by_county) return;
        var rec = j.by_county[countyFips5];
        var state = j.state_summary || {};
        if (!rec) {
          // Fall back to state aggregate
          rec = {
            county_name: 'Colorado (state aggregate)',
            two_br_housing_wage: state.two_br_housing_wage_2025,
            one_br_housing_wage: null,
            renter_median_wage: state.renter_median_hourly_wage_2025,
            gap_2br: state.affordability_gap_per_hour,
            notes: 'No county-specific value cached — using state aggregate.'
          };
        }
        var addendum = document.createElement('div');
        addendum.style.cssText = 'margin-top:14px;padding:.6rem .8rem;background:var(--accent-dim);border-left:3px solid var(--accent);border-radius:0 4px 4px 0;font-size:.85rem;line-height:1.5;';
        addendum.innerHTML =
          '<div style="font-weight:700;color:var(--accent);margin-bottom:.3rem;">🏠 NLIHC Out of Reach — ' + rec.county_name + ' housing wage</div>' +
          '<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(140px, 1fr));gap:.4rem .8rem;margin-bottom:.4rem;">' +
            '<div><span style="color:var(--muted);font-size:.78rem;">2-BR housing wage:</span><br><strong>$' + (rec.two_br_housing_wage || '—').toFixed(2) + '/hr</strong></div>' +
            (rec.one_br_housing_wage ? '<div><span style="color:var(--muted);font-size:.78rem;">1-BR housing wage:</span><br><strong>$' + rec.one_br_housing_wage.toFixed(2) + '/hr</strong></div>' : '') +
            '<div><span style="color:var(--muted);font-size:.78rem;">Median renter wage:</span><br><strong>$' + (rec.renter_median_wage || '—').toFixed(2) + '/hr</strong></div>' +
            '<div><span style="color:var(--muted);font-size:.78rem;">Affordability gap:</span><br><strong style="color:' + (rec.gap_2br > 20 ? 'var(--bad)' : rec.gap_2br > 12 ? 'var(--warn)' : 'var(--good)') + ';">$' + (rec.gap_2br || '—').toFixed(2) + '/hr</strong></div>' +
          '</div>' +
          '<p style="margin:.2rem 0 .3rem;color:var(--text);">' + (rec.notes || '') + '</p>' +
          '<p style="margin:.2rem 0 0;font-size:.72rem;color:var(--muted);">' +
            'Source: <a href="https://nlihc.org/oor" target="_blank" rel="noopener" style="color:var(--accent);">NLIHC Out of Reach ' + ((j.meta && j.meta.vintage) || '2025') + '</a> · ' +
            'The "housing wage" = (HUD 2-BR FMR × 12) ÷ (0.30 × 2,080 work hours/year). Hourly wage a full-time renter needs to afford 2-BR FMR without rent burden. ' +
            'Pulls a hard one-line answer to "why does this jurisdiction need affordable housing?" for IC memos.' +
          '</p>';
        panel.appendChild(addendum);
      }).catch(function () { /* silent */ });
    }

    // F243 — Render the downtown-redevelopment panel for this HNA jurisdiction.
    // Same data set as the OF detail panel (F236): URA presence, OZ overlap,
    // adaptive-reuse pattern menu. Lazy-fetches all three files in parallel
    // then renders. Non-blocking; hides on failure.
    _renderHnaRedevPanel(profile, countyFips5);

    var tableHtml = '<div style="overflow-x:auto;">' +
      '<table style="width:100%;border-collapse:collapse;font-size:.9rem;margin-top:8px;">' +
      '<thead><tr style="background:var(--bg2);">' +
        '<th style="padding:8px;text-align:left;font-weight:700;border-bottom:2px solid var(--border);">Housing target</th>' +
        '<th style="padding:8px;text-align:right;font-weight:700;border-bottom:2px solid var(--border);">Cost</th>' +
        '<th style="padding:8px;text-align:right;font-weight:700;border-bottom:2px solid var(--border);">Income needed</th>' +
        '<th style="padding:8px;text-align:right;font-weight:700;border-bottom:2px solid var(--border);">Hourly wage</th>' +
        '<th style="padding:8px;text-align:right;font-weight:700;border-bottom:2px solid var(--border);">vs. median HHI</th>' +
        '<th style="padding:8px;text-align:right;font-weight:700;border-bottom:2px solid var(--border);">Workers who qualify</th>' +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table></div>';

    // ── Methodology footer ────────────────────────────────────────────
    var notesHtml = '<details style="margin-top:12px;">' +
      '<summary style="cursor:pointer;font-size:.85rem;color:var(--muted);font-weight:600;">Methodology &amp; sources</summary>' +
      '<ul style="margin:8px 0 0;padding-left:20px;font-size:.82rem;color:var(--muted);line-height:1.55;">' +
        '<li><strong>30% rule:</strong> standard housing affordability convention — gross income × 30% = max housing payment. Required annual = monthly cost × 12 ÷ 0.30; hourly = annual ÷ 2,080 (40hr × 52wk).</li>' +
        '<li><strong>Buy assumptions:</strong> 20% down, 30-year mortgage at prevailing rate, property tax + insurance + (PMI if applicable). Same constants used by the Income Needed to Buy stat tile above.</li>' +
        '<li><strong>AMI-60% LIHTC:</strong> 60% × HUD 4-person Area Median Income for the containing county. Tax-credit units are restricted to ≤60% AMI tenants — this is the income they need.</li>' +
        '<li><strong>"Workers who qualify":</strong> share of local LEHD WAC jobs earning ≥ the required income. Computed from CE01 (≤ $15K), CE02 ($15K-$40K), CE03 ($40K+) tier counts with linear interpolation within tiers.</li>' +
        '<li><strong>Sources:</strong> ' +
          '<a href="https://data.census.gov/table/ACSDP5Y2024.DP04" target="_blank" rel="noopener" class="hna-source-link">ACS DP04</a> (rent + home value), ' +
          '<a href="https://data.census.gov/table/ACSDP5Y2024.DP03" target="_blank" rel="noopener" class="hna-source-link">ACS DP03</a> (median HHI), ' +
          '<a href="https://www.huduser.gov/portal/datasets/il.html" target="_blank" rel="noopener" class="hna-source-link">HUD Income Limits</a> (4-person AMI), ' +
          '<a href="https://lehd.ces.census.gov/data/lodes/LODES8/" target="_blank" rel="noopener" class="hna-source-link">LEHD LODES8 WAC</a> (wage tiers).</li>' +
      '</ul></details>';

    panel.innerHTML = tableHtml + notesHtml;
  }

  // ──────────────────────────────────────────────────────────────────
  // F199 + F200 — County-level historical trends (affordability + permits)
  // ──────────────────────────────────────────────────────────────────
  //
  // Both panels load from data/co-housing-costs/county-trends.json, a 51 KB
  // JSON built by scripts/build_county_trends_json.py from three parquet
  // files:
  //   • acs_county_latest.parquet — 3 ACS 5-yr cohorts (2009, 2014, 2024)
  //   • fhfa_hpi_county_raw.parquet — FHFA HPI annual index
  //   • permits_county.parquet — Census BPS annual permits 2020-2024
  //
  // Shared loader caches the parsed JSON; both renderers tolerate misses.
  var _countyTrendsCache = null;
  function _loadCountyTrends() {
    if (_countyTrendsCache !== null) return Promise.resolve(_countyTrendsCache);
    return fetch('data/co-housing-costs/county-trends.json')
      .then(function (r) { return r.json(); })
      .then(function (j) { _countyTrendsCache = j; return j; })
      .catch(function (e) {
        console.warn('[HNA] county-trends.json load failed', e);
        _countyTrendsCache = { counties: {} };
        return _countyTrendsCache;
      });
  }

  /**
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
stat cards in the Executive Snapshot (#hnaGapCoveragePanel). Primary
source is HUD CHAS cost-burdened renter HHs at each AMI tier; falls
back to ACS-derived gap (households at AMI band minus units priced
affordable at that band) when CHAS data looks corrupted for the
selected county. The CHAS Table 9 ETL is known to misread the
income-vs-burden axis on ~25 rural CO counties, producing implausibly
small "≤30% AMI total" rows or 0 cost-burden where burden should be
near-universal — the ACS fallback catches those cases.

@param {string} countyFips5 - 5-digit county FIPS or null for statewide
@param {object|null} chasData - pre-loaded chas_affordability_gap.json
@param {object|null} acsAmiData - pre-loaded co_ami_gap_by_county.json
/
  /**
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

Housing Needs Scorecard — v2 methodology.

Replaces the v1 thresholded 45/30/25 blend (which had arbitrary
weights, no owner cost burden, and distorted resort markets) with
a transparent **percentile-normalised 4-component composite**.
Each component contributes 0–25 points based on its statewide
percentile rank, so the composite is 0–100 = "Colorado housing-need
percentile":

  A. Tenure-Blended Cost Burden  (renter+owner CHAS cb30, weighted by HH counts)
  B. Deep Affordability Need     (≤30% AMI share of <100% renters)
  C. Affordability Pressure       (home price ÷ HHI — resort-aware)
  D. Worst-Case Need              (HUD-aligned: renter cb50 share)

Every threshold + weight is documented in the inline methodology
disclosure rendered alongside the cards.
/

  // Cached statewide distributions for percentile lookups. Built lazily on
  // first call and stamped with the CHAS file's generated timestamp so a
  // data refresh invalidates the cache automatically.
  var _scorecardDistCache = null;
  function _buildScorecardDistributions(chasData, econData) {
    const stamp =
      (chasData && chasData.meta && chasData.meta.generated) +
      '|' +
      (econData && econData.updated);
    if (_scorecardDistCache && _scorecardDistCache._stamp === stamp) {
      return _scorecardDistCache;
    }
    const dist = { blendedBurden: [], deepNeed: [], affordPressure: [], worstCaseShare: [], _stamp: stamp };
    if (!chasData || !chasData.counties) { _scorecardDistCache = dist; return dist; }

    Object.values(chasData.counties).forEach(rec => {
      const s = rec.summary || {};
      const byAmi = rec.renter_hh_by_ami || {};
      const renterHH = Number(s.total_renter_hh) || 0;
      const ownerHH  = Number(s.total_owner_hh)  || 0;
      const totalHH  = renterHH + ownerHH;
      // A — tenure-blended burden
      if (totalHH > 0 && s.pct_renter_cb30 != null && s.pct_owner_cb30 != null) {
        const blended = (Number(s.pct_renter_cb30) * renterHH + Number(s.pct_owner_cb30) * ownerHH) / totalHH;
        dist.blendedBurden.push(blended);
      }
      // B — deep-need share (lte30 of ≤100% AMI universe, dropping 100plus)
      const lte30Tot = (byAmi.lte30 && Number(byAmi.lte30.total)) || 0;
      const denom = ['lte30','31to50','51to80','81to100']
        .reduce((sum, k) => sum + ((byAmi[k] && Number(byAmi[k].total)) || 0), 0);
      if (denom > 0) dist.deepNeed.push(lte30Tot / denom);
      // D — worst-case need (HUD-aligned: severely-burdened renter share)
      if (renterHH > 0 && s.pct_renter_cb50 != null) {
        dist.worstCaseShare.push(Number(s.pct_renter_cb50));
      }
    });
    // C — affordability pressure (keyed by county name in econData)
    if (econData && econData.counties) {
      Object.values(econData.counties).forEach(c => {
        if (c && c.affordability_index != null) {
          dist.affordPressure.push(Number(c.affordability_index));
        }
      });
    }
    // Sort each distribution for percentile lookup
    ['blendedBurden','deepNeed','affordPressure','worstCaseShare'].forEach(k => {
      dist[k].sort((a, b) => a - b);
    });
    _scorecardDistCache = dist;
    return dist;
  }

  // Percentile rank of `value` within sortedArr (0..1, ties get 0.5
  // weight). Returns null if data unavailable.
  function _percentile(sortedArr, value) {
    if (!sortedArr || !sortedArr.length || value == null || !Number.isFinite(Number(value))) return null;
    const v = Number(value);
    let below = 0, equal = 0;
    for (let i = 0; i < sortedArr.length; i++) {
      if (sortedArr[i] < v) below++;
      else if (sortedArr[i] === v) equal++;
    }
    return (below + 0.5 * equal) / sortedArr.length;
  }

  function _scorecardCard(label, rawValueText, percentile, points, helperText) {
    // Severity tied to the component's contribution (0..25). The same
    // 4-band scheme used for the composite below.
    let sev = '';
    if (points >= 17.5) sev = 'var(--bad,#dc2626)';
    else if (points >= 12.5) sev = 'var(--warn,#d97706)';
    else if (points >= 7.5) sev = 'var(--accent,#1d4ed8)';
    else sev = 'var(--good,#16a34a)';

    const pctText = percentile != null
      ? 'CO p' + Math.round(percentile * 100) + ' · ' + Math.round(points) + '/25 pts'
      : 'No CO peer data';

    return '<div style="padding:.65rem;border:1px solid var(--border);border-radius:8px;background:var(--bg2);">' +
      '<div style="font-size:.74rem;color:var(--muted);font-weight:600">' + escHtml(label) + '</div>' +
      '<div style="font-size:1.3rem;font-weight:800;color:' + sev + ';font-variant-numeric:tabular-nums;line-height:1.1;margin-top:2px">' + escHtml(rawValueText) + '</div>' +
      '<div style="font-size:.7rem;color:var(--muted);margin-top:3px">' + escHtml(pctText) + '</div>' +
      (helperText ? '<div style="font-size:.66rem;color:var(--muted);margin-top:4px;line-height:1.35;font-style:italic">' + escHtml(helperText) + '</div>' : '') +
    '</div>';
  }

  function renderHnaScorecardPanel(geoid) {
    const container = document.getElementById('hnaScorecardPanel');
    if (!container) return;
    if (!geoid) { container.style.display = 'none'; return; }

    const state = S() && S().state;
    const chasData = state && state.chasData;
    const econData = state && state.blsEconData;
    const profile  = state && state.lastProfile;
    if (!chasData) { container.style.display = 'none'; return; }

    // County FIPS resolution — for state-level the statewide row applies;
    // for places/CDPs the containing county is used per existing behaviour.
    const countyFips = String(geoid).length === 5 ? geoid : (state.contextCounty || null);
    if (!countyFips) { container.style.display = 'none'; return; }
    const countyRec = (chasData.counties || {})[countyFips];
    if (!countyRec || !countyRec.summary) { container.style.display = 'none'; return; }
    // F254 (Codex Finding 14) — when a place/CDP is selected, the
    // scorecard transparently uses the containing county's CHAS +
    // economic indicators. Mirror this in state and surface it as a
    // visible "County proxy" provenance note further below.
    const isPlaceProxy = String(geoid).length !== 5;
    if (state) state._scorecard_source = isPlaceProxy ? 'county' : 'county_direct';

    const dist = _buildScorecardDistributions(chasData, econData);
    const s = countyRec.summary;
    const byAmi = countyRec.renter_hh_by_ami || {};
    const countyName = countyRec.name || '';

    // ── Component A — Tenure-Blended Cost Burden ────────────────────
    const renterHH = Number(s.total_renter_hh) || 0;
    const ownerHH  = Number(s.total_owner_hh)  || 0;
    const totalHH  = renterHH + ownerHH;
    const renterCb30 = s.pct_renter_cb30 != null ? Number(s.pct_renter_cb30) : null;
    const ownerCb30  = s.pct_owner_cb30  != null ? Number(s.pct_owner_cb30)  : null;
    const blendedBurden = (totalHH > 0 && renterCb30 != null && ownerCb30 != null)
      ? (renterCb30 * renterHH + ownerCb30 * ownerHH) / totalHH
      : null;

    // ── Component B — Deep Affordability Need ───────────────────────
    const lte30Tot = (byAmi.lte30 && Number(byAmi.lte30.total)) || 0;
    const denomB = ['lte30','31to50','51to80','81to100']
      .reduce((sum, k) => sum + ((byAmi[k] && Number(byAmi[k].total)) || 0), 0);
    const deepNeed = denomB > 0 ? lte30Tot / denomB : null;

    // ── Component C — Affordability Pressure (resort-aware) ─────────
    // co-county-economic-indicators.json is keyed by county NAME (no FIPS).
    let affordPressure = null;
    if (econData && econData.counties) {
      const rec = econData.counties[countyName] ||
                  econData.counties[countyName.replace(/\s+County$/i, '')] ||
                  econData.counties[countyName + ' County'];
      if (rec && rec.affordability_index != null) {
        affordPressure = Number(rec.affordability_index);
      }
    }

    // ── Component D — Worst-Case Need (HUD-aligned) ─────────────────
    const worstCase = s.pct_renter_cb50 != null ? Number(s.pct_renter_cb50) : null;

    // ── Percentile ranks within Colorado ────────────────────────────
    const pctA = _percentile(dist.blendedBurden,   blendedBurden);
    const pctB = _percentile(dist.deepNeed,         deepNeed);
    const pctC = _percentile(dist.affordPressure,  affordPressure);
    const pctD = _percentile(dist.worstCaseShare,  worstCase);

    // Each component contributes 0–25 points by percentile rank.
    const scoreA = pctA != null ? pctA * 25 : 0;
    const scoreB = pctB != null ? pctB * 25 : 0;
    const scoreC = pctC != null ? pctC * 25 : 0;
    const scoreD = pctD != null ? pctD * 25 : 0;
    const composite = Math.round(scoreA + scoreB + scoreC + scoreD);
    const nMissing = [pctA, pctB, pctC, pctD].filter(p => p == null).length;

    // Composite severity bands (peer-normalised, percentile-style)
    let compSev, compLabel;
    if (composite >= 70)      { compSev = 'var(--bad,#dc2626)';  compLabel = 'Highest need'; }
    else if (composite >= 50) { compSev = 'var(--warn,#d97706)'; compLabel = 'Elevated';     }
    else if (composite >= 30) { compSev = 'var(--accent,#1d4ed8)'; compLabel = 'Moderate';   }
    else                       { compSev = 'var(--good,#16a34a)'; compLabel = 'Lower';       }

    // Format helpers
    const pctStr = (v, digits) => v != null && Number.isFinite(v) ? (v * 100).toFixed(digits != null ? digits : 1) + '%' : '—';
    const numStr = (v, digits) => v != null && Number.isFinite(v) ? Number(v).toFixed(digits != null ? digits : 1) : '—';

    container.style.display = 'block';
    // F254 (Codex Finding 14) — county-proxy provenance badge. Visible
    // whenever a place/CDP is selected since the scorecard pulls CHAS
    // and economic indicators at the county level for that geography.
    const proxyBadgeHtml = isPlaceProxy
      ? '<div role="note" style="margin:0 0 .55rem;padding:.45rem .6rem;border:1px solid var(--border);border-radius:6px;background:var(--bg2);font-size:.74rem;line-height:1.5;color:var(--text)">' +
          '<strong>County proxy:</strong> this scorecard uses ' + escHtml(countyName || 'the containing county') +
          ' county-level CHAS and economic indicators because this panel is not yet available at place geography.' +
        '</div>'
      : '';
    container.innerHTML =
      '<h2 style="font-size:1.05rem;margin:0 0 .35rem">Housing Needs Scorecard <span style="font-weight:400;color:var(--muted);font-size:.78rem">— v2 methodology</span></h2>' +
      proxyBadgeHtml +
      '<p style="font-size:.78rem;color:var(--muted);margin:0 0 .75rem">' +
        'Each county is scored against the rest of Colorado on four signals. Composite is 0–100 = ' +
        '<strong>where this county sits in CO\'s distribution</strong> (100 = top of every measure). ' +
        'Includes both renter and owner cost burden, and surfaces resort-area pressure honestly via percentile rank.' +
      '</p>' +

      // Composite headline
      '<div style="display:flex;align-items:center;gap:14px;padding:10px 14px;margin-bottom:10px;border:1px solid var(--border);border-radius:10px;background:color-mix(in oklab,var(--card) 92%,var(--bg2) 8%);">' +
        '<div style="flex:0 0 auto"><div style="font-size:.72rem;color:var(--muted);font-weight:600">Overall need</div>' +
          '<div style="font-size:1.9rem;font-weight:900;color:' + compSev + ';font-variant-numeric:tabular-nums;line-height:1">' + composite + '<span style="font-size:1rem;font-weight:700;color:var(--muted)">/100</span></div></div>' +
        '<div style="flex:1 1 auto"><div style="font-size:.9rem;font-weight:700;color:' + compSev + '">' + compLabel + '</div>' +
          '<div style="font-size:.74rem;color:var(--muted);margin-top:2px">' +
            'Percentile rank across 4 components vs. all 64 CO counties' +
            (nMissing > 0 ? ' · ' + nMissing + ' of 4 components unavailable for this geography' : '') +
          '</div></div>' +
      '</div>' +

      // 4 component cards
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.6rem;">' +
        _scorecardCard(
          'A · Cost burden (blended)',
          pctStr(blendedBurden),
          pctA, scoreA,
          (renterCb30 != null ? 'Renter ' + pctStr(renterCb30) : '—') +
          ' · ' +
          (ownerCb30 != null ? 'Owner ' + pctStr(ownerCb30) : '—') +
          ' (weighted by HH counts)'
        ) +
        _scorecardCard(
          'B · Deep-need share',
          pctStr(deepNeed),
          pctB, scoreB,
          'Renters at ≤30% AMI as share of all ≤100% AMI renters'
        ) +
        _scorecardCard(
          'C · Affordability pressure',
          numStr(affordPressure) + 'x',
          pctC, scoreC,
          'Median home price ÷ median household income · resort-aware'
        ) +
        _scorecardCard(
          'D · Worst-case need',
          pctStr(worstCase),
          pctD, scoreD,
          'Renters severely burdened (>50% income on housing) — HUD WCN signal'
        ) +
      '</div>' +

      // F207c — CHAS reliability strip. Async-populated by the
      // RentBurdenReliability module: shows a confidence badge plus the
      // primary divergence vs same-vintage ACS 5-yr (definitional) and
      // newer ACS 1-yr (freshness). Stays hidden until the lookup
      // resolves so we don't flash an unhelpful "insufficient" badge.
      '<div data-hna-reliability-strip="' + escHtml(geoid || countyFips) +
      '" style="display:none;margin-top:.55rem;padding:.5rem .75rem;border:1px solid var(--border);border-radius:8px;background:var(--bg2);font-size:.78rem;line-height:1.45"></div>' +

      // F184 — Methodology disclosure default-collapsed per site-wide policy.
      '<details style="margin-top:12px;border:1px solid var(--border);border-radius:8px;padding:0">' +
        '<summary style="cursor:pointer;font-weight:700;padding:.55rem .75rem;font-size:.85rem">How is this calculated?</summary>' +
        '<div style="padding:.5rem .85rem .75rem;font-size:.8rem;line-height:1.55;color:var(--text)">' +
          '<p style="margin:.25rem 0"><strong>Four components, each scored 0–25 by percentile rank within Colorado.</strong> Higher percentile = closer to CO\'s most-need-acute counties. Composite = sum of the four scores (0–100).</p>' +
          '<ul style="margin:.4rem 0 .5rem;padding-left:18px">' +
            '<li><strong>A · Cost burden (blended).</strong> <code>(renter_cb30 × renter_HH + owner_cb30 × owner_HH) ÷ total_HH</code>. Single % reflecting ALL households\' cost burden, weighted by tenure mix. <em>Why blend?</em> Pure renter burden misses owner-heavy markets; this version doesn\'t. Source: <a href="https://www.huduser.gov/portal/datasets/cp.html" target="_blank" rel="noopener" class="hna-source-link">HUD CHAS 2018-2022</a> Table 7.</li>' +
            '<li><strong>B · Deep-need share.</strong> <code>renters_at_≤30%_AMI ÷ renters_at_≤100%_AMI</code>. Drops the 100+ tier (high-income cohort) from the denominator so the signal isn\'t diluted by wealthy renters. Source: <a href="https://www.huduser.gov/portal/datasets/cp.html" target="_blank" rel="noopener" class="hna-source-link">HUD CHAS</a> Table 9.</li>' +
            '<li><strong>C · Affordability pressure.</strong> <code>median_home_price ÷ median_household_income</code>. Resort and high-cost markets (Pitkin 11.1x, Summit 8.6x) score high — appropriately — because they ARE expensive relative to local incomes. This is the lever percentile-normalisation pulls so resort distress surfaces without dwarfing urban distress. Source: <a href="https://data.census.gov/" target="_blank" rel="noopener" class="hna-source-link">ACS B19013 + B25077</a>.</li>' +
            '<li><strong>D · Worst-case need.</strong> Share of renters paying &gt;50% of income on housing — directly maps to <a href="https://www.huduser.gov/portal/publications/affhsg/wc_HsgNeeds25.html" target="_blank" rel="noopener" class="hna-source-link">HUD\'s Worst Case Housing Needs</a> framework. Source: HUD CHAS Table 7 (renter_cb50 share).</li>' +
          '</ul>' +
          '<p style="margin:.4rem 0 .25rem"><strong>Severity bands:</strong> Highest need ≥70 · Elevated ≥50 · Moderate ≥30 · Lower &lt;30. Each card color matches its 0–25 contribution.</p>' +
          '<p style="margin:.25rem 0;color:var(--muted);font-size:.74rem"><strong>What this is NOT:</strong> a state-of-the-art econometric model. It\'s a transparent screening composite designed for early-stage LIHTC/HNA work. The four components are documented above; cross-check with primary HUD CHAS and Census ACS data before citing in formal needs assessments.</p>' +
        '</div>' +
      '</details>';

    // F207c — populate the CHAS reliability strip asynchronously. Honours
    // the spec QA-FIX rules: definitional vs freshness are reported as
    // separate signals; ACS 5-year is never labeled "newer than CHAS".
    // The strip stays hidden when the lookup returns 'chas_only' so we
    // don't flash an unhelpful slate badge before the precompute pipeline
    // (F207b) has shipped data.
    _populateHnaReliability(geoid || countyFips, container);
  }

  function _populateHnaReliability(geoid, container) {
    if (!window.RentBurdenReliability || !geoid || !container) return;
    var strip = container.querySelector('[data-hna-reliability-strip="' + geoid + '"]');
    if (!strip) return;
    var geoType = String(geoid).length === 5 ? 'county' : 'place';
    window.RentBurdenReliability.computeReliability({
      geoid: geoid,
      geoType: geoType,
      metric: 'renter_cb30',
    }).then(function (rel) {
      if (!rel || !strip.isConnected) return;
      // Hide the strip when we have nothing useful to say — i.e. the
      // crosscheck data file hasn't shipped yet (F207b precompute pending).
      // This avoids flashing "CHAS baseline only" badges before they
      // become informative.
      if (rel.data_source === 'chas_only') {
        strip.style.display = 'none';
        return;
      }
      var badge = window.RentBurdenReliability.confidenceBadge(rel, { compact: false });
      var notes = (rel.notes || []).slice(0, 2).join(' ');
      strip.style.display = 'flex';
      strip.style.alignItems = 'flex-start';
      strip.style.gap = '.6rem';
      strip.style.flexWrap = 'wrap';
      strip.innerHTML =
        '<div style="flex:0 0 auto">' + badge + '</div>' +
        '<div style="flex:1 1 240px;color:var(--text)">' +
          '<strong style="font-size:.78rem">CHAS reliability check:</strong> ' +
          escHtml(notes || 'CHAS 2018–2022 baseline, cross-checked against ACS B25070.') +
        '</div>';
    }).catch(function () {
      strip.style.display = 'none';
    });
  }

  // ---------------------------------------------------------------------------
  // renderChasAffordabilityGap — retained from prior implementation
  // Renders a stacked bar chart of renter cost burden by AMI tier
  // from HUD CHAS data for the selected county.
  //
  // HUD CHAS is published at county granularity. When the user selected a
  // place or CDP, this chart shows their CONTAINING county's CHAS data —
  // not place-level. The optional `selectedGeo` argument lets callers
  // pass the user's actual selection so the renderer can surface a
  // prominent "scaled from county" disclosure inline above the chart.
  // Without this disclosure, a place/CDP user sees county data labeled
  // with the county name and may not realize the proxy is happening.
  //
  // @param {string} countyFips5 - 5-digit county FIPS to look up
  // @param {object|null} chasData - pre-loaded chas_affordability_gap.json
  // @param {{type:string, geoid:string, name:string}} [selectedGeo] -
  //   User's selected geography. If type is 'place' or 'cdp' and the
  //   geoid differs from countyFips5, an inline proxy disclosure renders.
  // ---------------------------------------------------------------------------

  // F28-2: lazily-loaded context for the income-band "resort distortion" note.
  //   _amiCtx.place[geoid]  → { ami_4person, place_name }  (county AMI applied)
  //   _amiCtx.median[geoid] → place median household income
  // Both files are small + cached after first load; the note enriches
  // asynchronously and is a no-op if either fetch fails.
  let _amiCtxCache = null;
  function _loadAmiCtx() {
    if (_amiCtxCache) return _amiCtxCache;
    _amiCtxCache = Promise.all([
      fetch('data/co_ami_gap_by_place.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('data/hna/ranking-index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([gap, rank]) => {
      const place = (gap && gap.places) || {};
      const median = {};
      if (rank) {
        const rows = Array.isArray(rank.rankings) ? rank.rankings : Object.values(rank.rankings || {});
        rows.forEach((r) => {
          const m = r && r.metrics && r.metrics.median_hh_income;
          if (r && r.geoid && m) median[r.geoid] = m;
        });
      }
      return { place, median };
    });
    return _amiCtxCache;
  }

  function _appendAmiContextNote(noteEl, geoid, placeLabel) {
    _loadAmiCtx().then((ctx) => {
      if (!ctx || !noteEl || !noteEl.isConnected) return;
      const rec = ctx.place[geoid];
      const ami = rec && rec.ami_4person;
      const median = ctx.median[geoid];
      if (!ami) return;
      // Guard against duplicate appends: renderChasAffordabilityGap can fire
      // twice (extended-analysis pre-pass + CHAS-loaded pass), and both kick
      // off this async enrichment. Remove any prior instance first.
      const prior = noteEl.querySelector('.f28-ami-ctx');
      if (prior) prior.remove();
      const line = document.createElement('div');
      line.className = 'f28-ami-ctx';
      line.style.cssText = 'margin-top:.35rem;font-size:.74rem;color:var(--muted);';
      let txt = 'Income-band gaps are measured against the county’s HUD 4-person AMI of $' +
        Math.round(ami).toLocaleString() + ' (HUD publishes AMI only at county level). ';
      // Resort-distortion flag: when local median is well below the county AMI
      // ceiling, the band counts overstate local-wage need even though they're
      // LIHTC-correct (a deal here uses the county AMI).
      if (median) {
        txt += placeLabel + '’s median household income is $' + Math.round(median).toLocaleString() + '. ';
        if (median < 0.9 * ami) {
          txt += 'Because local median sits well below the county AMI (typical in resort-adjacent ' +
                 'counties), the gap reflects the regional AMI ceiling and reads needier than local ' +
                 'wages alone would imply — correct for LIHTC eligibility, but worth this context.';
        }
      }
      line.textContent = txt;
      noteEl.appendChild(line);
    }).catch(() => { /* non-fatal */ });
  }

  function renderChasAffordabilityGap(countyFips5, chasData, selectedGeo) {
    const canvas = document.getElementById('chartChasGap');
    const statusEl = document.getElementById('chasGapStatus');
    if (!canvas) return;

    // ── TIGER place-level CHAS path (PR-C3) ────────────────────────────
    // When the user selected a place/cdp AND the TIGER spatial-join data
    // is loaded for that geoid, prefer the place-level CHAS over the
    // county fallback. The TIGER computation aggregates underlying tracts
    // weighted by area, so cross-county jurisdictions (Aurora, Erie,
    // Longmont) get accurate place-level rates instead of inheriting
    // their primary county's average.
    const _tigerPlaceTiers = () => {
      if (!selectedGeo || (selectedGeo.type !== 'place' && selectedGeo.type !== 'cdp')) return null;
      if (!window.PlaceChas || typeof window.PlaceChas.lookup !== 'function') return null;
      const place = window.PlaceChas.lookup(selectedGeo.geoid);
      if (!place || !place.renter_hh_by_ami) return null;
      const tierOrder = ['lte30', '31to50', '51to80', '81to100', '100plus'];
      const tierLabels = {
        lte30:    '≤30% AMI',
        '31to50': '31–50% AMI',
        '51to80': '51–80% AMI',
        '81to100':'81–100% AMI',
        '100plus':'>100% AMI',
      };
      return tierOrder.map((key) => {
        const td = place.renter_hh_by_ami[key] || {};
        // burden_30_50 = moderate cost burden (cb30 - cb50)
        // burden_50plus = severe cost burden (cb50)
        const cb30 = td.cost_burdened_30pct || 0;
        const cb50 = td.cost_burdened_50pct || 0;
        return {
          ami_tier: tierLabels[key],
          tier: key,
          burden_30_50: Math.max(0, cb30 - cb50),
          burden_50plus: cb50,
        };
      });
    };

    // Render or clear the proxy-disclosure note above the chart.
    // PR-C3: when the chart is being driven by TIGER place-CHAS, render
    // a green "TIGER 2024 place-level" attribution instead of the
    // amber "scaled from county" warning.
    const _renderProxyNote = (countyName, isTigerPlace) => {
      let noteEl = document.getElementById('chartChasGapProxyNote');
      if (isTigerPlace) {
        if (!noteEl) {
          noteEl = document.createElement('div');
          noteEl.id = 'chartChasGapProxyNote';
          noteEl.setAttribute('role', 'note');
          const wrap = canvas.closest('.chart-card') || canvas.parentElement;
          if (wrap) wrap.insertBefore(noteEl, wrap.firstChild.nextSibling);
        }
        noteEl.style.cssText =
          'margin:0 0 .5rem;padding:.5rem .75rem;border-left:3px solid var(--good,#16a34a);' +
          'border-radius:0 4px 4px 0;background:rgba(34,197,94,.08);font-size:.78rem;' +
          'line-height:1.45;color:var(--text);';
        const placeLabel = (selectedGeo && selectedGeo.name) || 'this place';
        noteEl.textContent = '';
        const intro = document.createElement('strong');
        intro.style.color = 'var(--good,#16a34a)';
        intro.textContent = '✓ Place-level CHAS (TIGER 2024).';
        noteEl.appendChild(intro);
        noteEl.appendChild(document.createTextNode(
          // F28: was "area-weighted" — now population-weighted so small towns
          // in large rural tracts aren't collapsed (New Castle was 24 HH).
          ' Computed by population-weighted apportionment of the census tracts inside ' + placeLabel + '. '
          + 'Accurate even for jurisdictions that span county lines (Aurora, Erie, etc.) '
          + 'where the primary-county fallback would mis-state burden rates.'
        ));
        // F28-3: small-sample (wide ACS margin-of-error) flag for tiny places.
        try {
          const _pc = (window.PlaceChas && window.PlaceChas.lookup) ? window.PlaceChas.lookup(selectedGeo.geoid) : null;
          const _hh = _pc && _pc.summary ? (_pc.summary.total_renter_hh + _pc.summary.total_owner_hh) : null;
          if (_hh != null && _hh < 1000) {
            const moe = document.createElement('div');
            moe.style.cssText = 'margin-top:.35rem;font-size:.74rem;color:var(--muted);';
            moe.textContent = '⚠ Small sample (~' + Math.round(_hh).toLocaleString() +
              ' households): 5-year ACS estimates for places this size carry wide margins of error — read tiers as directional, not precise.';
            noteEl.appendChild(moe);
          }
        } catch (_) { /* non-fatal */ }
        // F28-2: place-median-vs-county-AMI context (resort-distortion flag).
        try { _appendAmiContextNote(noteEl, selectedGeo.geoid, placeLabel); } catch (_) { /* non-fatal */ }
        return;
      }
      const isProxy = selectedGeo &&
        (selectedGeo.type === 'place' || selectedGeo.type === 'cdp') &&
        selectedGeo.geoid && selectedGeo.geoid !== countyFips5 &&
        countyFips5;
      if (!isProxy) {
        if (noteEl) noteEl.remove();
        return;
      }
      if (!noteEl) {
        noteEl = document.createElement('div');
        noteEl.id = 'chartChasGapProxyNote';
        noteEl.setAttribute('role', 'note');
        noteEl.style.cssText =
          'margin:0 0 .5rem;padding:.5rem .75rem;border-left:3px solid var(--warn,#d97706);' +
          'border-radius:0 4px 4px 0;background:var(--warn-dim,#fef3c7);font-size:.78rem;' +
          'line-height:1.45;color:var(--text);';
        const wrap = canvas.closest('.chart-card') || canvas.parentElement;
        if (wrap) wrap.insertBefore(noteEl, wrap.firstChild.nextSibling);
      }
      const placeLabel = selectedGeo.name || 'this place';
      const intro = document.createElement('strong');
      intro.style.color = 'var(--warn,#d97706)';
      intro.textContent = '\u26a0 Scaled from county data.';
      const body = document.createTextNode(
        'HUD CHAS publishes cost-burden tables at county granularity only. You selected '
      );
      const placeStrong = document.createElement('strong');
      placeStrong.textContent = placeLabel;
      const middleText = document.createTextNode('; the chart below shows ');
      const countyStrong = document.createElement('strong');
      countyStrong.textContent = countyName;
      const endText = document.createTextNode(
        '\u2019s tier breakdown \u2014 your selected place\u2019s actual mix may differ. ' +
        'Use this for directional context, not as a place-level estimate.'
      );
      noteEl.textContent = '';
      noteEl.appendChild(intro);
      noteEl.appendChild(document.createTextNode(' '));
      noteEl.appendChild(body);
      noteEl.appendChild(placeStrong);
      noteEl.appendChild(middleText);
      noteEl.appendChild(countyStrong);
      noteEl.appendChild(endText);
    };

    // PR-C3: try TIGER place-level CHAS first
    const tigerTiers = _tigerPlaceTiers();
    if (tigerTiers && tigerTiers.length) {
      _renderProxyNote(null, /* isTigerPlace */ true);
      _setProvenanceBadge('tiger');
      _renderTiers(tigerTiers, /* sourceLabel */ (selectedGeo && selectedGeo.name) || 'place', /* tigerSource */ true);
      return;
    }

    if (!chasData) {
      if (statusEl) statusEl.textContent = 'CHAS affordability data not available.';
      _renderProxyNote('');
      _setProvenanceBadge('none');
      return;
    }

    const _chasIndex = (chasData && chasData.counties) || chasData;
    const county = _chasIndex[countyFips5] || _chasIndex['statewide'] || null;
    if (!county) {
      if (statusEl) statusEl.textContent = `No CHAS data for FIPS ${countyFips5}.`;
      _setProvenanceBadge('none');
      return;
    }

    _renderProxyNote(county.name || countyFips5);
    // Distinguish "user picked a county directly" (clean) from "user picked
    // a place/cdp but TIGER didn't have it, so we're showing county fallback"
    // (less clean — flag with amber badge).
    const isPlaceProxy = selectedGeo &&
      (selectedGeo.type === 'place' || selectedGeo.type === 'cdp') &&
      selectedGeo.geoid && selectedGeo.geoid !== countyFips5 && countyFips5;
    _setProvenanceBadge(isPlaceProxy ? 'county-approx' : 'county');
    // Adapter: 2026 CHAS data ships renter_hh_by_ami keyed by AMI bucket;
    // legacy `tiers` array is no longer emitted. Derive it on the fly so
    // the existing chart code keeps working.
    let tiers = county.tiers;
    if ((!tiers || !tiers.length) && county.renter_hh_by_ami) {
      const TIER_ORDER = ['lte30','31to50','51to80','81to100','100plus'];
      const TIER_LABEL = {
        lte30:    '≤30% AMI',
        '31to50': '31–50% AMI',
        '51to80': '51–80% AMI',
        '81to100':'81–100% AMI',
        '100plus':'>100% AMI',
      };
      tiers = TIER_ORDER
        .map(k => {
          const row = county.renter_hh_by_ami[k];
          if (!row) return null;
          const p30 = (row.pct_cost_burdened_30 || 0) * 100;
          const p50 = (row.pct_cost_burdened_50 || 0) * 100;
          return {
            ami_tier:     TIER_LABEL[k] || k,
            burden_30_50: Math.max(0, p30 - p50),
            burden_50plus: p50,
          };
        })
        .filter(Boolean);
    }
    _renderTiers(tiers || [], county.name || countyFips5, /* tigerSource */ false);
  }

  /**
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
