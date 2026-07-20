# `scripts/validate-hna-lehd.js`

scripts/validate-hna-lehd.js

Validates all JSON files in data/hna/lehd/ to ensure:
  1. Each file contains valid JSON.
  2. Each file has the required base fields (countyFips, updated).
  3. WAC-enriched fields are present (annualEmployment, annualWages, yoyGrowth, industries).
  4. Warns (and exits 1) if more than half the files are missing WAC fields,
     indicating the data build workflow has not been run yet.

Usage:
  node scripts/validate-hna-lehd.js

Exit code 0 = all files valid and fully enriched.
Exit code 1 = invalid JSON, missing base fields, or majority of files lack WAC fields.

To regenerate enriched files run:
  python3 scripts/hna/build_hna_data.py

_No documented symbols — module has a file-header comment only._
