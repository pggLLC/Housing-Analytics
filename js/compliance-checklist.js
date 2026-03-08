/*
  compliance-checklist.js
  Prop 123 / HB 22-1093 Compliance Checklist Manager

  Provides pure-function state management for the five-item compliance checklist
  with localStorage persistence, deadline detection, and cross-tab sync.

  Public API (all available on window.ComplianceChecklist):
    initComplianceChecklist(geoType, geoid)        — Initialize for a geography
    updateChecklistItem(itemId, checked, metadata) — Persist checkbox state
    getChecklistState(geoType, geoid)              — Retrieve full saved state
    isChecklistComplete(geoType, geoid)            — All 5 items checked?
    getNextAction(geoType, geoid)                  — Returns the next required action
    broadcastChecklistChange(event)                — Emit change event for sync
    validateChecklistItem(itemId, value)           — Validate item data before save

  Usage:
    ComplianceChecklist.initComplianceChecklist('county', '08031');
    ComplianceChecklist.updateChecklistItem('baseline', true, { value: 1500, date: '2025-03-08' });
*/

(function (root) {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────

  /** LocalStorage namespace prefix — avoids collisions with other tools. */
  var STORAGE_PREFIX = 'hna_compliance_';

  /** DOLA annual filing deadline (month is 0-indexed: 0 = January). */
  var DOLA_DEADLINE_MONTH = 0;   // January
  var DOLA_DEADLINE_DAY   = 31;

  /** Days before DOLA deadline to show warning badge. */
  var DEADLINE_WARN_DAYS = 30;

  /** Ordered list of all checklist item IDs (matches HTML). */
  var ITEM_IDS = ['baseline', 'growth', 'fasttrack', 'dola', 'report'];

  /** Human-readable labels for each item. */
  var ITEM_LABELS = {
    baseline:  'Establish baseline (60% AMI rentals documented)',
    growth:    'Adopt 3% annual growth target',
    fasttrack: 'Document fast-track approval process',
    dola:      'File notice with DOLA (annual deadline: January 31)',
    report:    'Annual reporting filed with DOLA',
  };

  // ── Storage helpers ────────────────────────────────────────────────────────

  /**
   * Build the localStorage key for a given geography.
   * @param {string} geoType - 'state' | 'county' | 'municipality'
   * @param {string} geoid   - FIPS or place code
   * @returns {string}
   */
  function storageKey(geoType, geoid) {
    return STORAGE_PREFIX + (geoType || 'county') + '_' + (geoid || '');
  }

  /**
   * Read a JSON value from localStorage; returns null on any error.
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

  // ── Active geography state ────────────────────────────────────────────────
  /** Tracks the most recently initialized geography (geoType + geoid). */
  var _activeGeoType = 'county';
  var _activeGeoid   = '';

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
      items[id] = { checked: false, date: null, metadata: null };
    });
    return {
      geoType:   geoType  || 'county',
      geoid:     geoid    || '',
      items:     items,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // ── DOLA deadline helpers ──────────────────────────────────────────────────

  /**
   * Calculate the next DOLA deadline (January 31) from today.
   * @param {Date} [now] - Override for testing; defaults to today.
   * @returns {Date}
   */
  function nextDolaDeadline(now) {
    var d    = now || new Date();
    var year = d.getFullYear();
    var dl   = new Date(year, DOLA_DEADLINE_MONTH, DOLA_DEADLINE_DAY);
    // Compare dates only (ignore time-of-day) to avoid rolling over on Jan 31 itself
    var todayMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (todayMidnight > dl) {
      dl = new Date(year + 1, DOLA_DEADLINE_MONTH, DOLA_DEADLINE_DAY);
    }
    return dl;
  }

  /**
   * Returns true if the DOLA deadline is within DEADLINE_WARN_DAYS days.
   * @param {Date} [now] - Override for testing.
   * @returns {boolean}
   */
  function isDeadlineWarning(now) {
    var d    = now || new Date();
    var dl   = nextDolaDeadline(d);
    var diff = (dl - d) / (1000 * 60 * 60 * 24);
    return diff >= 0 && diff <= DEADLINE_WARN_DAYS;
  }

  // ── Validation ─────────────────────────────────────────────────────────────

  /**
   * Validate a checklist item's value before saving.
   *
   * @param {string} itemId  - One of ITEM_IDS
   * @param {*}      value   - The value to validate
   * @returns {{ valid: boolean, error: string|null }}
   */
  function validateChecklistItem(itemId, value) {
    if (ITEM_IDS.indexOf(itemId) === -1) {
      return { valid: false, error: 'Unknown item ID: ' + itemId };
    }
    // Value is the `checked` boolean — must be boolean
    if (typeof value !== 'boolean') {
      return { valid: false, error: 'Item checked state must be a boolean' };
    }
    return { valid: true, error: null };
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Initialize the checklist for a specific geography.
   * Loads any existing persisted state; falls back to default if none found.
   *
   * Side-effects:
   *   - Reads localStorage.
   *   - Updates DOM checkboxes and CSS classes to match saved state.
   *
   * @param {string} geoType - 'state' | 'county' | 'municipality'
   * @param {string} geoid   - 5-digit FIPS (county/state) or 7-digit place FIPS
   * @returns {object} The current checklist state
   */
  function initComplianceChecklist(geoType, geoid) {
    var key   = storageKey(geoType, geoid);
    var state = lsRead(key) || createDefaultState(geoType, geoid);

    // Ensure all items are present (handles state objects from older versions)
    ITEM_IDS.forEach(function (id) {
      if (!state.items || !state.items[id]) {
        if (!state.items) state.items = {};
        state.items[id] = { checked: false, date: null, metadata: null };
      }
    });

    // Cache active geography so updateChecklistItem can find the right key
    _activeGeoType = geoType || 'county';
    _activeGeoid   = geoid   || '';

    // Sync DOM
    _syncDom(state);

    return state;
  }

  /**
   * Persist a single checkbox state change to localStorage.
   *
   * @param {string}  itemId   - One of ITEM_IDS
   * @param {boolean} checked  - New checked state
   * @param {object}  [meta]   - Optional metadata: { value, date, note }
   * @returns {{ success: boolean, error: string|null }}
   */
  function updateChecklistItem(itemId, checked, meta) {
    var validation = validateChecklistItem(itemId, checked);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Find current geography: prefer cached active geo set by initComplianceChecklist,
    // fall back to DOM selector, then hardcoded defaults.
    var geoType = _activeGeoType || _currentGeoType();
    var geoid   = _activeGeoid   || _currentGeoid();
    var key     = storageKey(geoType, geoid);

    var state = lsRead(key) || createDefaultState(geoType, geoid);

    var resolvedDate;
    if (meta && meta.date) {
      resolvedDate = meta.date;
    } else if (checked) {
      resolvedDate = new Date().toISOString();
    } else {
      resolvedDate = null;
    }

    state.items[itemId] = {
      checked:  checked,
      date:     resolvedDate,
      metadata: meta || null,
    };
    state.updatedAt = new Date().toISOString();

    lsWrite(key, state);

    // Update DOM for this item
    _syncDomItem(itemId, state.items[itemId]);

    // Broadcast change
    broadcastChecklistChange({ geoType: geoType, geoid: geoid, itemId: itemId, checked: checked });

    return { success: true, error: null };
  }

  /**
   * Retrieve the full checklist state for a geography.
   *
   * @param {string} geoType
   * @param {string} geoid
   * @returns {object|null} State object or null if not yet saved
   */
  function getChecklistState(geoType, geoid) {
    var key = storageKey(geoType, geoid);
    return lsRead(key);
  }

  /**
   * Returns true if all 5 items in the checklist are checked.
   *
   * @param {string} geoType
   * @param {string} geoid
   * @returns {boolean}
   */
  function isChecklistComplete(geoType, geoid) {
    var state = getChecklistState(geoType, geoid);
    if (!state || !state.items) return false;
    return ITEM_IDS.every(function (id) {
      return state.items[id] && state.items[id].checked === true;
    });
  }

  /**
   * Returns a human-readable description of the next required compliance action.
   *
   * Priority:
   *   1. DOLA deadline warning (if within 30 days)
   *   2. First unchecked item
   *   3. "All items complete!" if everything is checked
   *
   * @param {string} [geoType]
   * @param {string} [geoid]
   * @returns {string}
   */
  function getNextAction(geoType, geoid) {
    var gt = geoType || _activeGeoType || _currentGeoType();
    var gd = geoid   || _activeGeoid   || _currentGeoid();

    var state = getChecklistState(gt, gd) || createDefaultState(gt, gd);

    // DOLA deadline warning overrides normal flow
    if (isDeadlineWarning()) {
      var dl     = nextDolaDeadline();
      var opts   = { month: 'long', day: 'numeric' };
      var dlStr  = dl.toLocaleDateString('en-US', opts);
      if (!state.items.dola || !state.items.dola.checked) {
        return 'File with DOLA by ' + dlStr + ' ⚠️';
      }
    }

    // First unchecked item
    for (var i = 0; i < ITEM_IDS.length; i++) {
      var id   = ITEM_IDS[i];
      var item = state.items[id];
      if (!item || !item.checked) {
        return ITEM_LABELS[id];
      }
    }

    return 'All items complete! ✅';
  }

  /**
   * Broadcast a checklist-changed custom event and write a cross-tab storage key.
   * Compliance Dashboard and other tabs listening to the 'storage' event will
   * receive the notification.
   *
   * @param {object} eventData - { geoType, geoid, itemId, checked }
   */
  function broadcastChecklistChange(eventData) {
    // 1. Fire custom DOM event for same-tab listeners
    var evt = new CustomEvent('checklist-changed', { detail: eventData, bubbles: true });
    document.dispatchEvent(evt);

    // 2. Write a flag key to localStorage so other tabs get the 'storage' event
    try {
      localStorage.setItem(
        STORAGE_PREFIX + 'last_change',
        JSON.stringify(Object.assign({ ts: Date.now() }, eventData))
      );
    } catch (_) { /* graceful degradation */ }
  }

  // ── DOM sync helpers (private) ─────────────────────────────────────────────

  /**
   * Map item IDs to their DOM element IDs (HTML).
   */
  var ITEM_DOM_MAP = {
    baseline:  'checkItemBaseline',
    growth:    'checkItemGrowth',
    fasttrack: 'checkItemFastTrack',
    dola:      'checkItemDola',
    report:    'checkItemReport',
  };

  /**
   * Map item IDs to their checkbox input IDs (HTML).
   */
  var CHK_DOM_MAP = {
    baseline:  'chkBaseline',
    growth:    'chkGrowth',
    fasttrack: 'chkFastTrack',
    dola:      'chkDola',
    report:    'chkReport',
  };

  /**
   * Sync all checklist items in the DOM to the given state.
   * @param {object} state
   */
  function _syncDom(state) {
    if (!state || !state.items) return;
    ITEM_IDS.forEach(function (id) {
      _syncDomItem(id, state.items[id]);
    });
    _syncWarningBadge(state);
  }

  /**
   * Update a single DOM checklist item to reflect its saved state.
   * @param {string} itemId
   * @param {object} itemState - { checked, date, metadata }
   */
  function _syncDomItem(itemId, itemState) {
    var liEl  = document.getElementById(ITEM_DOM_MAP[itemId]);
    var chkEl = document.getElementById(CHK_DOM_MAP[itemId]);
    if (!liEl || !chkEl) return;

    var checked = !!(itemState && itemState.checked);

    // Checkbox value
    chkEl.checked = checked;

    // aria-checked
    chkEl.setAttribute('aria-checked', String(checked));

    // CSS class
    liEl.classList.toggle('done',    checked);
    liEl.classList.toggle('pending', !checked);

    // Status icon
    var iconEl = liEl.querySelector('.checklist-status-icon');
    if (iconEl) {
      iconEl.textContent = checked ? '✓' : '⏳';
      iconEl.setAttribute('aria-hidden', 'true');
    }

    // Completed timestamp
    var dateEl = liEl.querySelector('.checklist-date-completed');
    if (dateEl) {
      if (checked && itemState && itemState.date) {
        var d   = new Date(itemState.date);
        var str = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        dateEl.textContent = 'Completed ' + str;
        dateEl.setAttribute('datetime', itemState.date);
        dateEl.style.display = '';
      } else {
        dateEl.textContent = '';
        dateEl.style.display = 'none';
      }
    }
  }

  /**
   * Add a warning CSS class to the DOLA item if the deadline is near.
   * @param {object} state
   */
  function _syncWarningBadge(state) {
    var dolaEl = document.getElementById(ITEM_DOM_MAP.dola);
    if (!dolaEl) return;

    var dolaChecked = state && state.items && state.items.dola && state.items.dola.checked;

    if (!dolaChecked && isDeadlineWarning()) {
      dolaEl.classList.add('warning');
      // Update status icon to warning
      var iconEl = dolaEl.querySelector('.checklist-status-icon');
      if (iconEl) iconEl.textContent = '⚠️';
    } else {
      dolaEl.classList.remove('warning');
    }
  }

  /**
   * Read geoType from the DOM selector (falls back to 'county').
   * @returns {string}
   */
  function _currentGeoType() {
    var el = document.getElementById('geoType');
    return (el && el.value) ? el.value : 'county';
  }

  /**
   * Read geoid from the DOM selector (falls back to empty string).
   * @returns {string}
   */
  function _currentGeoid() {
    var el = document.getElementById('geoSelect');
    return (el && el.value) ? el.value : '';
  }

  // ── Cross-tab storage listener ─────────────────────────────────────────────

  /**
   * Wire a 'storage' event listener so the page re-syncs when another tab
   * updates the checklist (e.g. compliance-dashboard.html).
   */
  function _wireStorageListener() {
    if (typeof window === 'undefined') return;
    window.addEventListener('storage', function (e) {
      if (!e.key || e.key.indexOf(STORAGE_PREFIX) !== 0) return;
      // Re-init current geography's checklist to pick up cross-tab changes
      var geoType = _currentGeoType();
      var geoid   = _currentGeoid();
      initComplianceChecklist(geoType, geoid);
    });
  }

  // Auto-wire the storage listener when the module loads in a browser context
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _wireStorageListener);
    } else {
      _wireStorageListener();
    }
  }

  // ── Public namespace ───────────────────────────────────────────────────────

  var ComplianceChecklist = {
    initComplianceChecklist:  initComplianceChecklist,
    updateChecklistItem:      updateChecklistItem,
    getChecklistState:        getChecklistState,
    isChecklistComplete:      isChecklistComplete,
    getNextAction:            getNextAction,
    broadcastChecklistChange: broadcastChecklistChange,
    validateChecklistItem:    validateChecklistItem,

    // Expose internals for testing
    _storageKey:        storageKey,
    _nextDolaDeadline:  nextDolaDeadline,
    _isDeadlineWarning: isDeadlineWarning,
    _ITEM_IDS:          ITEM_IDS,
    _ITEM_LABELS:       ITEM_LABELS,
    _DEADLINE_WARN_DAYS: DEADLINE_WARN_DAYS,
    _getActiveGeoType:  function () { return _activeGeoType; },
    _getActiveGeoid:    function () { return _activeGeoid;   },
  };

  // CommonJS (Node.js test environment)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ComplianceChecklist;
  }

  // Browser global
  root.ComplianceChecklist = ComplianceChecklist;

}(typeof window !== 'undefined' ? window : this));
