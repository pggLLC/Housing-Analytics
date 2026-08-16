const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const geoConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'data/hna/geo-config.json'), 'utf8'));
const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'data/hna/geography-registry.json'), 'utf8'));

// A GEOID must appear exactly once across counties/places/cdps. 0812900 was
// listed twice ("Central (city)" and "Central City (city)"), inflating the
// advertised geography count to 547 against a 546-row ranking-index.
const allRows = [
  ...(geoConfig.counties || []),
  ...(geoConfig.places || []),
  ...(geoConfig.cdps || []),
];
const seen = new Map();
const duplicates = [];
for (const row of allRows) {
  const geoid = String(row.geoid);
  if (seen.has(geoid)) {
    duplicates.push(`${geoid}: "${seen.get(geoid)}" / "${row.label}"`);
  } else {
    seen.set(geoid, row.label);
  }
}
assert.deepEqual(duplicates, [], `duplicate GEOIDs in geo-config.json:\n${duplicates.join('\n')}`);

const registryByGeoid = new Map(
  registry.geographies
    .filter((row) => row && row.type === 'place' && row.containingCounty)
    .map((row) => [String(row.geoid), row])
);

const mismatches = [];
let checked = 0;
let summariesChecked = 0;

for (const row of geoConfig.places || []) {
  if (!row || !row.containingCounty) continue;
  const registryRow = registryByGeoid.get(String(row.geoid));
  if (!registryRow) continue;
  checked += 1;

  const actual = String(row.containingCounty).padStart(5, '0');
  const expected = String(registryRow.containingCounty).padStart(5, '0');
  if (actual !== expected) {
    mismatches.push(`${row.geoid} ${row.label || registryRow.name}: geo-config=${actual}, registry=${expected}`);
  }

  const summaryPath = path.join(repoRoot, 'data/hna/summary', `${row.geoid}.json`);
  if (fs.existsSync(summaryPath)) {
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    const summaryCounty = summary && summary.geo && summary.geo.containingCounty;
    if (summaryCounty) {
      summariesChecked += 1;
      const summaryActual = String(summaryCounty).padStart(5, '0');
      if (summaryActual !== expected) {
        mismatches.push(`${row.geoid} ${row.label || registryRow.name}: summary=${summaryActual}, registry=${expected}`);
      }
    }
  }
}

assert.ok(checked > 0, 'expected to compare at least one place in geo-config against the registry');
assert.ok(summariesChecked > 0, 'expected to compare at least one cached summary against the registry');
assert.deepEqual(mismatches, [], `geo-config containingCounty mismatches:\n${mismatches.join('\n')}`);

console.log(`geo-config-county-consistency: PASS (${checked} places, ${summariesChecked} summaries checked)`);
