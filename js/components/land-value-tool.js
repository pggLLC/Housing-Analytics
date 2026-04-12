/**
 * js/components/land-value-tool.js
 * Land Value Estimation & Negotiation Support Tool
 *
 * EDUCATIONAL + EARLY-STAGE DECISION SUPPORT — NOT AN APPRAISAL.
 *
 * Provides two valuation approaches:
 *   1. Comparable Sales (user enters manual comps)
 *   2. Residual Land Value (backs into what a developer can pay)
 *
 * Outputs:
 *   - Market value range (from comps)
 *   - Supportable developer bid (residual)
 *   - Negotiation band (visual)
 *   - Confidence score (based on input completeness)
 *
 * This tool does NOT:
 *   - Replace a professional appraisal (MAI or state-certified)
 *   - Access real-time MLS or assessor data (Bridge token optional)
 *   - Account for entitlement risk, remediation costs, or off-site improvements
 *   - Provide investment advice
 *
 * Exposes window.LandValueTool.
 */
(function () {
  'use strict';

  /* ── Helpers ─────────────────────────────────────────────────────── */
  function _n(v, fb) { var n = parseFloat(v); return isFinite(n) ? n : (fb || 0); }
  function _fmt(n) { return n >= 1000000 ? '$' + (n / 1000000).toFixed(2) + 'M' : '$' + Math.round(n).toLocaleString(); }
  function _fmtAcre(n) { return '$' + Math.round(n).toLocaleString() + '/acre'; }
  function _fmtUnit(n) { return '$' + Math.round(n).toLocaleString() + '/unit'; }
  function _pct(n) { return (n * 100).toFixed(1) + '%'; }
  function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* ── Confidence scoring ──────────────────────────────────────────── */
  function computeConfidence(state) {
    var pts = 0, max = 0;

    // Comps (up to 40 pts)
    max += 40;
    var compCount = (state.comps || []).length;
    if (compCount >= 3) pts += 40;
    else if (compCount >= 2) pts += 25;
    else if (compCount >= 1) pts += 10;

    // Residual inputs (up to 30 pts)
    max += 30;
    if (state.tdc > 0) pts += 10;
    if (state.totalUnits > 0) pts += 10;
    if (state.equityAndDebt > 0) pts += 10;

    // Site specifics (up to 30 pts)
    max += 30;
    if (state.siteAcres > 0) pts += 15;
    if (state.zoning) pts += 10;
    if (state.publicLandDiscount > 0) pts += 5;

    var score = Math.round((pts / max) * 100);
    var level = score >= 70 ? 'moderate' : score >= 40 ? 'low' : 'very-low';
    return { score: score, level: level, pts: pts, max: max };
  }

  /* ── Residual land value calculation ─────────────────────────────── */
  function computeResidual(state) {
    var tdc = _n(state.tdc);
    var equityAndDebt = _n(state.equityAndDebt);
    var softSources = _n(state.softSources);
    var deferredFee = _n(state.deferredFee);

    // Residual = what's left after all other sources cover TDC
    // This is the MAXIMUM a developer can pay for land
    var totalSources = equityAndDebt + softSources + deferredFee;
    var residual = totalSources - (tdc - _n(state.landBudget || 0));

    // If user hasn't entered a land budget, compute it as the gap
    if (!state.landBudget) {
      residual = totalSources - tdc;
    }

    // Adjustments
    var offSiteCosts = _n(state.offSiteCosts);
    var remediationCosts = _n(state.remediationCosts);
    var adjustedResidual = Math.max(0, residual - offSiteCosts - remediationCosts);

    var totalUnits = _n(state.totalUnits) || 1;
    var siteAcres = _n(state.siteAcres) || 1;

    return {
      grossResidual:    Math.max(0, residual),
      adjustedResidual: adjustedResidual,
      perUnit:          Math.round(adjustedResidual / totalUnits),
      perAcre:          Math.round(adjustedResidual / siteAcres),
      offSiteCosts:     offSiteCosts,
      remediationCosts: remediationCosts
    };
  }

  /* ── Comp analysis ───────────────────────────────────────────────── */
  function analyzeComps(comps, siteAcres) {
    if (!comps || !comps.length) return null;

    var prices = comps.map(function (c) { return _n(c.pricePerAcre); }).filter(function (p) { return p > 0; });
    if (!prices.length) return null;

    prices.sort(function (a, b) { return a - b; });
    var min = prices[0];
    var max = prices[prices.length - 1];
    var median = prices.length % 2 === 0
      ? (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2
      : prices[Math.floor(prices.length / 2)];
    var mean = prices.reduce(function (s, p) { return s + p; }, 0) / prices.length;

    var acres = _n(siteAcres) || 1;
    return {
      count:       prices.length,
      minPerAcre:  Math.round(min),
      maxPerAcre:  Math.round(max),
      medianPerAcre: Math.round(median),
      meanPerAcre: Math.round(mean),
      estimatedValue: Math.round(median * acres),
      rangeValue: { low: Math.round(min * acres), high: Math.round(max * acres) }
    };
  }

  /* ── Negotiation band ────────────────────────────────────────────── */
  function computeNegotiationBand(compAnalysis, residual, publicDiscount) {
    var band = { seller: 0, market: 0, developer: 0, publicPartner: 0 };

    // Seller's ask: high end of comps (or market if no comps)
    band.seller = compAnalysis ? compAnalysis.rangeValue.high : 0;

    // Market value: median of comps
    band.market = compAnalysis ? compAnalysis.estimatedValue : 0;

    // Developer's max bid: adjusted residual
    band.developer = residual ? residual.adjustedResidual : 0;

    // Public partner contribution: market value * discount
    var discount = _n(publicDiscount) / 100;
    band.publicPartner = Math.round(band.market * (1 - discount));

    return band;
  }

  /* ── Render ──────────────────────────────────────────────────────── */
  function render(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;

    el.innerHTML =
      '<div class="lvt-tool">' +
        '<div class="lvt-header">' +
          '<h3 class="lvt-title">Land Value & Negotiation Support</h3>' +
          '<p class="lvt-subtitle">Educational tool for estimating site acquisition cost and identifying negotiation range. This is NOT an appraisal.</p>' +
        '</div>' +

        // Site Basics
        '<div class="lvt-section">' +
          '<h4 class="lvt-section-title">Site Basics</h4>' +
          '<div class="lvt-row">' +
            '<label class="lvt-label">Site size (acres)<input type="number" id="lvtAcres" class="lvt-input" step="0.1" min="0" placeholder="e.g. 3.5"></label>' +
            '<label class="lvt-label">Proposed units<input type="number" id="lvtUnits" class="lvt-input" min="1" placeholder="e.g. 60"></label>' +
            '<label class="lvt-label">Current zoning<select id="lvtZoning" class="lvt-input">' +
              '<option value="">— Select —</option>' +
              '<option value="mf-right">Multifamily by-right</option>' +
              '<option value="mf-cup">Multifamily with CUP</option>' +
              '<option value="rezone">Requires rezoning</option>' +
              '<option value="mixed">Mixed-use</option>' +
              '<option value="commercial">Commercial (conversion)</option>' +
              '<option value="other">Other</option>' +
            '</select></label>' +
          '</div>' +
        '</div>' +

        // Comparable Sales
        '<div class="lvt-section">' +
          '<h4 class="lvt-section-title">Comparable Sales (manual entry)</h4>' +
          '<p class="lvt-note">Enter 3+ recent land sales of similar zoning within 5 miles. More comps = higher confidence. Check county assessor records, LoopNet, or local brokers.</p>' +
          '<div id="lvtCompsContainer">' +
            _compRow(1) + _compRow(2) + _compRow(3) +
          '</div>' +
          '<button type="button" id="lvtAddComp" class="lvt-btn-secondary">+ Add another comp</button>' +
        '</div>' +

        // Residual Approach
        '<div class="lvt-section">' +
          '<h4 class="lvt-section-title">Residual Land Value (what can the project afford?)</h4>' +
          '<p class="lvt-note">This calculates the maximum a developer can pay for land based on project economics. Pull values from your Deal Calculator if available.</p>' +
          '<div class="lvt-row">' +
            '<label class="lvt-label">Total Development Cost (excl. land)<input type="number" id="lvtTdc" class="lvt-input" step="100000" min="0" placeholder="e.g. 18000000"></label>' +
            '<label class="lvt-label">LIHTC equity + first mortgage<input type="number" id="lvtEquityDebt" class="lvt-input" step="100000" min="0" placeholder="e.g. 16000000"></label>' +
          '</div>' +
          '<div class="lvt-row">' +
            '<label class="lvt-label">Soft sources (HTF, HOME, local)<input type="number" id="lvtSoft" class="lvt-input" step="50000" min="0" placeholder="e.g. 1500000"></label>' +
            '<label class="lvt-label">Deferred developer fee<input type="number" id="lvtDeferred" class="lvt-input" step="50000" min="0" placeholder="e.g. 500000"></label>' +
          '</div>' +
          '<div class="lvt-row">' +
            '<label class="lvt-label">Estimated off-site costs (roads, utilities)<input type="number" id="lvtOffsite" class="lvt-input" step="50000" min="0" placeholder="e.g. 250000"></label>' +
            '<label class="lvt-label">Estimated remediation costs<input type="number" id="lvtRemediation" class="lvt-input" step="50000" min="0" placeholder="e.g. 0"></label>' +
          '</div>' +
        '</div>' +

        // Public Partnership Discount
        '<div class="lvt-section">' +
          '<h4 class="lvt-section-title">Public Land / Partnership Discount</h4>' +
          '<div class="lvt-row">' +
            '<label class="lvt-label">Below-market discount (%)<input type="number" id="lvtDiscount" class="lvt-input" min="0" max="100" step="5" placeholder="e.g. 50" value="0"></label>' +
            '<div class="lvt-help">If a public entity offers land at below market value, enter the discount. 100% = donated land. 50% = half market price.</div>' +
          '</div>' +
        '</div>' +

        // Calculate button
        '<div style="text-align:center;margin:1rem 0;">' +
          '<button type="button" id="lvtCalculate" class="lvt-btn-primary">Calculate Land Value Range</button>' +
        '</div>' +

        // Results
        '<div id="lvtResults" style="display:none;"></div>' +

        // Disclaimer
        '<div class="lvt-disclaimer">' +
          '<strong>Not an appraisal.</strong> This tool provides educational estimates for early-stage negotiation context. ' +
          'It does not replace a professional MAI appraisal, broker opinion of value (BOV), or title/survey review. ' +
          'Comparable sales should be verified with county records. Residual values assume the deal calculator inputs are accurate.' +
        '</div>' +
      '</div>';

    // Wire events
    var calcBtn = document.getElementById('lvtCalculate');
    var addBtn = document.getElementById('lvtAddComp');
    if (calcBtn) calcBtn.addEventListener('click', _calculate);
    if (addBtn) addBtn.addEventListener('click', _addComp);
  }

  var _compIndex = 3;

  function _compRow(i) {
    return '<div class="lvt-comp-row" data-comp="' + i + '">' +
      '<input type="text" class="lvt-input lvt-comp-addr" placeholder="Address / description" style="flex:2;">' +
      '<input type="number" class="lvt-input lvt-comp-acres" placeholder="Acres" step="0.1" min="0" style="flex:.7;">' +
      '<input type="number" class="lvt-input lvt-comp-price" placeholder="Sale price ($)" step="10000" min="0" style="flex:1;">' +
      '<input type="text" class="lvt-input lvt-comp-date" placeholder="Date (YYYY)" style="flex:.6;">' +
      '</div>';
  }

  function _addComp() {
    _compIndex++;
    var container = document.getElementById('lvtCompsContainer');
    if (container) {
      var div = document.createElement('div');
      div.innerHTML = _compRow(_compIndex);
      container.appendChild(div.firstChild);
    }
  }

  function _gatherState() {
    var comps = [];
    var rows = document.querySelectorAll('.lvt-comp-row');
    rows.forEach(function (row) {
      var acres = _n(row.querySelector('.lvt-comp-acres').value);
      var price = _n(row.querySelector('.lvt-comp-price').value);
      if (price > 0 && acres > 0) {
        comps.push({
          address: row.querySelector('.lvt-comp-addr').value || '',
          acres: acres,
          salePrice: price,
          pricePerAcre: price / acres,
          date: row.querySelector('.lvt-comp-date').value || ''
        });
      }
    });

    return {
      siteAcres:        _n(document.getElementById('lvtAcres').value),
      totalUnits:       _n(document.getElementById('lvtUnits').value),
      zoning:           document.getElementById('lvtZoning').value,
      comps:            comps,
      tdc:              _n(document.getElementById('lvtTdc').value),
      equityAndDebt:    _n(document.getElementById('lvtEquityDebt').value),
      softSources:      _n(document.getElementById('lvtSoft').value),
      deferredFee:      _n(document.getElementById('lvtDeferred').value),
      offSiteCosts:     _n(document.getElementById('lvtOffsite').value),
      remediationCosts: _n(document.getElementById('lvtRemediation').value),
      publicLandDiscount: _n(document.getElementById('lvtDiscount').value)
    };
  }

  function _calculate() {
    var state = _gatherState();
    var conf = computeConfidence(state);
    var compResult = analyzeComps(state.comps, state.siteAcres);
    var residual = computeResidual(state);
    var band = computeNegotiationBand(compResult, residual, state.publicLandDiscount);

    _renderResults(state, conf, compResult, residual, band);
  }

  function _renderResults(state, conf, compResult, residual, band) {
    var el = document.getElementById('lvtResults');
    if (!el) return;

    var confCls = conf.level === 'moderate' ? 'dqs-ok' : conf.level === 'low' ? 'dqs-warn' : 'dqs-error';

    // Confidence
    var html = '<div class="lvt-results-header">' +
      '<div class="lvt-conf">' +
        '<span class="dqs-status-dot ' + confCls + '"></span> ' +
        'Confidence: <strong>' + conf.score + '/100</strong> (' + conf.level.replace('-', ' ') + ')' +
      '</div>' +
      '<div class="lvt-conf-note">' +
        (conf.score < 40 ? 'Add more comparable sales and project details to improve confidence.' :
         conf.score < 70 ? 'Reasonable screening estimate. Verify with professional appraisal before offers.' :
         'Good data coverage for screening purposes. Still requires professional validation.') +
      '</div>' +
    '</div>';

    // Comp Results
    if (compResult) {
      html += '<div class="lvt-result-card">' +
        '<h4 class="lvt-result-title">Market Value Estimate (from comps)</h4>' +
        '<div class="lvt-result-grid">' +
          '<div class="lvt-metric"><div class="lvt-metric-val">' + _fmt(compResult.estimatedValue) + '</div><div class="lvt-metric-lbl">Median estimate</div></div>' +
          '<div class="lvt-metric"><div class="lvt-metric-val">' + _fmt(compResult.rangeValue.low) + ' — ' + _fmt(compResult.rangeValue.high) + '</div><div class="lvt-metric-lbl">Comp range</div></div>' +
          '<div class="lvt-metric"><div class="lvt-metric-val">' + _fmtAcre(compResult.medianPerAcre) + '</div><div class="lvt-metric-lbl">Median $/acre</div></div>' +
          '<div class="lvt-metric"><div class="lvt-metric-val">' + compResult.count + ' comp' + (compResult.count > 1 ? 's' : '') + '</div><div class="lvt-metric-lbl">Used</div></div>' +
        '</div>' +
      '</div>';
    }

    // Residual Results
    if (residual.grossResidual > 0 || state.tdc > 0) {
      html += '<div class="lvt-result-card">' +
        '<h4 class="lvt-result-title">Supportable Developer Bid (residual)</h4>' +
        '<div class="lvt-result-grid">' +
          '<div class="lvt-metric"><div class="lvt-metric-val">' + _fmt(residual.adjustedResidual) + '</div><div class="lvt-metric-lbl">Max supportable bid</div></div>' +
          '<div class="lvt-metric"><div class="lvt-metric-val">' + _fmtUnit(residual.perUnit) + '</div><div class="lvt-metric-lbl">Per proposed unit</div></div>' +
          '<div class="lvt-metric"><div class="lvt-metric-val">' + _fmtAcre(residual.perAcre) + '</div><div class="lvt-metric-lbl">Per acre</div></div>' +
          (residual.grossResidual !== residual.adjustedResidual
            ? '<div class="lvt-metric"><div class="lvt-metric-val" style="color:var(--warn);">-' + _fmt(residual.offSiteCosts + residual.remediationCosts) + '</div><div class="lvt-metric-lbl">Deductions (offsite + remediation)</div></div>'
            : '') +
        '</div>' +
        (residual.adjustedResidual <= 0
          ? '<div class="lvt-warning">The project cannot support any land acquisition cost. Consider public land donation, ground lease, or restructuring the capital stack.</div>'
          : '') +
      '</div>';
    }

    // Negotiation Band
    if (band.seller > 0 || band.developer > 0) {
      var maxVal = Math.max(band.seller, band.market, band.developer, band.publicPartner || 0) || 1;
      var _bar = function (val, label, color) {
        var pct = Math.round((val / maxVal) * 100);
        return '<div class="lvt-band-row">' +
          '<div class="lvt-band-label">' + label + '</div>' +
          '<div class="lvt-band-bar-bg">' +
            '<div class="lvt-band-bar" style="width:' + pct + '%;background:' + color + ';">' + _fmt(val) + '</div>' +
          '</div>' +
        '</div>';
      };

      html += '<div class="lvt-result-card">' +
        '<h4 class="lvt-result-title">Negotiation Band</h4>' +
        '<div class="lvt-band">' +
          _bar(band.seller, 'Seller\'s ask (high comp)', 'var(--bad, #dc2626)') +
          _bar(band.market, 'Market value (median comp)', 'var(--warn, #d97706)') +
          (band.publicPartner > 0 && band.publicPartner < band.market
            ? _bar(band.publicPartner, 'Public partner price (' + _n(state.publicLandDiscount) + '% discount)', 'var(--accent, #0d9488)')
            : '') +
          _bar(band.developer, 'Developer\'s max bid (residual)', 'var(--good, #059669)') +
        '</div>' +
        '<div class="lvt-band-note">' +
          (band.developer >= band.market
            ? 'The project can support market-rate land acquisition. Negotiate for best price.'
            : band.developer >= band.publicPartner && band.publicPartner > 0
              ? 'The project needs a below-market price but may work with a public partnership discount.'
              : band.developer > 0
                ? 'Significant gap between market value and what the project can afford. Public land contribution or donation likely required.'
                : 'The project cannot support land acquisition at any price. Consider donated or ground-leased sites only.') +
        '</div>' +
      '</div>';
    }

    el.innerHTML = html;
    el.style.display = 'block';
  }

  /* ── Public API ──────────────────────────────────────────────────── */
  window.LandValueTool = {
    render:                render,
    computeConfidence:     computeConfidence,
    computeResidual:       computeResidual,
    analyzeComps:          analyzeComps,
    computeNegotiationBand: computeNegotiationBand
  };
})();
