/**
 * js/market-analysis/market-analysis-controller.js
 * Orchestration layer for the market analysis report page.
 * Exposes window.MAController.
 *
 * Dependencies (all resolved lazily at call-time; absent deps degrade gracefully):
 *   window.MAState          — global state manager
 *   window.MAUtils          — shared utility functions
 *   window.SiteSelectionScore — scoring model
 *   window.MARenderers      — section renderers
 *   window.PMAEngine        — underlying PMA engine / state
 *   window.DataService      — JSON data loader
 */
(function () {
  'use strict';

  /* ── Internal helpers ───────────────────────────────────────────── */

  /** @returns {object|null} */
  function _state()   { return window.MAState || null; }
  /** @returns {object|null} */
  function _utils()   { return window.MAUtils || null; }
  /** @returns {object|null} */
  function _scorer()  { return window.SiteSelectionScore || null; }
  /** @returns {object|null} */
  function _rend()    { return window.MARenderers || null; }
  /** @returns {object|null} */
  function _pma()     { return window.PMAEngine || null; }
  /** @returns {object|null} */
  function _ds()      { return window.DataService || null; }

  /**
   * Log a warning without throwing.
   * @param {string} msg
   */
  function _warn(msg) {
    if (typeof console !== 'undefined') {
      console.warn('[MAController] ' + msg);
    }
  }

  /**
   * Log an informational message.
   * @param {string} msg
   */
  function _log(msg) {
    if (typeof console !== 'undefined') {
      console.log('[MAController] ' + msg);
    }
  }

  /**
   * Log an error without throwing.
   * @param {string} msg
   * @param {*}      [err]
   */
  function _err(msg, err) {
    if (typeof console !== 'undefined') {
      console.error('[MAController] ' + msg, err || '');
    }
  }

  /**
   * Wrap a function call in a try-catch; return defaultVal on failure.
   * @param {function} fn
   * @param {*} defaultVal
   * @returns {*}
   */
  function _safe(fn, defaultVal) {
    try { return fn(); } catch (e) { _err('safe call failed', e); return defaultVal; }
  }

  /* ── Section id map ─────────────────────────────────────────────── */
  // These IDs target the inner content <div> elements, not the <section>
  // wrappers, so that loading/error states replace only the content area
  // and leave the <h2> section headings intact.
  var SECTION_IDS = [
    'maExecSummaryContent',
    'maMarketDemandContent',
    'maAffordableSupplyContent',
    'maSubsidyOppContent',
    'maSiteFeasibilityContent',
    'maNeighborhoodAccessContent',
    'maPolicyOverlaysContent',
    'maOpportunitiesContent'
  ];

  /* ── Data retrieval helpers ─────────────────────────────────────── */

  /**
   * Pull ACS aggregated metrics from PMAEngine's internal state, or from
   * DataService as a fallback.  Returns null if unavailable.
   * @returns {object|null}
   */
  function _getAcs() {
    // Prefer the live PMAEngine state (already aggregated for the buffer).
    var pma = _pma();
    if (pma && pma._state) {
      var q = _safe(function () { return pma._state.getLastQuality && pma._state.getLastQuality(); }, null);
      if (q && q.acs) return q.acs;
    }

    // Secondary: read from MAState if a prior run populated it.
    var st = _state();
    if (st) {
      var s = _safe(function () { return st.getState(); }, null);
      if (s && s.acs) return s.acs;
    }

    return null;
  }

  /**
   * Pull LIHTC features from PMAEngine's internal state, or from
   * DataService as a fallback.  Returns [] if unavailable.
   * @returns {Array}
   */
  function _getLihtc() {
    var st = _state();
    if (st) {
      var s = _safe(function () { return st.getState(); }, null);
      if (s && Array.isArray(s.lihtc) && s.lihtc.length) return s.lihtc;
    }
    return [];
  }

  /**
   * Pull QCT / DDA designation flags from PMAEngine overlays.
   * Returns { qctFlag: false, ddaFlag: false } as a safe default.
   * @param {number} lat
   * @param {number} lon
   * @returns {{ qctFlag: boolean, ddaFlag: boolean }}
   */
  function _getDesignationFlags(lat, lon) {
    // PMAEngine exposes isInProp123Jurisdiction and similar; designations
    // would come from the QCT/DDA overlay layers in a full implementation.
    // For now, return safe defaults; the scoring model handles nullish inputs.
    return { qctFlag: false, ddaFlag: false };
  }

  /* ── Loading / error state helpers ─────────────────────────────── */

  /**
   * Show a spinner in every report section.
   */
  function _showAllLoading() {
    var r = _rend();
    if (!r) return;
    SECTION_IDS.forEach(function (id) {
      _safe(function () { r.showSectionLoading(id); });
    });
  }

  /**
   * Show an error message in every report section.
   * @param {string} msg
   */
  function _showAllError(msg) {
    var r = _rend();
    if (!r) return;
    SECTION_IDS.forEach(function (id) {
      _safe(function () { r.showSectionError(id, msg); });
    });
  }

  /* ── Core analysis pipeline ─────────────────────────────────────── */

  /**
   * Orchestrate a full site analysis:
   *  1. Set loading state.
   *  2. Pull ACS + LIHTC data.
   *  3. Compute scores.
   *  4. Update MAState.
   *  5. Invoke all section renderers.
   *  6. Clear loading state.
   *
   * @param {number} lat         - Site latitude.
   * @param {number} lon         - Site longitude.
   * @param {number} bufferMiles - Analysis buffer radius in miles.
   */
  function runAnalysis(lat, lon, bufferMiles) {
    var st  = _state();
    var scr = _scorer();
    var ren = _rend();

    _log('runAnalysis(): lat=' + lat + ', lon=' + lon + ', buffer=' + bufferMiles + 'mi' +
      ' — MAState=' + (st ? 'ok' : 'missing') +
      ', SiteSelectionScore=' + (scr ? 'ok' : 'missing') +
      ', MARenderers=' + (ren ? 'ok' : 'missing'));

    // ── 1. Set loading state ────────────────────────────────────────
    if (st) {
      _safe(function () {
        st.setState({
          loading:   true,
          error:     null,
          site:      { lat: lat, lon: lon, bufferMiles: bufferMiles || 5 }
        });
      });
    }

    _showAllLoading();

    // Defer the synchronous scoring work by one tick so that the loading
    // spinners painted above have time to reach the screen before the
    // main thread is occupied.  requestAnimationFrame is not available in
    // all environments targeted by this ES5 module, so setTimeout(fn, 0)
    // is used as the equivalent portable deferral mechanism.
    setTimeout(function () {
      try {
        // ── 2. Gather data ───────────────────────────────────────────
        var acs   = _getAcs();
        var lihtc = _getLihtc();
        var flags = _getDesignationFlags(lat, lon);

        _log('runAnalysis(): acs=' + (acs ? 'ok (tract_count=' + (acs.tract_count || '?') + ')' : 'null') +
          ', lihtc=' + lihtc.length + ' features');

        // Build scoring inputs from available data.
        var inputs = {
          acs:              acs,
          qctFlag:          flags.qctFlag,
          ddaFlag:          flags.ddaFlag,
          fmrRatio:         null,    // populated by a data enrichment step if available
          nearbySubsidized: lihtc ? lihtc.length : 0,
          floodRisk:        0,       // default safe value; enriched by overlay data
          soilScore:        50,      // neutral default
          cleanupFlag:      false,
          amenities:        null,    // enriched by accessibility data when available
          zoningCapacity:   0,
          publicOwnership:  false,
          overlayCount:     0,
          rentTrend:        0,
          jobTrend:         0,
          concentration:    0.5,
          serviceStrength:  0.25
        };

        // ── 3. Compute scores ────────────────────────────────────────
        var scores = null;
        if (scr && typeof scr.computeScore === 'function') {
          scores = _safe(function () { return scr.computeScore(inputs); }, null);
        } else {
          _warn('SiteSelectionScore not loaded; scores will be null.');
        }

        // ── 4. Update state ──────────────────────────────────────────
        if (st) {
          _safe(function () {
            st.setState({
              acs:       acs,
              lihtc:     lihtc,
              scores:    scores,
              loading:   false,
              dataReady: true,
              sections: {
                demand:        acs,
                supply:        { lihtcFeatures: lihtc },
                subsidy: {
                  qctFlag:          flags.qctFlag,
                  ddaFlag:          flags.ddaFlag,
                  fmrRatio:         inputs.fmrRatio,
                  nearbySubsidized: inputs.nearbySubsidized,
                  subsidy_score:    scores ? scores.subsidy_score : null
                },
                feasibility: {
                  floodRisk:         inputs.floodRisk,
                  soilScore:         inputs.soilScore,
                  cleanupFlag:       inputs.cleanupFlag,
                  feasibility_score: scores ? scores.feasibility_score : null
                },
                access: {
                  amenities:    inputs.amenities,
                  access_score: scores ? scores.access_score : null
                },
                policy: {
                  zoningCapacity:  inputs.zoningCapacity,
                  publicOwnership: inputs.publicOwnership,
                  overlayCount:    inputs.overlayCount,
                  policy_score:    scores ? scores.policy_score : null
                },
                opportunities: _buildOpportunities(scores)
              }
            });
          });
        }

        // ── 5. Render sections ───────────────────────────────────────
        if (ren) {
          _log('runAnalysis(): rendering 8 report sections');
          _safe(function () {
            _log('rendering maExecSummary');
            ren.renderExecutiveSummary(scores, acs);
          });
          _safe(function () {
            _log('rendering maMarketDemand');
            ren.renderMarketDemand(acs);
          });
          _safe(function () {
            _log('rendering maAffordableSupply');
            ren.renderAffordableSupply(lihtc);
          });
          _safe(function () {
            _log('rendering maSubsidyOpp');
            ren.renderSubsidyOpportunities({
              qctFlag:          flags.qctFlag,
              ddaFlag:          flags.ddaFlag,
              fmrRatio:         inputs.fmrRatio,
              nearbySubsidized: inputs.nearbySubsidized,
              subsidy_score:    scores ? scores.subsidy_score : null
            });
          });
          _safe(function () {
            _log('rendering maSiteFeasibility');
            ren.renderSiteFeasibility({
              floodRisk:         inputs.floodRisk,
              soilScore:         inputs.soilScore,
              cleanupFlag:       inputs.cleanupFlag,
              feasibility_score: scores ? scores.feasibility_score : null
            });
          });
          _safe(function () {
            _log('rendering maNeighborhoodAccess');
            ren.renderNeighborhoodAccess({
              amenities:    inputs.amenities,
              access_score: scores ? scores.access_score : null
            });
          });
          _safe(function () {
            _log('rendering maPolicyOverlays');
            ren.renderPolicyOverlays({
              zoningCapacity:  inputs.zoningCapacity,
              publicOwnership: inputs.publicOwnership,
              overlayCount:    inputs.overlayCount,
              policy_score:    scores ? scores.policy_score : null
            });
          });
          _safe(function () {
            _log('rendering maOpportunities');
            ren.renderOpportunities(_buildOpportunities(scores));
          });
          _log('runAnalysis(): all sections rendered (final_score=' + (scores ? scores.final_score : 'n/a') + ')');
        } else {
          _warn('MARenderers not loaded; skipping section rendering.');
        }

      } catch (e) {
        _err('runAnalysis failed', e);
        var errMsg = (e && e.message) ? e.message : 'An unexpected error occurred.';
        if (st) {
          _safe(function () { st.setState({ loading: false, error: errMsg }); });
        }
        _showAllError(errMsg);
      }
    }, 0);
  }

  /* ── Opportunities builder ──────────────────────────────────────── */

  /**
   * Derive a list of strategic opportunity items from a score result.
   * @param {object|null} scores
   * @returns {{ items: Array }}
   */
  function _buildOpportunities(scores) {
    if (!scores) return { items: [] };

    var items = [];

    if (scores.demand_score >= 70) {
      items.push({
        title:       'Strong Renter Demand',
        description: 'High cost-burden and renter concentration signal unmet demand for affordable units.',
        priority:    'High'
      });
    }

    if (scores.subsidy_score >= 70) {
      items.push({
        title:       'Subsidy Eligibility Advantage',
        description: 'QCT or DDA designation may support a basis-boost application, reducing equity gap.',
        priority:    'High'
      });
    }

    if (scores.feasibility_score >= 70) {
      items.push({
        title:       'Favorable Site Conditions',
        description: 'Low flood risk and strong soil scores reduce pre-development risk and cost.',
        priority:    'Moderate'
      });
    }

    if (scores.access_score >= 70) {
      items.push({
        title:       'Strong Amenity Access',
        description: 'Proximity to transit, groceries, and healthcare supports resident quality of life.',
        priority:    'Moderate'
      });
    }

    if (scores.policy_score >= 70) {
      items.push({
        title:       'Supportive Policy Environment',
        description: 'By-right zoning capacity and public ownership reduce entitlement risk.',
        priority:    'High'
      });
    }

    if (scores.market_score >= 70) {
      items.push({
        title:       'Positive Market Fundamentals',
        description: 'Rising rents and job growth support long-term viability of affordable development.',
        priority:    'Moderate'
      });
    }

    // If no component scored well, add a generic note.
    if (items.length === 0) {
      items.push({
        title:       'Targeted Intervention Required',
        description: 'No single component scores as a clear strength; a comprehensive needs assessment is recommended.',
        priority:    'Lower'
      });
    }

    return { items: items };
  }

  /* ── Reset ──────────────────────────────────────────────────────── */

  /**
   * Reset application state and clear all rendered sections.
   */
  function resetAll() {
    var st  = _state();
    var ren = _rend();

    if (st) {
      _safe(function () { st.reset(); });
    }

    if (ren) {
      SECTION_IDS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) { el.innerHTML = ''; }
      });
    }
  }

  /* ── Initialisation ─────────────────────────────────────────────── */

  /**
   * Set up event listeners and perform startup configuration.
   * Must be called once on DOMContentLoaded.
   */
  function init() {
    // Guard against double-initialisation.
    if (window.__MAControllerInit) {
      _warn('init() called more than once; ignoring.');
      return;
    }
    window.__MAControllerInit = true;

    // Validate required modules.
    if (!_state())  _warn('MAState not found — state management disabled.');
    if (!_scorer()) _warn('SiteSelectionScore not found — scoring disabled.');
    if (!_rend())   _warn('MARenderers not found — rendering disabled.');

    // Bind the "Run Analysis" button if present.
    var runBtn = document.getElementById('maRunAnalysisBtn');
    if (runBtn) {
      runBtn.addEventListener('click', function () {
        var latInput = document.getElementById('maSiteLat');
        var lonInput = document.getElementById('maSiteLon');
        var bufInput = document.getElementById('maBufferMiles');

        var lat = latInput  ? parseFloat(latInput.value)  : NaN;
        var lon = lonInput  ? parseFloat(lonInput.value)  : NaN;
        var buf = bufInput  ? parseFloat(bufInput.value)  : 5;

        if (isNaN(lat) || isNaN(lon)) {
          _warn('Invalid lat/lon values in input fields.');
          return;
        }

        runAnalysis(lat, lon, buf);
      });
    }

    // Bind the "Reset" button if present.
    var resetBtn = document.getElementById('maResetBtn');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        resetAll();
      });
    }

    // If PMAEngine has already run and stored site coordinates, kick off
    // an analysis automatically.
    var pma = _pma();
    if (pma && pma._state) {
      var q = _safe(function () { return pma._state.getLastQuality && pma._state.getLastQuality(); }, null);
      if (q && q.site && typeof q.site.lat === 'number') {
        runAnalysis(q.site.lat, q.site.lon, q.site.bufferMiles || 5);
      }
    }
  }

  /* ── DOMContentLoaded hook ───────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // Document is already interactive or complete.
    init();
  }

  /* ── Expose ─────────────────────────────────────────────────────── */
  window.MAController = {
    init:        init,
    runAnalysis: runAnalysis,
    resetAll:    resetAll
  };

}());
