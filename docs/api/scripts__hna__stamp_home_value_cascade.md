# `scripts/hna/stamp_home_value_cascade.mjs`

Re-stamp HNA summary files with committed median home value cascade values.

This is the CI-safe companion to build_home_value_cascade.mjs. It does not
need the gitignored Zillow CSV; it treats data/hna/home-value-cascade.json
as the source of truth and restores acsProfile.median_home_value after an
ACS summary refresh.

_No documented symbols — module has a file-header comment only._
