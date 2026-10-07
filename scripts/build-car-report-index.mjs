#!/usr/bin/env node
/**
 * scripts/build-car-report-index.mjs — write data/car-market-reports.json, the
 * list of monthly CAR reports that actually exist (#2053).
 *
 * The HNA pages used to find the newest report by asking for the current
 * calendar month and stepping back. On the 1st of every month that file does
 * not exist until car-data-update.yml lands (~3h after its cron), so every page
 * load logged a 404 and the rendered smoke failed six flows on every PR for a
 * third of a day. The pages now read this index and request only files in it.
 *
 * Deterministic: no timestamp, so a run that finds the same files writes the
 * same bytes. test/car-report-index.test.js fails if it disagrees with data/.
 *
 * Usage: node scripts/build-car-report-index.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const OUT = path.join(DATA, 'car-market-reports.json');
const PATTERN = /^car-market-report-(\d{4}-\d{2})\.json$/;

export function buildIndex(files) {
  const months = files.map((f) => (f.match(PATTERN) || [])[1]).filter(Boolean).sort().reverse();
  return {
    meta: {
      description: 'Monthly CAR market reports present in data/, newest first. Pages read this instead of guessing a filename from the calendar (#2053).',
      generated_by: 'scripts/build-car-report-index.mjs',
      file_pattern: 'data/car-market-report-YYYY-MM.json',
    },
    latest: months[0] || null,
    months,
  };
}

const INVOKED = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (INVOKED) {
  const body = JSON.stringify(buildIndex(fs.readdirSync(DATA)), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    if (current !== body) {
      console.error('data/car-market-reports.json is stale — run node scripts/build-car-report-index.mjs');
      process.exit(1);
    }
    console.log('data/car-market-reports.json matches data/.');
  } else {
    fs.writeFileSync(OUT, body);
    console.log(`Wrote ${path.relative(ROOT, OUT)} (${JSON.parse(body).months.length} reports, latest ${JSON.parse(body).latest})`);
  }
}
