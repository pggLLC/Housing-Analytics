'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const legislation = require(path.join(root, 'data', 'policy', 'tax-credit-legislation.json'));
const pricing = require(path.join(root, 'data', 'market', 'tax-credit-transfer-pricing.json'));

function assertIsoReviewDate(raw, label) {
  assert(/^\d{4}-\d{2}-\d{2}$/.test(raw), `${label} review_by is ISO date`);
}

function assertOfficialHttps(url, label) {
  assert(/^https:\/\//.test(url), `${label} source_url uses https`);
  assert(
    /^(https:\/\/(www\.)?(congress|federalregister|irs)\.gov|https:\/\/www\.irs\.gov)/.test(url),
    `${label} legislation source_url is official federal source: ${url}`
  );
}

console.log('\nTax Credit Insights data tests');
console.log('='.repeat(44));

assert.strictEqual(legislation.schema, 'tax-credit-legislation/v1', 'legislation schema is versioned');
assert(Array.isArray(legislation.entries), 'legislation entries array exists');
assert(legislation.entries.length >= 8, 'legislation file is non-vacuous');
assertIsoReviewDate(legislation.meta.review_by, 'legislation meta');

const requiredLegislation = [
  'obbba-lihtc-ceiling-12pct',
  'obbba-lihtc-bond-25pct-test',
  'obbba-25c-25d-termination',
  'obbba-45y-48e-wind-solar-deadlines',
  'cra-2025-rescission-npr',
  'ira-section-6418-transferability',
  'nhia-119th-congress'
];
const legislationIds = new Set(legislation.entries.map((entry) => entry.id));
requiredLegislation.forEach((id) => assert(legislationIds.has(id), `required legislation entry present: ${id}`));

legislation.entries.forEach((entry) => {
  assert(entry.id && entry.title, `${entry.id || 'entry'} has id and title`);
  assert(['lihtc', 'nmtc', 'htc', 'itc-ptc', 'cra', 'homebuyer'].includes(entry.scope), `${entry.id} scope allowed`);
  assert(['enacted', 'proposed', 'rule-pending', 'phased-out', 'expired'].includes(entry.status), `${entry.id} status allowed`);
  assert(entry.pricing_impact && entry.pricing_impact.length <= 280, `${entry.id} pricing impact is present and concise`);
  assertOfficialHttps(entry.source_url, entry.id);
  assertIsoReviewDate(entry.review_by, entry.id);
});

assert.strictEqual(pricing.schema, 'tax-credit-transfer-pricing/v1', 'pricing schema is versioned');
assert(Array.isArray(pricing.markets), 'pricing markets array exists');
assert(pricing.markets.length >= 5, 'pricing file is non-vacuous');
assertIsoReviewDate(pricing.meta.review_by, 'pricing meta');

const requiredMarkets = [
  'clean-energy-transfer-general',
  'itc-transfer-investment-grade-2025',
  'ptc-transfer-investment-grade-2025',
  'nmtc-equity-pricing',
  'federal-htc-pricing'
];
const marketIds = new Set(pricing.markets.map((entry) => entry.id));
requiredMarkets.forEach((id) => assert(marketIds.has(id), `required pricing market present: ${id}`));

pricing.markets.forEach((entry) => {
  assert(/^https:\/\//.test(entry.source_url), `${entry.id} source_url uses https`);
  assertIsoReviewDate(entry.review_by, entry.id);
  if (entry.status === 'verified') {
    assert(typeof entry.price_low === 'number' && typeof entry.price_high === 'number', `${entry.id} verified entry has numeric range`);
    assert(entry.price_low > 0 && entry.price_high >= entry.price_low && entry.price_high <= 1, `${entry.id} range is bounded`);
  } else {
    assert.strictEqual(entry.status, 'VERIFY', `${entry.id} unverified entries use VERIFY status`);
    assert.strictEqual(entry.price_low, null, `${entry.id} unverified low price is null`);
    assert.strictEqual(entry.price_high, null, `${entry.id} unverified high price is null`);
    assert(/does not publish current cents-per-credit/.test(entry.source_note), `${entry.id} explains missing market price`);
  }
});

const freshnessSrc = fs.readFileSync(path.join(root, 'scripts', 'audit', 'benchmark-freshness-check.mjs'), 'utf8');
assert(freshnessSrc.includes('data/market/tax-credit-transfer-pricing.json'), 'freshness audit includes transfer-pricing file');
assert(freshnessSrc.includes('data/policy/tax-credit-legislation.json'), 'freshness audit includes legislation file');
assert(freshnessSrc.includes('reviewByPaths'), 'freshness audit checks review_by paths');

console.log('All Tax Credit Insights data tests passed.');
