# `js/data-freshness.js`

js/data-freshness.js

Loads data/manifest.json and stamps every .data-timestamp element on the
current page with "Data last updated: <date>" sourced from the manifest
`generated` field.

Also exposes window.__dataFreshness so other scripts can read the manifest
timestamp (e.g. to override a specific element after their own data load).

Depends on: js/fetch-helper.js (safeFetchJSON, resolveAssetUrl)

## Symbols

### `formatDate(isoString)`

Format an ISO-8601 UTC string into a human-friendly local date string.
Falls back gracefully if the string is missing or unparseable.
@param {string} isoString
@returns {string}

### `stampElements(label)`

Stamp all .data-timestamp elements that are still empty with the
manifest-derived label.  Elements that already have content are left
untouched so page-specific scripts retain control.
@param {string} label  e.g. "Data last updated: Mar 10, 2026"

### `init()`

Load the manifest and update all empty .data-timestamp elements.
Stores the resolved manifest on window.__dataFreshness for other scripts.
