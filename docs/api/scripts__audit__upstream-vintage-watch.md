# `scripts/audit/upstream-vintage-watch.mjs`

## Symbols

### `watchHudChas()`

scripts/audit/upstream-vintage-watch.mjs

Watches external data publishers for new vintage releases. Runs weekly
on cron and opens a tracking GitHub issue when a newer vintage is
available than the one we currently use.

Background — why this exists
----------------------------
Most upstream data providers (HUD CHAS, HUD FMR, Census ACS) publish
new vintages on a known annual cadence but with no API alerting. Without
an automated watcher, "new CHAS vintage shipped 6 months ago and we
never upgraded" is the kind of slow drift that's easy to miss.

This watcher does two things:
  1. For each tracked source, scrape or query its release index for
     the most recent vintage label (year range, version string, etc.)
  2. Compare against the vintage hardcoded in our fetch scripts. When
     newer, open or update a tracking issue.

Sources currently tracked (extend as new ingest pipelines are added)
----------------------------------------------------------------------
  - HUD CHAS:  scrape https://www.huduser.gov/portal/datasets/cp.html
               for "20XXthruYY-140-csv.zip" download links
  - HUD FMR:   scrape https://www.huduser.gov/portal/datasets/fmr.html
               for fiscal year tags
  - Census ACS 5-year:  Census release schedule is fixed (annual
               December); rather than scraping, we just check the
               most recent year that the API returns data for

Output
------
  data/audit/upstream-vintage-watch.json — most recent watch result
  GitHub issue (auto-created when newer vintage found)

Exit codes
----------
  0  — watch completed (regardless of findings)
  1  — internal error (network failure, parse failure)

Usage
-----
  node scripts/audit/upstream-vintage-watch.mjs
  node scripts/audit/upstream-vintage-watch.mjs --json
/

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
HUD CHAS vintage detection — scrapes the dataset listing page for
download links matching `<startYear>thru<endYear>-140-csv.zip` pattern.
Returns the latest year-range found.

### `watchHudFmr()`

HUD FMR — typically published annually in April; we read the
generated fiscal year out of data/hud-fmr-income-limits.json and
compare against the current US fiscal year.

### `watchAcs5Year()`

Census ACS 5-year — Census Bureau publishes new vintages every December.
We check what year build_place_ami_gap.py is configured for.
