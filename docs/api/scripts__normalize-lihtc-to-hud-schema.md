# `scripts/normalize-lihtc-to-hud-schema.js`

scripts/normalize-lihtc-to-hud-schema.js

Rebuilds data/market/hud_lihtc_co.geojson as a normalized derivative of
data/chfa-lihtc.json, mapping CHFA field names to HUD-compatible names and
preserving all 716+ features so the PMA market-analysis tool always has the
most complete LIHTC picture available.

Run automatically by .github/workflows/fetch-chfa-lihtc.yml immediately
after the CHFA fetch step.  May also be run locally:
  node scripts/normalize-lihtc-to-hud-schema.js

Field mapping (CHFA → HUD-compatible):
  PROJECT    → PROJECT_NAME
  PROJ_CTY   → CITY
  N_UNITS    → TOTAL_UNITS
  YR_ALLOC   → YEAR_ALLOC
  CREDIT     → CREDIT_PCT
  LI_UNITS   → LI_UNITS   (unchanged)
  YR_PIS     → YR_PIS     (unchanged)
  CNTY_FIPS  → CNTY_FIPS  (unchanged)
  CNTY_NAME  → CNTY_NAME  (unchanged)
  STATEFP    → STATEFP    (unchanged)
  COUNTYFP   → COUNTYFP   (unchanged)
  QCT        → QCT        (unchanged)
  DDA        → DDA        (unchanged)

The output file retains both CHFA and HUD field names so legacy callers
that reference either schema continue to work without modification.
Sentinel metadata fields (fetchedAt, source, _metadata) are preserved
verbatim from the source file (Rule 18).

_No documented symbols — module has a file-header comment only._
