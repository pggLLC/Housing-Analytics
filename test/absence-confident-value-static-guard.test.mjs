'use strict';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import {
  ALLOWLIST,
  scanSource,
  scanTree,
} from '../scripts/audit/absence-confident-value-guard.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function rulesFor(source) {
  return scanSource('seed.js', source).map((entry) => entry.rule);
}

// Each rule is non-vacuous, and ordinary parsed/config defaults stay out.
assert.deepEqual(rulesFor('if (isFinite(record.value)) render(record.value);'), ['A']);
assert.deepEqual(
  rulesFor("function formatCurrency(n) { return isFinite(n) ? '$' + n : '—'; }"),
  ['A'],
  'the historical #1581 currency-formatter form is caught without banning every local variable',
);
assert.deepEqual(rulesFor('if (isFinite(Number(record.value))) render(record.value);'), ['B']);
assert.deepEqual(rulesFor('const score = scoreMap[record.category] || 50;'), ['C']);
assert.deepEqual(rulesFor([
  'const n = parseFloat(value); if (isFinite(n)) render(n);',
  'const safe = Number.isFinite(record.value);',
  'const limit = opts.limit || 5;',
  "const numberedBucket = scoreMap['5'] || 50;",
  'const measuredZero = scoreMap[record.category] || 0;',
].join('\n')), []);

// The reasoned exception list is exact and cannot silently grow.
assert.equal(ALLOWLIST.length, 9, 'exactly nine safe expressions remain allowlisted');
for (const entry of ALLOWLIST) {
  assert.match(entry.reason, /\S.{20,}/, `${entry.file} Rule ${entry.rule} has a durable reason`);
}
const report = scanTree(ROOT);
assert.equal(report.candidates.length, 9, 'the current tree contains only the nine pinned safe expressions');
assert.deepEqual(report.unexpected, [], 'the current tree has no unreviewed absence/default pattern');
assert.deepEqual(report.staleAllowlist, [], 'every allowlist entry still identifies live code');
assert.deepEqual(report.duplicateAllowlistKeys, [], 'allowlist entries are unique');

// Rule A fixes: map coordinates reject absence without rejecting a real zero.
const layerSource = read('js/components/affordable-housing-layer.js');
const coordinateHelper = layerSource.match(/function _hasFiniteCoordinate[\s\S]*?\n  }/);
assert(coordinateHelper, 'coordinate absence helper remains independently testable');
const hasFiniteCoordinate = vm.runInNewContext(`${coordinateHelper[0]}; _hasFiniteCoordinate`);
assert.equal(hasFiniteCoordinate(null), false);
assert.equal(hasFiniteCoordinate(''), false);
assert.equal(hasFiniteCoordinate('39.7'), true);
assert.equal(hasFiniteCoordinate(0), true, 'zero remains a real coordinate value');

const dealSource = read('js/deal-calculator.js');
const dealGuards = dealSource.match(/!MoneyFormatter\.isAbsent\((?:result\.tdcPerUnit|row\.noi|wf\.lpMultiple|wf\.lpCashIrr)\)/g) || [];
assert.equal(dealGuards.length, 4, 'all four rendered deal values guard absence before formatting');

async function loadClimateService(localData) {
  global.window = global;
  global.safeFetchJSON = () => Promise.resolve(localData);
  global.APP_CONFIG = {};
  delete global.DataService;
  const modulePath = require.resolve('../js/data-service-portable.js');
  delete require.cache[modulePath];
  require(modulePath);
  return global.DataService;
}

// Rule C fix: an unknown hazard level is absent, while a known level is unchanged.
const unknownClimateService = await loadClimateService({
  hazard_summary: { drought: { level: 'future-category' } },
  eji_tracts: [],
});
const unknownClimate = await unknownClimateService.fetchNOAAClimateData({ lat: 39.7, lon: -104.9 }, 'all');
assert.equal(unknownClimate.resilienceScore, null);
assert.match(unknownClimate.unavailableReason, /missing or unrecognized levels/i);

const knownClimateService = await loadClimateService({
  hazard_summary: { drought: { level: 'moderate' } },
  eji_tracts: [],
});
const knownClimate = await knownClimateService.fetchNOAAClimateData({ lat: 39.7, lon: -104.9 }, 'all');
assert.equal(knownClimate.resilienceScore, 70);
assert.equal(knownClimate.unavailableReason, null);

// Rule C fix: an unknown confidence category is excluded with its reason.
global.window = global;
delete global.WorkflowState;
delete global.SiteState;
delete global.HNAState;
delete global.HNARanking;
delete global.HousingOutcomeScore;
const outcomeModule = require.resolve('../js/housing-outcome-score.js');
delete require.cache[outcomeModule];
require(outcomeModule);
const unknownConfidence = global.HousingOutcomeScore.compute({ dealConfidence: 'future-category' });
assert.equal(unknownConfidence.dimensions.financialFeasibility.available, false);
assert.match(
  unknownConfidence.dimensions.financialFeasibility.inputs.dealConfidenceUnavailableReason,
  /excluded from the financial-feasibility score/i,
);
const knownConfidence = global.HousingOutcomeScore.compute({ dealConfidence: 'high' });
assert.equal(knownConfidence.dimensions.financialFeasibility.available, true);
assert.equal(knownConfidence.dimensions.financialFeasibility.score, 85);

// Rule C fix: the legacy tornado view renders an unavailable reason, not 50.
{
  const dom = new JSDOM('<!doctype html><div id="tornadoChartMount"></div>', { url: 'http://127.0.0.1/deal-calculator.html' });
  global.window = dom.window;
  global.document = dom.window.document;
  const tornadoModule = require.resolve('../js/components/tornado-sensitivity.js');
  delete require.cache[tornadoModule];
  require(tornadoModule);
  const input = {
    equityPricingRange: { low: '$1,000,000', high: '$1,100,000', note: 'test' },
    demandSignalRange: { low: 'future-category', high: 'strong', note: 'test' },
    saturationRange: { low: 'low (1 project)', high: 'moderate (3 projects)', note: 'test' },
  };
  dom.window.TornadoSensitivity.render(input);
  const unavailableRow = dom.window.document.querySelector('.tornado-row--unavailable');
  assert(unavailableRow, 'unknown demand range gets an explicit unavailable row');
  assert.match(unavailableRow.textContent, /no neutral score was substituted/i);
  assert(!/\b50\b/.test(unavailableRow.textContent), 'unknown demand range never renders the old neutral 50');

  input.demandSignalRange = { low: 'weak', high: 'strong', note: 'test' };
  dom.window.TornadoSensitivity.render(input);
  assert.equal(dom.window.document.querySelector('.tornado-row--unavailable'), null);
  assert.match(dom.window.document.getElementById('tornadoChartMount').textContent, /weak/);
  assert.match(dom.window.document.getElementById('tornadoChartMount').textContent, /strong/);
}

// Rule C fix: an unknown bedroom type never becomes a four-person household.
async function renderIncomeEligibility(bedrooms) {
  const dom = new JSDOM('<!doctype html><div id="mount"></div>', { url: 'http://127.0.0.1/market-analysis.html' });
  let computeCalls = 0;
  dom.window.SubjectProject = {
    get: () => ({
      county_fips: '08031',
      use_hera_special: false,
      unit_mix: [{ bedrooms, ami_tier: 60, count: 1, proposed_gross_rent: 1200 }],
    }),
    loadChfa: () => Promise.resolve({
      meta: { source_url: 'http://127.0.0.1/chfa', fiscal_year: 2026, effective_date: '2026-01-01' },
    }),
    computeIncomeLimit: () => { computeCalls += 1; return 50000; },
  };
  global.window = dom.window;
  global.document = dom.window.document;
  const eligibilityModule = require.resolve('../js/components/subject-income-eligibility.js');
  delete require.cache[eligibilityModule];
  require(eligibilityModule);
  dom.window.SubjectIncomeEligibility.render(dom.window.document.getElementById('mount'));
  await new Promise((resolve) => setImmediate(resolve));
  return { dom, computeCalls };
}

const unknownBedroom = await renderIncomeEligibility('future-bedroom');
const unknownCells = unknownBedroom.dom.window.document.querySelectorAll('tbody td');
assert.equal(unknownBedroom.computeCalls, 0);
assert.equal(unknownCells[3].textContent, '—');
assert.match(unknownCells[8].textContent, /household size unavailable/i);

const knownBedroom = await renderIncomeEligibility('2BR');
const knownCells = knownBedroom.dom.window.document.querySelectorAll('tbody td');
assert.equal(knownBedroom.computeCalls, 1);
assert.equal(knownCells[3].textContent, '3');
assert.equal(knownCells[6].textContent, '$50,000');

console.log('absence-confident-value static guard: PASS');
