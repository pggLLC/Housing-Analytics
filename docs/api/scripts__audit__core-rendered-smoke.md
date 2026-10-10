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

## Symbols

### `pmaTractDefaultInteraction(page, viewport)`

PMA, audit F13: the Tract picker is the default method (CHFA requires a PMA
of whole census tracts), but a map click used to run a circular buffer
regardless, and a click on a picker tract fell through the county-boundary
fill to the map, moving the site. Driven with real mouse clicks because the
defect was about which layer receives the click, which only a browser with
layout can tell. Desktop only: the map is the interaction surface.
Returns a list of failures.
