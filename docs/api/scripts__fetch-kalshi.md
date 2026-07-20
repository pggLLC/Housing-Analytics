# `scripts/fetch-kalshi.js`

fetch-kalshi.js
Entry-point wrapper for the Kalshi prediction market data fetch.
Delegates all logic to scripts/kalshi/fetch_kalshi_prediction_markets.js.

Usage (dry-run without credentials — writes empty items fallback):
  node scripts/fetch-kalshi.js

Usage with credentials:
  KALSHI_API_KEY=<key_id> KALSHI_API_SECRET="$(cat private_key.pem)" \
    node scripts/fetch-kalshi.js

See scripts/kalshi/fetch_kalshi_prediction_markets.js for full documentation.

_No documented symbols — module has a file-header comment only._
