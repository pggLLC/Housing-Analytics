/**
 * js/market-analysis/site-comparison.js
 * Multi-site comparison workspace for the Market Analysis page.
 *
 * Captures site scoring snapshots and renders a ranked comparison table
 * showing each site's 6-dimension scores, overall score, opportunity band,
 * QCT/DDA status, and gap coverage.  Up to 10 saved sites.
 *
 * Depends on:
 *   js/site-state.js           (persistence)
 *   js/market-analysis/site-selection-score.js (scoring output)
 *   js/market-analysis/market-analysis-state.js (MAState — live results)
 *   js/pma-ui-controller.js    (triggers after scoring)
 */
(function (global) {
  'use strict';

  var MAX_SITES = 10;
  var STORAGE_KEY = 'savedSites';

  // ── State ──────────────────────────────────────────────────────────
  var _sites = [];  // Array of site snapshot objects

  // ── Persistence ────────────────────────────────────────────────────

  function _persist() {
    try {
      if (global.SiteState) {
        global.SiteState.set(STORAGE_KEY, _sites, true);
      }
    } catch (_) {}
  }

  function _restore() {
    try {
      if (global.SiteState) {
        var saved = global.SiteState.get(STORAGE_KEY);
        if (Array.isArray(saved)) _sites = saved;
      }
    } catch (_) {}
  }

  // ── Snapshot capture ───────────────────────────────────────────────

  /**
   * Capture the current PMA/site score as a snapshot object.
   * Returns null if no scored site is available.
   */
  function _captureSnapshot() {
    // Try MAState first (market analysis controller state)
    var state = global.MAState && global.MAState.getState ? global.MAState.getState() : null;
    var pma   = global.SiteState ? global.SiteState.getPmaResults() : null;

    // We need at minimum a scored site with coordinates
    var lat = null, lon = null, score = null, bufferMiles = null;

    if (state && state.siteLat != null) {
      lat = state.siteLat;
      lon = state.siteLon;
      score = state.siteScore || state.score || null;
      bufferMiles = state.bufferMiles || null;
    } else if (pma) {
      lat = pma.lat || pma.siteLat;
      lon = pma.lon || pma.siteLon;
      score = pma.score || pma.siteScore || null;
      bufferMiles = pma.bufferMiles || null;
    }

    if (lat == null || lon == null) return null;

    // Extract dimension scores
    var dims = null;
    if (state && state.siteScoreResult) {
      dims = state.siteScoreResult;
    } else if (pma && pma.siteScoreResult) {
      dims = pma.siteScoreResult;
    } else if (score && typeof score === 'object') {
      dims = score;
    }

    var finalScore    = (dims && dims.final_score)      || (typeof score === 'number' ? score : null);
    var band          = (dims && dims.opportunity_band)  || _band(finalScore);
    var demandScore   = dims ? (dims.demand_score   || 0) : 0;
    var subsidyScore  = dims ? (dims.subsidy_score  || 0) : 0;
    var feasScore     = dims ? (dims.feasibility_score || 0) : 0;
    var accessScore   = dims ? (dims.access_score   || 0) : 0;
    var policyScore   = dims ? (dims.policy_score   || 0) : 0;
    var marketScore   = dims ? (dims.market_score   || 0) : 0;

    // QCT/DDA flags
    var qct = false, dda = false;
    if (state) {
      qct = !!(state.qctFlag || state.qct);
      dda = !!(state.ddaFlag || state.dda);
    } else if (pma) {
      qct = !!(pma.qctFlag || pma.qct);
      dda = !!(pma.ddaFlag || pma.dda);
    }

    // Gap coverage from HNA state (if available)
    var gapCoverage = null;
    if (global.HNAState && global.HNAState.state && global.HNAState.state.affordabilityGap) {
      gapCoverage = global.HNAState.state.affordabilityGap;
    }

    // Address/label
    var address = '';
    if (state && state.siteAddress) address = state.siteAddress;
    var coordLabel = _fmtCoord(lat) + ', ' + _fmtCoord(lon);

    return {
      id:             'site_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      savedAt:        new Date().toISOString(),
      label:          address || coordLabel,
      lat:            lat,
      lon:            lon,
      bufferMiles:    bufferMiles,
      finalScore:     finalScore,
      band:           band,
      demand:         demandScore,
      subsidy:        subsidyScore,
      feasibility:    feasScore,
      access:         accessScore,
      policy:         policyScore,
      market:         marketScore,
      qct:            qct,
      dda:            dda,
      gapCoverage:    gapCoverage
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────

  function _band(score) {
    if (score == null || isNaN(score)) return '—';
    if (score >= 70) return 'High';
    if (score >= 45) return 'Moderate';
    return 'Lower';
  }

  function _fmtCoord(n) {
    return n != null ? Number(n).toFixed(4) : '—';
  }

  function _fmtScore(n) {
    return n != null && !isNaN(n) ? Math.round(n) : '—';
  }

  function _bandClass(band) {
    if (band === 'High')     return 'sc-band--high';
    if (band === 'Moderate') return 'sc-band--moderate';
    return 'sc-band--lower';
  }

  function _dimBar(val) {
    var v = Math.max(0, Math.min(100, val || 0));
    var color = v >= 70 ? 'var(--good)' : v >= 45 ? 'var(--warn)' : 'var(--bad)';
    return '<div class="sc-dim-bar" style="width:100%;height:6px;background:var(--bg2);border-radius:3px;position:relative;">' +
             '<div style="width:' + v + '%;height:100%;background:' + color + ';border-radius:3px;"></div>' +
           '</div>';
  }

  // ── Rendering ──────────────────────────────────────────────────────

  function _render() {
    var tableMount   = document.getElementById('siteCompTable');
    var actionsMount = document.getElementById('siteCompActions');
    var saveButtons  = document.getElementById('scSaveButtons');
    if (!tableMount) return;

    // Show/hide save button based on whether a scored site exists
    var hasScore = !!_captureSnapshot();
    if (saveButtons) saveButtons.style.display = hasScore ? 'flex' : 'none';

    if (_sites.length === 0) {
      tableMount.innerHTML = '<p class="ma-section-placeholder">Score a site above, then click "Save Current Site" to begin comparing locations.</p>';
      if (actionsMount) actionsMount.style.display = 'none';
      return;
    }

    // Sort by final score descending
    var sorted = _sites.slice().sort(function (a, b) {
      return (b.finalScore || 0) - (a.finalScore || 0);
    });

    var bestScore = sorted[0].finalScore || 0;

    // Build table
    var html = '<div class="sc-table-wrap" style="overflow-x:auto;">' +
      '<table class="sc-table" role="grid" aria-label="Site comparison">' +
      '<thead><tr>' +
        '<th style="min-width:40px;">#</th>' +
        '<th style="min-width:160px;">Site</th>' +
        '<th style="min-width:70px;">Score</th>' +
        '<th style="min-width:80px;">Band</th>' +
        '<th style="min-width:65px;">Demand</th>' +
        '<th style="min-width:65px;">Subsidy</th>' +
        '<th style="min-width:65px;">Feasibility</th>' +
        '<th style="min-width:65px;">Access</th>' +
        '<th style="min-width:65px;">Policy</th>' +
        '<th style="min-width:65px;">Market</th>' +
        '<th style="min-width:50px;">QCT</th>' +
        '<th style="min-width:50px;">DDA</th>' +
        '<th style="min-width:50px;"></th>' +
      '</tr></thead><tbody>';

    for (var i = 0; i < sorted.length; i++) {
      var s = sorted[i];
      var isBest = (s.finalScore === bestScore && i === 0);
      var rowClass = isBest ? ' class="sc-row--best"' : '';

      html += '<tr' + rowClass + ' data-site-id="' + _esc(s.id) + '">' +
        '<td>' + (i + 1) + '</td>' +
        '<td>' +
          '<div class="sc-site-label">' + _esc(s.label) + '</div>' +
          '<div class="sc-site-coords">' + _esc(_fmtCoord(s.lat)) + ', ' + _esc(_fmtCoord(s.lon)) +
            (s.bufferMiles ? ' &middot; ' + _esc(String(s.bufferMiles)) + ' mi' : '') + '</div>' +
        '</td>' +
        '<td><strong>' + _esc(_fmtScore(s.finalScore)) + '</strong></td>' +
        '<td><span class="sc-band ' + _bandClass(s.band) + '">' + _esc(s.band || '—') + '</span></td>' +
        '<td>' + _esc(_fmtScore(s.demand)) + _dimBar(s.demand) + '</td>' +
        '<td>' + _esc(_fmtScore(s.subsidy)) + _dimBar(s.subsidy) + '</td>' +
        '<td>' + _esc(_fmtScore(s.feasibility)) + _dimBar(s.feasibility) + '</td>' +
        '<td>' + _esc(_fmtScore(s.access)) + _dimBar(s.access) + '</td>' +
        '<td>' + _esc(_fmtScore(s.policy)) + _dimBar(s.policy) + '</td>' +
        '<td>' + _esc(_fmtScore(s.market)) + _dimBar(s.market) + '</td>' +
        '<td>' + (s.qct ? '<span title="Qualified Census Tract" style="color:var(--good);font-weight:700">Yes</span>' : '<span style="color:var(--muted)">No</span>') + '</td>' +
        '<td>' + (s.dda ? '<span title="Difficult Development Area" style="color:var(--good);font-weight:700">Yes</span>' : '<span style="color:var(--muted)">No</span>') + '</td>' +
        '<td><button type="button" class="sc-remove-btn" data-remove="' + _esc(s.id) + '" title="Remove this site" aria-label="Remove site ' + (i+1) + '">&times;</button></td>' +
      '</tr>';
    }

    html += '</tbody></table></div>';

    // Summary insight
    if (sorted.length >= 2) {
      var best = sorted[0];
      var dims = ['demand', 'subsidy', 'feasibility', 'access', 'policy', 'market'];
      var strongest = dims[0];
      var strongestVal = best[dims[0]] || 0;
      for (var d = 1; d < dims.length; d++) {
        if ((best[dims[d]] || 0) > strongestVal) {
          strongest = dims[d];
          strongestVal = best[dims[d]];
        }
      }
      html += '<div class="sc-insight" style="margin-top:.75rem;padding:.6rem 1rem;background:color-mix(in oklab,var(--card) 60%,var(--good) 8%);border:1px solid color-mix(in oklab,var(--border) 50%,var(--good) 20%);border-radius:var(--radius-sm);font-size:.82rem;">' +
        '<strong>Top site:</strong> ' + _esc(best.label) + ' scores <strong>' + _esc(_fmtScore(best.finalScore)) + '</strong> (' + _esc(best.band) + '), ' +
        'strongest in <strong>' + _esc(strongest) + '</strong> (' + _esc(_fmtScore(strongestVal)) + '/100). ' +
        (best.qct || best.dda ? 'Eligible for basis boost.' : '') +
      '</div>';
    }

    tableMount.innerHTML = html;
    if (actionsMount) actionsMount.style.display = _sites.length > 0 ? 'block' : 'none';

    // Wire remove buttons
    var removeBtns = tableMount.querySelectorAll('.sc-remove-btn');
    for (var r = 0; r < removeBtns.length; r++) {
      removeBtns[r].addEventListener('click', function () {
        var id = this.getAttribute('data-remove');
        _sites = _sites.filter(function (s) { return s.id !== id; });
        _persist();
        _render();
      });
    }
  }

  function _esc(s) {
    if (!s) return '';
    var d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ── Event Wiring ───────────────────────────────────────────────────

  function _init() {
    _restore();

    var saveBtn  = document.getElementById('scSaveSiteBtn');
    var clearBtn = document.getElementById('scClearAllBtn');
    var confirmEl = document.getElementById('scSaveConfirm');

    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var snapshot = _captureSnapshot();
        if (!snapshot) return;
        if (_sites.length >= MAX_SITES) {
          // Remove oldest
          _sites.shift();
        }
        _sites.push(snapshot);
        _persist();
        _render();

        // Brief confirmation flash
        if (confirmEl) {
          confirmEl.style.display = 'inline';
          setTimeout(function () { confirmEl.style.display = 'none'; }, 2000);
        }
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        _sites = [];
        _persist();
        _render();
      });
    }

    // Re-render when PMA scoring completes (show save button)
    document.addEventListener('pma:scored', function () {
      setTimeout(_render, 100);
    });
    document.addEventListener('ma:analysis-complete', function () {
      setTimeout(_render, 100);
    });

    // No events dispatched by scoring engine — use MutationObserver on
    // the score display element to detect when a new score renders.
    var scoreWatch = document.getElementById('maPmaTool');
    if (scoreWatch && typeof MutationObserver !== 'undefined') {
      var _lastCheck = null;
      new MutationObserver(function () {
        var snap = _captureSnapshot();
        var newCheck = snap ? (snap.lat + ',' + snap.lon + ',' + snap.finalScore) : null;
        if (newCheck && newCheck !== _lastCheck) {
          _lastCheck = newCheck;
          _render();
        }
      }).observe(scoreWatch, { childList: true, subtree: true, characterData: true });
    }

    _render();
  }

  // ── Bootstrap ──────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    setTimeout(_init, 0);
  }

  // ── Public API ─────────────────────────────────────────────────────

  global.SiteComparison = {
    getSites: function () { return _sites.slice(); },
    render:   _render,
    capture:  _captureSnapshot
  };

})(typeof window !== 'undefined' ? window : this);
