#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function loadScript(rel) {
  require(path.join(ROOT, rel));
}

global.window = global;
global.location = { search: '' };
global.localStorage = (() => {
  const store = {};
  return {
    getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; },
    clear() { Object.keys(store).forEach(k => delete store[k]); },
    _store: store,
  };
})();

loadScript('js/projections/scenario-presets.js');
loadScript('js/hna/hna-utils.js');
loadScript('js/projections/scenario-storage.js');
loadScript('js/projections/scenario-builder.js');

const canonical = global.ScenarioPresets.list;
const hna = global.HNAUtils.PROJECTION_SCENARIOS;
const builder = global.ScenarioBuilder.BUILT_IN_SCENARIOS;

assert.deepEqual(
  canonical.map(p => p.key),
  ['baseline', 'low_growth', 'high_growth'],
  'canonical scenario keys use underscores',
);

assert.deepEqual(
  Object.fromEntries(canonical.map(preset => [preset.key, preset.params])),
  {
    baseline: { births_pct: 100, deaths_pct: 100, migration_pct: 100 },
    low_growth: { births_pct: 100, deaths_pct: 100, migration_pct: 50 },
    high_growth: { births_pct: 100, deaths_pct: 100, migration_pct: 150 },
  },
  'Scenario Builder presets are percentages of SDO\'s forecast: SDO, half and 1.5x its migration',
);

for (const preset of canonical) {
  const builderPreset = builder.find(s => s.id === preset.key);
  assert(builderPreset, `Scenario Builder exposes ${preset.key}`);
  assert.deepEqual(
    builderPreset.params,
    preset.params,
    `Scenario Builder params for ${preset.key} come from shared presets`,
  );
  assert(hna[preset.key], `the HNA page has a ${preset.key} line`);
}

// The HNA page's low and high lines are not the builder's presets: they scale
// projected growth by a factor (hna-renderers _scenarioGrowthSensitivitySeries).
// Their labels and descriptions must name the factor the renderer applies.
const renderers = read('js/hna/hna-renderers.js');
for (const key of ['low_growth', 'high_growth']) {
  const label = hna[key].label;
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = renderers.match(new RegExp(`label: '${escaped}', data: _scenarioGrowthSensitivitySeries\\(baseline, ([\\d.]+)\\)`));
  assert(m, `the HNA chart draws a "${label}" line with a growth factor`);
  const pct = Math.round(Math.abs(Number(m[1]) - 1) * 100);
  assert(hna[key].description.includes(`${pct}%`), `HNA ${key} description names the ${pct}% the chart applies`);
  assert(!/move in|migration of|people a year/.test(hna[key].description.replace('Scenario Builder', '')),
    `HNA ${key} description does not describe a migration preset the chart does not draw`);
}

assert.deepEqual(
  builder.map(s => s.id),
  ['baseline', 'low_growth', 'high_growth'],
  'Scenario Builder internal keys use underscores',
);

const jsFiles = fs.readdirSync(path.join(ROOT, 'js'), { recursive: true })
  .filter(name => String(name).endsWith('.js'));
const hyphenKeyPattern = /(['"`])(?:low|high)-growth\1|data-scenario=["'](?:low|high)-growth["']/;
for (const file of jsFiles) {
  const rel = path.join('js', file);
  assert(!hyphenKeyPattern.test(read(rel)), `${rel} must not contain hyphenated scenario key literals`);
}

const scenarioBuilderHtml = read('hna-scenario-builder.html');
assert(scenarioBuilderHtml.includes('data-scenario="low_growth"'), 'Scenario Builder low-growth button uses low_growth key');
assert(scenarioBuilderHtml.includes('data-scenario="high_growth"'), 'Scenario Builder high-growth button uses high_growth key');
assert(!scenarioBuilderHtml.includes('data-scenario="low-growth"'), 'Scenario Builder no longer has low-growth button key');
assert(!scenarioBuilderHtml.includes('data-scenario="high-growth"'), 'Scenario Builder no longer has high-growth button key');

const hnaHtml = read('housing-needs-assessment.html');
assert(
  hnaHtml.indexOf('js/projections/scenario-presets.js') < hnaHtml.indexOf('js/hna/hna-utils.js'),
  'HNA loads shared presets before hna-utils.js',
);
assert(
  scenarioBuilderHtml.indexOf('js/projections/scenario-presets.js') < scenarioBuilderHtml.indexOf('js/projections/scenario-builder.js'),
  'Scenario Builder loads shared presets before scenario-builder.js',
);

const legacyLow = ['low', 'growth'].join('-');
const legacyHigh = ['high', 'growth'].join('-');
localStorage.setItem('coho_hna_scenarios', JSON.stringify([
  {
    id: legacyLow,
    name: 'Legacy Low',
    scenarioKey: legacyHigh,
    presetKey: legacyLow,
    sourceScenario: legacyHigh,
    parameters: { fertility_multiplier: 0.9, mortality_multiplier: 1.02, net_migration_annual: 250 },
  },
]));

const normalized = global.ScenarioStorage.list()[0];
assert.equal(normalized.id, 'low_growth', 'legacy saved id normalizes to low_growth');
assert.equal(normalized.scenarioKey, 'high_growth', 'legacy scenarioKey normalizes to high_growth');
assert.equal(normalized.presetKey, 'low_growth', 'legacy presetKey normalizes to low_growth');
assert.equal(normalized.sourceScenario, 'high_growth', 'legacy sourceScenario normalizes to high_growth');
assert(global.ScenarioStorage.get('low_growth'), 'normalized saved scenario reads by underscore id');
assert(global.ScenarioStorage.get(legacyLow), 'legacy hyphen id still reads through get() compatibility');
assert(JSON.parse(localStorage.getItem('coho_hna_scenarios'))[0].id === 'low_growth', 'normalizer persists migrated saved scenario');

console.log('scenario-presets-shared: PASS');
