#!/usr/bin/env node
/**
 * Build current-market median home value display fields for HNA places and
 * county HNA ownership-affordability screens.
 *
 * Tier 1: Zillow city ZHVI, matched once into a GEOID -> RegionID crosswalk.
 * Tier 2: raw ACS DP04_0089E, labeled as a stale floor when no ZHVI row exists.
 *
 * The rank/score model continues to ignore this display field.
 */
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

const ZHVI_CSV = path.join(ROOT, 'data', 'zillow', 'city_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv');
const CENTROIDS = path.join(ROOT, 'data', 'co-place-centroids.json');
const PLACE_COUNTIES = path.join(ROOT, 'data', 'hna', 'derived', 'place_county_lookup.json');
const REGISTRY = path.join(ROOT, 'data', 'hna', 'geography-registry.json');
const SUMMARY_DIR = path.join(ROOT, 'data', 'hna', 'summary');
const OUT = path.join(ROOT, 'data', 'hna', 'home-value-cascade.json');
const CROSSWALK_OUT = path.join(ROOT, 'data', 'hna', 'zhvi-place-crosswalk.json');
const FHFA_HPI = path.join(ROOT, 'data', 'market', 'fhfa_hpi_subcounty_co.json');
const ACS_HOME_VALUE_MIDPOINT_YEAR = 2022;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function normName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(city|town|cdp|village|county)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function countyNamesByFips(registry) {
  const out = {};
  for (const geo of registry.geographies || []) {
    if (geo.type === 'county') out[geo.geoid] = geo.name;
  }
  return out;
}

function latestMonth(headers) {
  for (let i = headers.length - 1; i >= 0; i -= 1) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(headers[i])) return { key: headers[i], idx: i };
  }
  throw new Error('No YYYY-MM-DD month column found in ZHVI CSV');
}

async function loadZhviRows() {
  if (!fs.existsSync(ZHVI_CSV)) {
    throw new Error(`Missing ${ZHVI_CSV}; download the public Zillow city ZHVI CSV first.`);
  }
  const input = fs.createReadStream(ZHVI_CSV);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let headers = null;
  let month = null;
  const byKey = new Map();
  let coRows = 0;

  for await (const line of rl) {
    if (!headers) {
      headers = parseCsvLine(line);
      month = latestMonth(headers);
      continue;
    }
    const row = parseCsvLine(line);
    if (row[headers.indexOf('State')] !== 'CO' && row[headers.indexOf('StateName')] !== 'CO') continue;
    const regionName = row[headers.indexOf('RegionName')];
    const countyName = row[headers.indexOf('CountyName')];
    const value = Number(row[month.idx]);
    if (!regionName || !countyName || !Number.isFinite(value) || value <= 0) continue;
    const key = normName(regionName) + '|' + normName(countyName);
    byKey.set(key, {
      regionId: row[headers.indexOf('RegionID')],
      regionName,
      countyName,
      value: Math.round(value),
      asOf: month.key,
    });
    coRows += 1;
  }
  return { byKey, latestAsOf: month.key, coRows };
}

function buildCountyAcsRows(registry, fhfaDoc) {
  const counties = {};
  let acsCount = 0;
  let missingCount = 0;
  let fhfaCount = 0;
  const latestYear = Number(fhfaDoc?.meta?.latest_year) || Number(String(fhfaDoc?.meta?.as_of || '').slice(0, 4)) || null;

  function countyHpiAdjustment(fhfa) {
    const latest = Number(fhfa?.hpi_latest);
    const base10 = Number(fhfa?.hpi_10y_base);
    if (!Number.isFinite(latest) || latest <= 0 || !Number.isFinite(base10) || base10 <= 0 || !Number.isFinite(latestYear)) return null;
    const baseYear = latestYear - 10;
    if (ACS_HOME_VALUE_MIDPOINT_YEAR <= baseYear || ACS_HOME_VALUE_MIDPOINT_YEAR >= latestYear) return null;
    const yearsFromMidpoint = latestYear - ACS_HOME_VALUE_MIDPOINT_YEAR;
    const annualizedRatio = Math.pow(latest / base10, 1 / (latestYear - baseYear));
    const adjustmentFactor = Math.pow(annualizedRatio, yearsFromMidpoint);
    if (!Number.isFinite(adjustmentFactor) || adjustmentFactor <= 0) return null;
    return {
      factor: adjustmentFactor,
      midpoint_hpi_estimate: latest / adjustmentFactor,
      method: `ACS 2020-2024 5-year midpoint (${ACS_HOME_VALUE_MIDPOINT_YEAR}) adjusted to FHFA ${latestYear} using county 10-year HPI CAGR`,
    };
  }

  for (const county of (registry.geographies || []).filter((geo) => geo.type === 'county').sort((a, b) => a.geoid.localeCompare(b.geoid))) {
    const summaryPath = path.join(SUMMARY_DIR, `${county.geoid}.json`);
    const summary = fs.existsSync(summaryPath) ? readJson(summaryPath) : null;
    const profile = summary && summary.acsProfile || {};
    const acsValue = Number(profile.DP04_0089E);
    const hasValue = Number.isFinite(acsValue) && acsValue > 0;
    const fhfa = fhfaDoc && fhfaDoc.counties && fhfaDoc.counties[county.geoid] || null;
    const hasFhfa = !!(fhfa && Number.isFinite(Number(fhfa.hpi_latest)));
    const adjustment = hasFhfa ? countyHpiAdjustment(fhfa) : null;
    const hasAdjustedFhfa = hasValue && !!adjustment;
    const value = hasAdjustedFhfa ? Math.round(acsValue * adjustment.factor) : (hasValue ? acsValue : null);
    counties[county.geoid] = {
      value,
      source: hasAdjustedFhfa ? 'fhfa_county_hpi_anchor' : 'acs_raw',
      as_of: hasAdjustedFhfa ? `ACS 2020-2024 5-year midpoint-adjusted to FHFA HPI ${fhfaDoc.meta && fhfaDoc.meta.as_of || ''}`.trim() : 'ACS 2020-2024 5-year',
      confidence: hasValue ? (hasAdjustedFhfa ? 'medium' : 'low') : 'missing',
      geography_level: 'county',
      acs_raw_value: hasValue ? acsValue : null,
      fhfa_hpi: hasAdjustedFhfa ? {
        source_level: fhfa.source_level,
        hpi_latest: fhfa.hpi_latest,
        hpi_10y_base: fhfa.hpi_10y_base,
        change_10y: fhfa.change_10y,
        acs_midpoint_year: ACS_HOME_VALUE_MIDPOINT_YEAR,
        midpoint_hpi_estimate: Number(adjustment.midpoint_hpi_estimate.toFixed(4)),
        adjustment_factor: Number(adjustment.factor.toFixed(6)),
        adjustment_method: adjustment.method,
        as_of: fhfaDoc.meta && fhfaDoc.meta.as_of,
        source_url: fhfaDoc.meta && fhfaDoc.meta.county_source_url,
      } : null,
    };
    if (hasValue) acsCount += 1;
    else missingCount += 1;
    if (hasAdjustedFhfa) fhfaCount += 1;
  }

  return { counties, acsCount, missingCount, fhfaCount };
}

async function main() {
  const centroids = readJson(CENTROIDS).byGeoid || {};
  const placeCounties = readJson(PLACE_COUNTIES).places || {};
  const registry = readJson(REGISTRY);
  const fhfaDoc = fs.existsSync(FHFA_HPI) ? readJson(FHFA_HPI) : null;
  const countyNames = countyNamesByFips(registry);
  const hasCityZhvi = fs.existsSync(ZHVI_CSV);
  const existing = fs.existsSync(OUT) ? readJson(OUT) : {};
  const zhviRows = hasCityZhvi ? await loadZhviRows() : null;
  const byKey = zhviRows ? zhviRows.byKey : new Map();
  const latestAsOf = zhviRows ? zhviRows.latestAsOf : (existing.meta && existing.meta.latest_zhvi_month) || null;
  const coRows = zhviRows ? zhviRows.coRows : (existing.meta && existing.meta.colorado_zhvi_rows) || 0;

  const places = {};
  const crosswalk = {};
  const review = [];
  let zhviCount = 0;
  let acsCount = 0;

  if (!hasCityZhvi && existing.places) {
    Object.assign(places, existing.places);
    const counts = existing.meta && existing.meta.counts || {};
    zhviCount = Number(counts.zhvi) || Object.values(places).filter((row) => row && row.source === 'zhvi').length;
    acsCount = Number(counts.acs_raw) || (Object.keys(places).length - zhviCount);
    if (existing.review_flags && Array.isArray(existing.review_flags.zhvi_over_acs_ratio_gt_3)) {
      review.push(...existing.review_flags.zhvi_over_acs_ratio_gt_3);
    }
  }

  for (const [geoid, place] of hasCityZhvi ? Object.entries(centroids).sort(([a], [b]) => a.localeCompare(b)) : []) {
    const countyFips = placeCounties[geoid];
    const countyName = countyNames[countyFips];
    const summaryPath = path.join(SUMMARY_DIR, `${geoid}.json`);
    if (!countyName || !fs.existsSync(summaryPath)) continue;
    const summary = readJson(summaryPath);
    const profile = summary.acsProfile || {};
    const acsValue = Number(profile.DP04_0089E);
    const key = normName(place.name) + '|' + normName(countyName);
    const zhvi = byKey.get(key) || null;

    let display;
    if (zhvi) {
      display = {
        value: zhvi.value,
        source: 'zhvi',
        as_of: zhvi.asOf,
        confidence: 'high',
        zillow_region_id: zhvi.regionId,
        acs_raw_value: Number.isFinite(acsValue) ? acsValue : null,
      };
      crosswalk[geoid] = {
        zillow_region_id: zhvi.regionId,
        zillow_region_name: zhvi.regionName,
        zillow_county_name: zhvi.countyName,
        county_fips: countyFips,
      };
      zhviCount += 1;
      if (Number.isFinite(acsValue) && acsValue > 0 && zhvi.value / acsValue > 3) {
        review.push({
          geoid,
          place_name: place.name,
          county_fips: countyFips,
          acs_value: acsValue,
          zhvi_value: zhvi.value,
          ratio: Number((zhvi.value / acsValue).toFixed(2)),
        });
      }
    } else {
      display = {
        value: Number.isFinite(acsValue) && acsValue > 0 ? acsValue : null,
        source: 'acs_raw',
        as_of: 'ACS 2020-2024 5-year',
        confidence: Number.isFinite(acsValue) && acsValue > 0 ? 'low' : 'missing',
      };
      acsCount += 1;
    }

    profile.median_home_value = display;
    summary.acsProfile = profile;
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n');
    places[geoid] = display;
  }

  const countyRows = buildCountyAcsRows(registry, fhfaDoc);

  fs.writeFileSync(OUT, JSON.stringify({
    meta: {
      generated_at: new Date().toISOString(),
      schema: 'median_home_value = { value, source, as_of, confidence }; counties are display-only affordability inputs and are ignored by rank/score models',
      sources: {
        zhvi_city_csv: 'https://files.zillowstatic.com/research/public_csvs/zhvi/City_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv',
        zhvi_county_csv: null,
        acs_raw: 'ACS DP04_0089E, 2020-2024 5-year',
        fhfa_county_hpi: fhfaDoc && fhfaDoc.meta ? fhfaDoc.meta.county_source_url : null,
      },
      latest_zhvi_month: latestAsOf,
      colorado_zhvi_rows: coRows,
      counts: {
        zhvi: zhviCount,
        acs_raw: acsCount,
        total: zhviCount + acsCount,
        counties: {
          fhfa_county_hpi_anchor: countyRows.fhfaCount,
          acs_raw: countyRows.acsCount,
          missing: countyRows.missingCount,
          total: Object.keys(countyRows.counties).length,
        },
      },
      build_note: hasCityZhvi
        ? 'Place rows rebuilt from local Zillow city ZHVI CSV.'
        : 'Local Zillow city ZHVI CSV absent; preserved committed place rows and rebuilt county rows from committed ACS summary caches.',
    },
    places,
    counties: countyRows.counties,
    review_flags: {
      zhvi_over_acs_ratio_gt_3: review,
    },
  }, null, 2) + '\n');

  if (hasCityZhvi) {
    fs.writeFileSync(CROSSWALK_OUT, JSON.stringify({
      meta: {
        generated_at: new Date().toISOString(),
        source: 'Derived from Census GEOID place names + containing county matched to Zillow city RegionID + CountyName.',
        latest_zhvi_month: latestAsOf,
        count: Object.keys(crosswalk).length,
      },
      places: crosswalk,
    }, null, 2) + '\n');
  }

  console.log(`home-value cascade: ${zhviCount} ZHVI, ${acsCount} ACS raw, ${review.length} review flags`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
