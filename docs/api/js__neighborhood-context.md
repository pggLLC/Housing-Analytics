# `js/neighborhood-context.js`

neighborhood-context.js
ES5 IIFE module — window.NeighborhoodContext

Loads pre-computed neighborhood/architectural context for all 64 Colorado
counties from data/core/neighborhood-context.json and exposes utilities for
LIHTC developers to understand design compatibility with surrounding community.

Public API:
  load()                              → Promise<void>
  isLoaded()                          → boolean
  getCounty(fips)                     → county context object | null
  renderContextCard(containerId, fips)→ void

## Symbols

### `_label(value)`

Convert a raw form or era value to a human-readable label.

### `_densityLabel(value)`

Density label (no "Density" suffix — used in badge where space is tight).

### `_pressureLabel(value)`

Pressure label text (short).

### `_esc(str)`

Safely escape text for injection into innerHTML.

### `_formLabel(form)`

Form label, splitting compound values like "suburban+small_town" on "+".

### `_eraLabel(era)`

Era label, splitting compound values.

### `_mixLabel(mix)`

Build the housing-mix pill string.

### `load()`

Load the neighborhood context JSON.
Idempotent — safe to call multiple times; returns the same Promise if
a load is already in flight.

@returns {Promise<void>}

### `isLoaded()`

Whether the JSON has been successfully loaded.

@returns {boolean}

### `getCounty(fips)`

Retrieve the context object for a single county.

@param  {string} fips  Five-digit FIPS code, e.g. "08031"
@returns {object|null}

### `renderContextCard(containerId, fips)`

Render a neighbourhood context card into a DOM container.

@param {string} containerId  id of the target element
@param {string} fips         Five-digit FIPS code, e.g. "08031"
