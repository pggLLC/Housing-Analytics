const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readJson(relPath) {
  return JSON.parse(read(relPath));
}

const rankingIndex = readJson('data/hna/ranking-index.json');
const rankingCount = rankingIndex.rankings.length;
assert.equal(rankingIndex.metadata.totalEntries, rankingCount, 'ranking-index metadata total matches rows');

// The geography universe is geo-config.json; ranking-index is derived from it.
// These two drifted apart because geo-config carried a duplicate GEOID
// (0812900 appeared as both "Central (city)" and "Central City (city)"), so
// the site advertised 547 geographies while only 546 could ever be ranked.
// Assert the invariant rather than blacklisting the stale number.
const geoConfig = readJson('data/hna/geo-config.json');
const geoConfigRows = [
  ...(geoConfig.counties || []),
  ...(geoConfig.places || []),
  ...(geoConfig.cdps || []),
];
const geoConfigGeoids = geoConfigRows.map((row) => String(row.geoid));
const duplicateGeoids = [...new Set(geoConfigGeoids.filter((id, i) => geoConfigGeoids.indexOf(id) !== i))];
assert.deepEqual(duplicateGeoids, [], `geo-config.json has duplicate GEOIDs: ${duplicateGeoids.join(', ')}`);
assert.equal(
  geoConfigGeoids.length,
  rankingCount,
  `geo-config geography count ${geoConfigGeoids.length} matches ranking-index count ${rankingCount}`
);

const indexHtml = read('index.html');
const jurisdictionTokens = [...indexHtml.matchAll(/\ball\s+(\d+)\s+Colorado\s+(?:jurisdictions|geographies)\b/g)]
  .map((m) => Number(m[1]));
assert(jurisdictionTokens.length >= 2, 'homepage exposes jurisdiction/geography count tokens');
for (const count of jurisdictionTokens) {
  assert.equal(count, rankingCount, `homepage count ${count} matches ranking-index count ${rankingCount}`);
}
assert(indexHtml.includes(`Explore all ${rankingCount} Colorado jurisdictions`), 'homepage hero link uses canonical jurisdiction count');
assert(indexHtml.includes(`ranks all ${rankingCount} Colorado`), 'homepage comparative path uses canonical ranking count');
assert(!/all\s+645\s+Colorado\s+jurisdictions/.test(indexHtml), 'homepage no longer uses stale 645 jurisdiction count');

// Every other surface that advertises the geography universe must agree with
// the canonical count. (Previously only a stale-value blacklist guarded this,
// which let 547 survive everywhere except index.html and the Finder.)
for (const [relPath, pattern] of [
  ['js/navigation.js', /Rank (\d+) geographies by housing need/],
  ['select-jurisdiction.html', /Rank all (\d+) geographies by need/],
  ['hna-comparative-analysis.html', /Ranks all (\d+) Colorado geographies/],
  ['hna-comparative-analysis.html', /percentile scoring across all (\d+) geographies/],
  ['hna-scenario-builder.html', /Total: (\d+) entries/],
  ['hna-scenario-builder.html', /dumping all (\d+) entries into the DOM/],
]) {
  const match = read(relPath).match(pattern);
  assert(match, `${relPath} exposes a geography count matching ${pattern}`);
  assert.equal(
    Number(match[1]),
    rankingCount,
    `${relPath} count ${match[1]} matches canonical ranking count ${rankingCount}`
  );
}

const policyScorecard = readJson('data/policy/housing-policy-scorecard.json');
assert.equal(
  Object.keys(policyScorecard.scores).length,
  rankingCount,
  'policy scorecard covers the canonical geography universe'
);

const lofHtml = read('lihtc-opportunity-finder.html');
assert(
  lofHtml.includes(`policy scorecard (${rankingCount} Colorado jurisdictions × 7`) &&
    lofHtml.includes(`Housing policy scorecard — ${rankingCount} jurisdictions × 7`),
  'Opportunity Finder policy scorecard count matches canonical ranking count'
);

const lihtc = readJson('data/chfa-lihtc.json');
const affordableProperties = readJson('data/affordable-housing/properties.json').properties;
const normalizePropertyKey = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizedNameAddress = affordableProperties.map((property) =>
  `${normalizePropertyKey(property.property_name)}|${normalizePropertyKey(property.address)}`
).filter((key) => key !== '|');
assert.equal(new Set(normalizedNameAddress).size, normalizedNameAddress.length, 'properties.json has no duplicate normalized name + address keys');
const independence = affordableProperties.filter((property) => /independence village/i.test(property.property_name || ''));
assert.equal(independence.length, 1, 'Independence Village is represented once');
assert.deepEqual(
  new Set(independence[0].merged_from),
  new Set(['CHFA PreservationProperties_Layer_Final_view_new', 'HUD MULTIFAMILY_PROPERTIES_ASSISTED']),
  'Independence Village retains both source attributions'
);
const dataQualitySrc = read('js/data-quality-check.js');
const coverageMatch = dataQualitySrc.match(/coverageLabel:\s*"(\d+)\s+placed-in-service CO LIHTC projects"/);
assert(coverageMatch, 'data quality check exposes CHFA LIHTC coverage label');
assert.equal(Number(coverageMatch[1]), lihtc.features.length, 'LIHTC coverage label matches chfa-lihtc feature count');
assert(!coverageMatch[0].includes('716'), 'LIHTC coverage label does not retain stale 716 count');

const methodologyHtml = read('hna-comparative-analysis.html');
const rankingJs = read('js/hna/hna-ranking-index.js');
for (const [label, source] of [
  ['comparative page', methodologyHtml],
  ['ranking tooltip', rankingJs],
]) {
  assert(source.includes('55%'), `${label} includes community-need weight`);
  assert(source.includes('45%'), `${label} includes opportunity weight`);
  assert(/augment(?:-only)?/.test(source), `${label} discloses commuter pressure as augment-only`);
  assert(!source.includes('50% unit gap'), `${label} no longer describes a 50% unit-gap weight`);
  assert(!source.includes('20% in-commuter'), `${label} no longer describes a 20% in-commuter weight`);
}

const regionalHtml = read('regional.html');
assert(!regionalHtml.includes('$12.8B'), 'regional first-paint fallback no longer uses stale $12.8B');
assert(!regionalHtml.includes('$3.75'), 'regional first-paint fallback no longer uses stale $3.75');
assert(regionalHtml.includes('$1.15B'), 'regional first-paint fallback uses $1.15B');
assert(regionalHtml.includes('$3.46'), 'regional first-paint fallback uses $3.46');

console.log(`public-facing-numbers: PASS (${rankingCount} jurisdictions, ${lihtc.features.length} LIHTC features)`);
