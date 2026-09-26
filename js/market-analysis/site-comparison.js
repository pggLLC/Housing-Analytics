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

    // A dimension the scorer could not measure is null, not 0.
    // site-selection-score.js returns subsidy_score: null (with
    // subsidyUnavailableReason) when the QCT/DDA designation is unknown, and
    // demand/access null when their inputs are missing. `|| 0` turned each
    // of those into a real-looking zero on the comparison table and dragged
    // the site to the bottom of its column. No scoring result at all is the
    // same unknown for every dimension.
    var finalScore    = _scoreOrNull(dims && dims.final_score);
    if (finalScore === null) finalScore = _scoreOrNull(score);
    var band          = (dims && dims.opportunity_band)  || _band(finalScore);
    var demandScore   = _scoreOrNull(dims && dims.demand_score);
    var subsidyScore  = _scoreOrNull(dims && dims.subsidy_score);
    var feasScore     = _scoreOrNull(dims && dims.feasibility_score);
    var accessScore   = _scoreOrNull(dims && dims.access_score);
    var policyScore   = _scoreOrNull(dims && dims.policy_score);
    var marketScore   = _scoreOrNull(dims && dims.market_score);
    var subsidyUnavailableReason = (dims && dims.subsidyUnavailableReason) || null;
    if (subsidyScore === null && !subsidyUnavailableReason) {
      subsidyUnavailableReason = dims ? 'Subsidy score not available for this site.' : 'No site score available.';
    }

    // QCT/DDA flags: true / false are answers; null or absent is unknown and
    // must not render as "No".
    var src = state || pma || {};
    var qct = _flagOrNull(src.qctFlag, src.qct);
    var dda = _flagOrNull(src.ddaFlag, src.dda);

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
      subsidyUnavailableReason: subsidyScore === null ? subsidyUnavailableReason : null,
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

  function _scoreOrNull(v) {
    return (typeof v === 'number' && isFinite(v)) ? v : null;
  }

  function _flagOrNull(a, b) {
    if (a === true || b === true) return true;
    if (a === false || b === false) return false;
    return null;
  }

  function _flagCell(v, title) {
    if (v === true) return '<span title="' + title + '" style="color:var(--good);font-weight:700">Yes</span>';
    if (v === false) return '<span style="color:var(--muted)">No</span>';
    return '<span class="sc-unavailable" title="' + title + ' status unknown" style="color:var(--muted)">Unknown</span>';
  }

  // A null dimension renders as a dash with its reason, and no bar: an
  // empty bar would read as a measured zero.
  function _dimCell(val, reason) {
    if (_scoreOrNull(val) === null) {
      var why = reason || 'Not measured for this site.';
      return '<td class="sc-dim--unavailable" data-unavailable="true" title="' + _esc(why) + '">&mdash;' +
        '<div class="sc-unavailable-reason" style="font-size:.7rem;color:var(--muted)">' + _esc(why) + '</div></td>';
    }
    return '<td>' + _esc(_fmtScore(val)) + _dimBar(val) + '</td>';
  }

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

    // Sort by final score descending; a site with no score is listed after
    // every scored site rather than ranked as if it had scored 0.
    var sorted = _sites.slice().sort(function (a, b) {
      var av = _scoreOrNull(a.finalScore), bv = _scoreOrNull(b.finalScore);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });

    var bestScore = _scoreOrNull(sorted[0].finalScore);

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
      var isBest = (bestScore !== null && s.finalScore === bestScore && i === 0);
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
        _dimCell(s.demand) +
        _dimCell(s.subsidy, s.subsidyUnavailableReason) +
        _dimCell(s.feasibility) +
        _dimCell(s.access) +
        _dimCell(s.policy) +
        _dimCell(s.market) +
        '<td>' + _flagCell(s.qct, 'Qualified Census Tract') + '</td>' +
        '<td>' + _flagCell(s.dda, 'Difficult Development Area') + '</td>' +
        '<td><button type="button" class="sc-remove-btn" data-remove="' + _esc(s.id) + '" title="Remove this site" aria-label="Remove site ' + (i+1) + '">&times;</button></td>' +
      '</tr>';
    }

    html += '</tbody></table></div>';

    // Summary insight
    if (sorted.length >= 2) {
      var best = sorted[0];
      var dims = ['demand', 'subsidy', 'feasibility', 'access', 'policy', 'market'];
      // Only measured dimensions can be "strongest".
      var strongest = null;
      var strongestVal = null;
      for (var d = 0; d < dims.length; d++) {
        var dv = _scoreOrNull(best[dims[d]]);
        if (dv !== null && (strongestVal === null || dv > strongestVal)) {
          strongest = dims[d];
          strongestVal = dv;
        }
      }
      var missingDims = dims.filter(function (k) { return _scoreOrNull(best[k]) === null; });
      html += '<div class="sc-insight" style="margin-top:.75rem;padding:.6rem 1rem;background:color-mix(in oklab,var(--card) 60%,var(--good) 8%);border:1px solid color-mix(in oklab,var(--border) 50%,var(--good) 20%);border-radius:var(--radius-sm);font-size:.82rem;">' +
        '<strong>Top site:</strong> ' + _esc(best.label) + ' scores <strong>' + _esc(_fmtScore(best.finalScore)) + '</strong> (' + _esc(best.band) + ')' +
        (strongest ? ', strongest in <strong>' + _esc(strongest) + '</strong> (' + _esc(_fmtScore(strongestVal)) + '/100). ' : '. ') +
        (missingDims.length ? 'Not measured: ' + _esc(missingDims.join(', ')) + '. ' : '') +
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
    // A score of 0 is a value; only null/undefined is empty.
    if (s === null || s === undefined) return '';
    var d = document.createElement('div');
    d.textContent = String(s);
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
