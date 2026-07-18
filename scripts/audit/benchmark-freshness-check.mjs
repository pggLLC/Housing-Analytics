#!/usr/bin/env node
/**
 * scripts/audit/benchmark-freshness-check.mjs — F(#1147)
 *
 * Why this exists
 * ----------------
 * The Deal Calculator cites two static market-benchmark snapshots:
 *
 *   - data/market/novogradac-equity-pricing.json   (LIHTC equity pricing)
 *   - data/market/freddie-mac-multifamily-outlook.json (rates/cap-rate outlook)
 *   - data/market/tax-credit-transfer-pricing.json (tax-credit transfer pricing)
 *   - data/market/colorado-equity-pricing-factors.json (CO-specific LIHTC pricing factors)
 *   - data/policy/tax-credit-legislation.json (tax-credit legislation watchlist)
 *   - data/policy/homeownership-programs.json (consumer homebuyer program watchlist)
 *   - data/policy/lihtc-assumptions.json (predictor non-pricing assumptions)
 *   - data/market/colorado-foreclosure-performance.json (FHFA NMDB foreclosure performance)
 *
 * Each was added in a one-time commit and has no refresh workflow. The UI
 * discloses the vintage honestly (shows `as_of` inline, links the source,
 * tells the user to verify before quoting), so a stale file is not a live
 * bug — but nothing surfaces staleness to a developer until a user notices.
 * This script makes it visible on demand.
 *
 * NOT the same thing as scripts/audit/data-freshness-check.mjs: that script
 * enforces SLAs on pipeline-generated files (and fails CI when violated).
 * These two files are hand-captured external snapshots with a *stated
 * update cadence*; staleness here is advisory. Warn-only, always exits 0,
 * and deliberately NOT part of test:ci.
 *
 * What it checks, per file:
 *   1. `review_by` dates (when present in meta or entries) have not passed.
 *   2. `meta.next_expected_update` (when present) has not passed.
 *   3. `meta.as_of` (falling back to `meta.vintage`) is not older than
 *      STALE_AFTER_DAYS (60 — both sources publish roughly quarterly).
 *
 * Date parsing accepts, in order:
 *   - ISO dates ("2026-07-01")
 *   - Month-name references ("early August 2026" → 2026-08-01)
 *   - Quarter strings ("2026-Q3" → end of that quarter, since an update
 *     "expected in Q3" isn't overdue until Q3 ends)
 *
 * Usage:
 *   node scripts/audit/benchmark-freshness-check.mjs
 *   npm run audit:benchmark-freshness
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const STALE_AFTER_DAYS = 60;

const BENCHMARK_FILES = [
  {
    file: 'data/market/novogradac-equity-pricing.json',
    label: 'Novogradac LIHTC equity pricing',
  },
  {
    file: 'data/market/freddie-mac-multifamily-outlook.json',
    label: 'Freddie Mac multifamily outlook',
  },
  {
    file: 'data/market/tax-credit-transfer-pricing.json',
    label: 'Tax-credit transfer pricing',
    reviewByPaths: ['meta.review_by', 'markets[].review_by'],
  },
  {
    file: 'data/market/colorado-equity-pricing-factors.json',
    label: 'Colorado LIHTC equity pricing factors',
    reviewByPaths: ['meta.review_by'],
  },
  {
    file: 'data/policy/tax-credit-legislation.json',
    label: 'Tax-credit legislation watchlist',
    reviewByPaths: ['meta.review_by', 'entries[].review_by'],
  },
  {
    file: 'data/policy/homeownership-programs.json',
    label: 'Homeownership programs watchlist',
    reviewByPaths: ['meta.review_by', 'programs[].review_by'],
  },
  {
    file: 'data/policy/lihtc-assumptions.json',
    label: 'LIHTC predictor assumptions',
    reviewByPaths: ['meta.review_by'],
  },
  {
    file: 'data/market/colorado-foreclosure-performance.json',
    label: 'Colorado foreclosure performance',
    reviewByPaths: ['meta.review_by'],
  },
];

const MONTHS = ['january','february','march','april','may','june','july',
                'august','september','october','november','december'];

/**
 * Best-effort parse of a "when" string into a Date, or null.
 * Order: ISO date → "Month YYYY" → "YYYY-Qn" (end of quarter).
 */
function parseWhen(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));

  const monthName = s.toLowerCase().match(
    new RegExp(`(${MONTHS.join('|')})\\s+(\\d{4})`));
  if (monthName) {
    return new Date(Date.UTC(+monthName[2], MONTHS.indexOf(monthName[1]), 1));
  }

  const quarter = s.match(/(\d{4})-?Q([1-4])/i);
  if (quarter) {
    // Last day of the quarter: month index q*3, day 0 = previous month's end.
    return new Date(Date.UTC(+quarter[1], +quarter[2] * 3, 0));
  }

  return null;
}

function daysBetween(a, b) {
  return Math.floor((b - a) / 86_400_000);
}

function valuesAtPath(root, pathExpr) {
  const parts = String(pathExpr || '').split('.');
  let values = [root];
  for (const part of parts) {
    const next = [];
    const isArray = part.endsWith('[]');
    const key = isArray ? part.slice(0, -2) : part;
    for (const value of values) {
      if (!value || typeof value !== 'object') continue;
      const child = value[key];
      if (isArray) {
        if (Array.isArray(child)) next.push(...child);
      } else {
        next.push(child);
      }
    }
    values = next;
  }
  return values.filter((value) => value != null && value !== '');
}

const now = process.env.BENCHMARK_FRESHNESS_NOW
  ? parseWhen(process.env.BENCHMARK_FRESHNESS_NOW) || new Date(process.env.BENCHMARK_FRESHNESS_NOW)
  : new Date();
const warnings = [];
let checked = 0;

for (const { file, label, reviewByPaths = [] } of BENCHMARK_FILES) {
  let parsed;
  let meta;
  try {
    parsed = JSON.parse(await fs.readFile(path.join(ROOT, file), 'utf8'));
    meta = parsed.meta || {};
  } catch (err) {
    warnings.push(`${label}: could not read/parse ${file} (${err.message})`);
    continue;
  }
  checked++;

  for (const pathExpr of reviewByPaths) {
    const reviewDates = valuesAtPath(parsed, pathExpr);
    if (!reviewDates.length) {
      warnings.push(`${label}: no review_by values found at ${pathExpr}`);
      continue;
    }
    for (const raw of reviewDates) {
      const reviewBy = parseWhen(raw);
      if (!reviewBy) {
        warnings.push(`${label}: review_by ${JSON.stringify(raw)} at ${pathExpr} is unparseable`);
      } else if (reviewBy < now) {
        warnings.push(
          `${label}: review_by ${raw} at ${pathExpr} has passed — ` +
          `re-verify the source cited in ${file}`);
      }
    }
  }

  const asOfRaw = meta.as_of || meta.vintage || null;
  const asOf = parseWhen(asOfRaw);
  if (!asOf) {
    warnings.push(`${label}: no parseable as_of/vintage in meta (${JSON.stringify(asOfRaw)})`);
  } else {
    const age = daysBetween(asOf, now);
    if (age > STALE_AFTER_DAYS) {
      warnings.push(
        `${label}: snapshot is ${age} days old (as_of ${asOfRaw}, threshold ${STALE_AFTER_DAYS}d) — ` +
        `re-capture from the source cited in ${file}`);
    }
  }

  const nextRaw = meta.next_expected_update || null;
  const next = parseWhen(nextRaw);
  if (nextRaw && !next) {
    warnings.push(`${label}: next_expected_update ${JSON.stringify(nextRaw)} is unparseable`);
  } else if (next && next < now) {
    warnings.push(
      `${label}: next expected update (${nextRaw}) has passed with no refresh — ` +
      `re-capture from the source cited in ${file}`);
  }
}

console.log(`benchmark-freshness-check: ${checked}/${BENCHMARK_FILES.length} benchmark files read`);
if (warnings.length) {
  console.log(`\n⚠ ${warnings.length} staleness warning(s) (advisory — the UI already discloses vintages):\n`);
  for (const w of warnings) console.log(`  - ${w}`);
} else {
  console.log('✓ All benchmark snapshots within their stated cadence.');
}

// Warn-only by design (see header). Never fails a build.
process.exit(0);
