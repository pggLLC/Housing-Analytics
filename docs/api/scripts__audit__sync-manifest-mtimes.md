# `scripts/audit/sync-manifest-mtimes.mjs`

sync-manifest-mtimes.mjs — keep DATA-MANIFEST.json's `last_update`
fields synced to the real file mtimes on disk.

Designed to run as a pre-commit / CI hook (and is also safe to run
by hand). Writes one ISO date per source whose on-disk file is
newer than the declared `last_update`, never moves a stamp backward.

Exit status: 0 on success (even if nothing changed), 1 on any I/O
failure. CI can wire it as a non-blocking "fix-up" step that stages
the change automatically.

Companion to scripts/audit/refresh-inventory-mtimes.mjs (same idea
applied to js/data-source-inventory.js).

Usage:
  node scripts/audit/sync-manifest-mtimes.mjs            # write
  node scripts/audit/sync-manifest-mtimes.mjs --dry-run  # report only

_No documented symbols — module has a file-header comment only._
