/**
 * generate-car-placeholder.mjs
 *
 * Generates a monthly CAR market report placeholder JSON file in data/.
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

function buildPlaceholder(month) {
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const [yyyy, mm] = month.split('-');
  const monthName = monthNames[parseInt(mm, 10) - 1];

  return {
    month,
    generated_at: new Date().toISOString(),
    source: 'Colorado Association of REALTORS (CAR)',
    source_url: 'https://coloradorealtors.com/market-trends/',
    version: '1.0',
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
    metro_areas: {
      denver: {
        name: 'Denver Metro',
        median_sale_price: null,
        active_listings: null,
        median_days_on_market: null,
        median_price_per_sqft: null,
        closed_sales: null,
        new_listings: null,
        months_of_supply: null,
      },
      colorado_springs: {
        name: 'Colorado Springs',
        median_sale_price: null,
        active_listings: null,
        median_days_on_market: null,
        median_price_per_sqft: null,
        closed_sales: null,
        new_listings: null,
        months_of_supply: null,
      },
      fort_collins: {
        name: 'Fort Collins / Greeley',
        median_sale_price: null,
        active_listings: null,
        median_days_on_market: null,
        median_price_per_sqft: null,
        closed_sales: null,
        new_listings: null,
        months_of_supply: null,
      },
      boulder: {
        name: 'Boulder',
        median_sale_price: null,
        active_listings: null,
        median_days_on_market: null,
        median_price_per_sqft: null,
        closed_sales: null,
        new_listings: null,
        months_of_supply: null,
      },
      pueblo: {
        name: 'Pueblo',
        median_sale_price: null,
        active_listings: null,
        median_days_on_market: null,
        median_price_per_sqft: null,
        closed_sales: null,
        new_listings: null,
        months_of_supply: null,
      },
      grand_junction: {
        name: 'Grand Junction',
        median_sale_price: null,
        active_listings: null,
        median_days_on_market: null,
        median_price_per_sqft: null,
        closed_sales: null,
        new_listings: null,
        months_of_supply: null,
      },
    },
    notes: `Placeholder for ${monthName} ${yyyy}. Update with actual CAR report data when available.`,
  };
}

const month = getTargetMonth(process.argv[2]);
const filename = `car-market-report-${month}.json`;
const outPath = path.join(DATA_DIR, filename);

if (fs.existsSync(outPath)) {
  console.log(`File already exists, skipping: ${outPath}`);
  process.exit(0);
}

const data = buildPlaceholder(month);
fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');
console.log(`Created: ${outPath}`);
