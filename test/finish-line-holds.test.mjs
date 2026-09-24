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
import { measure, GUIDED_PATH, evaluateGuidedPath } from '../scripts/audit/finish-line.mjs';

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

test('the audit reads the real route, not a copy of an old one', () => {
  // This assertion used to be `GUIDED_PATH.length === 6`, and it was the
  // problem rather than the check. The route changed three times on
  // 2026-09-16 — the entry point moved to the jurisdiction, a seventh step was
  // added — and the audit's hand-written table still described the old one.
  // G1 reported PASS throughout, because all it asked was whether six named
  // files existed. A guard pinned to a number cannot notice that the number
  // stopped describing anything.
  //
  // So the route is now derived, and this checks the derivation against its
  // source rather than against a literal.
  const src = fs.readFileSync(path.join(ROOT, 'js/components/workflow-progress.js'), 'utf8');
  const declared = [...src.matchAll(/\{ num: (\d+), key: '([^']+)',\s*label: '([^']+)',\s*href: '([^']+)' \}/g)]
    .map((m) => ({ step: Number(m[1]), page: m[4] }));

  assert.ok(declared.length >= 6,
    `only ${declared.length} steps parsed out of the component; the STEPS table has `
    + 'changed shape and the audit is now reading a route that is not there');
  assert.deepStrictEqual(
    GUIDED_PATH.map((s) => ({ step: s.step, page: s.page })), declared,
    'the audit\'s route and the rail component disagree');

  // Non-vacuous: the derivation must actually have produced something, and the
  // numbering must be a route rather than an arbitrary set.
  assert.ok(GUIDED_PATH.length >= 6, `the guided path collapsed to ${GUIDED_PATH.length} steps`);
  GUIDED_PATH.forEach((s, i) => {
    assert.strictEqual(s.step, i + 1, `step ${i + 1} is numbered ${s.step}`);
    assert.ok(fs.existsSync(path.join(ROOT, s.page)),
      `step ${s.step} (${s.name}) points at ${s.page}, which does not exist`);
  });

  // The entry point is the one thing about this route that was deliberately
  // decided (#1620 §7 slice 1), so it is named rather than left implicit.
  assert.strictEqual(GUIDED_PATH[0].page, 'select-jurisdiction.html',
    'the guided path no longer starts at the jurisdiction');
});

test('G1 refuses to pass on a route that is empty, misordered or missing a page', () => {
  // Exercised directly, with routes the repo does not contain. Asserting these
  // against the real route would prove nothing — it is complete and correctly
  // ordered, so deleting a check inside the audit changes no output and a
  // guard written that way passes over its own removal. That is how the stale
  // six-step table survived: everything it asserted was true, about the wrong
  // thing.
  const allExist = () => true;
  const good = [
    { step: 1, page: 'a.html' }, { step: 2, page: 'b.html' }, { step: 3, page: 'c.html' },
  ];

  assert.strictEqual(evaluateGuidedPath(good, allExist).state, 'PASS',
    'a complete, ordered route does not pass');

  for (const empty of [[], null, undefined]) {
    const r = evaluateGuidedPath(empty, allExist);
    assert.strictEqual(r.state, 'OPEN',
      `an empty route reported ${r.state}; a parse that matches nothing has nothing to say`);
    assert.ok(/could not be read/.test(r.detail), `the empty-route detail does not explain: ${r.detail}`);
  }

  const misordered = [{ step: 1, page: 'a.html' }, { step: 3, page: 'c.html' }];
  assert.strictEqual(evaluateGuidedPath(misordered, allExist).state, 'OPEN',
    'a route numbered 1, 3 reported PASS');
  assert.ok(/numbered 1, 3/.test(evaluateGuidedPath(misordered, allExist).detail));

  const missing = evaluateGuidedPath(good, (p) => p !== 'b.html');
  assert.strictEqual(missing.state, 'OPEN', 'a route with a missing page reported PASS');
  assert.ok(/b\.html/.test(missing.detail), `the missing-page detail does not name it: ${missing.detail}`);

  // And the real item still says where it looked.
  const g1 = items.find((i) => i.id === 'G1');
  assert.ok(g1 && /STEPS/.test(g1.evidence),
    `G1 no longer says it reads the component: "${g1 && g1.evidence}"`);
});

test('no finish-line item regresses from PASS by a wiring change', () => {
  // #1755 split test:ci into ci:part-N groups. The O2 check resolved wiring
  // with ciScript.includes(), so all four §7 guards read as unwired and the
  // finish line went 12 pass -> 11 while every one of them was still running.
  // Nothing failed; the report just quietly got worse.
  //
  // The count is pinned so a wiring change cannot degrade it silently. Real
  // progress raises this number and the line is updated with it; that is a
  // deliberate edit, which is the point.
  const pass = items.filter((i) => i.state === 'PASS').length;
  assert.ok(pass >= 12,
    `${pass} finish-line items pass; it was 12 on 2026-09-19. Something regressed — `
    + 'check whether a guard stopped being REACHABLE from test:ci rather than stopped existing');

  // And the specific shape that caused it: no item may report a guard as
  // unwired when it is reachable from test:ci.
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
  const reach = new Set();
  const q = ['test:ci'];
  while (q.length) {
    const n = q.shift();
    if (reach.has(n) || !scripts[n]) continue;
    reach.add(n);
    for (const m of String(scripts[n]).matchAll(/npm run ([\w:.-]+)/g)) q.push(m[1]);
  }
  const falselyUnwired = items
    .filter((i) => i.state !== 'PASS' && /not in test:ci: (.+)/.test(i.detail || ''))
    .flatMap((i) => (i.detail.match(/not in test:ci: (.+)/) || [, ''])[1].split(', '))
    .filter((g) => reach.has(g.trim()));
  assert.deepEqual(falselyUnwired, [],
    `the finish line calls these unwired, but they are reachable from test:ci: ${falselyUnwired.join(', ')}`);
});

test('every correctness-floor guard is still wired into test:ci', () => {
  // A PASS here means "a test holds this". If the test leaves test:ci, the
  // claim becomes an assertion about the past.
  // "In test:ci" means reachable from it. The gates moved into a composed
  // `test:freshness` script, so a substring check reported test:derived-chain
  // and test:freshness-guard as dropped while they were still running.
  //
  // This resolver is deliberately NOT the one in finish-line.mjs. A test that
  // imported the audit's own reachability code would pass on a bug in it;
  // two independent walks of the same graph have to agree.
  const scripts = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts;
  const reachable = new Set();
  const queue = ['test:ci'];
  while (queue.length) {
    const name = queue.shift();
    if (reachable.has(name)) continue;
    reachable.add(name);
    for (const m of String(scripts[name] || '').matchAll(/npm run ([\w:.-]+)/g)) queue.push(m[1]);
  }
  const ci = { includes: (name) => reachable.has(name) };
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
