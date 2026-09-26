'use strict';

// Market Analysis: every defined acronym gets its definition on a VISIBLE use.
//
// Found 2026-09-26: LODES appears on market-analysis.html in the map-layer
// labels ("Employment centers (LODES)", "Commuting flows (LODES)", ...) with
// no definition. The page is wired to js/glossary.js (js/navigation.js
// injects it; it sweeps <main>) and data/glossary.json defines LODES, but
// the one definition per section went to the first use in document order —
// a closed "Commuting" method tab. The same happened to LIHTC, whose
// definition went to a collapsed map legend, leaving 29 visible uses in the
// PMA tool undefined. js/glossary.js now skips text that is not rendered.
//
// The browser measurement (market-analysis.html, before -> after: visible
// LODES definitions in the PMA tool 0 -> 1, LIHTC 0 -> 1; housing-needs-
// assessment.html gains definitions and loses none) was run with Playwright
// and is recorded in the commit. This file checks the wiring and runs
// glossary.js in jsdom against the page's own markup pattern.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'market-analysis.html'), 'utf8');
const glossarySrc = fs.readFileSync(path.join(ROOT, 'js/glossary.js'), 'utf8');
const navSrc = fs.readFileSync(path.join(ROOT, 'js/navigation.js'), 'utf8');
const glossaryData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/glossary.json'), 'utf8'));

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

// The acronyms the page uses in visible copy that the glossary defines.
const termNames = new Set(glossaryData.terms.map((t) => t.term));
const visibleCopy = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');

async function sweep(bodyHtml) {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(glossaryData) });
  w.eval(glossarySrc);
  await new Promise((r) => setTimeout(r, 0));
  w.CohoGlossary.rescan();
  await new Promise((r) => setTimeout(r, 20));
  return w.document;
}

(async () => {
  console.log('\nmarket-analysis.html: acronyms are defined where a reader sees them');

  await test('the page is reached by the glossary: navigation injects glossary.js, and there is a <main> for it to sweep', () => {
    assert(/<script[^>]+src="js\/navigation\.js"/.test(html), 'market-analysis.html no longer loads js/navigation.js');
    assert(/gs\.src = relToRoot\(\) \+ 'js\/glossary\.js'/.test(navSrc), 'navigation.js no longer injects glossary.js');
    assert(/<main id="main-content"/.test(html), 'market-analysis.html has no <main> for glossary.js to sweep');
    assert(!/data-inline-glossary="off"/.test(html), 'the page opts out of the glossary');
  });

  await test('LODES, used on the page, is defined in data/glossary.json (and the scan found terms to check)', () => {
    const used = [...termNames].filter((t) => /^[A-Z0-9]{2,}$/.test(t) && new RegExp('\\b' + t + '\\b').test(visibleCopy));
    assert(used.length >= 10, 'only ' + used.length + ' glossary acronyms found in the page copy; the scan is broken');
    assert(used.includes('LODES'), 'LODES is used on the page but has no data/glossary.json entry');
  });

  await test('the first VISIBLE use in a section gets the definition, not a use in a hidden panel', async () => {
    // The page's own pattern: a hidden method tab ahead of the map-layer labels.
    const doc = await sweep(`<main><section id="maPmaTool">
      <div id="pmaMethodPanel-commuting" role="tabpanel" hidden><p>displays LEHD/LODES commute context</p></div>
      <div class="pma-legend-body" hidden>LIHTC projects</div>
      <label><input type="checkbox"> Employment centers <small>(LODES)</small></label>
      <p>Existing LIHTC supply</p>
    </section></main>`);
    const defined = (sel) => [...doc.querySelectorAll(sel + ' .gl-tooltip-trigger')].map((e) => e.getAttribute('data-glossary-term'));
    assert.deepStrictEqual(defined('#pmaMethodPanel-commuting'), [], 'the hidden tab took the definition');
    assert.deepStrictEqual(defined('.pma-legend-body'), [], 'the collapsed legend took the definition');
    assert.deepStrictEqual(defined('label'), ['LODES'], 'the visible LODES label is undefined');
    assert.deepStrictEqual(defined('section > p'), ['LIHTC'], 'the visible LIHTC use is undefined');
  });

  await test('opening a hidden panel re-sweeps it', () => {
    assert(/attributeFilter: \['hidden', 'open'\]/.test(glossarySrc),
      'the observer no longer watches hidden/open, so a revealed panel is never swept');
    assert(/records\[i\]\.type === 'attributes'/.test(glossarySrc), 'attribute mutations do not schedule a sweep');
  });

  console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed ✅');
  process.exit(failures ? 1 : 0);
})();
