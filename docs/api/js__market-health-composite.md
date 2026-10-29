# `js/market-health-composite.js`

market-health-composite.js

Computes a per-county "Market Health" composite index (0-100) by
blending 5 normalized signals already on disk:

  1. Job growth 5y (BLS QCEW)            — higher = stronger demand
  2. Population growth 5y (ACS/DOLA)     — higher = stronger demand
  3. Inverse unemployment (BLS LAUS)     — lower unemp = stronger
  4. Mortgage originations per 1,000 households (HMDA ÷ ACS households)
     — higher = healthier credit. A raw count would rank counties by size.
  5. Inverse denial rate (HMDA)          — lower denial = healthier

Output: 0-100 composite where higher = stronger market.
Renders into #marketHealthComposite as a sorted county table.

Why this matters (per Phase 3 / C4)
-----------------------------------
Investor "where's the market heat?" question gets a single answer
blending labor, demographics, and credit signals — pairs with the
Affordability Metrics panel (C1) for a complete market-positioning
read.

## Symbols

### `_origPer1k(hmdaRec, name)`

HMDA originations per 1,000 ACS households; null when either is missing.

### `computeAll()`

Compute composite scores for all counties. Returns sorted array.
