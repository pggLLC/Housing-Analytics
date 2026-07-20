# `scripts/audit/qa-status-generator.mjs`

scripts/audit/qa-status-generator.mjs

Generates `data/_qa-status.json` — a single canonical snapshot of the
repo's data-quality state. Combines the four QA layers into one machine-
+ human-readable status object:

  1. Schema (validate-schemas)
  2. Sentinel (data-sentinels-check)
  3. Bounds (validate-critical-data)
  4. Freshness (data-freshness-check)

Plausibility (Layer 5, pytest-based) is captured by reading the most
recent pytest output if available, or a "not run" badge otherwise.

Output is consumed by `dashboard-data-quality.html` to render a public
QA status page. Updated daily by the data-quality-check workflow.

Exit codes:
  0  — generated successfully (regardless of file health)
  1  — internal generator error (should never fail just because data is broken)

Usage:
  node scripts/audit/qa-status-generator.mjs
  node scripts/audit/qa-status-generator.mjs --quiet

## Symbols

### `tryRun(cmd)`

Run a shell command, capture stdout, and return {success, output, error}.
Doesn't throw — failures are part of the QA report, not a generator error.

### `parseFreshnessOutput(output)`

Parse data-freshness-check output into structured records.
Output format per line: "OK  3.4d  SLA 9d   field:meta.generated  data/...json"

### `runPytest(pattern)`

Run pytest -k pattern and parse pass/fail summary.
F250 — Detects pytest-missing (or no matching tests) and returns a
clear `notRun: true` flag. Previously a missing pytest silently
matched 0 passed / 0 failed which the dashboard rendered as "pass" —
a false-clean status. Now the dashboard can show "Skipped (pytest
not on runner)" or similar.
Returns { passed, failed, notRun, reason, output }.
