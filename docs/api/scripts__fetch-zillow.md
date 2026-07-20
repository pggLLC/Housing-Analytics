# `scripts/fetch-zillow.js`

fetch-zillow.js
Puppeteer script to scrape Zillow Research data and save as JSON.

Credentials are read from environment variables ZILLOW_EMAIL and
ZILLOW_PASSWORD (set via GitHub Secrets in CI, or a local .env file
for manual testing).

## Symbols

### `downloadUrl(url, maxRetries = 3)`

Download a URL to a temporary buffer and return the raw string content.
Retries up to maxRetries times with exponential backoff on 429/403/5xx errors.

### `parseCsv(csvText)`

Parse CSV text and return an array of plain objects.

### `filterColorado(rows)`

Filter rows to Colorado metros / counties only.

### `saveJson(key, payload)`

Write JSON to data/zillow-<key>.json

### `loadCache(key)`

Attempt to load a cached JSON file so the workflow can fall back gracefully.
