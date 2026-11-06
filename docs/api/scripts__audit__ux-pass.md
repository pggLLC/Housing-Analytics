# `scripts/audit/ux-pass.mjs`

scripts/audit/ux-pass.mjs — the usability benchmark as a repeatable check.

Opens the pages a newcomer walks through at phone width (390 x 844), served
the way GitHub Pages serves them, and measures what makes a first visit hard:

  budgeted (fails the run when over scripts/audit/ux-budget.json)
    - DOM nodes after the page's data has loaded
    - main-thread blocking: the sum of every long task beyond 50 ms
    - exactly one <h1>
    - per page, that its data actually rendered (`ready`), and the same
      limits after pressing a control a reader would press (`click`)
  reported as rough signals (never fail, and never a substitute for
  testing whether real readers understand the page)
    - reading grade of the page's prose (Flesch-Kincaid)
    - capitalised abbreviations in the first screen; professional terms
      are fine for this site's audience, but each should be explained once
    - length in phone screens
  with --lighthouse, also Lighthouse mobile performance and accessibility
  scores for each page (report only: performance scores swing between runs).
  CHROME_PATH overrides the browser Lighthouse launches.

Why these: on 2026-10-15 the benchmark of this site against 11 comparable
sites (site-flow review) found step 3 drawing ~51,000 DOM nodes and blocking
a phone for ~18 s, reading grades of 9-14 against a target of 8, and
abbreviations on every first screen. Nothing in CI measured any of it.

Output: a Markdown table on stdout, appended to $GITHUB_STEP_SUMMARY when
set, and data written to the path given by --out (nothing is committed).

Usage:
  npm run audit:ux
  node scripts/audit/ux-pass.mjs --page index.html
  node scripts/audit/ux-pass.mjs --lighthouse --out ux-pass.json

_No documented symbols — module has a file-header comment only._
