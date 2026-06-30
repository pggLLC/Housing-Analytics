#!/usr/bin/env node
/**
 * Re-stamp HNA summary files with committed median home value cascade values.
 *
 * This is the CI-safe companion to build_home_value_cascade.mjs. It does not
 * need the gitignored Zillow CSV; it treats data/hna/home-value-cascade.json
 * as the source of truth and restores acsProfile.median_home_value after an
 * ACS summary refresh.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const CASCADE_PATH = path.join(ROOT, 'data', 'hna', 'home-value-cascade.json');
const SUMMARY_DIR = path.join(ROOT, 'data', 'hna', 'summary');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function median(values) {
  const kept = values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!kept.length) return null;
  const mid = Math.floor(kept.length / 2);
  return kept.length % 2 ? kept[mid] : (kept[mid - 1] + kept[mid]) / 2;
}

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function stringifyPythonCompact(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((item) => stringifyPythonCompact(item)).join(', ') + ']';
  return '{' + Object.entries(value)
    .map(([key, item]) => `${JSON.stringify(key)}: ${stringifyPythonCompact(item)}`)
    .join(', ') + '}';
}

function cloneDisplay(display) {
  const out = {
    value: safeNumber(display && display.value),
    source: display && display.source ? String(display.source) : 'acs_raw',
    as_of: display && display.as_of ? String(display.as_of) : 'unknown vintage',
    confidence: display && display.confidence ? String(display.confidence) : 'unknown',
  };
  if (display && display.zillow_region_id != null) out.zillow_region_id = String(display.zillow_region_id);
  const raw = safeNumber(display && display.acs_raw_value);
  if (raw !== null) out.acs_raw_value = raw;
  return out;
}

function countyRatiosFromCascade(cascade, summaries) {
  const byCounty = new Map();
  for (const [geoid, display] of Object.entries(cascade.places || {})) {
    if (!display || display.source !== 'zhvi') continue;
    const summary = summaries.get(geoid);
    const county = summary && summary.geo && summary.geo.containingCounty;
    const acsRaw = safeNumber(display.acs_raw_value);
    const value = safeNumber(display.value);
    if (!county || !acsRaw || !value) continue;
    const ratio = value / acsRaw;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    if (!byCounty.has(county)) byCounty.set(county, []);
    byCounty.get(county).push(ratio);
  }
  return new Map([...byCounty.entries()].map(([county, ratios]) => [county, median(ratios)]));
}

function maybeCountyAdjusted(display, summary, countyRatios) {
  const profile = summary.acsProfile || {};
  const value = safeNumber(display.value);
  const rent = safeNumber(profile.DP04_0134E);
  const county = summary.geo && summary.geo.containingCounty;
  if (display.source !== 'acs_raw' || !value || !rent || !county) return display;

  const priceToAnnualRent = value / (rent * 12);
  const ratio = countyRatios.get(county);
  if (!Number.isFinite(priceToAnnualRent) || priceToAnnualRent >= 10 || !ratio) return display;

  return {
    value: Math.round(value * ratio),
    source: 'county_zhvi_adjusted',
    as_of: display.as_of,
    confidence: 'low',
    acs_raw_value: value,
    county_fips: county,
    county_zhvi_to_acs_ratio: Number(ratio.toFixed(3)),
    adjustment_note: 'ACS raw owner value had price-to-annual-rent below 10; adjusted by median ZHVI-to-ACS ratio from same-county matched places.',
  };
}

function maybeSuppressIncomeToOwn(display, summary) {
  if (!['acs_raw', 'county_zhvi_adjusted'].includes(display.source)) return display;
  const value = safeNumber(display.value);
  const rent = safeNumber(summary.acsProfile && summary.acsProfile.DP04_0134E);
  if (!value || !rent) return display;
  const priceToAnnualRent = value / (rent * 12);
  if (!Number.isFinite(priceToAnnualRent) || priceToAnnualRent >= 10) return display;
  return {
    ...display,
    suppress_income_to_own: true,
    suppress_reason: 'ACS-derived owner value remains below 10x annual median gross rent after cascade fallback; income-to-own is suppressed rather than publishing a likely under-estimate.',
  };
}

function main() {
  const cascade = readJson(CASCADE_PATH);
  const summaryFiles = fs.readdirSync(SUMMARY_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort();
  const summaries = new Map();
  for (const file of summaryFiles) {
    const geoid = file.replace(/\.json$/, '');
    summaries.set(geoid, readJson(path.join(SUMMARY_DIR, file)));
  }

  const countyRatios = countyRatiosFromCascade(cascade, summaries);
  let stamped = 0;
  let adjusted = 0;
  let suppressed = 0;
  let missing = 0;

  for (const [geoid, summary] of summaries.entries()) {
    const display = cascade.places && cascade.places[geoid] ? cloneDisplay(cascade.places[geoid]) : null;
    if (!display) {
      missing += 1;
      continue;
    }
    const finalDisplay = maybeSuppressIncomeToOwn(maybeCountyAdjusted(display, summary, countyRatios), summary);
    if (finalDisplay.source === 'county_zhvi_adjusted') adjusted += 1;
    if (finalDisplay.suppress_income_to_own) suppressed += 1;
    summary.acsProfile = summary.acsProfile || {};
    summary.acsProfile.median_home_value = finalDisplay;
    const summaryPath = path.join(SUMMARY_DIR, `${geoid}.json`);
    const next = stringifyPythonCompact(summary);
    const current = fs.readFileSync(summaryPath, 'utf8').trimEnd();
    if (current !== next) fs.writeFileSync(summaryPath, next);
    stamped += 1;
  }

  console.log(`home-value cascade stamp: ${stamped} summaries, ${adjusted} county-adjusted, ${suppressed} suppressed, ${missing} without cascade rows`);
}

main();
