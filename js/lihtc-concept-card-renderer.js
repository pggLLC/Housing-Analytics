/**
 * js/lihtc-concept-card-renderer.js
 * Full-featured LIHTC concept recommendation card renderer.
 *
 * Renders a complete, accessible concept recommendation card that replaces
 * the minimal stub used in buffer mode.  Works for both the map-click
 * (buffer) flow and the enhanced PMA (commuting/hybrid) flow.
 *
 * Features rendered:
 *   • Recommended execution (4% vs 9%) with confidence badge (🟢🟡🔴)
 *   • Concept type and estimated total unit count
 *   • Suggested unit mix (studio, 1BR, 2BR, 3BR+)
 *   • Suggested AMI mix (30%, 50%, 60%) with unit counts
 *   • Why this fits — 3–4 rationale bullets
 *   • Key risks — ⚠ warning flags
 *   • Alternative path (when applicable)
 *   • Indicative capital stack (collapsible <details>)
 *   • Important caveats (yellow warning box)
 *   • Housing Needs Fit section — HNA alignment, coverage %, gaps
 *   • Export JSON button
 *
 * Depends on (all optional — card gracefully degrades):
 *   window.HousingNeedsFitAnalyzer — housing-needs-fit-analyzer.js
 *
 * Exposes: window.LIHTCConceptCardRenderer
 */
(function () {
  'use strict';

  /* ── Style injection (runs once) ─────────────────────────────────── */
  var _styleInjected = false;

  function _injectStyle() {
    if (_styleInjected || typeof document === 'undefined') return;
    _styleInjected = true;
    var s = document.createElement('style');
    s.textContent = [
      /* Card-level layout */
      '.lihtc-cc{font-family:inherit;font-size:.9rem;line-height:1.45;}',
      '.lihtc-cc h3{margin:0 0 .75rem;font-size:1.05rem;}',
      '.lihtc-cc h4{margin:.75rem 0 .35rem;font-size:.85rem;font-weight:600;}',
      '.lihtc-cc ul{margin:.25rem 0;padding-left:1.3rem;}',
      '.lihtc-cc li{margin:.2rem 0;}',
      /* Mix tables */
      '.lihtc-cc-mixes{display:flex;gap:1.5rem;flex-wrap:wrap;margin:.5rem 0 .25rem;}',
      '.lihtc-cc table{font-size:.82rem;border-collapse:collapse;}',
      '.lihtc-cc td{padding:.2rem .5rem;}',
      '.lihtc-cc td:first-child{color:var(--text-muted,#aaa);}',
      '.lihtc-cc td:last-child{font-weight:600;}',
      /* Risk section */
      '.lihtc-cc-risks{color:var(--warning,#c0392b);}',
      '.lihtc-cc-risks h4{color:inherit;}',
      '.lihtc-cc-risks li{color:inherit;}',
      /* Capital stack */
      '.lihtc-cc details{margin:.75rem 0;}',
      '.lihtc-cc summary{cursor:pointer;font-size:.85rem;font-weight:600;',
      '  padding:.3rem 0;list-style:none;}',
      '.lihtc-cc summary::before{content:"▶ ";}',
      '.lihtc-cc details[open] summary::before{content:"▼ ";}',
      /* Caveats */
      '.lihtc-cc-caveat{margin:.75rem 0 0;padding:.5rem .75rem;',
      '  background:var(--warning-bg,rgba(243,156,18,.1));',
      '  border-left:3px solid var(--warning-accent,#f39c12);',
      '  font-size:.8rem;color:var(--text-muted,#aaa);}',
      /* HNA section */
      '.lihtc-cc-hna{margin:.75rem 0 0;padding:.5rem .75rem;',
      '  background:var(--card-alt,rgba(9,110,101,.08));',
      '  border-left:3px solid var(--accent,#096e65);',
      '  border-radius:0 4px 4px 0;}',
      '.lihtc-cc-hna h4{margin:.25rem 0 .4rem;color:var(--accent,#096e65);}',
      '.lihtc-cc-hna-coverage{display:flex;gap:.75rem;flex-wrap:wrap;margin:.35rem 0;}',
      '.lihtc-cc-hna-bar{display:inline-block;width:100%;height:6px;',
      '  background:var(--border,#333);border-radius:3px;overflow:hidden;',
      '  vertical-align:middle;}',
      '.lihtc-cc-hna-fill{display:block;height:100%;',
      '  background:var(--accent,#096e65);border-radius:3px;}',
      '.lihtc-cc-hna-tier{font-size:.78rem;min-width:90px;}',
      '.lihtc-cc-badge-strong{color:#096e65;}',
      '.lihtc-cc-badge-partial{color:#f39c12;}',
      '.lihtc-cc-badge-weak{color:#c0392b;}',
      /* Actions */
      '.lihtc-cc-actions{margin-top:.75rem;display:flex;gap:.5rem;flex-wrap:wrap;}',
      '.lihtc-cc-btn{padding:.35rem .9rem;font-size:.82rem;border:none;',
      '  border-radius:4px;cursor:pointer;}',
      '.lihtc-cc-btn-primary{background:var(--accent,#096e65);color:#fff;}',
      '.lihtc-cc-btn-primary:hover{opacity:.9;}',
    ].join('');
    document.head.appendChild(s);
  }

  /* ── Utilities ───────────────────────────────────────────────────── */

  /** HTML-escape a string. */
  function _esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Capitalise first letter. */
  function _cap(str) {
    if (!str) return '';
    return String(str).charAt(0).toUpperCase() + String(str).slice(1);
  }

  /** Format dollar amount as "$1.4M" / "$250K" / "$18K". */
  function _fmtM(n) {
    n = parseFloat(n) || 0;
    if (n >= 1e6)  return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1000) return '$' + Math.round(n / 1000) + 'K';
    return '$' + Math.round(n);
  }

  /** Build an HTML table row with a label/value pair. */
  function _trow(label, value) {
    return '<tr><td>' + _esc(label) + '</td><td>' + _esc(String(value)) + '</td></tr>';
  }

  /** Sum all numeric values in an object. */
  function _sumObj(obj) {
    return Object.keys(obj || {}).reduce(function (s, k) {
      var n = parseFloat(obj[k]) || 0;
      return s + n;
    }, 0);
  }

  /* ── HNA section builder ─────────────────────────────────────────── */

  function _buildHnaSection(hnsFit) {
    if (!hnsFit || hnsFit.coveragePct == null) return '';

    var alignLabel = { strong: '🟢 Strong', partial: '🟡 Partial', weak: '🔴 Weak' }[hnsFit.alignment] || hnsFit.alignment;
    var alignClass = 'lihtc-cc-badge-' + (hnsFit.alignment || 'weak');

    var tierBars = [
      { label: '30% AMI', pct: hnsFit.needCoverage.ami30 },
      { label: '50% AMI', pct: hnsFit.needCoverage.ami50 },
      { label: '60% AMI', pct: hnsFit.needCoverage.ami60 }
    ].filter(function (t) { return t.pct > 0; }).map(function (t) {
      return '<div class="lihtc-cc-hna-tier">' +
        '<span style="font-size:.75rem;">' + _esc(t.label) + ' — ' + t.pct + '% coverage</span>' +
        '<span class="lihtc-cc-hna-bar" role="img" aria-label="' + _esc(t.label) + ' coverage ' + t.pct + '%">' +
        '<span class="lihtc-cc-hna-fill" style="width:' + t.pct + '%"></span></span>' +
        '</div>';
    }).join('');

    var pointsList = (hnsFit.alignmentPoints || []).map(function (p) {
      return '<li>' + _esc(p) + '</li>';
    }).join('');

    var gapsList = hnsFit.gaps && hnsFit.gaps.length > 0
      ? '<p style="margin:.4rem 0 0;font-size:.78rem;color:var(--text-muted,#aaa);">' +
        '<strong>Un-addressed gaps:</strong> ' +
        _esc(hnsFit.gaps.join(' · ')) + '</p>'
      : '';

    return [
      '<section class="lihtc-cc-hna" aria-label="Housing needs fit">',
        '<h4>🏘 Housing Needs Fit — ' + _esc(hnsFit.geography) + '</h4>',
        '<p style="margin:0 0 .35rem;font-size:.82rem;">',
          'Alignment: <strong class="' + alignClass + '">' + alignLabel + '</strong> · ',
          'Need coverage: <strong>' + hnsFit.needCoverage.total + '%</strong>',
        '</p>',
        tierBars ? '<div class="lihtc-cc-hna-coverage">' + tierBars + '</div>' : '',
        '<ul style="margin:.35rem 0;padding-left:1.25rem;font-size:.82rem;">' + pointsList + '</ul>',
        gapsList,
      '</section>'
    ].join('');
  }

  /* ── Capital stack builder ───────────────────────────────────────── */

  function _buildStackSection(stack) {
    if (!stack || !stack.totalDevelopmentCost) return '';
    return [
      '<details>',
        '<summary>Indicative Capital Stack</summary>',
        '<table style="margin-top:.35rem;">',
          _trow('Total Dev Cost',  _fmtM(stack.totalDevelopmentCost)),
          _trow('LIHTC Equity',    _fmtM(stack.equity)),
          _trow('1st Mortgage',    _fmtM(stack.firstMortgage)),
          _trow('Local Soft',      _fmtM(stack.localSoft)),
          _trow('Deferred Dev Fee',_fmtM(stack.deferredFee)),
          (parseFloat(stack.gap) > 0 ? _trow('Remaining Gap', _fmtM(stack.gap)) : ''),
        '</table>',
        '<p style="margin:.4rem 0 0;font-size:.75rem;color:var(--text-muted,#aaa);">',
          'Rough order-of-magnitude estimate only. Engage a LIHTC syndicator for current equity pricing.',
        '</p>',
      '</details>'
    ].join('');
  }

  /* ── Main render ─────────────────────────────────────────────────── */

  /**
   * Renders the full concept card into `container`.
   *
   * @param {HTMLElement}  container  - Target DOM element (e.g. #lihtcConceptCard).
   * @param {Object}       rec        - DealRecommendation from LIHTCDealPredictor.predictConcept().
   * @param {Object|null}  [hnsFit]   - Optional HNSFit from HousingNeedsFitAnalyzer.analyzeHousingNeedsFit().
   */
  function render(container, rec, hnsFit) {
    if (!container || !rec) return;
    _injectStyle();

    var badge    = rec.confidenceBadge || '';
    var conf     = _cap(rec.confidence || 'unknown');
    var exec     = _esc(rec.recommendedExecution || '');
    var concept  = _esc(rec.conceptType || '');
    var headline = exec + ' ' + _cap(concept) + ' Housing';

    var unitMix = rec.suggestedUnitMix  || {};
    var amiMix  = rec.suggestedAMIMix   || {};
    var stack   = rec.indicativeCapitalStack || {};

    var totalUnits = _sumObj(unitMix) || rec.totalUnits || 0;

    /* ── Unit mix table ──────────────────────────────────────────── */
    var unitRows = [];
    if (unitMix.studio  != null) unitRows.push(_trow('Studio',  unitMix.studio  + ' units'));
    if (unitMix.oneBR   != null) unitRows.push(_trow('1-BR',    unitMix.oneBR   + ' units'));
    if (unitMix.twoBR   != null) unitRows.push(_trow('2-BR',    unitMix.twoBR   + ' units'));
    if (unitMix.threeBR != null) unitRows.push(_trow('3-BR',    unitMix.threeBR + ' units'));
    if (unitMix.fourBRPlus != null && unitMix.fourBRPlus > 0) {
      unitRows.push(_trow('4-BR+', unitMix.fourBRPlus + ' units'));
    }

    /* ── AMI mix table ───────────────────────────────────────────── */
    var amiRows = [];
    if (amiMix.ami30 != null) amiRows.push(_trow('30% AMI', amiMix.ami30));
    if (amiMix.ami40 != null && parseFloat(amiMix.ami40) > 0) {
      amiRows.push(_trow('40% AMI', amiMix.ami40));
    }
    if (amiMix.ami50 != null) amiRows.push(_trow('50% AMI', amiMix.ami50));
    if (amiMix.ami60 != null) amiRows.push(_trow('60% AMI', amiMix.ami60));

    /* ── Rationale list ──────────────────────────────────────────── */
    var rationaleItems = (rec.keyRationale || []).map(function (r) {
      return '<li>' + _esc(r) + '</li>';
    }).join('');

    /* ── Risk list ───────────────────────────────────────────────── */
    var riskSection = '';
    if (rec.keyRisks && rec.keyRisks.length > 0) {
      riskSection = [
        '<section class="lihtc-cc-risks" aria-label="Key risks">',
          '<h4>⚠ Key Risks</h4>',
          '<ul>',
            rec.keyRisks.map(function (r) { return '<li>' + _esc(r) + '</li>'; }).join(''),
          '</ul>',
        '</section>'
      ].join('');
    }

    /* ── Alternative path ────────────────────────────────────────── */
    var altPath = rec.alternativePath
      ? '<p style="margin:.6rem 0 0;font-size:.85rem;font-style:italic;">' +
        '<strong>Alternative path:</strong> ' + _esc(rec.alternativePath) + '</p>'
      : '';

    /* ── HNA section ─────────────────────────────────────────────── */
    var hnaSection = _buildHnaSection(hnsFit);

    /* ── Capital stack section ───────────────────────────────────── */
    var stackSection = _buildStackSection(stack);

    /* ── Caveats box ─────────────────────────────────────────────── */
    var caveatsHtml = '';
    if (rec.caveats && rec.caveats.length > 0) {
      caveatsHtml = [
        '<div class="lihtc-cc-caveat" role="note" aria-label="Important caveats">',
          '<strong>⚠ Important:</strong> ',
          rec.caveats.map(function (c) { return _esc(c); }).join(' '),
        '</div>'
      ].join('');
    }

    /* ── Assemble ────────────────────────────────────────────────── */
    container.innerHTML = [
      '<div class="lihtc-cc">',

        /* Header */
        '<h3>',
          badge + ' Recommended: <strong>' + headline + '</strong>',
          (totalUnits > 0
            ? ' <span style="font-weight:400;font-size:.88em;">(' + totalUnits + ' units)</span>'
            : ''),
          ' <span style="font-size:.75em;font-weight:400;color:var(--text-muted,#aaa);">' +
            conf + ' confidence</span>',
        '</h3>',

        /* Rationale */
        '<section aria-label="Why this fits">',
          '<h4>Why This Fits</h4>',
          '<ul>' + rationaleItems + '</ul>',
        '</section>',

        /* Mix tables */
        '<div class="lihtc-cc-mixes">',
          unitRows.length > 0 ? [
            '<div>',
              '<h4>Unit Mix</h4>',
              '<table>' + unitRows.join('') + '</table>',
            '</div>'
          ].join('') : '',
          amiRows.length > 0 ? [
            '<div>',
              '<h4>AMI Mix</h4>',
              '<table>' + amiRows.join('') + '</table>',
            '</div>'
          ].join('') : '',
        '</div>',

        /* Capital stack */
        stackSection,

        /* Risks */
        riskSection,

        /* Alternative path */
        altPath,

        /* HNA section */
        hnaSection,

        /* Caveats */
        caveatsHtml,

        /* Actions */
        '<div class="lihtc-cc-actions">',
          '<button class="lihtc-cc-btn lihtc-cc-btn-primary" ',
            'id="lihtcExportConceptBtn" type="button">Export Concept JSON</button>',
        '</div>',

      '</div>'
    ].join('');

    container.hidden = false;

    /* ── Wire export button ──────────────────────────────────────── */
    var exportBtn = document.getElementById('lihtcExportConceptBtn');
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

    /* ── Announce update to screen readers ───────────────────────── */
    if (window.__announceUpdate) {
      window.__announceUpdate(
        'LIHTC concept recommendation updated: ' + headline + ', ' + conf + ' confidence.'
      );
    }

    var liveRegion = document.getElementById('lihtcConceptLiveRegion');
    if (liveRegion) {
      liveRegion.textContent = 'Concept recommendation: ' +
        exec + ' ' + concept + ' housing, ' + rec.confidence + ' confidence.';
    }
  }

  /* ── Expose ──────────────────────────────────────────────────────── */
  window.LIHTCConceptCardRenderer = {
    render: render
  };

}());
