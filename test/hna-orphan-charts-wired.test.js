// test/hna-orphan-charts-wired.test.js
//
// Regression test for PR that wired 7 latent orphan chart canvases on
// the Housing Needs Assessment page.
//
// Pre-fix: these canvases existed in housing-needs-assessment.html but
// no JS function ever rendered them — they sat blank across deployments:
//   - chartProjectionDetail   (single-scenario population trajectory)
//   - chartProjectedHH        (DOLA HH formation forecast)
//   - chartHouseholdDemand    (HH demand by AMI tier)
//   - chartHousingTypeComposition (5-bucket structure-type doughnut)
//   - chartConstructionEra    (construction era bar chart)
//   - chartProp123Growth      (3% annual growth trajectory)
//   - chartProp123Historical  (Prop 123 compliance tracker)
//
// This test asserts each is referenced inside its expected renderer:
//   - _renderScenarioSection wires the 4 projection charts (incl.
//     the existing chartScenarioComparison)
//   - renderHousingTypeFeasibility wires Composition + ConstructionEra
//   - renderProp123Section wires Prop123Growth + Prop123Historical
//
// Run: node test/hna-orphan-charts-wired.test.js

'use strict';

const fs   = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log('  ✅ PASS: ' + msg); passed++; }
  else { console.error('  ❌ FAIL: ' + msg); failed++; }
}

function readRel(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

const renderersSrc = readRel('js/hna/hna-renderers.js');

// Helper: extract a function body block by its declaration
function extractFunction(src, name) {
  const declRe = new RegExp(`function\\s+${name}\\s*\\([^)]*\\)\\s*\\{`);
  const m = declRe.exec(src);
  if (!m) return null;
  let depth = 1;
  let i = m.index + m[0].length;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return src.slice(m.index, i);
}

console.log('\n[test] _renderScenarioSection wires all 4 projection charts');
const scenarioBody = extractFunction(renderersSrc, '_renderScenarioSection');
assert(scenarioBody !== null,
  '_renderScenarioSection function exists in source');
if (scenarioBody) {
  ['chartScenarioComparison', 'chartProjectionDetail', 'chartProjectedHH', 'chartHouseholdDemand'].forEach(id => {
    assert(scenarioBody.includes(`'${id}'`) || scenarioBody.includes(`"${id}"`),
      `_renderScenarioSection references #${id}`);
  });
  // Each canvas should have an associated makeChart call inside the function
  const makeChartCount = (scenarioBody.match(/makeChart\(/g) || []).length;
  assert(makeChartCount >= 4,
    `_renderScenarioSection has ≥4 makeChart() calls (found ${makeChartCount})`);
}

console.log('\n[test] renderHousingTypeFeasibility no longer a stub');
const htfBody = extractFunction(renderersSrc, 'renderHousingTypeFeasibility');
assert(htfBody !== null,
  'renderHousingTypeFeasibility exists');
if (htfBody) {
  assert(htfBody.length > 200,
    'renderHousingTypeFeasibility body has substance (>200 chars; was previously a 1-line stub)');
  assert(htfBody.includes('chartHousingTypeComposition'),
    'renderHousingTypeFeasibility references #chartHousingTypeComposition');
  assert(htfBody.includes('chartConstructionEra'),
    'renderHousingTypeFeasibility references #chartConstructionEra');
  // Canonical 2023 DP04 codes should be used (per PR #796 alignment)
  assert(htfBody.includes('DP04_0007E') && htfBody.includes('DP04_0014E'),
    'renderHousingTypeFeasibility uses canonical DP04_0007E-0014E (structure types)');
  assert(htfBody.includes('DP04_0017E') && htfBody.includes('DP04_0026E'),
    'renderHousingTypeFeasibility uses canonical DP04_0017E-0026E (year built)');
}

console.log('\n[test] renderProp123Section no longer a stub');
const propBody = extractFunction(renderersSrc, 'renderProp123Section');
assert(propBody !== null,
  'renderProp123Section exists');
if (propBody) {
  assert(propBody.length > 200,
    'renderProp123Section body has substance (was previously a 3-line stub)');
  assert(propBody.includes('chartProp123Growth'),
    'renderProp123Section references #chartProp123Growth');
  assert(propBody.includes('chartProp123Historical'),
    'renderProp123Section references #chartProp123Historical');
  assert(/Math\.pow\(\s*1\.03/.test(propBody),
    'renderProp123Section uses 3% annual growth (Math.pow(1.03, i))');
}

console.log('\n[test] All orphan IDs resolve in chart-id coherence check');
// This complements test/chart-id-coherence.test.js (which tests JS→HTML).
// Here we test the inverse: the HTML canvases now have JS that references them.
const htmlSrc = readRel('housing-needs-assessment.html');
const orphanIds = [
  'chartProjectionDetail',
  'chartProjectedHH',
  'chartHouseholdDemand',
  'chartHousingTypeComposition',
  'chartConstructionEra',
  'chartProp123Growth',
  'chartProp123Historical',
];
orphanIds.forEach(id => {
  assert(htmlSrc.includes(`id="${id}"`),
    `HTML still has canvas #${id}`);
  assert(renderersSrc.includes(`'${id}'`) || renderersSrc.includes(`"${id}"`),
    `JS now references #${id}`);
});

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
