'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const rail = require('../js/hna/section-rail.js');

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

function domFrom(bodyHtml) {
  return new JSDOM('<!doctype html><html><body>' + bodyHtml + '</body></html>').window.document;
}

console.log('hna-section-rail');

run('a heading with an embedded methodology tooltip yields a short label', () => {
  // The real shape: ~8 headings on the page nest their disclosure inside the
  // <h2>, so raw textContent runs to hundreds of characters.
  const doc = domFrom(
    '<main><section id="s1"><h2>Housing stock by structure type' +
    '<details class="hna-cat-tt"><summary>ℹ️ Methodology</summary>' +
    'What it measures: Distribution of housing units by structure type from ACS DP04, ' +
    'which is a long paragraph nobody wants in a navigation rail.</details></h2></section></main>'
  );
  const entries = rail.collect(doc);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].label, 'Housing stock by structure type');
  assert.ok(entries[0].label.length <= rail.LABEL_MAX);
});

run('labels never exceed the rail width', () => {
  const doc = domFrom(
    '<main><section id="s1"><h2>' + 'A very long heading that runs on and on '.repeat(4) + '</h2></section></main>'
  );
  const entries = rail.collect(doc);
  assert.ok(entries[0].label.length <= rail.LABEL_MAX, 'got ' + entries[0].label.length);
  assert.match(entries[0].label, /…$/, 'over-long labels are elided, not clipped mid-render');
});

run('entries anchor to the enclosing section, not the bare heading', () => {
  const doc = domFrom('<main><section id="prop123-section"><h2>Prop 123 compliance</h2></section></main>');
  const entries = rail.collect(doc);
  assert.equal(entries[0].id, 'prop123-section');
});

run('a heading with no section still gets a stable anchor', () => {
  const doc = domFrom('<main><h2>Orphan heading</h2></main>');
  const entries = rail.collect(doc);
  assert.ok(entries[0].id, 'an id was assigned');
  assert.ok(doc.getElementById(entries[0].id), 'the id resolves in the document');
});

run('hidden sections are not offered as destinations', () => {
  const doc = domFrom(
    '<main><section id="a"><h2>Visible section</h2></section>' +
    '<section id="b" hidden><h2>Hidden section</h2></section></main>'
  );
  const labels = rail.collect(doc).map((e) => e.label);
  assert.deepEqual(labels, ['Visible section']);
});

run('duplicate ids are not emitted twice', () => {
  const doc = domFrom('<main><section id="dup"><h2>First</h2><h2>Second</h2></section></main>');
  const entries = rail.collect(doc);
  assert.equal(entries.length, 1, 'two headings in one section produce one entry');
});

run('the rail is a labelled nav landmark with real links', () => {
  const doc = domFrom('<main><section id="a"><h2>Alpha</h2></section><section id="b"><h2>Beta</h2></section></main>');
  const nav = rail.build(doc, rail.collect(doc));
  assert.equal(nav.tagName, 'NAV');
  assert.equal(nav.getAttribute('aria-label'), 'Contents');
  const links = nav.querySelectorAll('a.hna-rail__link');
  assert.equal(links.length, 2);
  assert.equal(links[0].getAttribute('href'), '#a');
  assert.equal(links[0].textContent, 'Alpha');
  const toggle = nav.querySelector('.hna-rail__toggle');
  assert.equal(toggle.getAttribute('aria-controls'), 'hnaContentsRailList');
  assert.equal(nav.querySelector('.hna-rail__list').id, 'hnaContentsRailList');
});

run('labels are set as text, so heading markup cannot inject', () => {
  const doc = domFrom('<main><section id="x"><h2>&lt;img src=x onerror=alert(1)&gt;Safe</h2></section></main>');
  const nav = rail.build(doc, rail.collect(doc));
  assert.equal(nav.querySelectorAll('img').length, 0, 'no element is created from heading text');
});

run('the real page carries enough sections to warrant a rail', () => {
  const html = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
  const h2s = (html.match(/<h2\b/g) || []).length;
  assert.ok(h2s >= rail.MIN_SECTIONS,
    'the page has ' + h2s + ' h2 headings, at or above the ' + rail.MIN_SECTIONS + ' threshold');
});

run('the page loads the rail script and styles it', () => {
  const html = fs.readFileSync(path.join(ROOT, 'housing-needs-assessment.html'), 'utf8');
  assert.ok(html.includes('js/hna/section-rail.js'), 'script tag present');
  const css = fs.readFileSync(path.join(ROOT, 'css/pages/housing-needs-assessment.css'), 'utf8');
  assert.ok(css.includes('.hna-rail'), 'rail styles present');
  assert.ok(css.includes('@media print'), 'rail is excluded from the printed report');
  assert.ok(css.includes('scroll-margin-top'),
    'anchors clear the sticky header');
});

run('the rail owns a grid track instead of floating over the content', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'css/pages/housing-needs-assessment.css'), 'utf8');
  // Strip comments: the notes explaining what this replaced quote the old
  // declarations verbatim, and would otherwise satisfy the very checks that
  // exist to prove they are gone.
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');

  // The rail used to be position:fixed at left: max(.75rem, 50vw - 46rem),
  // which put it outside layout entirely: content had to be padded out of its
  // way, and the two pieces of viewport arithmetic had to agree. Below ~1712px
  // they did not -- at 1440px the rail spanned 12-252px while the centred
  // 1240px main column started at 100px.
  const base = css.slice(css.indexOf('.hna-rail {'), css.indexOf('.hna-rail__toggle'));
  assert.ok(/position:\s*sticky/.test(base),
    'the rail is sticky inside its own column, not fixed over the page');
  assert.ok(!/left:\s*max\(/.test(base),
    'the rail no longer positions itself with viewport arithmetic');

  // The dodge this replaced. If it comes back, so has the overlap it hid.
  assert.ok(!/padding-inline:\s*11rem/.test(css),
    'the .hna-view-switcher padding dodge is gone — a grid track makes it unnecessary');

  assert.ok(/\.hna-shell\[data-has-rail="true"\]\s*\{[^}]*display:\s*grid/.test(css),
    'the shell is a grid when a rail is present');

  // A grid item's default min-width is auto, so a bare `1fr` content track lets
  // one wide table or chart push the column past the viewport and reintroduce
  // horizontal scrolling — which test:mobile-overflow-css-rules-present exists to stop.
  const grid = css.slice(css.indexOf('.hna-shell[data-has-rail="true"]'));
  assert.ok(/grid-template-columns:[^;]*minmax\(\s*0\s*,/.test(grid),
    'the content track uses minmax(0, …) so wide content cannot widen the page');

  // Below the width where a 15rem column fits, the corner button returns.
  const small = css.slice(css.indexOf('@media (max-width: 1100px)'));
  assert.ok(/position:\s*fixed/.test(small.slice(0, 600)),
    'under 1101px the rail reverts to the fixed corner button');
});

run('the shell is built before the renderers populate main', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/hna/section-rail.js'), 'utf8');
  assert.ok(/function ensureShell/.test(src), 'ensureShell exists');
  // Reparenting a <main> that already holds initialised Leaflet maps and charts
  // re-runs layout on all of them. The shell must be created while main is
  // still the empty markup shipped in the HTML.
  const boot = src.slice(src.indexOf("if (typeof document !== 'undefined')"));
  const shellAt = boot.indexOf('ensureShell(document)');
  const railAt = boot.indexOf('setTimeout(init');
  assert.ok(shellAt !== -1 && railAt !== -1 && shellAt < railAt,
    'ensureShell runs synchronously on DOMContentLoaded, before the delayed rail build');
});

if (failures) { console.error('hna-section-rail: FAIL'); process.exitCode = 1; }
else console.log('hna-section-rail: PASS');
