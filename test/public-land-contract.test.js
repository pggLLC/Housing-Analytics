'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const contract = require(path.join(ROOT, 'scripts/validate-public-land-contract.js'));
const registry = require(path.join(ROOT, 'data/policy/county-parcel-sources.json'));

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function unknownParcel() {
  const parcel = {
    county_fips: '08001', parcel_id: null, recorded_owner: null, normalized_owner: null,
    owner_type: null, acreage: null, centroid: null, current_use: null,
    building_footprint_status: null, vacancy_status: null, zoning: null,
    residential_use_status: null, disposition_status: null, owner_interest_status: null,
    evidence_status: 'generic_claim_no_parcel_evidence', retrieved_at: null,
    source_layer_id: null, source_record_url: null, unavailable_reason: {}, source: null,
    source_url: null, classification: 'not_available', observation_class: 'unverified', verify: true, source_note: null
  };
  contract.NULLABLE_STAGES.forEach(function (field) { parcel.unavailable_reason[field] = 'Not established by parcel-specific primary evidence.'; });
  return parcel;
}

assert.equal(contract.validateRegistry(registry), true, 'the real 64-county registry validates');
assert.equal(registry.counties.length, 64);
assert.equal(new Set(registry.counties.map((county) => county.county_fips)).size, 64);

const shortRegistry = clone(registry);
shortRegistry.counties.pop();
assert.throws(() => contract.validateRegistry(shortRegistry), /exactly 64 counties/);

const inventedCounty = clone(registry);
inventedCounty.counties[0].county_fips = '08999';
assert.throws(() => contract.validateRegistry(inventedCounty), /not one of Colorado's 64 canonical counties/);

const falseCoverage = clone(registry);
falseCoverage.counties[0].endpoint = 'http://127.0.0.1/FeatureServer/0';
assert.throws(() => contract.validateRegistry(falseCoverage), /pending source must have endpoint null/);

const unsupportedHumanClaim = unknownParcel();
unsupportedHumanClaim.vacancy_status = 'field_verified_vacant';
delete unsupportedHumanClaim.unavailable_reason.vacancy_status;
assert.throws(() => contract.validateParcel(unsupportedHumanClaim, { writer: 'machine' }), /machine writer cannot produce human-only values/);
assert.throws(() => contract.validateParcel(unsupportedHumanClaim), /human-only values require observation_class human_verified/);

const humanVerifiedWithoutPrimaryEvidence = unknownParcel();
humanVerifiedWithoutPrimaryEvidence.vacancy_status = 'field_verified_vacant';
humanVerifiedWithoutPrimaryEvidence.classification = 'observed';
humanVerifiedWithoutPrimaryEvidence.observation_class = 'human_verified';
delete humanVerifiedWithoutPrimaryEvidence.unavailable_reason.vacancy_status;
assert.throws(() => contract.validateParcel(humanVerifiedWithoutPrimaryEvidence), /field-verified vacancy requires evidence_status verified_primary_record/);

const missingReason = unknownParcel();
delete missingReason.unavailable_reason.vacancy_status;
assert.throws(() => contract.validateParcel(missingReason), /vacancy_status is null and requires unavailable_reason/);
assert.equal(contract.validateParcel(unknownParcel(), { writer: 'machine' }), true, 'an honestly unknown record passes');

const verifiedHuman = unknownParcel();
verifiedHuman.evidence_status = 'verified_primary_record';
verifiedHuman.vacancy_status = 'field_verified_vacant';
verifiedHuman.classification = 'observed';
verifiedHuman.observation_class = 'human_verified';
delete verifiedHuman.unavailable_reason.vacancy_status;
assert.equal(contract.validateParcel(verifiedHuman), true, 'a properly classified human verification passes');

const invalidClassification = unknownParcel();
invalidClassification.classification = 'unverified';
assert.throws(() => contract.validateParcel(invalidClassification), /^Error: Public-land parcel invalid:\n- classification is invalid$/);

const invalidObservationClass = unknownParcel();
invalidObservationClass.observation_class = 'not_available';
assert.throws(() => contract.validateParcel(invalidObservationClass), /^Error: Public-land parcel invalid:\n- observation_class is invalid$/);

const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/public-land-parcel.schema.json'), 'utf8'));
assert.equal(schema.$id, 'public-land-parcel.schema.json');
assert(schema.required.includes('unavailable_reason'));
assert(schema.required.includes('evidence_status'));
assert(schema.required.includes('classification'));
assert(schema.required.includes('observation_class'));

const pkg = require(path.join(ROOT, 'package.json'));
assert.equal(pkg.scripts['test:public-land-contract'], 'node test/public-land-contract.test.js');
assert(pkg.scripts['test:ci'].includes('test:public-land-contract'));

console.log('public-land-contract: PASS');
