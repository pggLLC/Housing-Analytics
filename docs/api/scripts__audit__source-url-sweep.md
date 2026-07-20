# `scripts/audit/source-url-sweep.mjs`

source-url-sweep.mjs

Verify external source-citation URLs are still reachable.

Scans:
  - DATA-MANIFEST.json
  - js/citations.js
  - root-level *.html href attributes

Exit codes:
  0 => all URLs are OK (or allow-listed / timeout-only outcomes)
  1 => at least one hard failure (404/5xx/network)
  2 => script-level failure

_No documented symbols — module has a file-header comment only._
