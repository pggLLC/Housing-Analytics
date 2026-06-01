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

### `renderLihtcLayer(data, placeCtx)`

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

### `_deriveGovDomain(r)`

F95 — Derive the jurisdiction's official .gov domain from any URL
present in the local-resources record. Used to build site-scoped
agenda searches. Returns null when no usable URL is found.

Returns hostname like "denvergov.org" or "www.bouldercolorado.gov".

### `_renderAgendaSearchSection(jurisName, govDomain)`

F95 — "Housing on the agenda" section. Renders durable searches
across the jurisdiction's own website (for council/planning-commission
agendas + minutes) and across CO housing news (Coloradan, Colorado Sun,
Westword) for related coverage. The searches are scoped to the last
year by default so users see CURRENT items, not legacy filings.

Always rendered, even for jurisdictions without curated entries.

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

    // County FIPS resolution — for state-level we want the statewide row;
    // for places/CDPs we use the containing county per existing behaviour.
    const countyFips = String(geoid).length === 5 ? geoid : (state.contextCounty || null);
    if (!countyFips) { container.style.display = 'none'; return; }
    const countyRec = (chasData.counties || {})[countyFips];
    if (!countyRec || !countyRec.summary) { container.style.display = 'none'; return; }

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
    container.innerHTML =
      '<h2 style="font-size:1.05rem;margin:0 0 .35rem">Housing Needs Scorecard <span style="font-weight:400;color:var(--muted);font-size:.78rem">— v2 methodology</span></h2>' +
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

      // Methodology disclosure
      '<details open style="margin-top:12px;border:1px solid var(--border);border-radius:8px;padding:0">' +
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
