'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const contract = require(path.join(ROOT, 'scripts/validate-public-land-contract.js'));
const registry = require(path.join(ROOT, 'data/policy/county-parcel-sources.json'));
const POLICY_FILES = [
  'data/policy/land-disposition-models.json',
  'data/policy/developer-ownership-funding.json',
  'data/policy/affordability-models.json',
  'data/policy/resale-conventions.json',
  'data/policy/buyer-assistance-programs.json',
  'data/policy/stewardship-providers.json'
];
const NUMERIC_FINGERPRINTS = {
  'data/policy/land-disposition-models.json': '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
  'data/policy/developer-ownership-funding.json': '30d85048b49bb4447afaa077ea1dfbcc3788eb9f40210f4ea673cd0519e2ed69',
  'data/policy/affordability-models.json': '7bff9cfcbb0d5263a8f50619d37d1b7452b9070c757560c43b74f23e91552b12',
  'data/policy/resale-conventions.json': '77ca97e58c6c10b75a7ae2fcd178db139b9962847561aecb4c9c42b93658b295',
  'data/policy/buyer-assistance-programs.json': '5bb4d42e39552d7fef25b46b0592d4ac36e33b0d9d98cfb7b4bbbdb0babe2316',
  'data/policy/stewardship-providers.json': '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'
};

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function numericFingerprint(value) {
  const numbers = [];
  (function visit(item, at) {
    if (typeof item === 'number') numbers.push([at, item]);
    else if (Array.isArray(item)) item.forEach(function (child, index) { visit(child, at + '[' + index + ']'); });
    else if (item && typeof item === 'object') Object.keys(item).sort().forEach(function (key) { visit(item[key], at ? at + '.' + key : key); });
  })(value, '');
  return crypto.createHash('sha256').update(JSON.stringify(numbers)).digest('hex');
}
function flaggedPolicyRecords() {
  const land = require(path.join(ROOT, POLICY_FILES[0]));
  const records = [];
  land.models.forEach(function (model) {
    Object.keys(model.assessments).forEach(function (field) {
      const assessment = model.assessments[field];
      if (assessment.verify === true) records.push({ label: model.id + '.' + field, record: assessment });
    });
  });
  [
    [POLICY_FILES[1], 'programs'], [POLICY_FILES[2], 'models'], [POLICY_FILES[3], 'conventions'],
    [POLICY_FILES[4], 'programs'], [POLICY_FILES[5], 'providers']
  ].forEach(function (entry) {
    require(path.join(ROOT, entry[0]))[entry[1]].forEach(function (record) {
      if (record.verify === true) records.push({ label: record.id, record: record });
    });
  });
  return records;
}
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

const policyRecords = flaggedPolicyRecords();
assert.equal(policyRecords.length, 85, 'all 85 verify:true policy records are covered by the provenance contract');
const stateCounts = { source_confirmed: 0, calculated_estimate: 0, enter_your_value: 0, not_yet_verified: 0 };
policyRecords.forEach(function (item) {
  assert.equal(contract.validatePolicyProvenance(item.record, item.label), true, item.label + ' validates');
  stateCounts[contract.provenanceState(item.record)] += 1;
});
assert.deepEqual(stateCounts, { source_confirmed: 8, calculated_estimate: 3, enter_your_value: 68, not_yet_verified: 6 });

const placeholder = clone(policyRecords.find(function (item) { return contract.provenanceState(item.record) === 'enter_your_value'; }).record);
delete placeholder.evidence_basis;
assert.throws(() => contract.validatePolicyProvenance(placeholder, 'placeholder'), /evidence_basis is invalid/);

const unretrieved = clone(policyRecords.find(function (item) { return contract.provenanceState(item.record) === 'not_yet_verified'; }).record);
delete unretrieved.source_url;
assert.throws(() => contract.validatePolicyProvenance(unretrieved, 'unretrieved'), /unretrieved record requires source_url/);

const sourced = clone(policyRecords.find(function (item) { return contract.provenanceState(item.record) === 'source_confirmed'; }).record);
delete sourced.source_url;
assert.throws(() => contract.validatePolicyProvenance(sourced, 'sourced'), /source-confirmed record requires source_url/);

const verifyFlip = clone(sourced);
const stateBeforeVerifyFlip = contract.provenanceState(verifyFlip);
verifyFlip.verify = !verifyFlip.verify;
assert.equal(contract.provenanceState(verifyFlip), stateBeforeVerifyFlip, 'verify alone does not determine provenance state');

POLICY_FILES.forEach(function (file) {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  assert.equal(numericFingerprint(data), NUMERIC_FINGERPRINTS[file], file + ' numeric values must remain identical to the origin/main audit baseline');
});

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
