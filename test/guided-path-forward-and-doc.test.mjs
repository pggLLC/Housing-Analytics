// #1837 — three things the guided path must keep true:
//   F3  every current-step banner from step 1 to 6 offers a FORWARD link to
//       the next step (the only link used to point back to optional context);
//   F4  the jurisdiction picker's button names the step it lands on (3) and
//       offers step 2 beside it instead of silently skipping it;
//   F6  docs/FINISH-LINE.md lists the same steps, in the same order, with the
//       same pages as the rail — pinned to the rail, never retyped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const railSrc = read('js/components/workflow-progress.js');
const bannerSrc = read('js/components/workflow-next-action.js');

function rail() {
  const dom = new JSDOM('<!doctype html><main></main>', { url: 'https://cohoanalytics.com/index.html', runScripts: 'outside-only' });
  dom.window.eval(railSrc);
  return dom.window.WorkflowProgress.STEPS;
}
function banner(page, completedSteps) {
  const dom = new JSDOM('<!doctype html><main><section class="hero"><h1>Page</h1></section></main>',
    { url: 'https://cohoanalytics.com/' + page, runScripts: 'outside-only' });
  dom.window.WorkflowState = { getProgress: () => ({ completedSteps }) };
  dom.window.eval(railSrc);
  dom.window.eval(bannerSrc);
  dom.window.WorkflowNextAction.render();
  const el = dom.window.document.querySelector('#workflowNextAction');
  return { cls: el.className, html: el.innerHTML, cta: el.querySelector('.wf-next-action__cta') };
}

console.log('guided-path-forward-and-doc (#1837)');
const STEPS = rail();
assert.equal(STEPS.length, 7, 'the rail ships seven steps');

// F3 — forward link on every current-step banner except the last.
const priorsDone = (i) => STEPS.slice(0, i).map((s) => s.key);
for (let i = 0; i < STEPS.length; i++) {
  const step = STEPS[i];
  const r = banner(step.href, priorsDone(i));
  // Untracked steps (Opportunity Finder) count as done and render "Step
  // Complete"; every other step renders the current-step state. Both must
  // carry a forward link.
  // The last step, with everything before it done, renders the all-done
  // state; it is the one banner that must NOT link forward.
  const expectCls = i < STEPS.length - 1 ? /wf-next-action--(current|next)/ : /wf-next-action--(current|complete)/;
  assert.match(r.cls, expectCls, step.href + ' renders the expected state; got ' + r.cls);
  if (i < STEPS.length - 1) {
    assert.ok(r.cta, step.href + ' (step ' + step.num + ') offers a forward link');
    assert.equal(r.cta.getAttribute('href'), STEPS[i + 1].href, step.href + ' forward link goes to the NEXT step, not back');
    assert.match(r.cta.textContent, /Go on to |Continue to /, 'forward link is worded as an offer');
  } else {
    assert.equal(r.cta, null, 'the last step offers no forward link');
  }
}
console.log('  ✓ every step 1-6 banner links forward to the next step; step 7 does not');

// F4 — the picker names step 3 and offers step 2.
const picker = read('select-jurisdiction.html');
const btn = picker.match(/<button[^>]*id="sjContinueBtn"[^>]*>([\s\S]*?)<\/button>/);
assert.ok(btn, 'picker continue button exists');
assert.match(btn[1], /\(step 3\)/, 'the button says which step it lands on');
assert.match(picker, /id="sjStepTwoNote"[\s\S]*?href="lihtc-opportunity-finder\.html"/, 'step 2 is offered beside the button');
assert.match(picker, /not required/, 'the note says step 2 is optional');
assert.equal(STEPS[2].href, 'hna-what-housing-exists.html', 'step 3 is still the needs assessment chapter the button lands on');
console.log('  ✓ picker button names step 3 and offers step 2');

// F6 — the doc table equals the rail.
const doc = read('docs/FINISH-LINE.md');
const table = doc.match(/\| # \| Step \| Page \|\n\|---\|------\|------\|\n((?:\|.*\|\n)+)/);
assert.ok(table, 'FINISH-LINE.md has the steps table');
const docRows = table[1].trim().split('\n').map((l) => l.split('|').map((c) => c.trim()).filter(Boolean));
// JSON on both sides: STEPS objects come from the jsdom realm, whose
// prototypes strict deep-equality rejects even when the data is identical.
assert.equal(
  JSON.stringify(docRows.map(([n, label, page]) => ({ num: Number(n), label, href: page.replace(/`/g, '') }))),
  JSON.stringify(STEPS.map((s) => ({ num: s.num, label: s.label, href: s.href }))),
  'FINISH-LINE.md steps table matches the rail, row for row'
);
assert.ok(!/Six steps/.test(doc), 'the doc no longer says six steps');
console.log('  ✓ FINISH-LINE.md steps table matches the rail');
console.log('\nAll tests passed');
