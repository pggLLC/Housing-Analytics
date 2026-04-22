# `js/data-source-updater.js`

## Symbols

### `buildEntry(discovered, overrides)`

Convert a discovered-source probe object into a DATA-MANIFEST.json entry.
@param {object} discovered  — object from DataSourceDiscovery.newSources[]
@param {object} [overrides] — optional manual overrides from admin form
@returns {object} manifest entry

### `mergeEntries(manifest, newEntries)`

Take existing manifest JSON and merge in new entries.
@param {object}   manifest  — parsed DATA-MANIFEST.json
@param {object[]} newEntries — array of buildEntry() results
@returns {object} updated manifest

### `generatePatch(newEntries)`

Fetch the current manifest, apply new entries, and return the patched object.
@param {object[]} newEntries
@returns {Promise<object>}

### `downloadPatch(patchedManifest)`

Trigger a browser download of the patched manifest JSON.
@param {object} patchedManifest

### `approvePendingSource(filePath, approvedBy)`

Mark a pending source as approved, update sessionStorage list.
@param {string}  filePath
@param {string}  approvedBy — identifier for the reviewer
@returns {object} updated entry

### `whereUsed(filePath)`

Produce a rough "where used" list by checking if a file path string appears
in the DataSourceInventory registry or the discovery probe results.
Full cross-file code scanning happens in the GitHub Actions Node script.
@param {string} filePath
@returns {string[]} list of page names / descriptions
