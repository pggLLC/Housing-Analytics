const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readJson(relPath) {
  return JSON.parse(read(relPath));
}

function isResolved(prices) {
  if (!Array.isArray(prices) || prices.length < 2) return false;
  const nums = prices.map(Number).filter((n) => !Number.isNaN(n));
  if (nums.length < 2) return false;
  return Math.max(...nums) >= 0.999 && Math.min(...nums) <= 0.001;
}

const dashboard = read('economic-dashboard.html');

assert(dashboard.includes('function pmIsResolved'), 'economic dashboard defines pmIsResolved helper');
assert(/max\s*>=\s*0\.999/.test(dashboard), 'resolved helper checks the high price extreme');
assert(/min\s*<=\s*0\.001/.test(dashboard), 'resolved helper checks the low price extreme');
assert(dashboard.includes('Settled'), 'Polymarket render path can emit Settled labels');
assert(dashboard.includes('pm-settled'), 'Polymarket render path adds a settled visual state');
assert(dashboard.includes('pmIsResolved(prices)'), 'parsed markets carry the resolved check before rendering probabilities');
assert(dashboard.includes('pmEventIsResolved'), 'whole-card render paths distinguish fully settled events');
assert(!dashboard.includes('Live prediction market prices from'), 'panel intro no longer over-claims every market is live');

const data = readJson('data/polymarket-data.json');
const wiredSlugs = [
  'us-recession-by-end-of-2026',
  'fed-decision-in-april',
  'how-many-fed-rate-cuts-in-2026',
  'how-high-will-inflation-get-in-2026',
  'gdp-growth-in-2026',
  'what-will-the-median-home-value-in-the-us-be-on-april-30',
  'what-will-the-median-home-value-in-the-los-angeles-metro-area-be-on-april-30',
  'april-unemployment-rate-372',
  'fed-decision-in-june-825',
  'what-will-the-median-home-value-in-chicago-be-on-april-30',
  'tech-layoffs-up-or-down-in-2026',
];

const wiredResolvedMarkets = [];
for (const slug of wiredSlugs) {
  const event = data.events && data.events[slug];
  if (!event || !Array.isArray(event.markets)) continue;
  for (const market of event.markets) {
    let prices = null;
    try {
      prices = JSON.parse(market.outcomePrices);
    } catch (error) {
      prices = null;
    }
    if (isResolved(prices)) {
      wiredResolvedMarkets.push({ slug, question: market.question });
    }
  }
}

assert(wiredResolvedMarkets.length > 0, 'cached data includes at least one wired settled Polymarket market');
assert(isResolved(['0', '1']), '0/1 outcome prices are treated as settled');
assert(isResolved(['1', '0']), '1/0 outcome prices are treated as settled');
assert(!isResolved(['0.125', '0.875']), 'fractional outcome prices remain live');

console.log(`polymarket-resolved: PASS (${wiredResolvedMarkets.length} settled wired markets detected)`);
