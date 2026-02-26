#!/usr/bin/env node
/**
 * fetch-zillow.js
 * Puppeteer script to scrape Zillow Research data and save as JSON.
 *
 * Credentials are read from environment variables ZILLOW_EMAIL and
 * ZILLOW_PASSWORD (set via GitHub Secrets in CI, or a local .env file
 * for manual testing).
 */

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
 * Download a URL to a temporary buffer and return the raw string content.
 * Retries up to maxRetries times with exponential backoff on 429/403/5xx errors.
 */
function downloadUrl(url, maxRetries = 3) {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ];
  const ua = userAgents[Math.floor(Math.random() * userAgents.length)];

  function tryFetch(retryCount) {
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
      };
      https.get(url, options, (res) => {
        const retryable = res.statusCode === 403 || res.statusCode === 429 ||
                          (res.statusCode >= 500 && res.statusCode < 600);
        if (res.statusCode !== 200) {
          res.resume();
          const err = new Error(`HTTP ${res.statusCode} for ${url}`);
          if (retryable && retryCount < maxRetries) {
            const delay = Math.min(Math.pow(2, retryCount) * 2000, 10000);
            console.warn(`  ${err.message} — retrying in ${delay / 1000}s (attempt ${retryCount + 1}/${maxRetries})…`);
            return setTimeout(() => tryFetch(retryCount + 1).then(resolve, reject), delay);
          }
          return reject(err);
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      }).on('error', reject);
    });
  }

  return tryFetch(0);
}

/**
 * Parse CSV text and return an array of plain objects.
 */
function parseCsv(csvText) {
  return parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

/**
 * Filter rows to Colorado metros / counties only.
 */
function filterColorado(rows) {
  return rows.filter((row) => {
    const name = (row.RegionName || row.regionName || '').toLowerCase();
    const state = (row.StateName || row.state || '').toLowerCase();
    return (
      state === 'co' ||
      GEO_FILTERS.some((f) => name.includes(f))
    );
  });
}

/**
 * Write JSON to data/zillow-<key>.json
 */
function saveJson(key, payload) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const filePath = path.join(DATA_DIR, `zillow-${key}.json`);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`  Saved ${filePath} (${payload.records.length} records)`);
}

/**
 * Attempt to load a cached JSON file so the workflow can fall back gracefully.
 */
function loadCache(key) {
  const filePath = path.join(DATA_DIR, `zillow-${key}.json`);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (_) {
      // corrupted cache — ignore
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  const email = process.env.ZILLOW_EMAIL;
  const password = process.env.ZILLOW_PASSWORD;

  if (!email || !password) {
    console.warn(
      'Warning: ZILLOW_EMAIL / ZILLOW_PASSWORD not set. ' +
      'Skipping login — public datasets only.'
    );
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();

    // Suppress verbose browser logs in CI output
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error('[browser]', msg.text());
      }
    });

    // ------------------------------------------------------------------
    // 1. Navigate to the Research Data page
    // ------------------------------------------------------------------
    console.log(`Navigating to ${ZILLOW_RESEARCH_URL} …`);
    await page.goto(ZILLOW_RESEARCH_URL, { waitUntil: 'networkidle2', timeout: 60000 });

    // ------------------------------------------------------------------
    // 2. Login (if credentials are available)
    // ------------------------------------------------------------------
    if (email && password) {
      console.log('Attempting login …');
      try {
        // Zillow sign-in link may be in the top nav
        const signInLink = await page.$('a[href*="signin"]');
        if (signInLink) {
          await signInLink.click();
          await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
        }

        const emailInput = await page.$('input[type="email"], input[name="email"]');
        if (emailInput) {
          await emailInput.type(email);

          const continueBtn = await page.$('button[type="submit"]');
          if (continueBtn) {
            await continueBtn.click();
            await page.waitForSelector('input[type="password"]', { timeout: 10000 }).catch(() => {
              console.warn('  Password field not found within timeout.');
            });
          }
        }

        const passInput = await page.$('input[type="password"]');
        if (passInput) {
          await passInput.type(password);
          const loginBtn = await page.$('button[type="submit"]');
          if (loginBtn) {
            await loginBtn.click();
            await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });
          }
        }

        console.log('Login step complete.');
      } catch (loginErr) {
        console.warn('Login encountered an issue (continuing as guest):', loginErr.message);
      }

      // Return to research data page after login redirect
      await page.goto(ZILLOW_RESEARCH_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    }

    // ------------------------------------------------------------------
    // 3. Collect CSV download links from the page
    // ------------------------------------------------------------------
    console.log('Collecting dataset links …');
    const allLinks = await page.$$eval('a[href]', (anchors) =>
      anchors.map((a) => ({ text: a.textContent.trim(), href: a.href }))
    );

    // ------------------------------------------------------------------
    // 4. Download, parse, filter, and save each dataset
    // ------------------------------------------------------------------
    for (const dataset of DATASET_CONFIG) {
      console.log(`\nProcessing dataset: ${dataset.label}`);

      // Find the best matching link
      const link = allLinks.find(
        (l) =>
          l.href.toLowerCase().includes(dataset.hrefContains.toLowerCase()) &&
          l.href.endsWith('.csv')
      );

      if (!link) {
        console.warn(`  No CSV link found for "${dataset.label}". Falling back to cache.`);
        const cached = loadCache(dataset.key);
        if (cached) {
          saveJson(dataset.key, { ...cached, fetchedAt: new Date().toISOString(), source: 'cache' });
        } else {
          console.warn(`  No cache available for "${dataset.label}". Skipping.`);
        }
        continue;
      }

      console.log(`  Downloading ${link.href} …`);
      let csvText;
      try {
        csvText = await downloadUrl(link.href);
      } catch (dlErr) {
        console.warn(`  Download failed: ${dlErr.message}. Falling back to cache.`);
        const cached = loadCache(dataset.key);
        if (cached) {
          saveJson(dataset.key, { ...cached, fetchedAt: new Date().toISOString(), source: 'cache' });
        }
        continue;
      }

      let rows;
      try {
        rows = parseCsv(csvText);
      } catch (parseErr) {
        console.warn(`  CSV parse error: ${parseErr.message}. Falling back to cache.`);
        const cached = loadCache(dataset.key);
        if (cached) {
          saveJson(dataset.key, { ...cached, fetchedAt: new Date().toISOString(), source: 'cache' });
        }
        continue;
      }

      const filtered = filterColorado(rows);
      console.log(`  ${rows.length} total rows → ${filtered.length} Colorado rows`);

      const payload = {
        dataset: dataset.label,
        source: 'zillow-research',
        sourceUrl: link.href,
        fetchedAt: new Date().toISOString(),
        recordCount: filtered.length,
        records: filtered,
      };

      saveJson(dataset.key, payload);
    }

    console.log('\nDone.');
  } catch (err) {
    console.error('Fatal error in fetch-zillow.js:', err);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
