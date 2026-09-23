#!/usr/bin/env node
// test/hna-workflow-autosave.test.js
//
// The HNA step completes when the page has been read, on evidence: the
// headline stats have rendered real values for the selected geography. It
// must NOT complete on placeholders, must save once per geography, again when
// the geography changes, and on the way out through a next-step link.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'hna', 'hna-workflow-autosave.js'), 'utf8');

function page() {
  const dom = new JSDOM(`<!doctype html><body>
    <span id="geoContextPill">Fruita (city) · Mesa County</span>
    <span id="statPop">—</span><span id="statRent">—</span><span id="statRentBurden">Loading</span>
    <a id="next" href="deal-calculator.html?fips=0828745">Deal Calculator</a>
    <a id="other" href="about.html">About</a>
  </body>`, { url: 'http://127.0.0.1/housing-needs-assessment.html', runScripts: 'outside-only' });
  dom.window.eval(src);
  const calls = [];
  const api = dom.window.HnaWorkflowAutosave.init({ document: dom.window.document, save: (reason) => { calls.push(reason); return true; } });
  const set = (id, v) => { dom.window.document.getElementById(id).textContent = v; };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { dom, api, calls, set, tick };
}

let failures = 0;
async function run(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

(async () => {
  console.log('hna-workflow-autosave');

  await run('placeholders never complete the step', async () => {
    const p = page();
    await p.tick();
    assert.deepEqual(p.calls, [], 'no save while the stats read — / Loading');
    assert.equal(p.api.ready(), false);
  });

  await run('rendered stats complete the step once, not on every repaint', async () => {
    const p = page();
    p.set('statPop', '13,395'); p.set('statRent', '$1,472'); p.set('statRentBurden', '43.6%');
    await p.tick();
    assert.deepEqual(p.calls, ['render'], 'saved once when all three stats rendered');
    p.set('statRentBurden', '43.6%'); p.set('statPop', '13,396');
    await p.tick();
    assert.deepEqual(p.calls, ['render'], 'a repaint for the same geography does not save again');
  });

  await run('a new geography saves again', async () => {
    const p = page();
    p.set('statPop', '13,395'); p.set('statRent', '$1,472'); p.set('statRentBurden', '43.6%');
    await p.tick();
    p.set('geoContextPill', 'Palisade (town) · Mesa County');
    await p.tick();
    assert.deepEqual(p.calls, ['render', 'render'], 'geography change re-saves');
  });

  await run('leaving through a next-step link saves if the stats are ready — never on placeholders', async () => {
    const p = page();
    p.dom.window.document.getElementById('next').addEventListener('click', (e) => e.preventDefault());
    p.dom.window.document.getElementById('next').click();
    assert.deepEqual(p.calls, [], 'placeholders: no save on click');
    p.set('statPop', '13,395'); p.set('statRent', '$1,472'); p.set('statRentBurden', '43.6%');
    p.dom.window.document.getElementById('next').click();   // synchronous, before the observer fires
    assert.equal(p.calls[0], 'next-step', 'the click saves before navigation');
    p.dom.window.document.getElementById('other').addEventListener('click', (e) => e.preventDefault());
    const before = p.calls.length;
    p.dom.window.document.getElementById('other').click();
    assert.equal(p.calls.length, before, 'a non-workflow link does not save');
  });

  await run('the canonical page loads the module and wires it to saveHnaToProject', async () => {
    const html = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
    assert.match(html, /<script defer src="js\/hna\/hna-workflow-autosave\.js"><\/script>/);
    assert.match(html, /HnaWorkflowAutosave\.init\(\{[\s\S]{0,400}saveHnaToProject\(\)/);
  });

  if (failures) { console.error('hna-workflow-autosave: FAIL'); process.exitCode = 1; }
  else console.log('hna-workflow-autosave: PASS');
})();
