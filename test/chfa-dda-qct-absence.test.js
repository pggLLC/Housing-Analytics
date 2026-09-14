'use strict';

/**
 * The DDA/QCT column must never render absence as a negative.
 *
 * CHFA's ArcGIS portfolio feed carries DDA, QCT and NON_PROF columns and
 * publishes no values in any of them — they are HUD LIHTCPUB fields, and CHFA
 * is not their source. All 926 records are null on all three.
 *
 * chfa-portfolio.html rendered those nulls as an EMPTY STRING into a badge
 * column, so every row showed a blank DDA/QCT cell. A blank cell in a column
 * whose other states are badges reads as a confident "not in a DDA or QCT" —
 * and DDA/QCT status decides 30% basis boost eligibility, which is exactly what
 * a housing finance professional opens this page for. Every other column in
 * that table already marks absence with an em dash.
 *
 * This evaluates the page's OWN expression, lifted out of the file rather than
 * copied into the test, so rewriting the logic in the page moves this guard
 * with it instead of leaving it asserting against a stale duplicate.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'chfa-portfolio.html');
const html = fs.readFileSync(PAGE, 'utf8');

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

console.log('chfa-dda-qct-absence');

// Lift the live expression out of the page and make it callable.
function loadBoostFn() {
  const start = html.indexOf('const ddaKnown =');
  assert.notEqual(start, -1,
    'could not find the DDA/QCT classification in chfa-portfolio.html — if it was ' +
    'renamed, update this test rather than deleting it');
  const bStart = html.indexOf('const boost =', start);
  assert.notEqual(bStart, -1, 'could not find the boost assignment');
  // Terminate on the statement's closing quote-semicolon, NOT on the first
  // ';' after a '</span>': the title attribute contains &quot;, whose own
  // semicolon sits inside the string literal and cut it in half.
  const TERM = "</span>';";
  const end = html.indexOf(TERM, bStart);
  assert.notEqual(end, -1, 'could not find the end of the boost assignment');
  const body = html.slice(start, end + TERM.length);
  // eslint-disable-next-line no-new-func
  return new Function('r', body + '\n return boost;');
}

// Extraction failing is itself a finding — the classification was removed or
// rewritten past recognition — so report it as a named guard rather than
// throwing at module scope, where the reader sees a stack trace and no guard
// names at all. The remaining guards then skip cleanly instead of cascading.
let boostFor = null;
run('the DDA/QCT classification is still present and extractable', () => {
  boostFor = loadBoostFn();
  assert.equal(typeof boostFor, 'function');
  assert.notEqual(boostFor({}), '',
    'the classification must not collapse back to bare badge concatenation, ' +
    'which returns an empty string whenever neither flag is set');
});

function withBoost(name, fn) {
  run(name, () => {
    assert.ok(boostFor, 'skipped: the classification could not be extracted (see above)');
    fn();
  });
}

withBoost('every real CHFA record renders "Not published", never a blank cell', () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'chfa-lihtc.json'), 'utf8'));
  const features = data.features || [];
  assert.ok(features.length > 0, 'precondition: the portfolio file has records');

  let blank = 0;
  let unpublished = 0;
  for (const f of features) {
    const out = boostFor(f.properties || {});
    if (out === '' || out === null || out === undefined) blank += 1;
    if (/Not published/.test(out)) unpublished += 1;
  }
  assert.equal(blank, 0,
    blank + ' of ' + features.length + ' rows would render an empty DDA/QCT cell, ' +
    'which a reader takes as "no"');
  assert.equal(unpublished, features.length,
    'all ' + features.length + ' records are null on DDA and QCT, so all of them ' +
    'must say so explicitly (got ' + unpublished + ')');
});

withBoost('a real designation still renders its badge', () => {
  assert.match(boostFor({ DDA: '1' }), /badge">DDA/,
    'the badge path must survive — this fix is about absence, not about ' +
    'suppressing data if CHFA ever populates the field');
  assert.match(boostFor({ QCT: 1 }), /badge-green">QCT/);
  const both = boostFor({ DDA: 1, QCT: 1 });
  assert.match(both, /DDA/);
  assert.match(both, /QCT/);
});

withBoost('a known negative is distinguishable from an unknown', () => {
  // If the source ever publishes a real 0, that IS "no" and must read
  // differently from "not published". Conflating the two is the same defect
  // in the other direction.
  const known = boostFor({ DDA: 0, QCT: 0 });
  assert.match(known, /No/);
  assert.doesNotMatch(known, /Not published/,
    'a measured negative must not be labelled unpublished');
  assert.match(boostFor({}), /Not published/,
    'an absent field must not be labelled a measured negative');
});

withBoost('the column never returns an empty string for any input', () => {
  const inputs = [{}, { DDA: null }, { QCT: null }, { DDA: null, QCT: null },
    { DDA: '' }, { DDA: undefined, QCT: undefined }, { DDA: 0 }, { QCT: '1' }];
  for (const r of inputs) {
    const out = boostFor(r);
    assert.notEqual(out, '',
      'empty output for ' + JSON.stringify(r) + ' — a blank badge cell reads as "no"');
  }
});

run('the page explains the absence, and does not promise a boost it cannot source', () => {
  assert.match(html, /id="ddaQctNote"/,
    'the column footnote anchor must exist for the header reference to reach');
  assert.match(html, /2026/,
    'the note must name the vintage of the QCT/DDA boundaries this repo holds');
  // The repo does carry HUD's current boundaries, and deriving a badge from
  // them would be wrong: they are 2026 designations, these properties were
  // allocated 1987-2025, and the boost turned on the designation in force at
  // each deal's own allocation.
  assert.match(html, /allocated between 1987 and 2025|1987/,
    'the note must say why the boundaries on hand cannot answer this column');
});

// ── The HNA map popup shares the defect ─────────────────────────────────────

run('the HNA LIHTC popup distinguishes unknown from a measured No', () => {
  // js/hna/hna-utils.js feeds this popup from BOTH the CHFA feed and HUD
  // LIHTCPUB. HUD publishes QCT/DDA; CHFA carries the columns and populates
  // neither, so every CHFA record rendered a flat "No" on the flagship page.
  const src = fs.readFileSync(path.join(ROOT, 'js', 'hna', 'hna-utils.js'), 'utf8');
  const start = src.indexOf('const yn   =');
  assert.notEqual(start, -1, 'the yn() helper was renamed — update this guard');
  const end = src.indexOf('const addr', start);
  const body = src.slice(start, end);
  // eslint-disable-next-line no-new-func
  const yn = new Function(body + '\n return yn;')();

  assert.match(yn(1), />Yes</, 'a published 1 is still Yes');
  assert.match(yn('Y'), />Yes</);
  assert.match(yn(0), />No</, 'a published 0 is a real No and must stay No');
  assert.match(yn('N'), />No</);
  for (const absent of [null, undefined, '']) {
    const out = yn(absent);
    assert.match(out, /Not published/,
      'an absent value rendered as ' + JSON.stringify(out) + ' — asserting a ' +
      'basis-boost status the source never stated');
    assert.doesNotMatch(out, />No</,
      'the unknown state must not read as a measured negative');
  }
});

// ---------------------------------------------------------------------------
// The same absence, a second surface: the deal calculator's comparables table.
//
// js/deal-calculator.js builds peer-deal rows from the same CHFA feed and
// draws QCT / DDA / non-profit badges. The mapping coerced each flag with
// `p.QCT === '1' || p.QCT === 1`, so all 926 nulls became false and no
// comparable ever earned a badge — a reader scanning the table concludes none
// of these deals sit in a QCT or DDA, which the source never said.
//
// These flags feed no arithmetic: the QCT/DDA checkbox in the calculator is
// labelled "for reference only" and the user sets Eligible Basis themselves.
// This is a display-honesty defect, not a mis-costed deal.

const CALC = path.join(ROOT, 'js', 'deal-calculator.js');
const calcSrc = fs.readFileSync(CALC, 'utf8');

// Lift the real helper rather than restating it, so a rewrite moves the guard.
function loadTriState() {
  const i = calcSrc.indexOf('function _triState(');
  const j = calcSrc.indexOf('function _safeYear(');
  assert.ok(i !== -1 && j > i, '_triState not found in js/deal-calculator.js');
  // eslint-disable-next-line no-new-func
  return new Function('return ' + calcSrc.slice(i, j).trim())();
}

run('a comparable with an unpublished flag is unknown, not false', () => {
  const triState = loadTriState();
  for (const absent of [null, undefined, '']) {
    assert.equal(triState(absent, undefined), null,
      `CHFA publishes no QCT value; ${JSON.stringify(absent)} became ` +
      `${JSON.stringify(triState(absent, undefined))} instead of null, which draws ` +
      'the same blank cell as a real "not in a QCT"');
  }
  assert.equal(triState('1', undefined), true, 'a published 1 must stay true');
  assert.equal(triState(1, undefined), true, 'a published 1 must stay true');
  assert.equal(triState('0', undefined), false, 'a published 0 is a real negative');
  assert.equal(triState(0, undefined), false, 'a published 0 is a real negative');
});

run('the comparables MAPPING actually routes each flag through _triState', () => {
  // Without this, the suite passes while the fix is reverted. An earlier
  // version of these guards lifted _triState and asserted on it directly —
  // so restoring `p.QCT === '1' || p.QCT === 1` in the mapping left the
  // helper present, correct, and completely unused, and every test stayed
  // green. Testing a helper proves nothing about the path that renders.
  for (const [flag, column] of [['isQct', 'QCT'], ['isDda', 'DDA'], ['isNonProf', 'NON_PROF']]) {
    assert.match(calcSrc, new RegExp(flag + ':\\s*_triState\\(p\\.' + column),
      `${flag} must be built with _triState(p.${column}, ...) — a direct ` +
      `comparison such as p.${column} === '1' turns CHFA's null into false`);
    assert.doesNotMatch(calcSrc, new RegExp(flag + ":\\s*p\\." + column + " === '1'"),
      `${flag} is back to coercing p.${column}, which renders unknown as a negative`);
  }
});

run('every real CHFA record resolves to unknown, not to a negative', () => {
  const feed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'chfa-lihtc.json'), 'utf8'));
  const triState = loadTriState();
  const features = feed.features || [];
  assert.ok(features.length > 0, 'expected CHFA features to check');
  const falsey = features.filter((f) => triState((f.properties || {}).QCT, undefined) === false);
  assert.equal(falsey.length, 0,
    `${falsey.length} of ${features.length} CHFA records resolved QCT to a measured ` +
    'false. CHFA populates none of these columns, so every one must be unknown.');
});

run('badges render only on a true, never on an unknown', () => {
  for (const flag of ['isQct', 'isDda', 'isNonProf']) {
    const loose = new RegExp('if \\(p\\.' + flag + '\\)\\s');
    assert.doesNotMatch(calcSrc, loose,
      `p.${flag} is tested for truthiness, so a null is indistinguishable from ` +
      'a published false — test === true');
    assert.match(calcSrc, new RegExp('p\\.' + flag + ' === true'),
      `p.${flag} must be compared strictly to true before drawing a badge`);
  }
});

run('the table discloses which flags the source withheld', () => {
  assert.match(calcSrc, /dc-peers-flag-note/,
    'the comparables table needs somewhere to say a flag was not published');
  assert.match(calcSrc, /not published by CHFA/,
    'the note must name CHFA as the source that withheld the fields');
  assert.match(calcSrc, /no badge above means unknown/,
    'the note must say explicitly that a missing badge is not a negative');
  // The note must be conditional on the data, not hard-coded: if CHFA ever
  // starts publishing, the badges carry the information and this line becomes
  // false. Guard the condition, not just the string.
  assert.match(calcSrc, /every\(function \(p\) \{ return p\[f\.key\] === null; \}\)/,
    'the note must appear only when NO comparable supplies the flag');
});

console.log(failures === 0
  ? '  all chfa-dda-qct-absence guards passed'
  : '  ' + failures + ' guard(s) failed');
process.exit(failures === 0 ? 0 : 1);
