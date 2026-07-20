# `scripts/stamp_lihtc_provenance.mjs`

F189 + F190 — Stamp LIHTC provenance + lock in F185 validation.

F189 (lock the gate, future-work item 1):
  Going forward, the canonical "is this record LIHTC?" decision is
  made here. The old F184 script (tag every CHFA preservation record
  as LIHTC) is intentionally not re-run; this script implements the
  F185-corrected logic as the standing rule:
    - in HUD LIHTC database          → tag + copy HUD's year + credit
    - in CHFA live feed              → already tagged (CHFA build sets this)
    - in 2026 R1 bridge file         → already tagged
    - manually confirmed             → already tagged
    - ONLY in CHFA preservation feed → NOT tagged (insufficient evidence)

F190 (data-quality badge, future-work item 2):
  Stamps each LIHTC-tagged record with `_lihtc_source` indicating
  provenance:
    'chfa-live'         — in CHFA HousingTaxCreditProperties_view
    'hud-validated'     — in HUD LIHTC database (F185 added these)
    'r1-bridge'         — 2026 R1 bridge (CHFA Award Report PDF)
    'manual-confirmed'  — added with explicit user/sponsor confirmation
    'chfa-preservation-plus-hud'  — in preservation feed AND HUD LIHTC

  Consumers (HNA list, OF list, Compare) read _lihtc_source to render
  a small "via CHFA live" / "via HUD validation" / etc. tag next to
  each row so users see the provenance at a glance.

Idempotent. Re-running with the same input produces the same output.

_No documented symbols — module has a file-header comment only._
