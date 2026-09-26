'use strict';

// A LIHTC project's pipeline stage comes from CHFA's compliance status where
// the record has one; the award-year rule is only a fallback, and says it is
// an estimate. The absorption figure is labelled as the heuristic it is.
//
// Found 2026-09-26: analyzeCompetitivePipeline() staged every project from
// its award year alone, although data/chfa-lihtc.json carries CHFA's
// ComplianceStatus. Forum Apartments (Denver; awarded 2021, "Active
// Compliance") read "Pre-Permit" and was counted as competing pipeline. The
// report renderer ran its own copy of the rule with a different boundary
// (<= now - 5 against < now - 5), so the card and the report disagreed on a
// five-year-old award. The absorption card divided by a flat 50 units a
// month without saying so, and the "What's counted in supply?" disclosure
// said the feed could not tell operating projects from pipeline.
//
// Runs the production code: js/market-analysis-enhancements.js, the page's
// pipeline card (js/market-analysis.js) and the report renderer, loaded
// together in jsdom, against the committed CHFA file.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

const dom = new JSDOM(
  '<!doctype html><body><div id="pmaPipelineResult"></div><div id="maAffordableSupplyContent"></div></body>',
  { url: 'http://localhost/market-analysis.html', runScripts: 'outside-only' });
const w = dom.window;
const quiet = { log: console.log, warn: console.warn, error: console.error, info: console.info };
console.warn = console.error = console.info = () => {};
w.console.log = w.console.warn = w.console.error = w.console.info = () => {};
[
  'js/utils/format-money.js',
  'js/market-analysis/market-analysis-utils.js',
  'js/market-analysis/market-report-renderers.js',
  'js/market-analysis-scoring.js',
  'js/market-analysis.js',
  'js/market-analysis-enhancements.js',
].forEach((rel) => w.eval(read(rel)));

const CHFA = JSON.parse(read('data/chfa-lihtc.json')).features;
const byName = (name) => CHFA.find((f) => f.properties.PROJECT === name);
const statusOf = (f) => (f.properties.ComplianceStatus || '').trim();

function run() {
  Object.assign(console, quiet);
  const ENH = w.PMAEnhancements;
  const E = w.PMAEngine;
  const R = w.MARenderers;
  assert(ENH && typeof ENH.classifyPipelineStage === 'function', 'PMAEnhancements.classifyPipelineStage did not load');
  const S = ENH.PIPELINE_STAGES;
  const NOW = new Date().getFullYear();

  // A west-Denver site beside Joli 9 (no status, so an estimated stage),
  // with Forum Apartments (Active Compliance) and construction-phase
  // projects inside 3 miles.
  const SITE = { lat: 39.7335, lon: -105.0180, bufferMiles: 3 };

  console.log('\nLIHTC pipeline stage follows CHFA compliance status; estimates say so');

  test('the committed CHFA file carries compliance statuses to classify by (non-vacuous)', () => {
    const statuses = new Set(CHFA.map(statusOf).filter(Boolean));
    assert(statuses.size >= 2, 'fewer than two distinct ComplianceStatus values: ' + [...statuses].join(', '));
    assert(CHFA.some((f) => !statusOf(f)), 'no record without a status left to exercise the fallback');
  });

  test('every Active Compliance record is operating supply, never pipeline, whatever its award year', () => {
    const active = CHFA.filter((f) => /^active compliance$/i.test(statusOf(f)));
    assert(active.length > 100, 'only ' + active.length + ' Active Compliance records');
    for (const f of active) {
      const c = ENH.classifyPipelineStage(f.properties, NOW);
      assert.strictEqual(c.stage, S.complete, f.properties.PROJECT + ' staged ' + c.stage);
      assert.strictEqual(c.estimated, false, f.properties.PROJECT + ' marked as an estimate');
    }
  });

  test('Forum Apartments (awarded 2021, Active Compliance) is not Pre-Permit', () => {
    const f = byName('Forum Apartments');
    assert(f && f.properties.YR_ALLOC >= NOW - 5 && /active compliance/i.test(statusOf(f)),
      'Forum Apartments no longer fits this case; pick another recent Active Compliance record');
    const c = ENH.classifyPipelineStage(f.properties, NOW);
    assert.strictEqual(c.stage, S.complete);
    assert.strictEqual(ENH.stageLabel(c), c.stage, 'an observed stage is labelled as an estimate');
  });

  test('a construction-phase record is under construction, from CHFA, not estimated', () => {
    const building = CHFA.filter((f) => /construction/i.test(statusOf(f)));
    assert(building.length > 0, 'no construction-phase record in the file');
    for (const f of building) {
      const c = ENH.classifyPipelineStage(f.properties, NOW);
      assert.strictEqual(c.stage, S.construction, f.properties.PROJECT);
      assert.strictEqual(c.estimated, false);
      assert.strictEqual(c.basis, ENH.STAGE_BASIS.compliance);
    }
  });

  test('a record with no status falls back to the award year and is labelled an estimate', () => {
    const cases = [
      [{ YEAR_ALLOC: NOW }, S.construction],          // HUD fallback file field
      [{ YR_ALLOC: NOW - 2 }, S.entitled],
      [{ AwardYear: NOW - 4 }, S.prePermit],
      [{ YR_ALLOC: NOW - 6 }, S.complete],
      [{ YR_ALLOC: NOW, ComplianceStatus: 'Something CHFA adds later' }, S.construction],
    ];
    for (const [p, want] of cases) {
      const c = ENH.classifyPipelineStage(p, NOW);
      assert.strictEqual(c.stage, want, JSON.stringify(p));
      assert.strictEqual(c.estimated, true, JSON.stringify(p) + ' not marked as an estimate');
      assert.notStrictEqual(ENH.stageLabel(c), c.stage, JSON.stringify(p) + ' label does not show it is estimated');
    }
    const joli = byName('Joli 9');
    assert(joli && !statusOf(joli), 'Joli 9 has a status now; pick another record without one');
    assert.strictEqual(ENH.classifyPipelineStage(joli.properties, NOW).estimated, true);
  });

  test('the pipeline counts only projects that are not operating, and absorption divides by the stated pace', () => {
    const pipe = ENH.analyzeCompetitivePipeline(CHFA, SITE.lat, SITE.lon, SITE.bufferMiles);
    const nearby = CHFA.filter((f) => {
      const [lon, lat] = f.geometry.coordinates;
      return E.haversine(SITE.lat, SITE.lon, lat, lon) <= SITE.bufferMiles;
    });
    const notOperating = nearby.filter((f) => ENH.classifyPipelineStage(f.properties, NOW).stage !== S.complete);
    assert(nearby.some((f) => /active compliance/i.test(statusOf(f))), 'no operating project in the buffer to leave out');
    assert(notOperating.length > 0, 'nothing in the buffer is pipeline; the scan checks nothing');
    assert.strictEqual(pipe.active, notOperating.length);
    assert(!notOperating.some((f) => /active compliance/i.test(statusOf(f))), 'an operating project was counted as pipeline');
    assert.strictEqual(pipe.activeStagesEstimated,
      notOperating.filter((f) => ENH.classifyPipelineStage(f.properties, NOW).estimated).length);
    assert.strictEqual(pipe.estimatedAbsorptionMonths, Math.ceil(pipe.totalActiveUnits / ENH.ABSORPTION_UNITS_PER_MONTH));
  });

  // Every count in a string (a stated pace included). Read for the numbers,
  // not the wording.
  const numbersIn = (s) => (s.match(/\d[\d,]*/g) || []).map((n) => Number(n.replace(/,/g, '')));

  test('the page card shows each project\'s stage and basis, and states the absorption pace it divides by', () => {
    E._renderPipelineForTest({ lat: SITE.lat, lon: SITE.lon, bufferMiles: SITE.bufferMiles }, CHFA);
    const card = w.document.getElementById('pmaPipelineResult');
    const pipe = ENH.analyzeCompetitivePipeline(CHFA, SITE.lat, SITE.lon, SITE.bufferMiles);
    const cells = Array.from(card.querySelectorAll('td[data-stage-basis]'));
    assert(cells.length > 0, 'the card lists no project stages');
    // Non-vacuity: the rows shown must include both kinds of stage, or a
    // label that dropped its estimate marker would still match.
    const shown = pipe.projects.slice(0, cells.length);
    assert(shown.some((p) => p.stageEstimated) && shown.some((p) => !p.stageEstimated),
      'the card rows do not include both an estimated and an observed stage');
    pipe.projects.slice(0, cells.length).forEach((p, i) => {
      assert.strictEqual(cells[i].textContent, p.stageLabel, p.name + ' shows ' + cells[i].textContent);
      assert.strictEqual(cells[i].getAttribute('data-stage-basis'), p.stageBasis);
    });
    const absorption = Array.from(card.querySelectorAll('.pma-stat')).find((s) =>
      numbersIn(s.querySelector('.pma-stat-value').textContent)[0] === pipe.estimatedAbsorptionMonths &&
      numbersIn(s.querySelector('.pma-stat-label').textContent).includes(ENH.ABSORPTION_UNITS_PER_MONTH));
    assert(absorption, 'no absorption figure on the card states the ' + ENH.ABSORPTION_UNITS_PER_MONTH + '/month pace it uses');
    const basis = card.querySelector('.pma-pipeline-basis');
    assert(basis && numbersIn(basis.textContent).includes(ENH.ABSORPTION_UNITS_PER_MONTH), 'the basis note does not state the pace');
  });

  test('the page card and the report agree on how many projects are not operating, and how many of those are estimated', () => {
    const pipe = ENH.analyzeCompetitivePipeline(CHFA, SITE.lat, SITE.lon, SITE.bufferMiles);
    const nearby = CHFA.filter((f) => {
      const [lon, lat] = f.geometry.coordinates;
      return E.haversine(SITE.lat, SITE.lon, lat, lon) <= SITE.bufferMiles;
    });
    R.renderAffordableSupply(nearby, []);
    const box = w.document.getElementById('maAffordableSupplyContent');
    const rows = {};
    box.querySelectorAll('*').forEach((node) => {
      const kids = Array.from(node.children);
      if (kids.length === 2 && !kids[0].children.length && !kids[1].children.length) {
        rows[kids[0].textContent.trim()] = kids[1].textContent.trim();
      }
    });
    const stageRows = [S.construction, S.entitled, S.prePermit].filter((s) => rows[s] !== undefined);
    assert(stageRows.length > 0, 'the report shows no pipeline stage rows');
    const total = stageRows.reduce((a, s) => a + numbersIn(rows[s])[0], 0);
    const estimated = stageRows.reduce((a, s) => a + (numbersIn(rows[s])[1] || 0), 0);
    assert.strictEqual(total, pipe.active, 'report pipeline ' + total + ' vs card ' + pipe.active);
    assert.strictEqual(estimated, pipe.activeStagesEstimated, 'report estimated ' + estimated + ' vs card ' + pipe.activeStagesEstimated);
  });

  test('the supply disclosure names every CHFA compliance status the classifier reads, and does not deny the distinction', () => {
    const html = read('market-analysis.html');
    const start = html.indexOf("What's counted in 'supply'?");
    assert(start > 0, 'the supply disclosure is gone');
    const body = html.slice(start, html.indexOf('</details>', start));
    const statuses = [...new Set(CHFA.map(statusOf).filter(Boolean))];
    for (const s of statuses) {
      assert(body.includes(s), 'the disclosure does not name the status "' + s + '" that stages a project');
    }
  });

  console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed ✅');
  process.exit(failures ? 1 : 0);
}

if (w.document.readyState === 'complete') run();
else w.addEventListener('load', run);
