#!/usr/bin/env node
/**
 * G3 reads a recorded walkthrough, and the record cannot pass by accident.
 *
 * G3 is the only finish-line item no code can move: it asks whether a person
 * unfamiliar with housing finance finished the guided path and trusts what
 * they got. It was hardcoded UNMEASURED, which was honest but left a real
 * walkthrough with nowhere to land.
 *
 * It now reads docs/walkthroughs/. This file pins the properties that keep
 * that from becoming a box-ticking exercise:
 *
 *   - a NEGATIVE verdict is a complete record, reported OPEN with the
 *     reader's blockers. A form that can only express success is the defect
 *     this repo keeps removing;
 *   - a walkthrough by someone who already knew the tool does not count — it
 *     answers a different question, and one of those has been done (#1837);
 *   - an unfilled template does not count;
 *   - a record of a path the product no longer has does not count.
 *
 * None of this makes a record unforgeable. It makes an ACCIDENTAL pass
 * impossible, which is the achievable goal.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWalkthrough, VERDICTS } from '../scripts/audit/walkthrough-record.mjs';
import { GUIDED_PATH } from '../scripts/audit/finish-line.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'docs/walkthroughs');

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures += 1; console.log(`  ✗ ${name} — ${e.message}`); }
};

/** A record with everything right, then whatever the caller wants wrong. */
function record(fields = {}, opts = {}) {
  const f = {
    Walker: 'Jane Rivera',
    'Unfamiliar with the tool': 'yes',
    Jurisdiction: 'Salida (Chaffee County)',
    Date: '2026-09-24',
    Verdict: VERDICTS.ACT,
    ...fields,
  };
  let s = '# Guided-path walkthrough\n\n';
  for (const k of Object.keys(f)) s += `- **${k}:** ${f[k]}\n`;
  s += '\n## Steps\n\n';
  for (const st of GUIDED_PATH) {
    if (opts.skip === st.step) continue;
    const notes = opts.thin === st.step
      ? 'ok'
      : 'Expected the AMI table here; found it two scrolls down, and did not know '
        + 'what CHAS meant until I opened the glossary.';
    s += `### ${st.step}. ${st.name}\n\n${notes}\n\n`;
  }
  return s;
}

function judge(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthrough-'));
  try {
    if (content !== null) fs.writeFileSync(path.join(dir, '2026-09-24-probe.md'), content);
    return readWalkthrough(dir, GUIDED_PATH);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('walkthrough-record');

test('the guided path is readable, so these probes mean something', () => {
  assert.ok(GUIDED_PATH.length >= 5,
    `only ${GUIDED_PATH.length} steps read from the route; every probe below would be vacuous`);
});

test('no record reads as UNMEASURED, and says how to make one', () => {
  const r = judge(null);
  assert.strictEqual(r.state, 'UNMEASURED');
  assert.match(r.detail, /TEMPLATE\.md/, 'the message does not say where the template is');
});

test('a complete walkthrough with a positive verdict PASSES', () => {
  const r = judge(record());
  assert.strictEqual(r.state, 'PASS', r.detail);
  assert.match(r.detail, /Jane Rivera/, 'the detail does not name who walked it');
});

test('a complete walkthrough with a NEGATIVE verdict is OPEN, not missing', () => {
  // The property that stops this being a success-shaped form. Someone who
  // walks the path and would not act on the result has produced a complete,
  // useful record — far more useful than nobody having checked.
  const r = judge(record({ Verdict: VERDICTS.NOT }));
  assert.strictEqual(r.state, 'OPEN', r.detail);
  assert.match(r.detail, /would\s*NOT act/i, 'the detail does not report the negative verdict');
  assert.notStrictEqual(r.state, 'UNMEASURED',
    'a recorded failure is being reported as though nobody had checked');
});

test('a walkthrough by someone who already knew the tool does not count', () => {
  const r = judge(record({ 'Unfamiliar with the tool': 'no' }));
  assert.strictEqual(r.state, 'UNMEASURED', r.detail);
  assert.match(r.detail, /first-time|familiar/i);
});

test('an unfilled template does not count', () => {
  for (const [field, value] of [
    ['Walker', '<who did this>'],
    ['Jurisdiction', '<the place they chose>'],
    ['Verdict', '<would-act or would-not-act>'],
  ]) {
    const r = judge(record({ [field]: value }));
    assert.strictEqual(r.state, 'UNMEASURED', `placeholder ${field} was accepted: ${r.detail}`);
  }
});

test('a missing or token step note does not count', () => {
  const skipped = judge(record({}, { skip: GUIDED_PATH[3].step }));
  assert.strictEqual(skipped.state, 'UNMEASURED', skipped.detail);
  const thin = judge(record({}, { thin: GUIDED_PATH[4].step }));
  assert.strictEqual(thin.state, 'UNMEASURED', thin.detail);
  assert.match(thin.detail, /no real notes/i);
});

test('a record of a path the product no longer has does not count', () => {
  // A walkthrough of a different route is not evidence about this one.
  const shorter = GUIDED_PATH.slice(0, -1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthrough-'));
  try {
    fs.writeFileSync(path.join(dir, '2026-09-24-probe.md'), record());
    const r = readWalkthrough(dir, shorter);
    assert.strictEqual(r.state, 'UNMEASURED', r.detail);
    assert.match(r.detail, /path changed|covers steps/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the shipped template is present, and is not itself a passing record', () => {
  const tpl = path.join(DIR, 'TEMPLATE.md');
  assert.ok(fs.existsSync(tpl), 'docs/walkthroughs/TEMPLATE.md is missing');
  const body = fs.readFileSync(tpl, 'utf8');
  for (const st of GUIDED_PATH) {
    assert.ok(body.includes(`### ${st.step}. ${st.name}`),
      `the template has no section for step ${st.step} (${st.name}); it has drifted from the route`);
  }
  // Dropping the template into the records directory must not satisfy G3.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthrough-'));
  try {
    fs.writeFileSync(path.join(dir, '2026-09-24-template-copy.md'), body);
    assert.strictEqual(readWalkthrough(dir, GUIDED_PATH).state, 'UNMEASURED',
      'the blank template counts as a completed walkthrough');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(failures === 0
  ? '  walkthrough-record: PASS'
  : `  walkthrough-record: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
