// test/hna-dp04-codes.test.js
//
// Regression-protects the ACS 2023 DP04 code drift fixed in this PR.
//
// Pre-fix bug:
//   - js/hna/hna-controller.js fetchAcsProfile() requested DP04_0003E-0010E
//     and labeled them as "structure types"; in canonical ACS 2023, those
//     codes are HOUSING OCCUPANCY (vacancy/owner-vacancy) and partial
//     UNITS-IN-STRUCTURE — NOT a clean structure-type series. Real
//     structure types live in DP04_0007E-0014E.
//   - js/hna/hna-controller.js fetchAcs5BSeries() mapped B25024_002E
//     (1-unit detached) to DP04_0003E (Vacant in real 2023 codes).
//   - js/hna/hna-renderers.js renderHousingCharts() chartStock displayed
//     "Occupied vs Vacant" under an HTML title that said
//     "Housing stock by structure type" — the chart didn't match its label.
//   - js/hna/hna-renderers.js chartTenure read DP04_0046E/0047E (counts)
//     but the controller fetched only DP04_0046PE/0047PE (percents), so
//     the doughnut rendered empty.
//   - js/hna/hna-utils.js calculateBaseline read DP04_0003E expecting
//     "Occupied housing units"; in ACS 2023 that field is "Vacant".
//
// This test asserts:
//   1. The renderer's chartStock uses canonical 2023 structure-type codes.
//   2. The renderer's chartTenure has a percent→count fallback.
//   3. The controller fetches both count + percent codes for tenure.
//   4. The B-series fallback emits canonical 2023 codes (0007E-0014E for
//      structure, 0046E/0047E for tenure counts).
//   5. hna-utils' "occupied" derivation uses DP04_0002E (the real code)
//      with degradation chain.
//
// Run: node test/hna-dp04-codes.test.js

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

console.log('\n[test] Renderer chartStock uses canonical structure-type codes');
const renderersSrc = readRel('js/hna/hna-renderers.js');
// chartStock should reference DP04_0007E (1-unit detached) through DP04_0014E (mobile home)
assert(/key:\s*['"]DP04_0007E['"]/.test(renderersSrc),
  'renderHousingCharts references DP04_0007E (1-unit detached)');
assert(/key:\s*['"]DP04_0014E['"]/.test(renderersSrc),
  'renderHousingCharts references DP04_0014E (Mobile home)');
// And NOT DP04_0002E (occupied) or DP04_0003E (vacant) inside chartStock —
// those are distinct (HOUSING OCCUPANCY) fields, not structure types.
const chartStockSection = renderersSrc.match(/chartStock([\s\S]*?)chartTenure/);
assert(chartStockSection !== null,
  'can locate chartStock block in renderHousingCharts');
if (chartStockSection) {
  // chartStock body should NOT have the old occupied/vacant fields
  assert(!/DP04_0002E\s*\)/.test(chartStockSection[1]),
    'chartStock no longer references DP04_0002E (Occupied)');
  assert(!/DP04_0003E\s*\)/.test(chartStockSection[1]),
    'chartStock no longer references DP04_0003E (Vacant)');
}

console.log('\n[test] Renderer chartTenure has percent→count fallback');
const chartTenureSection = renderersSrc.match(/chartTenure([\s\S]*?)\/\/[^\n]*chartTenure[^\n]*\n[\s\S]*?\}\n  \}/);
const tenureBody = renderersSrc.match(/tenureCtx[\s\S]*?\}\n    \}\n  \}/);
const tenureScan = tenureBody ? tenureBody[0] : renderersSrc;
assert(/DP04_0046E/.test(tenureScan) && /DP04_0047E/.test(tenureScan),
  'chartTenure reads DP04_0046E + DP04_0047E (count fields)');
assert(/DP04_0046PE/.test(tenureScan) && /DP04_0047PE/.test(tenureScan),
  'chartTenure has fallback to DP04_0046PE + DP04_0047PE (percent fields)');
assert(/occupied\s*\*\s*\w+Pct/.test(tenureScan),
  'chartTenure derives counts from occupied × percent when counts missing');

console.log('\n[test] Controller fetches canonical 2023 codes');
const controllerSrc = readRel('js/hna/hna-controller.js');
// fetchAcsProfile vars list
assert(/'DP04_0007E'/.test(controllerSrc),
  'controller fetches DP04_0007E (1-unit detached)');
assert(/'DP04_0014E'/.test(controllerSrc),
  'controller fetches DP04_0014E (Mobile home)');
assert(/'DP04_0046E'/.test(controllerSrc),
  'controller fetches DP04_0046E (Owner count)');
assert(/'DP04_0047E'/.test(controllerSrc),
  'controller fetches DP04_0047E (Renter count)');
assert(/'DP04_0002E'/.test(controllerSrc),
  'controller fetches DP04_0002E (Occupied count)');

console.log('\n[test] B-series fallback emits canonical codes');
// Look at the return object inside fetchAcs5BSeries
const bsReturn = controllerSrc.match(/return\s*\{\s*DP05_0001E:\s*raw\.B01003_001E[\s\S]*?_acsSeries:\s*['"]acs5['"][\s\S]*?\}/);
assert(bsReturn !== null,
  'can locate B-series return object');
if (bsReturn) {
  const body = bsReturn[0];
  assert(/DP04_0007E:\s*raw\.B25024_002E/.test(body),
    'B-series maps B25024_002E → DP04_0007E (1-unit detached)');
  assert(/DP04_0008E:\s*raw\.B25024_003E/.test(body),
    'B-series maps B25024_003E → DP04_0008E (1-unit attached)');
  assert(/DP04_0014E:\s*raw\.B25024_010E/.test(body),
    'B-series maps B25024_010E → DP04_0014E (Mobile home)');
  assert(/DP04_0046E:\s*owner/.test(body),
    'B-series emits DP04_0046E (Owner count) from B25003_002E');
  assert(/DP04_0047E:\s*renter/.test(body),
    'B-series emits DP04_0047E (Renter count) from B25003_003E');
  assert(/DP04_0002E:\s*occ/.test(body),
    'B-series emits DP04_0002E (Occupied) from B25003_001E');
  // Pre-fix mapping should be GONE
  assert(!/DP04_0003E:\s*raw\.B25024/.test(body),
    'B-series no longer maps B25024_* (structure) to DP04_0003E (Vacant slot)');
}

console.log('\n[test] hna-utils uses canonical Occupied code (DP04_0002E)');
const utilsSrc = readRel('js/hna/hna-utils.js');
const calcBaseline = utilsSrc.match(/function calculateBaseline[\s\S]*?const totalRentals/);
assert(calcBaseline !== null,
  'can locate calculateBaseline body');
if (calcBaseline) {
  const body = calcBaseline[0];
  assert(/DP04_0002E/.test(body),
    'calculateBaseline references DP04_0002E (the actual Occupied code)');
}

console.log('\n[test] Sanity: ACS 2023 reference comments present in fix-touched files');
assert(/ACS 2023.*DP04_0007E.*1-unit detached/i.test(renderersSrc) ||
       /DP04_0007E.*=.*1-unit detached/i.test(renderersSrc),
  'renderer documents DP04_0007E = 1-unit detached');
assert(/canonical/i.test(controllerSrc),
  'controller documents canonical code mapping');

console.log('\n=========================================');
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);
