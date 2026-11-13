'use strict';

// The glossary pop-up is a list people look a word up in.
//
// Found 2026-11-13: 184 entries were listed in the order they had been added
// to data/glossary.json (LIHTC, QCT, DDA ... Section 223(f)), and the search
// box was hidden below 640px. On a phone that left an unsearchable list about
// fifty screens long.
//
//   1. The list reads A to Z whatever order the file is in.
//   2. The search box is present at every width.
//   3. An entry marked `list: false` (a Census table code, a data series ID)
//      stays out of the browsing list but is still found by search.
//   4. Another spelling of a term (`aliases`) finds its entry, and leads.
//
// Runs the production js/glossary.js with data/glossary.json in jsdom.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const GLOSSARY = JSON.parse(read('data/glossary.json'));

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function load(glossary) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main><p>Nothing here.</p></main></body></html>',
    { url: 'http://localhost/index.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = (url) => Promise.resolve(/glossary\.json$/.test(String(url))
    ? { ok: true, json: () => Promise.resolve(glossary || GLOSSARY) }
    : { ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
  w.console.log = w.console.warn = w.console.error = w.console.info = () => {};
  w.eval(read('js/glossary.js'));
  return w;
}
async function open(w, term) {
  w.CohoGlossary.open(term);
  await wait(50);
  return w.document;
}
const shown = (doc) => Array.from(doc.querySelectorAll('#glossaryBody .gl-acronym')).map((el) => el.textContent);
function search(w, text) {
  const input = w.document.getElementById('glossarySearch');
  input.value = text;
  input.dispatchEvent(new w.Event('input', { bubbles: true }));
}
const key = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

(async () => {
  await test('the list reads A to Z, not in file order', async () => {
    const w = load();
    const names = shown(await open(w));
    assert.ok(names.length > 100, `only ${names.length} entries listed`);
    for (let i = 1; i < names.length; i++) {
      const order = key(names[i - 1]).localeCompare(key(names[i]), 'en', { numeric: true });
      assert.ok(order <= 0, `"${names[i - 1]}" is listed before "${names[i]}"`);
    }
    // The file itself opens on LIHTC; the list must not.
    assert.notStrictEqual(names[0], GLOSSARY.terms[0].term);
  });

  await test('the search box is in the pop-up and no width hides it', async () => {
    const w = load();
    const doc = await open(w);
    assert.ok(doc.getElementById('glossarySearch'), 'no search box in the pop-up');
    const css = doc.getElementById('glossary-injected-styles').textContent;
    assert.ok(!/\.gl-search-wrap\{[^}]*display:none/.test(css), 'a style rule hides the search box');
    assert.ok(/@media\(max-width:640px\)\{[^@]*\.gl-search-wrap\{[^}]*flex:1 0 100%/.test(css),
      'on a phone the search box should take its own row');
  });

  await test('codes stay out of the browsing list but search finds them', async () => {
    const hidden = GLOSSARY.terms.filter((t) => t.list === false).map((t) => t.term);
    assert.ok(hidden.includes('B25064'), 'B25064 is expected to be marked list: false');
    const w = load();
    const doc = await open(w);
    const names = shown(doc);
    for (const h of hidden) assert.ok(!names.includes(h), `${h} is in the browsing list`);
    assert.strictEqual(names.length, GLOSSARY.terms.length - hidden.length);
    search(w, 'B25064');
    assert.strictEqual(shown(doc)[0], 'B25064');
    // Every hidden entry still has its tooltip text.
    for (const t of GLOSSARY.terms) if (t.list === false) assert.ok(t.definition, `${t.term} lost its definition`);
  });

  await test('a search still opens on the term named exactly', async () => {
    const w = load();
    const doc = await open(w);
    search(w, 'ami');
    const names = shown(doc);
    assert.strictEqual(names[0], 'AMI');
    assert.ok(names.length > 1, 'definitions that mention AMI should follow');
  });

  await test('another spelling finds the entry and leads the results', async () => {
    const copy = JSON.parse(JSON.stringify(GLOSSARY));
    const doh = copy.terms.find((t) => t.term === 'DOH');
    assert.ok(doh, 'data/glossary.json no longer defines DOH; pick another term for this test');
    doh.aliases = ['Division of Housing spelling test', 'ZZDOH'];
    const w = load(copy);
    const doc = await open(w);
    search(w, 'zzdoh');
    assert.deepStrictEqual(shown(doc), ['DOH']);
    assert.ok(/Also written .*ZZDOH/.test(doc.querySelector('#glossaryBody .gl-also').textContent));
    // A link to the other spelling opens the same entry.
    w.CohoGlossary.close();
    const again = await open(w, 'ZZDOH');
    assert.strictEqual(shown(again)[0], 'DOH');
  });

  await test('a search with no match says so', async () => {
    const w = load();
    const doc = await open(w);
    search(w, 'qqqzzz');
    assert.ok(/No terms match/.test(doc.getElementById('glossaryBody').textContent));
  });

  if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
  console.log('\nglossary list: all passed');
  process.exit(0);
})();
