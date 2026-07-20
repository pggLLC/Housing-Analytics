# `scripts/validate-schemas.js`

scripts/validate-schemas.js

Validates critical data artifacts against their JSON Schemas using a
lightweight built-in validator (no npm dependencies required).

Checks implemented:
  - Required top-level keys are present (sentinel keys per Rule 18)
  - Correct data types for critical fields
  - FIPS codes are 5-digit strings (Rule 1)
  - Required numeric fields are non-null (Rule 2)
  - FRED series have non-empty name and at least one observation (Rule 6/7)
  - County coverage is exactly 64 for AMI gap file (Rule 4)

Usage:
  node scripts/validate-schemas.js

Exit code 0 = all validations passed; 1 = one or more failures.

_No documented symbols — module has a file-header comment only._
