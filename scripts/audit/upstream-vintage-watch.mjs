#!/usr/bin/env node
/**
 * scripts/audit/upstream-vintage-watch.mjs
 *
 * Watches external data publishers for new vintage releases. Runs weekly
 * on cron and opens or updates one tracking issue for a newer vintage or
 * an unverifiable check that needs human attention.
 *
 * Background — why this exists
 * ----------------------------
 * Most upstream data providers (HUD CHAS, HUD FMR, Census ACS) publish
 * new vintages on a known annual cadence but with no API alerting. Without
 * an automated watcher, "new CHAS vintage shipped 6 months ago and we
 * never upgraded" is the kind of slow drift that's easy to miss.
 *
 * This watcher does two things:
 *   1. Check the configured vintage against source-specific evidence.
 *   2. Record outdated or unverifiable results for the workflow's issue tracker.
 *
 * Sources currently tracked
 * -------------------------
 *   - HUD CHAS: current-vintage ZIP control, then candidate ZIP probes.
 *     A blocked response requires a manual check of the HUD download page.
 *   - HUD FMR and Census ACS 5-year: calendar-based refresh heuristics,
 *     not HTTP probes or confirmation that a new release is published.
 *
 * Output
 * ------
 *   data/audit/upstream-vintage-watch.json — most recent watch result
 *   GitHub issue (auto-created/updated for outdated or unverifiable sources)
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

// A status alone cannot distinguish a ZIP from a 200 HTML challenge. Read only
// the ZIP prefix, then cancel the response; never download the full archive here.
async function probeHudZip(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let response;
  let reader;
  try {
    response = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    const http = `HTTP ${response.status}`;
    if (response.status === 404) return { kind: 'not_published', detail: http };
    if (response.status !== 200) return { kind: 'unverifiable', detail: http };
    if (/html/i.test(response.headers.get('content-type') || '')) {
      return { kind: 'unverifiable', detail: `${http}; HTML response` };
    }
    reader = response.body?.getReader();
    const prefix = [];
    while (reader && prefix.length < 2) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const byte of value.subarray(0, 2 - prefix.length)) prefix.push(byte);
    }
    if (prefix[0] !== 0x50 || prefix[1] !== 0x4b) {
      return { kind: 'unverifiable', detail: `${http}; empty or non-ZIP response` };
    }
    return { kind: 'published', detail: http };
  } catch (error) {
    return { kind: 'unverifiable', detail: `network error: ${error.message}` };
  } finally {
    controller.abort();
    clearTimeout(timer);
    try {
      if (reader) await reader.cancel();
      else if (response?.body) await response.body.cancel();
    } catch { /* The aborted stream may already be closed. */ }
  }
}

/** Check the known published archive before probing possible newer vintages. */
export async function watchHudChas(fetchImpl = fetch) {
  const fetchScript = await fs.readFile(path.join(ROOT, 'scripts', 'fetch_chas.py'), 'utf8');
  const m = /(^|[^A-Z0-9_])VINTAGE\s*=\s*['"]([\d-]+)['"]/m.exec(fetchScript);
  const currentVintage = m ? m[2] : 'unknown';
  const base = { source: 'HUD CHAS', current_vintage: currentVintage };
  const unverifiable = (notes) => ({
    ...base, latest_vintage: null, is_outdated: null, status: 'unverifiable', notes,
  });
  if (!/^\d{4}-\d{4}$/.test(currentVintage)) {
    return unverifiable('Could not parse current CHAS VINTAGE from fetch_chas.py; CHAS vintage not checked');
  }
  const [curStart, curEnd] = currentVintage.split('-').map(Number);
  const archiveUrl = (bump) =>
    `https://www.huduser.gov/portal/datasets/cp/${curStart + bump}thru${curEnd + bump}-140-csv.zip`;
  const control = await probeHudZip(archiveUrl(0), fetchImpl);
  if (control.kind !== 'published') {
    return unverifiable(`HUD blocks automated requests (${control.detail}); CHAS vintage not checked`);
  }
  // Walk up to three years for skipped releases. Only a 404 establishes absence;
  // an ambiguous candidate must not produce a "no newer vintage" conclusion.
  for (let bump = 1; bump <= 3; bump++) {
    const candidate = await probeHudZip(archiveUrl(bump), fetchImpl);
    if (candidate.kind === 'published') {
      return {
        ...base, latest_vintage: `${curStart + bump}-${curEnd + bump}`,
        is_outdated: true, status: 'verified',
        notes: 'Newer CHAS ZIP detected after verifying the current-vintage control.',
      };
    }
    if (candidate.kind !== 'not_published') {
      return unverifiable(`HUD candidate probe unverifiable (${candidate.detail}); CHAS vintage not checked`);
    }
  }
  return {
    ...base, latest_vintage: null, is_outdated: false, status: 'verified',
    notes: `No newer CHAS vintage published (current ZIP verified; candidates through ${curStart + 3}-${curEnd + 3} returned 404).`,
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

export function buildWatchPayload(results) {
  return {
    generated_at: new Date().toISOString(),
    sources: results,
    summary: {
      checked: results.length,
      outdated: results.filter(r => r.is_outdated).length,
      errors: results.filter(r => r.error || r.status === 'unverifiable').length,
    },
  };
}

async function main() {
  if (!JSON_OUT) console.log('Watching upstream vintage releases...\n');

  const results = await Promise.all([
    watchHudChas().catch(e => ({ source: 'HUD CHAS', error: e.message })),
    watchHudFmr().catch(e => ({ source: 'HUD FMR', error: e.message })),
    watchAcs5Year().catch(e => ({ source: 'Census ACS 5-year', error: e.message })),
  ]);

  const payload = buildWatchPayload(results);
  const outdated = results.filter(r => r.is_outdated);

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(payload, null, 2));

  if (JSON_OUT) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    for (const r of results) {
      const flag = r.error || r.status === 'unverifiable' ? '✗' : r.is_outdated ? '⚠' : '✓';
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error('upstream-vintage-watch crashed:', err);
    process.exit(1);
  });
}
