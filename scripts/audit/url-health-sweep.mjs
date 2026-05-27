#!/usr/bin/env node
/**
 * url-health-sweep.mjs  (F14, 2026-05-26)
 *
 * Periodic URL health monitor. Distinct from `source-url-sweep.mjs` which
 * is a PR-time blocking check over changed files; this one runs on a cron,
 * sweeps ALL external URLs in the repo, and maintains a persistent
 * `data/url-health.json` cache used both for:
 *
 *   1. Browser display — OF / Compare / HNA pages can show "verified
 *      YYYY-MM-DD" next to external resource links so users know the
 *      data is current.
 *   2. Weekly issue filing — diff vs. last sweep surfaces newly-broken
 *      URLs as a single GitHub issue for maintainer triage.
 *
 * Scans:
 *   - data/hna/local-resources.json (every URL field)
 *   - data/policy/*.json
 *   - All root-level *.html (anchor hrefs)
 *   - docs/**\/*.md (markdown URL references)
 *
 * Cache shape (data/url-health.json):
 *   {
 *     "lastSweepAt": "2026-05-26T...",
 *     "urlCount": 234,
 *     "byUrl": {
 *       "https://example.com/...": {
 *         "status": "ok" | "broken" | "auth" | "timeout" | "allow",
 *         "httpStatus": 200,
 *         "lastCheckedAt": "2026-05-26T...",
 *         "lastOkAt":       "2026-05-26T...",   // preserved if status !== ok
 *         "firstSeenAt":    "2026-05-26T...",   // preserved across sweeps
 *         "redirectTo":     "https://...",      // when applicable
 *         "consecutiveFailures": 0
 *       }
 *     }
 *   }
 *
 * CLI:
 *   node scripts/audit/url-health-sweep.mjs                 # full sweep + write cache
 *   node scripts/audit/url-health-sweep.mjs --diff-only     # print newly-broken since last sweep
 *   node scripts/audit/url-health-sweep.mjs --dry-run       # probe + report, don't write cache
 *
 * Exit codes:
 *   0 — sweep completed (regardless of how many URLs failed)
 *   2 — script-level failure (filesystem error, etc.)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CACHE_PATH = path.join(ROOT, 'data', 'url-health.json');

const TIMEOUT_MS = 10_000;
const CONCURRENT = 6;
const NOW = new Date().toISOString();

const DRY_RUN  = process.argv.includes('--dry-run');
const DIFF_ONLY = process.argv.includes('--diff-only');

// Re-use the allow-list from source-url-sweep — these are known-good URLs
// that block CI user-agents (DOL, BLS, CHFA QAP, etc.). Keep in sync.
const ALLOW_LIST = new Set([
  'https://overpass-api.de/api/interpreter',
  'https://ffiec.cfpb.gov/v2/data-browser-api/view/aggregations',
  'https://www.novoco.com/',
  'https://www.ncsha.org/',
  'https://www.congress.gov/',
  'https://www.cbre.com/insights',
  'https://www.ffiec.gov/craadweb/main.aspx',
  'https://www.dol.gov/agencies/whd/government-contracts/construction',
  'https://cdola.colorado.gov/commitment-filings',
  'https://cdola.colorado.gov/housing',
  'https://cdola.colorado.gov/prop123',
  'https://cdola.colorado.gov/prop-123',
  'https://cdola.colorado.gov/proposition-123',
  'https://cdola.colorado.gov/division-of-housing',
  'https://demography.dola.colorado.gov/population/population-totals-colorado-counties/',
  'https://demography.dola.colorado.gov/population/population-change-components/',
  'https://trading-api.kalshi.com/trade-api/v2',
  'https://www.chfainfo.com/multifamily/QAP',
  'https://www.chfainfo.com/multifamily/qap',
  'https://www.bls.gov/cew/',
  'https://www.bls.gov/ppi/',
  'https://www.bls.gov/ppi',
  'https://www.bls.gov/cps',
  'https://www.bls.gov/jlt',
  'https://www.bls.gov/lau/',
  'https://www.bls.gov/data/',
  'https://dlg.colorado.gov/',
  'https://lehd.ces.census.gov/data/lodes/LODES8/',
  'https://lehd.ces.census.gov/doc/help/onthemap/LODESTechDoc.pdf',
  'https://www.jchs.harvard.edu/',
  'https://www.fema.gov/flood-maps',
  'https://www.hud.gov/program_offices/comm_planning/environment_energy/nepa'
]);

/* ── URL collection ───────────────────────────────────────────────── */

function isHttpUrl(s) {
  return typeof s === 'string' && /^https?:\/\//i.test(s);
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch (_) {
    return url;
  }
}

function collectUrlsFromObject(obj, out = []) {
  if (obj == null) return out;
  if (typeof obj === 'string') {
    if (isHttpUrl(obj)) out.push(obj);
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

async function collectAllUrls() {
  const urls = new Set();

  // 1. data/hna/local-resources.json (every URL field)
  try {
    const lr = JSON.parse(await fs.readFile(path.join(ROOT, 'data/hna/local-resources.json'), 'utf8'));
    for (const u of collectUrlsFromObject(lr)) urls.add(normalizeUrl(u));
  } catch (_) {}

  // 2. data/policy/*.json
  try {
    const policyDir = path.join(ROOT, 'data', 'policy');
    const policyFiles = await fs.readdir(policyDir);
    for (const f of policyFiles.filter((f) => f.endsWith('.json'))) {
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(policyDir, f), 'utf8'));
        for (const u of collectUrlsFromObject(parsed)) urls.add(normalizeUrl(u));
      } catch (_) {}
    }
  } catch (_) {}

  // 3. Root-level *.html files (href attrs)
  const hrefRx = /href\s*=\s*["']([^"']+)["']/gi;
  const rootEntries = await fs.readdir(ROOT, { withFileTypes: true });
  for (const e of rootEntries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith('.html')) continue;
    const src = await fs.readFile(path.join(ROOT, e.name), 'utf8');
    let m;
    while ((m = hrefRx.exec(src)) !== null) {
      const href = (m[1] || '').trim();
      if (isHttpUrl(href)) urls.add(normalizeUrl(href));
    }
  }

  // 4. docs/**/*.md (markdown URL refs, link refs, and bare URLs)
  async function walkMd(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walkMd(p);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) {
        const src = await fs.readFile(p, 'utf8');
        const rx = /https?:\/\/[^\s"'`<>)\]]+/g;
        let m;
        while ((m = rx.exec(src)) !== null) {
          urls.add(normalizeUrl(m[0]));
        }
      }
    }
  }
  await walkMd(path.join(ROOT, 'docs'));

  return [...urls].sort();
}

/* ── Probe ────────────────────────────────────────────────────────── */

async function probeUrl(url) {
  if (ALLOW_LIST.has(url)) {
    return { url, status: 'allow', httpStatus: null, redirectTo: null, message: 'allow-listed' };
  }
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    let res;
    try {
      res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ac.signal });
      // Many servers reject HEAD with 405/403; retry GET with Range
      if (res.status === 405 || res.status === 403) {
        res = await fetch(url, {
          method: 'GET', redirect: 'follow', signal: ac.signal,
          headers: { Range: 'bytes=0-0' }
        });
      }
    } catch (_) {
      res = await fetch(url, {
        method: 'GET', redirect: 'follow', signal: ac.signal,
        headers: { Range: 'bytes=0-0' }
      });
    }
    clearTimeout(timeout);
    const redirectTo = (res.url && normalizeUrl(res.url) !== url) ? normalizeUrl(res.url) : null;
    if (res.ok) return { url, status: 'ok', httpStatus: res.status, redirectTo, message: '' };
    if (res.status === 401 || res.status === 403) {
      return { url, status: 'auth', httpStatus: res.status, redirectTo, message: 'auth-required' };
    }
    if (res.status === 404) {
      return { url, status: 'broken', httpStatus: 404, redirectTo, message: 'not found' };
    }
    return { url, status: 'broken', httpStatus: res.status, redirectTo, message: 'unexpected status' };
  } catch (err) {
    clearTimeout(timeout);
    if (err && (err.name === 'AbortError' || /aborted|timeout/i.test(String(err)))) {
      return { url, status: 'timeout', httpStatus: null, redirectTo: null, message: 'timeout' };
    }
    return { url, status: 'broken', httpStatus: null, redirectTo: null, message: String(err).slice(0, 120) };
  }
}

async function probeAll(urls) {
  const results = new Array(urls.length);
  let i = 0;
  async function worker() {
    while (i < urls.length) {
      const idx = i++;
      results[idx] = await probeUrl(urls[idx]);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENT }, worker));
  return results;
}

/* ── Cache merge ──────────────────────────────────────────────────── */

async function loadCache() {
  try {
    const raw = await fs.readFile(CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return { lastSweepAt: null, urlCount: 0, byUrl: {} };
  }
}

function mergeIntoCache(prev, results) {
  const byUrl = {};
  for (const r of results) {
    const existing = prev.byUrl[r.url] || {};
    const entry = {
      status: r.status,
      httpStatus: r.httpStatus ?? null,
      lastCheckedAt: NOW,
      lastOkAt: (r.status === 'ok' || r.status === 'allow') ? NOW : (existing.lastOkAt || null),
      firstSeenAt: existing.firstSeenAt || NOW,
      consecutiveFailures: (r.status === 'ok' || r.status === 'allow')
        ? 0
        : (existing.consecutiveFailures || 0) + 1
    };
    if (r.redirectTo) entry.redirectTo = r.redirectTo;
    byUrl[r.url] = entry;
  }
  return { lastSweepAt: NOW, urlCount: results.length, byUrl };
}

function diffSweeps(prev, next) {
  const newlyBroken = [];
  const stillBroken = [];
  const recovered = [];
  for (const url of Object.keys(next.byUrl)) {
    const a = prev.byUrl[url] || {};
    const b = next.byUrl[url];
    const wasOk = a.status === 'ok' || a.status === 'allow' || a.status === undefined;
    const isOk  = b.status === 'ok' || b.status === 'allow';
    if (wasOk && !isOk) newlyBroken.push({ url, status: b.status, httpStatus: b.httpStatus });
    else if (!wasOk && !isOk && a.status !== undefined) stillBroken.push({ url, status: b.status, httpStatus: b.httpStatus, consecutiveFailures: b.consecutiveFailures });
    else if (!wasOk && isOk) recovered.push({ url, httpStatus: b.httpStatus });
  }
  return { newlyBroken, stillBroken, recovered };
}

/* ── Main ─────────────────────────────────────────────────────────── */

async function main() {
  console.error('[url-health] Collecting URLs from repo…');
  const urls = await collectAllUrls();
  console.error(`[url-health] ${urls.length} unique URLs found.`);

  const prev = await loadCache();

  if (DIFF_ONLY) {
    // Print last cache's summary without re-probing
    const totalBroken = Object.values(prev.byUrl).filter((e) => e.status === 'broken' || e.status === 'timeout').length;
    console.log(JSON.stringify({
      lastSweepAt: prev.lastSweepAt,
      totalUrls: Object.keys(prev.byUrl).length,
      totalBroken
    }, null, 2));
    return;
  }

  console.error(`[url-health] Probing ${urls.length} URLs (concurrency=${CONCURRENT}, timeout=${TIMEOUT_MS}ms)…`);
  const t0 = Date.now();
  const results = await probeAll(urls);
  const ms = Date.now() - t0;
  console.error(`[url-health] Probed ${results.length} URLs in ${(ms / 1000).toFixed(1)}s.`);

  const next = mergeIntoCache(prev, results);
  const diff = diffSweeps(prev, next);

  const summary = {
    lastSweepAt: NOW,
    urlCount: urls.length,
    statusBreakdown: results.reduce((a, r) => {
      a[r.status] = (a[r.status] || 0) + 1;
      return a;
    }, {}),
    newlyBroken: diff.newlyBroken,
    stillBroken: diff.stillBroken.slice(0, 50),  // cap for readability
    recovered: diff.recovered
  };

  if (!DRY_RUN) {
    await fs.writeFile(CACHE_PATH, JSON.stringify(next, null, 2) + '\n');
    console.error(`[url-health] Cache written to ${path.relative(ROOT, CACHE_PATH)}`);
  } else {
    console.error('[url-health] --dry-run: cache NOT written.');
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error('[url-health] FATAL:', err);
  process.exit(2);
});
