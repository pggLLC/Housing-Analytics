# `scripts/contrast-audit/run.js`

scripts/contrast-audit/run.js
Playwright-based WCAG contrast audit with auto-fix capability.

Usage:
  CONTRAST_BASE_URL=http://localhost:8765 node scripts/contrast-audit/run.js

Environment variables:
  CONTRAST_BASE_URL   Base URL of the running HTTP server (default: http://localhost:8765)
  CONTRAST_PAGE       Audit a single page only, e.g. "index.html" (default: audit all 5 pages)
  CONTRAST_FIX=1      Apply contrast-guard fixes in the browser context and report before/after ratios
  CONTRAST_JSON=1     Print the full JSON report to stdout instead of the text summary
  CONTRAST_REPORT_FILE=<path>  Write the JSON report to a file (can combine with CONTRAST_JSON)
  CONTRAST_SETTLE_TIMEOUT_MS   How long a page may keep changing before it is reported as
                      not scanned (default 20000)

Scans key pages served via http-server, capped at 2000 nodes/page, once the
page has settled (see waitForSettled) — never at an arbitrary load event.
Skips aria-hidden elements, opacity < 0.9, and font-size < 10px.
Thresholds: 4.5 normal text / 3.0 large text (WCAG AA).

Fix logic mirrors js/contrast-guard.js (runtime fixer):
  - Uses CSS variables --text-d / --text-l for foreground corrections
  - Applies --card-d / --card-l background surface to boxy elements when needed
  - Marks fixed elements with the `contrast-guard-fixed` class

_No documented symbols — module has a file-header comment only._
