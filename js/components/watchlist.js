/*!
 * js/components/watchlist.js — F219
 *
 * Save jurisdictions for later. A LIHTC developer typically tracks 5-15
 * places of interest; today they bookmark or maintain a spreadsheet. This
 * module gives every page a single-line way to ★ a jurisdiction and shows
 * the saved list in a corner panel + on the landing page.
 *
 * Storage: localStorage, no auth, single device. Schema:
 *   localStorage['__cohoWatchlist'] = JSON.stringify([
 *     { geoid: '0870195', name: 'Silt', type: 'place',  fips: '08045', addedAt: '2026-06-04T...' },
 *     { geoid: '08045',   name: 'Garfield County', type: 'county',     addedAt: '...' },
 *     ...
 *   ])
 *
 * Public API (window.Watchlist):
 *   .add(item)         add an entry; no-op if geoid already present
 *   .remove(geoid)     remove by geoid
 *   .toggle(item)      add if absent, remove if present; returns new state (bool)
 *   .contains(geoid)   true/false
 *   .list()            returns the saved array (sorted newest-first)
 *   .clear()           wipe everything
 *   .renderToggle(opts)  build a star button → returns HTMLElement
 *   .renderPanel(opts)   build the floating viewer → mounts into document.body
 *   .onChange(cb)      subscribe; cb(list) fires on every mutation
 *
 * Star button pattern (any page can use):
 *   document.body.appendChild(Watchlist.renderToggle({
 *     geoid: '0870195', name: 'Silt', type: 'place', fips: '08045'
 *   }));
 *
 * Auto-injected pages declare a marker:
 *   <span data-watchlist-toggle data-geoid="0870195" data-name="Silt" data-type="place"></span>
 * and the module replaces the marker with a fully-wired star button on
 * DOMContentLoaded.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = '__cohoWatchlist';
  var _subs = [];

  function _read() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }
  function _write(arr) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch (e) {
      console.warn('[Watchlist] write failed', e);
    }
    _notify(arr);
  }
  function _notify(arr) {
    _subs.forEach(function (cb) {
      try { cb(arr); } catch (_) {}
    });
    // Cross-tab broadcast — other open tabs update their UIs.
    try {
      document.dispatchEvent(new CustomEvent('watchlist:changed', { detail: { list: arr } }));
    } catch (_) {}
  }

  function add(item) {
    if (!item || !item.geoid) return false;
    var arr = _read();
    if (arr.some(function (x) { return x.geoid === item.geoid; })) return false;
    arr.unshift({
      geoid: String(item.geoid),
      name:  item.name || 'Untitled',
      type:  item.type || 'place',
      fips:  item.fips || (String(item.geoid).length === 5 ? item.geoid : null),
      addedAt: new Date().toISOString()
    });
    // Keep up to 50; trim oldest beyond that
    if (arr.length > 50) arr.length = 50;
    _write(arr);
    return true;
  }
  function remove(geoid) {
    if (!geoid) return false;
    var g = String(geoid);
    var arr = _read();
    var next = arr.filter(function (x) { return x.geoid !== g; });
    if (next.length === arr.length) return false;
    _write(next);
    return true;
  }
  function toggle(item) {
    if (!item || !item.geoid) return false;
    return contains(item.geoid) ? (remove(item.geoid), false) : (add(item), true);
  }
  function contains(geoid) {
    if (!geoid) return false;
    var g = String(geoid);
    return _read().some(function (x) { return x.geoid === g; });
  }
  function list() { return _read(); }
  function clear() { _write([]); }
  function onChange(cb) { if (typeof cb === 'function') _subs.push(cb); }

  // ── Star button (used on detail panels) ───────────────────────────────
  /**
   * Build a star toggle button for one jurisdiction. The button label/state
   * stays in sync with localStorage — click → toggles → updates label.
   * @param {Object} opts {geoid, name, type, fips}
   * @returns {HTMLButtonElement}
   */
  function renderToggle(opts) {
    opts = opts || {};
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'coho-watchlist-toggle';
    function _refresh() {
      var on = contains(opts.geoid);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.title = on ? 'Remove from watchlist' : 'Save to watchlist';
      btn.innerHTML = (on ? '★ Saved' : '☆ Save to watchlist');
      btn.style.cssText = 'padding:6px 12px;border-radius:6px;font-weight:600;font-size:.84rem;cursor:pointer;' +
        'border:1px solid ' + (on ? 'var(--accent)' : 'var(--border)') + ';' +
        'background:' + (on ? 'var(--accent-dim)' : 'var(--card)') + ';' +
        'color:' + (on ? 'var(--accent)' : 'var(--text)') + ';' +
        'transition:background .15s, color .15s;';
    }
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      toggle({ geoid: opts.geoid, name: opts.name, type: opts.type, fips: opts.fips });
      _refresh();
    });
    // Cross-tab sync: re-render when another tab modifies the watchlist
    document.addEventListener('watchlist:changed', _refresh);
    _refresh();
    return btn;
  }

  // ── Floating corner panel (works site-wide) ───────────────────────────
  /**
   * Mount a small fixed corner panel that shows the saved jurisdictions.
   * Idempotent — calling twice doesn't double-mount. Default position is
   * bottom-right; opts.position can override ('bottom-left' etc.).
   */
  function renderPanel(opts) {
    opts = opts || {};
    if (document.getElementById('coho-watchlist-panel')) return;
    var root = document.createElement('div');
    root.id = 'coho-watchlist-panel';
    var pos = opts.position || 'bottom-right';
    var corner = {
      'bottom-right': 'bottom:18px;right:18px;',
      'bottom-left':  'bottom:18px;left:18px;',
      'top-right':    'top:80px;right:18px;',
      'top-left':     'top:80px;left:18px;'
    }[pos] || 'bottom:18px;right:18px;';
    root.style.cssText = 'position:fixed;' + corner + 'z-index:8000;font-family:inherit;';
    // F257 — Watchlist collapsed by default is a single star+count chip
    // so it doesn't visually cover the footer on mobile. The full panel
    // expands on click. Also added mobile-specific styles (smaller chip,
    // shifted up to clear typical footer link block).
    root.innerHTML =
      '<style>' +
        '#coho-watchlist-panel > details:not([open]) > summary > .coho-wl-caret { display: none; }' +
        '#coho-watchlist-panel > details[open] > summary { padding: 8px 14px; }' +
        '#coho-watchlist-panel > details:not([open]) > summary {' +
          ' padding: 6px 10px; font-size: .78rem;' +
        '}' +
        '@media (max-width: 700px) {' +
          // Clear typical footer link cluster (~50-90px); auto-shrink the
          // collapsed chip so it doesn't visually compete with content.
          '#coho-watchlist-panel { bottom: 76px !important; right: 12px !important; }' +
          '#coho-watchlist-panel > details:not([open]) > summary {' +
            ' padding: 5px 9px; font-size: .72rem;' +
          '}' +
          '#coho-watchlist-panel > details[open] {' +
            ' min-width: 200px !important; max-width: 86vw !important;' +
          '}' +
          '#coho-watchlist-panel > details:not([open]) {' +
            ' min-width: 0 !important;' +
          '}' +
        '}' +
      '</style>' +
      '<details style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);' +
                       'box-shadow:0 4px 12px rgba(0,0,0,.12);max-width:320px;min-width:0;">' +
        '<summary style="cursor:pointer;font-weight:700;color:var(--accent);' +
                         'list-style:none;display:flex;align-items:center;justify-content:space-between;gap:.5rem;">' +
          '<span>★ Watchlist <span id="coho-watchlist-count" style="opacity:.7;font-weight:400;">(0)</span></span>' +
          '<span class="coho-wl-caret" style="opacity:.5;font-size:.78rem;">▸</span>' +
        '</summary>' +
        '<div id="coho-watchlist-body" style="padding:6px 12px 12px;max-height:60vh;overflow:auto;font-size:.85rem;min-width:240px;">' +
          '<p style="color:var(--muted);font-size:.78rem;margin:0;">No saved jurisdictions yet. Click "Save to watchlist" on any HNA/OF/PMA detail panel to add one.</p>' +
        '</div>' +
      '</details>';
    document.body.appendChild(root);
    var bodyEl = root.querySelector('#coho-watchlist-body');
    var countEl = root.querySelector('#coho-watchlist-count');
    /**
     * Resolve the current page's active jurisdiction. Tries WorkflowState
     * first; falls back to URL `?fips=` / `?geoid=` params. Returns null if
     * no jurisdiction context — caller shows the empty-add prompt.
     */
    function _currentJurisdiction() {
      // F224 — URL-first detection. Previously WorkflowState was preferred,
      // which on Compare (where state is multi-selection via ?jurisdictions=)
      // silently fell back to whatever stale jurisdiction the WorkflowState
      // held from a prior session — so "Save current" saved the wrong place.
      // Now we read URL params first (most authoritative for the page the
      // user is actually viewing) then fall back to WorkflowState.
      try {
        var params = new URLSearchParams(window.location.search);
        // Compare uses ?jurisdictions=GEOID1,GEOID2,... (plural). Take the first.
        var multi = params.get('jurisdictions');
        if (multi) {
          var firstGeoid = (multi.split(',')[0] || '').trim().replace(/\D/g, '');
          if (firstGeoid) {
            return { geoid: firstGeoid, name: 'Compare jurisdiction',
                     type: firstGeoid.length === 5 ? 'county' : 'place',
                     fips: firstGeoid.length === 5 ? firstGeoid : null };
          }
        }
        var g = (params.get('geoid') || params.get('fips') || '').replace(/\D/g, '');
        if (g) {
          return { geoid: g, name: 'Current jurisdiction',
                   type: g.length === 5 ? 'county' : 'place',
                   fips: g.length === 5 ? g : null };
        }
      } catch (_) {}
      // WorkflowState fallback
      try {
        var proj = global.WorkflowState && global.WorkflowState.getActiveProject &&
                   global.WorkflowState.getActiveProject();
        var jx = proj && (proj.jurisdiction || (proj.steps && proj.steps.jurisdiction));
        if (jx && (jx.geoid || jx.fips)) {
          return {
            geoid: jx.geoid || jx.fips,
            name:  jx.name || 'Active jurisdiction',
            type:  jx.geoType || (jx.fips && !jx.geoid ? 'county' : 'place'),
            fips:  jx.fips || null
          };
        }
      } catch (_) {}
      return null;
    }
    function _addCurrentBtn() {
      var jx = _currentJurisdiction();
      if (!jx) return '';
      var on = contains(jx.geoid);
      var label = on ? '★ ' + _esc(jx.name) + ' saved' : '☆ Save "' + _esc(jx.name) + '" to watchlist';
      return '<button type="button" id="coho-watchlist-add-current" data-geoid="' + _esc(jx.geoid) + '" ' +
                'data-name="' + _esc(jx.name) + '" data-type="' + _esc(jx.type) + '" ' +
                'data-fips="' + _esc(jx.fips || '') + '" ' +
                'style="display:block;width:100%;padding:7px 10px;margin-bottom:8px;' +
                       'background:' + (on ? 'var(--accent-dim)' : 'var(--card)') + ';' +
                       'border:1px solid ' + (on ? 'var(--accent)' : 'var(--border)') + ';' +
                       'color:' + (on ? 'var(--accent)' : 'var(--text)') + ';' +
                       'border-radius:var(--radius-sm);font-weight:600;font-size:.82rem;cursor:pointer;text-align:left;">' +
        label + '</button>';
    }
    function _refresh() {
      var arr = list();
      if (countEl) countEl.textContent = '(' + arr.length + ')';
      if (!bodyEl) return;
      var addCurrentHtml = _addCurrentBtn();
      if (!arr.length) {
        bodyEl.innerHTML = addCurrentHtml +
          '<p style="color:var(--muted);font-size:.78rem;margin:0;">No saved jurisdictions yet. ' +
          (addCurrentHtml ? 'Click above to save the current one.' : 'Open an HNA/OF/PMA page to start saving.') +
          '</p>';
        _wireAddCurrent();
        return;
      }
      // Build entries with quick re-jump links + the add-current button
      bodyEl.innerHTML = addCurrentHtml + arr.map(function (entry) {
        var hnaUrl = 'housing-needs-assessment.html?fips=' + encodeURIComponent(entry.geoid);
        var ofUrl  = 'lihtc-opportunity-finder.html';
        var pmaUrl = 'market-analysis.html?fips=' + encodeURIComponent(entry.fips || entry.geoid);
        var icUrl  = 'ic-summary.html?geoid=' + encodeURIComponent(entry.geoid);
        return '<div style="padding:6px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:.4rem;">' +
          '<div style="min-width:0;flex:1;">' +
            '<div style="font-weight:600;color:var(--text);">' + _esc(entry.name) + '</div>' +
            '<div style="display:flex;gap:.5rem;flex-wrap:wrap;font-size:.74rem;margin-top:2px;">' +
              '<a href="' + hnaUrl + '" style="color:var(--accent);text-decoration:none;">HNA</a>' +
              '<a href="' + ofUrl  + '" style="color:var(--accent);text-decoration:none;">OF</a>' +
              '<a href="' + pmaUrl + '" style="color:var(--accent);text-decoration:none;">PMA</a>' +
              '<a href="' + icUrl  + '" style="color:var(--accent);text-decoration:none;">IC</a>' +
            '</div>' +
          '</div>' +
          '<button type="button" aria-label="Remove ' + _esc(entry.name) + ' from watchlist" ' +
                  'data-geoid="' + _esc(entry.geoid) + '" ' +
                  'style="background:none;border:none;color:var(--faint);font-size:1rem;cursor:pointer;padding:2px 6px;">✕</button>' +
        '</div>';
      }).join('');
      // Wire the X buttons (skip the add-current button which has its own handler)
      bodyEl.querySelectorAll('button[data-geoid]').forEach(function (b) {
        if (b.id === 'coho-watchlist-add-current') return;
        b.addEventListener('click', function () { remove(b.getAttribute('data-geoid')); });
      });
      _wireAddCurrent();
    }
    function _wireAddCurrent() {
      var addBtn = document.getElementById('coho-watchlist-add-current');
      if (!addBtn) return;
      addBtn.addEventListener('click', function () {
        toggle({
          geoid: addBtn.getAttribute('data-geoid'),
          name:  addBtn.getAttribute('data-name'),
          type:  addBtn.getAttribute('data-type'),
          fips:  addBtn.getAttribute('data-fips')
        });
      });
    }
    _refresh();
    onChange(_refresh);
    document.addEventListener('watchlist:changed', _refresh);
  }

  // ── DOM marker auto-wire ──────────────────────────────────────────────
  /**
   * Auto-replace <span data-watchlist-toggle data-geoid="..." data-name="..."
   * data-type="..." data-fips="..."></span> markers with star buttons.
   * Run once on DOMContentLoaded; also exposed for late-render pages.
   */
  function autoWireMarkers(root) {
    (root || document).querySelectorAll('[data-watchlist-toggle]').forEach(function (marker) {
      if (marker._cohoWired) return;
      var btn = renderToggle({
        geoid: marker.getAttribute('data-geoid'),
        name:  marker.getAttribute('data-name'),
        type:  marker.getAttribute('data-type'),
        fips:  marker.getAttribute('data-fips')
      });
      marker.parentNode.insertBefore(btn, marker);
      marker.remove();
      btn._cohoWired = true;
    });
  }

  function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function _init() {
    autoWireMarkers();
    // F219 — auto-mount the panel site-wide so every page picks up the
    // watchlist UI without per-page boilerplate. Pages that need a
    // different position can call renderPanel({position: '...'}) again
    // before this runs.
    renderPanel({ position: 'bottom-right' });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  // Public API
  global.Watchlist = {
    add: add,
    remove: remove,
    toggle: toggle,
    contains: contains,
    list: list,
    clear: clear,
    renderToggle: renderToggle,
    renderPanel: renderPanel,
    autoWireMarkers: autoWireMarkers,
    onChange: onChange
  };
}(typeof window !== 'undefined' ? window : this));
