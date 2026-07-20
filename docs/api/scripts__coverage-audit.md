# `scripts/coverage-audit.js`

coverage-audit.js — F144
=========================
Automated audit that surfaces where curated data is thin. Same logic
that would have caught Bank of the San Juans (F142) BEFORE the user
had to point it out manually.

Writes data/coverage-report.json + prints a CLI summary. Exit
non-zero when any "critical" gap exists, so the script can gate CI
and prevent silent coverage backsliding.

Categories audited:
  1. County-level employer rosters       — 25/64 covered after F142
  2. Place-level local-resources entries  — 68/482 covered
  3. Capital partner regional coverage    — every CO region should
     have ≥1 community bank
  4. Place curation (schools / hospitals) — flag major places missing
  5. Tax abatement coverage                — top 30 jurisdictions
  6. Local-PHA roster gap candidates       — places with 0 federal
     affordable housing records

Run:        node scripts/coverage-audit.js
CI-friendly: node scripts/coverage-audit.js --strict
             (exits 1 on any critical gap)
JSON only:  node scripts/coverage-audit.js --json

_No documented symbols — module has a file-header comment only._
