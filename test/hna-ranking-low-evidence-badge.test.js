#!/usr/bin/env node
// test/hna-ranking-low-evidence-badge.test.js
//
// The comparative ranking marks rows whose inputs are thin with the same
// grade the digests and the HNA decision strip use: score_confidence_multiplier
// below 0.90 → low evidence. Pins the threshold to the digest builder's
// confidenceFromMultiplier so the surfaces cannot drift apart, and renders
// real rows through the module to check the badge and its title.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const dom = new JSDOM(`<!DOCTYPE html><body>
  <div id="hcaDetailPanel"></div><div id="hcaLiveRegion" role="status"></div><div id="hcaKpis"></div>
  <input id="hcaSearch" /><select id="hcaTypeFilter"><option value="all">All</option></select>
  <select id="hcaRegionFilter"><option value="all">All</option></select>
  <select id="hcaSortMetric"><option value="overall_need_score">Overall Need</option></select>
  <button id="hcaSortDir">↓</button>
  <select id="hcaScenarioPreset"><option value="official">Official ranking</option></select>
  <button id="hcaScenarioReset">Reset</button><div id="hcaScenarioDescription"></div><div id="hcaScenarioBanner" hidden></div>
  <table><thead id="hcaTableHead"></thead><tbody id="hcaTableBody"></tbody></table><div id="hcaResultsCount"></div>
  <table><tbody id="hcaScorecardTable"></tbody></table>
</body>`);
global.document = dom.window.document; global.window = dom.window; global.self = dom.window;
global.HTMLElement = dom.window.HTMLElement; global.Event = dom.window.Event;
dom.window.safeFetchJSON = async () => ({});
dom.window.DataQuality = null;
const raf = (fn) => setTimeout(fn, 0); dom.window.requestAnimationFrame = raf; global.requestAnimationFrame = raf;
require('../js/hna/hna-ranking-index.js');
const Ranking = dom.window.HNARanking;

function entry(geoid, name, multiplier, extra = {}) {
  return {
    geoid, name, type: 'place', region: 'Western Slope', containingCounty: '08077', rank: 1, percentileRank: 50, gapPercentile: 50,
    hasIncompleteData: false, nullCriticalMetrics: 0,
    dataQuality: extra.dataQuality || {},
    metrics: Object.assign({ overall_need_score: 40, housing_gap_units: 0, pct_cost_burdened: 100, in_commuters: 10, population: 6000,
      median_hh_income: 50000, pct_renters: 30, unemployment_rate: 4, score_confidence_multiplier: multiplier }, extra.metrics || {}),
  };
}

let failures = 0;
const cases = [];
function run(name, fn) { cases.push([name, fn]); }
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('hna-ranking-low-evidence-badge');

run('the threshold is the digest builder\'s: below 0.90 is low', () => {
  const builder = fs.readFileSync(path.join(ROOT, 'scripts', 'hna', 'build_jurisdiction_metrics_digest.mjs'), 'utf8');
  const m = /function confidenceFromMultiplier\(multiplier\) \{[\s\S]*?if \(multiplier >= (0\.\d+)\) return 'medium';/.exec(builder);
  assert.ok(m, 'the builder grades from the multiplier');
  const renderer = fs.readFileSync(path.join(ROOT, 'js', 'hna', 'hna-ranking-index.js'), 'utf8');
  const r = /const LOW_EVIDENCE_MULTIPLIER = (0\.\d+);/.exec(renderer);
  assert.ok(r, 'the renderer names its threshold');
  assert.equal(r[1], m[1], 'renderer and digest builder agree on the low-evidence threshold');
  assert.equal(Ranking.getEvidenceGrade(entry('x', 'x', 0.89)).low, true);
  assert.equal(Ranking.getEvidenceGrade(entry('x', 'x', 0.90)).low, false);
  assert.equal(Ranking.getEvidenceGrade(entry('x', 'x', undefined)).low, false, 'no multiplier, no claim');
});

run('a thin-evidence row renders the badge with what is thin; a solid row does not', async () => {
  // init() runs on jsdom's asynchronous DOMContentLoaded and its load() then
  // resets the entries; settle first, then inject, then render via the handler.
  await settle(60);
  const thin = entry('0812470', 'Cattle Creek (CDP)', 0.87, { dataQuality: { imputed_score_factors: ['housing_gap_rate_lte30', 'pct_deep_tier_burdened', 'rent_to_income'], approximated_fields: ['vacancy_rate_pct', 'population_projection_20yr'] }, metrics: { home_value_confidence: 'low' } });
  const solid = entry('0828745', 'Fruita (city)', 0.95);
  // '' means "no filter" in this module ('all' is a type nobody has). applyFilters()
  // only recomputes; the wired search handler is what re-renders the table.
  Ranking._set({ allEntries: [thin, solid], officialEntries: [thin, solid], searchText: '', filterType: '', filterRegion: '' });
  document.getElementById('hcaSearch').value = '';
  document.getElementById('hcaSearch').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const rows = [...document.querySelectorAll('#hcaTableBody tr[data-geoid]')];
  assert.equal(rows.length, 2, 'both rows rendered');
  const thinRow = rows.find((r) => r.dataset.geoid === '0812470');
  const badge = thinRow.querySelector('.hca-evidence-badge');
  assert.ok(badge, 'Cattle Creek carries the Low evidence badge');
  assert.equal(badge.textContent, 'Low evidence');
  assert.match(badge.title, /score confidence 0\.87: 3 score factor\(s\) imputed, 2 field\(s\) approximated from the county, home value low-confidence/);
  assert.match(badge.title, /The rank stands/);
  const solidRow = rows.find((r) => r.dataset.geoid === '0828745');
  assert.equal(solidRow.querySelector('.hca-evidence-badge'), null, 'Fruita carries none');
});

run('on the committed index the badge would mark the documented ~220 rows and no big county', () => {
  const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'hna', 'ranking-index.json'), 'utf8'));
  const low = idx.rankings.filter((e) => Ranking.getEvidenceGrade(e).low);
  assert.ok(low.length >= 150 && low.length <= 300, 'low-evidence rows: ' + low.length);
  for (const g of ['08031', '08041', '08005', '08077']) {
    const e = idx.rankings.find((x) => x.geoid === g);
    assert.equal(Ranking.getEvidenceGrade(e).low, false, e.name + ' is not low evidence');
  }
  assert.equal(Ranking.getEvidenceGrade(idx.rankings.find((x) => x.geoid === '0812470')).low, true, 'Cattle Creek is');
});

(async () => {
  for (const [name, fn] of cases) {
    try { await fn(); console.log('  ✓ ' + name); }
    catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
  }
  if (failures) { console.error('hna-ranking-low-evidence-badge: FAIL'); process.exitCode = 1; }
  else console.log('hna-ranking-low-evidence-badge: PASS');
})();
