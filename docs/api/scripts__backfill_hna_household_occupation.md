# `scripts/backfill_hna_household_occupation.mjs`

F169 — Backfill ACS DP02 / DP03 / DP05 variables that power the new
"Household composition, occupation & labor force" panel on the HNA page.

Mirrors scripts/backfill_dp04_value_brackets.mjs in shape so the same
concurrency + retry behavior applies. Reads every cached summary at
data/hna/summary/*.json, fetches the new variables from ACS 5-year
profile endpoint, and merges them into acsProfile (no other fields
touched). Idempotent — already-filled summaries (DP02_0014E present)
are skipped.

Usage:
  CENSUS_API_KEY=xxxxxx node scripts/backfill_hna_household_occupation.mjs
  CENSUS_API_KEY=xxxxxx node scripts/backfill_hna_household_occupation.mjs --dry

_No documented symbols — module has a file-header comment only._
