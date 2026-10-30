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
  assert.ok(!/wf-next-action--skipped/.test(r.cls), 'no amber warning: ' + r.text);
  assert.match(r.cls, /wf-next-action--current/);
  assert.match(r.text, /Model your capital stack/);
  assert.match(r.text, /Optional context not yet run: Market Analysis, Scenario Builder/);
  assert.match(r.html, /href="market-analysis\.html"/, 'the first skipped analysis is one click away');
  assert.match(r.text, /Results here do not depend on it/);
});

run('a missing jurisdiction is a real prerequisite and still warns', () => {
  // Pins the AGREEMENT, not the sentence (#1746): the banner must warn, and
  // it must offer the jurisdiction page. The wording was "Earlier Step
  // Incomplete / Select Jurisdiction hasn't been completed yet" until
  // 2026-09-23, when it became "Choose a jurisdiction first" — the site sends
  // readers straight here from the homepage, so it must not tell them they
  // skipped a step they were never shown. A rewording must stay green; losing
  // the warning or the link must not.
  const r = render('deal-calculator.html', ['opportunity']);
  assert.match(r.cls, /wf-next-action--skipped/, 'the prerequisite no longer warns');
  assert.match(r.text, /jurisdiction/i, 'the warning does not mention the jurisdiction');
  assert.match(r.html, /href="select-jurisdiction\.html/,
    'the warning does not offer the jurisdiction page');
});

run('a step that completes itself on read still asks for the missing jurisdiction first', () => {
  // The HNA chapters autosave 'hsa' as done the moment they render (#1833).
  // A first-time visitor with no jurisdiction saw "Step Complete → Continue
  // to Jurisdiction" on production (2026-09-25): a verdict on a step they had
  // not taken, pointing back to step 1 with no return trip.
  const r = render('hna-what-housing-exists.html', ['hsa']);
  assert.match(r.cls, /wf-next-action--skipped/, 'the missing jurisdiction must win over "current step done": ' + r.text);
  assert.ok(!/Step Complete/.test(r.text), 'must not announce completion to a visitor who has chosen nothing: ' + r.text);
  assert.match(r.html, /href="select-jurisdiction\.html\?next=hna-what-housing-exists\.html"/, 'the prompt must carry the reader back here');
});

run('the needs assessment asks for a place and names the statewide choice', () => {
  // Since #2536 the HNA computes nothing until a place is picked, so the old
  // "Showing statewide figures" banner described figures that were not there
  // (live check 2026-10-30). State of Colorado stays a choice in its picker.
  // The banner's wording rests on those two behaviours in the HNA controller:
  // if either goes, this branch is no longer true. (test/hna-assumption-defaults
  // drives the no-pick render itself.)
  const ctrl = fs.readFileSync(path.join(ROOT, 'js', 'hna', 'hna-controller.js'), 'utf8');
  assert.match(ctrl, /const nothingChosen = [^;]+;\s*if \(nothingChosen\) \{[\s\S]{0,400}?pick\.textContent = 'Pick a place'/,
    'the HNA no longer starts on "Pick a place" with no figures; revisit the banner branch');
  assert.match(ctrl, /opt\.textContent = 'State of Colorado'/,
    'the HNA picker no longer offers State of Colorado; revisit the banner branch');
  const r = render('hna-what-housing-exists.html', ['hsa']);
  assert.ok(!/Showing statewide figures/.test(r.text), r.text);
  assert.match(r.text, /State of Colorado/, r.text);
  assert.match(r.html, /href="select-jurisdiction\.html\?next=hna-what-housing-exists\.html"/, r.text);
});

run('the scenario builder, which opens empty, still asks for a jurisdiction', () => {
  const r = render('hna-scenario-builder.html', ['opportunity']);
  assert.ok(!/Showing statewide figures/.test(r.text), r.text);
  assert.match(r.text, /Choose a jurisdiction first/, r.text);
});

run('Select Jurisdiction gives one next step: the banner agrees with the page button', () => {
  // Codex review 2026-10-15: the banner said "Go on to Opportunity Finder"
  // while the page's main button said "Begin Housing Needs Assessment (step 3)"
  // and called step 2 optional. The optional finder is never the banner's next
  // step; whatever the page's own button names, the banner must name too.
  const page = fs.readFileSync(path.join(ROOT, 'select-jurisdiction.html'), 'utf8');
  const btn = normalize(((page.match(/id="sjContinueBtn"[^>]*>([\s\S]*?)<\/button>/) || [])[1] || ''));
  assert.ok(btn, 'could not read the Select Jurisdiction continue button');
  const r = render('select-jurisdiction.html', []);
  const link = (r.html.match(/<a [^>]*>([\s\S]*?)<\/a>/) || [])[1] || '';
  assert.ok(!/Opportunity Finder/.test(normalize(link)), 'the banner sends the reader to the optional finder: ' + r.text);
  const named = normalize(link).replace(/^(Go on to|Continue to)\s+/, '').replace(/\s*\u2192$/, '');
  assert.ok(named && btn.includes(named), `banner says "${normalize(link)}", page button says "${btn}"`);
});

run('the statewide Opportunity Finder never asks for a jurisdiction', () => {
  // Step 2 is untracked statewide discovery; "this page reads its numbers
  // from one Colorado community" would be false there.
  const r = render('lihtc-opportunity-finder.html', []);
  assert.ok(!/wf-next-action--skipped/.test(r.cls), 'must not prompt for a jurisdiction: ' + r.text);
  assert.ok(!/jurisdiction first/i.test(r.text), r.text);
  assert.match(r.html, /href="hna-what-housing-exists\.html"/, 'still offers the next step');
});

run('and it carries the reader back to the page they asked for', () => {
  // The homepage links into every guided-path page except step 1, so being
  // asked for a jurisdiction must not cost the reader their destination.
  const r = render('deal-calculator.html', ['opportunity']);
  assert.match(r.html, /href="select-jurisdiction\.html\?next=deal-calculator\.html"/,
    'the jurisdiction prompt drops the destination, stranding the reader at the top of the path');
});

run('a jurisdiction in the URL counts as the prerequisite met', () => {
  const r = render('deal-calculator.html', [], { jurisdictionInUrl: true });
  assert.ok(!/wf-next-action--skipped/.test(r.cls), r.text);
  assert.match(r.text, /Optional context not yet run: Housing Needs Assessment, Market Analysis, Scenario Builder/);
});

run('nothing skipped: plain current-step guidance, no context line', () => {
  const r = render('hna-scenario-builder.html', ['opportunity', 'jurisdiction', 'hsa', 'market']);
  assert.ok(!r.text.includes('Optional context'), r.text);
  assert.ok(!/wf-next-action--skipped/.test(r.cls), r.text);
});

run('current step done: continue to the next one', () => {
  const r = render('housing-needs-assessment.html', ['opportunity', 'jurisdiction', 'hsa']);
  assert.match(r.text, /Step Complete/);
  assert.match(r.html, /href="market-analysis\.html"/);
});

if (failures) { console.error('workflow-next-action-prerequisites: FAIL'); process.exitCode = 1; }
else console.log('workflow-next-action-prerequisites: PASS');
