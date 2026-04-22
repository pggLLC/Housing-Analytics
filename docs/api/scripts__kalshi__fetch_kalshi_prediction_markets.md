# `scripts/kalshi/fetch_kalshi_prediction_markets.js`

## Symbols

### `MARKET_CONFIG`

fetch_kalshi_prediction_markets.js
Fetches housing-related prediction market data from Kalshi and writes
data/kalshi/prediction-market.json for use by the Economic Dashboard.

Authentication uses RSA-SHA256 request signing (Kalshi REST API v2).
Credentials are read from environment variables — never hard-code secrets.

Required env vars (set via GitHub Actions secrets or a local .env):
  KALSHI_API_KEY        — Kalshi access-key ID
  KALSHI_API_SECRET     — RSA private key in PEM format

Optional env vars:
  KALSHI_API_BASE_URL   — defaults to https://trading-api.kalshi.com

Local usage (dry-run without credentials — writes empty items fallback):
  node scripts/kalshi/fetch_kalshi_prediction_markets.js

Local usage with credentials:
  KALSHI_API_KEY=<key> KALSHI_API_SECRET="$(cat private_key.pem)" \
    node scripts/kalshi/fetch_kalshi_prediction_markets.js

Output schema (data/kalshi/prediction-market.json):
{
  "updated": "ISO-8601 UTC",
  "source": "kalshi",
  "items": [ { metric, label, horizon, market:{id,title,url}, outcomes:[{name,prob}] } ]
}
On API failure the file is written with "error" and empty "items" so the
dashboard can fall back gracefully to its built-in mock data.
/

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const https  = require('https');

// ---------------------------------------------------------------------------
// Configuration — fill in series_ticker / event_ticker values once known.
// The `seriesTicker` or `eventTicker` field is used to search Kalshi markets.
// Leave a field null to skip that metric; the script will warn but continue.
// ---------------------------------------------------------------------------

/**
@typedef {Object} MetricConfig
@property {string}      metric        — stable camelCase key used in JSON output
@property {string}      label         — human-readable label for the UI
@property {string}      horizon       — description of the time horizon
@property {string|null} seriesTicker  — Kalshi series ticker (e.g. "KXMORTGAGE30")
@property {string|null} eventTicker   — Kalshi event ticker (overrides seriesTicker search)
@property {string[]}    keywords      — fallback keyword search terms

### `kalshiAuthHeaders(method, apiPath)`

Build the Authorization headers for a Kalshi REST API request.
@param {string} method  — HTTP verb (GET, POST, …)
@param {string} apiPath — Path including query string, e.g. "/trade-api/v2/markets?status=open"
@returns {Object} headers to merge into the request

### `httpGet(url, extraHeaders = {})`

Perform a GET request and return parsed JSON.
@param {string} url — full URL
@param {Object} [extraHeaders]
@returns {Promise<any>}

### `fetchMarketsForMetric(cfg)`

Fetch markets matching a series ticker or event ticker.
@param {MetricConfig} cfg
@returns {Promise<Object[]>} array of Kalshi market objects

### `normalizeMarket(cfg, markets)`

Convert raw Kalshi market objects into the normalized output schema.
@param {MetricConfig} cfg
@param {Object[]} markets
@returns {Object}
