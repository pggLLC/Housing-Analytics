'use strict';
const assert = require('assert');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const stewardship = require(path.join(ROOT, 'data/policy/stewardship-providers.json'));
const local = require(path.join(ROOT, 'data/hna/local-resources.json'));

const STATUSES = new Set(['available', 'anticipated', 'application_pending', 'awarded', 'committed', 'expired', 'unverified']);
const ROLES = new Set(['homebuyer_education', 'counseling', 'credit_readiness', 'dpa_origination', 'loan_servicing', 'owner_occupancy_monitoring', 'resale_administration', 'foreclosure_intervention', 'program_stewardship']);
const TIERS = new Set(['active_developer', 'administrative', 'nominal_paper']);
function hasRank(value) { return value && typeof value === 'object' && Object.keys(value).some((key) => /^(rank|score)$/i.test(key) || hasRank(value[key])); }
function validateProvider(provider) {
  assert(provider.id && provider.name && /^https:\/\//.test(provider.url));
  assert(STATUSES.has(provider.commitment_status));
  if (provider.apply_to_gap) assert(['awarded', 'committed'].includes(provider.commitment_status));
  assert.deepEqual(provider.geography_served, ['western_colorado']);
  assert(Array.isArray(provider.counties_served) && provider.counties_served.includes('08077'));
  assert.equal(provider.roles.length, 9);
  provider.roles.forEach((role) => assert(ROLES.has(role)));
  assert(/^https:\/\//.test(provider.source_url));
  assert(/^\d{4}-\d{2}-\d{2}$/.test(provider.last_verified));
}
function validateAuthority(authority) {
  ['structure_type', 'enabling_framework', 'taxing_authority', 'bonding_authority', 'powers', 'capacity_tier', 'activity_evidence', 'stewardship_capacity', 'capacity_last_verified'].forEach((field) => assert(Object.prototype.hasOwnProperty.call(authority, field), field));
  assert(TIERS.has(authority.capacity_tier));
  assert(Array.isArray(authority.powers) && authority.powers.length);
  if (authority.capacity_tier !== 'nominal_paper') assert(authority.activity_evidence.recent_projects.length);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(authority.capacity_last_verified));
}
function validateReferences(resources) {
  const provider = stewardship.providers.find((item) => item.id === 'hrwc');
  Object.entries(resources).forEach(([key, record]) => {
    (record.stewardship_providers || []).forEach((ref) => {
      assert.deepEqual(Object.keys(ref), ['provider_id']);
      assert(stewardship.providers.some((item) => item.id === ref.provider_id));
      if (ref.provider_id === 'hrwc') {
        const county = key.startsWith('county:') ? key.slice(7) : key === 'place:0828745' ? '08077' : null;
        assert(county && provider.counties_served.includes(county), 'HRWC reference outside service area: ' + key);
      }
    });
  });
}

assert.equal(stewardship.meta.no_stewardship_flag, 'Permanent ownership stewardship capacity not established');
stewardship.providers.forEach(validateProvider);
assert.equal(hasRank(stewardship), false);
validateReferences(local);
['county:08077', 'place:0828745'].forEach((key) => {
  assert.deepEqual(local[key].stewardship_providers, [{ provider_id: 'hrwc' }]);
  local[key].housingAuthority.forEach(validateAuthority);
});
const fruitaText = JSON.stringify(local['place:0828745']);
assert(!/Eagle|Vail/i.test(fruitaText));
assert(/Family Health West/.test(fruitaText));
assert(/City of Fruita/.test(fruitaText));
assert(/Mesa County Valley School District 51/.test(fruitaText));
assert.equal(local['place:0828745'].housingAuthority[0].capacity_tier, 'administrative');
assert(/Fruita Mews/.test(JSON.stringify(local['place:0828745'].housingAuthority[0].activity_evidence)));
assert.throws(() => validateReferences(Object.assign({}, local, { 'place:0804000': { stewardship_providers: [{ provider_id: 'hrwc' }] } })));

console.log('stewardship-providers: PASS');

