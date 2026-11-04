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

const page = fs.readFileSync(path.join(ROOT, 'js/market-analysis.js'), 'utf8');
assert.match(page, /Number\.isFinite\(result\.overall\)/, 'the caller passes null, not a non-finite score');
assert.match(page, /CHFA reference properties with similar scores/, 'comparable rows are labelled as similar-score references');
console.log(`peer-benchmark-missing-score: PASS (${refs.length} reference properties; missing scores unavailable, 0 ranked)`);
