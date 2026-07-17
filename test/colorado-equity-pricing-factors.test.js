#!/usr/bin/env node
// test/colorado-equity-pricing-factors.test.js
//
// Issue #1227 PR 2: guard Colorado-specific LIHTC equity-pricing factor data
// against invented figures and stale source/status drift.

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

const factors = readJson('data/market/colorado-equity-pricing-factors.json');
const pab = readJson('data/policy/pab-allocations.json');
const climate = readJson('data/market/climate_hazards_co.json');
const legislation = readJson('data/policy/tax-credit-legislation.json');
const freshnessSrc = fs.readFileSync(path.join(ROOT, 'scripts/audit/benchmark-freshness-check.mjs'), 'utf8');

function assertIsoDate(raw, label) {
  assert.match(raw, /^\d{4}-\d{2}-\d{2}$/, `${label} is an ISO date`);
}

function roundedShare(part, whole) {
  return Number((part / whole).toFixed(4));
}

console.log('\nColorado equity-pricing factor tests');
console.log('='.repeat(44));

assert.equal(factors.schema, 'colorado-equity-pricing-factors/v1', 'factor snapshot schema is versioned');
assertIsoDate(factors.meta.as_of, 'factor snapshot as_of');
assertIsoDate(factors.meta.review_by, 'factor snapshot review_by');
assert.match(
  factors.meta.important_disclaimer,
  /not.*pricing formula/i,
  'factor snapshot disclaims formula use'
);

const ahtc = factors.factors.state_affordable_housing_tax_credit;
assert(ahtc, 'state AHTC factor exists');
assert.equal(ahtc.administered_by, 'Colorado Housing and Finance Authority', 'AHTC administrator is CHFA');
assert.equal(ahtc.allocation_authority_by_year['2026'], 12000000, 'AHTC 2026 authority is sourced from HB24-1434');
assert.deepEqual(
  ahtc.state_credit_pricing,
  {
    price_low: null,
    price_high: null,
    status: 'VERIFY',
    source_note: ahtc.state_credit_pricing.source_note
  },
  'AHTC pricing remains null + VERIFY when no fetchable official pricing source exists'
);
assert.match(
  ahtc.state_credit_pricing.source_note,
  /No fetchable official CHFA or state source/i,
  'AHTC pricing gap explains why the price is null'
);
assert(ahtc.source_urls.includes('https://www.chfainfo.com/rental-housing/housing-credit/colorado-state-affordable-housing-tax-credit'), 'AHTC source includes CHFA state-credit page');
assert(ahtc.source_urls.includes('https://leg.colorado.gov/bills/HB24-1434'), 'AHTC source includes enacted HB24-1434');

const insurance = factors.factors.property_insurance_regional_adjustment;
assert(insurance, 'property-insurance factor exists');
assert.equal(insurance.formula, null, 'insurance factor is prose, not a formula');
assert.equal(insurance.data_pointer, 'data/market/climate_hazards_co.json', 'insurance factor points to local climate hazard data');
assert(insurance.hazards_used.includes('hail_risk'), 'insurance factor uses hail risk');
assert(insurance.hazards_used.includes('wildfire_risk'), 'insurance factor uses wildfire risk');
assert.equal(climate.hazard_summary.hail_risk.level, 'high', 'climate data has hail risk context');
assert.equal(climate.hazard_summary.wildfire_risk.level, 'very_high', 'climate data has wildfire risk context');
assert.match(insurance.source_url, /^https:\/\/doi\.colorado\.gov\//, 'insurance source is Colorado DOI');

const pabFactor = factors.factors.pab_volume_cap_pressure;
assert(pabFactor, 'PAB pressure factor exists');
assert.equal(pabFactor.source_data, 'data/policy/pab-allocations.json', 'PAB factor uses existing allocation artifact');
assert.equal(pabFactor.state_volume_cap, pab.metadata.stateVolumeCap, 'PAB state cap matches source artifact');
assert.equal(pabFactor.chfa_pool, pab.metadata.statewide.chfaPool, 'PAB CHFA pool matches source artifact');
assert.equal(pabFactor.total_direct_allocations, pab.metadata.totalDirectAllocations, 'PAB direct allocations match source artifact');
assert.equal(pabFactor.statewide_balance, pab.metadata.statewide.statewideBalance, 'PAB statewide balance matches source artifact');
assert.equal(
  pabFactor.chfa_pool_share_of_state_cap,
  roundedShare(pab.metadata.statewide.chfaPool, pab.metadata.stateVolumeCap),
  'PAB CHFA-pool share recomputes from source artifact'
);
assert.equal(
  pabFactor.direct_allocation_share_of_state_cap,
  roundedShare(pab.metadata.totalDirectAllocations, pab.metadata.stateVolumeCap),
  'PAB direct-allocation share recomputes from source artifact'
);
assert.equal(pabFactor.pressure_indicator, 'watch', 'PAB pressure is a watch indicator');
assert.equal(pabFactor.oversubscription_ratio, null, 'PAB factor does not invent an oversubscription ratio');
assert.match(pabFactor.source_note, /not verified demand\/applications/i, 'PAB note discloses the demand-data gap');

const rofrFactor = factors.factors.local_government_rofr_rofo;
assert(rofrFactor, 'ROFR/ROFO factor exists');
assert.equal(rofrFactor.watchlist_entry_id, 'hb24-1175-local-government-rofr-rofo', 'ROFR factor links to enacted HB24-1175 watchlist entry');
assert.match(rofrFactor.source_note, /HB23-1190 was vetoed/i, 'ROFR factor documents the HB23-1190 correction');

const rofrEntry = legislation.entries.find((entry) => entry.id === rofrFactor.watchlist_entry_id);
assert(rofrEntry, 'ROFR watchlist entry exists');
assert.equal(rofrEntry.status, 'enacted', 'ROFR watchlist entry is enacted');
assert.equal(rofrEntry.effective_date, '2024-08-07', 'ROFR watchlist entry carries enacted effective date');
assert.equal(rofrEntry.sunset_date, '2029-12-31', 'ROFR watchlist entry carries sunset date');
assert.equal(rofrEntry.source_url, 'https://leg.colorado.gov/bills/HB24-1175', 'ROFR watchlist entry sources enacted HB24-1175');
assert(rofrEntry.related_source_urls.includes('https://leg.colorado.gov/bills/hb23-1190'), 'ROFR entry cites vetoed HB23-1190 only as related history');
assert(
  !legislation.entries.some((entry) => /hb23-1190/i.test(entry.id) && entry.status === 'enacted'),
  'vetoed HB23-1190 is never represented as enacted'
);

assert(
  freshnessSrc.includes('data/market/colorado-equity-pricing-factors.json'),
  'benchmark freshness audit includes the Colorado factor snapshot'
);

console.log('Colorado equity-pricing factor tests passed.');
