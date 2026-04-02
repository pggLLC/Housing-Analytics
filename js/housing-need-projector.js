/**
 * housing-need-projector.js
 *
 * ES5 IIFE module — window.HousingNeedProjector
 *
 * Projects forward-looking housing need (5/10/20 yr) for a selected Colorado
 * county and recommends an AMI distribution based on current income and cost-
 * burden data.
 *
 * Data sources consumed:
 *   - data/co-county-demographics.json  (loaded externally or passed in)
 *   - data/hna/projections/{fips}.json  (DOLA household projections — optional)
 *   - window.HudFmr                     (HUD FMR/AMI limits — optional)
 *   - window.SiteState.getCounty()      (selected county context — optional)
 */
(function (root) {
  'use strict';

  /* ─────────────────────────────────────────────────────────────────────────
   * 0. Style injection (once)
   * ───────────────────────────────────────────────────────────────────────── */
  var _stylesInjected = false;

  function _injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;

    var css = [
      /* Table */
      '.hnp-table{border-collapse:collapse;width:100%;}',
      '.hnp-table th{background:var(--bg2,#f3f4f6);font-weight:700;',
      '  padding:8px 12px;font-size:.82rem;text-align:left;}',
      '.hnp-table td{padding:8px 12px;border-bottom:1px solid var(--border,#e5e7eb);',
      '  font-size:.88rem;}',
      '.hnp-scenario--baseline td{font-weight:600;}',

      /* AMI bars */
      '.hnp-ami-bar-wrap{margin-bottom:14px;}',
      '.hnp-ami-bar-label{font-size:.82rem;font-weight:700;margin-bottom:4px;',
      '  display:flex;justify-content:space-between;}',
      '.hnp-ami-bar-track{background:var(--bg2,#f3f4f6);border-radius:4px;',
      '  height:20px;overflow:hidden;}',
      '.hnp-ami-bar-fill{height:100%;border-radius:4px;transition:width .5s ease;}',
      '.hnp-ami-rationale{font-size:.78rem;color:var(--muted,#555);',
      '  margin-top:4px;margin-bottom:12px;}',

      /* Card */
      '.hnp-recommendation-card{background:var(--card,#fff);',
      '  border:1px solid var(--border,#e5e7eb);border-radius:10px;',
      '  padding:20px 24px;}'
    ].join('');

    var style = document.createElement('style');
    style.id = 'hnp-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 1. Internal helpers
   * ───────────────────────────────────────────────────────────────────────── */

  /** Round to nearest integer, return 0 for NaN/Infinity. */
  function _safeRound(n) {
    var v = Math.round(n);
    return isFinite(v) ? v : 0;
  }

  /** Format a number with comma thousands separator. */
  function _fmt(n) {
    return _safeRound(n).toLocaleString();
  }

  /**
   * Derive vacancy-deficit factor from vacancy_rate (%).
   * vacancy_deficit_factor = max(0, 0.05 - vacancy_rate/100) * 10
   */
  function _vacancyDeficitFactor(vacancyRate) {
    var rate = (vacancyRate || 0) / 100;
    return Math.max(0, 0.05 - rate) * 10;
  }

  /**
   * Compound growth: base * ((1 + rate)^years - 1)
   * Returns the *incremental* new households after `years`.
   */
  function _incrementalGrowth(baseHouseholds, annualRate, years) {
    return baseHouseholds * (Math.pow(1 + annualRate, years) - 1);
  }

  /**
   * Derive a household growth rate from DOLA projection data.
   * Uses incremental_units_needed_dola or households_dola arrays.
   * Returns annual rate as a decimal, or null if data unavailable.
   */
  function _dolaHouseholdRate(dolaProj) {
    if (!dolaProj) return null;
    var hn = dolaProj.housing_need;
    if (!hn) return null;

    var hh = hn.households_dola;
    if (!hh || hh.length < 2) return null;

    // Find index of base year (2024) in dolaProj.years
    var years = dolaProj.years || [];
    var baseIdx = -1;
    for (var i = 0; i < years.length; i++) {
      if (years[i] === 2024) { baseIdx = i; break; }
    }
    if (baseIdx < 0) baseIdx = 0;

    // Try to find 2029 (5-yr) and 2039 (15-yr) for a 15-yr CAGR
    var targetIdx = -1;
    for (var j = 0; j < years.length; j++) {
      if (years[j] === 2039) { targetIdx = j; break; }
    }
    if (targetIdx < 0) targetIdx = Math.min(baseIdx + 15, hh.length - 1);

    var hhBase = hh[baseIdx];
    var hhTarget = hh[targetIdx];
    var span = years[targetIdx] - years[baseIdx];
    if (!hhBase || !hhTarget || span <= 0) return null;

    var rate = Math.pow(hhTarget / hhBase, 1 / span) - 1;
    return isFinite(rate) ? rate : null;
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 2. project(fips, countyData, options) → ProjectionResult
   * ───────────────────────────────────────────────────────────────────────── */

  /**
   * @param {string}  fips        5-digit FIPS (e.g. "08001")
   * @param {Object}  countyData  Row from co-county-demographics.json
   * @param {Object}  [options]
   * @param {Object}  [options.dolaProj]   Parsed DOLA projections JSON
   * @param {string}  [options.countyName]
   * @returns {ProjectionResult}
   */
  function project(fips, countyData, options) {
    options = options || {};

    var cd = countyData || {};
    var countyName = options.countyName || cd.name || fips;
    var households = cd.households || 0;
    var vacancyRate = cd.vacancy_rate || 0;
    var costBurdenedPct = cd.cost_burdened_pct || 0;
    var severelyBurdenedPct = cd.severely_burdened_pct || 0;

    /* --- Household growth rate --- */
    var dolaRate = _dolaHouseholdRate(options.dolaProj || null);
    var baselineRate = (dolaRate !== null) ? dolaRate : 0.008; // 0.8%/yr fallback

    /* --- Vacancy deficit factor --- */
    var vdf = _vacancyDeficitFactor(vacancyRate);
    var vacancyMultiplier = 1 + vdf;

    /* --- Current gap (30% AMI severely cost-burdened) --- */
    // Severely burdened households are the primary proxy for deep affordability gap
    var currentGap = _safeRound(households * (severelyBurdenedPct / 100));

    /* --- Baseline projections --- */
    function baselineUnits(years) {
      var newHH = _incrementalGrowth(households, baselineRate, years);
      return _safeRound(newHH * vacancyMultiplier);
    }

    var bYr5  = baselineUnits(5);
    var bYr10 = baselineUnits(10);
    var bYr20 = baselineUnits(20);

    /* --- Low / High scenarios --- */
    var lYr5  = _safeRound(bYr5  * 0.40);
    var lYr10 = _safeRound(bYr10 * 0.40);
    var lYr20 = _safeRound(bYr20 * 0.40);

    var hYr5  = _safeRound(bYr5  * 1.70);
    var hYr10 = _safeRound(bYr10 * 1.70);
    var hYr20 = _safeRound(bYr20 * 1.70);

    /* --- Annual gap --- */
    var gapFromCurrent  = _safeRound(currentGap / 15);
    var gapFromGrowth   = _safeRound(bYr20 / 20);
    var annualGap = Math.max(gapFromCurrent, gapFromGrowth);

    /* --- Methodology strings --- */
    var methodology = [];
    methodology.push(
      'Base year: 2024. Households: ' + _fmt(households) + '.'
    );
    methodology.push(
      dolaRate !== null
        ? 'Household growth rate derived from DOLA SDO projections (' +
          (baselineRate * 100).toFixed(2) + '%/yr).'
        : 'DOLA projections unavailable; default Colorado rate of 0.80%/yr applied.'
    );
    if (vdf > 0) {
      methodology.push(
        'Vacancy rate (' + vacancyRate + '%) is below healthy threshold (5%); ' +
        'a vacancy-deficit multiplier of ' + vacancyMultiplier.toFixed(3) +
        'x applied to new-unit estimates.'
      );
    } else {
      methodology.push(
        'Vacancy rate (' + vacancyRate + '%) at or above 5%; no vacancy-deficit adjustment applied.'
      );
    }
    methodology.push(
      'Low scenario = 40% of baseline; High scenario = 170% of baseline.'
    );
    methodology.push(
      'Current deep-affordability gap estimated from severely cost-burdened ' +
      'households (' + severelyBurdenedPct + '% of total).'
    );
    methodology.push(
      'Annual gap = max(currentGap / 15, baseline 20-yr need / 20) = ' + _fmt(annualGap) + ' units/yr.'
    );

    return {
      fips: fips,
      countyName: countyName,
      baseYear: 2024,
      scenarios: {
        low:      { yr5: lYr5,  yr10: lYr10,  yr20: lYr20  },
        baseline: { yr5: bYr5,  yr10: bYr10,  yr20: bYr20  },
        high:     { yr5: hYr5,  yr10: hYr10,  yr20: hYr20  }
      },
      annualGap: annualGap,
      currentGap: currentGap,
      methodology: methodology
    };
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 3. recommendAmiMix(countyData, options) → AmiRecommendation
   * ───────────────────────────────────────────────────────────────────────── */

  var AMI_MIX_PRESETS = {
    deeply_affordable: { pct30: 30, pct40: 20, pct50: 20, pct60: 20, pct80: 10 },
    mixed:             { pct30: 10, pct40: 15, pct50: 30, pct60: 30, pct80: 15 },
    workforce:         { pct30:  5, pct40: 10, pct50: 20, pct60: 35, pct80: 30 },
    default_mixed:     { pct30: 15, pct40: 20, pct50: 25, pct60: 25, pct80: 15 }
  };

  var AMI_MIX_LABELS = {
    deeply_affordable: 'Deeply Affordable Priority',
    mixed:             'Mixed-Income Strategy',
    workforce:         'Workforce Housing Focus',
    default_mixed:     'Balanced Mixed-Income'
  };

  /**
   * Build tier rationale strings.
   * @param {string} priority
   * @param {Object} cd  countyData
   * @returns {string[]}
   */
  function _buildRationale(priority, cd) {
    var inc = cd.median_household_income || 0;
    var cb  = cd.cost_burdened_pct || 0;
    var vr  = cd.vacancy_rate || 0;
    var rationale = [];

    if (priority === 'deeply_affordable') {
      rationale.push(
        '30% AMI (Deeply Affordable): Highest weight because ' + cb + '% of ' +
        'households are cost-burdened and median income (' +
        _fmtDollar(inc) + ') falls below $60,000. ' +
        'LIHTC and project-based Section 8 are the primary tools for this tier.'
      );
      rationale.push(
        '40–60% AMI (Core Affordable): Moderate weighting to serve households ' +
        'whose incomes sit just above the deep-need threshold while remaining ' +
        'below market-rate reach.'
      );
      rationale.push(
        '80% AMI (Workforce): Minimal allocation given that workforce-level ' +
        'earners in this county are better served by entry-level market rate ' +
        'or employer-assisted housing rather than subsidized LIHTC units.'
      );
    } else if (priority === 'mixed') {
      rationale.push(
        '30–40% AMI (Deep Affordable): Moderate weighting reflects meaningful ' +
        'cost burden (' + cb + '%) among lower-income households, though income ' +
        'levels (' + _fmtDollar(inc) + ') suggest a broader spectrum of need.'
      );
      rationale.push(
        '50–60% AMI (Core Workforce): Highest combined weight because the ' +
        'county income profile indicates most renter households cluster in the ' +
        '50–80% AMI band and face moderate-to-severe rent burden.'
      );
      rationale.push(
        '80% AMI (Workforce Housing): Moderate allocation ensures the project ' +
        'can serve entry-level professionals and essential workers priced out of ' +
        'the local market without sacrificing affordability depth.'
      );
    } else if (priority === 'workforce') {
      rationale.push(
        '30–40% AMI (Deeply Affordable): Minimal weighting because the county ' +
        'median income (' + _fmtDollar(inc) + ') indicates most renter ' +
        'households earn above 50% AMI, and/or the vacancy rate (' + vr + '%) ' +
        'suggests market conditions are relatively functional at lower tiers.'
      );
      rationale.push(
        '50–60% AMI (Transitional Workforce): Moderate allocation bridges the ' +
        'gap between subsidized and market-rate units for middle-income renters.'
      );
      rationale.push(
        '80% AMI (Workforce Housing): Largest single weight because the primary ' +
        'affordability stress in this county is among essential-worker households ' +
        'earning 60–100% of AMI who are priced out of market-rate housing.'
      );
    } else {
      rationale.push(
        '30% AMI (Deeply Affordable): Baseline allocation reflecting statewide ' +
        'best-practice minimum for properties seeking CHFA 9% LIHTC awards.'
      );
      rationale.push(
        '40–60% AMI (Core Affordable): Balanced weighting appropriate for ' +
        'counties with moderate cost burden and mixed-income demographics.'
      );
      rationale.push(
        '80% AMI (Workforce): Standard workforce component to ensure project ' +
        'financial viability and serve a broad range of income levels.'
      );
    }

    return rationale;
  }

  function _fmtDollar(n) {
    return '$' + Math.round(n).toLocaleString();
  }

  /**
   * @param {Object}  countyData
   * @param {Object}  [options]
   * @param {number}  [options.totalUnitsNeeded]
   * @returns {AmiRecommendation}
   */
  function recommendAmiMix(countyData, options) {
    options = options || {};
    var cd  = countyData || {};
    var cb  = cd.cost_burdened_pct || 0;
    var inc = cd.median_household_income || 0;
    var vr  = cd.vacancy_rate || 0;

    var priority;
    var mix;

    if (cb >= 50 && inc < 60000) {
      priority = 'deeply_affordable';
      mix = AMI_MIX_PRESETS.deeply_affordable;
    } else if (inc >= 60000 && inc < 90000) {
      priority = 'mixed';
      mix = AMI_MIX_PRESETS.mixed;
    } else if (inc >= 90000 || vr >= 5) {
      priority = 'workforce';
      mix = AMI_MIX_PRESETS.workforce;
    } else {
      priority = 'default_mixed';
      mix = AMI_MIX_PRESETS.default_mixed;
    }

    var totalUnitsNeeded = options.totalUnitsNeeded ||
      _safeRound((cd.households || 0) * ((cd.cost_burdened_pct || 0) / 100));

    return {
      recommended: {
        pct30: mix.pct30,
        pct40: mix.pct40,
        pct50: mix.pct50,
        pct60: mix.pct60,
        pct80: mix.pct80
      },
      rationale: _buildRationale(priority, cd),
      totalUnitsNeeded: totalUnitsNeeded,
      priority: priority,
      label: AMI_MIX_LABELS[priority] || 'Balanced Mixed-Income'
    };
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 4. renderProjectionSection(containerId, fips, countyData)
   * ───────────────────────────────────────────────────────────────────────── */

  /**
   * Fetches DOLA projection if available, runs project(), injects HTML.
   * @param {string} containerId
   * @param {string} fips
   * @param {Object} countyData
   */
  function renderProjectionSection(containerId, fips, countyData) {
    _injectStyles();

    var container = document.getElementById(containerId);
    if (!container) return;

    var cd = countyData || {};
    var countyName = cd.name || fips;

    /* Show loading placeholder */
    container.innerHTML = '<p style="color:var(--muted,#555);font-size:.85rem">Loading projections…</p>';

    /* Attempt to load DOLA projections JSON */
    var dolaUrl = 'data/hna/projections/' + fips + '.json';

    function renderWithProj(dolaProj) {
      var result = project(fips, cd, {
        dolaProj: dolaProj,
        countyName: countyName
      });
      _injectProjectionHTML(container, result, countyName);
    }

    if (typeof fetch === 'function') {
      fetch(dolaUrl)
        .then(function (res) {
          if (!res.ok) throw new Error('No DOLA data for ' + fips);
          return res.json();
        })
        .then(function (dolaProj) {
          renderWithProj(dolaProj);
        })
        ['catch'](function () {
          renderWithProj(null);
        });
    } else {
      renderWithProj(null);
    }
  }

  function _injectProjectionHTML(container, result, countyName) {
    var s = result.scenarios;

    var introPara =
      '<p style="font-size:.9rem;margin-bottom:16px;">' +
      'Based on current housing gaps and low/baseline/high growth assumptions for ' +
      '<strong>' + countyName + '</strong>, the following projections estimate ' +
      'unmet housing demand over the next 20 years.' +
      '</p>';

    var tableRows = [
      _projRow('Low',      s.low,      result.annualGap * 0.40, false),
      _projRow('Baseline', s.baseline, result.annualGap,         true),
      _projRow('High',     s.high,     result.annualGap * 1.70, false)
    ].join('');

    var table =
      '<table class="hnp-table" role="table" aria-label="Housing need projections">' +
      '<thead><tr>' +
      '<th scope="col">Scenario</th>' +
      '<th scope="col">5-Year Need</th>' +
      '<th scope="col">10-Year Need</th>' +
      '<th scope="col">20-Year Need</th>' +
      '<th scope="col">Annual Gap</th>' +
      '</tr></thead>' +
      '<tbody>' + tableRows + '</tbody>' +
      '</table>';

    var methodNote =
      '<details style="margin-top:14px;">' +
      '<summary style="font-size:.78rem;cursor:pointer;color:var(--muted,#555);' +
      'user-select:none;">Methodology &amp; Assumptions</summary>' +
      '<ul style="font-size:.78rem;color:var(--muted,#555);margin-top:8px;' +
      'padding-left:1.2em;line-height:1.6;">' +
      result.methodology.map(function (m) {
        return '<li>' + _escHtml(m) + '</li>';
      }).join('') +
      '</ul>' +
      '</details>';

    var currentGapNote =
      '<p style="font-size:.82rem;margin-top:10px;">' +
      '<strong>Estimated current deep-affordability gap:</strong> ' +
      _fmt(result.currentGap) + ' units (severely cost-burdened households).' +
      '</p>';

    container.innerHTML = introPara + table + currentGapNote + methodNote;
  }

  function _projRow(label, scenario, annualGap, isBaseline) {
    var cls = isBaseline ? ' class="hnp-scenario--baseline"' : '';
    return (
      '<tr' + cls + '>' +
      '<td>' + _escHtml(label) + '</td>' +
      '<td>' + _fmt(scenario.yr5) + '</td>' +
      '<td>' + _fmt(scenario.yr10) + '</td>' +
      '<td>' + _fmt(scenario.yr20) + '</td>' +
      '<td>' + _fmt(annualGap) + '/yr</td>' +
      '</tr>'
    );
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 5. renderAmiRecommendation(containerId, countyData)
   * ───────────────────────────────────────────────────────────────────────── */

  var AMI_TIER_COLORS = {
    pct30: 'var(--bad,#991b1b)',
    pct40: 'var(--warn,#a84608)',
    pct50: 'var(--accent,#096e65)',
    pct60: 'var(--good,#047857)',
    pct80: 'var(--muted,#555)'
  };

  var AMI_TIER_NAMES = {
    pct30: '30% AMI',
    pct40: '40% AMI',
    pct50: '50% AMI',
    pct60: '60% AMI',
    pct80: '80% AMI'
  };

  /**
   * @param {string} containerId
   * @param {Object} countyData
   */
  function renderAmiRecommendation(containerId, countyData) {
    _injectStyles();

    var container = document.getElementById(containerId);
    if (!container) return;

    var cd = countyData || {};
    var rec = recommendAmiMix(cd);
    var tiers = ['pct30', 'pct40', 'pct50', 'pct60', 'pct80'];

    /* ── Bars ── */
    var bars = '';
    for (var i = 0; i < tiers.length; i++) {
      var key = tiers[i];
      var pct = rec.recommended[key];
      var color = AMI_TIER_COLORS[key];
      var name  = AMI_TIER_NAMES[key];
      var rationaleText = rec.rationale[Math.min(i, rec.rationale.length - 1)] || '';

      // Only show rationale for the first bar of each "group" to avoid repetition.
      // Group: pct30 gets rationale[0], pct40+pct50 get rationale[1], pct60+pct80 get rationale[2]
      var showRationale = (key === 'pct30' || key === 'pct40' || key === 'pct60');
      var rationaleIdx = key === 'pct30' ? 0 : (key === 'pct40' ? 1 : 2);
      var rationaleStr = rec.rationale[rationaleIdx] || '';

      bars +=
        '<div class="hnp-ami-bar-wrap">' +
        '<div class="hnp-ami-bar-label">' +
        '<span>' + _escHtml(name) + '</span>' +
        '<span>' + pct + '%</span>' +
        '</div>' +
        '<div class="hnp-ami-bar-track" role="img" ' +
        'aria-label="' + _escHtml(name) + ': ' + pct + '%">' +
        '<div class="hnp-ami-bar-fill" style="width:' + pct + '%;background:' + color + ';"></div>' +
        '</div>' +
        (showRationale
          ? '<p class="hnp-ami-rationale">' + _escHtml(rationaleStr) + '</p>'
          : '') +
        '</div>';
    }

    var heading =
      '<h3 style="margin-top:0;margin-bottom:6px;font-size:1rem;">' +
      'Recommended AMI Distribution</h3>';

    var intro =
      '<p style="font-size:.88rem;margin-bottom:16px;">' +
      'Strategy: <strong>' + _escHtml(rec.label) + '</strong>. ' +
      'The distribution below reflects current income levels and cost-burden ' +
      'patterns for this county. Estimated total units needed: ' +
      '<strong>' + _fmt(rec.totalUnitsNeeded) + '</strong>.' +
      '</p>';

    var disclaimer =
      '<p style="font-size:.78rem;color:var(--muted,#555);margin-top:16px;' +
      'border-top:1px solid var(--border,#e5e7eb);padding-top:10px;">' +
      'These are planning estimates. CHFA QAP requirements and local needs ' +
      'studies should guide final income targeting.' +
      '</p>';

    container.innerHTML =
      '<div class="hnp-recommendation-card">' +
      heading + intro + bars + disclaimer +
      '</div>';
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 6. Utility
   * ───────────────────────────────────────────────────────────────────────── */

  function _escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ─────────────────────────────────────────────────────────────────────────
   * 7. Export
   * ───────────────────────────────────────────────────────────────────────── */

  root.HousingNeedProjector = {
    project: project,
    recommendAmiMix: recommendAmiMix,
    renderProjectionSection: renderProjectionSection,
    renderAmiRecommendation: renderAmiRecommendation
  };

}(window));
