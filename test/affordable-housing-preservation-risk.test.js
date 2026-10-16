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
const urgent5y = preservation.filter((p) => Number.isFinite(p.years_to_expiration) && p.years_to_expiration >= 0 && p.years_to_expiration <= 5);
const lapsed = preservation.filter((p) => Number.isFinite(p.years_to_expiration) && p.years_to_expiration < 0);

assert.equal(preservation.length, props.metadata.program_type_counts['preservation-candidate'], 'metadata preservation-candidate count should match records');
assert(withExpiration.length > 0, 'fixture should include preservation records with known expiration timing');
assert.equal(withRisk.length, withExpiration.length, 'risk_status should be populated exactly for records with expiration evidence');
assert.equal(withoutExpirationRisk.length, 0, 'risk_status must stay null when no expiration evidence exists');
assert(urgent5y.every((p) => p.risk_status === 'expiration_0_5_years'), '0-5y expiration records should carry the urgent risk_status bucket');
assert(lapsed.length > 0, 'fixture should include records whose restriction date is already past');
assert(lapsed.every((p) => p.risk_status === 'expired'), 'a restriction date already past is bucketed expired, never 0-5 years');

assert(builderSrc.includes('function preservationRiskStatus'), 'builder should define risk_status from expiration evidence');
assert(/expBuckets\s*=\s*\{\s*'expired'/.test(builderSrc) && /y < 0\) expBuckets\['expired'\]/.test(builderSrc),
  'builder urgency breakdown should count a past restriction date as expired, not 0-5y');

// Every renderer that formats years_to_expiration must branch on a negative
// value before the "expires in" leg, or a lapsed restriction renders as
// "expires in -20y". Structural check: a `< 0 ?` (or `< 0) return`) guard
// within the statement that carries the wording. The wording itself is a
// choice and is not pinned.
function walkJs(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    if (d.name === 'vendor') return;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) walkJs(full, out);
    else if (d.name.endsWith('.js')) out.push(full);
  });
  return out;
}
const expiresMarker = "'⚠ expires in '";
const renderers = walkJs(path.join(ROOT, 'js'), []).filter((f) => fs.readFileSync(f, 'utf8').includes(expiresMarker));
assert(renderers.length >= 4, `scan should find the renderers that format years_to_expiration (found ${renderers.length})`);
renderers.forEach((f) => {
  const src = fs.readFileSync(f, 'utf8');
  let from = 0;
  while (true) {
    const at = src.indexOf(expiresMarker, from);
    if (at === -1) break;
    const window = src.slice(Math.max(0, at - 260), at);
    assert(/(?:years_to_expiration|\by)\s*<\s*0\s*(?:\?|\)\s*return)/.test(window),
      `${path.relative(ROOT, f)} formats years_to_expiration without a negative-value branch near offset ${at}`);
    from = at + expiresMarker.length;
  }
});
assert(layerSrc.includes('Preservation source inventory'), 'map legend should label preservation-candidate as source inventory');
assert(layerSrc.includes('This is source-feed membership, not an at-risk finding'), 'map legend should not imply every preservation-candidate is at risk');
assert(layerSrc.includes('Restriction timing known'), 'map legend should include a separate known-expiration entry');
assert(!layerSrc.includes('Property at risk of losing affordability restrictions'), 'old universal at-risk legend copy should not remain');
assert(compareSrc.includes('Tracked subsidized/preservation-source inventory'), 'compare copy should describe preservation count as inventory');
assert(compareSrc.includes('true near-term at-risk subset'), 'compare copy should reserve at-risk language for known expiration records');
assert(!compareSrc.includes('CHFA-tracked at-risk subsidized rental properties'), 'old compare at-risk copy should not remain');
assert(marketSrc.includes('preservation-source inventory'), 'market report copy should describe non-LIHTC preservation records as source inventory');

console.log('affordable-housing-preservation-risk: ok');
