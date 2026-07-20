# `scripts/enrich_lihtc_award_year.mjs`

F188 — Enrich LIHTC records with CHFA's AwardYear / YR_ALLOC.

After F185, the 106 HUD-validated records carry HUD's YR_PIS (year
placed in service) but not CHFA's AwardYear (year credits were
reserved — typically 2-3y before PIS) or YR_ALLOC. Consumers that
care about competition timing (CHFA QAP rounds, opportunity scoring)
want the award/allocation year, not just PIS.

Strategy: for every LIHTC-tagged record in properties.json (~1,026),
look up the matching property in chfa-properties.json by normalized
project name + coordinate match within ~100m. Where matched, copy:
  - AwardYear → properties.json `award_year` (+ `latest_year` if newer)
  - YR_ALLOC  → properties.json `allocation_year`

Idempotent. Doesn't fabricate years — if CHFA's record also has
null AwardYear (true for manually-added Prairie Run + a few HUD-
mirrored entries), the field stays null.

Also re-runs the recency augmentation so ranking-index.json picks
up the enriched years.

_No documented symbols — module has a file-header comment only._
