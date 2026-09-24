#!/usr/bin/env node
// test/working-paper-download.test.js
//
// The working paper's PDF / Word download. #1804 shipped this inline in the
// page and a merge that treated the page as a regenerated artifact silently
// dropped it — the PR merged as a title with no code, found on production
// 2026-09-23. This guard pins that the page carries the controls and loads the
// module, and drives the real module: PDF prints; Word hands the article — and
// nothing but the article — to a .doc download.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(ROOT, 'working-paper.html'), 'utf8');
const src = fs.readFileSync(path.join(ROOT, 'js', 'components', 'working-paper-download.js'), 'utf8');

let failures = 0;
function run(name, fn) {
  try { fn(); console.log('  ✓ ' + name); }
  catch (err) { failures += 1; console.error('  ✗ ' + name + '\n    ' + err.message); }
}

console.log('working-paper-download');

run('the page carries both controls, loads the module, and hides the controls in print', () => {
  assert.match(page, /<script defer src="js\/components\/working-paper-download\.js"><\/script>/, 'module is loaded');
  assert.match(page, /<button type="button" id="wpDownloadPdf" class="wp-action">Download PDF<\/button>/);
  assert.match(page, /<button type="button" id="wpDownloadWord" class="wp-action">Download Word \(\.doc\)<\/button>/);
  assert.match(page, /@media print \{ \.wp-actions \{ display: none !important; \} \}/, 'download chrome never prints');
  const article = page.indexOf('<article class="wp">');
  const toolbar = page.indexOf('class="wp-actions"');
  assert.ok(article > -1 && toolbar > article, 'the toolbar sits inside the article header');
});

function fixture() {
  const dom = new JSDOM(`<!doctype html><html><head><title>T</title></head><body>
    <article class="wp"><header><h1>Instrumenting Housing Need</h1>
      <div class="wp-actions"><button type="button" id="wpDownloadPdf">Download PDF</button><button type="button" id="wpDownloadWord">Download Word (.doc)</button></div>
    </header>
    <section><h2>1. Findings</h2><p>The tractable count is <span data-figure="x">63</span>.</p><button id="inArticle">toggle</button><script>window.leak = 1;</script></section>
    </article></body></html>`, { url: 'https://cohoanalytics.com/working-paper.html', runScripts: 'outside-only' });
  const w = dom.window;
  w.print = () => { w.__printed = (w.__printed || 0) + 1; };
  const blobs = [];
  w.URL.createObjectURL = (b) => { blobs.push(b); return 'blob:fake'; };
  w.URL.revokeObjectURL = () => {};
  const clicks = [];
  const origCreate = w.document.createElement.bind(w.document);
  w.document.createElement = (tag) => { const el = origCreate(tag); if (tag === 'a') el.click = () => clicks.push({ href: el.href, download: el.download }); return el; };
  w.eval(src);
  // jsdom's document is still `loading` here, so the module's self-init is
  // deferred to DOMContentLoaded; attach the handlers now, as the browser will.
  assert.equal(w.WorkingPaperDownload.init(), true, 'both controls found');
  return { w, blobs, clicks };
}

run('Word download is the article minus its chrome, typed as a Word document', () => {
  const { w, blobs, clicks } = fixture();
  w.document.getElementById('wpDownloadWord').click();
  assert.equal(blobs.length, 1, 'one document produced');
  assert.equal(blobs[0].type, 'application/msword');
  assert.equal(clicks[0].download, 'instrumenting-housing-need-working-paper.doc');
  const html = w.__wpBuildWordDocument();
  assert.match(html, /xmlns:w="urn:schemas-microsoft-com:office:word"/, 'Word namespaces');
  assert.match(html, /<title>Instrumenting Housing Need<\/title>/, 'titled from the article h1');
  assert.match(html, /The tractable count is <span data-figure="x">63<\/span>/, 'the figures on the page at download time');
  assert.ok(!/wp-actions/.test(html), 'download controls stripped');
  assert.ok(!/<button/.test(html), 'buttons stripped');
  assert.ok(!/<script/.test(html), 'scripts stripped');
  assert.equal(w.document.querySelector('article.wp button#inArticle') !== null, true, 'the live page is untouched');
});

run('PDF download opens the print dialog', () => {
  const { w } = fixture();
  w.document.getElementById('wpDownloadPdf').click();
  assert.equal(w.__printed, 1);
});

run('without an article there is nothing to download, and nothing is produced', () => {
  const dom = new JSDOM('<!doctype html><html><body><p>no paper here</p></body></html>', { runScripts: 'outside-only' });
  dom.window.eval(src);
  assert.equal(dom.window.__wpBuildWordDocument(), null);
  assert.equal(dom.window.WorkingPaperDownload.downloadWord(dom.window.document), false);
});

if (failures) { console.error('working-paper-download: FAIL'); process.exitCode = 1; }
else console.log('working-paper-download: PASS');
