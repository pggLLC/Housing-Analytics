// test/integration/projections.test.js
//
// Integration tests for the demographic projections feature.
//
// Verifies:
//   1. Python backend files exist and are non-trivially sized.
//   2. projection_scenarios.json is valid JSON with required keys.
//   3. housing-needs-assessment.js defines the three new visualization functions.
//   4. Scenario selector UI elements are present in housing-needs-assessment.html.
//   5. Projection assumption slider elements are present in the HTML.
//   6. Baseline projection snapshot file exists.
//
// Usage:
//   node test/integration/projections.test.js
//
// Exit code 0 = all checks passed; non-zero = one or more failures.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

function test(name, fn) {
  console.log(`\n[test] ${name}`);
  try {
    fn();
  } catch (err) {
    console.error(`  ❌ FAIL: threw unexpected error — ${err.message}`);
    failed++;
  }
}

// ── File paths ────────────────────────────────────────────────────────────────

const HNA_JS   = path.join(ROOT, 'js',   'housing-needs-assessment.js');
const HNA_HTML = path.join(ROOT, 'housing-needs-assessment.html');

const DEMO_PY  = path.join(ROOT, 'scripts', 'hna', 'demographic_projections.py');
const HH_PY    = path.join(ROOT, 'scripts', 'hna', 'household_projections.py');
const HDP_PY   = path.join(ROOT, 'scripts', 'hna', 'housing_demand_projections.py');
const SCENARIOS_JSON = path.join(ROOT, 'scripts', 'hna', 'projection_scenarios.json');

const SNAPSHOT_DIR = path.join(ROOT, 'test', 'projection-snapshots');
const BASELINE_SNAP = path.join(SNAPSHOT_DIR, 'baseline.json');

const hnaSrc  = fs.readFileSync(HNA_JS,   'utf8');
const hnaHtml = fs.readFileSync(HNA_HTML, 'utf8');

// ── Tests ───────────────────────────────────────────────────────────────────

test('Python backend: demographic_projections.py exists', () => {
  assert(fs.existsSync(DEMO_PY), 'scripts/hna/demographic_projections.py exists');
  assert(fs.statSync(DEMO_PY).size > 1000, 'demographic_projections.py is non-trivially sized');
});

test('Python backend: household_projections.py exists', () => {
  assert(fs.existsSync(HH_PY), 'scripts/hna/household_projections.py exists');
  assert(fs.statSync(HH_PY).size > 500, 'household_projections.py is non-trivially sized');
});

test('Python backend: housing_demand_projections.py exists', () => {
  assert(fs.existsSync(HDP_PY), 'scripts/hna/housing_demand_projections.py exists');
  assert(fs.statSync(HDP_PY).size > 500, 'housing_demand_projections.py is non-trivially sized');
});

test('Python backend: demographic_projections.py defines CohortComponentModel', () => {
  const src = fs.readFileSync(DEMO_PY, 'utf8');
  assert(src.includes('class CohortComponentModel'), 'CohortComponentModel class defined');
  assert(src.includes('def project'),                'project() method defined');
  assert(src.includes('def _step'),                  '_step() aging method defined');
});

test('Python backend: household_projections.py defines HeadshipRateModel', () => {
  const src = fs.readFileSync(HH_PY, 'utf8');
  assert(src.includes('class HeadshipRateModel'), 'HeadshipRateModel class defined');
  assert(src.includes('project_from_snapshots'),   'project_from_snapshots method defined');
});

test('Python backend: housing_demand_projections.py defines HousingDemandProjector', () => {
  const src = fs.readFileSync(HDP_PY, 'utf8');
  assert(src.includes('class HousingDemandProjector'), 'HousingDemandProjector class defined');
  assert(src.includes('def project'),                   'project() method defined');
  assert(src.includes('def summarize'),                 'summarize() method defined');
});

test('projection_scenarios.json: valid JSON with required scenarios', () => {
  assert(fs.existsSync(SCENARIOS_JSON), 'scripts/hna/projection_scenarios.json exists');
  const raw = fs.readFileSync(SCENARIOS_JSON, 'utf8');
  let scenarios;
  try {
    scenarios = JSON.parse(raw);
  } catch (e) {
    assert(false, `projection_scenarios.json is valid JSON (parse error: ${e.message})`);
    return;
  }
  assert(true, 'projection_scenarios.json is valid JSON');

  assert('baseline'    in scenarios, 'baseline scenario defined');
  assert('low_growth'  in scenarios, 'low_growth scenario defined');
  assert('high_growth' in scenarios, 'high_growth scenario defined');
});

test('projection_scenarios.json: each scenario has description and parameters', () => {
  const scenarios = JSON.parse(fs.readFileSync(SCENARIOS_JSON, 'utf8'));
  ['baseline', 'low_growth', 'high_growth'].forEach(key => {
    const sc = scenarios[key];
    assert(typeof sc.description === 'string' && sc.description.length > 0,
      `${key} has non-empty description`);
    assert(typeof sc.parameters === 'object', `${key} has parameters object`);
    assert('fertility_multiplier' in sc.parameters,
      `${key} has fertility_multiplier parameter`);
    assert('mortality_multiplier' in sc.parameters,
      `${key} has mortality_multiplier parameter`);
    assert('net_migration_annual' in sc.parameters,
      `${key} has net_migration_annual parameter`);
  });
});

test('projection_scenarios.json: high_growth has more migration than baseline', () => {
  const scenarios = JSON.parse(fs.readFileSync(SCENARIOS_JSON, 'utf8'));
  const baseMig = scenarios.baseline.parameters.net_migration_annual;
  const highMig = scenarios.high_growth.parameters.net_migration_annual;
  assert(highMig > baseMig, 'high_growth net_migration_annual > baseline');
});

test('projection_scenarios.json: low_growth has less migration than baseline', () => {
  const scenarios = JSON.parse(fs.readFileSync(SCENARIOS_JSON, 'utf8'));
  const baseMig = scenarios.baseline.parameters.net_migration_annual;
  const lowMig  = scenarios.low_growth.parameters.net_migration_annual;
  assert(lowMig < baseMig, 'low_growth net_migration_annual < baseline');
});

test('HNA JS: renderProjectionChart function defined', () => {
  assert(hnaSrc.includes('function renderProjectionChart'),
    'renderProjectionChart is defined in housing-needs-assessment.js');
});

test('HNA JS: renderScenarioComparison function defined', () => {
  assert(hnaSrc.includes('function renderScenarioComparison'),
    'renderScenarioComparison is defined in housing-needs-assessment.js');
});

test('HNA JS: renderHouseholdDemand function defined', () => {
  assert(hnaSrc.includes('function renderHouseholdDemand'),
    'renderHouseholdDemand is defined in housing-needs-assessment.js');
});

test('HNA JS: PROJECTION_SCENARIOS constant defined', () => {
  assert(hnaSrc.includes('PROJECTION_SCENARIOS'),
    'PROJECTION_SCENARIOS constant defined');
  assert(hnaSrc.includes("'baseline'") || hnaSrc.includes('"baseline"'),
    'baseline scenario key referenced');
  assert(hnaSrc.includes("'low_growth'") || hnaSrc.includes('"low_growth"'),
    'low_growth scenario key referenced');
  assert(hnaSrc.includes("'high_growth'") || hnaSrc.includes('"high_growth"'),
    'high_growth scenario key referenced');
});

test('HNA JS: scenario selector control wiring defined', () => {
  assert(hnaSrc.includes('wireScenarioControls'), 'wireScenarioControls function defined');
  assert(hnaSrc.includes('updateScenarioDescription'), 'updateScenarioDescription function defined');
  assert(hnaSrc.includes('getSelectedScenario'), 'getSelectedScenario function defined');
});

test('HNA JS: window exports for projection functions', () => {
  assert(hnaSrc.includes('window.__HNA_renderProjectionChart'),
    'window.__HNA_renderProjectionChart exported');
  assert(hnaSrc.includes('window.__HNA_renderScenarioComparison'),
    'window.__HNA_renderScenarioComparison exported');
  assert(hnaSrc.includes('window.__HNA_renderHouseholdDemand'),
    'window.__HNA_renderHouseholdDemand exported');
  assert(hnaSrc.includes('window.__HNA_PROJECTION_SCENARIOS'),
    'window.__HNA_PROJECTION_SCENARIOS exported');
});

test('HNA HTML: scenario projections section present', () => {
  assert(hnaHtml.includes('id="scenario-projections-section"'),
    'scenario-projections-section present in HTML');
});

test('HNA HTML: scenario selector dropdown present', () => {
  assert(hnaHtml.includes('id="projScenario"'),
    'projScenario dropdown present');
  assert(hnaHtml.includes('value="baseline"'),
    'baseline option present');
  assert(hnaHtml.includes('value="low_growth"'),
    'low_growth option present');
  assert(hnaHtml.includes('value="high_growth"'),
    'high_growth option present');
});

test('HNA HTML: scenario description element present', () => {
  assert(hnaHtml.includes('id="scenarioDescription"'),
    'scenarioDescription element present');
});

test('HNA HTML: view toggle (population/household/demand) present', () => {
  assert(hnaHtml.includes('projViewToggle'),
    'projViewToggle radio group present');
  assert(hnaHtml.includes('id="projViewPop"'),
    'projViewPop container present');
  assert(hnaHtml.includes('id="projViewHH"'),
    'projViewHH container present');
  assert(hnaHtml.includes('id="projViewDemand"'),
    'projViewDemand container present');
});

test('HNA HTML: scenario comparison chart canvas present', () => {
  assert(hnaHtml.includes('id="chartScenarioComparison"'),
    'chartScenarioComparison canvas present');
});

test('HNA HTML: projection detail chart canvas present', () => {
  assert(hnaHtml.includes('id="chartProjectionDetail"'),
    'chartProjectionDetail canvas present');
});

test('HNA HTML: household demand chart canvas present', () => {
  assert(hnaHtml.includes('id="chartHouseholdDemand"'),
    'chartHouseholdDemand canvas present');
});

test('HNA HTML: demographic rate sliders present', () => {
  assert(hnaHtml.includes('id="scenFertility"'),  'fertility rate slider present');
  assert(hnaHtml.includes('id="scenMigration"'),  'migration rate slider present');
  assert(hnaHtml.includes('id="scenMortality"'),  'mortality rate slider present');
});

test('HNA HTML: slider value display elements present', () => {
  assert(hnaHtml.includes('id="scenFertilityVal"'), 'fertility value display present');
  assert(hnaHtml.includes('id="scenMigrationVal"'), 'migration value display present');
  assert(hnaHtml.includes('id="scenMortalityVal"'), 'mortality value display present');
});

test('HNA HTML: save custom scenario button present', () => {
  assert(hnaHtml.includes('id="btnSaveCustomScenario"'),
    'btnSaveCustomScenario button present');
});

test('Projection snapshots: directory and baseline snapshot exist', () => {
  assert(fs.existsSync(SNAPSHOT_DIR), 'test/projection-snapshots/ directory exists');
  assert(fs.existsSync(BASELINE_SNAP), 'test/projection-snapshots/baseline.json exists');
});

test('Projection snapshots: baseline.json is valid JSON with expected structure', () => {
  if (!fs.existsSync(BASELINE_SNAP)) {
    assert(false, 'baseline.json does not exist (cannot validate structure)');
    return;
  }
  let snap;
  try {
    snap = JSON.parse(fs.readFileSync(BASELINE_SNAP, 'utf8'));
  } catch (e) {
    assert(false, `baseline.json is valid JSON (parse error: ${e.message})`);
    return;
  }
  assert(true, 'baseline.json is valid JSON');
  assert(Array.isArray(snap.population_series), 'baseline snapshot has population_series array');
  assert(snap.scenario === 'baseline', 'baseline snapshot scenario is "baseline"');
  assert(typeof snap.base_population === 'number', 'baseline snapshot has base_population number');
  assert(snap.population_series.length > 0, 'population_series is non-empty');
  // Verify each entry has required fields
  const first = snap.population_series[0];
  assert(typeof first.year_offset === 'number', 'first entry has year_offset');
  assert(typeof first.total_population === 'number', 'first entry has total_population');
});

// ── Summary ─────────────────────────────────────────────────────────────────
console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.error('\nSome checks failed. Review the output above for details.');
  process.exitCode = 1;
} else {
  console.log('\nAll checks passed ✅');
}
