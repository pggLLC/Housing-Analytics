# `scripts/build_rent_burden_crosscheck.mjs`

F207b — Build the CHAS rent-burden crosscheck JSON.

Phase C of the CHAS reliability spec. Fetches ACS B25070 detailed
tables (5-year 2018–2022 + 1-year 2023) for every CO geography we
have CHAS data for, computes rates + MOE per the Census proportion
formula, and cross-references against the existing CHAS county and
place data. The output drives js/rent-burden-reliability.js.

Per the spec's QA review (Claude 2026-06-09):
  - ACS 5-year MUST match CHAS vintage (2018-2022) — definitional
    check, NOT a freshness check
  - ACS 1-year is the only genuinely newer source. For sub-65k
    geographies, falls back to containing county → state with a
    clear isProxy + proxyKind flag
  - MOE propagation via root-sum-of-squares (component cells) and
    the Census proportion formula (with RATIO fallback when the
    radicand goes negative)

Usage:
  CENSUS_API_KEY=xxx node scripts/build_rent_burden_crosscheck.mjs
  CENSUS_API_KEY=xxx node scripts/build_rent_burden_crosscheck.mjs --dry

Output: data/processed/rent_burden_crosscheck.json

_No documented symbols — module has a file-header comment only._
