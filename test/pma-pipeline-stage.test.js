'use strict';

// The competitive pipeline says where a project's stage came from, and never
// calls an operating property "Pre-Permit".
//
// Found 2026-09-26: analyzeCompetitivePipeline() (js/market-analysis-
// enhancements.js) staged every LIHTC record from its award year alone. In
// Denver, Forum Apartments — awarded 2021, CHFA ComplianceStatus "Active
// Compliance", i.e. operating — read "Pre-Permit" and its units were counted
// as pipeline supply still to be absorbed. YR_PIS cannot fix this: in
// data/chfa-lihtc.json it is a copy of AwardYear (#1904). ComplianceStatus is
// the field that says a property is operating.
//
// The absorption estimate divided by 50 units a month while its comment said
// "30% annual absorption". The divisor now has one name, and the on-screen
// label calls the result a heuristic and prints the same number.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const maSrc = fs.readFileSync(path.join(ROOT, 'js/market-analysis.js'), 'utf8');
const enhSrc = fs.readFileSync(path.join(ROOT, 'js/market-analysis-enhancements.js'), 'utf8');
const renderSrc = fs.readFileSync(path.join(ROOT, 'js/market-analysis/market-report-renderers.js'), 'utf8');
const chfa = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/chfa-lihtc.json'), 'utf8'));

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

global.window = {};
require(path.join(ROOT, 'js/market-analysis-enhancements.js'));
const ENH = global.window.PMAEnhancements;
const S = ENH.PIPELINE_STAGES;
const PIPELINE = new Set([S.prePermit, S.entitled, S.construction]);

console.log('\nPipeline stage comes from compliance status, and says when it is a guess');

test('the scan has something to check: CHFA records carrying an operating status', () => {
  const active = chfa.features.filter((f) => /^Active Compliance$/i.test(f.properties.ComplianceStatus || ''));
  assert(active.length > 100, 'only ' + active.length + ' Active Compliance records');
});

test('no operating (Active Compliance) CHFA property is ever staged as pipeline', () => {
  for (const now of [2024, 2026, 2030]) {
    const bad = chfa.features.filter((f) => /^Active Compliance$/i.test(f.properties.ComplianceStatus || '')
      && PIPELINE.has(ENH.classifyPipelineStage(f.properties, now).stage));
    assert.strictEqual(bad.length, 0, `${bad.length} operating properties staged as pipeline in ${now}, e.g. ${bad[0] && bad[0].properties.PROJECT}`);
  }
});

test('Forum Apartments (Denver, awarded 2021, Active Compliance) reads Operating in the pipeline card', () => {
  const forum = chfa.features.find((f) => f.properties.PROJECT === 'Forum Apartments' && f.properties.PROJ_CTY === 'Denver');
  assert(forum, 'Forum Apartments is gone from data/chfa-lihtc.json; pick another Active Compliance fixture');
  const [lon, lat] = forum.geometry.coordinates;
  const pipe = ENH.analyzeCompetitivePipeline(chfa.features, lat, lon, 0.05);
  const row = pipe.projects.find((p) => p.name === 'Forum Apartments');
  assert(row, 'Forum Apartments not found within its own buffer');
  assert.strictEqual(row.stage, S.complete, 'Forum Apartments reads ' + row.stage);
  assert.strictEqual(row.stageEstimated, false);
  assert(!/Pre-Permit/.test(row.stageLabel), row.stageLabel);
});

test('a record under construction reads Under Construction from its status', () => {
  const c = ENH.classifyPipelineStage({ ComplianceStatus: 'Pre-Compliance - Construction Phase', AwardYear: 2019 }, 2026);
  assert.strictEqual(c.stage, S.construction);
  assert.strictEqual(c.estimated, false);
});

test('a record with no status is staged from its award year AND labelled as an estimate', () => {
  const c = ENH.classifyPipelineStage({ YR_ALLOC: 2022 }, 2026);
  assert.strictEqual(c.stage, S.prePermit);
  assert.strictEqual(c.estimated, true);
  assert(/est\. from award year/.test(ENH.stageLabel(c)), 'label: ' + ENH.stageLabel(c));
  // The card renders the label, not the bare stage.
  assert(/\(p\.stageLabel \|\| p\.stage\)/.test(maSrc), 'the pipeline table renders the bare stage again');
});

test('the report renderer counts stages with the same classifier', () => {
  assert(/ENH\.classifyPipelineStage\(p, now\)/.test(renderSrc),
    'market-report-renderers.js stages projects by its own award-year rule again');
});

test('absorption: the divisor the code uses is the one the screen prints, and it is called a heuristic', () => {
  const units = 237;
  const feats = [{ geometry: { coordinates: [-105, 39.7] }, properties: { PROJECT: 'x', N_UNITS: units, YR_ALLOC: 2026 } }];
  const pipe = ENH.analyzeCompetitivePipeline(feats, 39.7, -105, 1);
  assert.strictEqual(pipe.totalActiveUnits, units);
  assert.strictEqual(pipe.estimatedAbsorptionMonths, Math.ceil(units / pipe.absorptionUnitsPerMonth),
    'estimatedAbsorptionMonths is not active units / absorptionUnitsPerMonth');
  assert(/heuristic/i.test(pipe.absorptionBasis) && pipe.absorptionBasis.includes(String(pipe.absorptionUnitsPerMonth)),
    'absorptionBasis does not name the heuristic and its rate: ' + pipe.absorptionBasis);
  assert(/Est\. absorption \(heuristic: ' \+ pipeline\.absorptionUnitsPerMonth/.test(maSrc),
    'the on-screen absorption label no longer prints the rate the code divides by');
  assert(!/30% annual absorption/.test(enhSrc), 'the "30% annual absorption" comment is back, contradicting the code');
});

delete global.window;
console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed ✅');
process.exit(failures ? 1 : 0);
