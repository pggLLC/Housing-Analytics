/**
 * js/home-jurisdiction-search.js — B-06 / #1097
 *
 * Inline jurisdiction/place autocomplete for the homepage hero. Lets a
 * visitor search all ~577 registry geographies (64 counties, 303 places,
 * 210 CDPs) from the first screen and jump straight to the matched
 * profile, instead of navigating to select-jurisdiction.html first.
 *
 * Routing: every match goes to the interactive profile
 * (housing-needs-assessment.html?geoid=…&geoType=…&auto=1 — the same
 * destination the select-jurisdiction flow ends at, and the ic-summary
 * deep-link convention). Static places/<geoid>.html pages exist for only
 * 482 of the 513 place/CDP entries with no registry field predicting
 * which, so uniform HNA routing avoids client-side 404 guessing; the
 * "Browse local housing profiles" link remains the entry to the static
 * pages.
 *
 * The registry (~130 KB) is fetched lazily on first focus so the
 * homepage's initial load is unaffected.
 *
 * Matching + routing are pure functions with a dual-context export so
 * test/home-jurisdiction-search.test.js exercises the real code in Node
 * (no reimplemented copies — see #1152/#1120 for why that matters).
 */
(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.HomeJurisdictionSearch = api;
  }
}(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var TYPE_LABELS = { county: 'County', place: 'City/Town', cdp: 'CDP' };
  var MAX_RESULTS = 8;

  /**
   * Rank-and-filter registry entries for a query.
   * Prefix matches rank before mid-word matches; ties break by name
   * length (shorter = more exact) then alphabetically. Case-insensitive.
   *
   * @param {Array<{geoid:string,name:string,type:string}>} entries
   * @param {string} query
   * @param {number} [limit]
   * @returns {Array} matched entries, best first
   */
  function searchJurisdictions(entries, query, limit) {
    if (!Array.isArray(entries)) return [];
    var q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    var max = limit || MAX_RESULTS;

    var scored = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var name = e && e.name ? String(e.name).toLowerCase() : '';
      if (!name) continue;
      var idx = name.indexOf(q);
      if (idx === -1) continue;
      scored.push({ entry: e, prefix: idx === 0 ? 0 : 1, len: name.length });
    }
    scored.sort(function (a, b) {
      if (a.prefix !== b.prefix) return a.prefix - b.prefix;
      if (a.len !== b.len) return a.len - b.len;
      return a.entry.name < b.entry.name ? -1 : 1;
    });
    return scored.slice(0, max).map(function (s) { return s.entry; });
  }

  /**
   * Profile URL for a registry entry (relative to site root).
   * @param {{geoid:string,type:string}} entry
   * @returns {string|null}
   */
  function jurisdictionUrl(entry) {
    if (!entry || !entry.geoid || !entry.type) return null;
    return 'housing-needs-assessment.html?geoid=' + encodeURIComponent(entry.geoid) +
           '&geoType=' + encodeURIComponent(entry.type) + '&auto=1';
  }

  /* ── Browser bootstrap (combobox wiring) ─────────────────────────── */

  function initBrowser() {
    var input = document.getElementById('homeJurisdictionSearch');
    var listbox = document.getElementById('homeJurisdictionSearchResults');
    if (!input || !listbox) return;

    var entries = null;
    var loading = false;
    var results = [];
    var activeIndex = -1;

    function loadRegistry() {
      if (entries || loading) return;
      loading = true;
      fetch('data/hna/geography-registry.json')
        .then(function (r) { return r.json(); })
        .then(function (data) {
          entries = Array.isArray(data) ? data
            : (data && data.geographies) ? data.geographies : [];
          loading = false;
          if (input.value) render(input.value);
        })
        .catch(function () { loading = false; });
    }

    function close() {
      listbox.hidden = true;
      listbox.innerHTML = '';
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      results = [];
      activeIndex = -1;
    }

    function go(entry) {
      var url = jurisdictionUrl(entry);
      if (url) window.location.href = url;
    }

    function setActive(i) {
      activeIndex = i;
      var opts = listbox.querySelectorAll('[role="option"]');
      for (var k = 0; k < opts.length; k++) {
        var on = k === i;
        opts[k].setAttribute('aria-selected', on ? 'true' : 'false');
        opts[k].style.background = on ? 'var(--bg2, #eef4f3)' : 'transparent';
      }
      if (i >= 0 && opts[i]) {
        input.setAttribute('aria-activedescendant', opts[i].id);
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function render(query) {
      if (!entries) { loadRegistry(); return; }
      results = searchJurisdictions(entries, query);
      if (!results.length) { close(); return; }
      listbox.innerHTML = '';
      for (var i = 0; i < results.length; i++) {
        (function (i) {
          var e = results[i];
          var li = document.createElement('li');
          li.id = 'homeJurisdictionOpt' + i;
          li.setAttribute('role', 'option');
          li.setAttribute('aria-selected', 'false');
          li.style.cssText = 'padding:8px 12px;cursor:pointer;display:flex;justify-content:space-between;gap:8px;';
          var name = document.createElement('span');
          name.textContent = e.name;
          var type = document.createElement('span');
          type.textContent = TYPE_LABELS[e.type] || e.type;
          type.style.cssText = 'color:var(--muted,#777);font-size:.85em;white-space:nowrap;';
          li.appendChild(name);
          li.appendChild(type);
          // mousedown (not click) so it fires before the input's blur closes the list
          li.addEventListener('mousedown', function (ev) { ev.preventDefault(); go(e); });
          li.addEventListener('mousemove', function () { setActive(i); });
          listbox.appendChild(li);
        }(i));
      }
      listbox.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      setActive(-1);
    }

    input.addEventListener('focus', loadRegistry);
    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('blur', function () { setTimeout(close, 150); });
    input.addEventListener('keydown', function (ev) {
      if (listbox.hidden && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp')) {
        render(input.value);
        return;
      }
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        if (results.length) setActive((activeIndex + 1) % results.length);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (results.length) setActive((activeIndex - 1 + results.length) % results.length);
      } else if (ev.key === 'Enter') {
        if (activeIndex >= 0 && results[activeIndex]) {
          ev.preventDefault();
          go(results[activeIndex]);
        } else if (results.length === 1) {
          ev.preventDefault();
          go(results[0]);
        }
      } else if (ev.key === 'Escape') {
        close();
      }
    });
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initBrowser);
    } else {
      initBrowser();
    }
  }

  return {
    MAX_RESULTS: MAX_RESULTS,
    TYPE_LABELS: TYPE_LABELS,
    searchJurisdictions: searchJurisdictions,
    jurisdictionUrl: jurisdictionUrl
  };
}));
