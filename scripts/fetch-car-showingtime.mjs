/**
 * Fetch Colorado Association of REALTORS county market stats from ShowingTime.
 *
 * The ShowingTime host occasionally blocks non-browser fetches. This script is
 * deliberately best-effort: it logs and exits 0 on WAF/network/parse failure so
 * the monthly placeholder generator can keep the build green.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const COUNTY_GEOJSON = path.join(DATA_DIR, 'boundaries', 'counties_co.geojson');
const REPORT_BASE = 'https://marketstatsreports.showingtime.com/CAR-Colorado_hqac0/sst';
const ATTRIBUTION = 'Colorado Association of REALTORS® (via ShowingTime, sourced from Colorado MLS)';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const TYPE_CONFIG = {
  single_family: { suffix: '0SF', label: 'Single Family' },
  townhouse_condo: { suffix: '0TC', label: 'Townhouse/Condo' },
};

function parseArgs(argv) {
  const args = {
    month: null,
    fixtureDir: process.env.CAR_SHOWINGTIME_FIXTURE_DIR || null,
    outDir: DATA_DIR,
    maxLookback: 6,
    minPopulated: 60,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--month') args.month = argv[++i];
    else if (arg === '--fixture-dir') args.fixtureDir = argv[++i];
    else if (arg === '--out-dir') args.outDir = argv[++i];
    else if (arg === '--max-lookback') args.maxLookback = Number(argv[++i]);
    else if (arg === '--min-populated') args.minPopulated = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function monthToReportCode(month) {
  return String(month).replace('-', '');
}

function previousMonth(month) {
  const [yyyy, mm] = month.split('-').map(Number);
  const d = new Date(Date.UTC(yyyy, mm - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function defaultStartMonth() {
  const now = new Date();
  // CAR/ShowingTime usually lags one month; start with the prior month.
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function sourceUrl(month, typeKey) {
  return `${REPORT_BASE}/${monthToReportCode(month)}/${TYPE_CONFIG[typeKey].suffix}.htm`;
}

function loadCountyMap() {
  const geojson = JSON.parse(fs.readFileSync(COUNTY_GEOJSON, 'utf8'));
  const map = new Map();
  for (const feature of geojson.features || []) {
    const props = feature.properties || {};
    const name = props.NAMELSAD || `${props.NAME} County`;
    const geoid = props.GEOID || (props.STATEFP && props.COUNTYFP ? `${props.STATEFP}${props.COUNTYFP}` : null);
    if (name && geoid) map.set(normalizeCountyName(name), { name, fips: geoid });
  }
  return map;
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function cleanCell(html) {
  return decodeHtml(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRows(html) {
  const rows = [];
  const rowMatches = String(html).match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  for (const rowHtml of rowMatches) {
    const cells = [];
    const cellMatches = rowHtml.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) || [];
    for (const cellHtml of cellMatches) cells.push(cleanCell(cellHtml));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function normalizeCountyName(name) {
  return String(name || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseNumber(text, { money = false, pct = false } = {}) {
  const raw = String(text || '').replace(/\u2212/g, '-').trim();
  if (!raw || raw === '--' || raw === '-' || raw.toLowerCase() === 'n/a') return null;
  const compact = raw
    .replace(/\$/g, '')
    .replace(/,/g, '')
    .replace(/%/g, '')
    .replace(/\+\s*/g, '')
    .replace(/-\s+/g, '-')
    .trim();
  if (!compact || compact === '--') return null;
  const value = Number(compact);
  if (!Number.isFinite(value)) return null;
  if (pct) return Math.round(value * 10) / 10;
  if (money) return value <= 0 ? null : Math.round(value);
  return Math.round(value);
}

function emptyCountyMetricBlock() {
  return {
    median_sale_price: null,
    median_sale_price_yoy_pct: null,
    closed_sales: null,
    closed_sales_yoy_pct: null,
    new_listings: null,
    new_listings_yoy_pct: null,
    active_listings: null,
    active_listings_yoy_pct: null,
    median_days_on_market: null,
    median_price_per_sqft: null,
    months_of_supply: null,
    list_to_sale_ratio: null,
  };
}

function parseCountyRows(html, countyMap = loadCountyMap()) {
  const counties = {};
  const rows = extractRows(html);
  for (const cells of rows) {
    const hit = countyMap.get(normalizeCountyName(cells[0]));
    if (!hit || cells.length < 9) continue;
    counties[hit.fips] = {
      name: hit.name,
      ...emptyCountyMetricBlock(),
      closed_sales: parseNumber(cells[1]),
      closed_sales_yoy_pct: parseNumber(cells[2], { pct: true }),
      new_listings: parseNumber(cells[3]),
      new_listings_yoy_pct: parseNumber(cells[4], { pct: true }),
      median_sale_price: parseNumber(cells[5], { money: true }),
      median_sale_price_yoy_pct: parseNumber(cells[6], { pct: true }),
      active_listings: parseNumber(cells[7]),
      active_listings_yoy_pct: parseNumber(cells[8], { pct: true }),
    };
  }
  return counties;
}

function mergePropertyType(counties, typeKey, typeRows) {
  for (const [fips, row] of Object.entries(typeRows)) {
    counties[fips] = counties[fips] || { name: row.name };
    counties[fips].name = row.name;
    counties[fips][typeKey] = { ...row };
    delete counties[fips][typeKey].name;
  }
}

function buildCountyReport(sfHtml, tcHtml, countyMap = loadCountyMap()) {
  const counties = {};
  mergePropertyType(counties, 'single_family', parseCountyRows(sfHtml, countyMap));
  mergePropertyType(counties, 'townhouse_condo', parseCountyRows(tcHtml, countyMap));

  const expected = new Set(Array.from(countyMap.values()).map((row) => row.fips));
  for (const fips of expected) {
    if (!counties[fips]) {
      const row = Array.from(countyMap.values()).find((item) => item.fips === fips);
      counties[fips] = { name: row.name };
    }
    counties[fips].single_family = counties[fips].single_family || emptyCountyMetricBlock();
    counties[fips].townhouse_condo = counties[fips].townhouse_condo || emptyCountyMetricBlock();
  }
  return Object.fromEntries(Object.entries(counties).sort(([a], [b]) => a.localeCompare(b)));
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, { retries = 2, backoffMs = 750 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': USER_AGENT,
          'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
        },
      });
      const text = await response.text();
      if (!response.ok || /<Code>AccessDenied<\/Code>/i.test(text)) {
        throw new Error(`HTTP ${response.status} from ${url}`);
      }
      return text;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(backoffMs * (attempt + 1));
    }
  }
  throw lastError;
}

async function loadReportHtml(month, typeKey, fixtureDir) {
  if (fixtureDir) {
    const file = path.join(fixtureDir, `${monthToReportCode(month)}-${TYPE_CONFIG[typeKey].suffix}.htm`);
    return fs.readFileSync(file, 'utf8');
  }
  return fetchText(sourceUrl(month, typeKey));
}

function loadExistingReport(month, outDir) {
  const file = path.join(outDir, `car-market-report-${month}.json`);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return {
    month,
    generated_at: new Date().toISOString(),
    source: ATTRIBUTION,
    source_url: sourceUrl(month, 'single_family'),
    version: '1.1',
    statewide: {
      median_sale_price: null,
      active_listings: null,
      median_days_on_market: null,
      median_price_per_sqft: null,
      closed_sales: null,
      new_listings: null,
      months_of_supply: null,
      list_to_sale_ratio: null,
    },
    metro_areas: {},
  };
}

function mergeIntoReport(existing, month, counties) {
  return {
    ...existing,
    month,
    generated_at: new Date().toISOString(),
    source: ATTRIBUTION,
    source_url: sourceUrl(month, 'single_family'),
    source_urls: {
      single_family: sourceUrl(month, 'single_family'),
      townhouse_condo: sourceUrl(month, 'townhouse_condo'),
    },
    version: '1.1',
    counties,
    notes: `County-level single-family and townhouse/condo rows populated from ShowingTime CAR reports for ${month}. Statewide and metro fields remain the existing report-level fallback values where no ShowingTime statewide/metro row is present.`,
  };
}

function coverageSummary(counties) {
  const rows = Object.values(counties || {});
  const hasAny = rows.filter((county) => {
    const sf = county.single_family || {};
    const tc = county.townhouse_condo || {};
    return sf.closed_sales !== null || sf.new_listings !== null || sf.active_listings !== null ||
      tc.closed_sales !== null || tc.new_listings !== null || tc.active_listings !== null;
  }).length;
  const lowSample = rows
    .filter((county) => (county.single_family || {}).median_sale_price === null || (county.townhouse_condo || {}).median_sale_price === null)
    .map((county) => county.name)
    .sort();
  return { county_count: rows.length, populated_count: hasAny, low_sample_counties: lowSample };
}

async function tryMonth(month, args) {
  const [sfHtml, tcHtml] = await Promise.all([
    loadReportHtml(month, 'single_family', args.fixtureDir),
    loadReportHtml(month, 'townhouse_condo', args.fixtureDir),
  ]);
  const counties = buildCountyReport(sfHtml, tcHtml);
  const summary = coverageSummary(counties);
  if (summary.county_count !== 64 || summary.populated_count < args.minPopulated) {
    throw new Error(`Parsed ${summary.populated_count}/64 populated county rows for ${month}`);
  }
  const existing = loadExistingReport(month, args.outDir);
  const merged = mergeIntoReport(existing, month, counties);
  const outPath = path.join(args.outDir, `car-market-report-${month}.json`);
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2) + '\n');
  return { month, outPath, summary };
}

async function main() {
  const args = parseArgs(process.argv);
  let month = args.month || defaultStartMonth();
  for (let i = 0; i < args.maxLookback; i++) {
    try {
      const result = await tryMonth(month, args);
      console.log(`[car-showingtime] populated ${result.month}: ${result.summary.populated_count}/${result.summary.county_count} counties`);
      if (result.summary.low_sample_counties.length) {
        console.log(`[car-showingtime] low-sample/suppressed median price in: ${result.summary.low_sample_counties.join(', ')}`);
      }
      console.log(`[car-showingtime] wrote ${result.outPath}`);
      return;
    } catch (err) {
      console.warn(`[car-showingtime] ${month} unavailable: ${err.message}`);
      if (args.month) break;
      month = previousMonth(month);
    }
  }
  console.warn('[car-showingtime] no ShowingTime county report populated; keeping existing committed data/placeholders');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.warn(`[car-showingtime] best-effort exit after error: ${err.message}`);
    process.exit(0);
  });
}

export {
  ATTRIBUTION,
  buildCountyReport,
  coverageSummary,
  emptyCountyMetricBlock,
  mergeIntoReport,
  parseCountyRows,
  parseNumber,
  sourceUrl,
};
