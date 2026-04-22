# `scripts/audit/console-error-reporter.mjs`

console-error-reporter.mjs
Playwright-based console error audit for all site pages.

Visits every HTML page, captures console errors AND warnings, deduplicates
repeated messages, and writes structured JSON + Markdown reports.

Usage:
  AUDIT_BASE_URL=http://127.0.0.1:8080 node scripts/audit/console-error-reporter.mjs

Options (env vars):
  AUDIT_BASE_URL   Base URL of the running static server (default: http://127.0.0.1:8080)
  REPORT_DIR       Override output directory (default: audit-report/console/<timestamp>/)
  PAGE_TIMEOUT_MS  Per-page navigation timeout in ms (default: 30000)
  SETTLE_MS        Extra wait after networkidle for lazy scripts (default: 3000)

Outputs:
  <REPORT_DIR>/console-report.json   — machine-readable full report
  <REPORT_DIR>/console-report.md     — Markdown summary (used for GitHub Issue body)

Exit codes:
  0  — audit complete (errors may still have been found; caller decides)
  1  — fatal runner error

## Symbols

### `messages`

@type {Array<{level:string, text:string, location:object|null}>}
