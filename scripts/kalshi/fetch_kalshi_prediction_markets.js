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
 *   KALSHI_API_BASE_URL   — defaults to https://api.elections.kalshi.com
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
// Configuration. Each series ticker was checked against the live Kalshi API
// on 2026-10-18 (KXHOMEPRICE and KXMORTGAGE30, used before, do not exist).
// The `seriesTicker` or `eventTicker` field is used to search Kalshi markets.
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} MetricConfig
 * @property {string}      metric        — stable camelCase key used in JSON output
 * @property {string}      label         — human-readable label for the UI
 * @property {string}      horizon       — description of the time horizon
 * @property {string|null} seriesTicker  — Kalshi series ticker (e.g. "KXMORTGAGERATE")
 * @property {string|null} eventTicker   — Kalshi event ticker (overrides seriesTicker search)
 * @property {string[]}    keywords      — fallback keyword search terms
 * @property {string}      [note]        — one line under the label saying how to read the line
 */
const MARKET_CONFIG = [
  // Colorado first: the only prediction markets on Colorado housing itself.
  {
    metric:       'colorado_home_prices',
    label:        'Colorado home price index, Q4 2026 (FHFA)',
    horizon:      'quarter',
    // FHFA seasonally adjusted purchase-only index for Colorado.
    seriesTicker: 'KXCOHPIYOY',
    note:         'Kalshi compares the Q4 2026 index with Q4 2025, and the line sits near the end-2025 level, so its price reads as the odds Colorado home prices finish 2026 higher than a year earlier.',
    eventTicker:  null,
    keywords:     [],
  },
  {
    metric:       'colorado_building_permits',
    label:        'Colorado homes permitted in 2026 (Census)',
    horizon:      'year_end',
    // Census Building Permits Survey: units authorized in Colorado.
    seriesTicker: 'KXCOBUILDPERMITS',
    eventTicker:  null,
    keywords:     [],
  },
  {
    metric:       '30yr_mortgage_rate',
    label:        '30-year mortgage rate, high for the year (Freddie Mac)',
    horizon:      'year_end',
    // Freddie Mac PMMS weekly rate (FRED MORTGAGE30US). One event per
    // calendar year; the busiest one is shown.
    seriesTicker: 'KXMORTGAGERATE',
    eventTicker:  null,
    keywords:     [],
  },
  {
    metric:       'housing_starts',
    label:        'US housing starts, monthly (Census)',
    horizon:      'month',
    // Census new residential construction (FRED HOUST), annualized.
    seriesTicker: 'KXHOUSINGSTART',
    eventTicker:  null,
    keywords:     [],
  },
  {
    metric:       'building_permits',
    label:        'US building permits, monthly (Census)',
    horizon:      'month',
    // Census building permits, all units (FRED PERMIT), annualized.
    seriesTicker: 'KXBUILDPERMS',
    eventTicker:  null,
    keywords:     [],
  },
  {
    metric:       'existing_home_price',
    label:        'US median existing-home price, monthly (NAR)',
    horizon:      'month',
    // NAR median sales price of existing homes (FRED HOSMEDUSM052N).
    seriesTicker: 'KXEXUSHOME',
    eventTicker:  null,
    keywords:     [],
  },
  {
    metric:       'owners_equivalent_rent',
    label:        'US rent index, monthly (BLS owners\' equivalent rent)',
    horizon:      'month',
    // BLS CPI-U owners' equivalent rent of residences, index level.
    seriesTicker: 'KXOER',
    eventTicker:  null,
    keywords:     [],
  },
];

// Kalshi retired trading-api.kalshi.com; it now answers every request with
// HTTP 401 and the body "API has been moved to https://api.elections.kalshi.com/".
// That 401 reads as a credential failure and sent this integration chasing keys:
// the real cause was the host. api.elections.kalshi.com answers
// {"exchange_active":true} on /trade-api/v2/exchange/status.
const BASE_URL    = (process.env.KALSHI_API_BASE_URL || 'https://api.elections.kalshi.com').replace(/\/$/, '');
const API_KEY     = (process.env.KALSHI_API_KEY     || '').trim();
const API_SECRET  = (process.env.KALSHI_API_SECRET  || '').trim();
const API_PATH    = '/trade-api/v2';

const OUTPUT_DIR  = path.resolve(__dirname, '..', '..', 'data', 'kalshi');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'prediction-market.json');

// ---------------------------------------------------------------------------
// Kalshi RSA-SHA256 request signing
// ---------------------------------------------------------------------------

/**
 * normalizePem — rebuild a PEM whose line breaks were lost.
 *
 * Pasting a private key into a secrets field commonly flattens it onto one
 * line, and OpenSSL then fails with
 *   error:1E08010C:DECODER routines::unsupported
 * which names no cause and reads like an unsupported key type. It is purely a
 * formatting problem: the key material is intact, so re-wrap it rather than
 * leaving the operator to discover this by character count. (A PKCS#8 RSA-2048
 * key is 1704 characters with its newlines and 1676 without — exactly the
 * difference that produced this bug.)
 *
 * Handles PKCS#1 ("BEGIN RSA PRIVATE KEY"), PKCS#8 ("BEGIN PRIVATE KEY"), and
 * a bare base64 body with no header at all.
 *
 * @param {string} raw
 * @returns {string|null} a well-formed PEM, or null if it cannot be rebuilt
 */
function normalizePem(raw) {
  const value = String(raw || '').trim();
  if (!value) return null;
  // Already multi-line — whatever is wrong with it, re-wrapping will not help.
  if (value.includes('\n') && value.includes('-----')) return null;

  const header = /-----BEGIN ([A-Z0-9 ]+?)-----/.exec(value);
  const label = header ? header[1] : 'RSA PRIVATE KEY';
  const body = value
    .replace(/-----BEGIN [A-Z0-9 ]+?-----/, '')
    .replace(/-----END [A-Z0-9 ]+?-----/, '')
    .replace(/\s+/g, '');
  if (!body) return null;
  return `-----BEGIN ${label}-----\n${body.match(/.{1,64}/g).join('\n')}\n-----END ${label}-----\n`;
}

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
  const candidates = [API_SECRET, normalizePem(API_SECRET)].filter(Boolean);
  let lastErr = null;
  for (const key of candidates) {
    try {
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(message);
      signature = sign.sign(key, 'base64');
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) {
    throw new Error(
      `Failed to sign Kalshi request: ${lastErr.message}. ` +
      'A PEM pasted without line breaks produces exactly this ' +
      '"DECODER routines::unsupported" error — re-paste KALSHI_API_SECRET with its ' +
      'newlines intact, header and footer on their own lines.'
    );
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
        if (res.statusCode === 401) {
          return reject(new Error(`HTTP 401 Unauthorized — check KALSHI_API_KEY and KALSHI_API_SECRET. Body: ${body.slice(0, 200)}`));
        }
        if (res.statusCode === 403) {
          return reject(new Error(`HTTP 403 Forbidden — API key may lack required permissions. Body: ${body.slice(0, 200)}`));
        }
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
    const qs      = new URLSearchParams({ series_ticker: cfg.seriesTicker, status: 'open', limit: '100' });
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
 * Widest bid–ask gap (in dollars, i.e. probability points) at which the
 * midpoint is still a fair read of the market. Wider than this, a line has
 * too few traders to quote a figure.
 */
const MAX_SPREAD = 0.10;

/**
 * Price of a contract's "yes" side, as a probability (0–1, two decimals).
 *
 * The midpoint of the best bid and best ask, when the two are within
 * MAX_SPREAD of each other. A wider gap (or an empty side) is a thin line:
 * prob is null and thin is true. This used to take the best bid alone, which
 * on a thin September 2026 housing-starts ladder printed "above 1.15M: 71%"
 * next to "above 1.10M: 32%" — impossible, since the lower line must be at
 * least as likely. The last trade is no fallback: on that ladder it was just
 * as contradictory (54% above 1.30M, 36% above 1.25M).
 * @param {Object} m
 * @returns {{prob: number|null, bid: number|null, ask: number|null, thin: boolean}}
 */
function contractPrice(m) {
  const fromDollars = (v) => {
    if (v == null || v === '') return null;
    const n = typeof v === 'number' ? v : parseFloat(v);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
  };
  const fromCents = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v / 100 : null);
  const bid = fromDollars(m.yes_bid_dollars) ?? fromCents(m.yes_bid);
  const ask = fromDollars(m.yes_ask_dollars) ?? fromCents(m.yes_ask);
  const round = (n) => Math.round(n * 100) / 100;
  // An empty book side reads as a 0.00 bid or a 1.00 ask. That is no quote,
  // so the line is thin even when the other side sits close to it (a 0¢ bid
  // with a 2¢ ask has no buyer at all).
  const realBid = bid != null && bid > 0;
  const realAsk = ask != null && ask < 1;
  if (realBid && realAsk && ask >= bid && ask - bid <= MAX_SPREAD + 1e-9) {
    return { prob: round((bid + ask) / 2), bid, ask, thin: false };
  }
  return { prob: null, bid, ask, thin: true };
}

/**
 * Threshold of an "above X" ladder line, from Kalshi's floor_strike or the
 * title. null when the contract is not a threshold line.
 * @param {Object} m
 * @returns {number|null}
 */
function strikeOf(m) {
  if (typeof m.floor_strike === 'number' && Number.isFinite(m.floor_strike)) return m.floor_strike;
  const hit = /above\s+\$?([\d.,]+)/i.exec(m.title || '');
  if (!hit) return null;
  const n = parseFloat(hit[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * A ladder must get no less likely as its threshold falls ("above 1.10M" is
 * at least as likely as "above 1.15M"). When the priced lines break that,
 * none of them is a reliable read: every line is marked thin, unpriced.
 * @param {Object[]} markets
 * @param {Object[]} outcomes — same order as markets
 * @returns {Object[]}
 */
function enforceLadder(markets, outcomes) {
  const strikes = markets.map(strikeOf);
  if (strikes.some((k) => k == null)) return outcomes;
  const priced = outcomes
    .map((o, i) => ({ k: strikes[i], p: o.prob }))
    .filter((x) => x.p != null)
    .sort((a, b) => a.k - b.k);
  const ordered = priced.every((x, i) => i === 0 || x.p <= priced[i - 1].p);
  if (ordered) return outcomes;
  return outcomes.map((o) => ({ ...o, prob: null, thin: true }));
}

/**
 * Convert raw Kalshi market objects into the normalized output schema.
 * @param {MetricConfig} cfg
 * @param {Object[]} markets
 * @returns {Object}
 */
function normalizeMarket(cfg, markets) {
  if (!markets.length) return null;

  // Pick the first market with the most liquidity / volume. The v2 API sends
  // these as fixed-point strings (`volume_fp: "527.00"`); older responses
  // used integers (`volume`).
  const qty = (m, key) => {
    const n = parseFloat(m[key + '_fp'] ?? m[key]);
    return Number.isFinite(n) ? n : 0;
  };
  const liquidity = (m) => qty(m, 'volume') + qty(m, 'open_interest');
  // With several events open (one per release date), keep the event with the
  // most combined activity across its lines, then its most-traded line.
  const byEvent = new Map();
  for (const m of markets) {
    const key = m.event_ticker || '';
    byEvent.set(key, (byEvent.get(key) || 0) + liquidity(m));
  }
  let event = markets[0].event_ticker || '';
  for (const [key, total] of byEvent) if (total > byEvent.get(event)) event = key;
  if (byEvent.size > 1) markets = markets.filter((m) => (m.event_ticker || '') === event);
  const market = markets.reduce((best, m) => (liquidity(m) > liquidity(best) ? m : best), markets[0]);

  // Each contract's own "yes" price, as a probability. Kalshi's v2 API quotes
  // prices as dollar strings (`yes_bid_dollars`, "0.4500"); older responses
  // used integer cents (`yes_bid`). A contract without a tight bid–ask pair
  // has no price: that is null, never 0 — a 0 here rendered as "0%" for every
  // housing-starts threshold on the dashboard.
  const yes = contractPrice(market);

  let outcomes = [];
  if (yes.prob != null) {
    outcomes = [
      { name: 'Yes', prob: yes.prob },
      { name: 'No',  prob: Math.round((1 - yes.prob) * 100) / 100 },
    ];
  }

  // Several contracts from one series are a strike ladder ("above 1.30M",
  // "above 1.35M", ...): overlapping events, so each keeps its own
  // probability. Rescaling them to sum to 1 — as this used to — is only
  // valid for mutually exclusive outcomes, and turned P(above 1.10M) = 0.95
  // into a share of a total. A single threshold contract is a one-line
  // ladder: "Above 679.21" reads better than "Yes".
  //
  // Each line is named by Kalshi's short yes_sub_title ("Above 8.0%") when
  // it has one: some events give every line the same title ("How high will
  // 30yr mortgage rate get this year?"), so the title cannot tell them apart.
  if (markets.length > 1 || strikeOf(market) != null) {
    outcomes = enforceLadder(markets, markets.map((m) => {
      const pr = contractPrice(m);
      const name = m.yes_sub_title || m.title || m.ticker || '?';
      return { name, prob: pr.prob, bid: pr.bid, ask: pr.ask, thin: pr.thin };
    }));
  }

  return {
    metric:   cfg.metric,
    label:    cfg.label,
    horizon:  cfg.horizon,
    ...(cfg.note ? { note: cfg.note } : {}),
    market: {
      id:    market.ticker || market.id || '',
      title: market.title || '',
      url:   market.ticker
        ? `https://kalshi.com/markets/${market.ticker}`
        : `https://kalshi.com`,
      // When the market stops trading: tells a reader which release or
      // year a line is about when the title says only "this year".
      closes: market.close_time || null,
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

  // Guard: if no credentials, preserve any existing seed data and exit cleanly.
  // This avoids overwriting the illustrative snapshot with an empty-items file
  // every time the script is run locally without credentials.
  if (!API_KEY || !API_SECRET) {
    const missingVars = [];
    if (!API_KEY)    missingVars.push('KALSHI_API_KEY');
    if (!API_SECRET) missingVars.push('KALSHI_API_SECRET');
    console.warn(`::warning::Kalshi credentials not configured: ${missingVars.join(', ')} are empty.`);
    console.warn('To enable live Kalshi data, add the following GitHub Actions secrets:');
    console.warn('  Settings → Secrets and variables → Actions → New repository secret');
    console.warn('  KALSHI_API_KEY    — your Kalshi access key ID');
    console.warn('  KALSHI_API_SECRET — your RSA private key in PEM format');
    console.warn('  Obtain credentials at: https://kalshi.com/account/api');

    const seedExists = fs.existsSync(OUTPUT_FILE);
    let seedHasItems = false;
    if (seedExists) {
      try {
        const existing = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));
        seedHasItems = Array.isArray(existing.items) && existing.items.length > 0;
      } catch (parseErr) {
        console.warn('Could not parse existing prediction-market.json:', parseErr.message);
      }
    }

    if (seedHasItems) {
      console.warn(
        'Preserving existing seed data in ' + OUTPUT_FILE + '.\n' +
        'Dashboard will display previously fetched market data.'
      );
    } else {
      console.warn(
        'Writing empty-items prediction-market.json — dashboard will use mock data.'
      );
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify({
        updated,
        source: 'kalshi',
        error:  'Credentials not configured. Set KALSHI_API_KEY and KALSHI_API_SECRET.',
        items:  [],
      }, null, 2), 'utf8');
    }
    process.exit(0);
  }

  console.log(`Fetching Kalshi housing prediction markets from ${BASE_URL} …`);

  const items = [];

  const failures = [];

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
      failures.push(`${cfg.metric}: ${err.message}`);
      console.warn(`✗  ${err.message}`);
    }
  }

  const output = { updated, source: 'kalshi', items };

  // Every metric failing means the fetch did not work — a credential, a
  // signature or a reachability problem — NOT that Kalshi has no housing
  // markets today. Overwriting the committed file with an empty list in that
  // case destroys real data and reports success: on 2026-09-12 five signing
  // failures (a PEM pasted without line breaks) replaced the four committed
  // items with zero, and the workflow still exited 0.
  //
  // Distinguish the two: no markets matched is a legitimate empty result;
  // every request erroring is a failure, and a failure must not be committed.
  if (!items.length && failures.length === MARKET_CONFIG.length) {
    console.error(
      `\n✗  All ${failures.length} metric(s) failed — not writing ${OUTPUT_FILE}.\n` +
      failures.map((f) => `    ${f}`).join('\n')
    );
    process.exitCode = 1;
    return;
  }

  if (!items.length) {
    output.error = 'No matching Kalshi markets found. Dashboard will display mock data.';
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nWrote ${OUTPUT_FILE} (${items.length} item(s)).`);
})();
