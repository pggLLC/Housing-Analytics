# `js/market-data-quality.js`

js/market-data-quality.js
Data validation, freshness checking, and confidence scoring for the PMA tool.

Responsibilities:
 - validateMarketData(acs, lihtc, centroids) — completeness check
 - calculateDataQuality(acs, lihtc, centroids) — coverage metrics object
 - calculateConfidenceScore(coverage) — 0–1 confidence value
 - checkDataFreshness(generatedDate) — freshness status & color coding

Exposed as window.PMADataQuality.
Data loaded externally and passed in — no fetch() calls.

_No documented symbols — module has a file-header comment only._
