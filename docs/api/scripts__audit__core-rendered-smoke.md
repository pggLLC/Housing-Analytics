# `scripts/audit/core-rendered-smoke.mjs`

core-rendered-smoke.mjs
Focused Playwright smoke for the Phase 3.1 rendered-QA gate.

Usage:
  npm run audit:core-rendered-smoke
  AUDIT_BASE_URL=http://127.0.0.1:8080 npm run audit:core-rendered-smoke

Options:
  AUDIT_BASE_URL  Existing static server base URL. If omitted, this script starts one.
  REPORT_DIR      Output directory base (default: audit-report/core-rendered-smoke).

Outputs JSON + Markdown evidence to {REPORT_DIR}/{timestamp}/.

_No documented symbols — module has a file-header comment only._
