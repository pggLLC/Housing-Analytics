'use strict';

// A page's glossary tooltips depend on its final content, not on when the
// glossary happened to sweep.
//
// Found 2026-09-28 while making the contrast audit deterministic:
// lihtc-opportunity-finder.html settled with its results table and summary
// line wrapped on roughly four loads in five, and plain on the fifth. Two
// timing races in js/glossary.js:
//
//   1. "Already wrapped in this section" was a map that outlived the markup.
//      A sweep that caught a renderer's first render marked AMI as wrapped;
//      the renderer then replaced the section and the new AMI stayed plain.
//   2. The observer ignored every record while a `mutating` flag was up, and
//      the flag stayed up until a setTimeout(0) after each sweep — so a page
//      render landing in that window was dropped, never swept.
//
// Runs the production js/glossary.js with data/glossary.json in jsdom.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const GLOSSARY = JSON.parse(read('data/glossary.json'));
const known = new Set(GLOSSARY.terms.map((t) => t.term));
for (const t of ['AMI', 'HUD', 'CHFA']) {
  assert.ok(known.has(t), `data/glossary.json no longer defines ${t}; pick another term for this test`);
}

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// The sweep is debounced 400 ms; allow two rounds.
const SETTLE = 1000;

function load() {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><main>
    <section id="results"><p>Loading…</p></section>
    <section id="late"></section>
  </main></body></html>`, { url: 'http://localhost/lihtc-opportunity-finder.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = (url) => Promise.resolve(/glossary\.json$/.test(String(url))
    ? { ok: true, json: () => Promise.resolve(GLOSSARY) }
    : { ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
  w.console.log = w.console.warn = w.console.error = w.console.info = () => {};
  w.eval(read('js/glossary.js'));
  return w;
}
const wrapped = (el, term) => !!el.querySelector(`.gl-tooltip-trigger[data-glossary-term="${term}"]`);

(async () => {
  await test('a section re-rendered after a sweep gets its definition back', async () => {
    const w = load();
    const doc = w.document;
    await wait(SETTLE);
    doc.getElementById('results').innerHTML = '<p>Rents are capped at 60% of AMI.</p>';
    await wait(SETTLE);
    assert.ok(wrapped(doc.getElementById('results'), 'AMI'), 'first render was not wrapped at all');
    // The renderer replaces its output, as the finder does on every sort and
    // filter, without calling CohoGlossary.forget().
    doc.getElementById('results').innerHTML = '<p>Sorted: capped at 60% of AMI.</p>';
    await wait(SETTLE);
    assert.ok(wrapped(doc.getElementById('results'), 'AMI'),
      'the re-rendered AMI stayed plain: "already wrapped" was remembered, not read from the DOM');
  });

  await test('a term is still wrapped once per section, not on every pass', async () => {
    const w = load();
    const doc = w.document;
    doc.getElementById('results').innerHTML = '<p>HUD sets it.</p><p>HUD again.</p>';
    await wait(SETTLE);
    doc.getElementById('results').appendChild(Object.assign(doc.createElement('p'), { textContent: 'And HUD a third time.' }));
    await wait(SETTLE);
    const n = doc.getElementById('results').querySelectorAll('.gl-tooltip-trigger[data-glossary-term="HUD"]').length;
    assert.strictEqual(n, 1, `HUD wrapped ${n} times in one section`);
  });

  await test('a page render landing just after a sweep is still swept', async () => {
    const w = load();
    const doc = w.document;
    // Render the moment the glossary's own insertion is observed — a
    // microtask after its sweep, inside the window the old flag covered.
    let rendered = false;
    new w.MutationObserver(() => {
      if (rendered || !doc.querySelector('.gl-tooltip-trigger')) return;
      rendered = true;
      doc.getElementById('late').innerHTML = '<p>CHFA reviews the application.</p>';
    }).observe(doc.body, { childList: true, subtree: true });
    doc.getElementById('results').innerHTML = '<p>Rents are capped at AMI.</p>';
    await wait(SETTLE * 2);
    assert.ok(rendered, 'the test never triggered its render (no sweep happened)');
    assert.ok(wrapped(doc.getElementById('late'), 'CHFA'),
      'content rendered right after a sweep was dropped by the observer');
  });

  console.log(failures ? `\n${failures} failure(s)` : '\nglossary-rerender: all checks passed');
  process.exit(failures ? 1 : 0);
})();
