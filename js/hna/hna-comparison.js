/**
 * js/hna/hna-comparison.js
 * Comparison workspace for hna-comparative-analysis.html
 * Phase 1: County context filtering + A/B jurisdiction selection
 *
 * Depends on: js/hna/hna-ranking-index.js (window.HNARanking)
 *             js/site-state.js (window.SiteState) — optional
 *
 * Strategy: Rather than duplicating row rendering from hna-ranking-index.js,
 * this module injects A/B button cells into existing rows via MutationObserver.
 * County filtering hides/shows rows via CSS rather than rebuilding the table.
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
      }
    });

    // Apply geo-config if cached
    var geoConfig = window._geoConfigCache || null;
    if (geoConfig && Array.isArray(geoConfig.featured)) {
      geoConfig.featured.forEach(function (g) {
        if (g.containingCounty && g.geoid) {
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
      '<div class="hca-comp-bar">' +
        '<div class="hca-comp-bar__county">' +
          '<label class="hca-comp-label" for="hcaCountyFilter">County context</label>' +
          '<select id="hcaCountyFilter" class="hca-select hca-comp-select">' + countyOpts + '</select>' +
        '</div>' +
        '<div class="hca-comp-bar__vs">' +
          '<div class="hca-comp-slot" id="hcaSlotA">' + _renderSlot('A', _compA) + '</div>' +
          '<span class="hca-comp-vs-label">vs</span>' +
          '<div class="hca-comp-slot" id="hcaSlotB">' + _renderSlot('B', _compB) + '</div>' +
        '</div>' +
        '<div class="hca-comp-bar__actions">' +
          '<button type="button" class="hca-comp-action" id="hcaSwapBtn" title="Swap A and B"' +
            (!_compA || !_compB ? ' disabled' : '') + '>Swap</button>' +
          '<button type="button" class="hca-comp-action hca-comp-action--reset" id="hcaResetBtn" title="Clear comparison"' +
            (!_compA && !_compB ? ' disabled' : '') + '>Reset</button>' +
        '</div>' +
      '</div>';

    // Wire events
    var countySelect = document.getElementById('hcaCountyFilter');
    if (countySelect) {
      countySelect.addEventListener('change', function () {
        _countyFilter = countySelect.value;
        _applyCountyFilter();
      });
    }

    document.getElementById('hcaSwapBtn').addEventListener('click', function () {
      var tmp = _compA;
      _compA = _compB;
      _compB = tmp;
      _persist();
      _renderSetupBar();
      _updateRowHighlights();
      _announce('Swapped A and B.');
    });

    document.getElementById('hcaResetBtn').addEventListener('click', function () {
      _compA = null;
      _compB = null;
      _persist();
      _renderSetupBar();
      _updateRowHighlights();
      _announce('Comparison cleared.');
    });
  }

  function _renderSlot(label, entry) {
    if (!entry) {
      return '<span class="hca-comp-slot__empty">' + label + ': click a row\'s "' + label + '" button</span>';
    }
    return '<span class="hca-comp-slot__label">' + label + ':</span> ' +
      '<strong class="hca-comp-slot__name">' + entry.name + '</strong>' +
      '<button type="button" class="hca-comp-slot__clear" data-clear="' + label + '" title="Clear ' + label + '">✕</button>';
  }

  // ── Inject Compare column into rendered table ──────────────────────
  // Called after every ranking module re-render (sort, filter, scroll).
  // Adds a "Compare" <th> to the header and A/B button <td> to each row
  // that doesn't already have one.

  function _injectCompareColumn() {
    // Header
    var thead = document.getElementById('hcaTableHead');
    if (thead) {
      var headerRow = thead.querySelector('tr');
      if (headerRow) {
        // Check if Compare th already exists
        var existingTh = headerRow.querySelector('.hca-th-compare');
        if (!existingTh) {
          // Replace the last "Open HNA" th with Compare
          var ths = headerRow.querySelectorAll('th');
          var lastTh = ths[ths.length - 1];
          if (lastTh && lastTh.textContent.trim() === '') {
            // The ranking module renders an empty-label th for the HNA link column
            lastTh.textContent = 'Compare';
            lastTh.classList.add('hca-th-compare');
          }
        }
      }
    }

    // Body rows — replace the last <td> (Open HNA link) with A/B buttons
    var tbody = document.getElementById('hcaTableBody');
    if (!tbody) return;

    var rows = tbody.querySelectorAll('.hca-tr');
    rows.forEach(function (tr) {
      // Skip rows that already have A/B buttons
      if (tr.querySelector('.hca-ab-btn')) return;

      var geoid = tr.dataset.geoid;
      if (!geoid) return;

      var isA = _compA && _compA.geoid === geoid;
      var isB = _compB && _compB.geoid === geoid;

      // Find the last td (which has the "Open HNA →" link)
      var tds = tr.querySelectorAll('td');
      var lastTd = tds[tds.length - 1];
      if (!lastTd) return;

      // Replace its content with A/B buttons (the HNA link is already on the name column)
      lastTd.className = 'hca-td hca-td-compare';
      lastTd.setAttribute('data-label', 'Compare');
      lastTd.innerHTML =
        '<button type="button" class="hca-ab-btn hca-ab-btn--a' + (isA ? ' active' : '') + '" data-action="setA" data-geoid="' + geoid + '" title="Set as A">' + (isA ? '✓ A' : 'A') + '</button>' +
        '<button type="button" class="hca-ab-btn hca-ab-btn--b' + (isB ? ' active' : '') + '" data-action="setB" data-geoid="' + geoid + '" title="Set as B">' + (isB ? '✓ B' : 'B') + '</button>';
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

      // Update A/B button states if they exist
      var btnA = tr.querySelector('[data-action="setA"]');
      var btnB = tr.querySelector('[data-action="setB"]');
      if (btnA) {
        var isA = _compA && _compA.geoid === geoid;
        btnA.classList.toggle('active', isA);
        btnA.textContent = isA ? '✓ A' : 'A';
      }
      if (btnB) {
        var isB = _compB && _compB.geoid === geoid;
        btnB.classList.toggle('active', isB);
        btnB.textContent = isB ? '✓ B' : 'B';
      }
    });
  }

  // ── A/B button click handler (delegated) ───────────────────────────

  function _handleABClick(e) {
    var btn = e.target.closest('.hca-ab-btn');
    if (!btn) return;

    e.stopPropagation();
    var action = btn.dataset.action;
    var geoid = btn.dataset.geoid;

    // Find entry in ranking data
    var state = window.HNARanking && HNARanking._get();
    if (!state) return;
    var entry = null;
    for (var i = 0; i < state.allEntries.length; i++) {
      if (state.allEntries[i].geoid === geoid) { entry = state.allEntries[i]; break; }
    }
    if (!entry) return;

    var selection = { geoid: entry.geoid, name: entry.name, type: entry.type, region: entry.region };

    if (action === 'setA') {
      if (_compA && _compA.geoid === geoid) {
        _compA = null;
      } else {
        if (_compB && _compB.geoid === geoid) _compB = null;
        _compA = selection;
      }
    } else if (action === 'setB') {
      if (_compB && _compB.geoid === geoid) {
        _compB = null;
      } else {
        if (_compA && _compA.geoid === geoid) _compA = null;
        _compB = selection;
      }
    }

    _persist();
    _renderSetupBar();
    _updateRowHighlights();
    _dispatchUpdate();

    var label = action === 'setA' ? 'A' : 'B';
    var isSet = (action === 'setA' && _compA) || (action === 'setB' && _compB);
    _announce(isSet ? entry.name + ' set as ' + label + '.' : label + ' cleared.');
  }

  // ── Clear slot click handler ───────────────────────────────────────

  function _handleSlotClear(e) {
    var btn = e.target.closest('.hca-comp-slot__clear');
    if (!btn) return;
    var which = btn.dataset.clear;
    if (which === 'A') _compA = null;
    if (which === 'B') _compB = null;
    _persist();
    _renderSetupBar();
    _updateRowHighlights();
    _dispatchUpdate();
    _announce(which + ' cleared.');
  }

  // ── Side-by-side comparison panel (Phase 2) ─────────────────────────

  var COMPARISON_METRICS = [
    { id: 'overall_need_score', label: 'Overall Need Score',     unit: 'score',   lowerBetter: true  },
    { id: 'housing_gap_units',  label: 'Units Needed (30% AMI)', unit: 'integer',  lowerBetter: true  },
    { id: 'pct_cost_burdened',  label: '% Rent Burdened',        unit: 'percent',  lowerBetter: true  },
    { id: 'in_commuters',       label: 'In-Commuters',           unit: 'integer',  lowerBetter: false },
    { id: 'population',         label: 'Population',             unit: 'integer',  lowerBetter: false },
    { id: 'median_hh_income',   label: 'Median HH Income',       unit: 'dollars',  lowerBetter: false },
    { id: 'pct_renters',        label: '% Renters',              unit: 'percent',  lowerBetter: false },
    { id: 'vacancy_rate',       label: 'Vacancy Rate',           unit: 'percent',  lowerBetter: false },
    { id: 'gross_rent_median',  label: 'Median Gross Rent',      unit: 'dollars',  lowerBetter: true  },
    { id: 'population_projection_20yr', label: 'Pop. Projection (20yr)', unit: 'integer', lowerBetter: false },
  ];

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

  function _buildAmiMixSection(entryA, entryB) {
    var mixA = _deriveAmiMix(entryA);
    var mixB = _deriveAmiMix(entryB);
    if (!mixA && !mixB) return '';

    var html = '<div class="hca-cp-ami">';
    html += '<h4 class="hca-cp-ami__title">Recommended AMI Unit Mix</h4>';

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

    var total = state.allEntries.length;
    var scorecardData = HNARanking.getScorecardData ? HNARanking.getScorecardData() : {};
    var scA = scorecardData[entryA.geoid];
    var scB = scorecardData[entryB.geoid];

    // Build header
    var html = '<div class="hca-cp-header">' +
      '<h3 class="hca-cp-title">Side-by-Side Comparison</h3>' +
      '<button type="button" class="hca-cp-close" id="hcaCpClose" title="Close comparison panel" aria-label="Close comparison panel">✕</button>' +
    '</div>';

    // Names row
    html += '<div class="hca-cp-names">' +
      '<div class="hca-cp-names__label"></div>' +
      '<div class="hca-cp-names__a">' + entryA.name +
        '<div class="hca-cp-rank">#' + entryA.rank + ' of ' + total + ' · ' + entryA.percentileRank + 'th pctile</div>' +
      '</div>' +
      '<div class="hca-cp-names__vs">vs</div>' +
      '<div class="hca-cp-names__b">' + entryB.name +
        '<div class="hca-cp-rank">#' + entryB.rank + ' of ' + total + ' · ' + entryB.percentileRank + 'th pctile</div>' +
      '</div>' +
    '</div>';

    // Metric rows
    html += '<div class="hca-cp-metrics">';
    COMPARISON_METRICS.forEach(function (m) {
      var valA = entryA.metrics[m.id];
      var valB = entryB.metrics[m.id];
      var numA = (valA !== null && valA !== undefined) ? +valA : null;
      var numB = (valB !== null && valB !== undefined) ? +valB : null;

      // Bar widths: scale to max of the two
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

    // Scorecard comparison
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
        // Re-inject the Compare header
        var headerRow = thead.querySelector('tr');
        if (headerRow) {
          var existingTh = headerRow.querySelector('.hca-th-compare');
          if (!existingTh) {
            var ths = headerRow.querySelectorAll('th');
            var lastTh = ths[ths.length - 1];
            if (lastTh && !lastTh.textContent.trim()) {
              lastTh.textContent = 'Compare';
              lastTh.classList.add('hca-th-compare');
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

    // Delegated click handler for A/B buttons and slot clear
    document.addEventListener('click', function (e) {
      _handleABClick(e);
      _handleSlotClear(e);
    });
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
  };

  // Auto-init after DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(init, 100); });
  } else {
    setTimeout(init, 100);
  }

})();
