'use strict';

// A LIHTC project's pipeline stage comes from CHFA only where its status
// names the phase; everywhere else it is the award-year estimate, and says
// so. The absorption figure is labelled as the heuristic it is.
//
// Found 2026-09-26: analyzeCompetitivePipeline() ignored CHFA's
// "Pre-Compliance - Construction Phase" status and presented every
// award-year stage as fact. The report renderer ran its own copy of the rule
// with a different boundary (<= now - 5 against < now - 5), so the card and
// the report disagreed on a five-year-old award. The absorption card divided
// by a flat 50 units a month without saying so, and the "What's counted in
// supply?" disclosure did not say which CHFA status separates what.
//
// "Active Compliance" is deliberately NOT read as "operating": in the
// 2026-09 feed 26 of the 32 2025 awards already carry it
// (scripts/fetch-chfa-lihtc.js), so it cannot show a property has opened.
// Reading it that way would drop likely-forthcoming competition from the
// pipeline (Codex review on #1927).
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

  // A downtown Denver site beside University Building Lofts (under
  // construction, reported by CHFA), with Active Compliance projects and
  // Joli 9 (no status) inside 3 miles.
  const SITE = { lat: 39.7466, lon: -104.9945, bufferMiles: 3 };

  console.log('\nLIHTC pipeline stage comes from CHFA only where the status names the phase; estimates say so');

  test('the committed CHFA file carries compliance statuses to classify by (non-vacuous)', () => {
    const statuses = new Set(CHFA.map(statusOf).filter(Boolean));
    assert(statuses.size >= 2, 'fewer than two distinct ComplianceStatus values: ' + [...statuses].join(', '));
    assert(CHFA.some((f) => !statusOf(f)), 'no record without a status left to exercise the fallback');
  });

  test('Active Compliance is not read as operating: a recent award stays in the pipeline, as an estimate', () => {
    const active = CHFA.filter((f) => /^active compliance$/i.test(statusOf(f)));
    const recent = active.filter((f) => (f.properties.YR_ALLOC || f.properties.AwardYear) >= NOW - 1);
    // Non-vacuity: the feed must still hold recent awards already marked
    // Active Compliance, or this proves nothing.
    assert(recent.length > 0, 'no recent award marked Active Compliance to test against');
    for (const f of active) {
      const c = ENH.classifyPipelineStage(f.properties, NOW);
      const byYear = ENH.classifyPipelineStage({ YR_ALLOC: f.properties.YR_ALLOC || f.properties.AwardYear }, NOW);
      assert.strictEqual(c.stage, byYear.stage, f.properties.PROJECT + ' staged ' + c.stage + ', not its award-year stage');
      assert.strictEqual(c.estimated, true, f.properties.PROJECT + ' presented as reported, not estimated');
    }
    for (const f of recent) {
      assert.notStrictEqual(ENH.classifyPipelineStage(f.properties, NOW).stage, S.complete,
        f.properties.PROJECT + ' (awarded ' + f.properties.YR_ALLOC + ') dropped from the pipeline as operating');
    }
  });

  test('an extended-use status is operating: it follows the 15-year compliance period', () => {
    const c = ENH.classifyPipelineStage({ YR_ALLOC: NOW, ComplianceStatus: 'Extended Use' }, NOW);
    assert.strictEqual(c.stage, S.complete);
    assert.strictEqual(c.estimated, false);
    assert.strictEqual(ENH.stageLabel(c), c.stage, 'a reported stage is labelled as an estimate');
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
    assert(notOperating.length > 0, 'nothing in the buffer is pipeline; the scan checks nothing');
    assert(notOperating.some((f) => /construction/i.test(statusOf(f))), 'no construction-phase project in the buffer to count');
    assert.strictEqual(pipe.active, notOperating.length);
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
