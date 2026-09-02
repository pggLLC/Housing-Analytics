#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const REGISTRY_PATH = path.join(ROOT, 'data/policy/county-parcel-sources.json');
const GEO_CONFIG_PATH = path.join(ROOT, 'data/hna/geo-config.json');
const CANONICAL_COUNTIES = new Map(
  JSON.parse(fs.readFileSync(GEO_CONFIG_PATH, 'utf8')).counties.map(function (county) {
    return [county.geoid, county.label.replace(/ County$/, '')];
  })
);

const SOURCE_STATUSES = new Set(['verified_live_source', 'source_found_schema_unmapped', 'source_requires_auth', 'source_blocks_automation', 'source_not_found', 'source_verification_pending']);
const EVIDENCE_STATUSES = new Set(['verified_primary_record', 'source_reachable_parcel_not_found', 'source_unavailable', 'ownership_mismatch', 'attribute_mismatch', 'generic_claim_no_parcel_evidence']);
const CLASSIFICATIONS = new Set(['modeled', 'user_entered', 'observed', 'not_available']);
const OBSERVATION_CLASSES = new Set(['machine_observed', 'machine_inferred', 'human_verified', 'unverified']);
const ENUMS = {
  building_footprint_status: new Set(['footprint_present', 'footprint_absent', 'not_screened']),
  vacancy_status: new Set(['no_footprint_detected', 'field_verified_vacant', 'field_verified_occupied', 'not_assessed']),
  residential_use_status: new Set(['zoning_permits_residential', 'entitlement_confirmed', 'not_screened']),
  disposition_status: new Set(['surplus_declared', 'not_surplus', 'disposition_policy_unknown', 'not_verified']),
  owner_interest_status: new Set(['interest_confirmed', 'interest_declined', 'not_contacted'])
};
const NULLABLE_STAGES = ['parcel_id', 'recorded_owner', 'normalized_owner', 'owner_type', 'acreage', 'centroid', 'current_use', 'building_footprint_status', 'vacancy_status', 'zoning', 'residential_use_status', 'disposition_status', 'owner_interest_status', 'retrieved_at', 'source_layer_id', 'source_record_url', 'source', 'source_url', 'source_note'];
const HUMAN_VALUES = new Set(['field_verified_vacant', 'field_verified_occupied', 'entitlement_confirmed', 'surplus_declared', 'not_surplus', 'interest_confirmed', 'interest_declined']);
const REGISTRY_FIELDS = ['county_fips', 'county_name', 'source_status', 'endpoint', 'layer_id', 'field_map', 'verified_at', 'verified_by', 'blocked_reason'];
const PARCEL_FIELDS = ['county_fips', 'parcel_id', 'recorded_owner', 'normalized_owner', 'owner_type', 'acreage', 'centroid', 'current_use', 'building_footprint_status', 'vacancy_status', 'zoning', 'residential_use_status', 'disposition_status', 'owner_interest_status', 'evidence_status', 'retrieved_at', 'source_layer_id', 'source_record_url', 'unavailable_reason', 'source', 'source_url', 'classification', 'observation_class', 'verify', 'source_note'];

function assertValid(errors, label) {
  if (errors.length) throw new Error(label + ':\n- ' + errors.join('\n- '));
  return true;
}

function validateRegistry(registry) {
  const errors = [];
  const counties = registry && registry.counties;
  if (!registry || registry.schema !== 'county-parcel-sources/v1') errors.push('schema must be county-parcel-sources/v1');
  if (!Array.isArray(counties)) {
    errors.push('counties must be an array');
    return assertValid(errors, 'County parcel source registry invalid');
  }
  if (counties.length !== 64) errors.push('registry must contain exactly 64 counties; found ' + counties.length);
  const seen = new Set();
  counties.forEach(function (county, index) {
    const at = 'counties[' + index + ']';
    if (!county || typeof county !== 'object') { errors.push(at + ' must be an object'); return; }
    REGISTRY_FIELDS.forEach(function (field) {
      if (!Object.prototype.hasOwnProperty.call(county, field)) errors.push(at + ' is missing required field ' + field);
    });
    if (!/^08[0-9]{3}$/.test(county.county_fips || '')) errors.push(at + '.county_fips must be a five-digit Colorado FIPS string');
    if (seen.has(county.county_fips)) errors.push(at + '.county_fips is duplicated: ' + county.county_fips);
    seen.add(county.county_fips);
    if (typeof county.county_name !== 'string' || !county.county_name.trim()) errors.push(at + '.county_name is required');
    if (!CANONICAL_COUNTIES.has(county.county_fips)) errors.push(at + '.county_fips is not one of Colorado\'s 64 canonical counties');
    else if (CANONICAL_COUNTIES.get(county.county_fips) !== county.county_name) errors.push(at + '.county_name does not match the canonical geography registry');
    if (!SOURCE_STATUSES.has(county.source_status)) errors.push(at + '.source_status is invalid');
    if (county.source_status === 'source_verification_pending') {
      ['endpoint', 'layer_id', 'field_map', 'verified_at', 'verified_by'].forEach(function (field) {
        if (county[field] !== null) errors.push(at + ' pending source must have ' + field + ' null');
      });
    }
    if (county.source_status === 'verified_live_source') {
      if (typeof county.endpoint !== 'string' || !county.endpoint) errors.push(at + ' verified source requires endpoint');
      if (county.layer_id === null || county.layer_id === undefined) errors.push(at + ' verified source requires layer_id');
      if (!county.field_map || typeof county.field_map !== 'object') errors.push(at + ' verified source requires field_map');
      if (typeof county.verified_at !== 'string' || !county.verified_at) errors.push(at + ' verified source requires verified_at');
      if (typeof county.verified_by !== 'string' || !county.verified_by) errors.push(at + ' verified source requires verified_by');
    }
  });
  return assertValid(errors, 'County parcel source registry invalid');
}

function validateParcel(parcel, options) {
  const errors = [];
  const writer = (options && options.writer) || 'human';
  if (!parcel || typeof parcel !== 'object') return assertValid(['parcel must be an object'], 'Public-land parcel invalid');
  PARCEL_FIELDS.forEach(function (field) {
    if (!Object.prototype.hasOwnProperty.call(parcel, field)) errors.push('missing required field ' + field);
  });
  if (!/^[0-9]{5}$/.test(parcel.county_fips || '')) errors.push('county_fips must be exactly five digits');
  if (!EVIDENCE_STATUSES.has(parcel.evidence_status)) errors.push('evidence_status is invalid');
  if (!CLASSIFICATIONS.has(parcel.classification)) errors.push('classification is invalid');
  if (!OBSERVATION_CLASSES.has(parcel.observation_class)) errors.push('observation_class is invalid');
  if (typeof parcel.verify !== 'boolean') errors.push('verify must be boolean');
  Object.keys(ENUMS).forEach(function (field) {
    if (parcel[field] !== null && !ENUMS[field].has(parcel[field])) errors.push(field + ' has an invalid controlled value');
  });
  const reasons = parcel.unavailable_reason;
  if (!reasons || typeof reasons !== 'object' || Array.isArray(reasons)) errors.push('unavailable_reason must be an object');
  else NULLABLE_STAGES.forEach(function (field) {
    if (parcel[field] === null && (typeof reasons[field] !== 'string' || !reasons[field].trim())) errors.push(field + ' is null and requires unavailable_reason.' + field);
  });
  const humanFields = ['vacancy_status', 'residential_use_status', 'disposition_status', 'owner_interest_status'];
  const humanClaims = humanFields.filter(function (field) { return HUMAN_VALUES.has(parcel[field]); });
  if (writer === 'machine' && humanClaims.length) errors.push('machine writer cannot produce human-only values: ' + humanClaims.join(', '));
  if (humanClaims.length && parcel.observation_class !== 'human_verified') errors.push('human-only values require observation_class human_verified');
  if (parcel.evidence_status !== 'verified_primary_record' && (parcel.vacancy_status === 'field_verified_vacant' || parcel.vacancy_status === 'field_verified_occupied')) errors.push('field-verified vacancy requires evidence_status verified_primary_record');
  return assertValid(errors, 'Public-land parcel invalid');
}

function runCli() {
  validateRegistry(JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8')));
  console.log('public-land contract: PASS (64 county source records; honest unknowns enforced)');
}

if (require.main === module) runCli();
module.exports = { SOURCE_STATUSES, EVIDENCE_STATUSES, CLASSIFICATIONS, OBSERVATION_CLASSES, HUMAN_VALUES, NULLABLE_STAGES, validateRegistry, validateParcel };
