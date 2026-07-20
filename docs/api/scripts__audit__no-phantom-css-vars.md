# `scripts/audit/no-phantom-css-vars.mjs`

no-phantom-css-vars.mjs — F252

Why this exists
---------------
The pill-contrast bug kept coming back because the AI kept inventing
CSS variables that don't exist (`--surface-2` in F236/F237/F238/F250).
Each invented `var(--surface-2, #f7f7f9)` falls back to the hardcoded
grey hex — invisible on dark mode against `--muted` text.

This script walks every HTML / JS / CSS file in the repo and finds
every `var(--xxx)` reference. It then walks every CSS file and finds
every `--xxx:` definition. References that aren't defined fail the
build.

Exit code:
  0 — clean
  1 — at least one phantom reference (printed to stdout)

Usage
-----
  node scripts/audit/no-phantom-css-vars.mjs

Hooked into `npm run test:phantom-css-vars` → `npm run test:ci`.

_No documented symbols — module has a file-header comment only._
