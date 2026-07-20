# `scripts/audit/data-inventory.mjs`

scripts/audit/data-inventory.mjs

Inventories all local data files under data/ and maps/ and prints a
human-readable report plus a machine-readable JSON summary.

Usage:
  node scripts/audit/data-inventory.mjs [--json]

With --json, writes data/manifest.json and prints the JSON to stdout.
Without --json, prints a formatted table to stdout.

Reports:
 - File path, size (KB), type, feature/record count, geographic coverage
 - Flags placeholder files (0 features, stub metadata)
 - Summary totals

## Symbols

### `inspectFile(filePath)`

Returns { type, featureCount, recordCount, geoCoverage, placeholder, note }
by inspecting the file contents.
