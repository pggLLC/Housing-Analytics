/**
 * js/hna/hna-comparison.js
 * Comparison workspace for hna-comparative-analysis.html
 * County context filtering + searchable dropdown jurisdiction selection
 *
 * Depends on: js/hna/hna-ranking-index.js (window.HNARanking)
 *             js/site-state.js (window.SiteState) — optional
 *
 * Strategy: Rather than duplicating row rendering from hna-ranking-index.js,
 * this module injects HNA link cells into existing rows via MutationObserver.
 * Jurisdiction A/B selection is done via searchable dropdown selectors in the
 * setup bar. County filtering hides/shows rows via CSS rather than rebuilding.
 */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────
  var _compA = null;        // { geoid, name, type, region }
  var _compB = null;
  var _countyFilter = '';   // county geoid (5-digit FIPS) or ''
  var _countyMap = {};      // geoid → containing county geoid
  var _countyNames = {};    // county geoid → county name
  var _ready = false;

  // ── Persistence ────────────────────────────────────────────────────

  function _persist() {
    try {
      if (window.SiteState) {
        SiteState.set('comparisonA', _compA, true);
        SiteState.set('comparisonB', _compB, true);
      }
    } catch (_) {}
  }

  function _restore() {
    try {
      if (window.SiteState) {
        _compA = SiteState.get('comparisonA') || null;
        _compB = SiteState.get('comparisonB') || null;
      }
    } catch (_) {}
  }

  // ── County mapping ─────────────────────────────────────────────────

  function _buildCountyMap(entries) {
    _countyMap = {};
    _countyNames = {};

    entries.forEach(function (e) {
      if (e.type === 'county') {
        _countyMap[e.geoid] = e.geoid;
        _countyNames[e.geoid] = e.name;
      } else if (e.containingCounty) {
        _countyMap[e.geoid] = e.containingCounty;
      }
    });

    // Apply geo-config if cached (legacy fallback for featured places lacking
    // containingCounty on the ranking entry)
    var geoConfig = window._geoConfigCache || null;
    if (geoConfig && Array.isArray(geoConfig.featured)) {
      geoConfig.featured.forEach(function (g) {
        if (g.containingCounty && g.geoid && !_countyMap[g.geoid]) {
          _countyMap[g.geoid] = g.containingCounty;
        }
      });
    }
  }

  // ── Load geo-config for county mappings ────────────────────────────

  function _loadGeoConfig() {
    var fetcher = (typeof window.safeFetchJSON === 'function')
      ? window.safeFetchJSON
      : function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); };

    return fetcher('data/hna/geo-config.json').then(function (data) {
      window._geoConfigCache = data;
      if (data && Array.isArray(data.featured)) {
        data.featured.forEach(function (g) {
          if (g.containingCounty && g.geoid) {
            _countyMap[g.geoid] = g.containingCounty;
          }
        });
      }
    }).catch(function () {
      // geo-config not available — county filtering for places/CDPs limited
    });
  }

  // ── UI: Setup bar ──────────────────────────────────────────────────

  function _renderSetupBar() {
    var mount = document.getElementById('hcaComparisonBar');
    if (!mount) return;

    var countyOpts = '<option value="">All Colorado (no county filter)</option>';
    var sorted = Object.keys(_countyNames).sort(function (a, b) {
      return _countyNames[a].localeCompare(_countyNames[b]);
    });
    sorted.forEach(function (fips) {
      var sel = _countyFilter === fips ? ' selected' : '';
      countyOpts += '<option value="' + fips + '"' + sel + '>' + _countyNames[fips] + '</option>';
    });

    mount.innerHTML =
      '<div class="hca-comp-bar__county">' +
        '<label class="hca-comp-label" for="hcaCountyFilter">County context</label>' +
        '<select id="hcaCountyFilter" class="hca-select hca-comp-select">' + countyOpts + '</select>' +
      '</div>' +
      '<div class="hca-comp-bar">' +
        '<div class="hca-comp-selector">' +
          '<label class="hca-comp-selector__label" for="hcaCompSelectA">Jurisdiction A</label>' +
          '<div class="hca-comp-selector__wrap">' +
            '<input type="text" id="hcaCompSearchA" class="hca-comp-selector__search" placeholder="Search jurisdictions\u2026" autocomplete="off">' +
            '<select id="hcaCompSelectA" class="hca-comp-selector__select">' +
              '<option value="">\u2014 Select A \u2014</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        '<span class="hca-comp-vs">vs</span>' +
        '<div class="hca-comp-selector">' +
          '<label class="hca-comp-selector__label" for="hcaCompSelectB">Jurisdiction B</label>' +
          '<div class="hca-comp-selector__wrap">' +
            '<input type="text" id="hcaCompSearchB" class="hca-comp-selector__search" placeholder="Search jurisdictions\u2026" autocomplete="off">' +
            '<select id="hcaCompSelectB" class="hca-comp-selector__select">' +
              '<option value="">\u2014 Select B \u2014</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div class="hca-comp-actions">' +
          '<button type="button" class="hca-comp-action" id="hcaCompSwap" title="Swap A \u21c4 B">\u21c4 Swap</button>' +
          '<button type="button" class="hca-comp-action hca-comp-action--reset" id="hcaCompReset" title="Clear both">\u2715 Reset</button>' +
        '</div>' +
      '</div>';

    // Populate dropdowns
    _populateSelectors();

    // Wire county filter
    var countySelect = document.getElementById('hcaCountyFilter');
    if (countySelect) {
      countySelect.addEventListener('change', function () {
        _countyFilter = countySelect.value;
        _applyCountyFilter();
      });
    }

    // Wire search filters
    _wireSearchFilter('hcaCompSearchA', 'hcaCompSelectA', 'A');
    _wireSearchFilter('hcaCompSearchB', 'hcaCompSelectB', 'B');

    // Wire swap
    document.getElementById('hcaCompSwap').addEventListener('click', function () {
      var tmp = _compA;
      _compA = _compB;
      _compB = tmp;
      _persist();
      _renderSetupBar();
      _updateRowHighlights();
      _dispatchUpdate();
      _announce('Swapped A and B.');
    });

    // Wire reset
    document.getElementById('hcaCompReset').addEventListener('click', function () {
      _compA = null;
      _compB = null;
      _persist();
      _renderSetupBar();
      _updateRowHighlights();
      _dispatchUpdate();
      _announce('Comparison cleared.');
    });
  }

  // ── Populate selector dropdowns ───────────────────────────────────

  function _populateSelectors() {
    var state = window.HNARanking && HNARanking._get();
    if (!state) return;

    var entries = state.allEntries.slice().sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });

    var selectA = document.getElementById('hcaCompSelectA');
    var selectB = document.getElementById('hcaCompSelectB');
    if (!selectA || !selectB) return;

    var optionsHTML = '<option value="">\u2014 Select \u2014</option>';
    entries.forEach(function (e) {
      var typeLabel = e.type.charAt(0).toUpperCase() + e.type.slice(1);
      var regionLabel = e.region ? ' - ' + e.region : '';
      optionsHTML += '<option value="' + e.geoid + '">' +
        e.name + ' (' + typeLabel + regionLabel + ')' +
        '</option>';
    });

    selectA.innerHTML = optionsHTML.replace('\u2014 Select \u2014', '\u2014 Select A \u2014');
    selectB.innerHTML = optionsHTML.replace('\u2014 Select \u2014', '\u2014 Select B \u2014');

    // Set current selections
    if (_compA) selectA.value = _compA.geoid;
    if (_compB) selectB.value = _compB.geoid;
  }

  // ── Search filter wiring ──────────────────────────────────────────

  function _wireSearchFilter(searchId, selectId, side) {
    var searchInput = document.getElementById(searchId);
    var selectEl = document.getElementById(selectId);
    if (!searchInput || !selectEl) return;

    // Filter options as user types
    searchInput.addEventListener('input', function () {
      var term = searchInput.value.toLowerCase();
      var options = selectEl.querySelectorAll('option');
      options.forEach(function (opt) {
        if (!opt.value) return; // keep the placeholder visible
        if (!term || opt.textContent.toLowerCase().indexOf(term) !== -1) {
          opt.hidden = false;
          opt.disabled = false;
        } else {
          opt.hidden = true;
          opt.disabled = true;
        }
      });
    });

    // On select change, update comparison state
    selectEl.addEventListener('change', function () {
      var geoid = selectEl.value;
      if (!geoid) {
        if (side === 'A') _compA = null;
        else _compB = null;
      } else {
        var state = window.HNARanking && HNARanking._get();
        if (!state) return;
        var entry = null;
        for (var i = 0; i < state.allEntries.length; i++) {
          if (state.allEntries[i].geoid === geoid) { entry = state.allEntries[i]; break; }
        }
        if (!entry) return;
        var selection = { geoid: entry.geoid, name: entry.name, type: entry.type, region: entry.region };
        // Prevent same jurisdiction in both slots
        if (side === 'A') {
          if (_compB && _compB.geoid === geoid) _compB = null;
          _compA = selection;
        } else {
          if (_compA && _compA.geoid === geoid) _compA = null;
          _compB = selection;
        }
      }
      _persist();
      _updateRowHighlights();
      _dispatchUpdate();
      // Sync the other select if it was cleared due to duplicate
      var otherSelect = document.getElementById(side === 'A' ? 'hcaCompSelectB' : 'hcaCompSelectA');
      var otherComp = side === 'A' ? _compB : _compA;
      if (otherSelect) otherSelect.value = otherComp ? otherComp.geoid : '';
      _announce(geoid ? entry.name + ' set as ' + side + '.' : side + ' cleared.');
    });
  }

  // ── Inject HNA link column into rendered table ─────────────────────
  // Called after every ranking module re-render (sort, filter, scroll).
  // Sets the last column header to "HNA" and makes each row's last cell
  // an HNA link instead of A/B buttons.

  function _injectCompareColumn() {
    // Header — relabel the last th to "HNA"
    var thead = document.getElementById('hcaTableHead');
    if (thead) {
      var headerRow = thead.querySelector('tr');
      if (headerRow) {
        var existingTh = headerRow.querySelector('.hca-th-hna');
        if (!existingTh) {
          var ths = headerRow.querySelectorAll('th');
          var lastTh = ths[ths.length - 1];
          if (lastTh && !lastTh.classList.contains('hca-th-hna')) {
            lastTh.textContent = 'HNA';
            lastTh.classList.add('hca-th-hna');
          }
        }
      }
    }

    // Body rows — ensure the last td has an HNA link
    var tbody = document.getElementById('hcaTableBody');
    if (!tbody) return;

    var rows = tbody.querySelectorAll('.hca-tr');
    rows.forEach(function (tr) {
      // Skip rows that already have an HNA link
      if (tr.querySelector('.hca-hna-link')) return;

      var geoid = tr.dataset.geoid;
      if (!geoid) return;

      var geoType = tr.dataset.geoType || 'place';
      var nameEl = tr.querySelector('.hca-td-name');
      var name = nameEl ? nameEl.textContent.trim() : geoid;

      var tds = tr.querySelectorAll('td');
      var lastTd = tds[tds.length - 1];
      if (!lastTd) return;

      lastTd.className = 'hca-td hca-td-hna';
      lastTd.setAttribute('data-label', 'HNA');
      lastTd.innerHTML = '<a href="housing-needs-assessment.html?fips=' + geoid + '&geoType=' + geoType + '&auto=1" class="hca-hna-link" title="Open HNA for ' + name + '">HNA \u2192</a>';
    });
  }

  // ── County filter — hide/show rows ─────────────────────────────────

  function _applyCountyFilter() {
    var tbody = document.getElementById('hcaTableBody');
    if (!tbody) return;

    var rows = tbody.querySelectorAll('.hca-tr');
    var shown = 0;
    var total = rows.length;

    rows.forEach(function (tr) {
      var geoid = tr.dataset.geoid;
      if (!_countyFilter) {
        tr.style.display = '';
        shown++;
        return;
      }
      var belongsToCounty = (_countyMap[geoid] === _countyFilter || geoid === _countyFilter);
      tr.style.display = belongsToCounty ? '' : 'none';
      if (belongsToCounty) shown++;
    });

    // Update results count
    var countEl = document.getElementById('hcaResultsCount');
    if (countEl && _countyFilter) {
      var countyName = _countyNames[_countyFilter] || _countyFilter;
      countEl.textContent = shown + ' of ' + total + ' geographies (filtered to ' + countyName + ')';
    } else if (countEl && !_countyFilter) {
      // Let ranking module handle the count text
    }

    _announce(_countyFilter
      ? 'Filtered to ' + (_countyNames[_countyFilter] || 'selected county') + '. ' + shown + ' shown.'
      : 'Showing all geographies.');
  }

  // ── Row highlight management ───────────────────────────────────────

  function _updateRowHighlights() {
    document.querySelectorAll('.hca-tr').forEach(function (tr) {
      var geoid = tr.dataset.geoid;
      tr.classList.toggle('hca-comp-a', !!(_compA && _compA.geoid === geoid));
      tr.classList.toggle('hca-comp-b', !!(_compB && _compB.geoid === geoid));
    });
  }

  // (A/B button click handler removed — selection now via dropdown selectors)

  // ── Side-by-side comparison panel (Phase 2) ─────────────────────────

  var COMPARISON_METRICS = [
    { id: 'overall_need_score', label: 'Overall Need Score',     unit: 'score',   lowerBetter: true  },
    { id: 'pct_cost_burdened',  label: '% Rent Burdened',        unit: 'percent',  lowerBetter: true  },
    { id: 'in_commuters',       label: 'In-Commuters',           unit: 'integer',  lowerBetter: false },
    { id: 'population',         label: 'Population',             unit: 'integer',  lowerBetter: false },
    { id: 'median_hh_income',   label: 'Median HH Income',       unit: 'dollars',  lowerBetter: false },
    { id: 'pct_renters',        label: '% Renters',              unit: 'percent',  lowerBetter: false },
    { id: 'vacancy_rate',       label: 'Vacancy Rate',           unit: 'percent',  lowerBetter: false },
    { id: 'gross_rent_median',  label: 'Median Gross Rent',      unit: 'dollars',  lowerBetter: true  },
    { id: 'population_projection_20yr', label: 'Pop. Projection (20yr)', unit: 'integer', lowerBetter: false },
  ];

  var HOUSING_GAP_METRICS = [
    { id: 'ami_gap_30pct',     label: 'Unit Gap ≤30% AMI',  unit: 'integer', lowerBetter: true },
    { id: 'ami_gap_50pct',     label: 'Unit Gap ≤50% AMI',  unit: 'integer', lowerBetter: true },
    { id: 'ami_gap_60pct',     label: 'Unit Gap ≤60% AMI',  unit: 'integer', lowerBetter: true },
    { id: 'housing_gap_units', label: 'Total Housing Gap',   unit: 'integer', lowerBetter: true },
  ];

  // ── Summary data cache ──────────────────────────────────────────────
  var _summaryCache = {};

  function _fetchSummary(geoid) {
    if (_summaryCache[geoid]) return Promise.resolve(_summaryCache[geoid]);
    var fetcher = (typeof window.safeFetchJSON === 'function')
      ? window.safeFetchJSON
      : function (u) { return fetch(u).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); };

    return fetcher('data/hna/summary/' + geoid + '.json').then(function (data) {
      _summaryCache[geoid] = data;
      return data;
    }).catch(function () {
      return null;
    });
  }

  // ── Homeownership affordability calculations ──────────────────────
  // Reads from centralized config (js/config/financial-constants.js)
  var _cfg = window.COHO_DEFAULTS || {};
  var MORTGAGE_RATE    = _cfg.mortgageRate    || 0.07;
  var MORTGAGE_TERM_YR = _cfg.mortgageTermYr  || 30;
  var DOWN_PAYMENT_PCT = _cfg.downPaymentPct  || 0.05;
  var HOUSING_COST_PCT = _cfg.housingCostPct  || 0.30;
  var PROPERTY_TAX_RATE = _cfg.propertyTaxRate || 0.006;
  var INSURANCE_ANNUAL  = _cfg.insuranceAnnual || 2400;

  /**
   * Compute the annual household income required to purchase a home at a
   * given price, then express that as a percentage of Area Median Income.
   *
   * For current homeowners, we estimate a reduced purchase price reflecting
   * existing equity (median equity ≈ 40% of home value per Fed data).
   *
   * @param {number} homeValue  Median home value ($)
   * @param {number} ami        Area Median Income ($), approximated from median HH income
   * @param {boolean} isOwner   true = current homeowner (has equity)
   * @returns {{ amiPct: number, requiredIncome: number, monthlyPayment: number,
   *             downPayment: number, loanAmount: number }}
   */
  function _calcPurchaseAmi(homeValue, ami, isOwner) {
    if (!homeValue || !ami || homeValue <= 0 || ami <= 0) return null;

    // Current homeowners: assume 40% median equity offsets purchase price
    var effectivePrice = isOwner ? homeValue * 0.60 : homeValue;

    var downPayment = effectivePrice * DOWN_PAYMENT_PCT;
    var loanAmount  = effectivePrice - downPayment;

    // Monthly mortgage payment (P&I)
    var monthlyRate = MORTGAGE_RATE / 12;
    var nPayments   = MORTGAGE_TERM_YR * 12;
    var monthlyPI   = loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, nPayments)) /
                      (Math.pow(1 + monthlyRate, nPayments) - 1);

    // Add property tax + insurance to monthly housing cost
    var monthlyTax       = (effectivePrice * PROPERTY_TAX_RATE) / 12;
    var monthlyInsurance = INSURANCE_ANNUAL / 12;
    var monthlyPayment   = monthlyPI + monthlyTax + monthlyInsurance;

    // Required annual income (housing ≤ 30% of gross)
    var requiredIncome = (monthlyPayment * 12) / HOUSING_COST_PCT;

    // Express as percentage of AMI
    var amiPct = (requiredIncome / ami) * 100;

    return {
      amiPct: Math.round(amiPct),
      requiredIncome: Math.round(requiredIncome),
      monthlyPayment: Math.round(monthlyPayment),
      downPayment: Math.round(downPayment),
      loanAmount: Math.round(loanAmount),
    };
  }

  function _fmtVal(val, unit) {
    if (val === null || val === undefined || isNaN(val)) return '—';
    var n = +val;
    if (unit === 'percent') return n.toFixed(1) + '%';
    if (unit === 'dollars') return '$' + n.toLocaleString('en-US');
    if (unit === 'score')   return n.toFixed(1);
    return n.toLocaleString('en-US');
  }

  function _deltaText(a, b, unit, lowerBetter) {
    if (a === null || a === undefined || b === null || b === undefined) return { text: '—', cls: '' };
    var diff = a - b;
    if (Math.abs(diff) < 0.01) return { text: '=', cls: '' };

    var pct = b !== 0 ? Math.abs(diff / b * 100) : 0;
    var arrow = diff > 0 ? '▲' : '▼';
    var text;
    if (unit === 'percent' || unit === 'score') {
      text = arrow + ' ' + Math.abs(diff).toFixed(1);
    } else if (unit === 'dollars') {
      text = arrow + ' $' + Math.abs(Math.round(diff)).toLocaleString('en-US');
    } else {
      text = arrow + ' ' + Math.abs(Math.round(diff)).toLocaleString('en-US');
    }

    // Determine if A's value is "better" than B's
    var aBetter = lowerBetter ? (a < b) : (a > b);
    return { text: text, cls: aBetter ? 'hca-cp-row__delta--better' : 'hca-cp-row__delta--worse' };
  }

  // ── AMI Mix recommendation builder ─────────────────────────────────

  function _deriveAmiMix(entry) {
    var m = entry.metrics;
    var gap30 = m.ami_gap_30pct || 0;
    var gap50 = m.ami_gap_50pct || 0;
    var gap60 = m.ami_gap_60pct || 0;

    // Incremental gaps between tiers
    var tier30 = gap30;                         // ≤30% AMI
    var tier3150 = Math.max(gap50 - gap30, 0);  // 31–50% AMI
    var tier5160 = Math.max(gap60 - gap50, 0);  // 51–60% AMI

    var total = tier30 + tier3150 + tier5160;
    if (total === 0) return null;

    return {
      tiers: [
        { label: '≤30% AMI', units: tier30, pct: (tier30 / total * 100) },
        { label: '31–50% AMI', units: tier3150, pct: (tier3150 / total * 100) },
        { label: '51–60% AMI', units: tier5160, pct: (tier5160 / total * 100) },
      ],
      totalGap: total,
      burden: {
        lte30: m.pct_burdened_lte30,
        b3150: m.pct_burdened_31to50,
        b5180: m.pct_burdened_51to80,
      },
      missingTiers: m.missing_ami_tiers || [],
    };
  }

  // ── Housing Gap section builder ─────────────────────────────────────

  function _buildHousingGapSection(entryA, entryB) {
    var html = '<div class="hca-cp-section">';
    html += '<h4 class="hca-cp-section__title">Housing Gap Analysis <span class="hca-cp-source">ACS 2024 · HUD CHAS · LEHD LODES</span></h4>';

    HOUSING_GAP_METRICS.forEach(function (m) {
      var valA = entryA.metrics[m.id];
      var valB = entryB.metrics[m.id];
      var numA = (valA !== null && valA !== undefined) ? +valA : null;
      var numB = (valB !== null && valB !== undefined) ? +valB : null;

      var maxVal = Math.max(Math.abs(numA || 0), Math.abs(numB || 0));
      var pctA = maxVal > 0 && numA !== null ? (Math.abs(numA) / maxVal * 100) : 0;
      var pctB = maxVal > 0 && numB !== null ? (Math.abs(numB) / maxVal * 100) : 0;
      var delta = _deltaText(numA, numB, m.unit, m.lowerBetter);

      html += '<div class="hca-cp-row">' +
        '<div class="hca-cp-row__label">' + m.label + '</div>' +
        '<div class="hca-cp-row__val">' +
          '<span class="hca-cp-row__num">' + _fmtVal(numA, m.unit) + '</span>' +
          '<div class="hca-cp-row__bar-wrap"><div class="hca-cp-row__bar hca-cp-row__bar--a" style="width:' + pctA.toFixed(1) + '%"></div></div>' +
        '</div>' +
        '<div class="hca-cp-row__delta ' + delta.cls + '">' + delta.text + '</div>' +
        '<div class="hca-cp-row__val">' +
          '<span class="hca-cp-row__num">' + _fmtVal(numB, m.unit) + '</span>' +
          '<div class="hca-cp-row__bar-wrap"><div class="hca-cp-row__bar hca-cp-row__bar--b" style="width:' + pctB.toFixed(1) + '%"></div></div>' +
        '</div>' +
      '</div>';
    });

    // Cost burden breakdown by tier
    html += '<div class="hca-cp-subsection">';
    html += '<div class="hca-cp-subsection__title">Renter Cost Burden by Income Tier</div>';
    var burdenMetrics = [
      { id: 'pct_burdened_lte30',  label: '≤30% AMI burdened' },
      { id: 'pct_burdened_31to50', label: '31–50% AMI burdened' },
      { id: 'pct_burdened_51to80', label: '51–80% AMI burdened' },
    ];
    burdenMetrics.forEach(function (bm) {
      var bA = entryA.metrics[bm.id];
      var bB = entryB.metrics[bm.id];
      var numA = bA != null ? +bA : null;
      var numB = bB != null ? +bB : null;
      var delta = _deltaText(numA, numB, 'percent', true);
      html += '<div class="hca-cp-row hca-cp-row--compact">' +
        '<div class="hca-cp-row__label">' + bm.label + '</div>' +
        '<div class="hca-cp-row__val"><span class="hca-cp-row__num">' + _fmtVal(numA, 'percent') + '</span></div>' +
        '<div class="hca-cp-row__delta ' + delta.cls + '">' + delta.text + '</div>' +
        '<div class="hca-cp-row__val"><span class="hca-cp-row__num">' + _fmtVal(numB, 'percent') + '</span></div>' +
      '</div>';
    });
    html += '</div>';
    html += '</div>';
    return html;
  }

  // ── Homeownership Affordability section builder ───────────────────

  function _buildHomeownershipSection(summaryA, summaryB, entryA, entryB) {
    var pA = summaryA ? summaryA.acsProfile || {} : {};
    var pB = summaryB ? summaryB.acsProfile || {} : {};

    var homeValA = pA.DP04_0089E != null ? +pA.DP04_0089E : null;
    var homeValB = pB.DP04_0089E != null ? +pB.DP04_0089E : null;
    var incomeA  = pA.DP03_0062E != null ? +pA.DP03_0062E : null;
    var incomeB  = pB.DP03_0062E != null ? +pB.DP03_0062E : null;
    var ownerPctA = pA.DP04_0046PE != null ? +pA.DP04_0046PE : null;
    var ownerPctB = pB.DP04_0046PE != null ? +pB.DP04_0046PE : null;

    // Owner cost burden (30%+ of income): DP04_0145PE (30-34.9%) + DP04_0146PE (≥35%)
    var ownerBurdenA = null, ownerBurdenB = null;
    if (pA.DP04_0145PE != null && pA.DP04_0146PE != null) ownerBurdenA = +pA.DP04_0145PE + +pA.DP04_0146PE;
    if (pB.DP04_0145PE != null && pB.DP04_0146PE != null) ownerBurdenB = +pB.DP04_0145PE + +pB.DP04_0146PE;

    // Compute AMI required to purchase (use median HH income as AMI proxy)
    var purchaseRenter_A = _calcPurchaseAmi(homeValA, incomeA, false);
    var purchaseRenter_B = _calcPurchaseAmi(homeValB, incomeB, false);
    var purchaseOwner_A  = _calcPurchaseAmi(homeValA, incomeA, true);
    var purchaseOwner_B  = _calcPurchaseAmi(homeValB, incomeB, true);

    // Affordability index = home price / income
    var affIdxA = homeValA && incomeA ? (homeValA / incomeA) : null;
    var affIdxB = homeValB && incomeB ? (homeValB / incomeB) : null;

    if (!homeValA && !homeValB) return '';

    var html = '<div class="hca-cp-section hca-cp-homeownership">';
    html += '<h4 class="hca-cp-section__title">Homeownership Affordability <span class="hca-cp-source">ACS 2024 DP04 · Freddie Mac PMMS</span></h4>';

    // Basic metrics rows
    var hoMetrics = [
      { label: 'Median Home Value', vA: homeValA, vB: homeValB, unit: 'dollars', lower: true },
      { label: '% Owner-Occupied',  vA: ownerPctA, vB: ownerPctB, unit: 'percent', lower: false },
      { label: 'Price-to-Income Ratio', vA: affIdxA ? +affIdxA.toFixed(1) : null, vB: affIdxB ? +affIdxB.toFixed(1) : null, unit: 'ratio', lower: true },
      { label: '% Owners Cost-Burdened', vA: ownerBurdenA ? +ownerBurdenA.toFixed(1) : null, vB: ownerBurdenB ? +ownerBurdenB.toFixed(1) : null, unit: 'percent', lower: true },
    ];

    hoMetrics.forEach(function (m) {
      var numA = m.vA, numB = m.vB;
      var maxVal = Math.max(Math.abs(numA || 0), Math.abs(numB || 0));
      var pctA = maxVal > 0 && numA !== null ? (Math.abs(numA) / maxVal * 100) : 0;
      var pctB = maxVal > 0 && numB !== null ? (Math.abs(numB) / maxVal * 100) : 0;
      var delta = _deltaText(numA, numB, m.unit, m.lower);
      var fmt = function (v) {
        if (v === null || v === undefined) return '—';
        if (m.unit === 'dollars') return '$' + Math.round(v).toLocaleString('en-US');
        if (m.unit === 'percent') return v.toFixed(1) + '%';
        if (m.unit === 'ratio') return v.toFixed(1) + 'x';
        return v.toLocaleString('en-US');
      };

      html += '<div class="hca-cp-row">' +
        '<div class="hca-cp-row__label">' + m.label + '</div>' +
        '<div class="hca-cp-row__val">' +
          '<span class="hca-cp-row__num">' + fmt(numA) + '</span>' +
          '<div class="hca-cp-row__bar-wrap"><div class="hca-cp-row__bar hca-cp-row__bar--a" style="width:' + pctA.toFixed(1) + '%"></div></div>' +
        '</div>' +
        '<div class="hca-cp-row__delta ' + delta.cls + '">' + delta.text + '</div>' +
        '<div class="hca-cp-row__val">' +
          '<span class="hca-cp-row__num">' + fmt(numB) + '</span>' +
          '<div class="hca-cp-row__bar-wrap"><div class="hca-cp-row__bar hca-cp-row__bar--b" style="width:' + pctB.toFixed(1) + '%"></div></div>' +
        '</div>' +
      '</div>';
    });

    // AMI-to-Purchase comparison table
    html += '<div class="hca-cp-subsection hca-cp-purchase">';
    html += '<div class="hca-cp-subsection__title">AMI Required to Purchase a Home</div>';
    html += '<div class="hca-cp-purchase__note">Based on 7% rate, 30-yr term, 5% down, 30% debt-to-income</div>';

    html += '<div class="hca-cp-purchase__grid">';

    // Non-homeowner scenario
    html += '<div class="hca-cp-purchase__scenario">';
    html += '<div class="hca-cp-purchase__scenario-title">First-Time Buyer (no existing equity)</div>';
    html += _purchaseRow('AMI Required', purchaseRenter_A, purchaseRenter_B, 'amiPct');
    html += _purchaseRow('Income Needed', purchaseRenter_A, purchaseRenter_B, 'requiredIncome');
    html += _purchaseRow('Monthly Payment', purchaseRenter_A, purchaseRenter_B, 'monthlyPayment');
    html += _purchaseRow('Down Payment', purchaseRenter_A, purchaseRenter_B, 'downPayment');
    html += '</div>';

    // Homeowner scenario (with equity)
    html += '<div class="hca-cp-purchase__scenario">';
    html += '<div class="hca-cp-purchase__scenario-title">Current Homeowner (est. 40% equity)</div>';
    html += _purchaseRow('AMI Required', purchaseOwner_A, purchaseOwner_B, 'amiPct');
    html += _purchaseRow('Income Needed', purchaseOwner_A, purchaseOwner_B, 'requiredIncome');
    html += _purchaseRow('Monthly Payment', purchaseOwner_A, purchaseOwner_B, 'monthlyPayment');
    html += _purchaseRow('Capital Advantage', purchaseRenter_A && purchaseOwner_A ? { val: purchaseRenter_A.requiredIncome - purchaseOwner_A.requiredIncome } : null,
                          purchaseRenter_B && purchaseOwner_B ? { val: purchaseRenter_B.requiredIncome - purchaseOwner_B.requiredIncome } : null, 'val');
    html += '</div>';

    html += '</div>'; // grid
    html += '</div>'; // subsection
    html += '</div>'; // section
    return html;
  }

  function _purchaseRow(label, dataA, dataB, field) {
    var vA = dataA ? dataA[field] : null;
    var vB = dataB ? dataB[field] : null;
    var fmtFn;
    if (field === 'amiPct') {
      fmtFn = function (v) { return v != null ? v + '% AMI' : '—'; };
    } else {
      fmtFn = function (v) { return v != null ? '$' + Math.round(v).toLocaleString('en-US') : '—'; };
    }

    // Color code AMI percentage
    var clsA = '', clsB = '';
    if (field === 'amiPct') {
      clsA = vA != null ? (vA <= 80 ? 'hca-cp-ami-ok' : vA <= 120 ? 'hca-cp-ami-stretch' : 'hca-cp-ami-out') : '';
      clsB = vB != null ? (vB <= 80 ? 'hca-cp-ami-ok' : vB <= 120 ? 'hca-cp-ami-stretch' : 'hca-cp-ami-out') : '';
    }

    return '<div class="hca-cp-purchase__row">' +
      '<span class="hca-cp-purchase__label">' + label + '</span>' +
      '<span class="hca-cp-purchase__val hca-cp-purchase__val--a ' + clsA + '">' + fmtFn(vA) + '</span>' +
      '<span class="hca-cp-purchase__val hca-cp-purchase__val--b ' + clsB + '">' + fmtFn(vB) + '</span>' +
    '</div>';
  }

  function _buildAmiMixSection(entryA, entryB) {
    var mixA = _deriveAmiMix(entryA);
    var mixB = _deriveAmiMix(entryB);
    if (!mixA && !mixB) return '';

    var html = '<div class="hca-cp-ami">';
    html += '<h4 class="hca-cp-ami__title">Recommended AMI Unit Mix <span class="hca-cp-source">HUD CHAS · AMI Gap Model</span></h4>';

    // Stacked bar comparison
    html += '<div class="hca-cp-ami__bars">';
    [{ label: 'A', mix: mixA, entry: entryA, cls: 'a' },
     { label: 'B', mix: mixB, entry: entryB, cls: 'b' }].forEach(function (side) {
      html += '<div class="hca-cp-ami__side">';
      html += '<div class="hca-cp-ami__side-label hca-cp-ami__side-label--' + side.cls + '">' + side.entry.name + '</div>';
      if (!side.mix) {
        html += '<div class="hca-cp-ami__no-data">Insufficient AMI data</div>';
      } else {
        // Stacked horizontal bar
        html += '<div class="hca-cp-ami__stack">';
        side.mix.tiers.forEach(function (t, i) {
          var tierCls = 'hca-cp-ami__seg--t' + i;
          html += '<div class="hca-cp-ami__seg ' + tierCls + '" style="width:' + t.pct.toFixed(1) + '%" title="' + t.label + ': ' + t.pct.toFixed(0) + '% (' + t.units.toLocaleString('en-US') + ' units)">';
          if (t.pct >= 12) html += t.pct.toFixed(0) + '%';
          html += '</div>';
        });
        html += '</div>';
        // Legend
        html += '<div class="hca-cp-ami__legend">';
        side.mix.tiers.forEach(function (t, i) {
          html += '<span class="hca-cp-ami__legend-item">' +
            '<span class="hca-cp-ami__legend-swatch hca-cp-ami__seg--t' + i + '"></span>' +
            t.label + ': ' + t.pct.toFixed(0) + '% <small>(' + t.units.toLocaleString('en-US') + ')</small>' +
          '</span>';
        });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';

    // Cost burden by tier comparison
    html += '<div class="hca-cp-ami__burden">';
    html += '<div class="hca-cp-ami__burden-title">Cost Burden by AMI Tier</div>';
    var burdenTiers = [
      { key: 'lte30', label: '≤30% AMI' },
      { key: 'b3150', label: '31–50% AMI' },
      { key: 'b5180', label: '51–80% AMI' },
    ];
    burdenTiers.forEach(function (bt) {
      var bA = mixA && mixA.burden[bt.key] != null ? mixA.burden[bt.key] : null;
      var bB = mixB && mixB.burden[bt.key] != null ? mixB.burden[bt.key] : null;
      html += '<div class="hca-cp-ami__burden-row">' +
        '<span class="hca-cp-ami__burden-label">' + bt.label + '</span>' +
        '<span class="hca-cp-ami__burden-val hca-cp-ami__burden-val--a">' + (bA != null ? bA + '%' : '—') + '</span>' +
        '<span class="hca-cp-ami__burden-val hca-cp-ami__burden-val--b">' + (bB != null ? bB + '%' : '—') + '</span>' +
      '</div>';
    });
    html += '</div>';

    // Missing/underserved tiers
    if ((mixA && mixA.missingTiers.length) || (mixB && mixB.missingTiers.length)) {
      html += '<div class="hca-cp-ami__missing">';
      html += '<div class="hca-cp-ami__missing-title">Underserved Rental Tiers</div>';
      html += '<div class="hca-cp-ami__missing-grid">';
      [{ entry: entryA, mix: mixA, cls: 'a' }, { entry: entryB, mix: mixB, cls: 'b' }].forEach(function (side) {
        html += '<div class="hca-cp-ami__missing-col">';
        html += '<span class="hca-cp-ami__missing-name hca-cp-ami__missing-name--' + side.cls + '">' + side.entry.name + '</span>';
        if (side.mix && side.mix.missingTiers.length) {
          side.mix.missingTiers.forEach(function (tier) {
            html += '<span class="hca-ami-missing-badge">' + tier + '</span> ';
          });
        } else {
          html += '<span style="color:var(--muted);font-size:.82rem">None identified</span>';
        }
        html += '</div>';
      });
      html += '</div>';
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function _renderComparisonPanel() {
    var panel = document.getElementById('hcaComparisonPanel');
    if (!panel) return;

    if (!_compA || !_compB) {
      panel.style.display = 'none';
      return;
    }

    var state = window.HNARanking && HNARanking._get();
    if (!state) { panel.style.display = 'none'; return; }

    // Look up full entry data
    var entryA = null, entryB = null;
    for (var i = 0; i < state.allEntries.length; i++) {
      if (state.allEntries[i].geoid === _compA.geoid) entryA = state.allEntries[i];
      if (state.allEntries[i].geoid === _compB.geoid) entryB = state.allEntries[i];
      if (entryA && entryB) break;
    }
    if (!entryA || !entryB) { panel.style.display = 'none'; return; }

    // Render the panel with ranking-index data first (instant),
    // then fetch summary data for homeownership section (async overlay).
    _renderPanelHTML(panel, entryA, entryB, null, null);

    // Fetch summary data for both jurisdictions (for homeownership metrics)
    Promise.all([
      _fetchSummary(entryA.geoid),
      _fetchSummary(entryB.geoid),
    ]).then(function (summaries) {
      // Re-render with full summary data
      if (panel.style.display !== 'none') {
        _renderPanelHTML(panel, entryA, entryB, summaries[0], summaries[1]);
      }
    });
  }

  // Geography-type badge for side-by-side names. Surfaces whether each
  // jurisdiction is a county / city / CDP / town / state so users don't
  // accidentally compare apples-to-oranges.
  function _scopeBadge(type) {
    var t = String(type || '').toLowerCase();
    var label, bg, fg;
    if (t === 'county')      { label = 'County'; bg = 'var(--info-dim, #dbeafe)'; fg = 'var(--info, #2563eb)'; }
    else if (t === 'state')  { label = 'State';  bg = 'var(--accent-dim, #d1fae5)'; fg = 'var(--accent, #096e65)'; }
    else if (t === 'cdp')    { label = 'CDP';    bg = 'color-mix(in oklab, var(--card,#fff) 90%, var(--warn,#d97706) 10%)'; fg = 'var(--warn, #d97706)'; }
    else if (t === 'place')  { label = 'City';   bg = 'var(--good-dim, #d1fae5)'; fg = 'var(--good, #047857)'; }
    else if (t === 'town')   { label = 'Town';   bg = 'var(--good-dim, #d1fae5)'; fg = 'var(--good, #047857)'; }
    else                     { label = (type || 'Other'); bg = 'var(--bg2, #f4f4f4)'; fg = 'var(--muted, #555)'; }
    return '<span class="hca-cp-scope-badge" style="display:inline-block;font-size:.66rem;font-weight:700;padding:1px 6px;border-radius:3px;background:' + bg + ';color:' + fg + ';margin-left:.5rem;letter-spacing:.02em;text-transform:uppercase;vertical-align:middle;" title="Geography type: ' + label + '">' + label + '</span>';
  }

  // CDP-specific advisory: the user should know CDPs are statistical
  // areas, not legal jurisdictions.
  function _scopeNote(type) {
    var t = String(type || '').toLowerCase();
    if (t === 'cdp') return 'Census-Designated Place — statistical boundary, not a legal jurisdiction';
    return null;
  }

  function _renderPanelHTML(panel, entryA, entryB, summaryA, summaryB) {
    var state = window.HNARanking && HNARanking._get();
    var total = state ? state.allEntries.length : 0;
    var scorecardData = HNARanking.getScorecardData ? HNARanking.getScorecardData() : {};
    var scA = scorecardData[entryA.geoid];
    var scB = scorecardData[entryB.geoid];

    // Build header
    var html = '<div class="hca-cp-header">' +
      '<h3 class="hca-cp-title">Side-by-Side Comparison</h3>' +
      '<button type="button" class="hca-cp-close" id="hcaCpClose" title="Close comparison panel" aria-label="Close comparison panel">✕</button>' +
    '</div>';

    // Mismatched-scope warning — comparing a county to a city/CDP is
    // apples-to-oranges. ACS values are at different population scales,
    // labor stats may be unavailable for sub-county geos, and percentages
    // can mislead. Surface this prominently.
    var typeA = String(entryA.type || '').toLowerCase();
    var typeB = String(entryB.type || '').toLowerCase();
    var typesMatch = (typeA === typeB);
    if (!typesMatch && typeA && typeB) {
      var labelA = (typeA === 'place' ? 'city' : typeA);
      var labelB = (typeB === 'place' ? 'city' : typeB);
      html += '<div role="note" class="hca-cp-scope-warning" style="margin-bottom:.75rem;padding:.5rem .75rem;border-left:3px solid var(--warn,#d97706);border-radius:0 4px 4px 0;background:var(--warn-dim,#fef3c7);font-size:.78rem;line-height:1.45;color:var(--text);">' +
        '<strong style="color:var(--warn,#d97706);">⚠ Mixed-scope comparison.</strong> ' +
        'You\u2019re comparing a ' + labelA + ' to a ' + labelB + '. ACS values are at different population scales; labor stats may be unavailable for sub-county geographies; percentage metrics can be misleading across scopes. ' +
        'Use the absolute counts and treat the comparison as directional.' +
      '</div>';
    }

    // Names row — scope badges next to each name
    var noteA = _scopeNote(entryA.type);
    var noteB = _scopeNote(entryB.type);
    html += '<div class="hca-cp-names">' +
      '<div class="hca-cp-names__label"></div>' +
      '<div class="hca-cp-names__a">' + entryA.name + _scopeBadge(entryA.type) +
        '<div class="hca-cp-rank">#' + entryA.rank + ' of ' + total + ' · ' + entryA.percentileRank + 'th pctile</div>' +
        (noteA ? '<div class="hca-cp-scope-note" style="font-size:.66rem;color:var(--muted);font-style:italic;margin-top:2px;">' + noteA + '</div>' : '') +
      '</div>' +
      '<div class="hca-cp-names__vs">vs</div>' +
      '<div class="hca-cp-names__b">' + entryB.name + _scopeBadge(entryB.type) +
        '<div class="hca-cp-rank">#' + entryB.rank + ' of ' + total + ' · ' + entryB.percentileRank + 'th pctile</div>' +
        (noteB ? '<div class="hca-cp-scope-note" style="font-size:.66rem;color:var(--muted);font-style:italic;margin-top:2px;">' + noteB + '</div>' : '') +
      '</div>' +
    '</div>';

    // ── Core Demographics ──
    html += '<div class="hca-cp-metrics">';
    html += '<h4 class="hca-cp-section__title">Demographics & Market <span class="hca-cp-source">ACS 2024 · DOLA · LEHD LODES</span></h4>';
    COMPARISON_METRICS.forEach(function (m) {
      var valA = entryA.metrics[m.id];
      var valB = entryB.metrics[m.id];
      var numA = (valA !== null && valA !== undefined) ? +valA : null;
      var numB = (valB !== null && valB !== undefined) ? +valB : null;

      var maxVal = Math.max(Math.abs(numA || 0), Math.abs(numB || 0));
      var pctA = maxVal > 0 && numA !== null ? (Math.abs(numA) / maxVal * 100) : 0;
      var pctB = maxVal > 0 && numB !== null ? (Math.abs(numB) / maxVal * 100) : 0;

      var delta = _deltaText(numA, numB, m.unit, m.lowerBetter);

      html += '<div class="hca-cp-row">' +
        '<div class="hca-cp-row__label">' + m.label + '</div>' +
        '<div class="hca-cp-row__val">' +
          '<span class="hca-cp-row__num">' + _fmtVal(numA, m.unit) + '</span>' +
          '<div class="hca-cp-row__bar-wrap"><div class="hca-cp-row__bar hca-cp-row__bar--a" style="width:' + pctA.toFixed(1) + '%"></div></div>' +
        '</div>' +
        '<div class="hca-cp-row__delta ' + delta.cls + '">' + delta.text + '</div>' +
        '<div class="hca-cp-row__val">' +
          '<span class="hca-cp-row__num">' + _fmtVal(numB, m.unit) + '</span>' +
          '<div class="hca-cp-row__bar-wrap"><div class="hca-cp-row__bar hca-cp-row__bar--b" style="width:' + pctB.toFixed(1) + '%"></div></div>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';

    // ── Housing Gap Analysis ──
    html += _buildHousingGapSection(entryA, entryB);

    // ── Homeownership Affordability (requires summary data) ──
    if (summaryA || summaryB) {
      html += _buildHomeownershipSection(summaryA, summaryB, entryA, entryB);
    } else {
      html += '<div class="hca-cp-section hca-cp-homeownership">' +
        '<h4 class="hca-cp-section__title">Homeownership Affordability</h4>' +
        '<div class="hca-cp-loading">Loading ACS data…</div>' +
      '</div>';
    }

    // ── Scorecard comparison ──
    html += '<div class="hca-cp-scorecard">';
    var scAText = scA && scA.knownDimensions > 0 ? scA.totalScore + '/' + scA.knownDimensions : '—';
    var scBText = scB && scB.knownDimensions > 0 ? scB.totalScore + '/' + scB.knownDimensions : '—';
    var scANum = scA ? scA.totalScore : 0;
    var scBNum = scB ? scB.totalScore : 0;
    var scMax = Math.max(scANum, scBNum, 1);
    var scDelta = _deltaText(scANum, scBNum, 'score', false);

    html += '<div class="hca-cp-row">' +
      '<div class="hca-cp-row__label">Housing Commitment</div>' +
      '<div class="hca-cp-row__val">' +
        '<span class="hca-cp-row__num">' + scAText + '</span>' +
        '<div class="hca-cp-row__bar-wrap"><div class="hca-cp-row__bar hca-cp-row__bar--a" style="width:' + (scANum / scMax * 100).toFixed(1) + '%"></div></div>' +
      '</div>' +
      '<div class="hca-cp-row__delta ' + scDelta.cls + '">' + scDelta.text + '</div>' +
      '<div class="hca-cp-row__val">' +
        '<span class="hca-cp-row__num">' + scBText + '</span>' +
        '<div class="hca-cp-row__bar-wrap"><div class="hca-cp-row__bar hca-cp-row__bar--b" style="width:' + (scBNum / scMax * 100).toFixed(1) + '%"></div></div>' +
      '</div>' +
    '</div>';
    html += '</div>';

    // ── Recommended AMI Mix section ──
    html += _buildAmiMixSection(entryA, entryB);

    panel.innerHTML = html;
    panel.style.display = 'block';

    // Wire close button
    var closeBtn = document.getElementById('hcaCpClose');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        panel.style.display = 'none';
      });
    }
  }

  // ── Events ─────────────────────────────────────────────────────────

  function _dispatchUpdate() {
    _renderComparisonPanel();
    document.dispatchEvent(new CustomEvent('comparison:updated', {
      detail: { a: _compA, b: _compB, countyFilter: _countyFilter }
    }));
  }

  function _announce(msg) {
    var el = document.getElementById('hcaLiveRegion');
    if (el) { el.textContent = ''; requestAnimationFrame(function () { el.textContent = msg; }); }
  }

  // ── Watch table renders to inject Compare column ───────────────────
  // MutationObserver on tbody detects when hna-ranking-index.js adds rows
  // (initial load, sort, filter, infinite scroll), then injects A/B buttons.

  function _watchTableRenders() {
    var tbody = document.getElementById('hcaTableBody');
    if (!tbody) return;

    var observer = new MutationObserver(function () {
      _injectCompareColumn();
      _updateRowHighlights();
      if (_countyFilter) _applyCountyFilter();
    });
    observer.observe(tbody, { childList: true });

    // Also watch thead for header rebuilds
    var thead = document.getElementById('hcaTableHead');
    if (thead) {
      var headObserver = new MutationObserver(function () {
        // Re-inject the HNA header
        var headerRow = thead.querySelector('tr');
        if (headerRow) {
          var existingTh = headerRow.querySelector('.hca-th-hna');
          if (!existingTh) {
            var ths = headerRow.querySelectorAll('th');
            var lastTh = ths[ths.length - 1];
            if (lastTh && !lastTh.classList.contains('hca-th-hna')) {
              lastTh.textContent = 'HNA';
              lastTh.classList.add('hca-th-hna');
            }
          }
        }
      });
      headObserver.observe(thead, { childList: true, subtree: true });
    }
  }

  // ── Init ───────────────────────────────────────────────────────────

  function init() {
    if (!window.HNARanking) return;

    var state = HNARanking._get();
    if (!state || !state.allEntries.length) {
      setTimeout(init, 200);
      return;
    }

    _buildCountyMap(state.allEntries);

    _loadGeoConfig().then(function () {
      _buildCountyMap(state.allEntries);
      _restore();
      _renderSetupBar();
      _injectCompareColumn();
      _updateRowHighlights();
      _watchTableRenders();
      _ready = true;
      _dispatchUpdate();
    });

    // (A/B button delegation removed — selection now via dropdown selectors)
  }

  // ── Public API ─────────────────────────────────────────────────────

  window.HNAComparison = {
    init: init,
    setA: function (entry) { _compA = entry; _persist(); _renderSetupBar(); _updateRowHighlights(); _dispatchUpdate(); },
    setB: function (entry) { _compB = entry; _persist(); _renderSetupBar(); _updateRowHighlights(); _dispatchUpdate(); },
    clearA: function () { _compA = null; _persist(); _renderSetupBar(); _updateRowHighlights(); _dispatchUpdate(); },
    clearB: function () { _compB = null; _persist(); _renderSetupBar(); _updateRowHighlights(); _dispatchUpdate(); },
    swap: function () { var t = _compA; _compA = _compB; _compB = t; _persist(); _renderSetupBar(); _updateRowHighlights(); _dispatchUpdate(); },
    reset: function () { _compA = null; _compB = null; _persist(); _renderSetupBar(); _updateRowHighlights(); _dispatchUpdate(); },
    getState: function () { return { a: _compA, b: _compB, countyFilter: _countyFilter }; },
    /* Exposed for testing — pure functions, no DOM access */
    _scopeBadge: _scopeBadge,
    _scopeNote:  _scopeNote
  };

  // Auto-init after DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 100); });
  } else {
    setTimeout(init, 100);
  }

})();
