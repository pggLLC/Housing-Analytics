# `scripts/backfill_hna_extended_acs_cache.mjs`

Backfill extended ACS profile variables into data/hna/summary/*.json.

This keeps the browser's live Census profile request as a fallback only:
cached summaries get the home-value brackets, tenure-count supplements,
household composition, occupation, labor-force, race, ethnicity, education,
and income variables used by HNA extended panels.

Mirrors the batching shape in scripts/hna/build_hna_data.py. Census API key
is optional; set CENSUS_API_KEY when available for higher quota.

_No documented symbols — module has a file-header comment only._
