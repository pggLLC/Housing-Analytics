# `scripts/audit/verify-opportunity-finder.mjs`

verify-opportunity-finder.mjs — QA/QC harness for the LIHTC Opportunity Finder.

Codex handoff target. Run this to verify the programming behind the
jurisdiction-level rollup that powers `lihtc-opportunity-finder.html`
and `js/lihtc-opportunity-finder.js`. The script independently re-implements
the rollup math in Node so it can detect regressions in:

  1. Data file integrity (all 10 source files load + have expected shape)
  2. QCT tract count (HUD 2025 publication)
  3. DDA county FIPS count (HUD 2025 publication — CO has 10 nonmetro)
  4. LIHTC project geometry filtering (drop YR_PIS=8888 placeholders)
  5. Place-tract membership rollup (TIGER 2024)
  6. Place→county containment (every place has a 5-digit county FIPS)
  7. Score weight invariants (each target's weights sum to 1.0)
  8. Composite score range (every output in [0, 100])
  9. Civic-capacity data joins (policy scorecard + local-resources + prop123)
 10. Known-case spot checks (Sugar City, Cortez, Crowley, Montezuma)
 11. Default-filter result count (QCT+DDA, no CDPs, 9% target → 5 jurisdictions)

USAGE
  node scripts/audit/verify-opportunity-finder.mjs
  node scripts/audit/verify-opportunity-finder.mjs --verbose
  node scripts/audit/verify-opportunity-finder.mjs --json

EXIT CODES
  0  — every check passed
  1  — at least one check failed (regression)
  2  — internal script error (e.g. a configured file is missing)

RELATED
  - js/lihtc-opportunity-finder.js   — the production rollup module
  - lihtc-opportunity-finder.html    — the UI consumer
  - test/qa-recent-changes.js        — broader QA harness (smoke / urls / schema)
  - docs/audits/                     — methodology audit docs

Updated 2026-05-25. Bump expectations only after intentional data-vintage
advances (e.g. HUD's 2026 QCT list publishes — adjust QCT count expectation).

_No documented symbols — module has a file-header comment only._
