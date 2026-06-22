# `js/components/pma-vintage-strip.js`

js/components/pma-vintage-strip.js
===============================================================
Decorates every .pma-card[data-vintage] with a small "As of X"
strip beneath the card's <h2>. Brings PMA cards into freshness
parity with the jurisdiction-brief renderer.

Reads:
  data-vintage       e.g. "ACS 2020–2024 · HUD LIHTC 2023 · FRED 2024"
  data-source        e.g. "ACS 5-Year + HUD LIHTC DB + FRED + DOLA"
  data-source-url    optional canonical link
  data-source-type   "modeled" | "primary" | "derived"

Idempotent: never appends a duplicate strip.
Runs once on DOMContentLoaded + observes DOM mutations.

_No documented symbols — module has a file-header comment only._
