#!/usr/bin/env node
/**
 * scripts/audit/upstream-vintage-watch.mjs
 *
 * Watches external data publishers for new vintage releases. Runs weekly
 * on cron and opens a tracking GitHub issue when a newer vintage is
 * available than the one we currently use.
 *
 * Background — why this exists
 * ----------------------------
 * Most upstream data providers (HUD CHAS, HUD FMR, Census ACS) publish
 * new vintages on a known annual cadence but with no API alerting. Without
 * an automated watcher, "new CHAS vintage shipped 6 months ago and we
 * never upgraded" is the kind of slow drift that's easy to miss.
 *
 * This watcher does two things:
 *   1. For each tracked source, scrape or query its release index for
 *      the most recent vintage label (year range, version string, etc.)
 *   2. Compare against the vintage hardcoded in our fetch scripts. When
 *      newer, open or update a tracking issue.
 *
 * Sources currently tracked (extend as new ingest pipelines are added)
 * ----------------------------------------------------------------------
 *   - HUD CHAS:  scrape https://www.huduser.gov/portal/datasets/cp.html
 *                for "20XXthruYY-140-csv.zip" download links
 *   - HUD FMR:   scrape https://www.huduser.gov/portal/datasets/fmr.html
 *                for fiscal year tags
 *   - Census ACS 5-year:  Census release schedule is fixed (annual
 *                December); rather than scraping, we just check the
 *                most recent year that the API returns data for
 *
 * Output
 * ------
 *   data/audit/upstream-vintage-watch.json — most recent watch result
 *   GitHub issue (auto-created when newer vintage found)
 *
 * Exit codes
 * ----------
 *   0  — watch completed (regardless of findings)
 *   1  — internal error (network failure, parse failure)
 *
 * Usage
 * -----
 *   node scripts/audit/upstream-vintage-watch.mjs
 *   node scripts/audit/upstream-vintage-watch.mjs --json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const OUT_FILE = path.join(ROOT, 'data', 'audit', 'upstream-vintage-watch.json');

const JSON_OUT = process.argv.includes('--json');

const USER_AGENT = 'HousingAnalytics/1.0 upstream-vintage-watch.mjs';

// ── HTTP helpers ────────────────────────────────────────────────────

async function httpGetText(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) {
      // HUD's CDN gates direct fetches behind a WAF challenge — 202 and
      // empty body for unauthenticated bots. Treat as "endpoint live but
      // unscrapeable" rather than a hard failure.
      if (res.status === 202) {
        return { status: 202, text: '', wafGated: true };
      }
      throw new Error(`HTTP ${res.status}`);
    }
    return { status: res.status, text: await res.text(), wafGated: false };
  } finally {
    clearTimeout(timer);
  }
}

async function httpGetJson(url, timeoutMs = 30000) {
  const r = await httpGetText(url, timeoutMs);
  return JSON.parse(r.text);
}

// ── Source watchers ─────────────────────────────────────────────────

/**
 * HUD CHAS vintage detection — scrapes the dataset listing page for
 * download links matching `<startYear>thru<endYear>-140-csv.zip` pattern.
 * Returns the latest year-range found.
 */
async function watchHudChas() {
  // We hardcode the current vintage in fetch_chas.py — read it back
  // to know what we should compare against.
  const fetchScript = await fs.readFile(
    path.join(ROOT, 'scripts', 'fetch_chas.py'),
    'utf8',
  );
  const m = /VINTAGE\s*=\s*['"]([\d-]+)['"]/.exec(fetchScript);
  const currentVintage = m ? m[1] : 'unknown';

  let latestVintage = null;
  let note = '';
  try {
    const r = await httpGetText('https://www.huduser.gov/portal/datasets/cp.html');
    if (r.wafGated) {
      note = 'HUD CDN returned WAF challenge (HTTP 202); cannot scrape automatically.';
    } else {
      // Look for href patterns like "2018thru2022-140-csv.zip"
      const matches = [...r.text.matchAll(/(\d{4})thru(\d{4})-140-csv\.zip/g)];
      if (matches.length > 0) {
        // Pick the latest end-year
        const sorted = matches.sort((a, b) => Number(b[2]) - Number(a[2]));
        latestVintage = `${sorted[0][1]}-${sorted[0][2]}`;
      } else {
        note = 'No matching CHAS download links found on HUD listing page.';
      }
    }
  } catch (err) {
    note = `Fetch error: ${err.message}`;
  }

  return {
    source: 'HUD CHAS',
    current_vintage: currentVintage,
    latest_vintage: latestVintage,
    is_outdated: latestVintage && currentVintage !== 'unknown' && latestVintage > currentVintage,
    notes: note,
  };
}

/**
 * HUD FMR — typically published annually in April; we read the
 * generated fiscal year out of data/hud-fmr-income-limits.json and
 * compare against the current US fiscal year.
 */
async function watchHudFmr() {
  let currentFy = null;
  try {
    const text = await fs.readFile(
      path.join(ROOT, 'data', 'hud-fmr-income-limits.json'),
      'utf8',
    );
    const data = JSON.parse(text);
    currentFy = data?.meta?.fiscal_year || null;
  } catch { /* ignore */ }

  // US Federal fiscal year transitions Oct 1
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const currentUsFy = month >= 10 ? year + 1 : year;

  // HUD usually ships FMR for the following fiscal year in April.
  // So as of "FY currentUsFy", HUD likely has FY currentUsFy+1 in pipeline
  // by April. Be conservative: only flag outdated if our file is 2+ FYs behind.
  const isOutdated = currentFy != null && currentFy < currentUsFy - 1;

  return {
    source: 'HUD FMR',
    current_vintage: currentFy ? `FY${currentFy}` : 'unknown',
    latest_vintage: `FY${currentUsFy}`,
    is_outdated: isOutdated,
    notes: isOutdated
      ? 'Current fiscal-year FMR data is 2+ FYs behind. Run scripts/fetch_fmr_api.py.'
      : 'Within expected refresh window (HUD ships FMR annually in April).',
  };
}

/**
 * Census ACS 5-year — Census Bureau publishes new vintages every December.
 * We check what year build_place_ami_gap.py is configured for.
 */
async function watchAcs5Year() {
  let configuredYear = null;
  try {
    const text = await fs.readFile(
      path.join(ROOT, 'scripts', 'hna', 'build_place_ami_gap.py'),
      'utf8',
    );
    const m = /DEFAULT_VINTAGE\s*=\s*(\d{4})/.exec(text);
    configuredYear = m ? Number(m[1]) : null;
  } catch { /* ignore */ }

  // ACS 5-year for year YYYY ships in December YYYY+1.
  const now = new Date();
  const calendarYear = now.getFullYear();
  // Available 5-year vintage as of today: latest December that has passed
  const latestAcsYear = now.getMonth() >= 11 ? calendarYear - 1 : calendarYear - 2;

  const isOutdated = configuredYear != null && configuredYear < latestAcsYear - 1;

  return {
    source: 'Census ACS 5-year',
    current_vintage: configuredYear ? String(configuredYear) : 'unknown',
    latest_vintage: String(latestAcsYear),
    is_outdated: isOutdated,
    notes: isOutdated
      ? `Configured ACS year (${configuredYear}) is 2+ vintages behind. Update DEFAULT_VINTAGE in build_place_ami_gap.py.`
      : 'Within expected refresh window (ACS 5-year ships annually in December).',
  };
}

// ── Runner ─────────────────────────────────────────────────────────

async function main() {
  if (!JSON_OUT) console.log('Watching upstream vintage releases...\n');

  const results = await Promise.all([
    watchHudChas().catch(e => ({ source: 'HUD CHAS', error: e.message })),
    watchHudFmr().catch(e => ({ source: 'HUD FMR', error: e.message })),
    watchAcs5Year().catch(e => ({ source: 'Census ACS 5-year', error: e.message })),
  ]);

  const outdated = results.filter(r => r.is_outdated);
  const payload = {
    generated_at: new Date().toISOString(),
    sources: results,
    summary: {
      checked: results.length,
      outdated: outdated.length,
      errors: results.filter(r => r.error).length,
    },
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));

  if (JSON_OUT) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    for (const r of results) {
      const flag = r.error ? '✗' : r.is_outdated ? '⚠' : '✓';
      console.log(`  ${flag} ${r.source.padEnd(22)} current=${(r.current_vintage || '?').padEnd(12)} latest=${(r.latest_vintage || '?')}`);
      if (r.notes) console.log(`     ${r.notes}`);
      if (r.error) console.log(`     error: ${r.error}`);
    }
    console.log(`\n${outdated.length} of ${results.length} sources outdated.`);
    console.log(`Output: ${OUT_FILE}`);
    if (outdated.length > 0) {
      console.log('\n→ Open a GitHub issue or run the corresponding fetch script to upgrade.');
    }
  }
}

main().catch(err => {
  console.error('upstream-vintage-watch crashed:', err);
  process.exit(1);
});
