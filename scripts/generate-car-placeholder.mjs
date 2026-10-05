/**
 * generate-car-placeholder.mjs
 *
 * Generates a monthly CAR market report placeholder JSON file in data/.
 * Tracking volumes may be estimated from the previous month and are labelled.
 * Prices are never projected: unpublished price fields remain null.
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
        // Price absence must not discard the available tracking-volume baseline.
        if (raw.statewide) {
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
function estimateMetro(prev, listingFactor, domFactor) {
  if (!prev) return buildNullMetro();
  return {
    name: prev.name,
    median_sale_price: null,
    active_listings: grow(prev.active_listings, listingFactor),
    median_days_on_market: growFloat(prev.median_days_on_market, domFactor),
    median_price_per_sqft: null,
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

export function buildPlaceholder(month, previous) {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const [yyyy, mm] = month.split('-');
  const monthName = monthNames[parseInt(mm, 10) - 1];

  // Tracking-volume estimates are labelled; no price-growth assumption is used.
  const LISTING_FACTOR  = 1.030;  // +3.0% MoM listing/sales volume
  const DOM_FACTOR      = 0.995;  // -0.5% MoM days on market

  let statewide;
  let metro_areas;
  let notes;

  if (previous) {
    const s = previous.statewide;
    statewide = {
      median_sale_price:       null,
      active_listings:         grow(s.active_listings, LISTING_FACTOR),
      median_days_on_market:   growFloat(s.median_days_on_market, DOM_FACTOR),
      median_price_per_sqft:   null,
      closed_sales:            grow(s.closed_sales, LISTING_FACTOR),
      new_listings:            grow(s.new_listings, LISTING_FACTOR),
      months_of_supply:        growFloat(s.months_of_supply, 1.0),
      list_to_sale_ratio:      null,
    };
    const m = previous.metro_areas || {};
    metro_areas = {
      denver:           estimateMetro(m.denver,           LISTING_FACTOR, DOM_FACTOR),
      colorado_springs: estimateMetro(m.colorado_springs, LISTING_FACTOR, DOM_FACTOR),
      fort_collins:     estimateMetro(m.fort_collins,     LISTING_FACTOR, DOM_FACTOR),
      boulder:          estimateMetro(m.boulder,          LISTING_FACTOR, DOM_FACTOR),
      pueblo:           estimateMetro(m.pueblo,           LISTING_FACTOR, DOM_FACTOR),
      grand_junction:   estimateMetro(m.grand_junction,   LISTING_FACTOR, DOM_FACTOR),
    };
    notes = `Tracking volumes and days on market estimated for ${monthName} ${yyyy} by trend-projection from ${previous.month}. Prices not yet published by CAR; no price estimates are provided.`;
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

  return applyPlaceholderPricePolicy({
    month,
    generated_at: new Date().toISOString(),
    // The figures below are NOT published CAR numbers — they are this month's
    // values projected from last month's by fixed growth factors, or bare
    // placeholders when there is no previous month. `source` names the series
    // these stand in for, which read alone is easy to mistake for provenance.
    // The flag is machine-readable so surfaces can label the estimate instead
    // of attributing a projection to CAR: data/car-market-report-2026-08 and
    // -09 were rendered on the HNA market section as "Denver Metro CAR
    // $577k" with nothing marking them as projected.
    estimated: true,
    // Scope-aware, because "is this month projected?" has no single answer
    // once ShowingTime lands. This generator produces EVERY scope, so all
    // three are projected here; fetch-car-showingtime.mjs later flips
    // `counties` to false when it writes real MLS rows, and leaves statewide
    // and metro true because ShowingTime publishes no statewide row to
    // replace them with. Without this, that fetcher had only a single boolean
    // to work with and deleted it outright — which published four months of
    // trend-projected statewide figures as measured CAR data.
    estimated_scopes: { counties: true, statewide: true, metro: true },
    estimate_basis: previous
      ? `trend-projection from ${previous.month}`
      : 'placeholder — no prior month to project from',
    source: 'Colorado Association of REALTORS (CAR)',
    source_url: 'https://coloradorealtors.com/market-trends/',
    version: '1.0',
    statewide,
    metro_areas,
    notes,
  }, previous);
}

// Also usable on historical placeholders: preserve tracking data and provenance,
// but remove invented prices. A prior published month is metadata, not a substitute price.
export function applyPlaceholderPricePolicy(report, previous = null) {
  const scopes = report.estimated_scopes || { statewide: report.estimated === true, metro: report.estimated === true };
  function clearPrices(row, prior, priorEstimated) {
    if (!row) return;
    for (const key of ['median_sale_price', 'median_price_per_sqft', 'median_sale_price_yoy_pct', 'list_to_sale_ratio']) {
      if (key in row || key === 'median_sale_price' || key === 'median_price_per_sqft') row[key] = null;
    }
    row.estimated_reason = 'price_not_published_by_car';
    row.last_real_price_month = prior && !priorEstimated && prior.median_sale_price > 0
      ? previous.month : (row.last_real_price_month || prior?.last_real_price_month || null);
  }
  const priorScopes = previous?.estimated_scopes || { statewide: previous?.estimated === true, metro: previous?.estimated === true };
  if (scopes.statewide) clearPrices(report.statewide, previous?.statewide, priorScopes.statewide);
  if (scopes.metro) for (const [key, row] of Object.entries(report.metro_areas || {})) {
    clearPrices(row, previous?.metro_areas?.[key], priorScopes.metro);
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
}
