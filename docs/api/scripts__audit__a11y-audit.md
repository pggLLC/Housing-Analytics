# `scripts/audit/a11y-audit.mjs`

scripts/audit/a11y-audit.mjs — WCAG 2.1 AA accessibility audit via axe-core.

Partial closeout of #658 (WCAG audit + axe-core configured and runnable
as `npm run audit:a11y`).

Design:
  - Uses Playwright to open each configured HTML page via file:// URLs.
    file:// is fine for this first pass — axe inspects the rendered DOM,
    and dynamic-data issues show up on pages whose static markup is
    already WCAG-clean (so file:// is a strict subset of what a live
    audit would surface).
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

### `auditPage(browser, pagePath, axeScript)`

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
