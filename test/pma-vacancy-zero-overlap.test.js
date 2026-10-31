'use strict';
// Codex site audit F1 (2026-10-31): a tract with a real zero overlap must
// contribute nothing to the PMA vacancy card. Before the fix, `share || 1`
// turned 0 into full weight (Mesa 3-mile example read 6.8% instead of ~5.0%).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js/components/vacancy-context.js'), 'utf8');
const sandbox = { window: {}, document: {}, console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const VC = sandbox.window.VacancyContext;

// Weight lookup: zero stays zero, missing means whole tract.
assert.equal(VC._weightFor({ a: 0 }, 'a'), 0, 'zero overlap stays zero');
assert.equal(VC._weightFor({ a: 0.25 }, 'a'), 0.25, 'partial overlap kept');
assert.equal(VC._weightFor({}, 'a'), 1, 'missing weight = whole tract');
assert.equal(VC._weightFor(null, 'a'), 1, 'no weights = whole tract');
assert.equal(VC._weightFor({ a: NaN }, 'a'), 1, 'non-numeric weight = whole tract');

// Weighted rate: a high-vacancy tract with zero overlap must not move the result.
const rows = [
  { rate: 0.05, total_hh: 950, vacant: 50, weight: 1 },
  { rate: 0.20, total_hh: 800, vacant: 200, weight: VC._weightFor({ z: 0 }, 'z') },
];
assert.equal(VC._weightedRate(rows), 0.05, 'zero-overlap tract contributes nothing');

// Direct hand calculation with partial shares.
const mixed = [
  { rate: 0.04, total_hh: 960, vacant: 40, weight: 0.5 },
  { rate: 0.10, total_hh: 900, vacant: 100, weight: 0.25 },
];
const expected = (0.04 * 1000 * 0.5 + 0.10 * 1000 * 0.25) / (1000 * 0.5 + 1000 * 0.25);
assert.ok(Math.abs(VC._weightedRate(mixed) - expected) < 1e-12, 'matches direct weighted calculation');

// The page caller must pass zero through rather than replacing it with 1.
const ma = fs.readFileSync(path.join(ROOT, 'js/market-analysis.js'), 'utf8');
assert.ok(!/weights\[d\.geoid\]\s*=\s*d\.share\s*\|\|\s*1/.test(ma), 'market-analysis no longer turns a zero share into 1');
assert.ok(!/weightsByTract\[g\]\)\s*\|\|\s*1/.test(src), 'vacancy-context no longer turns a zero weight into 1');

console.log('pma-vacancy-zero-overlap: all checks passed');
