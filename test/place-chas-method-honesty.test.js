#!/usr/bin/env node
/**
 * The published `method` string must describe the weight the code computes.
 *
 * For months data/hna/place-chas.json told every consumer it was built by
 * "Area-weighted apportionment (share_of_tract_area)". It was not. F28 had
 * replaced that with min(1.0, max(area_share, pop_share)) because area share
 * alone undercounted a town embedded in a large rural tract by roughly seventy
 * times. The code was right; the label a downloader reads was wrong, and
 * nothing failed.
 *
 * This checks the THREE places the claim appears, against each other:
 *
 *   1. the expression in scripts/hna/build_place_chas.py — what actually runs
 *   2. the `method` string emitted into data/hna/place-chas.json — what a
 *      consumer of the data is told
 *   3. the module header — what the next maintainer reads
 *
 * Checking the source alone would not have caught the original defect, because
 * the source was correct. The failure was that the OUTPUT disagreed with it.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'scripts', 'hna', 'build_place_chas.py');
const OUT = path.join(ROOT, 'data', 'hna', 'place-chas.json');

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const test = (name, fn) => {
  try {
    const why = fn();
    if (why) fail(`${name} — ${why}`); else pass(name);
  } catch (e) {
    fail(`${name} — threw: ${e.message}`);
  }
};

console.log('place-chas-method-honesty');

if (!fs.existsSync(SRC)) { fail('build_place_chas.py is missing'); process.exit(1); }
const src = fs.readFileSync(SRC, 'utf8');

/**
 * The weight expression as it appears in the code, normalised.
 *
 * Anchored to the assignment so a mention of the rule inside a comment cannot
 * satisfy it — a comment is not what executes, and a comment claiming the rule
 * is exactly the failure mode this file exists for.
 */
const WEIGHT_ASSIGN = /^\s*weight\s*=\s*(.+)$/gm;
const assignments = [...src.matchAll(WEIGHT_ASSIGN)].map((m) => m[1].trim());

test('the weight is assigned somewhere in the builder', () => (
  assignments.length ? null : 'no `weight = ...` assignment found'
));

const primary = assignments.find((a) => a.includes('max('));
const fallback = assignments.find((a) => !a.includes('max(') && a.includes('share_tract'));

test('the primary weight takes the max of area share and population share', () => {
  if (!primary) return 'no weight assignment uses max()';
  if (!/min\(\s*1\.0\s*,\s*max\(/.test(primary)) {
    return `the max is not clamped to 1.0 — a single tract could contribute `
      + `more than itself to one place: ${primary}`;
  }
  return null;
});

test('an area-share fallback exists for places with no population data', () => (
  fallback ? null : 'no area-share fallback assignment found; a place with no '
    + 'population figure would get no weight at all'
));

test('the fallback is flagged rather than silent', () => {
  // A place apportioned by the weaker rule must be distinguishable from one
  // apportioned by the better rule. Same discipline as marking an absence.
  // indexOf on the bare expression finds its first mention anywhere in the
  // file — a comment, a docstring — not the assignment itself. Anchor to the
  // assignment, or this passes on an unrelated line.
  if (!fallback) return 'fallback assignment not located';
  const anchor = `weight = ${fallback}`;
  const idx = src.indexOf(anchor);
  if (idx < 0) return `could not locate the assignment \`${anchor}\``;
  const window = src.slice(idx, idx + 260);
  return /used_area_fallback\s*=\s*True/.test(window)
    ? null
    : 'the area-share fallback sets no flag, so a downstream reader cannot tell '
      + 'which rule produced a place';
});

/* ── the claim consumers actually read ───────────────────────────────────── */

test('the emitted method string describes the weight the code computes', () => {
  // The docstring carries an "Output schema" EXAMPLE with its own "method"
  // value. Matching that instead of the real emitter is how a guard passes
  // while the published file stays wrong — so anchor to the single-quoted
  // Python literal that is actually written into the JSON.
  const m = src.match(/'method':\s*'([\s\S]*?)',\n/);
  if (!m) return "no 'method' emitter found in the builder";
  const claim = m[1].replace(/'\s*\n\s*'/g, '');
  if (/^area-weighted/i.test(claim)) {
    return `the emitted method still claims "${claim}" while the code computes ${primary}`;
  }
  if (!/max\(/.test(claim)) {
    return `the emitted method "${claim}" does not mention the max() rule the code uses`;
  }
  if (!/min\(\s*1\.0/.test(claim)) {
    return `the emitted method "${claim}" omits the 1.0 clamp`;
  }
  if (!/fall(ing|s|back)/i.test(claim)) {
    return 'the emitted method does not mention the area-share fallback';
  }
  if (!/not a partition|exceed 1|not be summed/i.test(claim)) {
    return 'the emitted method does not warn that place counts cannot be summed statewide';
  }
  return null;
});

test('the docstring output-schema example agrees with the real emitter', () => {
  // Two method strings live in this file. A maintainer reading the schema
  // example will believe it, so it may not contradict what is emitted.
  const ex = src.match(/"method":\s*"([^"]*)"/);
  if (!ex) return null;                       // no example block, nothing to check
  if (/^area-weighted/i.test(ex[1])) {
    return `the docstring example still shows "${ex[1]}"`;
  }
  return /max\(/.test(ex[1]) ? null
    : `the docstring example "${ex[1]}" omits the max() rule`;
});

test('the committed data file does not carry the superseded area-weighted claim', () => {
  // SCOPE, stated because it is narrower than the name suggests. This asserts
  // the published file is not telling consumers the superseded area-weighted
  // story. It does NOT assert the published string equals what the emitter
  // would write today: the committed file predates this fix and still says
  // "Population-share apportionment", which is incomplete — it omits the
  // max(area_share, ...) — rather than wrong.
  //
  // Closing that gap needs data/hna/place-chas.json regenerated, and that
  // carries a real ordering hazard: the ACS summary caches must rebuild BEFORE
  // the CHAS build or the occupied-household anchor silently no-ops. That is a
  // data-pipeline operation, not a docs fix, so it is deliberately not bundled
  // here. Until it runs, this is the honest assertion to make.
  if (!fs.existsSync(OUT)) return 'data/hna/place-chas.json is not present';
  let doc;
  try { doc = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) {
    return `place-chas.json did not parse: ${e.message}`;
  }
  const claim = doc && doc.meta && doc.meta.method;
  if (!claim) return 'place-chas.json meta carries no method string';
  if (/^area-weighted/i.test(claim)) {
    return `the PUBLISHED file still tells consumers "${claim}" — regenerate it`;
  }
  return null;
});

test('the module header does not still teach the superseded rule', () => {
  const header = src.slice(0, src.indexOf('"""', src.indexOf('"""') + 3));
  if (/area-weighted apportionment of tract-level/i.test(header)) {
    return 'the header still describes area-weighted apportionment as the method';
  }
  if (!/max\(/.test(header)) {
    return 'the header does not state the weight rule at all';
  }
  return null;
});

test('the non-partition property is stated where a maintainer will see it', () => {
  // max() summed across the places overlapping a tract can exceed 1. That makes
  // statewide sums of place counts invalid, and it is the least obvious
  // consequence of the rule — so it has to be written down next to it.
  const header = src.slice(0, 4000);
  return /not a partition|exceed 1|more than one place/i.test(header)
    ? null
    : 'the header does not warn that max() is not a partition, so a reader could '
      + 'reasonably sum place counts statewide';
});

console.log(failures === 0
  ? '  place-chas-method-honesty: PASS'
  : `  place-chas-method-honesty: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
