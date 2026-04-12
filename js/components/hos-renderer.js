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

  function render() {
    var HOS = global.HousingOutcomeScore;
    if (!HOS || typeof HOS.compute !== 'function') return;

    var scoreEl    = document.getElementById('hosScoreValue');
    var gradeEl    = document.getElementById('hosGrade');
    var dataEl     = document.getElementById('hosDataComplete');
    var dimsEl     = document.getElementById('hosDimensions');
    var summaryEl  = document.getElementById('hosSummary');
    var badgeEl    = document.getElementById('hosConfidenceBadge');
    if (!scoreEl) return;

    var result = HOS.compute();

    // Main score
    scoreEl.textContent = result.score;
    scoreEl.style.color = _gradeColor(result.grade);

    // Grade
    gradeEl.textContent = 'Grade ' + result.grade;
    gradeEl.style.color = _gradeColor(result.grade);

    // Data completeness
    dataEl.textContent = result.dataComplete + '% of workflow data available';

    // Confidence badge
    if (badgeEl) {
      var confClass = result.confidence === 'high' ? 'drb--ok'
                    : result.confidence === 'medium' ? 'drb--warn'
                    : 'drb--error';
      badgeEl.className = 'data-reliability-badge ' + confClass;
      badgeEl.textContent = result.confidence.charAt(0).toUpperCase() + result.confidence.slice(1) + ' confidence';
      badgeEl.title = result.dataComplete + '% of scoring dimensions have data. Complete more workflow steps to improve confidence.';
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
        var pct = unavail ? 0 : dim.score;
        var weight = Math.round(dim.weight * 100);
        html += '<div class="' + cls + '">' +
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
