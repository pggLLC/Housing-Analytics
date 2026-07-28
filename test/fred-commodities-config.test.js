const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

const fredCommoditiesSrc = read('js/fred-commodities.js');
const workflowSrc = read('.github/workflows/fetch-fred-data.yml');
const commoditiesHtml = read('construction-commodities.html');

const pageSeriesIds = new Set(
  [...fredCommoditiesSrc.matchAll(/id:\s*'([^']+)'/g)].map((match) => match[1])
);

const workflowSeries = new Map(
  [...workflowSrc.matchAll(/^\s*"([A-Z0-9]+)":\s*"([^"]+)"/gm)]
    .map((match) => [match[1], match[2]])
);

assert(pageSeriesIds.size > 0, 'fred-commodities.js declares FRED series IDs');
assert(workflowSeries.size > 0, 'fetch-fred-data workflow declares SERIES IDs');

const missingFromWorkflow = [...pageSeriesIds].filter((seriesId) => !workflowSeries.has(seriesId));
assert.deepEqual(missingFromWorkflow, [], 'every commodity page series is present in the FRED fetch config');

const expectedNewSeries = new Map([
  ['PCU33142033142012', 'Copper Wire & Cable PPI'],
  ['WPU10210301', 'Copper Building Wire'],
  ['PCU32121132121103', 'Softwood Lumber PPI'],
  ['WPU13310101', 'Portland Cement'],
  ['PCU32732032732021', 'Ready-Mix Concrete'],
  ['PCU32742032742012', 'Gypsum Drywall PPI'],
  ['PCU32412132412121', 'Asphalt Paving'],
  ['PCU32721432721412', 'Insulation Materials'],
  ['WPU0531', 'Natural Gas'],
]);

for (const [seriesId, label] of expectedNewSeries) {
  assert(workflowSeries.has(seriesId), `${seriesId} is present in the FRED fetch config`);
  assert.equal(workflowSeries.get(seriesId), label, `${seriesId} uses the commodity page label`);
}

for (const [label, source] of [
  ['fred-commodities.js', fredCommoditiesSrc],
  ['fetch-fred-data.yml', workflowSrc],
  ['construction-commodities.html', commoditiesHtml],
]) {
  assert(!source.includes('WPU10170503'), `${label} no longer references discontinued WPU10170503`);
}

assert(/const\s+STALE_MONTHS\s*=\s*15\b/.test(fredCommoditiesSrc), 'fred-commodities.js defines STALE_MONTHS = 15');
assert(fredCommoditiesSrc.includes('_isSeriesStale'), 'fred-commodities.js checks whether a series is stale');
assert(fredCommoditiesSrc.includes('fredData.updated'), 'freshness check is anchored to fred-data.json updated timestamp');
assert(/continue;/.test(fredCommoditiesSrc), 'stale current-indicator series are skipped during render');

console.log(`fred-commodities-config: PASS (${pageSeriesIds.size} page series reconciled)`);
