# `scripts/audit/duplicate-artifact-scan.mjs`

scripts/audit/duplicate-artifact-scan.mjs — F(#1107)

Why this exists
----------------
When this repo lives under an iCloud-synced folder, sync conflicts create
"filename 2.ext", "filename 3.ext", etc. duplicates on disk (macOS Finder
save-as conflicts do the same for " 2." only). Common one-, two-, and
three-digit suffixes are gitignored, so they can't be committed, but they still
distort local `find`/`ls`/glob-based counts and repo sweeps for whoever's
running them — 460 such files were found at audit time (2026-07-09), up
from 228 a day earlier.

This is local-dev-only by design: CI clones a fresh checkout from git, so
these files never exist there. Warn-only, always exits 0 — never auto-
deletes, since a " 2."/" 3." file may represent a real unresolved sync
conflict a developer needs to look at before choosing which copy to keep.

Usage:
  node scripts/audit/duplicate-artifact-scan.mjs

Hooked into `npm run audit:duplicate-artifacts` (not part of test:ci —
see rationale above).

_No documented symbols — module has a file-header comment only._
