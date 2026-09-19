# `scripts/audit/refresh-inventory-mtimes.mjs`

refresh-inventory-mtimes.mjs — walk js/data-source-inventory.js,
cross-reference each source's `localFile:` against the committed data
file, and rewrite two fields that otherwise rot:

  - `lastUpdated:` → the file's real mtime, when on-disk is newer.
  - `features:`    → the actual record count in the file, for every
    source listed in JSON_COUNT_PATHS.

Why
---
The dashboard's `Stale` count was dominated by inventory drift —
entries declaring `lastUpdated: '2024-08-30'` (or earlier) for files
that scripts refresh nightly. The dashboard treated them as overdue
even though the on-disk file was newer. This script syncs the
declared timestamp to the real one.

`features:` rotted the same way, but louder: nothing recomputed it, so
test/data-source-inventory-drift.test.js turned main red whenever an
append-only series grew. `fred-mortgage30` publishes one observation a
week, so it broke roughly weekly (2026-09-11) and was reconciled by
hand in PR #1569 and again in #1593. Now it's recomputed here, from the
same map the gate asserts against.

Rules
-----
  - If localFile is null or the path doesn't exist on disk → skip
    (those are reference entries with no cached file).
  - If mtime is newer than the declared lastUpdated → update.
  - If mtime is *older* than the declared lastUpdated → leave alone
    (someone curated a manual date — don't overwrite it backward).
  - `features:` is synced in *both* directions — the gate asserts exact
    equality, so a count that shrank is drift just the same.
  - `features: null` entries are left alone. Those declare
    `featuresCountable: false` with no localFile; the count genuinely
    doesn't exist and must not be invented.
  - COUNTY_DIRECTORY_IDS are left alone too: they count per-county files
    present in a directory against data/hna/geo-config.json rather than
    a path inside one document, and a partial sync of that directory
    should surface as a failing gate, not get papered over here.
  - Always print a summary diff.

Usage
-----
    node scripts/audit/refresh-inventory-mtimes.mjs
    node scripts/audit/refresh-inventory-mtimes.mjs --dry-run

## Symbols

### `scanLine(line, startDepth)`

Brace depth and string/comment masking for one line.

`depths[i]` is the depth *before* consuming character i, so a key token's
depth is read at its first character. Braces inside quoted strings or after
a `//` comment don't move the depth, and `inert[i]` marks those regions so a
key-shaped substring inside a description string can't be mistaken for a
real field.
