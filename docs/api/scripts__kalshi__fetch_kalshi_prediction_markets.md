# `scripts/kalshi/fetch_kalshi_prediction_markets.js`

fetch_kalshi_prediction_markets.js
Fetches housing-related prediction market data from Kalshi and writes
data/kalshi/prediction-market.json for use by the Economic Dashboard.

Authentication uses RSA-SHA256 request signing (Kalshi REST API v2).
Credentials are read from environment variables — never hard-code secrets.

Required env vars (set via GitHub Actions secrets or a local .env):
  KALSHI_API_KEY        — Kalshi access-key ID
  KALSHI_API_SECRET     — RSA private key in PEM format

Optional env vars:
  KALSHI_API_BASE_URL   — defaults to https://api.elections.kalshi.com

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

## Symbols

### `MARKET_CONFIG`

@typedef {Object} MetricConfig
@property {string}      metric        — stable camelCase key used in JSON output
@property {string}      label         — human-readable label for the UI
@property {string}      horizon       — description of the time horizon
@property {string|null} seriesTicker  — Kalshi series ticker (e.g. "KXMORTGAGE30")
@property {string|null} eventTicker   — Kalshi event ticker (overrides seriesTicker search)
@property {string[]}    keywords      — fallback keyword search terms

### `normalizePem(raw)`

normalizePem — rebuild a PEM whose line breaks were lost.

Pasting a private key into a secrets field commonly flattens it onto one
line, and OpenSSL then fails with
  error:1E08010C:DECODER routines::unsupported
which names no cause and reads like an unsupported key type. It is purely a
formatting problem: the key material is intact, so re-wrap it rather than
leaving the operator to discover this by character count. (A PKCS#8 RSA-2048
key is 1704 characters with its newlines and 1676 without — exactly the
difference that produced this bug.)

Handles PKCS#1 ("BEGIN RSA PRIVATE KEY"), PKCS#8 ("BEGIN PRIVATE KEY"), and
a bare base64 body with no header at all.

@param {string} raw
@returns {string|null} a well-formed PEM, or null if it cannot be rebuilt

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
