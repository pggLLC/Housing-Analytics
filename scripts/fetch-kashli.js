#!/usr/bin/env node
/**
 * fetch-kashli.js
 * Fetches Colorado housing market data from the Kashli API and saves it as
 * data/kashli-market-data.json for use by the front-end dashboards.
 *
 * The API key is read from the KASHLI_API_KEY environment variable (set via
 * GitHub Secrets in CI, or a local .env file for manual testing).
 *
 * Kashli API docs: https://kashli.com/api
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const KASHLI_BASE_URL = 'api.kashli.com';
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const OUTPUT_FILE = path.join(DATA_DIR, 'kashli-market-data.json');

// Colorado market slugs / identifiers to pull from Kashli
const MARKETS = [
  { id: 'denver-co',          label: 'Denver Metro' },
  { id: 'colorado-springs-co', label: 'Colorado Springs' },
  { id: 'boulder-co',          label: 'Boulder' },
  { id: 'fort-collins-co',     label: 'Fort Collins' },
  { id: 'aurora-co',           label: 'Aurora' },
  { id: 'pueblo-co',           label: 'Pueblo' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Make an HTTPS GET request to the Kashli API and return parsed JSON.
 * @param {string} pathname  — e.g. "/v1/market/denver-co"
 * @param {string} apiKey
 * @param {number} [retries=3]
 * @returns {Promise<object>}
 */
function kashliGet(pathname, apiKey, retries = 3) {
  const options = {
    hostname: KASHLI_BASE_URL,
    path: pathname,
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'User-Agent': 'HousingAnalytics-DataSync/1.0',
    },
  };

  function attempt(remaining) {
    return new Promise((resolve, reject) => {
      const req = https.request(options, (res) => {
        if (res.statusCode === 429 || (res.statusCode >= 500 && res.statusCode < 600)) {
          res.resume();
          if (remaining > 0) {
            const delay = Math.pow(2, 3 - remaining) * 1000;
            console.warn(`  HTTP ${res.statusCode} — retrying in ${delay / 1000}s…`);
            return setTimeout(() => attempt(remaining - 1).then(resolve, reject), delay);
          }
          return reject(new Error(`HTTP ${res.statusCode} for ${pathname}`));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${pathname}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (e) {
            reject(new Error(`JSON parse error for ${pathname}: ${e.message}`));
          }
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end();
    });
  }

  return attempt(retries);
}

/**
 * Load an existing cache file so the workflow can fall back gracefully.
 */
function loadCache() {
  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
    } catch (_) { /* corrupted — ignore */ }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  const apiKey = (process.env.KASHLI_API_KEY || '').trim();

  if (!apiKey) {
    console.error(
      'ERROR: KASHLI_API_KEY environment variable is not set.\n' +
      'Add it in GitHub repo settings: Settings → Secrets and variables → Actions.'
    );
    process.exit(1);
  }

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  console.log(`Fetching Kashli market data for ${MARKETS.length} Colorado markets…`);

  const results = {};

  for (const market of MARKETS) {
    process.stdout.write(`  ${market.label} (${market.id})… `);
    try {
      const data = await kashliGet(`/v1/market/${market.id}`, apiKey);
      results[market.id] = {
        label: market.label,
        ...data,
      };
      console.log('✓');
    } catch (err) {
      console.warn(`✗ ${err.message}`);
      // Preserve last-known value from cache if available
      const cached = loadCache();
      if (cached && cached.markets && cached.markets[market.id]) {
        results[market.id] = cached.markets[market.id];
        console.warn(`    Using cached data for ${market.label}.`);
      }
    }
  }

  const payload = {
    source: 'Kashli API',
    sourceUrl: `https://${KASHLI_BASE_URL}`,
    fetchedAt: new Date().toISOString(),
    markets: results,
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\nWrote ${OUTPUT_FILE} (${MARKETS.length} market(s)).`);
})();
