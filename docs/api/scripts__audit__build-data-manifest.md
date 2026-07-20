# `scripts/audit/build-data-manifest.mjs`

build-data-manifest.mjs — walk data/ and emit a manifest that the
data-explorer.html page reads to render a browsable file list with
size / mtime / light schema info per file.

For each .json / .geojson / .csv file (under MAX_BYTES bytes) we capture:
  - relative path
  - size in bytes
  - mtime (ISO 8601)
  - kind: 'json' | 'geojson' | 'csv'
  - record_count: features.length for GeoJSON; array length / top-key counts
    for JSON; row count for CSV. Best-effort, parses cheaply.
  - schema: a short snapshot — top-level keys for objects, the keys of the
    first record for arrays-of-objects, or column names for CSV.

Files larger than MAX_PARSE_BYTES are listed but their content isn't probed
(size / mtime only). Common excludes (.gitignore'd raw downloads, _manifest
itself) are skipped.

Output: data/_manifest.json — read directly by data-explorer.html.

Usage:
  node scripts/audit/build-data-manifest.mjs

_No documented symbols — module has a file-header comment only._
