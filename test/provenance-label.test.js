'use strict';

const assert = require('assert');
const ProvenanceLabel = require('../js/provenance-label.js');

const sourced = {
  classification: 'observed', observation_class: 'human_verified', evidence_basis: 'primary_source',
  source_url: 'https://www.govinfo.gov/app/details/BILLS-119hr6644enr',
  source_note: 'The enacted text supports this value.', last_verified: '2026-07-16', verify: true
};
const modeled = {
  classification: 'modeled', observation_class: 'machine_inferred', evidence_basis: 'stated_method',
  calculation_note: 'Purchase price plus the stated annual rate multiplied by years held.', verify: true
};
const placeholder = {
  classification: 'user_entered', observation_class: 'unverified', evidence_basis: 'none',
  source_note: 'No external basis supports this screening default.', verify: true
};
const unretrieved = {
  classification: 'not_available', observation_class: 'unverified', evidence_basis: 'named_unretrieved',
  source_note: 'The controlling program document has not been retrieved.', verify: true
};

assert.equal(ProvenanceLabel(sourced).label, 'Source confirmed');
assert.equal(ProvenanceLabel(modeled).label, 'Calculated estimate');
assert.equal(ProvenanceLabel(placeholder).label, 'Enter your value');
assert.equal(ProvenanceLabel(unretrieved).label, 'Not yet verified');
assert.notEqual(ProvenanceLabel(sourced).label, ProvenanceLabel(placeholder).label);
assert.notEqual(ProvenanceLabel(placeholder).explanation, ProvenanceLabel(unretrieved).explanation);
assert(ProvenanceLabel(modeled).explanation.includes(modeled.calculation_note));
assert(ProvenanceLabel(placeholder).actionRequired.includes('Replace this value'));
assert(ProvenanceLabel(unretrieved).actionRequired.includes('Retrieve and check'));

const sourceHtml = ProvenanceLabel.html(sourced);
assert(sourceHtml.includes('View cited source'));
const href = sourceHtml.match(/href="([^"]+)"/)[1];
assert.doesNotThrow(() => new URL(href));

const verifyOff = Object.assign({}, sourced, { verify: false });
assert.equal(ProvenanceLabel(verifyOff).label, ProvenanceLabel(sourced).label,
  'legacy verify flag alone must not drive the novice-facing state');

console.log('Provenance label translator tests passed.');
