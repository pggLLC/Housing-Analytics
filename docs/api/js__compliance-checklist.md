# `js/compliance-checklist.js`

## Symbols

### `STORAGE_PREFIX`

LocalStorage namespace prefix — avoids collisions with other tools.

### `DOLA_DEADLINE_MONTH`

DOLA annual filing deadline (month is 0-indexed: 0 = January).

### `DEADLINE_WARN_DAYS`

Days before DOLA deadline to show warning badge.

### `ITEM_IDS`

Ordered list of all checklist item IDs (matches HTML).

### `ITEM_LABELS`

Human-readable labels for each item.

### `storageKey(geoType, geoid)`

Build the localStorage key for a given geography.
@param {string} geoType - 'state' | 'county' | 'place' | 'cdp' | 'municipality'
@param {string} geoid   - FIPS or place code
@returns {string}

### `lsRead(key)`

Read a JSON value from localStorage; returns null on any error.
@param {string} key
@returns {object|null}

### `lsWrite(key, value)`

Write a JSON value to localStorage; silently swallows errors
(e.g. private-browsing mode, storage quota exceeded).
@param {string} key
@param {object} value

### `_activeGeoType`

Tracks the most recently initialized geography (geoType + geoid).

### `createDefaultState(geoType, geoid)`

Create a fresh (all-unchecked) checklist state record.
@param {string} geoType
@param {string} geoid
@returns {object}

### `nextDolaDeadline(now)`

Calculate the next DOLA deadline (January 31) from today.
@param {Date} [now] - Override for testing; defaults to today.
@returns {Date}

### `isDeadlineWarning(now)`

Returns true if the DOLA deadline is within DEADLINE_WARN_DAYS days.
@param {Date} [now] - Override for testing.
@returns {boolean}

### `validateChecklistItem(itemId, value)`

Validate a checklist item's value before saving.

@param {string} itemId  - One of ITEM_IDS
@param {*}      value   - The value to validate
@returns {{ valid: boolean, error: string|null }}

### `initComplianceChecklist(geoType, geoid)`

Initialize the checklist for a specific geography.
Loads any existing persisted state; falls back to default if none found.

Side-effects:
  - Reads localStorage.
  - Updates DOM checkboxes and CSS classes to match saved state.

@param {string} geoType - 'state' | 'county' | 'place' | 'cdp' | 'municipality'
@param {string} geoid   - 5-digit FIPS (county/state) or 7-digit place FIPS
@returns {object} The current checklist state

### `updateChecklistItem(itemId, checked, meta)`

Persist a single checkbox state change to localStorage.

@param {string}  itemId   - One of ITEM_IDS
@param {boolean} checked  - New checked state
@param {object}  [meta]   - Optional metadata: { value, date, note }
@returns {{ success: boolean, error: string|null }}

### `getChecklistState(geoType, geoid)`

Retrieve the full checklist state for a geography.

@param {string} geoType
@param {string} geoid
@returns {object|null} State object or null if not yet saved

### `isChecklistComplete(geoType, geoid)`

Returns true if all 5 items in the checklist are checked.

@param {string} geoType
@param {string} geoid
@returns {boolean}

### `getNextAction(geoType, geoid)`

Returns a human-readable description of the next required compliance action.

Priority:
  1. DOLA deadline warning (if within 30 days)
  2. First unchecked item
  3. "All items complete!" if everything is checked

@param {string} [geoType]
@param {string} [geoid]
@returns {string}

### `broadcastChecklistChange(eventData)`

Broadcast a checklist-changed custom event and write a cross-tab storage key.
Compliance Dashboard and other tabs listening to the 'storage' event will
receive the notification.

@param {object} eventData - { geoType, geoid, itemId, checked }

### `ITEM_DOM_MAP`

Map item IDs to their DOM element IDs (HTML).

### `CHK_DOM_MAP`

Map item IDs to their checkbox input IDs (HTML).

### `_syncDom(state)`

Sync all checklist items in the DOM to the given state.
@param {object} state

### `_syncDomItem(itemId, itemState)`

Update a single DOM checklist item to reflect its saved state.
@param {string} itemId
@param {object} itemState - { checked, date, metadata }

### `_syncWarningBadge(state)`

Add a warning CSS class to the DOLA item if the deadline is near.
@param {object} state

### `_currentGeoType()`

Read geoType from the DOM selector (falls back to 'county').
@returns {string}

### `_currentGeoid()`

Read geoid from the DOM selector (falls back to empty string).
@returns {string}

### `_wireStorageListener()`

Wire a 'storage' event listener so the page re-syncs when another tab
updates the checklist (e.g. compliance-dashboard.html).
