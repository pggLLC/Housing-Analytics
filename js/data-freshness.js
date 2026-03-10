/**
 * js/data-freshness.js
 *
 * Loads data/manifest.json and stamps every .data-timestamp element on the
 * current page with "Data last updated: <date>" sourced from the manifest
 * `generated` field.
 *
 * Also exposes window.__dataFreshness so other scripts can read the manifest
 * timestamp (e.g. to override a specific element after their own data load).
 *
 * Depends on: js/fetch-helper.js (safeFetchJSON, resolveAssetUrl)
 */
(function () {
  'use strict';

  var MANIFEST_PATH = 'data/manifest.json';

  /**
   * Format an ISO-8601 UTC string into a human-friendly local date string.
   * Falls back gracefully if the string is missing or unparseable.
   * @param {string} isoString
   * @returns {string}
   */
  function formatDate(isoString) {
    if (!isoString) return '—';
    try {
      var d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      return d.toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
      });
    } catch (_) {
      return isoString;
    }
  }

  /**
   * Stamp all .data-timestamp elements that are still empty with the
   * manifest-derived label.  Elements that already have content are left
   * untouched so page-specific scripts retain control.
   * @param {string} label  e.g. "Data last updated: Mar 10, 2026"
   */
  function stampElements(label) {
    var els = document.querySelectorAll('.data-timestamp');
    for (var i = 0; i < els.length; i++) {
      if (!els[i].textContent.trim()) {
        els[i].textContent = label;
      }
    }
  }

  /**
   * Load the manifest and update all empty .data-timestamp elements.
   * Stores the resolved manifest on window.__dataFreshness for other scripts.
   */
  function init() {
    var fetch = (typeof window.safeFetchJSON === 'function')
      ? window.safeFetchJSON
      : null;

    if (!fetch) {
      // safeFetchJSON not loaded yet — wait one tick.
      setTimeout(init, 50);
      return;
    }

    fetch(MANIFEST_PATH, { cache: 'no-store' })
      .then(function (manifest) {
        if (!manifest || !manifest.generated) return;

        var generated = manifest.generated;
        window.__dataFreshness = { generated: generated, manifest: manifest };

        var label = 'Data last updated: ' + formatDate(generated);
        stampElements(label);
      })
      .catch(function (err) {
        console.warn('[data-freshness] Could not load manifest:', err);
      });
  }

  // Run after DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose helpers for use by page-specific scripts.
  window.__dataFreshness = window.__dataFreshness || null;
  window.__formatFreshnessDate = formatDate;

})();
