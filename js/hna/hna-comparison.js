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

  // ── Events ─────────────────────────────────────────────────────────

  function _dispatchUpdate() {
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
