# `scripts/audit/a11y-audit.mjs`

scripts/audit/a11y-audit.mjs — WCAG 2.2 AA accessibility audit via axe-core.

Partial closeout of #658 (WCAG audit + axe-core configured and runnable
as `npm run audit:a11y`).

Design:
  - Serves the repository over a local HTTP server and opens each page
    the way a visitor's browser does, then waits for its data to load.

    It used to open pages as file:// URLs, on the theory that this was a
    strict subset of a live audit. It was not a subset, it was a different
    page: every fetch() of a data file fails under file://, so maps, tables
    and charts never rendered. hna-what-housing-exists.html came out as
    ~1,200 DOM nodes and zero map markers, while the live page drew 926
    markers with no accessible name (axe aria-command-name, serious). The
    report said 0 violations from April to October 2026 for that reason.
  - Loads axe-core via page.addScriptTag from node_modules. axe-core is
    already a transitive devDep via lighthouse — no new package needed.
  - Emits:
      data/reports/a11y-baseline.json  — raw axe output per page
      docs/reports/a11y-baseline-2026.md — human-readable baseline
    The baseline file is committed so a PR-time diff shows regressions.

Exit codes:
  0  — audit ran to completion (violations OK; this is a reporter)
  1  — script-level error (Playwright failed to launch, page 404, etc.)

Usage:
  npm run audit:a11y             # default: all pages in AUDIT_PAGES
  node scripts/audit/a11y-audit.mjs --page index.html
  node scripts/audit/a11y-audit.mjs --json-only

## Symbols

### `auditPage(browser, origin, pagePath, axeScript)`

Audit one page. Never throws: a page that cannot be audited comes back as
`{ error }` so the run continues and the failure is reported per page.

Previously only page.goto() was guarded. addScriptTag() and evaluate() were
not, so when Chromium dropped the tab on deal-calculator.html — 219 form
inputs, the heaviest page in the set — the rejection escaped this function
and killed the whole audit. Two runs of the SAME commit (e7df0d0cc) on
2026-09-16 disagreed: one passed, one failed. An accessibility gate that
answers differently for identical code is not measuring accessibility, and
what people learn from it is to ignore a red axe.

The context is also closed in a `finally`. It was closed only on the success
path, so every crash leaked a browser context for the remaining pages to
compete with — which is the likeliest reason the last page in a 21-page run
is the one that dies.
