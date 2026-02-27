#!/usr/bin/env node
/**
 * fetch_kalshi_prediction_markets.js
 * Fetches housing-related prediction market data from Kalshi and writes
 * data/kalshi/prediction-market.json for use by the Economic Dashboard.
 *
 * Authentication uses RSA-SHA256 request signing (Kalshi REST API v2).
 * Credentials are read from environment variables — never hard-code secrets.
 *
 * Required env vars (set via GitHub Actions secrets or a local .env):
 *   KALSHI_API_KEY        — Kalshi access-key ID
 *   KALSHI_API_SECRET     — RSA private key in PEM format
 *
 * Optional env vars:
 *   KALSHI_API_BASE_URL   — defaults to https://trading-api.kalshi.com
 *
 * Local usage (dry-run without credentials — writes empty items fallback):
 *   node scripts/kalshi/fetch_kalshi_prediction_markets.js
 *
 * Local usage with credentials:
 *   KALSHI_API_KEY=<key> KALSHI_API_SECRET="$(cat private_key.pem)" \
 *     node scripts/kalshi/fetch_kalshi_prediction_markets.js
 *
 * Output schema (data/kalshi/prediction-market.json):
 * {
 *   "updated": "ISO-8601 UTC",
 *   "source": "kalshi",
 *   "items": [ { metric, label, horizon, market:{id,title,url}, outcomes:[{name,prob}] } ]
 * }
 * On API failure the file is written with "error" and empty "items" so the
 * dashboard can fall back gracefully to its built-in mock data.
 */

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
 * @typedef {Object} MetricConfig
 * @property {string}      metric        — stable camelCase key used in JSON output
 * @property {string}      label         — human-readable label for the UI
 * @property {string}      horizon       — description of the time horizon
 * @property {string|null} seriesTicker  — Kalshi series ticker (e.g. "KXMORTGAGE30")
 * @property {string|null} eventTicker   — Kalshi event ticker (overrides seriesTicker search)
 * @property {string[]}    keywords      — fallback keyword search terms
 */
const MARKET_CONFIG = [
  {
    metric:       'home_price_growth',
    label:        'National Home Price Growth (YoY)',
    horizon:      'year_end',
    seriesTicker: null,           // Fill in once ticker is confirmed, e.g. "KXHOMEPRICE"
    eventTicker:  null,
    keywords:     ['home price', 'house price', 'HPI', 'Case-Shiller'],
  },
  {
    metric:       '30yr_mortgage_rate',
    label:        '30-Year Mortgage Rate',
    horizon:      'year_end',
    seriesTicker: null,           // Fill in once ticker is confirmed, e.g. "KXMORTGAGE30"
    eventTicker:  null,
    keywords:     ['mortgage rate', '30-year mortgage', '30yr mortgage'],
  },
  {
    metric:       'housing_starts',
    label:        'Total Housing Starts (Annualized)',
    horizon:      'year_end',
    seriesTicker: null,
    eventTicker:  null,
    keywords:     ['housing starts', 'new home construction'],
  },
  {
    metric:       'rent_growth',
    label:        'National Rent Growth (YoY)',
    horizon:      'year_end',
    seriesTicker: null,
    eventTicker:  null,
    keywords:     ['rent growth', 'rental price', 'rent index'],
  },
  {
    metric:       'multifamily_permits',
    label:        'Multifamily Permits / Starts',
    horizon:      'year_end',
    seriesTicker: null,
    eventTicker:  null,
    keywords:     ['multifamily', 'apartment starts', 'building permits'],
  },
];

const BASE_URL    = (process.env.KALSHI_API_BASE_URL || 'https://trading-api.kalshi.com').replace(/\/$/, '');
const API_KEY     = (process.env.KALSHI_API_KEY     || '').trim();
const API_SECRET  = (process.env.KALSHI_API_SECRET  || '').trim();
const API_PATH    = '/trade-api/v2';

const OUTPUT_DIR  = path.resolve(__dirname, '..', '..', 'data', 'kalshi');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'prediction-market.json');

// ---------------------------------------------------------------------------
// Kalshi RSA-SHA256 request signing
// ---------------------------------------------------------------------------

/**
 * Build the Authorization headers for a Kalshi REST API request.
 * @param {string} method  — HTTP verb (GET, POST, …)
 * @param {string} apiPath — Path including query string, e.g. "/trade-api/v2/markets?status=open"
 * @returns {Object} headers to merge into the request
 */
function kalshiAuthHeaders(method, apiPath) {
  if (!API_KEY || !API_SECRET) return {};
  const ts      = Date.now().toString();
  const message = `${ts}${method.toUpperCase()}${apiPath}`;
  let signature;
  try {
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(message);
    signature = sign.sign(API_SECRET, 'base64');
  } catch (err) {
    // Key may be in raw base64 rather than PEM; try wrapping it.
    try {
      const pem = API_SECRET.includes('-----')
        ? API_SECRET
        : `-----BEGIN RSA PRIVATE KEY-----\n${API_SECRET}\n-----END RSA PRIVATE KEY-----`;
      const sign2 = crypto.createSign('RSA-SHA256');
      sign2.update(message);
      signature = sign2.sign(pem, 'base64');
    } catch (err2) {
      throw new Error(`Failed to sign Kalshi request: ${err2.message}`);
    }
  }
  return {
    'KALSHI-ACCESS-KEY':       API_KEY,
    'KALSHI-ACCESS-TIMESTAMP': ts,
    'KALSHI-ACCESS-SIGNATURE': signature,
  };
}

// ---------------------------------------------------------------------------
// HTTP helper (native Node https — no extra deps)
// ---------------------------------------------------------------------------

/**
 * Perform a GET request and return parsed JSON.
 * @param {string} url — full URL
 * @param {Object} [extraHeaders]
 * @returns {Promise<any>}
 */
function httpGet(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || 443,
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers: {
        'Accept':     'application/json',
        'User-Agent': 'HousingAnalytics-KalshiSync/1.0',
        ...extraHeaders,
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error(`JSON parse error: ${e.message} — body: ${body.slice(0, 200)}`));
        }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Kalshi API helpers
// ---------------------------------------------------------------------------

/**
 * Fetch markets matching a series ticker or event ticker.
 * @param {MetricConfig} cfg
 * @returns {Promise<Object[]>} array of Kalshi market objects
 */
async function fetchMarketsForMetric(cfg) {
  // Prefer explicit eventTicker lookup
  if (cfg.eventTicker) {
    const apiPath = `${API_PATH}/events/${encodeURIComponent(cfg.eventTicker)}`;
    const url     = `${BASE_URL}${apiPath}`;
    const auth    = kalshiAuthHeaders('GET', apiPath);
    const data    = await httpGet(url, auth);
    const markets = data.event && data.event.markets ? data.event.markets : [];
    return markets;
  }

  // Use series ticker to list markets
  if (cfg.seriesTicker) {
    const qs      = new URLSearchParams({ series_ticker: cfg.seriesTicker, status: 'open', limit: '20' });
    const apiPath = `${API_PATH}/markets?${qs}`;
    const url     = `${BASE_URL}${apiPath}`;
    const auth    = kalshiAuthHeaders('GET', apiPath);
    const data    = await httpGet(url, auth);
    return data.markets || [];
  }

  // Keyword fallback: search open markets and filter by title/ticker
  for (const keyword of cfg.keywords) {
    const qs      = new URLSearchParams({ status: 'open', limit: '50' });
    const apiPath = `${API_PATH}/markets?${qs}`;
    const url     = `${BASE_URL}${apiPath}`;
    const auth    = kalshiAuthHeaders('GET', apiPath);
    let data;
    try {
      data = await httpGet(url, auth);
    } catch (e) {
      continue;
    }
    const matches = (data.markets || []).filter(m =>
      (m.title || '').toLowerCase().includes(keyword.toLowerCase()) ||
      (m.ticker || '').toLowerCase().includes(keyword.toLowerCase())
    );
    if (matches.length > 0) return matches;
  }

  return [];
}

/**
 * Convert raw Kalshi market objects into the normalized output schema.
 * @param {MetricConfig} cfg
 * @param {Object[]} markets
 * @returns {Object}
 */
function normalizeMarket(cfg, markets) {
  if (!markets.length) return null;

  // Pick the first market with the most liquidity / volume
  const market = markets.reduce((best, m) => {
    const vol = (m.volume || 0) + (m.open_interest || 0);
    const bestVol = (best.volume || 0) + (best.open_interest || 0);
    return vol > bestVol ? m : best;
  }, markets[0]);

  // Build outcomes from yes_bid / no_bid or yes_ask / no_ask probabilities
  const yesProb = market.yes_bid != null
    ? market.yes_bid / 100
    : market.last_price != null
      ? market.last_price / 100
      : null;

  let outcomes = [];
  if (yesProb != null) {
    outcomes = [
      { name: 'Yes', prob: Math.round(yesProb * 100) / 100 },
      { name: 'No',  prob: Math.round((1 - yesProb) * 100) / 100 },
    ];
  }

  // For multi-outcome markets, use yes_bid per contract as the probability
  // (each contract in a mutually-exclusive set sums to ~1)
  if (markets.length > 1) {
    let total = 0;
    const raw = markets.map(m => {
      const rawPrice = m.yes_bid != null ? m.yes_bid : (m.last_price || 0);
      total += rawPrice;
      return { name: m.title || m.ticker || '?', rawP: rawPrice };
    });
    // Normalise so probabilities sum to 1
    outcomes = total > 0
      ? raw.map(r => ({ name: r.name, prob: Math.round((r.rawP / total) * 100) / 100 }))
      : raw.map(r => ({ name: r.name, prob: 0 }));
  }

  return {
    metric:   cfg.metric,
    label:    cfg.label,
    horizon:  cfg.horizon,
    market: {
      id:    market.ticker || market.id || '',
      title: market.title || '',
      url:   market.ticker
        ? `https://kalshi.com/markets/${market.ticker}`
        : `https://kalshi.com`,
    },
    outcomes,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  const updated = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Guard: if no credentials, write an empty-items file and exit cleanly.
  // The dashboard will fall back to its built-in mock data.
  if (!API_KEY || !API_SECRET) {
    console.warn(
      'KALSHI_API_KEY and/or KALSHI_API_SECRET are not set.\n' +
      'Writing empty prediction-market.json — dashboard will use mock data.\n' +
      'To enable live data, add KALSHI_API_KEY and KALSHI_API_SECRET as\n' +
      'GitHub Actions secrets (Settings → Secrets and variables → Actions).'
    );
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
      updated,
      source: 'kalshi',
      error:  'Credentials not configured. Set KALSHI_API_KEY and KALSHI_API_SECRET.',
      items:  [],
    }, null, 2), 'utf8');
    process.exit(0);
  }

  console.log(`Fetching Kalshi housing prediction markets from ${BASE_URL} …`);

  const items = [];

  for (const cfg of MARKET_CONFIG) {
    process.stdout.write(`  [${cfg.metric}] `);
    try {
      const markets    = await fetchMarketsForMetric(cfg);
      const normalized = normalizeMarket(cfg, markets);
      if (normalized) {
        items.push(normalized);
        console.log(`✓  ${markets.length} market(s) found`);
      } else {
        console.log('— no matching open markets found (skipped)');
      }
    } catch (err) {
      console.warn(`✗  ${err.message}`);
    }
  }

  const output = { updated, source: 'kalshi', items };

  if (!items.length) {
    output.error = 'No matching Kalshi markets found. Dashboard will display mock data.';
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nWrote ${OUTPUT_FILE} (${items.length} item(s)).`);
})();
