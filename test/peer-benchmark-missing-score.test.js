'use strict';
// Peer benchmark on market-analysis.html: a site with no market score is
// "unavailable", never percentile 0 / "Bottom 25%"; a measured 0 still ranks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/market-analysis-enhancements.js'), 'utf8'), ctx);
const ENH = ctx.window.PMAEnhancements;
const refs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/market/reference-projects.json'), 'utf8')).projects;
const result = { bufferMiles: 3 };

for (const missing of [null, undefined, NaN, Infinity, '57']) {
  const b = ENH.benchmarkVsReference(missing, result, refs);
  assert.equal(b.available, false, `score ${String(missing)} must be unavailable`);
  assert.equal(b.percentile, undefined, `score ${String(missing)} must carry no percentile`);
  assert.match(b.reason, /no market score/);
}
const zero = ENH.benchmarkVsReference(0, result, refs);
assert.equal(zero.available, true, 'a measured 0 is a real score');
assert.equal(zero.percentile, 0);
const mid = ENH.benchmarkVsReference(zero.median, result, refs);
assert.ok(mid.available && mid.percentile > 0, 'a real score ranks');

const engineSrc = fs.readFileSync(path.join(ROOT, 'js/market-analysis-enhancements.js'), 'utf8');
const page = fs.readFileSync(path.join(ROOT, 'js/market-analysis.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'market-analysis.html'), 'utf8');
assert.match(page, /Number\.isFinite\(result\.overall\)/, 'the caller passes null, not a non-finite score');

// Agreement, not copy: the score window the page and the methodology state
// must be the window the engine actually uses. Wording is free; the number
// is the claim.
function engineWindow(src) {
  const m = src.match(/Math\.abs\(x\.s - score\) <= (\d+(?:\.\d+)?)/);
  assert.ok(m, 'engine comparable-window rule found');
  return Number(m[1]);
}
function statedWindows(src) {
  return [...src.matchAll(/±\s*(\d+(?:\.\d+)?)\s*points/g)].map((m) => Number(m[1]));
}
function checkAgreement(eng, pg, doc) {
  const w = engineWindow(eng);
  const stated = [...statedWindows(pg), ...statedWindows(doc)];
  assert.ok(statedWindows(pg).length >= 1, 'the comparable table states its score window');
  assert.ok(statedWindows(doc).length >= 1, 'the methodology states the score window');
  for (const s of stated) assert.equal(s, w, `stated window ±${s} must equal the engine window ±${w}`);
  return w;
}
const WINDOW = checkAgreement(engineSrc, page, html);

// Behaviour: every listed property really is within the window at the same
// buffer, closest first, at most five.
let checked = 0;
for (const buf of ['3', '5', '10']) {
  const res = { bufferMiles: Number(buf) };
  for (const score of [20, 40, 55, 70, 85]) {
    const b = ENH.benchmarkVsReference(score, res, refs);
    if (!b.available) continue;
    assert.ok(b.comparable.length <= 5);
    let prev = -1;
    for (const c of b.comparable) {
      assert.equal(c.pma_score, c.pma_score_by_buffer[buf], 'comparable scored at the same buffer');
      const d = Math.abs(c.pma_score - score);
      assert.ok(d <= WINDOW, `comparable ${c.pma_score} within ±${WINDOW} of ${score}`);
      assert.ok(d >= prev, 'closest first');
      prev = d;
      checked++;
    }
  }
}
assert.ok(checked > 0, 'the behaviour scan found comparable properties to check');

// Sabotage both ways, proving each mutation applied.
const reworded = page.replace('CHFA reference properties with similar scores', 'CHFA properties with nearby scores');
assert.notEqual(reworded, page, 'rewording mutation applied');
assert.doesNotThrow(() => checkAgreement(engineSrc, reworded, html), 'a meaning-preserving rewording stays green');
const widened = engineSrc.replace(/(Math\.abs\(x\.s - score\) <= )10/, '$115');
assert.notEqual(widened, engineSrc, 'engine-window mutation applied');
assert.throws(() => checkAgreement(widened, page, html), 'an engine window the page does not state fails');
const pageOnly = page.replace('±10 points', '±5 points');
assert.notEqual(pageOnly, page, 'page-window mutation applied');
assert.throws(() => checkAgreement(engineSrc, pageOnly, html), 'a page window the engine does not use fails');

console.log(`peer-benchmark-missing-score: PASS (${refs.length} reference properties; missing scores unavailable, 0 ranked; ±${WINDOW} window agrees across engine, table and methodology; ${checked} comparables checked)`);
