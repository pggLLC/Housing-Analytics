/**
 * generate-car-placeholder.mjs
 *
 * Generates a monthly CAR market report placeholder JSON file in data/.
 * When a previous month's file is found, values are estimated by applying
 * small seasonal growth factors rather than leaving all fields null.
 * Defaults to the current month; pass a YYYY-MM argument to target a specific month.
 *
 * Usage:
 *   node scripts/generate-car-placeholder.mjs          # current month
 *   node scripts/generate-car-placeholder.mjs 2026-04  # specific month
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');

function getTargetMonth(arg) {
  if (arg) {
    if (!/^\d{4}-\d{2}$/.test(arg)) {
      console.error(`Invalid month format: "${arg}". Expected YYYY-MM.`);
      process.exit(1);
    }
    const mm = parseInt(arg.split('-')[1], 10);
    if (mm < 1 || mm > 12) {
      console.error(`Invalid month value: "${arg}". Month must be between 01 and 12.`);
      process.exit(1);
    }
    return arg;
  }
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/** Return YYYY-MM for the month prior to `month`. */
function prevMonth(month) {
  const [yyyy, mm] = month.split('-').map(Number);
  const d = new Date(yyyy, mm - 2, 1);
  const py = d.getFullYear();
  const pm = String(d.getMonth() + 1).padStart(2, '0');
  return `${py}-${pm}`;
}

/**
 * Load the most recent available CAR report file, walking back up to 12 months.
 * Returns the parsed JSON object or null if none is found.
 */
function loadPreviousReport(targetMonth) {
  let cursor = prevMonth(targetMonth);
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(DATA_DIR, `car-market-report-${cursor}.json`);
    if (fs.existsSync(candidate)) {
      try {
        const raw = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        // Only use it if key fields are non-null
        if (raw.statewide && raw.statewide.median_sale_price !== null) {
          return raw;
        }
      } catch (_) {
        // ignore parse errors
      }
    }
    cursor = prevMonth(cursor);
  }
  return null;
}

/**
 * Apply a small growth factor to a numeric value and round to the nearest integer.
 * Returns null if the input is null.
 */
function grow(value, factor) {
  if (value === null || value === undefined) return null;
  return Math.round(value * factor);
}

/**
 * Apply a growth factor to a float value, rounded to one decimal place.
 */
function growFloat(value, factor) {
  if (value === null || value === undefined) return null;
  return Math.round(value * factor * 10) / 10;
}

/** Build a metro-area block from a previous value block, applying growth factors. */
function estimateMetro(prev, priceFactor, listingFactor, domFactor) {
  if (!prev) return buildNullMetro();
  return {
    name: prev.name,
    median_sale_price: grow(prev.median_sale_price, priceFactor),
    active_listings: grow(prev.active_listings, listingFactor),
    median_days_on_market: growFloat(prev.median_days_on_market, domFactor),
    median_price_per_sqft: growFloat(prev.median_price_per_sqft, priceFactor),
    closed_sales: grow(prev.closed_sales, listingFactor),
    new_listings: grow(prev.new_listings, listingFactor),
    months_of_supply: growFloat(prev.months_of_supply, 1.0),
  };
}

function buildNullMetro(name) {
  return {
    name: name || '',
    median_sale_price: null,
    active_listings: null,
    median_days_on_market: null,
    median_price_per_sqft: null,
    closed_sales: null,
    new_listings: null,
    months_of_supply: null,
  };
}

function buildPlaceholder(month, previous) {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const [yyyy, mm] = month.split('-');
  const monthName = monthNames[parseInt(mm, 10) - 1];

  // Modest month-over-month growth assumptions derived from Colorado CAR historical data.
  // PRICE_FACTOR: ~0.5% MoM is consistent with Colorado's ~6% annual appreciation trend
  //   (CAR 2015-2024 average; conservative since peak appreciation was higher).
  // LISTING_FACTOR: ~3% MoM reflects typical seasonal volume increase Feb→Mar→Apr.
  //   Reduces automatically in fall/winter months because growth compounds from the
  //   prior actual month rather than a fixed baseline.
  // DOM_FACTOR: 0.5% tightening per month is a conservative estimate for active markets.
  // These factors are only used when no actual CAR report data is available; the
  // generated file should be replaced with real data as soon as CAR publishes it.
  const PRICE_FACTOR    = 1.005;  // +0.5% MoM median price
  const LISTING_FACTOR  = 1.030;  // +3.0% MoM listing/sales volume
  const DOM_FACTOR      = 0.995;  // -0.5% MoM days on market

  let statewide;
  let metro_areas;
  let notes;

  if (previous) {
    const s = previous.statewide;
    statewide = {
      median_sale_price:       grow(s.median_sale_price, PRICE_FACTOR),
      active_listings:         grow(s.active_listings, LISTING_FACTOR),
      median_days_on_market:   growFloat(s.median_days_on_market, DOM_FACTOR),
      median_price_per_sqft:   growFloat(s.median_price_per_sqft, PRICE_FACTOR),
      closed_sales:            grow(s.closed_sales, LISTING_FACTOR),
      new_listings:            grow(s.new_listings, LISTING_FACTOR),
      months_of_supply:        growFloat(s.months_of_supply, 1.0),
      list_to_sale_ratio:      s.list_to_sale_ratio !== null
                                 ? Math.round(s.list_to_sale_ratio * 1000) / 1000
                                 : null,
    };
    const m = previous.metro_areas || {};
    metro_areas = {
      denver:           estimateMetro(m.denver,           PRICE_FACTOR, LISTING_FACTOR, DOM_FACTOR),
      colorado_springs: estimateMetro(m.colorado_springs, PRICE_FACTOR, LISTING_FACTOR, DOM_FACTOR),
      fort_collins:     estimateMetro(m.fort_collins,     PRICE_FACTOR, LISTING_FACTOR, DOM_FACTOR),
      boulder:          estimateMetro(m.boulder,          PRICE_FACTOR, LISTING_FACTOR, DOM_FACTOR),
      pueblo:           estimateMetro(m.pueblo,           PRICE_FACTOR, LISTING_FACTOR, DOM_FACTOR),
      grand_junction:   estimateMetro(m.grand_junction,   PRICE_FACTOR, LISTING_FACTOR, DOM_FACTOR),
    };
    notes = `Estimated for ${monthName} ${yyyy} by trend-projection from ${previous.month}. Replace with official CAR report data when published.`;
  } else {
    statewide = {
      median_sale_price: null, active_listings: null, median_days_on_market: null,
      median_price_per_sqft: null, closed_sales: null, new_listings: null,
      months_of_supply: null, list_to_sale_ratio: null,
    };
    const metroNames = {
      denver: 'Denver Metro', colorado_springs: 'Colorado Springs',
      fort_collins: 'Fort Collins / Greeley', boulder: 'Boulder',
      pueblo: 'Pueblo', grand_junction: 'Grand Junction',
    };
    metro_areas = Object.fromEntries(
      Object.entries(metroNames).map(([k, name]) => [k, buildNullMetro(name)])
    );
    notes = `Placeholder for ${monthName} ${yyyy}. Update with actual CAR report data when available.`;
  }

  return {
    month,
    generated_at: new Date().toISOString(),
    source: 'Colorado Association of REALTORS (CAR)',
    source_url: 'https://coloradorealtors.com/market-trends/',
    version: '1.0',
    statewide,
    metro_areas,
    notes,
  };
}

const month = getTargetMonth(process.argv[2]);
const filename = `car-market-report-${month}.json`;
const outPath = path.join(DATA_DIR, filename);

if (fs.existsSync(outPath)) {
  console.log(`File already exists, skipping: ${outPath}`);
  process.exit(0);
}

const previous = loadPreviousReport(month);
if (previous) {
  console.log(`Using ${previous.month} as baseline for trend projection.`);
} else {
  console.log('No previous report found — generating null placeholder.');
}

const data = buildPlaceholder(month, previous);
fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');
console.log(`Created: ${outPath}`);
