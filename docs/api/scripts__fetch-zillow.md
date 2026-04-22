# `scripts/fetch-zillow.js`

## Symbols

### `downloadUrl(url, maxRetries = 3)`

fetch-zillow.js
Puppeteer script to scrape Zillow Research data and save as JSON.

Credentials are read from environment variables ZILLOW_EMAIL and
ZILLOW_PASSWORD (set via GitHub Secrets in CI, or a local .env file
for manual testing).
/

'use strict';

const puppeteer = require('puppeteer');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const path = require('path');
const https = require('https');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ZILLOW_RESEARCH_URL = 'https://www.zillow.com/research/data/';

// Datasets to look for on the Zillow Research Data page.
// Each entry maps a friendly key to a substring that appears in the download
// link text or href so we can locate the correct anchor element.
const DATASET_CONFIG = [
  { key: 'zhvi',      label: 'ZHVI',      hrefContains: 'ZHVI' },
  { key: 'rent',      label: 'Rent Index', hrefContains: 'ZORI' },
  { key: 'inventory', label: 'Inventory',  hrefContains: 'inventory' },
  { key: 'forecast',  label: 'Forecast',   hrefContains: 'forecast' },
];

// Geo filters: only keep rows whose RegionName matches one of these strings
// (case-insensitive substring match).
const GEO_FILTERS = [
  'colorado',
  'denver',
  'boulder',
  'colorado springs',
  'fort collins',
  'aurora',
  'pueblo',
];

const DATA_DIR = path.resolve(__dirname, '..', 'data');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
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
