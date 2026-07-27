const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const readHeadJson = (rel) => JSON.parse(execFileSync('git', ['show', `HEAD:${rel}`], { cwd: ROOT, encoding: 'utf8' }));

const hud = readJson('data/hud-fmr-income-limits.json');
assert.strictEqual(hud.meta.source, 'HUD FMR and Income Limits (FY2026)', 'HUD meta.source should say FY2026');
assert(hud.meta.note.startsWith('FY2026 Fair Market Rents and Income Limits for Colorado counties.'), 'HUD meta.note should start with FY2026');
assert(!hud.meta.source.includes('FY2025'), 'HUD meta.source should not say FY2025');
assert(!hud.meta.note.includes('FY2025'), 'HUD meta.note should not say FY2025');

const hudHead = readHeadJson('data/hud-fmr-income-limits.json');
assert.deepStrictEqual(hud.counties, hudHead.counties, 'HUD county numeric/data records must not change');
const hudMetaComparable = Object.assign({}, hud.meta, {
  source: hudHead.meta.source,
  note: hudHead.meta.note,
});
assert.deepStrictEqual(hudMetaComparable, hudHead.meta, 'HUD metadata changes should be limited to source and note');

const fetchScript = read('scripts/fetch_fmr_api.py');
assert(!fetchScript.includes('HUD FMR and Income Limits (FY2025)'), 'fetch script should not write FY2025 combined source labels');
assert(!fetchScript.includes('FY2025 Fair Market Rents and Income Limits for Colorado counties.'), 'fetch script should not write FY2025 combined note labels');
assert(!fetchScript.includes('HUD FMR Area cross-reference by Colorado county (FY2025)'), 'fetch script should not write FY2025 cross-reference source labels');
assert(fetchScript.includes('HUD FMR and Income Limits (FY2026)'), 'fetch script should write FY2026 combined source labels');
assert(fetchScript.includes('FY2026 Fair Market Rents and Income Limits for Colorado counties.'), 'fetch script should write FY2026 combined note labels');
assert(fetchScript.includes('HUD FMR Area cross-reference by Colorado county (FY2026)'), 'fetch script should write FY2026 cross-reference source labels');

const prop123 = readJson('data/policy/prop123_jurisdictions.json');
assert(prop123.note.includes('HB26-1313'), 'Prop 123 top-level note should mention HB26-1313');
assert(prop123.note.includes('required_commitment values below describe the current cycle'), 'Prop 123 note should preserve current-cycle framing');
assert.strictEqual(
  prop123.jurisdictions[0].required_commitment,
  '3% annual affordable housing unit increase',
  'sample required_commitment should remain the current 3% annual-growth language'
);

const propHead = readHeadJson('data/policy/prop123_jurisdictions.json');
assert.deepStrictEqual(prop123.jurisdictions, propHead.jurisdictions, 'Prop 123 per-jurisdiction records must not change');
const propComparable = Object.assign({}, prop123, { note: propHead.note });
assert.deepStrictEqual(propComparable, propHead, 'Prop 123 changes should be limited to the top-level note');

console.log('policy-data-currency: PASS');
