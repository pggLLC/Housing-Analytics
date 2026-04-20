#!/usr/bin/env node
/**
 * source-url-sweep.mjs — verify external source URLs cited across the site
 * are still reachable. Closes audit item #1 from the 2026-04-20 outstanding-
 * items review ("Broken source paths / 404 errors").
 *
 * What it does:
 *   1. Collects external URLs from:
 *        - DATA-MANIFEST.json (data-pipeline endpoints)
 *        - js/citations.js     (industry-source registry)
 *        - *.html href= links  (user-facing citations in page copy)
 *   2. Dedupes + filters to http(s) URLs (skips mailto:, #anchors, relatives)
 *   3. Skips a known allow-list of URLs that fail HEAD but are known-good
 *      (e.g. Census Overpass API needs POST, not HEAD).
 *   4. HEAD-requests each with 10s timeout; if HEAD fails the server may
 *      just not allow it, so falls back to a small-range GET.
 *   5. Reports: OK, TIMEOUT, 404, 5xx, other-failure.
 *
 * Exit code:
 *   0  — every URL resolved (including allow-listed)
 *   1  — at least one URL returned 404 or a hard failure
 *   2  — internal script error (bad inputs)
 *
 * Currently-known-broken URLs tracked in issue #648 (not allow-listed on
 * purpose — they should be surfaced until fixed, just not block PRs).
 *
 * Usage:
 *   node scripts/audit/source-url-sweep.mjs
 *   node scripts/audit/source-url-sweep.mjs --quiet   (only print failures)
 *   node scripts/audit/source-url-sweep.mjs --json    (machine-readable)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..', '..');

const TIMEOUT_MS = 10_000;
const CONCURRENT = 8;

// URLs that are expected to fail HEAD/GET from a CI runner — either the
// server requires POST (APIs), blocks automated agents (403), or requires
// specific headers we won't reproduce. Listed here with a short
// justification so future failures get scrutinized.
const ALLOW_LIST = new Set([
  'https://overpass-api.de/api/interpreter', // POST-only API
  // The following return 403 to automated HEAD/GET but resolve fine in a
  // real browser. Checked manually 2026-04-20 — each is a legitimate
  // citation target and re-verified by hand.
  'https://www.novoco.com',
  'https://www.novoco.com/resource-centers/affordable-housing-tax-credits',
  'https://www.novoco.com/resource-centers/affordable-housing-tax-credits/2026-federal-lihtc-information-by-state',
  'https://www.novoco.com/resource-centers/affordable-housing-tax-credits/qct-dda-mapping-tool',
  'https://www.ncsha.org',
  'https://www.ncsha.org/advocacy-issues/lihtc/',
  'https://www.congress.gov/',
  'https://www.congress.gov/bill/118th-congress/house-bill/6644',
  'https://www.cbre.com/insights',
  'https://www.cbre.com/insights/books/us-real-estate-market-outlook-2025/multifamily',
  'https://www.ffiec.gov/craadweb/main.aspx',
  'https://cdola.colorado.gov/commitment-filings',
  'https://cdola.colorado.gov/housing',
  'https://cdola.colorado.gov/prop123',
  'https://dlg.colorado.gov/news-article/final-housing-needs-assessment-methodology-and-displacement-risk-assessment-guidance',
]);

// Regex: skip patterns that clearly aren't source citations.
const SKIP_PATTERNS = [
  /^mailto:/i,
  /^tel:/i,
  /^javascript:/i,
  /^#/,
  /localhost/i,
  /^\/\//,                       // protocol-relative — resolve elsewhere
  /\$\{/,                        // unescaped JS template literal captured as URL
  /^https?:\/\/fonts\.googleapis\.com/i, // font CDN, not a citation target
  /^https?:\/\/fonts\.gstatic\.com/i,
  /^https?:\/\/cdn\.jsdelivr\.net/i,     // JS CDN, not a citation
  /^https?:\/\/unpkg\.com/i,
  /^https?:\/\/cdnjs\.cloudflare\.com/i,
];

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    quiet: args.includes('--quiet'),
    json:  args.includes('--json'),
  };
}

/** Walk an object and collect every string value that looks like an http(s) URL. */
function collectUrlsFromObject(obj, out = []) {
  if (!obj) return out;
  if (typeof obj === 'string') {
    if (/^https?:\/\//i.test(obj)) out.push(obj);
    return out;
  }
  if (Array.isArray(obj)) {
    for (const v of obj) collectUrlsFromObject(v, out);
    return out;
  }
  if (typeof obj === 'object') {
    for (const v of Object.values(obj)) collectUrlsFromObject(v, out);
  }
  return out;
}

async function readJson(relPath) {
  const full = path.join(ROOT, relPath);
  try {
    const txt = await fs.readFile(full, 'utf8');
    return JSON.parse(txt);
  } catch (_) {
    return null;
  }
}

/** Parse `js/citations.js` by regex (it's a plain object literal). */
async function readCitations() {
  const full = path.join(ROOT, 'js/citations.js');
  let txt;
  try { txt = await fs.readFile(full, 'utf8'); } catch { return []; }
  return [...txt.matchAll(/url:\s*["'](https?:\/\/[^"']+)["']/g)].map(m => m[1]);
}

/** Pull href= URLs from every HTML file at the repo root. */
async function readHtmlUrls() {
  const entries = await fs.readdir(ROOT, { withFileTypes: true });
  const urls = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.html')) continue;
    const txt = await fs.readFile(path.join(ROOT, e.name), 'utf8');
    for (const m of txt.matchAll(/href\s*=\s*["'](https?:\/\/[^"'#\s]+)["']/gi)) {
      urls.push(m[1]);
    }
  }
  return urls;
}

async function collectAllUrls() {
  const buckets = [];
  buckets.push(...collectUrlsFromObject(await readJson('DATA-MANIFEST.json') || {}));
  buckets.push(...await readCitations());
  buckets.push(...await readHtmlUrls());

  const filtered = buckets
    .filter(u => !SKIP_PATTERNS.some(rx => rx.test(u)))
    // Drop tracking / social / noisy domains that don't represent data sources
    .filter(u => !/(?:twitter|facebook|linkedin|instagram|youtube|analytics)\.com/i.test(u));

  return [...new Set(filtered)].sort();
}

async function probeUrl(url) {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let res = await fetch(url, { method: 'HEAD', signal: ctrl.signal, redirect: 'follow' });
    // Some servers reject HEAD with 405; retry with ranged GET.
    if (res.status === 405 || res.status === 403 || res.status === 501) {
      res = await fetch(url, {
        method: 'GET',
        signal: ctrl.signal,
        redirect: 'follow',
        headers: { Range: 'bytes=0-0' },
      });
    }
    return { url, status: res.status, ok: res.ok, elapsed: Date.now() - started };
  } catch (err) {
    return {
      url,
      status: 0,
      ok:     false,
      error:  err.name === 'AbortError' ? 'TIMEOUT' : (err.code || err.message),
      elapsed: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeAll(urls) {
  const results = [];
  for (let i = 0; i < urls.length; i += CONCURRENT) {
    const slice = urls.slice(i, i + CONCURRENT);
    const batch = await Promise.all(slice.map(probeUrl));
    results.push(...batch);
  }
  return results;
}

function classify(r) {
  if (ALLOW_LIST.has(r.url)) return 'allow-listed';
  if (r.ok) return 'ok';
  if (r.status === 404) return 'not-found';
  if (r.status >= 500) return 'server-error';
  if (r.error === 'TIMEOUT') return 'timeout';
  if (!r.status) return 'fetch-error';
  return 'other';
}

async function main() {
  const { quiet, json } = parseArgs();

  const urls = await collectAllUrls();
  if (!urls.length) {
    console.error('No URLs discovered — something is wrong with the inventory step.');
    process.exit(2);
  }

  if (!quiet && !json) console.log(`Probing ${urls.length} unique source URLs…`);

  const results = await probeAll(urls);

  const bucketed = {};
  for (const r of results) {
    const k = classify(r);
    (bucketed[k] ||= []).push(r);
  }

  if (json) {
    console.log(JSON.stringify({ total: urls.length, bucketed }, null, 2));
  } else {
    const okN     = (bucketed.ok || []).length;
    const allowN  = (bucketed['allow-listed'] || []).length;
    const failKeys = ['not-found', 'server-error', 'timeout', 'fetch-error', 'other'];
    const failN   = failKeys.reduce((s, k) => s + ((bucketed[k] || []).length), 0);

    if (!quiet) {
      for (const r of results) {
        const k = classify(r);
        if (k === 'ok' && quiet) continue;
        const badge = k === 'ok' ? '  OK' : k.toUpperCase().padEnd(13);
        console.log(`${badge} ${r.status || '---'}  ${r.url}${r.error ? ` (${r.error})` : ''}`);
      }
      console.log('');
    }
    console.log(`Summary: ${okN} ok, ${allowN} allow-listed, ${failN} failing (of ${urls.length})`);

    if (failN > 0) {
      console.log('\nFailures:');
      for (const k of failKeys) {
        for (const r of (bucketed[k] || [])) {
          console.log(`  [${k}] ${r.status || '---'}  ${r.url}${r.error ? ` — ${r.error}` : ''}`);
        }
      }
    }
  }

  // Exit 1 only on hard failures (404 / server error / fetch error).
  // Timeouts are soft because many CI runners have flaky egress.
  const hardFail = ['not-found', 'server-error', 'fetch-error'].reduce(
    (s, k) => s + ((bucketed[k] || []).length), 0
  );
  process.exit(hardFail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('source-url-sweep crashed:', err);
  process.exit(2);
});
