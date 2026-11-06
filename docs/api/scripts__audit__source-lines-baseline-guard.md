# `scripts/audit/source-lines-baseline-guard.mjs`

source-lines-baseline-guard.mjs
The source-lines baseline may only go down. `source-lines-ratchet.mjs
--update` writes whatever the page shows today, so without this check a PR
could add unsourced figures, run --update, and pass.

Compares scripts/audit/source-lines-baseline.json with the base branch's
copy (passed as a path; Site Audit writes it from `git show`) and fails when:
  - a page's unsourced or undated total went up,
  - a page enters the baseline with any misses,
  - an area that exists in both went up.
A new area key with misses passes only as a rename: it must pair with an
area that left the baseline carrying at least as many misses (a same-kind
box inserted ahead of an id-less one renumbers it). Fixing misses in an
area that stays does not pay for a new unsourced card.

Usage: node scripts/audit/source-lines-baseline-guard.mjs <base-baseline.json>

_No documented symbols — module has a file-header comment only._
