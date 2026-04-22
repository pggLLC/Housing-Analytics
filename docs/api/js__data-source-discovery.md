# `js/data-source-discovery.js`

## Symbols

### `probeFile(path)`

Probe a single URL: HEAD to check existence, then optionally fetch size/hash.
@param {string} path
@returns {Promise<{path, exists, sizeEstimate, hash, probeMs}>}

### `computeFileHash(path)`

Fetch a small portion of a JSON file to compute a hash for change detection.
@param {string} path
@returns {Promise<string>}

### `buildManifestIndex(manifest)`

Build a map of file_path → entry from DATA-MANIFEST.json for fast lookup.
@param {object} manifest
@returns {object}

### `runDiscovery()`

Run the full discovery scan.
@returns {Promise<DiscoveryReport>}
