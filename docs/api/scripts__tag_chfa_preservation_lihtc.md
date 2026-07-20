# `scripts/tag_chfa_preservation_lihtc.mjs`

F184 — Tag CHFA preservation records as LIHTC across the affordable-
housing data layer.

Root cause (discovered via the Prairie Run case): when CHFA's
PreservationProperties_Layer feed gets ingested into
properties.json, the lihtc-* tag is not preserved. So 800+ LIHTC
properties (Francis Heights, Gateway Village, Quigg Newton, DHA
Dispersed Housing, etc.) appear ONLY as preservation-candidate,
invisible to:
  - HNA LIHTC list (F174 keeps only lihtc-* records)
  - OF LIHTC map
  - Compare's LIHTC project count
  - ranking-index.json's lihtc_project_count + latest_lihtc_year

High confidence: CHFA preservation source means CHFA tracks the
property's affordability covenant — almost always LIHTC compliance.
154 HUD-MF-only records are excluded (those are Section 8 or 202/811
with no LIHTC layer).

What this does:
  1. data/affordable-housing/properties.json — for every record
     sourced from "CHFA PreservationProperties" but lacking a
     lihtc-* tag, add `lihtc-unknown` to program_type. We tag as
     "unknown" rather than 9pct/4pct because we don't have the
     credit type from the preservation feed; consumers that need
     9% vs 4% specificity can still look up the property in the
     live CHFA portal.
  2. data/affordable-housing/lihtc/chfa-properties.json — mirror
     these records as Feature entries so the OF map shows them.
  3. data/chfa-lihtc.json — same mirror, since that's the per-
     county source the HNA controller fetches.

Idempotent. Re-running adds nothing new for records already tagged.
Year fields stay null where unknown — script never fabricates a
YR_PIS or AwardYear.

_No documented symbols — module has a file-header comment only._
