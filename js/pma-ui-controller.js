/**
 * js/pma-ui-controller.js
 * UI controller for the enhanced PMA delineation tool on market-analysis.html.
 *
 * Responsibilities:
 *  - Tab switching between buffer / commuting / hybrid methods
 *  - Show/hide layer picker for non-buffer modes
 *  - Hook into the existing pmaRunBtn click to trigger PMAAnalysisRunner
 *  - Drive the progress bar (step label, fill width, %, step count)
 *  - Render justification narrative, subsidy-expiry risk, and incentive badges
 *  - "Explain Score" and "Export Audit Trail" buttons
 *
 * Depends on (loaded before this script, all deferred):
 *   window.PMAAnalysisRunner   — js/pma-analysis-runner.js
 *   window.PMAJustification    — js/pma-justification.js
 *   window.PMAEngine           — js/market-analysis.js
 *
 * Backward-compatible: when PMAAnalysisRunner is absent the existing
 * buffer-based flow continues to work uninterrupted.
 */
(function () {
  'use strict';

  /* ── CSS for active tab state (injected once) ────────────────────── */
  var STYLE_INJECTED = false;
  function _injectStyle() {
    if (STYLE_INJECTED || typeof document === 'undefined') return;
    STYLE_INJECTED = true;
    var s = document.createElement('style');
    s.textContent = [
      '.pma-tab{background:var(--card,#1e1e1e);color:var(--text,#eee);transition:background .15s,border-color .15s;}',
      '.pma-tab--active{background:var(--accent,#096e65)!important;color:#fff!important;',
      '  border-color:var(--accent,#096e65)!important;}',
      '.pma-tab:hover:not(.pma-tab--active){background:var(--border,#2a2a2a);}',
      '#pmaProgressFill{will-change:width;}'
    ].join('');
    document.head.appendChild(s);
  }

  /* ── Element references ─────────────────────────────────────────── */
  function $id(id) { return document.getElementById(id); }

  /* ── Internal state ─────────────────────────────────────────────── */
  var _method       = 'buffer';
  var _bufferMiles  = 5;
  var _lastScoreRun = null;
  var _running      = false;

  /* ── Progress bar helpers ────────────────────────────────────────── */
  function _progressShow() {
    var wrap = $id('pmaProgressWrap');
    if (wrap) wrap.style.display = 'block';
  }
  function _progressHide() {
    var wrap = $id('pmaProgressWrap');
    if (wrap) wrap.style.display = 'none';
  }
  function _progressUpdate(step) {
    var label = $id('pmaProgressLabel');
    var pct   = $id('pmaProgressPct');
    var fill  = $id('pmaProgressFill');
    var bar   = $id('pmaProgressBar');
    var steps = $id('pmaProgressSteps');
    var total = (window.PMAAnalysisRunner && window.PMAAnalysisRunner.STEPS)
      ? window.PMAAnalysisRunner.STEPS.length : 9;

    if (label) label.textContent = step.label  || '…';
    if (pct)   pct.textContent   = step.pct    + ' %';
    if (fill)  fill.style.width  = step.pct    + '%';
    if (bar)   bar.setAttribute('aria-valuenow', String(step.pct));
    if (steps) steps.textContent = 'Step ' + step.index + ' of ' + total;
    if (window.__announceUpdate) window.__announceUpdate(step.label);
  }
  function _progressComplete() {
    var fill  = $id('pmaProgressFill');
    var pct   = $id('pmaProgressPct');
    var label = $id('pmaProgressLabel');
    var bar   = $id('pmaProgressBar');
    if (fill)  fill.style.width = '100%';
    if (pct)   pct.textContent  = '100 %';
    if (label) label.textContent = 'Analysis complete ✓';
    if (bar)   bar.setAttribute('aria-valuenow', '100');
    // Auto-hide after 1.5 s
    setTimeout(_progressHide, 1500);
  }

  /* ── Render LIHTC concept card ───────────────────────────────────── */
  function _renderConceptCard(scoreRun) {
    var card = $id('lihtcConceptCard');
    if (!card) return;

    var predictor = (typeof window !== 'undefined') ? window.LIHTCDealPredictor : null;
    var bridge    = (typeof window !== 'undefined') ? window.HNAMarketBridge    : null;
    if (!predictor) { card.hidden = true; return; }

    // Build need profile if bridge available
    var needProfile = null;
    var hnaState    = (typeof window !== 'undefined' && window.HNAState) ? window.HNAState : null;
    var hnaData     = hnaState ? (hnaState.chasData || hnaState.affordabilityGap || null) : null;
    if (bridge && hnaData) {
      needProfile = bridge.buildNeedProfile(hnaData, scoreRun && scoreRun.pma);
    }

    // Assemble deal inputs
    var proposedUnits = parseInt(($id('pmaProposedUnits') || {}).value || '60', 10) || 60;
    var pmaScore    = null;
    var pmaResult   = scoreRun && (scoreRun.pma || scoreRun._analysisResults);
    if (pmaResult)  pmaScore = pmaResult.pma_score || pmaResult.score || null;

    var dealInputs = {
      pmaScore:           pmaScore,
      proposedUnits:      proposedUnits,
      competitiveSetSize: scoreRun && scoreRun.competitiveSet
        ? (scoreRun.competitiveSet.competitiveSetSize || 0) : 0
    };

    if (needProfile && bridge) {
      dealInputs = bridge.toDealInputs(needProfile, dealInputs);
    }

    // Extract QCT/DDA from justification
    if (scoreRun && scoreRun.opportunities) {
      var elig = scoreRun.opportunities.incentiveEligibility || {};
      if (elig.qct !== undefined) dealInputs.isQct = !!elig.qct;
      if (elig.dda !== undefined) dealInputs.isDda = !!elig.dda;
    }

    var rec = predictor.predictConcept(dealInputs);

    // Compute housing needs fit when HNA data is available
    var hnsFit = null;
    var hnaFitAnalyzer = window.HousingNeedsFitAnalyzer;
    if (hnaFitAnalyzer && needProfile) {
      hnsFit = hnaFitAnalyzer.analyzeHousingNeedsFit(needProfile, rec, { proposedUnits: proposedUnits });
    }

    // Use the full renderer when available (preferred)
    var renderer = window.LIHTCConceptCardRenderer;
    if (renderer && typeof renderer.render === 'function') {
      renderer.render(card, rec, hnsFit);
      return;
    }

    // Fallback: inline renderer (kept in sync with LIHTCConceptCardRenderer)
    _drawConceptCard(card, rec, hnsFit);
  }

  function _drawConceptCard(card, rec, hnsFit) {
    var badge    = _esc(rec.confidenceBadge || '');
    var conf     = _esc(rec.confidence     || '');
    var exec     = _esc(rec.recommendedExecution || '');
    var concept  = _esc(rec.conceptType   || '');
    var headline = exec + ' ' + _capitalise(concept) + ' Housing';

    var unitMix = rec.suggestedUnitMix || {};
    var amiMix  = rec.suggestedAMIMix  || {};
    var stack   = rec.indicativeCapitalStack || {};

    function _row(label, value) {
      return '<tr><td style="padding:.25rem .5rem;color:var(--text-muted,#aaa);">' + _esc(label) + '</td>' +
             '<td style="padding:.25rem .5rem;font-weight:600;">' + _esc(String(value)) + '</td></tr>';
    }

    // Housing Needs Fit section
    var hnaHtml = '';
    if (hnsFit && hnsFit.alignmentPoints && hnsFit.alignmentPoints.length > 0) {
      var alignEmoji = { strong: '🟢', partial: '🟡', weak: '🔴' }[hnsFit.alignment] || '🔴';
      hnaHtml = [
        '<section aria-label="Housing needs fit" style="margin:.75rem 0 0;padding:.5rem .75rem;',
          'background:var(--card-alt,rgba(9,110,101,.08));border-left:3px solid var(--accent,#096e65);">',
          '<h4 style="margin:0 0 .35rem;font-size:.85rem;color:var(--accent,#096e65);">',
            '🏘 Housing Needs Fit — ' + _esc(hnsFit.geography) + '</h4>',
          '<p style="margin:0 0 .25rem;font-size:.82rem;">',
            'Alignment: <strong>' + alignEmoji + ' ' + _esc(_capitalise(hnsFit.alignment)) + '</strong> · ',
            'Coverage: <strong>' + hnsFit.needCoverage.total + '%</strong>',
          '</p>',
          '<ul style="margin:.25rem 0;padding-left:1.25rem;font-size:.82rem;">',
            hnsFit.alignmentPoints.map(function (p) { return '<li>' + _esc(p) + '</li>'; }).join(''),
          '</ul>',
        '</section>'
      ].join('');
    }

    card.innerHTML = [
      '<h3 style="margin:0 0 .5rem;font-size:1.1rem;">',
        badge + ' Recommended Concept: <strong>' + headline + '</strong>',
        ' <span style="font-size:.75em;font-weight:400;color:var(--text-muted,#aaa);">' + conf + ' confidence</span>',
      '</h3>',

      '<section aria-label="Why this fits">',
        '<h4 style="margin:.75rem 0 .25rem;font-size:.9rem;">Why This Fits</h4>',
        '<ul style="margin:0;padding-left:1.25rem;">',
          (rec.keyRationale || []).map(function (r) { return '<li>' + _esc(r) + '</li>'; }).join(''),
        '</ul>',
      '</section>',

      '<section aria-label="Suggested mixes" style="display:flex;gap:1.5rem;flex-wrap:wrap;margin:.75rem 0;">',
        '<div>',
          '<h4 style="margin:0 0 .25rem;font-size:.85rem;">Unit Mix</h4>',
          '<table style="font-size:.82rem;border-collapse:collapse;">',
            _row('Studio',  unitMix.studio   || 0),
            _row('1-BR',    unitMix.oneBR    || 0),
            _row('2-BR',    unitMix.twoBR    || 0),
            _row('3-BR',    unitMix.threeBR  || 0),
          '</table>',
        '</div>',
        '<div>',
          '<h4 style="margin:0 0 .25rem;font-size:.85rem;">AMI Mix</h4>',
          '<table style="font-size:.82rem;border-collapse:collapse;">',
            _row('30% AMI', amiMix.ami30 || 0),
            _row('40% AMI', amiMix.ami40 || 0),
            _row('50% AMI', amiMix.ami50 || 0),
            _row('60% AMI', amiMix.ami60 || 0),
          '</table>',
        '</div>',
        '<div>',
          '<h4 style="margin:0 0 .25rem;font-size:.85rem;">Capital Stack (indicative)</h4>',
          '<table style="font-size:.82rem;border-collapse:collapse;">',
            _row('Total Cost',    _fmtM(stack.totalDevelopmentCost)),
            _row('Equity',        _fmtM(stack.equity)),
            _row('1st Mortgage',  _fmtM(stack.firstMortgage)),
            _row('Local Soft',    _fmtM(stack.localSoft)),
            _row('Deferred Fee',  _fmtM(stack.deferredFee)),
            (stack.gap > 0 ? _row('Gap',    _fmtM(stack.gap)) : ''),
          '</table>',
        '</div>',
      '</section>',

      (rec.keyRisks && rec.keyRisks.length > 0 ? [
        '<section aria-label="Key risks">',
          '<h4 style="margin:.75rem 0 .25rem;font-size:.9rem;color:var(--warning,#c0392b);">⚠ Key Risks</h4>',
          '<ul style="margin:0;padding-left:1.25rem;color:var(--warning,#c0392b);">',
            rec.keyRisks.map(function (r) { return '<li>' + _esc(r) + '</li>'; }).join(''),
          '</ul>',
        '</section>'
      ].join('') : ''),

      (rec.alternativePath ? [
        '<p style="margin:.75rem 0 0;font-size:.85rem;font-style:italic;">',
          '<strong>Alternative path:</strong> ' + _esc(rec.alternativePath),
        '</p>'
      ].join('') : ''),

      hnaHtml,

      '<p style="margin:.75rem 0 0;font-size:.78rem;color:var(--text-muted,#aaa);border-top:1px solid var(--border,#333);padding-top:.5rem;">',
        _esc(rec.caveats && rec.caveats[0] ? rec.caveats[0] : ''),
      '</p>',

      '<div style="margin-top:.75rem;display:flex;gap:.5rem;">',
        '<button id="lihtcExportConceptBtn" type="button" ',
          'style="padding:.35rem .9rem;font-size:.82rem;background:var(--accent,#096e65);color:#fff;',
          'border:none;border-radius:4px;cursor:pointer;">Export Concept</button>',
      '</div>'
    ].join('');

    card.hidden = false;

    var exportBtn = $id('lihtcExportConceptBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        var payload = { recommendation: rec, housingNeedsFit: hnsFit || null };
        var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        var url  = URL.createObjectURL(blob);
        var a    = document.createElement('a');
        a.href     = url;
        a.download = 'lihtc-concept-recommendation.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      });
    }

    if (window.__announceUpdate) {
      window.__announceUpdate('LIHTC concept recommendation updated: ' + headline + ', ' + conf + ' confidence.');
    }
  }

  function _capitalise(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function _fmtM(n) {
    n = parseFloat(n) || 0;
    if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000)    return '$' + Math.round(n / 1000) + 'K';
    return '$' + Math.round(n);
  }

  /* ── Render justification card ───────────────────────────────────── */
  function _renderJustification(scoreRun) {
    var card = $id('pmaJustificationCard');
    if (!card) return;

    var just = window.PMAJustification;
    if (!just) { card.hidden = true; return; }

    var narrative = just.generateNarrative(scoreRun);
    var narEl = $id('pmaJustificationNarrative');
    if (narEl) narEl.textContent = narrative;

    // Subsidy expiry risk
    var compSet = scoreRun.competitiveSet || {};
    var expiry  = compSet.subsidyExpiryRisk || [];
    var riskWrap = $id('pmaSubsidyRiskWrap');
    var riskList = $id('pmaSubsidyRiskList');
    if (riskWrap && riskList) {
      if (expiry.length) {
        riskList.innerHTML = expiry.map(function (p) {
          return '<div style="padding:.2rem 0;border-bottom:1px solid var(--border,#333);">' +
                 '<strong>' + _esc(p.property) + '</strong> — expiry ' + (p.expiryYear || 'unknown') +
                 ', ' + (p.atRiskUnits || '?') + ' units at risk</div>';
        }).join('');
        riskWrap.hidden = false;
      } else {
        riskWrap.hidden = true;
      }
    }

    // Incentive eligibility badges
    var badgeWrap = $id('pmaIncentiveBadges');
    if (badgeWrap) {
      var opps = scoreRun.opportunities || {};
      var elig = opps.incentiveEligibility || {};
      var badges = [];
      if (elig.qualifiedOpportunityZone) badges.push({ label: 'Opportunity Zone', color: '#1a6b3c' });
      if (elig.lihtcBasisStepDown)       badges.push({ label: 'LIHTC Basis Step-down', color: '#096e65' });
      if (elig.newMarketsTaxCredit)       badges.push({ label: 'NMTC Eligible', color: '#6b4800' });
      badgeWrap.innerHTML = badges.map(function (b) {
        return '<span style="display:inline-block;padding:.2rem .6rem;border-radius:12px;font-size:.75em;' +
               'background:' + b.color + ';color:#fff;">' + _esc(b.label) + '</span>';
      }).join('');
    }

    card.hidden = false;
  }

  function _esc(str) {
    return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── Main analysis trigger ───────────────────────────────────────── */
  function _runEnhancedAnalysis(lat, lon) {
    if (_running) return;
    var runner = window.PMAAnalysisRunner;
    if (!runner) return;   // fall through to existing buffer flow

    _running = true;
    _progressShow();
    _progressUpdate({ index: 0, total: 9, label: 'Starting analysis…', pct: 0 });

    var explainBtn = $id('pmaExplainScoreBtn');
    if (explainBtn) explainBtn.hidden = true;

    var proposed = parseInt(($id('pmaProposedUnits') || {}).value || '100', 10) || 100;

    runner.run(lat, lon, {
      method:        _method,
      bufferMiles:   _bufferMiles,
      proposedUnits: proposed
    })
    .on('progress', _progressUpdate)
    .on('complete', function (scoreRun) {
      _lastScoreRun = scoreRun;
      _running = false;
      _progressComplete();
      _renderJustification(scoreRun);
      _renderConceptCard(scoreRun);
      if (explainBtn) explainBtn.hidden = false;
    })
    .on('error', function (err) {
      _running = false;
      _progressHide();
      console.error('[PMAUIController] Analysis error:', err);
    });
  }

  /* ── Tab switching ───────────────────────────────────────────────── */
  function _initTabs() {
    var tabs   = document.querySelectorAll('[data-pma-method]');
    var panels = {
      buffer:    $id('pmaMethodPanel-buffer'),
      commuting: $id('pmaMethodPanel-commuting'),
      hybrid:    $id('pmaMethodPanel-hybrid')
    };
    var layerPickerWrap = $id('pmaLayerPickerWrap');
    var bufferSelect    = $id('pmaBufferSelect');

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) {
          t.setAttribute('aria-selected', 'false');
          t.classList.remove('pma-tab--active');
        });
        tab.setAttribute('aria-selected', 'true');
        tab.classList.add('pma-tab--active');

        _method = tab.dataset.pmaMethod || 'buffer';

        Object.keys(panels).forEach(function (k) {
          if (panels[k]) panels[k].hidden = (k !== _method);
        });

        // Show layer picker for non-buffer modes
        if (layerPickerWrap) layerPickerWrap.hidden = (_method === 'buffer');

        // Buffer select only relevant in buffer mode
        if (bufferSelect) bufferSelect.disabled = (_method !== 'buffer');
      });
    });

    // Buffer radius change
    if (bufferSelect) {
      bufferSelect.addEventListener('change', function () {
        _bufferMiles = parseInt(bufferSelect.value, 10) || 5;
      });
    }
  }

  /* ── Intercept existing Run Analysis button ──────────────────────── */
  function _initRunButton() {
    var runBtn = $id('pmaRunBtn');
    if (!runBtn) return;

    runBtn.addEventListener('click', function () {
      // Only intercept non-buffer modes (buffer flow handled by market-analysis.js)
      if (_method === 'buffer') return;

      // Read coords from pmaSiteCoords or from Leaflet marker if available
      var lat, lon;
      var siteCoords = ($id('pmaSiteCoords') || {}).textContent || '';
      var m = siteCoords.match(/([\d.\-]+)\s*,\s*([\d.\-]+)/);
      if (m) {
        lat = parseFloat(m[1]);
        lon = parseFloat(m[2]);
      } else if (window.PMAEngine && window.PMAEngine._lastLat) {
        lat = window.PMAEngine._lastLat;
        lon = window.PMAEngine._lastLon;
      }

      if (!lat || !lon) {
        // No site placed yet — let existing flow show its own message
        return;
      }

      // For commuting/hybrid: run enhanced pipeline in parallel with
      // the existing ACS scoring (which the original click handler still fires)
      _runEnhancedAnalysis(lat, lon);
    }, true);   // capture phase — fires before market-analysis.js handler
  }

  /* ── Explain Score button ────────────────────────────────────────── */
  function _initExplainScore() {
    var btn = $id('pmaExplainScoreBtn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      // In enhanced (commuting / hybrid) mode _lastScoreRun is set by the runner.
      // In buffer mode, fall back to the result stored in PMAEngine._state.
      var scoreRun = _lastScoreRun ||
        (window.PMAEngine && window.PMAEngine._state && window.PMAEngine._state.getLastResult
          ? window.PMAEngine._state.getLastResult()
          : null);

      if (!scoreRun) {
        alert('No analysis has been run yet — click a location on the map first.');
        return;
      }

      var just = window.PMAJustification;
      if (!just) {
        // Fallback summary when PMAJustification module is not loaded (buffer mode)
        var r = scoreRun;
        var lines = [
          'Score: '            + (r.pma_score != null ? r.pma_score : '—'),
          'Buffer radius: '    + (r.bufferMiles || '—') + ' miles',
          'Tracts in buffer: ' + (r.tractCount  || '—'),
          'Population: '       + (r.acs && r.acs.pop ? r.acs.pop.toLocaleString() : '—'),
          'Renter households: '+ (r.acs && r.acs.renter_hh ? r.acs.renter_hh.toLocaleString() : '—'),
          'Median gross rent: '+ (r.acs && r.acs.median_gross_rent
              ? '$' + Math.round(r.acs.median_gross_rent).toLocaleString() : '—'),
          'Median HH income: ' + (r.acs && r.acs.median_hh_income
              ? '$' + Math.round(r.acs.median_hh_income).toLocaleString() : '—'),
          'Cost burden rate: ' + (r.acs && r.acs.cost_burden_rate != null
              ? (r.acs.cost_burden_rate * 100).toFixed(1) + '%' : '—'),
          'LIHTC projects: '   + (r.lihtcCount  != null ? r.lihtcCount  : '—'),
          'LIHTC units: '      + (r.lihtcUnits  != null ? r.lihtcUnits  : '—'),
          '',
          'See browser console for full result object.'
        ];
        console.log('[PMAExplainScore] Buffer-mode result:', r);
        alert(lines.join('\n'));
        return;
      }

      var trail = just.generateAuditTrail(scoreRun);
      var info = [
        'Run ID: '       + trail.run_id,
        'Data vintage: ' + trail.data_vintage,
        'LODES vintage: ' + trail.lodes_vintage,
        'Quality: '      + trail.data_quality,
        '',
        'Decision layers: ' + (trail.layers || []).join(', '),
        '',
        'See browser console (PMAJustification: Audit Trail) for full details.'
      ].join('\n');
      console.log('[PMAJustification] Audit Trail:', trail);
      alert(info);
    });
  }

  /* ── Export Audit Trail JSON ─────────────────────────────────────── */
  function _initExportAudit() {
    var btn = $id('pmaExportAuditJson');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var just = window.PMAJustification;
      if (!just) { alert('PMAJustification module not loaded.'); return; }
      var json  = just.exportToJSON(_lastScoreRun);
      var blob  = new Blob([json], { type: 'application/json' });
      var url   = URL.createObjectURL(blob);
      var a     = document.createElement('a');
      a.href    = url;
      a.download = 'pma-audit-trail.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  /* ── Bootstrap ───────────────────────────────────────────────────── */
  function _init() {
    _injectStyle();
    _initTabs();
    _initRunButton();
    _initExplainScore();
    _initExportAudit();
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _init);
    } else {
      _init();
    }
  }

  /* ── Public API (minimal, for testing) ──────────────────────────── */
  if (typeof window !== 'undefined') {
    window.PMAUIController = {
      getMethod:      function () { return _method; },
      getLastScoreRun: function () { return _lastScoreRun; },
      runEnhanced:    _runEnhancedAnalysis
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getMethod: function () { return _method; } };
  }

}());
