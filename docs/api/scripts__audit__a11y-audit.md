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

_No documented symbols — module has a file-header comment only._
