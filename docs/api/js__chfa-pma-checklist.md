# `js/chfa-pma-checklist.js`

## Symbols

### `STORAGE_PREFIX`

LocalStorage namespace prefix — avoids collisions with other tools.

### `ITEM_IDS`

Ordered list of all checklist item IDs (matches HTML).

### `ITEM_LABELS`

Human-readable labels for each item.

### `CHK_DOM_MAP`

Map item IDs → checkbox input element IDs (must match HTML).

### `ITEM_DOM_MAP`

Map item IDs → list item element IDs (must match HTML).

### `_activeGeoType`

Tracks the most recently initialized geography.

### `storageKey(geoType, geoid)`

Build the localStorage key for a given geography.
Always includes both geoType and geoid for consistency.
@param {string} geoType
@param {string} geoid
@returns {string}

### `lsRead(key)`

Read a JSON value from localStorage; returns null on any error
(invalid JSON, private browsing, storage disabled).
@param {string} key
@returns {object|null}

### `lsWrite(key, value)`

Write a JSON value to localStorage; silently swallows errors
(e.g. private-browsing mode, storage quota exceeded).
@param {string} key
@param {object} value

### `_readDomState()`

Read the current checked state of all CHFA checkboxes from the DOM.
@returns {object} Map of itemId → boolean

### `_applyDomState(items)`

Apply a saved items map to the DOM checkboxes and update CSS classes.
@param {object} items - Map of itemId → boolean (or falsy for default)

### `_updateProgress()`

Refresh the progress bar fill, label, and completion status badge
based on the current DOM checkbox states.

### `initChfaChecklist(geoType, geoid)`

Initialize the CHFA checklist for a specific geography.

If called after a previous geography was active, first saves the current
DOM state for the old geography, then loads and restores the saved state
for the new geography (or defaults to all-unchecked if no state exists).

@param {string} geoType - 'state' | 'county' | 'place' | 'cdp' | 'municipality'
@param {string} geoid   - FIPS or place code
@returns {object} The loaded state: { geoType, geoid, items }

### `saveChfaState(geoType, geoid)`

Persist the current DOM checkbox states to localStorage for a geography.

@param {string} geoType
@param {string} geoid

### `getChfaState(geoType, geoid)`

Retrieve the full saved checklist state for a geography.

@param {string} geoType
@param {string} geoid
@returns {object|null} State object or null if not yet saved

### `isChfaChecklistComplete(geoType, geoid)`

Returns true if all 8 items in the checklist are checked.

@param {string} geoType
@param {string} geoid
@returns {boolean}

### `updateItem(itemId, checked)`

Update a single checklist item programmatically, apply to DOM, and persist.

@param {string}  itemId  - One of the ITEM_IDS values
@param {boolean} checked - New checked state

### `getChecklistItems()`

Return a shallow copy of the ordered list of all CHFA checklist item IDs.
@returns {string[]}

### `_wiringDone`

Wire change listeners to all CHFA checklist checkboxes.
Called automatically on DOMContentLoaded.
Safe to call multiple times (idempotent via _wiringDone guard).
