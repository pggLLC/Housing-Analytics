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

// Every consumer that thresholds years_to_expiration — a renderer choosing an
// "expires in" leg, a rollup counting <= 5 / <= 10 — must first rule out a
// negative value, or a lapsed restriction renders as "expires in -20y" and is
// counted as expiring within five years. Discovery is structural: a comparison
// of years_to_expiration, or of a local alias assigned from it, against a
// positive threshold. The display copy is a choice and is never read.
function walkJs(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((d) => {
    if (d.name === 'vendor') return;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) walkJs(full, out);
    else if (d.name.endsWith('.js')) out.push(full);
  });
  return out;
}
function thresholdSites(src) {
  const names = ['years_to_expiration'];
  const aliasRe = /\b([A-Za-z_$][\w$]*)\s*=\s*[\w$.]*\byears_to_expiration\b/g;
  let m;
  while ((m = aliasRe.exec(src))) if (!names.includes(m[1])) names.push(m[1]);
  const alt = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const cmpRe = new RegExp('\\b(?:' + alt + ')\\s*<=?\\s*[1-9]\\d*\\b', 'g');
  const guardRe = new RegExp('\\b(?:' + alt + ')\\s*(?:<\\s*0|>=\\s*0)\\b');
  const sites = [];
  while ((m = cmpRe.exec(src))) sites.push({ at: m.index, text: m[0] });
  return { sites, guardRe };
}
const scanned = walkJs(path.join(ROOT, 'js'), []).concat([path.join(ROOT, 'scripts/build-affordable-housing-properties.js')]);
let thresholdCount = 0;
scanned.forEach((f) => {
  const src = fs.readFileSync(f, 'utf8');
  if (!src.includes('years_to_expiration')) return;
  const { sites, guardRe } = thresholdSites(src);
  sites.forEach((site) => {
    // A comparison quoted in a comment is not code.
    const linePrefix = src.slice(src.lastIndexOf('\n', site.at) + 1, site.at);
    if (/\/\/|^\s*\*/.test(linePrefix)) return;
    thresholdCount++;
    const window = src.slice(Math.max(0, site.at - 320), site.at);
    assert(guardRe.test(window),
      `${path.relative(ROOT, f)} compares years_to_expiration ("${site.text}") without first ruling out a negative value, near offset ${site.at}`);
  });
});
assert(thresholdCount > 0, 'scan should find consumers that threshold years_to_expiration');
assert(layerSrc.includes('Preservation source inventory'), 'map legend should label preservation-candidate as source inventory');
assert(layerSrc.includes('This is source-feed membership, not an at-risk finding'), 'map legend should not imply every preservation-candidate is at risk');
assert(layerSrc.includes('Restriction timing known'), 'map legend should include a separate known-expiration entry');
assert(!layerSrc.includes('Property at risk of losing affordability restrictions'), 'old universal at-risk legend copy should not remain');
assert(compareSrc.includes('Tracked subsidized/preservation-source inventory'), 'compare copy should describe preservation count as inventory');
assert(compareSrc.includes('true near-term at-risk subset'), 'compare copy should reserve at-risk language for known expiration records');
assert(!compareSrc.includes('CHFA-tracked at-risk subsidized rental properties'), 'old compare at-risk copy should not remain');
assert(marketSrc.includes('preservation-source inventory'), 'market report copy should describe non-LIHTC preservation records as source inventory');

console.log('affordable-housing-preservation-risk: ok');
