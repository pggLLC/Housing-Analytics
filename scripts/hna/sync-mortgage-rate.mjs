#!/usr/bin/env node
// Sets OwnershipFinance.MORTGAGE_RATE (js/hna/ownership-finance.js) and the
// kernel's engine-less fallback (js/hna/hna-ownership-need.js) to the latest
// Freddie Mac PMMS week in data/fred-data.json (MORTGAGE30US).
//
// The Saturday HNA build runs this before it rebuilds the ranking index and the
// jurisdiction digests, so the week every homeownership figure prints moves
// with the data instead of waiting for someone to edit it by hand.
//
//   node scripts/hna/sync-mortgage-rate.mjs          rewrite both files if the week changed
//   node scripts/hna/sync-mortgage-rate.mjs --check  exit 1 if they are behind the FRED file
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENGINE = path.join(ROOT, 'js/hna/ownership-finance.js');
const KERNEL = path.join(ROOT, 'js/hna/hna-ownership-need.js');

export function latestReading(fred) {
  const series = fred && fred.series && fred.series.MORTGAGE30US;
  const obs = (series && series.observations) || [];
  for (let i = obs.length - 1; i >= 0; i -= 1) {
    const value = Number(obs[i].value);
    // A missing week reads "." in FRED; a rate outside 1–20% is not a reading.
    if (/^\d{4}-\d{2}-\d{2}$/.test(obs[i].date) && Number.isFinite(value) && value > 1 && value < 20) {
      return { week: obs[i].date, rateAnnual: Math.round(value * 100) / 10000 };
    }
  }
  return null;
}

export function sourceText(week) {
  const shown = new Date(week + 'T00:00:00Z').toLocaleDateString('en-US',
    { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return 'Freddie Mac PMMS 30-year fixed average, week of ' + shown;
}

function replaceOnce(text, pattern, replacement, file) {
  const matches = text.match(new RegExp(pattern.source, 'g')) || [];
  if (matches.length !== 1) throw new Error(`${path.relative(ROOT, file)}: expected one match for ${pattern}, found ${matches.length}`);
  return text.replace(pattern, replacement);
}

export function rewrite(engineSrc, kernelSrc, reading) {
  const src = sourceText(reading.week);
  const engine = replaceOnce(engineSrc,
    /var MORTGAGE_RATE = \{\n\s+rateAnnual: [\d.]+,\n\s+week: '[\d-]+',\n\s+series: 'MORTGAGE30US',\n\s+source: '[^']*',\n\s+\};/,
    `var MORTGAGE_RATE = {\n    rateAnnual: ${reading.rateAnnual},\n    week: '${reading.week}',\n    series: 'MORTGAGE30US',\n    source: '${src}',\n  };`, ENGINE);
  let kernel = replaceOnce(kernelSrc, /(pmms30YearRate: MORTGAGE_RATE \? MORTGAGE_RATE\.rateAnnual : )[\d.]+/, `$1${reading.rateAnnual}`, KERNEL);
  kernel = replaceOnce(kernel, /(pmmsDate: MORTGAGE_RATE \? MORTGAGE_RATE\.week : )'[\d-]+'/, `$1'${reading.week}'`, KERNEL);
  kernel = replaceOnce(kernel, /(pmmsSource: MORTGAGE_RATE \? MORTGAGE_RATE\.source : )'[^']*'/, `$1'${src}'`, KERNEL);
  return { engine, kernel };
}

function main() {
  const check = process.argv.includes('--check');
  const fred = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/fred-data.json'), 'utf8'));
  const reading = latestReading(fred);
  if (!reading) {
    // Leave the last good week in place; the staleness test reports it.
    console.warn('[sync-mortgage-rate] no usable MORTGAGE30US reading in data/fred-data.json; rate left unchanged');
    process.exit(check ? 1 : 0);
  }
  const engineSrc = fs.readFileSync(ENGINE, 'utf8');
  const kernelSrc = fs.readFileSync(KERNEL, 'utf8');
  const next = rewrite(engineSrc, kernelSrc, reading);
  const changed = next.engine !== engineSrc || next.kernel !== kernelSrc;
  if (check) {
    console.log(changed ? `[sync-mortgage-rate] behind: FRED has ${reading.week} at ${(reading.rateAnnual * 100).toFixed(2)}%` : '[sync-mortgage-rate] current');
    process.exit(changed ? 1 : 0);
  }
  if (changed) {
    fs.writeFileSync(ENGINE, next.engine);
    fs.writeFileSync(KERNEL, next.kernel);
  }
  console.log(`[sync-mortgage-rate] ${changed ? 'set' : 'already at'} ${(reading.rateAnnual * 100).toFixed(2)}%, week of ${reading.week}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
