/**
 * js/market-analysis/market-report-renderers.js
 * Section-level HTML rendering functions for the market analysis report.
 * Exposes window.MARenderers.
 *
 * Each render function writes into a named DOM element.  If data is
 * null or unavailable, a styled "Data unavailable" card is rendered
 * instead.  All HTML is assembled via string concatenation (no template
 * literal dependencies) so the module is fully ES5-compatible.
 */
(function () {
  'use strict';

  /* ── DOM helpers ────────────────────────────────────────────────── */

  /**
   * Return the element with the given id, or null.
   * @param {string} id
   * @returns {Element|null}
   */
  function _el(id) {
    return document.getElementById(id);
  }

  /**
   * Set the innerHTML of a section element.
   * @param {string} id
   * @param {string} html
   */
  function _render(id, html) {
    var el = _el(id);
    if (el) { el.innerHTML = html; }
  }

  /* ── Shared card builders ───────────────────────────────────────── */

  /**
   * Build an unavailable-data card.
   * @param {string} label - Section label shown in the card.
   * @returns {string} HTML string.
   */
  function _unavailableCard(label) {
    return (
      '<div class="callout" style="border-color:var(--border);background:var(--bg2);padding:1rem 1.25rem;">' +
        '<span style="color:var(--muted);font-size:var(--small);">&#x2014; ' +
        (label || 'Data') + ' unavailable</span>' +
      '</div>'
    );
  }

  /**
   * Build a loading spinner HTML string.
   * @returns {string}
   */
  function _spinner() {
    return (
      '<div style="text-align:center;padding:2rem 0;">' +
        '<span class="spinner" aria-hidden="true" style="' +
          'display:inline-block;width:28px;height:28px;border:3px solid var(--border);' +
          'border-top-color:var(--accent);border-radius:50%;animation:spin 0.8s linear infinite;">' +
        '</span>' +
        '<p style="margin-top:0.75rem;color:var(--muted);font-size:var(--small);">Loading\u2026</p>' +
      '</div>'
    );
  }

  /**
   * Build a score badge HTML string.
   * @param {number} score  - 0–100.
   * @param {string} [label]
   * @returns {string}
   */
  function _scoreBadge(score, label) {
    var color = (score >= 70) ? 'var(--good)' : (score >= 45) ? 'var(--warn)' : 'var(--bad)';
    return (
      '<span class="badge" style="background:' + color + ';color:#fff;font-weight:700;font-size:1rem;padding:4px 12px;border-radius:999px;">' +
        (typeof score === 'number' ? score : '—') +
        (label ? ' <span style="font-size:0.75rem;font-weight:400;opacity:0.9;">' + label + '</span>' : '') +
      '</span>'
    );
  }

  /**
   * Build a metric row: label + formatted value side-by-side.
   * @param {string} label
   * @param {string|number} value
   * @param {string} [color] - Optional CSS color for value text.
   * @returns {string}
   */
  function _metricRow(label, value, color) {
    var valStyle = color ? ' style="color:' + color + ';font-weight:600;"' : ' style="font-weight:600;"';
    return (
      '<div style="display:flex;justify-content:space-between;align-items:baseline;' +
             'padding:0.35rem 0;border-bottom:1px solid var(--border);">' +
        '<span style="color:var(--muted);font-size:var(--small);">' + label + '</span>' +
        '<span' + valStyle + '>' + (value !== null && value !== undefined ? value : '—') + '</span>' +
      '</div>'
    );
  }

  /**
   * Build a section heading.
   * @param {string} title
   * @returns {string}
   */
  function _sectionHeading(title) {
    return '<h3 style="margin:0 0 1rem;font-size:1rem;font-weight:700;color:var(--text);">' + title + '</h3>';
  }

  /* ── Format helpers (falls back to plain maths if MAUtils absent) ── */

  function _fmtN(n, d) {
    var u = window.MAUtils;
    if (u && typeof u.formatNumber === 'function') return u.formatNumber(n, d);
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US');
  }

  function _fmtPct(r, d) {
    var u = window.MAUtils;
    if (u && typeof u.formatPct === 'function') return u.formatPct(r, d);
    if (r === null || r === undefined || isNaN(r)) return '—';
    return (Number(r) * 100).toFixed(d !== undefined ? d : 1) + '%';
  }

  function _fmtCur(n) {
    var u = window.MAUtils;
    if (u && typeof u.formatCurrency === 'function') return u.formatCurrency(n);
    if (n === null || n === undefined || isNaN(n)) return '—';
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function _band(score) {
    var u = window.MAUtils;
    if (u && typeof u.opportunityBand === 'function') return u.opportunityBand(score);
    if (score >= 70) return 'High';
    if (score >= 45) return 'Moderate';
    return 'Lower';
  }

  /* ── Public renderers ───────────────────────────────────────────── */

  /**
   * Render the executive summary card.
   * @param {object|null} scores - Result from SiteSelectionScore.computeScore().
   * @param {object|null} acs    - Aggregated ACS metrics.
   */
  function renderExecutiveSummary(scores, acs) {
    if (!scores) {
      _render('maExecSummaryContent', _unavailableCard('Executive Summary'));
      return;
    }

    var band       = _band(scores.final_score);
    var bandColor  = (band === 'High') ? 'var(--good)' : (band === 'Moderate') ? 'var(--warn)' : 'var(--bad)';
    var narrative  = scores.narrative || '';

    var html = (
      '<div style="display:grid;gap:1rem;">' +
        '<div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">' +
          '<div>' +
            '<div style="font-size:0.75rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.25rem;">Composite Score</div>' +
            _scoreBadge(scores.final_score) +
          '</div>' +
          '<div>' +
            '<div style="font-size:0.75rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:0.25rem;">Opportunity Band</div>' +
            '<span class="pill" style="background:' + bandColor + ';color:#fff;border-color:' + bandColor + ';font-weight:700;">' + band + '</span>' +
          '</div>' +
        '</div>' +
        (narrative
          ? '<p style="margin:0;font-size:var(--small);color:var(--muted);line-height:1.55;">' + narrative + '</p>'
          : '') +
        '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:0.5rem;">' +
          _componentChip('Demand',      scores.demand_score) +
          _componentChip('Subsidy',     scores.subsidy_score) +
          _componentChip('Feasibility', scores.feasibility_score) +
          _componentChip('Access',      scores.access_score) +
          _componentChip('Policy',      scores.policy_score) +
          _componentChip('Market',      scores.market_score) +
        '</div>' +
      '</div>'
    );

    _render('maExecSummaryContent', html);
  }

  /**
   * Build a small component score chip.
   * @private
   */
  function _componentChip(label, score) {
    var s     = typeof score === 'number' ? score : 0;
    var color = (s >= 70) ? 'var(--good)' : (s >= 45) ? 'var(--warn)' : 'var(--bad)';
    return (
      '<div style="background:var(--card2);border:1px solid var(--border);border-radius:8px;' +
             'padding:0.5rem 0.75rem;display:flex;flex-direction:column;gap:0.15rem;">' +
        '<span style="font-size:0.7rem;color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;">' + label + '</span>' +
        '<span style="font-size:1.1rem;font-weight:700;color:' + color + ';">' + s + '</span>' +
      '</div>'
    );
  }

  /**
   * Render the market demand section.
   * @param {object|null} acs - Aggregated ACS metrics.
   */
  function renderMarketDemand(acs) {
    if (!acs || typeof acs !== 'object') {
      _render('maMarketDemandContent', _unavailableCard('Market Demand'));
      return;
    }

    var html = (
      '<div style="display:grid;gap:0.5rem;">' +
        _sectionHeading('Demand Indicators') +
        _metricRow('Total Population',     _fmtN(acs.pop)) +
        _metricRow('Renter Households',    _fmtN(acs.renter_hh)) +
        _metricRow('Owner Households',     _fmtN(acs.owner_hh)) +
        _metricRow('Cost-Burden Rate',     _fmtPct(acs.cost_burden_rate),  _burdenColor(acs.cost_burden_rate)) +
        _metricRow('Severe Cost-Burden',   _fmtPct(acs.severe_burden_rate), _burdenColor(acs.severe_burden_rate)) +
        _metricRow('Poverty Rate',         _fmtPct(acs.poverty_rate),       _burdenColor(acs.poverty_rate)) +
        _metricRow('Renter Share',         _fmtPct(acs.renter_share)) +
        _metricRow('Median HH Income',     _fmtCur(acs.med_hh_income)) +
        _metricRow('Median Gross Rent',    _fmtCur(acs.med_gross_rent)) +
        _metricRow('Unemployment Rate',    _fmtPct(acs.unemployment_rate)) +
      '</div>'
    );

    _render('maMarketDemandContent', html);
  }

  /** @private */
  function _burdenColor(rate) {
    if (rate === null || rate === undefined) return null;
    if (rate >= 0.45) return 'var(--bad)';
    if (rate >= 0.30) return 'var(--warn)';
    return 'var(--good)';
  }

  /**
   * Render the affordable supply section.
   * @param {Array|null} lihtcData - Array of LIHTC GeoJSON features.
   */
  function renderAffordableSupply(lihtcData) {
    if (!lihtcData || !Array.isArray(lihtcData)) {
      _render('maAffordableSupplyContent', _unavailableCard('Affordable Supply'));
      return;
    }

    var totalUnits = 0;
    var totalProj  = lihtcData.length;
    lihtcData.forEach(function (f) {
      var p = (f && f.properties) ? f.properties : f;
      totalUnits += parseInt(p.TOTAL_UNITS || p.total_units || p.N_UNITS || p.n_units || 0, 10);
    });

    // Recent projects (allocated in last 10 years).
    var now    = new Date().getFullYear();
    var recent = lihtcData.filter(function (f) {
      var p = (f && f.properties) ? f.properties : f;
      var yr = parseInt(p.YEAR_ALLOC || p.year_alloc || 0, 10);
      return yr >= now - 10;
    }).length;

    var html = (
      '<div style="display:grid;gap:0.5rem;">' +
        _sectionHeading('LIHTC Supply Within Buffer') +
        _metricRow('Total LIHTC Projects', _fmtN(totalProj)) +
        _metricRow('Total Affordable Units', _fmtN(totalUnits)) +
        _metricRow('Projects (last 10 yrs)', _fmtN(recent)) +
        (totalProj > 0
          ? '<div style="margin-top:0.75rem;">' + _sectionHeading('Project List') + _lihtcTable(lihtcData) + '</div>'
          : '') +
      '</div>'
    );

    _render('maAffordableSupplyContent', html);
  }

  /** @private Build a compact LIHTC project table. */
  function _lihtcTable(features) {
    var rows = '';
    var shown = Math.min(features.length, 10);
    for (var i = 0; i < shown; i++) {
      var p     = (features[i] && features[i].properties) ? features[i].properties : features[i];
      var name  = p.PROJECT_NAME || p.project_name || 'LIHTC Project';
      var city  = p.CITY || p.city || '—';
      // Parse unit count safely; any non-numeric value yields '—'.
      var rawUnits = p.TOTAL_UNITS || p.total_units || p.N_UNITS || p.n_units;
      var units = (rawUnits !== null && rawUnits !== undefined && !isNaN(Number(rawUnits)))
        ? String(Number(rawUnits)) : '—';
      var yr    = p.YEAR_ALLOC  || p.year_alloc  || '—';
      rows += (
        '<tr>' +
          '<td style="padding:4px 6px;font-size:var(--small);">' + name + '</td>' +
          '<td style="padding:4px 6px;font-size:var(--small);">' + city + '</td>' +
          '<td style="padding:4px 6px;font-size:var(--small);text-align:right;">' + units + '</td>' +
          '<td style="padding:4px 6px;font-size:var(--small);text-align:right;">' + yr + '</td>' +
        '</tr>'
      );
    }
    if (features.length > shown) {
      rows += (
        '<tr><td colspan="4" style="padding:4px 6px;font-size:var(--small);color:var(--muted);">' +
          '\u2026 and ' + (features.length - shown) + ' more.' +
        '</td></tr>'
      );
    }
    return (
      '<table style="width:100%;border-collapse:collapse;">' +
        '<thead><tr>' +
          '<th style="text-align:left;padding:4px 6px;font-size:var(--small);border-bottom:1px solid var(--border);">Name</th>' +
          '<th style="text-align:left;padding:4px 6px;font-size:var(--small);border-bottom:1px solid var(--border);">City</th>' +
          '<th style="text-align:right;padding:4px 6px;font-size:var(--small);border-bottom:1px solid var(--border);">Units</th>' +
          '<th style="text-align:right;padding:4px 6px;font-size:var(--small);border-bottom:1px solid var(--border);">Yr</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>'
    );
  }

  /**
   * Render the subsidy opportunities section.
   * @param {object|null} subsidyData - e.g. { qct, dda, fmrRatio, nearbySubsidized, subsidy_score }.
   */
  function renderSubsidyOpportunities(subsidyData) {
    if (!subsidyData || typeof subsidyData !== 'object') {
      _render('maSubsidyOppContent', _unavailableCard('Subsidy Opportunities'));
      return;
    }

    var qct    = subsidyData.qct || subsidyData.qctFlag;
    var dda    = subsidyData.dda || subsidyData.ddaFlag;
    var fmr    = subsidyData.fmrRatio;
    var nearby = subsidyData.nearbySubsidized;
    var score  = subsidyData.subsidy_score;

    var html = (
      '<div style="display:grid;gap:0.5rem;">' +
        _sectionHeading('Subsidy Eligibility') +
        _metricRow('Qualified Census Tract (QCT)',
          qct ? '<span class="pill good">Yes</span>' : '<span class="pill">No</span>') +
        _metricRow('Difficult Development Area (DDA)',
          dda ? '<span class="pill good">Yes</span>' : '<span class="pill">No</span>') +
        (fmr !== null && fmr !== undefined
          ? _metricRow('Market / FMR Ratio', _fmtN(fmr, 2),
              fmr >= 1.1 ? 'var(--warn)' : 'var(--good)')
          : '') +
        (nearby !== null && nearby !== undefined
          ? _metricRow('Subsidized Units Nearby', _fmtN(nearby))
          : '') +
        (typeof score === 'number'
          ? _metricRow('Subsidy Score', _scoreBadge(score))
          : '') +
      '</div>'
    );

    _render('maSubsidyOppContent', html);
  }

  /**
   * Render the site feasibility section.
   * @param {object|null} feasibilityData - e.g. { floodRisk, soilScore, cleanupFlag, feasibility_score }.
   */
  function renderSiteFeasibility(feasibilityData) {
    if (!feasibilityData || typeof feasibilityData !== 'object') {
      _render('maSiteFeasibilityContent', _unavailableCard('Site Feasibility'));
      return;
    }

    var fd    = feasibilityData;
    var score = fd.feasibility_score;

    var floodLabels = ['None', 'Low', 'Moderate', 'High'];
    var floodLabel  = floodLabels[Math.min(Math.max(Math.round(fd.floodRisk || 0), 0), 3)];
    var floodColor  = (fd.floodRisk >= 2) ? 'var(--bad)' : (fd.floodRisk >= 1) ? 'var(--warn)' : 'var(--good)';

    var envScore = fd.soilScore;
    var envColor = (envScore >= 70) ? 'var(--good)' : (envScore >= 40) ? 'var(--warn)' : 'var(--bad)';

    var html = (
      '<div style="display:grid;gap:0.5rem;">' +
        _sectionHeading('Physical Site Conditions') +
        _metricRow('FEMA Flood Risk', floodLabel, floodColor) +
        _metricRow('Environmental Score', _fmtN(envScore, 0) + ' / 100', envColor) +
        _metricRow('Cleanup Concern',
          fd.cleanupFlag
            ? '<span class="pill warn">Yes — High EJI</span>'
            : '<span class="pill good">No</span>')
    );

    // Show EJI breakdown if available
    var eji = fd.ejiMetrics;
    if (eji && eji.ejiPercentile != null) {
      var riskColor = eji.riskCategory === 'high' ? 'var(--bad)' :
                      eji.riskCategory === 'moderate' ? 'var(--warn)' : 'var(--good)';
      html += '<div style="margin-top:0.75rem;"></div>' +
        _sectionHeading('CDC Environmental Justice Index') +
        _metricRow('EJI Percentile', _fmtPct(eji.ejiPercentile, 1), riskColor) +
        _metricRow('Environmental Burden', eji.envBurden != null ? _fmtPct(eji.envBurden, 1) : '—') +
        _metricRow('Social Vulnerability', eji.socialVuln != null ? _fmtPct(eji.socialVuln, 1) : '—') +
        _metricRow('Health Vulnerability', eji.healthVuln != null ? _fmtPct(eji.healthVuln, 1) : '—') +
        _metricRow('Risk Category',
          '<span class="pill" style="background:' + riskColor + ';color:#fff;border-color:' + riskColor + ';">' +
            (eji.riskCategory || 'unknown') + '</span>');
      if (eji.tractGeoid) {
        html += '<div style="font-size:0.7rem;color:var(--muted);margin-top:0.25rem;">Tract: ' + eji.tractGeoid + '</div>';
      }
    }

    html += (typeof score === 'number'
      ? _metricRow('Feasibility Score', _scoreBadge(score))
      : '') +
    '</div>';

    _render('maSiteFeasibilityContent', html);
  }

  /**
   * Render the neighborhood access section with walkability & bikeability.
   * @param {object|null} accessData - { amenities, walkability, access_score }.
   */
  function renderNeighborhoodAccess(accessData) {
    if (!accessData || typeof accessData !== 'object') {
      _render('maNeighborhoodAccessContent', _unavailableCard('Neighborhood Access'));
      return;
    }

    var amenities   = accessData.amenities || accessData;
    var walkability = accessData.walkability || null;
    var score       = accessData.access_score;

    function _distRow(label, dist) {
      var d = (dist !== null && dist !== undefined) ? _fmtN(dist, 2) + ' mi' : '—';
      var c = (typeof dist === 'number') ? ((dist <= 0.5) ? 'var(--good)' : (dist <= 1.5) ? 'var(--warn)' : 'var(--bad)') : null;
      return _metricRow(label, d, c);
    }

    var html = (
      '<div style="display:grid;gap:0.5rem;">' +
        _sectionHeading('Distance to Amenities') +
        _distRow('Grocery Store',     amenities.grocery) +
        _distRow('Transit Stop',      amenities.transit) +
        _distRow('Park / Open Space', amenities.parks) +
        _distRow('Healthcare',        amenities.healthcare) +
        _distRow('School',            amenities.schools) +
        _distRow('Hospital',          amenities.hospitals) +
        _distRow('Child Care Center', amenities.childcare)
    );

    // Walkability & Bikeability section
    if (walkability) {
      html += '<div style="margin-top:0.75rem;"></div>' +
        _sectionHeading('Walkability &amp; Bikeability') +
        _walkBikeRow('Walkability', walkability.walkScore, walkability.walkLabel) +
        _walkBikeRow('Bikeability', walkability.bikeScore, walkability.bikeLabel);

      // Supporting EPA metrics
      html += '<div style="margin-top:0.5rem;padding:0.6rem 0.75rem;background:var(--bg2);border-radius:var(--radius-sm,4px);font-size:var(--small);">' +
        '<div style="font-weight:600;color:var(--muted);margin-bottom:0.35rem;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.04em;">EPA Smart Location Factors</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.25rem 1rem;">';

      if (walkability.intersectionDensity != null) {
        html += _miniMetric('Intersection Density', walkability.intersectionDensity);
      }
      if (walkability.transitFrequency != null) {
        html += _miniMetric('Transit Frequency', walkability.transitFrequency);
      }
      if (walkability.landUseMix != null) {
        html += _miniMetric('Land-Use Mix', walkability.landUseMix);
      }
      if (walkability.autoNetDensity != null) {
        html += _miniMetric('Auto Network Density', walkability.autoNetDensity);
      }

      html += '</div></div>';
    }

    html += (typeof score === 'number'
      ? _metricRow('Access Score', _scoreBadge(score))
      : '') +
    '</div>';

    _render('maNeighborhoodAccessContent', html);
  }

  /**
   * Build a walkability/bikeability score row with gauge bar.
   * @private
   */
  function _walkBikeRow(label, score, labelText) {
    var s = typeof score === 'number' ? score : 0;
    var color = (s >= 60) ? 'var(--good)' : (s >= 40) ? 'var(--warn)' : 'var(--bad)';
    return (
      '<div style="display:flex;justify-content:space-between;align-items:center;' +
             'padding:0.45rem 0;border-bottom:1px solid var(--border);">' +
        '<span style="color:var(--muted);font-size:var(--small);">' + label + '</span>' +
        '<div style="display:flex;align-items:center;gap:0.5rem;">' +
          '<div style="width:80px;height:8px;background:var(--bg2);border-radius:4px;overflow:hidden;">' +
            '<div style="width:' + s + '%;height:100%;background:' + color + ';border-radius:4px;transition:width 0.3s;"></div>' +
          '</div>' +
          '<span style="font-weight:700;color:' + color + ';min-width:28px;text-align:right;">' + s + '</span>' +
          '<span style="font-size:0.7rem;color:var(--muted);min-width:55px;">' + (labelText || '') + '</span>' +
        '</div>' +
      '</div>'
    );
  }

  /**
   * Build a compact metric for the EPA factors grid.
   * @private
   */
  function _miniMetric(label, value) {
    return (
      '<div style="display:flex;justify-content:space-between;padding:0.15rem 0;">' +
        '<span style="color:var(--muted);font-size:0.78rem;">' + label + '</span>' +
        '<span style="font-weight:600;font-size:0.78rem;">' + value + '</span>' +
      '</div>'
    );
  }

  /**
   * Render the policy overlays section.
   * @param {object|null} policyData - e.g. { zoningCapacity, publicOwnership, overlayCount, overlays[], policy_score }.
   */
  function renderPolicyOverlays(policyData) {
    if (!policyData || typeof policyData !== 'object') {
      _render('maPolicyOverlaysContent', _unavailableCard('Policy Overlays'));
      return;
    }

    var pd    = policyData;
    var score = pd.policy_score;

    var overlayList = '';
    if (Array.isArray(pd.overlays) && pd.overlays.length > 0) {
      overlayList = '<div style="margin-top:0.5rem;display:flex;flex-wrap:wrap;gap:0.35rem;">';
      pd.overlays.forEach(function (o) {
        overlayList += '<span class="pill good" style="font-size:0.7rem;">' + o + '</span>';
      });
      overlayList += '</div>';
    }

    var html = (
      '<div style="display:grid;gap:0.5rem;">' +
        _sectionHeading('Housing Policy Context')
    );

    // Show jurisdiction name if available
    if (pd.jurisdictionName) {
      html += _metricRow('Jurisdiction', '<strong>' + pd.jurisdictionName + '</strong>');
    }

    html += _metricRow('Supportive Policy Dimensions', _fmtN(pd.overlayCount, 0) + ' / 7');

    if (pd.policyTotalScore != null && pd.policyTotalScore > 0) {
      var scColor = pd.policyTotalScore >= 5 ? 'var(--good)' :
                    pd.policyTotalScore >= 3 ? 'var(--warn)' : 'var(--bad)';
      html += _metricRow('Scorecard Total', _fmtN(pd.policyTotalScore, 0) + ' / 7', scColor);
    }

    html += _metricRow('Inclusionary Zoning',
      pd.zoningCapacity > 0
        ? '<span class="pill good">Yes</span>'
        : '<span class="pill">No</span>') +
      _metricRow('Housing Authority Present',
        pd.publicOwnership
          ? '<span class="pill good">Yes</span>'
          : '<span class="pill">No</span>') +
      overlayList +
      (typeof score === 'number'
        ? _metricRow('Policy Score', _scoreBadge(score))
        : '') +
    '</div>';

    _render('maPolicyOverlaysContent', html);
  }

  /**
   * Render the opportunities summary section.
   * @param {object|null} opportunitiesData - e.g. { items: [{ title, description, priority }] }.
   */
  function renderOpportunities(opportunitiesData) {
    if (!opportunitiesData || typeof opportunitiesData !== 'object') {
      _render('maOpportunitiesContent', _unavailableCard('Opportunities'));
      return;
    }

    var items = opportunitiesData.items || [];

    if (!items.length) {
      _render('maOpportunitiesContent', _unavailableCard('Opportunities'));
      return;
    }

    var cards = '';
    items.forEach(function (item) {
      var pri   = (item.priority || '').toLowerCase();
      var color = (pri === 'high') ? 'var(--good)' : (pri === 'moderate') ? 'var(--warn)' : 'var(--muted)';
      cards += (
        '<div style="border:1px solid var(--border);border-left:4px solid ' + color + ';' +
               'background:var(--card2);border-radius:6px;padding:0.75rem 1rem;display:grid;gap:0.25rem;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">' +
            '<strong style="font-size:var(--small);color:var(--text);">' + (item.title || 'Opportunity') + '</strong>' +
            (item.priority
              ? '<span class="pill" style="background:' + color + ';color:#fff;border-color:' + color + ';font-size:0.65rem;">' +
                  item.priority + '</span>'
              : '') +
          '</div>' +
          (item.description
            ? '<p style="margin:0;font-size:var(--small);color:var(--muted);line-height:1.45;">' + item.description + '</p>'
            : '') +
        '</div>'
      );
    });

    _render('maOpportunitiesContent',
      '<div style="display:grid;gap:0.75rem;">' +
        _sectionHeading('Strategic Opportunities') +
        cards +
      '</div>'
    );
  }

  /* ── Status helpers ─────────────────────────────────────────────── */

  /**
   * Replace a section's content with a loading spinner.
   * @param {string} sectionId - Element id.
   */
  function showSectionLoading(sectionId) {
    _render(sectionId, _spinner());
  }

  /**
   * Replace a section's content with an error message card.
   * @param {string} sectionId - Element id.
   * @param {string} msg       - Error message text.
   */
  function showSectionError(sectionId, msg) {
    _render(sectionId,
      '<div class="callout callout-warn" style="padding:0.75rem 1rem;">' +
        '<strong style="color:var(--bad);">&#9888; Error:</strong> ' +
        '<span style="font-size:var(--small);color:var(--muted);">' + (msg || 'An unexpected error occurred.') + '</span>' +
      '</div>'
    );
  }

  /* ── Expose ─────────────────────────────────────────────────────── */
  window.MARenderers = {
    renderExecutiveSummary:    renderExecutiveSummary,
    renderMarketDemand:        renderMarketDemand,
    renderAffordableSupply:    renderAffordableSupply,
    renderSubsidyOpportunities: renderSubsidyOpportunities,
    renderSiteFeasibility:     renderSiteFeasibility,
    renderNeighborhoodAccess:  renderNeighborhoodAccess,
    renderPolicyOverlays:      renderPolicyOverlays,
    renderOpportunities:       renderOpportunities,
    showSectionLoading:        showSectionLoading,
    showSectionError:          showSectionError
  };

}());
