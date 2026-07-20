# `scripts/audit/refresh-inventory-mtimes.mjs`

refresh-inventory-mtimes.mjs — walk js/data-source-inventory.js,
cross-reference each source's `localFile:` against the file's real
mtime, and rewrite `lastUpdated:` to that mtime when the on-disk
file is newer than what the inventory declares.

Why
---
The dashboard's `Stale` count was dominated by inventory drift —
entries declaring `lastUpdated: '2024-08-30'` (or earlier) for files
that scripts refresh nightly. The dashboard treated them as overdue
even though the on-disk file was newer. This script syncs the
declared timestamp to the real one.

Rules
-----
  - If localFile is null or the path doesn't exist on disk → skip
    (those are reference entries with no cached file).
  - If mtime is newer than the declared lastUpdated → update.
  - If mtime is *older* than the declared lastUpdated → leave alone
    (someone curated a manual date — don't overwrite it backward).
  - Always print a summary diff.

Usage
-----
    node scripts/audit/refresh-inventory-mtimes.mjs
    node scripts/audit/refresh-inventory-mtimes.mjs --dry-run

_No documented symbols — module has a file-header comment only._
