# `scripts/audit/chart-population-audit.mjs`

chart-population-audit.mjs

Headless Chrome audit that opens HNA at a known county AND a known
place, waits for renderers to settle, then asserts that every
named Chart.js canvas in EXPECTED_CHARTS has a real Chart instance
attached with at least one non-zero data point.

Why
---
This session has shipped a long string of "tests pass but UI broken"
fixes (chartRentBurdenBins reading wrong DP04 codes, chartLehd
expecting a flows[] array that doesn't exist, chartPyramid expecting
a cohorts[] shape, chartOwnerCostBurden reading non-existent count
fields, etc.). The existing test suite is source-grep only — it
can confirm a renderer function exists, but not that it actually
paints pixels in a browser.

This script closes that gap. If a renderer regresses and a chart
goes empty, this audit fails CI before the user has to file a bug.

Usage
-----
  AUDIT_BASE_URL=http://127.0.0.1:8080 \
    node scripts/audit/chart-population-audit.mjs

Exits non-zero when any expected chart is missing, unattached, or
has all-zero data. Writes a JSON report to:
  audit-report/chart-population/{timestamp}.json

_No documented symbols — module has a file-header comment only._
