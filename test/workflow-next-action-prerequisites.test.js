#!/usr/bin/env node
// test/workflow-next-action-prerequisites.test.js
//
// The workflow banner warns only when a PREREQUISITE is missing (the
// jurisdiction). Skipped analyses (HNA, Market Analysis, Scenario Builder) are
// context the page can quote, never inputs it needs, so they are named in a
// quiet line under the page's own guidance — not an amber "Earlier Step
// Incomplete → Go to …" that sends a reader back through steps the site's own
// next-step links let them skip.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'components', 'workflow-next-action.js'), 'utf8');
const normalize = (t) => t.replace(/\s+/g, ' ').trim();

function render(page, completedSteps, opts = {}) {
  const dom = new JSDOM('<!doctype html><main><section class="hero"><h1>Page</h1></section></main>',
    { url: 'https://cohoanalytics.com/' + page, runScripts: 'outside-only' });
  dom.window.WorkflowState = { getProgress: () => ({ completedSteps }) };
  if (opts.jurisdictionInUrl) dom.window.JurisdictionUrlContext = { resolveSync: () => ({ geoid: '0828745' }) };
  dom.window.eval(src);
  dom.window.WorkflowNextAction.render();
  const el = dom.window.document.querySelector('#workflowNextAction');
  return { el, text: normalize(el.textContent), cls: el.className, html: el.innerHTML };
}

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

console.log('workflow-next-action-prerequisites');

run('deal calculator after the HNA, market and scenario skipped: guidance plus a quiet context line, no warning', () => {
  const r = render('deal-calculator.html', ['opportunity', 'jurisdiction', 'hsa']);
  assert.ok(!r.text.includes('Earlier Step Incomplete'), 'no amber warning: ' + r.text);
  assert.match(r.cls, /wf-next-action--current/);
  assert.match(r.text, /Model your capital stack/);
  assert.match(r.text, /Optional context not yet run: Market Analysis, Scenario Builder/);
  assert.match(r.html, /href="market-analysis\.html"/, 'the first skipped analysis is one click away');
  assert.match(r.text, /Results here do not depend on it/);
});

run('a missing jurisdiction is a real prerequisite and still warns', () => {
  const r = render('deal-calculator.html', ['opportunity']);
  assert.match(r.text, /Earlier Step Incomplete/);
  assert.match(r.text, /Select Jurisdiction hasn't been completed yet/);
  assert.match(r.cls, /wf-next-action--skipped/);
  assert.match(r.html, /href="select-jurisdiction\.html"/);
});

run('a jurisdiction in the URL counts as the prerequisite met', () => {
  const r = render('deal-calculator.html', [], { jurisdictionInUrl: true });
  assert.ok(!r.text.includes('Earlier Step Incomplete'), r.text);
  assert.match(r.text, /Optional context not yet run: Housing Needs Assessment, Market Analysis, Scenario Builder/);
});

run('nothing skipped: plain current-step guidance, no context line', () => {
  const r = render('hna-scenario-builder.html', ['opportunity', 'jurisdiction', 'hsa', 'market']);
  assert.ok(!r.text.includes('Optional context'), r.text);
  assert.ok(!r.text.includes('Earlier Step Incomplete'), r.text);
});

run('current step done: continue to the next one', () => {
  const r = render('housing-needs-assessment.html', ['opportunity', 'jurisdiction', 'hsa']);
  assert.match(r.text, /Step Complete/);
  assert.match(r.html, /href="market-analysis\.html"/);
});

if (failures) { console.error('workflow-next-action-prerequisites: FAIL'); process.exitCode = 1; }
else console.log('workflow-next-action-prerequisites: PASS');
