'use strict';
// The guided-path rail ticks a step only when the reader's saved project says
// it was completed. It used to tick every step before the current page when
// nothing was recorded, so a first visit to the Deal Calculator showed steps
// 1-5 done while the Recommendation page said none had run.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const pages = execSync('git ls-files "*.html"', { cwd: ROOT }).toString().split('\n').filter(Boolean)
  .filter((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('wf-step__label'));
assert(pages.length >= 10, `found the pages that carry a rail (${pages.length})`);

// 1. No page's HTML claims a step is done before any script has run.
for (const f of pages) {
  const doc = new JSDOM(fs.readFileSync(path.join(ROOT, f), 'utf8')).window.document;
  const claimed = [...doc.querySelectorAll('.wf-step[data-step]')].filter((el) => el.classList.contains('wf-step--done'));
  assert.equal(claimed.length, 0, `${f}: the rail's HTML marks no step done`);
  const deal = doc.querySelector('.wf-step[data-step="6"] .wf-step__label');
  if (deal) assert.equal(deal.textContent, 'Deal Calculator', `${f}: step 6 has one name`);
}

// 2. With nothing recorded, the script ticks nothing; with a recorded step, it
//    ticks exactly that step.
function rail(project) {
  const html = fs.readFileSync(path.join(ROOT, 'deal-calculator.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://127.0.0.1/deal-calculator.html', runScripts: 'outside-only' });
  dom.window.WorkflowState = { getActiveProject: () => project };
  dom.window.eval(fs.readFileSync(path.join(ROOT, 'js', 'components', 'workflow-progress.js'), 'utf8'));
  dom.window.WorkflowProgress.refreshSteps('dcWorkflowProgress', 6);
  const steps = [...dom.window.document.querySelectorAll('#dcWorkflowProgress .wf-step[data-step]')];
  assert.equal(steps.length, 7, 'the deal calculator rail has seven steps');
  return steps.filter((el) => el.classList.contains('wf-step--done')).map((el) => Number(el.dataset.step));
}
assert.deepEqual(rail(null), [], 'no project: no step is ticked');
assert.deepEqual(rail({}), [], 'an empty project: no step is ticked');
assert.deepEqual(rail({ jurisdiction: { completedAt: '2026-10-14T00:00:00Z' }, market: { completedAt: null } }), [1],
  'only the recorded step is ticked');

console.log('workflow-rail-truthful: PASS');
