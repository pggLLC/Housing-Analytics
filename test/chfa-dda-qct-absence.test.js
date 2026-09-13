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

console.log(failures === 0
  ? '  all chfa-dda-qct-absence guards passed'
  : '  ' + failures + ' guard(s) failed');
process.exit(failures === 0 ? 0 : 1);
