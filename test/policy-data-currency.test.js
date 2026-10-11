const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));
const readHeadJson = (rel) => JSON.parse(execFileSync('git', ['show', `HEAD:${rel}`], { cwd: ROOT, encoding: 'utf8' }));

const hud = readJson('data/hud-fmr-income-limits.json');
// The label must agree with the fiscal years the file records, whichever they are.
const fy = hud.meta.fiscal_year;
const ilFy = hud.meta.income_limits_fiscal_year;
assert(Number.isInteger(fy) && Number.isInteger(ilFy), 'HUD meta records both fiscal years');
assert.strictEqual(hud.meta.source, `HUD FMR FY${fy} and Income Limits FY${ilFy}`, 'HUD meta.source states the recorded FMR and IL vintages');
assert(hud.meta.note.startsWith(`FY${fy} Fair Market Rents and FY${ilFy} Income Limits for Colorado counties.`), 'HUD meta.note states the recorded FMR and IL vintages');

const hudHead = readHeadJson('data/hud-fmr-income-limits.json');
assert.deepStrictEqual(hud.counties, hudHead.counties, 'HUD county numeric/data records must not change');
const hudMetaComparable = Object.assign({}, hud.meta, {
  source: hudHead.meta.source,
  note: hudHead.meta.note,
  income_limits_fiscal_year: hudHead.meta.income_limits_fiscal_year,
});
assert.deepStrictEqual(hudMetaComparable, hudHead.meta, 'HUD metadata changes should be limited to source, note, and the explicit Income Limits vintage');

const fetchScript = read('scripts/fetch_fmr_api.py');
assert(!fetchScript.includes('HUD FMR Area cross-reference by Colorado county (FY2025)'), 'fetch script should not write FY2025 cross-reference source labels');
assert(fetchScript.includes("f'HUD FMR FY{FY} and Income Limits FY{IL_FY}'"), 'fetch script should derive the FMR/IL source label from its fiscal-year constants');
assert(fetchScript.includes("f'FY{FY} Fair Market Rents and FY{IL_FY} Income Limits for Colorado counties."), 'fetch script should derive its FMR/IL note from its fiscal-year constants');
assert(fetchScript.includes("f'HUD FMR Area cross-reference by Colorado county (FY{FY})'"), 'fetch script should derive its cross-reference label from the fiscal year it wrote');

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
