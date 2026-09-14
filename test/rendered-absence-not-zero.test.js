#!/usr/bin/env node
/**
 * rendered-absence-not-zero — a missing value must not render as a confident one.
 *
 * Plan package 1E. The failure this guards is the one that produced Denver at
 * 51.2% overcrowding and, in this panel, "$0" in a column labelled "Median HHI":
 * absence coerced into a number and published as an observation.
 *
 * `$0 median household income` is a statement about a place, and a false one.
 * The distinction that matters is between ABSENT and GENUINELY ZERO — a plain
 * `Number(x) || 0` cannot express it, because Number(null) and Number('') are
 * both 0.
 *
 * This targets RENDERED paths specifically. `|| 0` inside a reduce() is correct
 * — zero is the identity for a sum — and a blanket ban would be noise. The
 * panel's own derived columns already got this right (`pi != null ? … : '—'`);
 * only its raw-value columns did not.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PANEL = path.join(ROOT, 'js', 'affordability-metrics-panel.js');

let failures = 0;
const fail = (m) => { console.error(`  ✗ ${m}`); failures++; };
const ok = (m) => console.log(`  ✓ ${m}`);

console.log('\nrendered-absence-not-zero');

const src = fs.readFileSync(PANEL, 'utf8');

/* ── 1. the helpers must distinguish absent from zero ──────────────────── */
const numSrc = src.match(/function _num\(v\)[\s\S]*?\n  \}/);
const moneySrc = src.match(/function _money\(v\)[\s\S]*?\n  \}/);
if (!numSrc || !moneySrc) {
  fail('could not locate _num()/_money() in affordability-metrics-panel.js — this guard would '
     + 'pass vacuously if they were renamed or removed');
} else {
  // eslint-disable-next-line no-eval
  const _num = eval(`(${numSrc[0]})`);
  // eslint-disable-next-line no-eval
  const _money = eval(`(${moneySrc[0]})`);

  const absent = [null, undefined, '', NaN];
  for (const v of absent) {
    if (_num(v) !== null) fail(`_num(${JSON.stringify(v)}) = ${_num(v)}; absent values must stay null`);
    if (_money(_num(v)) !== '—') {
      fail(`an absent value renders as ${JSON.stringify(_money(_num(v)))} instead of an em dash — `
         + `that is absence published as an observation`);
    }
  }

  // The other half, and the reason a blanket null-check is wrong: a real zero
  // must survive as a real zero.
  if (_num(0) !== 0) fail('_num(0) discarded a genuine zero — absence and zero are different facts');
  if (_money(0) !== '$0') fail(`a genuine zero renders as ${JSON.stringify(_money(0))}; it should read $0`);
  if (_money(_num(95470)) !== '$95,470') fail(`a real value renders as ${JSON.stringify(_money(_num(95470)))}`);

  if (!failures) ok('absent → "—", genuine zero → "$0", real values format normally');
}

/* ── 2. the rendered columns must go through the formatter ─────────────── */
{
  // The specific regression: `'$' + Math.round(r.rec.X).toLocaleString()`.
  // Math.round(null) is 0, so this prints "$0" for a missing value.
  const raw = [...src.matchAll(/\$'\s*\+\s*\n?\s*Math\.round\(r\.rec\.(\w+)\)/g)].map((m) => m[1]);
  if (raw.length) {
    fail(`${raw.length} column(s) still format with '$' + Math.round(r.rec.X) directly `
       + `(${[...new Set(raw)].join(', ')}). Math.round(null) is 0, so a missing value prints "$0". `
       + `Use the formatter that renders absence as an em dash.`);
  } else {
    ok('no raw-value column formats a possibly-absent number without the absence check');
  }
}

/* ── 3. the inputs must not be coerced before they are ever checked ────── */
{
  const coerced = [...src.matchAll(/var\s+(home|hhi|rent)\s*=\s*[^;\n]*\|\|\s*0\s*;/g)].map((m) => m[1]);
  if (coerced.length) {
    fail(`${coerced.join(', ')} still coerce to 0 with \`|| 0\`. The derived ratios survive it `
       + `(\`home && hhi\` yields null), but the raw values are published, and "$0 median household `
       + `income" is a false statement about a place.`);
  } else {
    ok('home / hhi / rent keep absence as null rather than coercing to zero');
  }
}

if (failures) { console.error(`\nrendered-absence-not-zero: FAIL (${failures})`); process.exit(1); }
console.log('rendered-absence-not-zero: PASS');
