# `scripts/validate-advocacy-roster.js`

validate-advocacy-roster.js — F129 guard
=========================================
Sanity-checks advocacy/nonprofit assignments in
data/hna/local-resources.json against a curated service-area roster.
Flags assignments where an org's name implies a region that doesn't
include the assigned jurisdiction.

The roster is intentionally CONSERVATIVE — it only encodes orgs whose
names contain unambiguous geographic markers (e.g. "of Metro Denver",
"of Colorado Springs", "Northwest Colorado", "Pikes Peak"). Statewide
orgs and orgs without geographic markers in their name are skipped.

Exit codes:
  0 — no issues, or warnings only
  1 — at least one definite mismatch found

Run:  node scripts/validate-advocacy-roster.js

_No documented symbols — module has a file-header comment only._
