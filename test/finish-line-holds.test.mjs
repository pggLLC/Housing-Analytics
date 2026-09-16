#!/usr/bin/env node
/**
 * The finish line must stay measurable, and must not congratulate itself.
 *
 * docs/FINISH-LINE.md is checked by scripts/audit/finish-line.mjs rather than
 * read, because this repo has a week of evidence that written-down rules go
 * stale silently. This guards the measurement itself:
 *
 *   · a PASS in the correctness floor cannot quietly stop being guarded
 *   · UNMEASURED can never be counted as done
 *   · the measurement cannot pass by finding nothing
 *
 * That last one is not hypothetical. The first version of the D2 check scored
 * PASS because docs/FINISH-LINE.md did not exist yet — zero recorded gaps in a
 * file with no content. A vacuous pass, inside the tool built to detect vacuous
 * passes.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measure, GUIDED_PATH } from '../scripts/audit/finish-line.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const pass = (m) => console.log(`  ✓ ${m}`);
const fail = (m) => { failures += 1; console.log(`  ✗ ${m}`); };
const test = (name, fn) => {
  try { fn(); pass(name); } catch (e) { fail(`${name} — ${e.message}`); }
};

console.log('finish-line-holds');

const items = measure();
const byId = Object.fromEntries(items.map((i) => [i.id, i]));

test('the measurement produces items at all', () => {
  assert.ok(items.length >= 10, `only ${items.length} items measured`);
});

test('every item declares one of the three states', () => {
  for (const i of items) {
    assert.ok(['PASS', 'OPEN', 'UNMEASURED'].includes(i.state),
      `${i.id} has state "${i.state}"`);
    assert.ok(i.detail && i.detail.length > 10, `${i.id} has no meaningful detail`);
  }
});

test('UNMEASURED is never folded into PASS', () => {
  // The first version of this only asserted that SOME item was UNMEASURED, so
  // relabelling the walkthrough as PASS sailed through while an unrelated item
  // kept the state alive. A guard that passes because something else is still
  // broken is not a guard.
  const states = new Set(items.map((i) => i.state));
  assert.ok(states.has('UNMEASURED'),
    'nothing is UNMEASURED any more — either every gap really closed, or the '
    + 'state was removed and unchecked items are now reading as done');

  // G3 is whether a novice can actually finish the path. No repo can measure
  // comprehension; it needs a person. It may only leave UNMEASURED when a
  // walkthrough is recorded, and that has to be a deliberate edit here too.
  assert.ok(byId.G3, 'the walkthrough item is gone');
  assert.strictEqual(byId.G3.state, 'UNMEASURED',
    'G3 claims the guided path is verified. Whether someone unfamiliar with the '
    + 'tool can finish it is a human judgement — if a walkthrough really happened, '
    + 'record it and change this assertion on purpose.');
});

test('the guided path is six steps and every page exists', () => {
  assert.strictEqual(GUIDED_PATH.length, 6, 'the guided path is no longer six steps');
  for (const s of GUIDED_PATH) {
    assert.ok(fs.existsSync(path.join(ROOT, s.page)),
      `step ${s.step} (${s.name}) points at ${s.page}, which does not exist`);
  }
});

test('every correctness-floor guard is still wired into test:ci', () => {
  // A PASS here means "a test holds this". If the test leaves test:ci, the
  // claim becomes an assertion about the past.
  const ci = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts['test:ci'];
  const floor = items.filter((i) => i.group === 'Correctness floor');
  assert.ok(floor.length >= 6, `only ${floor.length} correctness-floor items`);
  const dropped = floor.filter((i) => i.state === 'OPEN').map((i) => i.detail);
  assert.deepStrictEqual([...dropped], [],
    `these no longer hold: ${dropped.join(' | ')}`);
  for (const script of ['test:no-coerced-zeros', 'test:derived-chain', 'test:freshness-guard',
    'test:planned-sources', 'test:glossary-reach', 'test:ownership-answer', 'test:deal-calc-absence']) {
    assert.ok(ci.includes(script), `${script} is no longer in test:ci`);
  }
});

test('the definition cannot pass by being empty', () => {
  const doc = path.join(ROOT, 'docs', 'FINISH-LINE.md');
  assert.ok(fs.existsSync(doc), 'docs/FINISH-LINE.md is gone');
  const text = fs.readFileSync(doc, 'utf8');
  assert.ok(text.length > 1500, 'the finish line has been emptied');
  assert.ok(/PC-6/.test(text), 'the one recorded pass criterion is gone');
  // And the D2 check must react to the file's absence rather than scoring it.
  assert.ok(byId.D2, 'D2 is gone');
  assert.ok(['PASS', 'OPEN'].includes(byId.D2.state), 'D2 is no longer measured');
});

test('unrecorded pass criteria are reported, not glossed', () => {
  // Six of seven criteria exist only in the owner's plan. While that is true
  // the definition is incomplete and must say so out loud.
  const text = fs.readFileSync(path.join(ROOT, 'docs', 'FINISH-LINE.md'), 'utf8');
  const gaps = (text.match(/NOT RECORDED/g) || []).length;
  if (gaps > 0) {
    assert.strictEqual(byId.D2.state, 'OPEN',
      `${gaps} pass criteria are unrecorded but D2 reports ${byId.D2.state}`);
  } else {
    assert.strictEqual(byId.D2.state, 'PASS',
      'every criterion is recorded but D2 still reports OPEN');
  }
});

test('the standing constraints are written down', () => {
  const text = fs.readFileSync(path.join(ROOT, 'docs', 'FINISH-LINE.md'), 'utf8');
  for (const rule of [
    'two PRs',
    'one PR at a time',
    'never\n  directly',
    'owner merges',
  ]) {
    const needle = rule.replace(/\s+/g, '\\s+');
    assert.ok(new RegExp(needle, 'i').test(text), `the constraint "${rule}" is no longer recorded`);
  }
});

console.log(failures === 0
  ? '  finish-line-holds: PASS'
  : `  finish-line-holds: FAIL (${failures})`);
process.exit(failures === 0 ? 0 : 1);
