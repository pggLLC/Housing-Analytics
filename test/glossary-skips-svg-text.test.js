'use strict';

// Glossary decoration never reaches inside an <svg>.
//
// Found 2026-10-09: chart labels are SVG <text>, and SVG does not render
// HTML children. js/glossary.js wrapped "LOI" in the LIHTC equity history
// chart's x-axis title with its tooltip markup, and the whole title rendered
// as nothing. js/components/inline-glossary.js would do the same with
// "LIHTC". Both scripts must leave SVG text alone and give the definition to
// the first use outside the chart instead.
//
// Runs both production scripts against data/glossary.json. Each section puts
// the SVG use first and a plain-text use after it, so the plain use being
// defined proves the scan ran (and skipped the SVG), not that it did nothing.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const GLOSSARY = JSON.parse(read('data/glossary.json'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); }
  catch (e) { failures += 1; console.log('  ✗ ' + name + ' — ' + e.message); }
}

const SVG_TITLE = 'Quarter (national average of syndicator LOI pricing)';
const PAGE = `<!doctype html><html><head></head><body><main class="js-glossary-auto">
  <section id="chart">
    <div class="chart-card"><svg id="chartSvg" width="400" height="100" viewBox="0 0 400 100" role="img" aria-label="chart">
      <g data-axis="x"><text id="svgTitle" x="10" y="90">${SVG_TITLE}</text></g>
      <text id="svgLihtc" x="10" y="20">LIHTC equity</text>
    </svg></div>
    <p id="afterLoi">Pricing comes from each syndicator LOI.</p>
    <p id="afterLihtc">LIHTC equity is priced per credit dollar.</p>
  </section>
</main></body></html>`;

function makeDom() {
  const dom = new JSDOM(PAGE, { url: 'http://localhost/article-pricing.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = (url) => Promise.resolve(/glossary\.json$/.test(String(url))
    ? { ok: true, json: () => Promise.resolve(GLOSSARY) }
    : { ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
  w.console.log = w.console.warn = w.console.error = w.console.info = () => {};
  // jsdom lays nothing out, so every element reports no client rects and
  // js/glossary.js would treat the whole page as hidden. Give everything a box.
  w.Element.prototype.getClientRects = function () { return [{ width: 1, height: 1 }]; };
  return dom;
}

const svgUntouched = (doc) => {
  const title = doc.getElementById('svgTitle');
  const lihtc = doc.getElementById('svgLihtc');
  return title.children.length === 0 && title.textContent === SVG_TITLE &&
    lihtc.children.length === 0 && lihtc.textContent === 'LIHTC equity';
};

(async () => {
  console.log('\nGlossary decoration never reaches inside an <svg>');
  for (const t of ['LOI', 'LIHTC']) assert(GLOSSARY.terms.some((x) => x.term === t), t + ' is not in data/glossary.json');

  await test('js/glossary.js skips SVG text and defines the next plain-text use', async () => {
    const dom = makeDom();
    const doc = dom.window.document;
    dom.window.eval(read('js/glossary.js'));
    await wait(700);
    assert(doc.querySelector('#afterLoi .gl-tooltip-trigger, #afterLihtc .gl-tooltip-trigger'),
      'no plain-text term was defined; the sweep did not run');
    assert(svgUntouched(doc), 'SVG text was wrapped: ' + doc.getElementById('svgTitle').innerHTML);
  });

  await test('js/components/inline-glossary.js skips SVG text and defines the next plain-text use', async () => {
    const dom = makeDom();
    const doc = dom.window.document;
    dom.window.eval(read('js/components/inline-glossary.js'));
    await wait(50);
    assert(doc.querySelector('#afterLihtc abbr[data-glossary="LIHTC"]'),
      'the plain-text LIHTC was not defined; the sweep did not run or went to the SVG');
    assert(svgUntouched(doc), 'SVG text was wrapped: ' + doc.getElementById('svgLihtc').innerHTML);
  });

  console.log(failures ? `\n${failures} failure(s)` : '\nAll checks passed ✅');
  process.exit(failures ? 1 : 0);
})();
