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
assert(!/ranks\s+all\s+547\s+Colorado/.test(indexHtml), 'homepage no longer uses stale 547 ranking count');

const lihtc = readJson('data/chfa-lihtc.json');
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
