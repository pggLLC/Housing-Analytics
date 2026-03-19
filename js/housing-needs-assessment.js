/**
 * js/housing-needs-assessment.js — COMPATIBILITY STUB
 *
 * This file has been split into focused browser-script modules under js/hna/:
 *   js/hna/hna-utils.js        — constants, pure helpers, calculations
 *   js/hna/hna-narratives.js   — text/copy generators
 *   js/hna/hna-renderers.js    — DOM render functions
 *   js/hna/hna-export.js       — export logic bridge
 *   js/hna/hna-controller.js   — init, state, events, orchestration
 *
 * housing-needs-assessment.html now loads those modules instead of this file.
 * This stub remains for any legacy references and fails gracefully.
 *
 * Expected load order:
 *   1. js/hna/hna-utils.js
 *   2. js/hna/hna-narratives.js
 *   3. js/hna/hna-renderers.js
 *   4. js/hna/hna-export.js
 *   5. js/hna/hna-controller.js
 */
(function () {
  'use strict';
  window.__HNA_STUB_LOADED = true;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _checkModules);
  } else {
    _checkModules();
  }
  function _checkModules() {
    if (typeof window.HNAController === 'undefined') {
      console.warn(
        '[HNA] housing-needs-assessment.js is now a stub. ' +
        'Load js/hna/hna-controller.js (and its dependencies) instead. ' +
        'Expected load order: hna-utils.js → hna-narratives.js → hna-renderers.js → hna-export.js → hna-controller.js'
      );
    }
  }
})();
