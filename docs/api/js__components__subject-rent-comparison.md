# `js/components/subject-rent-comparison.js`

js/components/subject-rent-comparison.js
===============================================================
Per-AMI-tier rent comparison card. Reads the Subject Project's
unit_mix and computes, for each row:

  • LIHTC max gross rent  (from county MTSP income limits)
  • LIHTC max net rent    (gross − utility allowance)
  • Proposed gross rent   (as entered)
  • Headroom              (max − proposed) — negative means OVER MAX
  • Rent advantage vs HUD FMR  (proposed − FMR for matching bedroom)
    — only available where FMR is published (Eff/1BR/2BR/3BR/4BR).

The "rent advantage" surfaces whether the LIHTC-restricted rent is
meaningfully below market — the headline finding in any CHFA-graded
market study. Negative % = below FMR = market-achievable.

Mount target: any container with id="subjectRentComparisonMount".
Refreshes automatically when SubjectProject.subscribe fires.

_No documented symbols — module has a file-header comment only._
