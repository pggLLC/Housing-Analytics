# `js/components/dataset-export.js`

dataset-export.js — "Full dataset" downloads: every record in a source's
file on this site, as Excel or CSV, with the same Sources and About
metadata as the table downloads.

table-export.js loads this file on the first full-dataset click; pages do
not load it themselves.

A source's records are the collection its inventory feature count is taken
from (RECORD_PATHS below, which test/table-export.test.js holds equal to
scripts/audit/inventory-count-paths.cjs), so a download always has exactly
as many rows as the inventory says the source holds. A GeoJSON file's
records are its features.

Values are written as the file stores them. Nested fields become dotted
column names (affordable_rent_monthly.30); a list of records inside a
record (a FRED series' observations) becomes its own sheet, joined back by
the parent's key. Nothing is rounded, renamed or filled in: a null stays a
blank cell, never a zero.

## Symbols

### `collections(sourceId, data)`

The record collections in a parsed file: [{ name, records: [{ key, value }] }].
Returns null when the file's records cannot be located.

### `flatten(value, prefix, row, child)`

Flatten one record into `row` (column → value). Lists of records found
inside it are handed to `child(path, items)`.

### `tabulate(sourceId, data)`

Flatten a whole file into sheets. Pure; no DOM, no network.
Returns { sheets: [Sheet], recordCount } or null.

### `build(source, format, data)`

Build a full-dataset download. Resolves to { name, blob, format,
recordCount, sheets } without saving.
  source  an inventory entry (TableExport resolves the id)
  data    optional parsed file, for tests; otherwise fetched
