/*
  chfa-pma-checklist.js
  CHFA PMA Checklist State Manager

  Provides jurisdiction-scoped state management for the eight-item CHFA PMA
  checklist with localStorage persistence.

  Public API (all available on window.ChfaPmaChecklist):
    initChfaChecklist(geoType, geoid)        — Initialize for a geography (saves old, loads new)
    saveChfaState(geoType, geoid)            — Persist current DOM state for a geography
    getChfaState(geoType, geoid)             — Retrieve full saved state
    isChfaChecklistComplete(geoType, geoid)  — All 8 items checked?
    updateProgress()                         — Refresh progress bar and completion badge

  Usage:
    ChfaPmaChecklist.initChfaChecklist('county', '08031');
*/

(function (root) {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────

  /** LocalStorage namespace prefix — avoids collisions with other tools. */
  var STORAGE_PREFIX = 'hna_chfa_';

  /** Ordered list of all checklist item IDs (matches HTML). */
  var ITEM_IDS = [
    'tracts', 'analyst', 'approval', 'demand',
    'capture', 'competitive', 'rents', 'absorption',
  ];

  /** Human-readable labels for each item. */
  var ITEM_LABELS = {
    tracts:      'Census tracts selected and justified',
    analyst:     'CHFA-approved market analyst engaged',
    approval:    'PMA boundary approved by CHFA',
    demand:      'Income-qualified demand analysis complete',
    capture:     'Capture rate calculated',
    competitive: 'Competitive property impact assessed',
    rents:       'Achievable rent analysis complete',
    absorption:  'Absorption projection documented',
  };

  /** Map item IDs → checkbox input element IDs (must match HTML). */
  var CHK_DOM_MAP = {
    tracts:      'chfaChkTractsInput',
    analyst:     'chfaChkAnalystInput',
    approval:    'chfaChkApprovalInput',
    demand:      'chfaChkDemandInput',
    capture:     'chfaChkCaptureInput',
    competitive: 'chfaChkCompetitiveInput',
    rents:       'chfaChkRentsInput',
    absorption:  'chfaChkAbsorptionInput',
  };

  /** Map item IDs → list item element IDs (must match HTML). */
  var ITEM_DOM_MAP = {
    tracts:      'chfaChkTracts',
    analyst:     'chfaChkAnalyst',
    approval:    'chfaChkApproval',
    demand:      'chfaChkDemand',
    capture:     'chfaChkCapture',
    competitive: 'chfaChkCompetitive',
    rents:       'chfaChkRents',
    absorption:  'chfaChkAbsorption',
  };

  // ── Active geography state ─────────────────────────────────────────────────

  /** Tracks the most recently initialized geography. */
  var _activeGeoType = '';
  var _activeGeoid   = '';

  // ── Storage helpers ────────────────────────────────────────────────────────

  /**
   * Build the localStorage key for a given geography.
   * Always includes both geoType and geoid for consistency.
   * @param {string} geoType
   * @param {string} geoid
   * @returns {string}
   */
  function storageKey(geoType, geoid) {
    return STORAGE_PREFIX + (geoType || 'county') + '_' + (geoid || '');
  }

  /**
   * Read a JSON value from localStorage; returns null on any error
   * (invalid JSON, private browsing, storage disabled).
   * @param {string} key
   * @returns {object|null}
   */
  function lsRead(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  /**
   * Write a JSON value to localStorage; silently swallows errors
   * (e.g. private-browsing mode, storage quota exceeded).
   * @param {string} key
   * @param {object} value
   */
  function lsWrite(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {
      /* graceful degradation — page still works without persistence */
    }
  }

  // ── DOM helpers ────────────────────────────────────────────────────────────

  /**
   * Read the current checked state of all CHFA checkboxes from the DOM.
   * @returns {object} Map of itemId → boolean
   */
  function _readDomState() {
    var state = {};
    ITEM_IDS.forEach(function (id) {
      var el = document.getElementById(CHK_DOM_MAP[id]);
      state[id] = el ? el.checked : false;
    });
    return state;
  }

  /**
   * Apply a saved items map to the DOM checkboxes and update CSS classes.
   * @param {object} items - Map of itemId → boolean (or falsy for default)
   */
  function _applyDomState(items) {
    ITEM_IDS.forEach(function (id) {
      var checked = !!(items && items[id]);

      // Checkbox
      var chkEl = document.getElementById(CHK_DOM_MAP[id]);
      if (chkEl) chkEl.checked = checked;

      // Parent list item done-class
      var liEl = document.getElementById(ITEM_DOM_MAP[id]);
      if (liEl) {
        liEl.classList.toggle('chfa-checklist-item--done', checked);
      }
    });

    _updateProgress();
  }

  // ── Progress bar & completion badge ───────────────────────────────────────

  /**
   * Refresh the progress bar fill, label, and completion status badge
   * based on the current DOM checkbox states.
   */
  function _updateProgress() {
    var list = document.getElementById('chfaChecklist');
    if (!list) return;

    var checkboxes = list.querySelectorAll('input[type="checkbox"]');
    var total = checkboxes.length;
    var done  = 0;
    checkboxes.forEach(function (cb) { if (cb.checked) done++; });

    var pct   = total > 0 ? Math.round((done / total) * 100) : 0;
    var fill  = document.getElementById('chfaProgressFill');
    var label = document.getElementById('chfaProgressLabel');

    if (fill) {
      fill.style.width = pct + '%';
      fill.setAttribute('aria-valuenow', String(pct));
    }
    if (label) {
      label.textContent = done + ' of ' + total + ' complete';
    }

    var completionEl = document.getElementById('chfaChecklistCompletionStatus');
    if (completionEl) {
      var allDone = total > 0 && done === total;
      completionEl.textContent = allDone ? 'All items complete! ✅' : '';
      completionEl.style.display = allDone ? '' : 'none';
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Initialize the CHFA checklist for a specific geography.
   *
   * If called after a previous geography was active, first saves the current
   * DOM state for the old geography, then loads and restores the saved state
   * for the new geography (or defaults to all-unchecked if no state exists).
   *
   * @param {string} geoType - 'state' | 'county' | 'place' | 'cdp' | 'municipality'
   * @param {string} geoid   - FIPS or place code
   * @returns {object} The loaded state: { geoType, geoid, items }
   */
  function initChfaChecklist(geoType, geoid) {
    var newGeoType = geoType || 'county';
    var newGeoid   = geoid   || '';

    // Save state for old geography before switching (skip on very first call)
    if (_activeGeoType || _activeGeoid) {
      saveChfaState(_activeGeoType, _activeGeoid);
    }

    // Update active geography
    _activeGeoType = newGeoType;
    _activeGeoid   = newGeoid;

    // Load saved state for the new geography
    var key   = storageKey(newGeoType, newGeoid);
    var saved = lsRead(key);

    var items = {};
    if (saved && saved.items && typeof saved.items === 'object') {
      // Validate and back-fill — handles state from older versions with fewer items
      ITEM_IDS.forEach(function (id) {
        items[id] = !!(saved.items[id]);
      });
    } else {
      // First visit: default to all unchecked
      ITEM_IDS.forEach(function (id) { items[id] = false; });
    }

    _applyDomState(items);

    return { geoType: newGeoType, geoid: newGeoid, items: items };
  }

  /**
   * Persist the current DOM checkbox states to localStorage for a geography.
   *
   * @param {string} geoType
   * @param {string} geoid
   */
  function saveChfaState(geoType, geoid) {
    if (!geoType && !geoid) return;
    var key = storageKey(geoType, geoid);
    lsWrite(key, {
      geoType: geoType || 'county',
      geoid:   geoid   || '',
      items:   _readDomState(),
    });
  }

  /**
   * Retrieve the full saved checklist state for a geography.
   *
   * @param {string} geoType
   * @param {string} geoid
   * @returns {object|null} State object or null if not yet saved
   */
  function getChfaState(geoType, geoid) {
    return lsRead(storageKey(geoType, geoid));
  }

  /**
   * Returns true if all 8 items in the checklist are checked.
   *
   * @param {string} geoType
   * @param {string} geoid
   * @returns {boolean}
   */
  function isChfaChecklistComplete(geoType, geoid) {
    var state = getChfaState(geoType, geoid);
    if (!state || !state.items) return false;
    return ITEM_IDS.every(function (id) {
      return !!(state.items[id]);
    });
  }

  // ── Checkbox event wiring ──────────────────────────────────────────────────

  /**
   * Wire change listeners to all CHFA checklist checkboxes.
   * Called automatically on DOMContentLoaded.
   * Safe to call multiple times (idempotent via _wiringDone guard).
   */
  var _wiringDone = false;
  function _wireCheckboxes() {
    if (_wiringDone) return;
    var list = document.getElementById('chfaChecklist');
    if (!list) return;
    _wiringDone = true;

    var announcer = document.getElementById('chfaChecklistAnnouncer');

    list.querySelectorAll('input[type="checkbox"]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        // Update CSS class on parent list item
        var li = cb.closest('.chfa-checklist-item');
        if (li) li.classList.toggle('chfa-checklist-item--done', cb.checked);

        // Announce change to screen readers
        if (announcer) {
          var content = cb.closest('.chfa-checklist-content');
          var labelEl = content && content.querySelector('label');
          var labelText = '';
          if (labelEl) {
            var firstNode = labelEl.firstChild;
            labelText = (firstNode && firstNode.nodeType === 3)
              ? firstNode.textContent.trim()
              : labelEl.textContent.trim().split('\n')[0].trim();
          }
          announcer.textContent = labelText + (cb.checked ? ' — checked' : ' — unchecked');
        }

        // Persist state for the currently active geography
        saveChfaState(_activeGeoType, _activeGeoid);

        // Refresh progress bar
        _updateProgress();
      });
    });
  }

  // Auto-wire checkboxes when DOM is ready
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _wireCheckboxes);
    } else {
      _wireCheckboxes();
    }
  }

  // ── Public namespace ───────────────────────────────────────────────────────

  var ChfaPmaChecklist = {
    initChfaChecklist:       initChfaChecklist,
    saveChfaState:           saveChfaState,
    getChfaState:            getChfaState,
    isChfaChecklistComplete: isChfaChecklistComplete,
    updateProgress:          _updateProgress,

    // Expose internals for testing
    _storageKey:       storageKey,
    _ITEM_IDS:         ITEM_IDS,
    _ITEM_LABELS:      ITEM_LABELS,
    _getActiveGeoType: function () { return _activeGeoType; },
    _getActiveGeoid:   function () { return _activeGeoid;   },
  };

  // CommonJS (Node.js test environment)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ChfaPmaChecklist;
  }

  // Browser global
  root.ChfaPmaChecklist = ChfaPmaChecklist;

}(typeof window !== 'undefined' ? window : this));
