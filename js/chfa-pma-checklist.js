/*
  chfa-pma-checklist.js
  CHFA PMA Checklist State Manager

  Provides jurisdiction-scoped localStorage persistence for the eight-item
  CHFA PMA checklist on housing-needs-assessment.html.

  Public API (all available on window.ChfaPmaChecklist):
    initChfaChecklist(geoType, geoid)  — Load saved state and sync DOM
    saveState(geoType, geoid)          — Persist current checkbox states
    getState(geoType, geoid)           — Retrieve full saved state
    updateItem(itemId, checked)        — Update a single item and persist
    isComplete(geoType, geoid)         — All items checked?
    getChecklistItems()                — Return list of all item IDs

  Usage:
    ChfaPmaChecklist.initChfaChecklist('county', '08031');
    ChfaPmaChecklist.updateItem('analyst', true);
*/

(function (root) {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────

  /** LocalStorage namespace prefix — avoids collisions with other tools. */
  var STORAGE_PREFIX = 'hna_chfa_';

  /** Ordered list of all checklist item IDs (matches HTML). */
  var ITEM_IDS = [
    'tracts',
    'analyst',
    'approval',
    'demand',
    'capture',
    'competitive',
    'rents',
    'absorption',
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

  /**
   * Map item IDs to their containing <li> element IDs (HTML).
   */
  var ITEM_LI_MAP = {
    tracts:      'chfaChkTracts',
    analyst:     'chfaChkAnalyst',
    approval:    'chfaChkApproval',
    demand:      'chfaChkDemand',
    capture:     'chfaChkCapture',
    competitive: 'chfaChkCompetitive',
    rents:       'chfaChkRents',
    absorption:  'chfaChkAbsorption',
  };

  /**
   * Map item IDs to their checkbox <input> element IDs (HTML).
   */
  var ITEM_INPUT_MAP = {
    tracts:      'chfaChkTractsInput',
    analyst:     'chfaChkAnalystInput',
    approval:    'chfaChkApprovalInput',
    demand:      'chfaChkDemandInput',
    capture:     'chfaChkCaptureInput',
    competitive: 'chfaChkCompetitiveInput',
    rents:       'chfaChkRentsInput',
    absorption:  'chfaChkAbsorptionInput',
  };

  // ── Active geography cache ─────────────────────────────────────────────────

  var _activeGeoType = 'county';
  var _activeGeoid   = '';

  // ── Storage helpers ────────────────────────────────────────────────────────

  /**
   * Build the localStorage key for a given geography.
   * @param {string} geoType
   * @param {string} geoid
   * @returns {string}
   */
  function storageKey(geoType, geoid) {
    return STORAGE_PREFIX + (geoType || 'county') + '_' + (geoid || '');
  }

  /**
   * Read a JSON value from localStorage; returns null on any error.
   * Handles corrupted JSON, private-browsing, and disabled storage gracefully.
   * @param {string} key
   * @returns {object|null}
   */
  function lsRead(key) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      // Validate that parsed value is a plain object (not array) with an items object
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
          typeof parsed.items !== 'object' || parsed.items === null || Array.isArray(parsed.items)) {
        console.warn('[ChfaPmaChecklist] Unexpected state shape at key "' + key + '"; ignoring.');
        return null;
      }
      return parsed;
    } catch (err) {
      console.warn('[ChfaPmaChecklist] Failed to read from localStorage:', err);
      return null;
    }
  }

  /**
   * Write a JSON value to localStorage; silently swallows quota/access errors.
   * @param {string} key
   * @param {object} value
   */
  function lsWrite(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      console.warn('[ChfaPmaChecklist] Failed to write to localStorage:', err);
      /* graceful degradation — page still works without persistence */
    }
  }

  // ── Default state factory ──────────────────────────────────────────────────

  /**
   * Create a fresh (all-unchecked) checklist state record.
   * @param {string} geoType
   * @param {string} geoid
   * @returns {object}
   */
  function createDefaultState(geoType, geoid) {
    var items = {};
    ITEM_IDS.forEach(function (id) {
      items[id] = { checked: false, date: null };
    });
    return {
      geoType:   geoType  || 'county',
      geoid:     geoid    || '',
      items:     items,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // ── DOM sync helpers ───────────────────────────────────────────────────────

  /**
   * Sync all checklist items in the DOM to the given state, then update the
   * progress bar and completion message.
   * @param {object} state
   */
  function _syncDom(state) {
    if (!state || !state.items) return;
    ITEM_IDS.forEach(function (id) {
      _syncDomItem(id, state.items[id]);
    });
    _syncProgressBar();
  }

  /**
   * Update a single DOM checklist item to reflect its saved state.
   * @param {string} itemId
   * @param {object} itemState - { checked, date }
   */
  function _syncDomItem(itemId, itemState) {
    var liEl    = typeof document !== 'undefined' ? document.getElementById(ITEM_LI_MAP[itemId])    : null;
    var inputEl = typeof document !== 'undefined' ? document.getElementById(ITEM_INPUT_MAP[itemId]) : null;
    if (!inputEl) return;

    var checked = !!(itemState && itemState.checked);
    inputEl.checked = checked;
    inputEl.setAttribute('aria-checked', String(checked));

    if (liEl) {
      liEl.classList.toggle('chfa-checklist-item--done', checked);
    }
  }

  /**
   * Recalculate checked count from DOM and update the progress bar and
   * completion message elements.
   */
  function _syncProgressBar() {
    if (typeof document === 'undefined') return;
    var done  = 0;
    var total = ITEM_IDS.length;

    ITEM_IDS.forEach(function (id) {
      var el = document.getElementById(ITEM_INPUT_MAP[id]);
      if (el && el.checked) done++;
    });

    var pct      = Math.round((done / total) * 100);
    var fillEl   = document.getElementById('chfaProgressFill');
    var labelEl  = document.getElementById('chfaProgressLabel');
    var statusEl = document.getElementById('chfaChecklistCompletionStatus');

    if (fillEl) {
      fillEl.style.width = pct + '%';
      fillEl.setAttribute('aria-valuenow', String(pct));
    }
    if (labelEl) {
      labelEl.textContent = done + ' of ' + total + ' complete';
    }
    if (statusEl) {
      var allDone = done === total;
      statusEl.textContent  = allDone ? 'All items complete! ✅' : '';
      statusEl.style.display = allDone ? '' : 'none';
    }
  }

  /**
   * Read the current checked states from the DOM and return them as an items
   * map suitable for storing in localStorage.
   * @returns {object}  Map of itemId → { checked, date }
   */
  function _readDomState() {
    var items = {};
    ITEM_IDS.forEach(function (id) {
      var el = typeof document !== 'undefined' ? document.getElementById(ITEM_INPUT_MAP[id]) : null;
      items[id] = {
        checked: !!(el && el.checked),
        date:    (el && el.checked) ? new Date().toISOString() : null,
      };
    });
    return items;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Initialize the checklist for a specific geography.
   * Loads any existing persisted state; falls back to defaults if none found.
   * Syncs DOM checkboxes and progress bar.
   *
   * @param {string} geoType - 'state' | 'county' | 'place' | 'cdp' | 'municipality'
   * @param {string} geoid   - 5-digit FIPS (county/state) or 7-digit place FIPS
   * @returns {object} The current checklist state
   */
  function initChfaChecklist(geoType, geoid) {
    var key   = storageKey(geoType, geoid);
    var state = lsRead(key) || createDefaultState(geoType, geoid);

    // Ensure all current item IDs are present (forward-compatibility)
    ITEM_IDS.forEach(function (id) {
      if (!state.items[id]) {
        state.items[id] = { checked: false, date: null };
      }
    });

    // Cache active geography so updateItem() can resolve the key
    _activeGeoType = geoType || 'county';
    _activeGeoid   = geoid   || '';

    // Sync DOM to loaded state
    _syncDom(state);

    return state;
  }

  /**
   * Persist the current DOM checkbox states for a geography.
   * Call this before switching to a new geography so progress is not lost.
   *
   * @param {string} geoType
   * @param {string} geoid
   * @returns {{ success: boolean }}
   */
  function saveState(geoType, geoid) {
    var key   = storageKey(geoType, geoid);
    var items = _readDomState();

    // Merge with any existing saved state to preserve dates
    var existing = lsRead(key);
    if (existing && existing.items) {
      ITEM_IDS.forEach(function (id) {
        var existingItem = existing.items[id];
        if (existingItem && existingItem.checked && !items[id].checked) {
          // Item was unchecked in DOM — clear the date
          items[id].date = null;
        } else if (existingItem && existingItem.date && items[id].checked) {
          // Preserve the original completion date
          items[id].date = existingItem.date;
        }
      });
    }

    var state = {
      geoType:   geoType  || _activeGeoType,
      geoid:     geoid    || _activeGeoid,
      items:     items,
      createdAt: (existing && existing.createdAt) || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    lsWrite(key, state);
    return { success: true };
  }

  /**
   * Retrieve the full saved checklist state for a geography.
   *
   * @param {string} geoType
   * @param {string} geoid
   * @returns {object|null} State object or null if not yet saved
   */
  function getState(geoType, geoid) {
    return lsRead(storageKey(geoType, geoid));
  }

  /**
   * Update a single checklist item's checked state and persist all states.
   * Uses the most recently initialized geography if geoType/geoid are not
   * provided.
   *
   * @param {string}  itemId  - One of ITEM_IDS
   * @param {boolean} checked - New checked state
   * @returns {{ success: boolean, error: string|null }}
   */
  function updateItem(itemId, checked) {
    if (ITEM_IDS.indexOf(itemId) === -1) {
      return { success: false, error: 'Unknown item ID: ' + itemId };
    }
    if (typeof checked !== 'boolean') {
      return { success: false, error: 'checked must be a boolean' };
    }

    // Sync the DOM element first
    _syncDomItem(itemId, { checked: checked, date: checked ? new Date().toISOString() : null });
    _syncProgressBar();

    // Persist all states for the active geography
    var result = saveState(_activeGeoType, _activeGeoid);
    return { success: result.success, error: null };
  }

  /**
   * Returns true if all items in the checklist are checked for the given geography.
   *
   * @param {string} geoType
   * @param {string} geoid
   * @returns {boolean}
   */
  function isComplete(geoType, geoid) {
    var state = getState(geoType, geoid);
    if (!state || !state.items) return false;
    return ITEM_IDS.every(function (id) {
      return state.items[id] && state.items[id].checked === true;
    });
  }

  /**
   * Return the list of all CHFA PMA checklist item IDs.
   * @returns {string[]}
   */
  function getChecklistItems() {
    return ITEM_IDS.slice();
  }

  // ── Public namespace ───────────────────────────────────────────────────────

  var ChfaPmaChecklist = {
    initChfaChecklist: initChfaChecklist,
    saveState:         saveState,
    getState:          getState,
    updateItem:        updateItem,
    isComplete:        isComplete,
    getChecklistItems: getChecklistItems,

    // Expose internals for testing
    _storageKey:    storageKey,
    _ITEM_IDS:      ITEM_IDS,
    _ITEM_LABELS:   ITEM_LABELS,
    _ITEM_LI_MAP:   ITEM_LI_MAP,
    _ITEM_INPUT_MAP: ITEM_INPUT_MAP,
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
