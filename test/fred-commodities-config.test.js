const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

const fredCommoditiesSrc = read('js/fred-commodities.js');
const fetcherSrc = read('scripts/fetch_fred_data.py');
const commoditiesHtml = read('construction-commodities.html');
const fredData = JSON.parse(read('data/fred-data.json'));

const pageSeriesIds = new Set(
  [...fredCommoditiesSrc.matchAll(/id:\s*'([^']+)'/g)].map((match) => match[1])
);

const workflowSeries = new Map(
  [...fetcherSrc.matchAll(/"([A-Z0-9]+)":\s*\("([^"]+)"/g)]
    .map((match) => [match[1], match[2]])
);

assert(pageSeriesIds.size > 0, 'fred-commodities.js declares FRED series IDs');
assert(workflowSeries.size > 0, 'fetch-fred-data workflow declares SERIES IDs');

const missingFromWorkflow = [...pageSeriesIds].filter((seriesId) => !workflowSeries.has(seriesId));
assert.deepEqual(missingFromWorkflow, [], 'every commodity page series is present in the FRED fetch config');

const expectedNewSeries = new Map([
  ['PCU331420331420A', 'Copper Wire & Cable PPI'],
  ['WPU10260306', 'Building Wire and Cable'],
  ['PCU3211133211133', 'Softwood Lumber PPI'],
  ['WPU1322', 'Cement, Hydraulic'],
  ['PCU327320327320', 'Ready-Mix Concrete'],
  ['PCU327420327420', 'Gypsum Product Manufacturing'],
  ['PCU324121324121', 'Asphalt Paving'],
  ['WPU1392', 'Insulation Materials'],
  ['WPU0531', 'Natural Gas'],
]);

for (const [seriesId, label] of expectedNewSeries) {
  assert(workflowSeries.has(seriesId), `${seriesId} is present in the FRED fetch config`);
  assert.equal(workflowSeries.get(seriesId), label, `${seriesId} uses the commodity page label`);
}

for (const [seriesId, label] of [
  ['WPU10260306', 'Building Wire and Cable'],
  ['WPU1322', 'Cement, Hydraulic'],
  ['PCU327420327420', 'Gypsum Product Manufacturing'],
]) {
  assert.equal(fredData.series[seriesId].name, label, `${seriesId} display name matches its FRED coverage`);
  assert(fredData.series[seriesId].title.includes(label), `${seriesId} display name is present in its retrieved FRED title`);
}

for (const [label, source] of [
  ['fred-commodities.js', fredCommoditiesSrc],
  ['fetch_fred_data.py', fetcherSrc],
  ['construction-commodities.html', commoditiesHtml],
]) {
  assert(!source.includes('WPU10170503'), `${label} no longer references discontinued WPU10170503`);
}

assert(/const\s+STALE_MONTHS\s*=\s*15\b/.test(fredCommoditiesSrc), 'fred-commodities.js defines STALE_MONTHS = 15');
assert(fredCommoditiesSrc.includes('_isSeriesStale'), 'fred-commodities.js checks whether a series is stale');
assert(fredCommoditiesSrc.includes('fredData.updated'), 'freshness check is anchored to fred-data.json updated timestamp');
assert(/continue;/.test(fredCommoditiesSrc), 'stale current-indicator series are skipped during render');

const FREDCommodities = require('../js/fred-commodities.js');

(async () => {
  const states = ['invalid_id', 'discontinued', 'temporarily_unavailable', 'awaiting_release'];
  for (const state of states) {
    const reason = state === 'discontinued'
      ? 'Series discontinued; last observation 2018-06-01. Historical values are retained.'
      : `${state} reason from data`;
    FREDCommodities._fredDataCache = {
      updated: '2026-09-03T00:00:00Z',
      series: {
        PCU331110331110: {
          status: state,
          unavailable_reason: reason,
          observations: []
        },
        PCU331420331420A: {
          status: 'ok',
          unavailable_reason: null,
          observations: Array.from({length: 13}, (_, i) => ({date: `2025-${String(i + 1).padStart(2, '0')}-01`, value: String(100 + i)}))
        }
      }
    };
    const rendered = await FREDCommodities.getAllCommodities();
    assert.equal(rendered.steelMillProducts.status, state, `${state} reaches the consumer`);
    assert.equal(rendered.steelMillProducts.unavailableReason, reason, `${state} carries its data reason`);
    if (state === 'discontinued') {
      assert(rendered.steelMillProducts.unavailableReason.includes('2018-06-01'), 'discontinued rendering carries the final observation date');
    }
    if (state === 'temporarily_unavailable') {
      assert(!/last observation/i.test(rendered.steelMillProducts.unavailableReason), 'temporary unavailability does not invent an end date');
    }
    assert.equal(rendered.copperWireCable.status, undefined, 'healthy series still renders normally');
    assert.equal(rendered.copperWireCable.current, 112, 'healthy series retains its value');
  }
  assert(commoditiesHtml.includes('commodity.unavailableReason'), 'construction page renders the reason carried with a non-OK series');
  console.log(`fred-commodities-config: PASS (${pageSeriesIds.size} page series reconciled)`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
