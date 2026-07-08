#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const props = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/affordable-housing/properties.json'), 'utf8'));
const properties = props.properties || [];
const layerSrc = fs.readFileSync(path.join(ROOT, 'js/components/affordable-housing-layer.js'), 'utf8');
const compareSrc = fs.readFileSync(path.join(ROOT, 'js/compare.js'), 'utf8');
const marketSrc = fs.readFileSync(path.join(ROOT, 'js/market-analysis/market-report-renderers.js'), 'utf8');
const builderSrc = fs.readFileSync(path.join(ROOT, 'scripts/build-affordable-housing-properties.js'), 'utf8');

assert(properties.length > 0, 'properties.json should contain affordable-housing records');

const preservation = properties.filter((p) => (p.program_type || []).includes('preservation-candidate'));
const withExpiration = preservation.filter((p) => Number.isFinite(p.years_to_expiration));
const withRisk = preservation.filter((p) => p.risk_status != null);
const withoutExpirationRisk = preservation.filter((p) => !Number.isFinite(p.years_to_expiration) && p.risk_status != null);
const urgent5y = preservation.filter((p) => Number.isFinite(p.years_to_expiration) && p.years_to_expiration <= 5);

assert.equal(preservation.length, props.metadata.program_type_counts['preservation-candidate'], 'metadata preservation-candidate count should match records');
assert(withExpiration.length > 0, 'fixture should include preservation records with known expiration timing');
assert.equal(withRisk.length, withExpiration.length, 'risk_status should be populated exactly for records with expiration evidence');
assert.equal(withoutExpirationRisk.length, 0, 'risk_status must stay null when no expiration evidence exists');
assert(urgent5y.every((p) => p.risk_status === 'expiration_0_5_years'), '0-5y expiration records should carry the urgent risk_status bucket');

assert(builderSrc.includes('function preservationRiskStatus'), 'builder should define risk_status from expiration evidence');
assert(layerSrc.includes('Preservation source inventory'), 'map legend should label preservation-candidate as source inventory');
assert(layerSrc.includes('This is source-feed membership, not an at-risk finding'), 'map legend should not imply every preservation-candidate is at risk');
assert(layerSrc.includes('Restriction timing known'), 'map legend should include a separate known-expiration entry');
assert(!layerSrc.includes('Property at risk of losing affordability restrictions'), 'old universal at-risk legend copy should not remain');
assert(compareSrc.includes('Tracked subsidized/preservation-source inventory'), 'compare copy should describe preservation count as inventory');
assert(compareSrc.includes('true near-term at-risk subset'), 'compare copy should reserve at-risk language for known expiration records');
assert(!compareSrc.includes('CHFA-tracked at-risk subsidized rental properties'), 'old compare at-risk copy should not remain');
assert(marketSrc.includes('preservation-source inventory'), 'market report copy should describe non-LIHTC preservation records as source inventory');

console.log('affordable-housing-preservation-risk: ok');
