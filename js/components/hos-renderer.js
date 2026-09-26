/**
 * js/components/hos-renderer.js
 * Renders the Housing Outcome Score panel on the Deal Calculator page.
 * Depends on: js/housing-outcome-score.js
 */
(function (global) {
  'use strict';

  var DIM_LABELS = {
    needCoverage:         'Need Coverage',
    policyAlignment:      'Policy Alignment',
    financialFeasibility: 'Financial Feasibility',
    siteQuality:          'Site Quality'
  };

  function _fillColor(score) {
    if (score >= 70) return 'var(--good)';
    if (score >= 45) return 'var(--warn)';
    return 'var(--bad)';
  }

  function _gradeColor(grade) {
    if (grade === 'A') return 'var(--good)';
    if (grade === 'B') return 'color-mix(in oklab, var(--good) 60%, var(--warn) 40%)';
    if (grade === 'C') return 'var(--warn)';
    if (grade === 'D') return 'var(--accent2)';
    return 'var(--bad)';
  }

  // PC-2: the Housing Outcome Score is a LIHTC/rental score (QCT/DDA, deal
  // confidence, capital-stack gap). An ownership project never shows it. The
  // panel's wrapper carries data-dc-mode="rental", so the Deal Mode toggle
  // hides it; this also skips computing it, so nothing is written into a
  // hidden panel that a later mode switch would reveal stale.
  function _isOwnershipMode() {
    var checked = document.querySelector('input[name="dc-deal-mode"]:checked');
    return !!(checked && checked.value === 'ownership');
  }

  function render() {
    var HOS = global.HousingOutcomeScore;
    if (!HOS || typeof HOS.compute !== 'function') return;
    if (_isOwnershipMode()) return;

    var scoreEl    = document.getElementById('hosScoreValue');
    var gradeEl    = document.getElementById('hosGrade');
    var dataEl     = document.getElementById('hosDataComplete');
    var dimsEl     = document.getElementById('hosDimensions');
    var summaryEl  = document.getElementById('hosSummary');
    var badgeEl    = document.getElementById('hosConfidenceBadge');
    if (!scoreEl) return;

    var result = HOS.compute();
    var unavailable = result.available === false || result.score == null;

    if (unavailable) {
      // No score is not a score of 0: no number, no grade, no "High".
      scoreEl.textContent = 'Unavailable';
      scoreEl.style.color = 'var(--muted)';
      gradeEl.textContent = result.unavailableReason || 'Not enough workflow data to score.';
      gradeEl.style.color = 'var(--muted)';
    } else {
      // Main score
      scoreEl.textContent = result.score;
      scoreEl.style.color = _gradeColor(result.grade);

      // Grade
      gradeEl.textContent = 'Grade ' + result.grade;
      gradeEl.style.color = _gradeColor(result.grade);
    }

    // Data completeness
    dataEl.textContent = result.dataComplete + '% of scoring inputs measured';

    // Confidence badge
    if (unavailable && badgeEl) {
      badgeEl.className = 'data-reliability-badge drb--error';
      badgeEl.textContent = 'Not scored';
      badgeEl.title = result.unavailableReason || 'Not enough workflow data to score.';
    } else if (badgeEl) {
      var confClass = result.confidence === 'high' ? 'drb--ok'
                    : result.confidence === 'medium' ? 'drb--warn'
                    : 'drb--error';
      badgeEl.className = 'data-reliability-badge ' + confClass;
      badgeEl.textContent = result.confidence.charAt(0).toUpperCase() + result.confidence.slice(1) + ' confidence';
      badgeEl.title = result.dataComplete + '% of scoring inputs are measured. Complete more workflow steps to improve confidence.';
    }

    // Dimensions
    if (dimsEl) {
      var html = '';
      for (var key in result.dimensions) {
        if (!result.dimensions.hasOwnProperty(key)) continue;
        var dim = result.dimensions[key];
        var unavail = !dim.available;
        var cls = 'hos-dim' + (unavail ? ' hos-dim--unavailable' : '');
        var score = unavail ? '—' : dim.score;
        var why = unavail && dim.unavailableReason ? ' title="' + String(dim.unavailableReason).replace(/"/g, '&quot;') + '"' : '';
        var pct = unavail ? 0 : dim.score;
        var weight = Math.round(dim.weight * 100);
        html += '<div class="' + cls + '"' + why + '>' +
          '<div class="hos-dim__label">' + (DIM_LABELS[key] || key) + ' (' + weight + '%)</div>' +
          '<div class="hos-dim__score">' + score + '</div>' +
          '<div class="hos-dim__bar">' +
            '<div class="hos-dim__fill" style="width:' + pct + '%;background:' + _fillColor(pct) + ';"></div>' +
          '</div>' +
        '</div>';
      }
      dimsEl.innerHTML = html;
    }

    // Summary
    if (summaryEl) {
      summaryEl.textContent = result.summary;
    }
  }

  // Run after DOM and dependencies load
  function init() {
    render();
    // Re-render when deal calculator recalculates
    document.addEventListener('workflow:step-updated', render);
    // Re-render on switching back to rental, rather than up to 5s later.
    document.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'dc-deal-mode') render();
    });
    // Also re-render periodically to catch deal calculator changes (no events dispatched)
    setInterval(render, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 500); });
  } else {
    setTimeout(init, 500);
  }

  global.HOSRenderer = { render: render };

})(typeof window !== 'undefined' ? window : this);
