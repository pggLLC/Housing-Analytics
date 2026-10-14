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
import {
  readWalkthrough, judgeRecord, recordFiles, VERDICTS, JURISDICTION_TYPES,
} from '../scripts/audit/walkthrough-record.mjs';
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
    'Jurisdiction type': 'small town',
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

/** One record, judged on its own. */
function judge(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthrough-'));
  try {
    const file = path.join(dir, '2026-09-24-probe.md');
    fs.writeFileSync(file, content);
    return judgeRecord(file, GUIDED_PATH);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** G3 across a set of records, given as { 'YYYY-MM-DD-name.md': content }. */
function g3(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthrough-'));
  try {
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
    return readWalkthrough(dir, GUIDED_PATH);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Three complete would-act records, one per type, by three people. */
const THREE = {
  '2026-10-20-city.md': record({ Walker: 'Ana Ortiz', Jurisdiction: 'Greeley (city)', 'Jurisdiction type': 'city' }),
  '2026-10-21-county.md': record({ Walker: 'Ben Kerr', Jurisdiction: 'Kiowa County', 'Jurisdiction type': 'rural county' }),
  '2026-10-22-town.md': record({ Walker: 'Jane Rivera' }),
};

console.log('walkthrough-record');

test('the guided path is readable, so these probes mean something', () => {
  assert.ok(GUIDED_PATH.length >= 5,
    `only ${GUIDED_PATH.length} steps read from the route; every probe below would be vacuous`);
});

test('no record reads as UNMEASURED, and says how to make one', () => {
  const r = g3({});
  assert.strictEqual(r.state, 'UNMEASURED');
  assert.match(r.detail, /TEMPLATE\.md/, 'the message does not say where the template is');
});

test('a complete walkthrough with a positive verdict counts as a pass for its place', () => {
  const r = judge(record());
  assert.strictEqual(r.state, 'PASS', r.detail);
  assert.match(r.detail, /Jane Rivera/, 'the detail does not name who walked it');
  assert.strictEqual(r.type, 'small town');
});

test('one passing walkthrough does not pass G3; it names the types still needed', () => {
  // Until 2026-10-14 G3 read only the newest record, so a single city walk
  // would have closed it. Phase 2 needs a city, a rural county and a small town.
  const r = g3({ '2026-10-20-town.md': record() });
  assert.strictEqual(r.state, 'UNMEASURED', r.detail);
  assert.match(r.detail, /1 of 3 walked/);
  assert.match(r.detail, /still needed: city, rural county/);
});

test('one passing walkthrough of each type, by three people, PASSES G3', () => {
  assert.deepStrictEqual(JURISDICTION_TYPES, ['city', 'rural county', 'small town']);
  const r = g3(THREE);
  assert.strictEqual(r.state, 'PASS', r.detail);
  for (const who of ['Ana Ortiz', 'Ben Kerr', 'Jane Rivera']) assert.match(r.detail, new RegExp(who));
});

test('two passing types are still not enough', () => {
  const { '2026-10-21-county.md': _drop, ...two } = THREE;
  const r = g3(two);
  assert.strictEqual(r.state, 'UNMEASURED', r.detail);
  assert.match(r.detail, /still needed: rural county/);
});

test('one person walking all three types does not count as three readers', () => {
  const same = Object.fromEntries(Object.entries(THREE)
    .map(([n, c]) => [n, c.replace(/\*\*Walker:\*\* .*/, '**Walker:** Ana Ortiz')]));
  const r = g3(same);
  assert.strictEqual(r.state, 'UNMEASURED', r.detail);
  assert.match(r.detail, /by 1 person/);
});

test('a would-not-act record for any type makes G3 OPEN, whatever the others say', () => {
  const r = g3({ ...THREE, '2026-10-23-town-again.md': record({ Verdict: VERDICTS.NOT }) });
  assert.strictEqual(r.state, 'OPEN', r.detail);
  assert.match(r.detail, /would NOT act/);
});

test('a newer would-act walk of a type supersedes an older would-not-act', () => {
  const r = g3({ ...THREE, '2026-10-19-town-first.md': record({ Walker: 'Cal Reyes', Verdict: VERDICTS.NOT }) });
  assert.strictEqual(r.state, 'PASS', r.detail);
});

test('a record that does not count is named, not silently skipped', () => {
  const r = g3({ ...THREE, '2026-10-24-familiar.md': record({ Walker: 'Dee Park', 'Unfamiliar with the tool': 'no' }) });
  assert.strictEqual(r.state, 'PASS', r.detail);
  assert.match(r.detail, /Not counted: .*familiar/);
});

test('a record without a jurisdiction type does not count', () => {
  for (const value of ['<city, rural county or small town>', 'suburb']) {
    const r = judge(record({ 'Jurisdiction type': value }));
    assert.strictEqual(r.state, 'UNMEASURED', `type "${value}" was accepted: ${r.detail}`);
    assert.match(r.detail, /Jurisdiction type/);
  }
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
    const r = judgeRecord(path.join(dir, '2026-09-24-probe.md'), shorter);
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

test('the walker guide sends people down the route G3 scores, and is never read as a record', () => {
  const body = fs.readFileSync(path.join(DIR, 'GUIDE.md'), 'utf8');
  // The fallback links must be the route itself, in order: a guide that
  // sends a walker to a retired page records a walk of a different path.
  const linked = [...body.matchAll(/^\|\s*(\d+)\s*\|\s*<https:\/\/cohoanalytics\.com\/([^>]+)>\s*\|$/gm)]
    .map((m) => ({ step: Number(m[1]), page: m[2] }));
  assert.ok(linked.length > 0, 'found no step links in GUIDE.md — the scan checked nothing');
  assert.deepStrictEqual(linked, GUIDED_PATH.map((s) => ({ step: s.step, page: s.page })),
    'GUIDE.md step links disagree with the STEPS table in workflow-progress.js');
  // One prompt section per step, numbered as the template numbers them.
  const sections = [...body.matchAll(/^###\s+(\d+)\./gm)].map((m) => Number(m[1]));
  assert.deepStrictEqual(sections, GUIDED_PATH.map((s) => s.step),
    'GUIDE.md walker sections do not match the guided path');
  // Step 1's own page skips step 2 and calls it optional. A walker who
  // follows the site would then have no step-2 notes and the record could
  // never count, so while the page says so, the guide must send them there.
  const stepOnePage = fs.readFileSync(path.join(ROOT, GUIDED_PATH[0].page), 'utf8');
  const stepTwo = GUIDED_PATH[1];
  if (/not required/i.test(stepOnePage) && stepOnePage.includes(stepTwo.page)) {
    const stepOneSection = (body.split(/^###\s+/m).find((sec) => sec.startsWith('1.')) || '');
    assert.ok(new RegExp(`do step 2 anyway`, 'i').test(stepOneSection)
      && stepOneSection.includes(stepTwo.name),
      `${GUIDED_PATH[0].page} calls step 2 optional; the guide's step-1 section must send the walker to the ${stepTwo.name}`);
  }
  // The guide lives beside the records; it must not be scored as one.
  assert.ok(!recordFiles(DIR).some((f) => path.basename(f) === 'GUIDE.md'),
    'GUIDE.md is being read as a walkthrough record');
});

console.log(failures === 0
  ? '  walkthrough-record: PASS'
  : `  walkthrough-record: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
