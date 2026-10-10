# `scripts/audit/runtime-contrast-scan-fn.mjs`

The in-page half of scripts/audit/runtime-contrast-scanner.mjs: the scanner
that runs inside each page, and the walk through the page's tabs. Split out
so test/runtime-contrast-scanner-fixtures.test.mjs can run exactly what the
gate runs against fixtures with known ratios (#2038).

_No documented symbols — module has a file-header comment only._
