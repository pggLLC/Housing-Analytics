/**
 * js/components/qap-competitiveness-panel.js
 * Renders a QAP Competitiveness Score panel on the Deal Calculator page.
 *
 * Shows:
 *   - Estimated QAP score (0–100) with competitive band
 *   - 6-factor breakdown with bar chart comparison to avg winners/losers
 *   - Award likelihood percentage
 *   - Historical context (applications/funded, percentile rank)
 *   - Actionable recommendations to improve score
 *
 * Depends on:
 *   - js/chfa-award-predictor.js (scoring engine)
 *   - data/policy/chfa-awards-historical.json (historical data)
 *
 * Mount: renders into #dcQapPanel (created dynamically after HOS panel)
 */
(function (global) {
  'use strict';

  var _mountId = 'dcQapPanel';
  var _loaded = false;

  /* ── Formatting / color helpers ─────────────────────────────────── */

  function _bandColor(band) {
    if (band === 'strong')   return 'var(--good, #047857)';
    if (band === 'moderate') return 'var(--warn, #d97706)';
    return 'var(--bad, #dc2626)';
  }

  function _bandBg(band) {
    if (band === 'strong')   return 'var(--good-dim, #d1fae5)';
    if (band === 'moderate') return 'var(--warn-dim, #fef3c7)';
    return 'color-mix(in oklab, var(--card,#fff) 85%, var(--bad,#dc2626) 15%)';
  }

  function _scoreBarColor(value, max) {
    var pct = max > 0 ? value / max : 0;
    if (pct >= 0.75) return 'var(--good, #047857)';
    if (pct >= 0.55) return 'var(--warn, #d97706)';
    return 'var(--bad, #dc2626)';
  }

  var FACTOR_LABELS = {
    geography:     'Geography & Site',
    communityNeed: 'Community Need',
    localSupport:  'Local Support',
    developer:     'Developer',
    design:        'Design & Green',
    other:         'Other / Tiebreaker'
  };

  var FACTOR_ICONS = {
    geography:     '📍',
    communityNeed: '🏘️',
    localSupport:  '🤝',
    developer:     '🏗️',
    design:        '🌿',
    other:         '📋'
  };

  /* ── Load historical data + predictor ───────────────────────────── */

  function _ensureLoaded() {
    if (_loaded) return Promise.resolve();

    var CAP = global.CHFAAwardPredictor;
    if (CAP && CAP.isLoaded()) {
      _loaded = true;
      return Promise.resolve();
    }

    var base = global.APP_BASE_PATH || '';
    var url = base + 'data/policy/chfa-awards-historical.json';

    return fetch(url)
      .then(function (resp) {
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp.json();
      })
      .then(function (data) {
        if (CAP && typeof CAP.load === 'function') {
          return CAP.load(data);
        }
      })
      .then(function () { _loaded = true; })
      .catch(function (err) {
        console.warn('[qap-panel] Failed to load historical data:', err.message);
        if (global.CohoToast) global.CohoToast.show('QAP historical data unavailable.', 'warn');
      });
  }

  /* ── Gather site context from deal calculator + workflow state ───── */

  function _gatherSiteContext() {
    var ctx = {};

    // QCT/DDA from deal calculator checkbox
    var qctChk = document.getElementById('dc-qct-dda');
    ctx.isQct = qctChk ? qctChk.checked : false;

    // PMA score from SiteState
    var SS = global.SiteState;
    if (SS && typeof SS.getPmaResults === 'function') {
      var pma = SS.getPmaResults() || {};
      ctx.pmaScore = pma.finalScore || pma.score || 0;
      // OZ from PMA opportunities
      var opps = pma.opportunities || {};
      ctx.isDda = opps.lihtcBasisStepDown || false;
    }

    // Workflow data
    var WS = global.WorkflowState;
    if (WS && typeof WS.getStep === 'function') {
      // HNA gap data
      var hna = WS.getStep('hsa') || {};
      if (hna.affordabilityGap) {
        ctx.totalUndersupply = hna.affordabilityGap.totalGap || 0;
        ctx.ami30UnitsNeeded = hna.affordabilityGap.gap30 || 0;
        ctx.hasHnaData = true;
      }
    }

    // Also check HNAState for gap data
    var HNA = global.HNAState;
    if (HNA && HNA.state && HNA.state.affordabilityGap) {
      var gap = HNA.state.affordabilityGap;
      ctx.totalUndersupply = ctx.totalUndersupply || gap.totalGap || 0;
      ctx.ami30UnitsNeeded = ctx.ami30UnitsNeeded || gap.gap30 || 0;
      ctx.hasHnaData = true;
    }

    // Soft funding from tracker
    var SFT = global.SoftFundingTracker;
    if (SFT && SFT.isLoaded()) {
      var countySel = document.getElementById('dc-county-select');
      var fips = countySel ? countySel.value : null;
      if (fips) {
        var sum = SFT.sumEligible(fips, '9%');
        ctx.localSoftFunding = sum.total || 0;
      }
    }

    return ctx;
  }

  /* ── Build improvement recommendations ──────────────────────────── */

  function _buildRecommendations(prediction) {
    var recs = [];
    var factors = prediction.factors || {};

    // Find weakest factors relative to winner averages
    var weakest = Object.keys(factors)
      .map(function (key) {
        var f = factors[key];
        var winnerAvg = ({
          geography: 16.2, communityNeed: 20.8, localSupport: 18.5,
          developer: 12.1, design: 7.8, other: 6.1
        })[key] || 0;
        return { key: key, gap: winnerAvg - f.value, value: f.value, max: f.maxPts };
      })
      .filter(function (f) { return f.gap > 2; })
      .sort(function (a, b) { return b.gap - a.gap; });

    for (var i = 0; i < Math.min(weakest.length, 3); i++) {
      var w = weakest[i];
      var label = FACTOR_LABELS[w.key] || w.key;
      if (w.key === 'communityNeed') {
        recs.push('Strengthen ' + label + ' (+' + w.gap.toFixed(0) + ' pts possible): Complete the Housing Needs Assessment with CHAS data to document housing gap.');
      } else if (w.key === 'localSupport') {
        recs.push('Strengthen ' + label + ' (+' + w.gap.toFixed(0) + ' pts possible): Secure local government support letters and identify county/city soft funding commitments.');
      } else if (w.key === 'geography') {
        recs.push('Strengthen ' + label + ' (+' + w.gap.toFixed(0) + ' pts possible): Consider QCT/DDA sites or sites with stronger transit and amenity access.');
      } else if (w.key === 'design') {
        recs.push('Strengthen ' + label + ' (+' + w.gap.toFixed(0) + ' pts possible): Commit to green building certification (LEED, Enterprise Green Communities).');
      } else {
        recs.push('Strengthen ' + label + ' (+' + w.gap.toFixed(0) + ' pts possible): Address gaps to improve competitive positioning.');
      }
    }

    return recs;
  }

  /* ── Render the panel ───────────────────────────────────────────── */

  function render() {
    _ensureLoaded().then(function () {
      _renderInner();
    });
  }

  function _renderInner() {
    var CAP = global.CHFAAwardPredictor;
    if (!CAP || !CAP.isLoaded()) return;

    // Only show for 9% deals (QAP scoring is for competitive credits)
    var rate4 = document.getElementById('dc-rate-4');
    var is4Pct = rate4 && rate4.checked;

    // Find or create mount
    var mount = document.getElementById(_mountId);
    if (!mount) {
      // Insert after HOS panel or after tornado section
      var hosPanel = document.getElementById('hosPanel');
      var insertAfter = hosPanel ? hosPanel.parentElement : null;
      if (!insertAfter) {
        var tornadoSection = document.getElementById('tornadoHeading');
        insertAfter = tornadoSection ? tornadoSection.closest('div[style]') : null;
      }
      if (!insertAfter) return;

      var wrapper = document.createElement('div');
      wrapper.style.cssText = 'max-width:1200px;margin:24px auto 0;padding:0 18px;';
      mount = document.createElement('section');
      mount.id = _mountId;
      mount.className = 'hos-panel';
      mount.setAttribute('aria-labelledby', 'qapHeading');
      wrapper.appendChild(mount);
      insertAfter.parentNode.insertBefore(wrapper, insertAfter.nextSibling);
    }

    if (is4Pct) {
      mount.innerHTML =
        '<h2 id="qapHeading" style="margin:0 0 4px;font-size:1.1rem;">QAP Competitiveness</h2>' +
        '<p style="font-size:.82rem;color:var(--muted);margin:0;">QAP competitive scoring applies to 9% credit applications. Switch to 9% to see your estimated competitive position.</p>';
      return;
    }

    // Gather context and predict
    var ctx = _gatherSiteContext();
    var concept = { recommendedExecution: '9%' };
    var prediction = CAP.predict(concept, ctx);

    var score = prediction.scoreEstimate;
    var band = prediction.competitiveBand;
    var likelihood = Math.round(prediction.awardLikelihood * 100);
    var cc = prediction.competitiveContext || {};
    var factors = prediction.factors || {};
    var recs = _buildRecommendations(prediction);

    // Score thresholds for visual reference
    var thresholds = { high: 82, moderate: 74, low: 65 };

    // Build factor rows
    var factorHtml = '';
    var factorOrder = ['communityNeed', 'localSupport', 'geography', 'developer', 'design', 'other'];
    for (var i = 0; i < factorOrder.length; i++) {
      var key = factorOrder[i];
      var f = factors[key];
      if (!f) continue;
      var pct = f.maxPts > 0 ? Math.round(f.value / f.maxPts * 100) : 0;
      var barColor = _scoreBarColor(f.value, f.maxPts);
      var icon = FACTOR_ICONS[key] || '';
      var label = FACTOR_LABELS[key] || key;

      // Winner/loser comparison markers
      var winnerAvg = ({
        geography: 16.2, communityNeed: 20.8, localSupport: 18.5,
        developer: 12.1, design: 7.8, other: 6.1
      })[key] || 0;
      var winnerPct = f.maxPts > 0 ? Math.round(winnerAvg / f.maxPts * 100) : 0;

      factorHtml +=
        '<div class="qap-factor">' +
          '<div class="qap-factor__header">' +
            '<span class="qap-factor__label">' + icon + ' ' + label + '</span>' +
            '<span class="qap-factor__score">' + f.value.toFixed(1) + ' / ' + f.maxPts + '</span>' +
          '</div>' +
          '<div class="qap-factor__bar-wrap">' +
            '<div class="qap-factor__bar" style="width:' + pct + '%;background:' + barColor + ';"></div>' +
            '<div class="qap-factor__marker" style="left:' + winnerPct + '%;" title="Avg winner: ' + winnerAvg + '"></div>' +
          '</div>' +
          '<div class="qap-factor__note">' + (f.note || '') + '</div>' +
        '</div>';
    }

    // Recommendations
    var recsHtml = '';
    if (recs.length > 0) {
      recsHtml = '<div class="qap-recs">' +
        '<strong style="font-size:.82rem;">Improve Your Score</strong>' +
        '<ul style="margin:4px 0 0;padding-left:1.2rem;font-size:.78rem;color:var(--muted);line-height:1.6;">';
      for (var r = 0; r < recs.length; r++) {
        recsHtml += '<li>' + recs[r] + '</li>';
      }
      recsHtml += '</ul></div>';
    }

    mount.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">' +
        '<h2 id="qapHeading" style="margin:0;font-size:1.1rem;">QAP Competitiveness</h2>' +
        '<span style="font-size:.72rem;color:var(--muted);">9% Competitive Credit Application</span>' +
      '</div>' +
      '<p style="font-size:.82rem;color:var(--muted);margin:.25rem 0 .75rem;">' +
        'Estimated CHFA QAP scoring based on historical award patterns (2015–2025). Not a guarantee — CHFA is the sole arbiter of competitive awards.' +
      '</p>' +

      // Score display
      '<div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;margin-bottom:16px;">' +
        // Big score
        '<div style="text-align:center;min-width:100px;">' +
          '<div style="font-size:2.2rem;font-weight:800;line-height:1;color:' + _bandColor(band) + ';">' + Math.round(score) + '</div>' +
          '<div style="font-size:.72rem;color:var(--muted);margin-top:2px;">of 100 points</div>' +
        '</div>' +
        // Band + likelihood
        '<div style="flex:1;min-width:180px;">' +
          '<div style="display:inline-block;padding:4px 12px;border-radius:4px;font-size:.82rem;font-weight:700;background:' + _bandBg(band) + ';color:' + _bandColor(band) + ';">' +
            band.charAt(0).toUpperCase() + band.slice(1) + ' Competitive Position' +
          '</div>' +
          '<div style="font-size:.85rem;font-weight:600;margin-top:6px;color:var(--text);">' +
            likelihood + '% estimated award likelihood' +
          '</div>' +
          '<div style="font-size:.75rem;color:var(--muted);margin-top:2px;">' +
            'Percentile: ' + Math.round(cc.percentileRank * 100) + 'th vs historical winners' +
            ' · ~' + cc.applicationsExpected + ' applications / ~' + cc.fundingAvailable + ' funded per year' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Score gauge with thresholds
      '<div style="margin-bottom:16px;">' +
        '<div style="position:relative;height:8px;background:var(--border);border-radius:4px;overflow:visible;">' +
          '<div style="position:absolute;height:100%;width:' + Math.min(score, 100) + '%;background:' + _bandColor(band) + ';border-radius:4px;transition:width .4s;"></div>' +
          '<div style="position:absolute;left:' + thresholds.low + '%;top:-2px;width:2px;height:12px;background:var(--bad,#dc2626);opacity:.5;" title="Low threshold: ' + thresholds.low + '"></div>' +
          '<div style="position:absolute;left:' + thresholds.moderate + '%;top:-2px;width:2px;height:12px;background:var(--warn,#d97706);opacity:.5;" title="Moderate threshold: ' + thresholds.moderate + '"></div>' +
          '<div style="position:absolute;left:' + thresholds.high + '%;top:-2px;width:2px;height:12px;background:var(--good,#047857);opacity:.5;" title="High threshold: ' + thresholds.high + '"></div>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;font-size:.68rem;color:var(--muted);margin-top:3px;">' +
          '<span>0</span>' +
          '<span style="color:var(--bad,#dc2626);">Low (' + thresholds.low + ')</span>' +
          '<span style="color:var(--warn,#d97706);">Moderate (' + thresholds.moderate + ')</span>' +
          '<span style="color:var(--good,#047857);">Strong (' + thresholds.high + ')</span>' +
          '<span>100</span>' +
        '</div>' +
      '</div>' +

      // Factor breakdown
      '<div style="margin-bottom:12px;">' +
        '<strong style="font-size:.85rem;">Scoring Factor Breakdown</strong>' +
        '<span style="font-size:.68rem;color:var(--muted);margin-left:8px;">Diamond ◆ = avg winner score</span>' +
      '</div>' +
      '<div class="qap-factors">' + factorHtml + '</div>' +

      // Recommendations
      recsHtml +

      // Caveats
      '<p style="font-size:.68rem;color:var(--muted);margin-top:12px;line-height:1.5;">' +
        prediction.narrative + ' ' +
        (prediction.caveats || []).join(' ') +
      '</p>';
  }

  /* ── Inject CSS ─────────────────────────────────────────────────── */

  function _injectStyles() {
    if (document.getElementById('qapPanelStyles')) return;
    var style = document.createElement('style');
    style.id = 'qapPanelStyles';
    style.textContent =
      '.qap-factors { display: flex; flex-direction: column; gap: 10px; }' +
      '.qap-factor__header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px; }' +
      '.qap-factor__label { font-size: .78rem; font-weight: 600; color: var(--text); }' +
      '.qap-factor__score { font-size: .78rem; font-weight: 700; color: var(--text); }' +
      '.qap-factor__bar-wrap { position: relative; height: 14px; background: var(--border); border-radius: 3px; overflow: visible; }' +
      '.qap-factor__bar { position: absolute; height: 100%; border-radius: 3px; transition: width .4s ease; min-width: 2px; }' +
      '.qap-factor__marker { position: absolute; top: -1px; width: 0; height: 0; ' +
        'border-left: 5px solid transparent; border-right: 5px solid transparent; ' +
        'border-top: 7px solid var(--text); transform: translateX(-5px); opacity: .5; }' +
      '.qap-factor__note { font-size: .72rem; color: var(--muted); margin-top: 1px; }' +
      '.qap-recs { margin-top: 14px; padding: 10px 14px; border-radius: 6px; ' +
        'background: color-mix(in oklab, var(--card,#fff) 92%, var(--accent,#096e65) 8%); }' +
      '@media (max-width: 600px) { .qap-factor__label { font-size: .72rem; } }';
    document.head.appendChild(style);
  }

  /* ── Init ────────────────────────────────────────────────────────── */

  function init() {
    _injectStyles();
    // Initial render after a delay to let deal calc mount
    setTimeout(render, 800);

    // Re-render when deal calc recalculates
    document.addEventListener('soft-funding:refresh', function () {
      setTimeout(render, 100);
    });

    // Re-render when workflow updates
    document.addEventListener('workflow:step-updated', function () {
      setTimeout(render, 200);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 700); });
  } else {
    setTimeout(init, 700);
  }

  global.QapCompetitivenessPanel = { render: render };

})(typeof window !== 'undefined' ? window : this);
