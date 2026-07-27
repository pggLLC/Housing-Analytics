const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const aliasPath = path.join(root, 'data/hna/place-phantom-aliases.json');
const rankingPath = path.join(root, 'data/hna/ranking-index.json');
const ownershipNeedPath = path.join(root, 'data/hna/ownership-need.json');
const summaryDir = path.join(root, 'data/hna/summary');
const digestDir = path.join(root, 'data/hna/jurisdiction-metrics-digest');

const aliasesDoc = JSON.parse(fs.readFileSync(aliasPath, 'utf8'));
const rankingsDoc = JSON.parse(fs.readFileSync(rankingPath, 'utf8'));
const ownershipNeedDoc = JSON.parse(fs.readFileSync(ownershipNeedPath, 'utf8'));
const aliasGeoids = Object.keys(aliasesDoc.aliases || {}).map((geoid) => geoid.padStart(7, '0'));
const rankings = rankingsDoc.rankings || [];
const ownershipNeedRecords = ownershipNeedDoc.records || {};

assert.ok(aliasGeoids.length >= 31, 'phantom alias registry should cover the known phantom GEOIDs');

for (const geoid of aliasGeoids) {
  const rankingRows = rankings.filter((row) => String(row.geoid).padStart(7, '0') === geoid);
  assert.equal(rankingRows.length, 0, `phantom alias ${geoid} must not appear in ranking-index rankings`);

  const summaryPath = path.join(summaryDir, `${geoid}.json`);
  assert.equal(fs.existsSync(summaryPath), false, `phantom alias summary file must not exist: ${summaryPath}`);

  const digestPath = path.join(digestDir, `${geoid}.json`);
  assert.equal(fs.existsSync(digestPath), false, `phantom alias digest file must not exist: ${digestPath}`);

  assert.equal(
    Object.hasOwn(ownershipNeedRecords, geoid),
    false,
    `phantom alias ${geoid} must not appear in ownership-need records`,
  );
}

const centralCityRows = rankings.filter((row) => String(row.geoid).padStart(7, '0') === '0812900');
assert.equal(centralCityRows.length, 1, 'canonical Central City row 0812900 should exist exactly once');
assert.match(String(centralCityRows[0].name || centralCityRows[0].label || ''), /Central/i);

console.log('phantom-alias-no-orphans: PASS');
