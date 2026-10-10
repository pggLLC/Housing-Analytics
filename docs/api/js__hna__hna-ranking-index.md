# `js/hna/hna-ranking-index.js`

js/hna/hna-ranking-index.js
HNA Comparative Ranking Page — data loading, sort, filter, search, export.

Exposes: window.HNARanking
Dependencies: js/fetch-helper.js (window.fetchWithTimeout or fetch)
             js/utils/data-quality.js (window.DataQuality)

## Symbols

### `LOW_EVIDENCE_MULTIPLIER`

Same threshold as the digest builder's confidenceFromMultiplier: < 0.90 → low.
