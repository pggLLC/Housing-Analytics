# `scripts/contrast-audit/run.js`

scripts/contrast-audit/run.js
Playwright-based WCAG contrast audit with auto-fix capability.

Usage:
  CONTRAST_BASE_URL=http://localhost:8080 node scripts/contrast-audit/run.js

Environment variables:
  CONTRAST_BASE_URL   Base URL of the running HTTP server (default: http://localhost:8080)
  CONTRAST_PAGE       Audit a single page only, e.g. "index.html" (default: audit all 5 pages)
  CONTRAST_FIX=1      Apply contrast-guard fixes in the browser context and report before/after ratios
  CONTRAST_JSON=1     Print the full JSON report to stdout instead of the text summary
  CONTRAST_REPORT_FILE=<path>  Write the JSON report to a file (can combine with CONTRAST_JSON)

Scans key pages served via http-server, capped at 2000 nodes/page.
Skips aria-hidden elements, opacity < 0.9, and font-size < 10px.
Thresholds: 4.5 normal text / 3.0 large text (WCAG AA).

Fix logic mirrors js/contrast-guard.js (runtime fixer):
  - Uses CSS variables --text-d / --text-l for foreground corrections
  - Applies --card-d / --card-l background surface to boxy elements when needed
  - Marks fixed elements with the `contrast-guard-fixed` class

## Symbols

### `auditPage(page, url, doFix)`

Audit a page for contrast violations and optionally apply fixes.

Returns { violations, fixes } where:
  violations – elements that fail WCAG AA contrast before any fix is applied
  fixes      – elements that were fixed (only populated when doFix is true)

Each violation: { tag, text, fg, bg, bg_effective, ratio, threshold, isLarge }
Each fix:       { tag, text, fg_before, fg_after, fix_applied, bg_effective,
                  bg_fixed, ratio_before, ratio_after, threshold, isLarge, passes_after_fix }
