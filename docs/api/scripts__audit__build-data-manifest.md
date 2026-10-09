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

## Symbols

### `changedSinceManifest(repo = REPO)`

Data paths whose content may differ from what the committed manifest
describes, relative to data/: every path changed in a commit since
data/_manifest.json was last written, plus every uncommitted change.
"Since the manifest was written", not just "uncommitted": several jobs
commit a data file and rebuild only data/manifest.json, and a same-size
edit there is otherwise indistinguishable from no edit (Codex, #1891).
null when git cannot say (no history, a shallow clone that does not reach
the manifest's commit), in which case nothing is carried over.

### `carryCommittedMtimes(items, previous, changed)`

A file's mtime on disk is when this checkout wrote it, not when it
changed: every fresh clone, and so every CI run, gives every file a new
one. Regenerating the manifest after a merge therefore rewrote all ~1,600
entries (3,250 lines, 2026-09-25, the first post-merge refresh after
#1887), and any open PR that touched the manifest conflicted with it.

An entry keeps the committed mtime when the file has not changed since
the manifest was written (changedSinceManifest) and every other field is
what the committed manifest already says. Exported for the test.
