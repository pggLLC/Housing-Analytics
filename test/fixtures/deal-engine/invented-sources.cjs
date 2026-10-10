'use strict';
// Invented testing values only. Adams County is the issue's routing context;
// these are NOT its published limits or any real project's financial records.
const tiers = [20, 30, 40, 50, 60, 70, 80, 100, 110, 120];
const bedrooms = ['0br', '1br', '2br', '3br', '4br'];
const regular_tiers = Object.fromEntries(tiers.map(tier => [tier, {
  max_rents: Object.fromEntries(bedrooms.map((br, i) => [br, 400 + tier * 20 + i * 150])),
  income_limits: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map(size => [String(size), tier * 800 + size * 1200]))
}]));
module.exports = {
  'data/hud-fmr-income-limits.json': { meta: { fiscal_year: 2090, income_limits_fiscal_year: 2090, source: 'Invented HUD fixture' }, counties: [{
    fips: '08001', county_name: 'Adams County', fmr_area_name: 'Invented test area',
    fmr: { efficiency: 1400, one_br: 1600, two_br: 1900, three_br: 2100, four_br: 2500 },
    income_limits: { ami_4person: 100000, il50_1person: 35000, il50_2person: 40000, il50_3person: 45000, il50_4person: 50000 }
  }] },
  'data/chfa-income-rent-limits-2026.json': { meta: { fiscal_year: 2090, effective_date: '2090-01-01', source_url: 'https://example.org/invented-limits' }, counties: [{ fips: '08001', regular_tiers }] },
  'data/market/zori_rents_co.json': { meta: { vintage_month: '2090-01' }, counties: { '08001': { name: 'Adams County', rent: 2200 } }, cities: {} },
  'data/market/acs_renter_bedrooms_co.json': { meta: { vintage: '2086-2090' }, counties: { '08001': { county_fips: '08001', name: 'Adams County', bedrooms: { studio: 10, '1br': 20, '2br': 30, '3br': 20, '4br': 10, '5plus': 10 } } }, places: {} },
  'data/market/acs_median_rent_co.json': { meta: { vintage: '2086-2090' }, counties: { '08001': { median_gross_rent: 1800 } }, places: {} },
  'data/policy/soft-funding-status.json': { programs: {}, lastUpdated: '2090-01-01' },
  'data/hud_lihtc_co.geojson': { type: 'FeatureCollection', features: [] },
  'data/chfa-lihtc.json': { type: 'FeatureCollection', features: [] },
  'data/market/novogradac-equity-pricing.json': { pricing: { national_avg: { credit_9pct: 0.82, credit_4pct: 0.83 } } }
};
