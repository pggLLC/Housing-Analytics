# `scripts/augment_ranking_index_recency.mjs`

F179 — Augment ranking-index.json with LIHTC recency fields.

Adds per-jurisdiction:
  - latest_lihtc_year   (CHFA AwardYear or YR_PIS, whichever is highest)
  - lihtc_project_count (count of CHFA LIHTC projects matching this jurisdiction)
  - r1_2026_count       (2026 R1 bridge awards in this jurisdiction)
  - drought_years       (CURRENT_YEAR - latest_lihtc_year, null if never funded)
  - recency_score       (F146 formula: min(100, drought × 25); 100 means
                         "never funded on record", treated as max opportunity)
  - recency_basis       ('award_year' | 'pis_year' | 'r1_bridge' | 'never_funded')

Matches CHFA records to jurisdictions by uppercased city name against
the entry's `name` field (stripping common LSAD suffixes — "city",
"town", "CDP"). This is the same matching logic compare.js + the OF
use at runtime, just persisted so consumers don't recompute.

Idempotent — re-running with the same input data produces the same
output; safe to re-run after a CHFA feed refresh.

Usage:
  node scripts/augment_ranking_index_recency.mjs           (writes back)
  node scripts/augment_ranking_index_recency.mjs --dry     (preview, no write)

_No documented symbols — module has a file-header comment only._
