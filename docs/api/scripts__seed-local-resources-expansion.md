# `scripts/seed-local-resources-expansion.js`

seed-local-resources-expansion.js — F136
=========================================
Bulk-seeds local-resources.json with curated school district,
hospital, and major-employer data for ~50 Colorado places that
currently fall back to generic search.

Approach:
  - For each (correct, validated) place GEOID, ensure an entry exists
    with at minimum a stub housingLead (search) + curated institutions.
  - Idempotent: re-running on already-seeded entries is a no-op.
  - Backfill only — if a field already exists, don't overwrite.

Run: node scripts/seed-local-resources-expansion.js
Verify: npm run validate:rosters

_No documented symbols — module has a file-header comment only._
