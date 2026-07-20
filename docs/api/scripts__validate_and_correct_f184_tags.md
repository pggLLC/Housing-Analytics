# `scripts/validate_and_correct_f184_tags.mjs`

F185 — Validate + correct the F184 bulk LIHTC tagging.

F184 tagged 773 records as lihtc-unknown based on the assumption that
everything in CHFA's PreservationProperties feed must be LIHTC. That
was wrong. Cross-validation against HUD's LIHTC database
(data/market/hud_lihtc_co.geojson — the gold-standard registry):

  773 records tagged in F184
  106 confirmed in HUD LIHTC (real LIHTC with known YR_PIS + CREDIT)
  667 NOT in HUD LIHTC (uncertain — many tiny SRO / supportive / HUD-only)

The 667 uncertain records include 1-9 unit properties like "2851 Champa"
(2 units), "1241 Stuart Street Apartments" (1 unit), "1467 N Detroit St
- Empowerment Program" (4 units, supportive). These are subsidized
affordable housing — but not necessarily LIHTC.

This script:

1. data/affordable-housing/properties.json
   - For the 106 HUD-validated records: keep lihtc-unknown tag, copy
     YR_PIS + CREDIT + sponsor from HUD so they have real years.
     Upgrade the tag from lihtc-unknown to lihtc-9pct / lihtc-4pct /
     etc. based on HUD's CREDIT field.
   - For the 667 unverified: REMOVE lihtc-unknown tag. They stay
     preservation-candidate (CHFA's preservation tracking is still
     valid info; we just shouldn't claim LIHTC).

2. data/affordable-housing/lihtc/chfa-properties.json
   - Remove F184 mirrored features whose _source is
     F184_chfa_preservation_implied AND that aren't in HUD LIHTC.
   - For the 106 validated, replace with the actual HUD record
     (which has YR_PIS + CREDIT).

3. data/chfa-lihtc.json — same scrub.

4. Exempts the 2 manually-confirmed Prairie Run records (F183) —
   those were added with explicit user confirmation, not auto-tagged.

Idempotent. Re-running with the same input produces the same output.

_No documented symbols — module has a file-header comment only._
