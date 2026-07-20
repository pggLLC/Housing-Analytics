# `scripts/fetch-pab-allocations.mjs`

fetch-pab-allocations.mjs  (F25, 2026-05-28)

Builds data/policy/pab-allocations.json — Colorado Private Activity Bond
(PAB) volume-cap DIRECT ALLOCATIONS to designated local issuers.

WHAT THIS IS
------------
Colorado's annual PAB volume cap (IRC §146) is split by C.R.S. §24-32-1701
et seq.:
  - 50% to statewide authorities (CHFA 48% + Ag Development 2%)
  - ~47% as DIRECT ALLOCATIONS to cities + counties large enough to clear a
    $1,000,000 minimum (≈ population ≥ 15,300 at the current per-capita rate)
  - ~3% retained by DOLA as the "Statewide Balance" pool

The direct allocation is purely per-capita: every designated local issuer
receives `localPerCapita × population`. Smaller jurisdictions receive $0
direct and instead draw from the Statewide Balance (administered by DOLA /
conduited through CHFA for 4% LIHTC deals).

IMPORTANT (relevance caveat surfaced in the UI): a jurisdiction's direct
allocation is NOT a hard ceiling on 4% bond deals there. Most CO 4% LIHTC
deals use CHFA's statewide pool, or the locality cedes/assigns its direct
allocation to CHFA. Local cap also frequently funds non-housing uses (IDBs,
mortgage credit certificates) or is relinquished by the Sept 15 deadline.
So this is a CAPACITY signal, not a deal gate.

COMPUTE + RECONCILE
-------------------
  1. Fetch DOLA's published table (authoritative assigned amounts).
  2. Compute the per-capita rate from the table (cap ÷ population).
  3. Validate every row reproduces that rate; flag population anomalies
     (the published table has at least one copy-paste population typo).
  4. Match each issuer name to the site's geoid (county FIPS or place GEOID)
     via data/hna/ranking-index.json.

SOURCE: https://doh.colorado.gov/PAB-Allocations-2025
Re-run: `node scripts/fetch-pab-allocations.mjs`  (or `--html <file>` to
parse a saved copy when DOLA blocks automated fetches with a 403).

_No documented symbols — module has a file-header comment only._
