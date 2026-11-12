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

// 3. The step the shared stylesheet labels "optional" is the Opportunity
//    Finder in the rail's own route table, so a reorder cannot move the label
//    onto a required step.
const theme = fs.readFileSync(path.join(ROOT, 'css', 'site-theme.css'), 'utf8');
const optional = /\.wf-step\[data-step="(\d)"\] \.wf-step__label::after\s*\{[^}]*content:\s*"optional"/.exec(theme);
assert(optional, 'the stylesheet marks one rail step optional');
const wp = fs.readFileSync(path.join(ROOT, 'js', 'components', 'workflow-progress.js'), 'utf8');
const stepRow = new RegExp('num: ' + optional[1] + ",\\s*key: '([a-z]+)'").exec(wp);
assert(stepRow, 'the optional step number exists in the route table');
assert.equal(stepRow[1], 'opportunity', 'the step marked optional is the statewide Opportunity Finder');

// 4. A page opened for a named place (?geoid=) sends every step to that place,
//    even when the reader saved another county; the picker stays plain, and a
//    value that is not a Colorado GEOID never reaches an href.
function railHrefs(search, project) {
  const html = fs.readFileSync(path.join(ROOT, 'market-analysis.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://127.0.0.1/market-analysis.html' + search, runScripts: 'outside-only' });
  dom.window.WorkflowState = { getActiveProject: () => project };
  dom.window.eval(wp);
  dom.window.WorkflowProgress.refreshSteps('maWorkflowProgress', 4);
  return [...dom.window.document.querySelectorAll('a.wf-step[href]')].map((a) => a.getAttribute('href'));
}
const savedMesa = { jurisdiction: { geoType: 'county', geoid: '08077', countyFips: '08077' } };
const carried = railHrefs('?geoid=08031', savedMesa);
assert(carried.length >= 5, `the market analysis rail has its step links (${carried.length})`);
carried.forEach((h) => {
  if (/^select-jurisdiction\.html/.test(h)) assert(!/geoid=/.test(h), 'the picker link stays plain');
  else assert(/[?&]geoid=08031(&|#|$)/.test(h) && !/08077/.test(h), `${h} carries the page's place, not the saved county`);
});
assert(railHrefs('?fips=0828745&geoType=cdp', savedMesa).some((h) => /deal-calculator\.html\?geoType=cdp&geoid=0828745$/.test(h)),
  'a town or CDP link keeps its geography type');
assert(railHrefs('', savedMesa).every((h) => !/geoid=/.test(h)), 'with no place in the link, the rail is unchanged');
assert(railHrefs('?geoid=%22%3E%3Cscript%3E', savedMesa).every((h) => !/geoid=|script/i.test(h)), 'a value that is not a GEOID is ignored');
assert(railHrefs('?geoid=08031&geoType=evil', savedMesa).every((h) => !/evil/.test(h)), 'an unknown geography type is dropped');

// 5. The Scenario Builder takes a ?geoid= link without a geoType (the hub pages
//    and this rail send those) instead of falling back to the saved place.
const sb = fs.readFileSync(path.join(ROOT, 'hna-scenario-builder.html'), 'utf8');
assert(/var requestedGeoid = urlParams\.get\('geoid'\) \|\| urlParams\.get\('fips'\);\s*if \(!requestedGeoid\) return false;/.test(sb),
  'the Scenario Builder no longer requires geoType in the link');
assert(/requestedGeoType = geoIndex\[requestedGeoid\]\.type/.test(sb), 'it takes the type from its own geography list');

console.log('workflow-rail-truthful: PASS');
